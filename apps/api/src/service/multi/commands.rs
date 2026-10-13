use crate::{
    app::AppState,
    contracts,
    error::ApiError,
    game::*,
    repository::{models::*, multi as store},
    service::{
        catalog,
        multi::{
            RoomEffect, auth, conflict, events, invalid, matches, new_id, projection,
            race::{announcement, complete_round_tx, current_round, settle_roster},
            relay,
        },
    },
};
use axum::http::StatusCode;

use serde_json::{Value, json};

pub async fn guess(
    state: AppState,
    (room_id, index): (String, i32),
    authorization: &str,
    body: Result<Value, ApiError>,
) -> Result<Value, ApiError> {
    let member = auth::authenticate(&state, authorization, &room_id, false).await?;
    auth::require_player(&member)?;
    let b = body?;
    contracts::validate_value("RoomsSubmitGuessRequestBody", &b)
        .map_err(|_| invalid("请求参数不合法。"))?;
    let guess = b["guessId"].as_str().unwrap_or("");
    let key = b["idempotencyKey"].as_str().unwrap_or("");
    let mut tx = state.pool.begin().await?;
    let room = store::room(&mut tx, &room_id, false).await?;
    super::validate_mode(&state, &room.mode)?;
    if room.mode == "relay" {
        tx.rollback().await?;
        let result =
            relay::legacy_action(&state, &room_id, index, &member, "guess", key, Some(guess))
                .await?;
        return Ok(json!({"roundIndex":index,"guess":result}));
    }
    if ["lobby", "closed"].contains(&room.status.as_str()) {
        return Err(conflict("ROOM_CLOSED", "房间状态不允许该操作。"));
    }
    let round = current_round(&mut tx, &room_id).await?.ok_or_else(|| {
        if room.status == "finished" {
            conflict("ROUND_ENDED", "对局已结束。")
        } else {
            conflict("ROUND_NOT_ACTIVE", "当前没有可猜测的局。")
        }
    })?;
    if round.round_index != index {
        return Err(conflict("ROUND_NOT_ACTIVE", "目标局不是当前局。"));
    }
    let m = store::match_by_id(&mut tx, &round.match_id, true).await?;
    super::validate_ruleset(&state, &room, &m)?;
    let player = store::round_players(&mut tx, &round.id)
        .await?
        .into_iter()
        .find(|p| p.member_id == member.id)
        .ok_or_else(|| conflict("ROUND_NOT_ACTIVE", "你不在本局阵容中。"))?;
    if player.status != "active" {
        return Err(if player.status == "exhausted" {
            conflict("GUESS_LIMIT_REACHED", "本局猜测次数已用尽。")
        } else {
            conflict(
                "ROUND_NOT_ACTIVE",
                match player.status.as_str() {
                    "correct" => "你已猜中本局。",
                    "timed_out" => "本局已超时。",
                    _ => "你已放弃本局。",
                },
            )
        });
    }
    let chars = catalog::characters_for_version(&mut tx, &m.catalog_version).await?;
    let runtime =
        build_catalog_runtime(&m.catalog_version, m.answer_match_policy.parse()?, &chars)?;
    let storage_fields = matches::storage_fields_for_match(&m);
    let result = runtime
        .evaluate_guess(&round.answer_id, guess, Some(&storage_fields))
        .map_err(|error| {
            ApiError::new(
                StatusCode::BAD_REQUEST,
                "INVALID_GUESS",
                "该角色不在本局题库中。",
            )
            .with_source(error)
        })?;
    if round.status == "ended" {
        return Err(conflict(
            if result.is_correct {
                "ROUND_ENDED"
            } else {
                "ROUND_NOT_ACTIVE"
            },
            "本局已结束。",
        ));
    }
    let now = (state.clock)();
    if round.status != "playing" || now < round.starts_at {
        return Err(conflict("ROUND_NOT_ACTIVE", "本局尚未开始。"));
    }
    if now >= round.deadline {
        complete_round_tx(&state, &mut tx, &room, &round, &m, None, None, now).await?;
        tx.commit().await?;
        events::publish(&state, &RoomEffect::game(&room_id));
        return Err(conflict("ROUND_NOT_ACTIVE", "本局已超时（按平局结算）。"));
    }
    let existing: Option<Guess> = sqlx::query_as!(
        Guess,
        r#"
        SELECT id, round_id, member_id, sequence, guess_id, statuses, is_correct, idempotency_key, created_at
        FROM multi_guess WHERE round_id=$1 AND member_id=$2 AND idempotency_key=$3
        "#,
        &round.id,
        &member.id,
        key,
    ).fetch_optional(&mut *tx).await?;
    let fields = matches::fields_for_match(&m);
    if let Some(existing) = existing {
        let c = chars
            .iter()
            .find(|c| c.id == existing.guess_id)
            .ok_or_else(|| ApiError::invariant("stored guess character missing"))?;
        let statuses: Vec<String> = serde_json::from_value(existing.statuses)?;
        let response = json!({"roundIndex":index,"guess":projection::hydrate_guess(c,&statuses,existing.is_correct,&fields,match_kind_for_stored_guess(existing.is_correct,&round.answer_id,&existing.guess_id))});
        tx.commit().await?;
        return Ok(response);
    }
    let count: i64 = sqlx::query_scalar!(
        r#"
        SELECT count(*) AS "value!" FROM multi_guess WHERE round_id=$1 AND member_id=$2
        "#,
        &round.id,
        &member.id,
    )
    .fetch_one(&mut *tx)
    .await?;
    let max = matches::max_guesses_for_match(&m);
    if count >= max as i64 {
        return Err(conflict("GUESS_LIMIT_REACHED", "本局猜测次数已用尽。"));
    }
    let statuses: Vec<_> = result
        .feedback
        .iter()
        .map(|f| serde_json::to_value(f.status).unwrap())
        .collect();
    let inserted = sqlx::query!(
        r#"
        INSERT INTO multi_guess(id, round_id, member_id, sequence, guess_id, statuses, is_correct,
        idempotency_key, created_at) VALUES($1, $2, $3, $4, $5, $6, $7, $8, $9)
        "#,
        new_id(),
        &round.id,
        &member.id,
        count as i32 + 1,
        guess,
        json!(statuses),
        result.is_correct,
        key,
        now,
    )
    .execute(&mut *tx)
    .await;
    if let Err(error) = inserted {
        if error
            .as_database_error()
            .is_some_and(|e| e.constraint() == Some("multi_guess_round_id_member_id_guess_id_key"))
        {
            return Err(conflict("DUPLICATE_GUESS", "本局已猜过该角色。"));
        }
        return Err(ApiError::from(error));
    }
    events::append_event(&mut tx,&room_id,"round.opponent.guess",json!({"roundId":round.id,"memberId":member.id,"guessId":guess,"matchIndex":m.match_index,"roundIndex":index,"memberSlot":member.seat(),"rowIndex":count+1,"statuses":statuses}),now).await?;
    let scored = m.scoring_mode != "wins";
    let mut response = json!({"roundIndex":index,"guess":projection::hydrate_guess(runtime.by_id.get(guess).unwrap(),&serde_json::from_value::<Vec<String>>(json!(statuses))?,result.is_correct,&fields,result.match_kind)});
    if scored && result.is_correct {
        let rank: i64 = sqlx::query_scalar!(
            r#"
            SELECT count(*)+1 AS "value!" FROM multi_round_player WHERE round_id=$1 AND status='correct'
            "#,
            &round.id,
        ).fetch_one(&mut *tx).await?;
        sqlx::query!(
            r#"
            UPDATE multi_round_player SET status='correct', finish_rank=$3, completed_at=$4 WHERE round_id=$1 AND
            member_id=$2
            "#,
            &round.id,
            &member.id,
            rank as i32,
            now,
        ).execute(&mut *tx).await?;
        response["participationStatus"] = json!("correct");
        response["finishRank"] = json!(rank);
    } else if scored && count + 1 >= max as i64 {
        sqlx::query!(
            r#"
            UPDATE multi_round_player SET status='exhausted', completed_at=$3 WHERE round_id=$1 AND member_id=$2
            "#,
            &round.id,
            &member.id,
            now,
        ).execute(&mut *tx).await?;
        response["participationStatus"] = json!("exhausted");
    }
    if !scored && result.is_correct {
        complete_round_tx(
            &state,
            &mut tx,
            &room,
            &round,
            &m,
            Some(&member.id),
            None,
            now,
        )
        .await?;
    } else if scored {
        settle_roster(&state, &mut tx, &room, &round, &m, None, now).await?;
    } else {
        let counts: Vec<i64> = sqlx::query_scalar!(
            r#"
            SELECT count(g.id) AS "value!" FROM multi_round_player p LEFT JOIN multi_guess g ON
            g.round_id=p.round_id AND g.member_id=p.member_id WHERE p.round_id=$1 AND p.status='active' GROUP BY
            p.member_id
            "#,
            &round.id,
        ).fetch_all(&mut *tx).await?;
        if !counts.is_empty() && counts.iter().all(|n| *n >= max as i64) {
            complete_round_tx(&state, &mut tx, &room, &round, &m, None, None, now).await?;
        }
    }
    let reason = if result.is_correct {
        Some("correct")
    } else if count + 1 >= max as i64 {
        Some("exhausted")
    } else {
        None
    };
    let mut effect = RoomEffect::game(&room_id);
    if let Some(reason) = reason {
        effect.chat =
            announcement(&state, &mut tx, &room, &m, &round, &member, reason, now).await?;
    }
    tx.commit().await?;
    events::publish(&state, &effect);
    Ok(response)
}
pub async fn forfeit(
    state: AppState,
    (id, index): (String, i32),
    authorization: &str,
) -> Result<(), ApiError> {
    let member = auth::authenticate(&state, authorization, &id, false).await?;
    auth::require_player(&member)?;
    let mut tx = state.pool.begin().await?;
    let room = store::room(&mut tx, &id, false).await?;
    super::validate_mode(&state, &room.mode)?;
    if room.mode == "relay" {
        tx.rollback().await?;
        relay::legacy_action(&state, &id, index, &member, "forfeit", "", None).await?;
        return Ok(());
    }
    if room.status != "playing" {
        return Err(conflict("ROOM_CLOSED", "房间状态不允许该操作。"));
    }
    let round = current_round(&mut tx, &id)
        .await?
        .filter(|r| r.round_index == index)
        .ok_or_else(|| conflict("ROUND_NOT_ACTIVE", "目标局不是当前局。"))?;
    let m = store::match_by_id(&mut tx, &round.match_id, true).await?;
    super::validate_ruleset(&state, &room, &m)?;
    let now = (state.clock)();
    if round.status == "ended" {
        return Err(conflict("ROUND_ENDED", "本局已结束。"));
    }
    if round.status != "playing" || now < round.starts_at || now >= round.deadline {
        return Err(conflict("ROUND_NOT_ACTIVE", "本局尚未开始或已超时。"));
    }
    let rows = sqlx::query!(
        r#"
        UPDATE multi_round_player SET status='forfeited', finish_rank=NULL, completed_at=$3 WHERE round_id=$1
        AND member_id=$2 AND status='active'
        "#,
        &round.id,
        &member.id,
        now,
    ).execute(&mut *tx).await?.rows_affected();
    if rows == 0 {
        return Err(conflict("ROUND_NOT_ACTIVE", "你已放弃本局。"));
    }
    settle_roster(&state, &mut tx, &room, &round, &m, Some(&member.id), now).await?;
    let chat = announcement(
        &state,
        &mut tx,
        &room,
        &m,
        &round,
        &member,
        "forfeited",
        now,
    )
    .await?;
    tx.commit().await?;
    events::publish(
        &state,
        &RoomEffect {
            room_id: id,
            game: true,
            chat,
            ..Default::default()
        },
    );
    Ok(())
}
pub async fn pass(
    state: AppState,
    (id, index): (String, i32),
    authorization: &str,
) -> Result<(), ApiError> {
    let member = auth::authenticate(&state, authorization, &id, false).await?;
    auth::require_player(&member)?;
    let mut conn = state.pool.acquire().await?;
    let room = store::room(&mut conn, &id, false).await?;
    super::validate_mode(&state, &room.mode)?;
    drop(conn);
    if room.mode != "relay" {
        return Err(conflict("INVALID_REQUEST", "只有接力模式可以主动空过。"));
    }
    relay::legacy_action(
        &state,
        &id,
        index,
        &member,
        "pass",
        &format!("legacy-pass/{}", new_id()),
        None,
    )
    .await?;
    Ok(())
}
