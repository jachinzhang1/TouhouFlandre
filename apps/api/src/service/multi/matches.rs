use crate::{
    app::AppState,
    error::ApiError,
    game::*,
    repository::{models::*, multi as store},
    service::{
        catalog,
        multi::{RoomEffect, auth, conflict, events, new_id, relay},
    },
};
use axum::http::StatusCode;

use chrono::{DateTime, Utc};
use serde_json::json;
use sqlx::PgConnection;

pub fn scope_for_match(m: &Match) -> Option<QuestionScopeConfig> {
    m.question_scope
        .as_ref()
        .and_then(|v| serde_json::from_value(v.clone()).ok())
}
pub fn fields_for_match(m: &Match) -> Vec<GuessField> {
    scope_for_match(m)
        .map(|s| fields_for_question_scope(&s))
        .unwrap_or_else(character_guess_fields)
}
pub fn storage_fields_for_match(m: &Match) -> Vec<GuessField> {
    scope_for_match(m)
        .map(|s| storage_fields_for_question_scope(&s))
        .unwrap_or_else(character_guess_fields)
}
pub fn max_guesses_for_match(m: &Match) -> i32 {
    scope_for_match(m)
        .map(|s| effective_question_scope_max_guesses(&s.rules))
        .unwrap_or(8)
}
pub fn format_rounds(format: &str) -> i32 {
    match format {
        "bo1" => 1,
        "bo3" => 3,
        "bo5" => 5,
        "bo7" => 7,
        _ => 0,
    }
}
pub fn scoring_mode(roster: usize, elimination: bool) -> &'static str {
    if roster <= 2 {
        "wins"
    } else if elimination {
        "placement"
    } else {
        "points"
    }
}
pub fn max_rounds(mode: &str, roster: usize, format: &str, factor: usize) -> i32 {
    if mode == "placement" && roster > 0 {
        (roster * factor) as i32
    } else {
        format_rounds(format)
    }
}
pub async fn start_match_tx(
    state: &AppState,
    conn: &mut PgConnection,
    room: &Room,
) -> Result<Match, ApiError> {
    super::validate_mode(state, &room.mode)?;
    let now = (state.clock)();
    let (version, characters, works) = catalog::current_catalog(conn).await?;
    let input: QuestionScopeConfig = serde_json::from_value(room.question_scope.clone())?;
    let correction = normalize_question_scope(
        Some(&input),
        &version,
        &catalog::scope_works(&works, &characters),
        &characters,
    );
    let scope = correction.config;
    if correction.changed {
        sqlx::query!(
            r#"
            UPDATE multi_room SET question_scope=$2 WHERE id=$1
            "#,
            &room.id,
            json!(scope),
        )
        .execute(&mut *conn)
        .await?;
    }
    let members = store::members(conn, &room.id).await?;
    let relay_elimination = if room.mode == "relay" {
        store::relay_elimination(conn, &room.id).await?
    } else {
        false
    };
    let (key, version_rule, scoring, target, max) = if room.mode == "relay" {
        let p = relay::match_plan(
            members.len(),
            &room.format,
            state.config.multi.max_rounds_factor,
            relay_elimination,
        )?;
        (
            p.ruleset_key,
            p.ruleset_version,
            p.scoring_mode,
            p.target_wins,
            p.max_rounds,
        )
    } else {
        let mode = scoring_mode(members.len(), room.race_elimination_enabled);
        (
            mode,
            1,
            mode,
            (format_rounds(&room.format) + 1) / 2,
            max_rounds(
                mode,
                members.len(),
                &room.format,
                state.config.multi.max_rounds_factor,
            ),
        )
    };
    let config = json!({"mode":room.mode,"format":room.format,"turnSeconds":room.turn_seconds,"rosterSize":members.len(),"targetWins":target,"maxRounds":max,"questionScope":scope,"raceEliminationEnabled":room.race_elimination_enabled,"relayEliminationEnabled":relay_elimination,"answerMatchPolicy":state.config.answer_match_policy});
    let m: Match = sqlx::query_as!(
        Match,
        r#"
        INSERT INTO multi_match(id, room_id, match_index, catalog_version, target_wins, status, started_at,
        question_scope, scoring_mode, roster_size, max_rounds, rule_set_key, rule_set_version,
        rule_config_snapshot, answer_match_policy) SELECT $1, $2, COALESCE(MAX(match_index), -1)+1, $3, $4,
        'playing', $5, $6, $7, $8, $9, $10, $11, $12, $13 FROM multi_match WHERE room_id=$2 RETURNING id,
        room_id, match_index, catalog_version, target_wins, score_slot1, score_slot2, round_count, status,
        started_at, ended_at, question_scope, winner_member_id, scoring_mode, roster_size, max_rounds,
        rule_set_key, rule_set_version, rule_config_snapshot, answer_match_policy
        "#,
        new_id(),
        &room.id,
        &version,
        target,
        now,
        json!(scope),
        scoring,
        members.len()as i32,
        max,
        key,
        version_rule,
        config,
        &state.config.answer_match_policy,
    ).fetch_one(&mut *conn).await?;
    let mut payload = json!({"format":room.format,"mode":room.mode,"turnSeconds":room.turn_seconds,"targetWins":target,"catalogVersion":version,"matchIndex":m.match_index,"questionScope":scope,"activeFields":fields_for_match(&m),"scoringMode":scoring,"ruleSetRef":{"mode":room.mode,"key":key,"version":version_rule},"rosterSize":members.len(),"maxRounds":max});
    if room.mode == "relay" && key == "fixed_points" {
        payload["plannedStages"] = json!(max);
    }
    events::append_event(conn, &room.id, "match.started", payload, now).await?;
    for member in &members {
        sqlx::query!(
            r#"
            INSERT INTO multi_match_player(match_id, member_id, seat, wins, status, score, best_round_score)
            VALUES($1, $2, $3, 0, 'active', 0, 0)
            "#,
            &m.id,
            &member.id,
            member.seat(),
        ).execute(&mut *conn).await?;
    }
    if room.mode == "relay" {
        relay::start_match_tx(state, conn, room, &m, &members, &characters, now).await?;
    } else {
        create_round_tx(
            state,
            conn,
            room,
            &m,
            1,
            now + state.config.multi.round_countdown,
            now,
        )
        .await?;
    }
    sqlx::query!(
        r#"
        UPDATE multi_room SET status='playing' WHERE id=$1
        "#,
        &room.id,
    )
    .execute(&mut *conn)
    .await?;
    Ok(m)
}
pub async fn create_round_tx(
    state: &AppState,
    conn: &mut PgConnection,
    room: &Room,
    m: &Match,
    index: i32,
    starts: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<Round, ApiError> {
    let chars = catalog::characters_for_version(conn, &m.catalog_version).await?;
    let runtime =
        build_catalog_runtime(&m.catalog_version, m.answer_match_policy.parse()?, &chars)?;
    let used: Vec<String> = sqlx::query_scalar!(
        r#"
        SELECT answer_id FROM multi_round WHERE match_id=$1 ORDER BY round_index
        "#,
        &m.id,
    )
    .fetch_all(&mut *conn)
    .await?;
    let pool = scope_for_match(m)
        .filter(|s| !s.selected_character_ids.is_empty())
        .map(|s| question_scope_answer_pool(&s))
        .unwrap_or_else(|| {
            chars
                .iter()
                .filter(|c| c.enabled_as_answer)
                .map(|c| c.id.clone())
                .collect()
        });
    let mut seen = std::collections::HashSet::new();
    let used: std::collections::HashSet<_> = used.iter().map(|id| runtime.group_key(id)).collect();
    let candidates: Vec<_> = pool
        .iter()
        .filter(|id| {
            let group = runtime.group_key(id);
            !used.contains(group) && seen.insert(group)
        })
        .collect();
    if candidates.is_empty() {
        return Err(ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL",
            "题库中没有可作为答案的角色。",
        ));
    }
    let answer = candidates[(state.random_index)(candidates.len())];
    let max = if m.max_rounds > 0 {
        m.max_rounds
    } else {
        max_rounds(
            &m.scoring_mode,
            m.roster_size as usize,
            &room.format,
            state.config.multi.max_rounds_factor,
        )
    };
    let duration = if state.config.multi.race_round_seconds > chrono::Duration::zero() {
        state.config.multi.race_round_seconds
    } else {
        state.config.multi.round_seconds
    };
    let round: Round = sqlx::query_as!(
        Round,
        r#"
        WITH incremented AS (UPDATE multi_match SET round_count=round_count+1 WHERE id=$1 AND round_count<$2
        RETURNING id) INSERT INTO multi_round(id, match_id, round_index, answer_id, status, starts_at,
        deadline) SELECT $3, id, $4, $5, 'countdown', $6, $7 FROM incremented RETURNING id, match_id,
        round_index, answer_id, status, winner_slot, starts_at, deadline, ended_at, turn_slot, turn_deadline,
        winner_member_id
        "#,
        &m.id,
        max,
        new_id(),
        index,
        answer,
        starts,
        starts+duration,
    ).fetch_one(&mut *conn).await?;
    sqlx::query!(
        r#"
        INSERT INTO multi_round_player(round_id, member_id, status) SELECT $1, member_id, 'active' FROM
        multi_match_player WHERE match_id=$2 AND status='active'
        "#,
        &round.id,
        &m.id,
    ).execute(&mut *conn).await?;
    let count: i64 = sqlx::query_scalar!(
        r#"
        SELECT count(*) AS "value!" FROM multi_match_player WHERE match_id=$1 AND status='active'
        "#,
        &m.id,
    )
    .fetch_one(&mut *conn)
    .await?;
    events::append_event(conn,&room.id,"round.started",json!({"matchIndex":m.match_index,"roundIndex":index,"startsAt":starts,"deadline":round.deadline,"maxGuesses":max_guesses_for_match(m),"activePlayerCount":count}),now).await?;
    Ok(round)
}
pub async fn rematch(state: AppState, id: String, authorization: &str) -> Result<(), ApiError> {
    let member = auth::authenticate(&state, authorization, &id, false).await?;
    auth::require_player(&member)?;
    let mut tx = state.pool.begin().await?;
    let room = store::room(&mut tx, &id, true).await?;
    if room.status == "closed" {
        return Err(conflict("ROOM_CLOSED", "房间状态不允许该操作。"));
    }
    if room.status != "finished" {
        return Err(conflict(
            "REMATCH_NOT_AVAILABLE",
            "对局未结束，无法再来一局。",
        ));
    }
    let m = store::latest_match(&mut tx, &id, true)
        .await?
        .filter(|m| m.status == "finished")
        .ok_or_else(|| conflict("REMATCH_NOT_AVAILABLE", "没有可再来的已结束对局。"))?;
    super::validate_ruleset(&state, &room, &m)?;
    let roster = store::match_players(&mut tx, &m.id).await?;
    let members = store::members(&mut tx, &id).await?;
    for frozen in &roster {
        if members
            .iter()
            .find(|p| p.id == frozen.member_id)
            .is_none_or(|p| p.status == "left")
        {
            return Err(conflict(
                "REMATCH_NOT_AVAILABLE",
                "原对局阵容已有成员离开，无法再来一局。",
            ));
        }
    }
    if !roster.iter().any(|p| p.member_id == member.id)
        || members
            .iter()
            .find(|p| p.id == member.id)
            .is_none_or(|p| p.status != "connected")
    {
        return Err(conflict(
            "REMATCH_NOT_AVAILABLE",
            "请先重新连接房间后再确认。",
        ));
    }
    let already = members
        .iter()
        .find(|p| p.id == member.id)
        .unwrap()
        .rematch_ready;
    if !already {
        sqlx::query!(
            r#"
            UPDATE multi_member SET rematch_ready=true WHERE id=$1
            "#,
            &member.id,
        )
        .execute(&mut *tx)
        .await?;
        events::append_event(
            &mut tx,
            &id,
            "match.rematch",
            json!({"memberId":member.id,"seat":member.seat()}),
            (state.clock)(),
        )
        .await?;
    }
    let after = store::members(&mut tx, &id).await?;
    if roster.iter().all(|p| {
        after
            .iter()
            .any(|m| m.id == p.member_id && m.status == "connected" && m.rematch_ready)
    }) {
        start_match_tx(&state, &mut tx, &room).await?;
        sqlx::query!(
            r#"
            UPDATE multi_member SET rematch_ready=false WHERE room_id=$1 AND role='player'
            "#,
            &id,
        )
        .execute(&mut *tx)
        .await?;
    }
    tx.commit().await?;
    events::publish(&state, &RoomEffect::game(&id));
    Ok(())
}
