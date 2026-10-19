use crate::{
    app::AppState,
    error::ApiError,
    game::*,
    repository::{models::*, multi as store},
    service::{
        catalog,
        multi::{auth, invalid, matches, projection, relay, rooms},
    },
};

use serde::Deserialize;
use serde_json::{Value, json};
#[derive(Default, Deserialize)]
pub struct Params {
    after: Option<i64>,
}

pub async fn snapshot(
    state: AppState,
    id: String,
    authorization: &str,
    params: Result<Params, ApiError>,
) -> Result<Value, ApiError> {
    let params = params?;
    let after = params.after.unwrap_or(0);
    if after < 0 {
        return Err(invalid("请求参数不合法。"));
    }
    let viewer = auth::authenticate(&state, authorization, &id, true).await?;
    build(&state, &id, &viewer, after).await
}
/// A repeatable-read transaction keeps every projection at one database snapshot,
/// including the durable game sequence and replay records.
pub async fn build(
    state: &AppState,
    id: &str,
    viewer: &Member,
    after: i64,
) -> Result<Value, ApiError> {
    let mut tx = state.pool.begin().await?;
    sqlx::query!(
        r#"
        SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY
        "#,
    )
    .execute(&mut *tx)
    .await?;
    let room = store::room(&mut tx, id, false).await?;
    super::validate_mode(state, &room.mode)?;
    let members = store::members(&mut tx, id).await?;
    let spectators = store::spectator_count(&mut tx, id).await?;
    let relay_enabled = if room.mode == "relay" {
        store::relay_elimination(&mut tx, id).await?
    } else {
        false
    };
    let mut v = rooms::updated_payload(&room, &members, spectators, relay_enabled);
    v["roomId"] = json!(room.id);
    v["roomCode"] = json!(room.code);
    v["status"] = json!(room.status);
    v["expiresAt"] = room
        .expires_at
        .map(|t| json!(t))
        .unwrap_or_else(|| json!("0001-01-01T00:00:00Z"));
    v["viewer"] = rooms::participant(viewer);
    v["gameSequence"] = json!(room.event_seq);
    v["questionScope"] = room.question_scope.clone();
    let m = store::latest_match(&mut tx, id, false).await?;
    if let Some(m) = m.as_ref() {
        super::validate_ruleset(state, &room, m)?;
        let players = store::match_players(&mut tx, &m.id).await?;
        let round = sqlx::query_as!(
            Round,
            r#"
            SELECT id, match_id, round_index, answer_id, status, winner_slot, starts_at, deadline, ended_at,
            turn_slot, turn_deadline, winner_member_id FROM multi_round WHERE match_id=$1 AND status IN
            ('countdown', 'playing') ORDER BY round_index DESC LIMIT 1
            "#,
            &m.id,
        ).fetch_optional(&mut *tx).await?;
        let scope = m
            .question_scope
            .as_ref()
            .filter(|v| v["schemaVersion"].as_i64().unwrap_or(0) > 0)
            .unwrap_or(&room.question_scope);
        let scope_config: QuestionScopeConfig = serde_json::from_value(scope.clone())?;
        let mut mv = json!({"matchIndex":m.match_index,"targetWins":m.target_wins,"scores":projection::scores(&players),"roundIndex":round.as_ref().map(|r|r.round_index).unwrap_or(0),"maxRounds":m.max_rounds,"scoringMode":m.scoring_mode,"rosterSize":m.roster_size,"rematchReady":members.iter().map(|p|json!({"memberId":p.id,"seat":p.seat(),"ready":p.rematch_ready})).collect::<Vec<_>>(),"catalogVersion":m.catalog_version,"questionScope":scope,"activeFields":fields_for_question_scope(&scope_config),"ruleSetRef":{"mode":room.mode,"key":super::ruleset_key(&room,m),"version":if m.rule_set_version==0{1}else{m.rule_set_version}}});
        // Upgraded legacy relay matches can retain only multi_round/multi_turn
        // history after restart recovery. They have no stage fragment to load.
        let has_stages = room.mode == "relay"
            && sqlx::query_scalar!(
                r#"
            SELECT EXISTS(SELECT 1 FROM multi_relay_stage WHERE match_id=$1) AS "value!"
            "#,
                &m.id,
            )
            .fetch_one(&mut *tx)
            .await?;
        if has_stages && round.is_none() {
            let fragment = relay::snapshot(state, &mut tx, &room, m, viewer).await?;
            if let Some(value) = fragment.get("relay") {
                mv["relay"] = value.clone();
            }
            if let Some(value) = fragment.get("roundIndex") {
                mv["roundIndex"] = value.clone();
            }
            if let Some(value) = fragment.get("round") {
                v["round"] = value.clone();
            }
        }
        if let Some(round) = round {
            let guesses = store::guesses(&mut tx, &round.id).await?;
            let participants = store::round_players(&mut tx, &round.id).await?;
            let chars = catalog::characters_for_version(&mut tx, &m.catalog_version).await?;
            let fields = matches::fields_for_match(m);
            let readonly = viewer.is_spectator()
                || players
                    .iter()
                    .any(|p| p.member_id == viewer.id && p.status != "active");
            let mut self_view = json!({"guesses":[]});
            let mut opponents = vec![];
            if !readonly && viewer.is_player() {
                self_view["memberId"] = json!(viewer.id);
                self_view["seat"] = json!(viewer.seat());
                let mut rows = vec![];
                for guess in guesses.iter().filter(|g| g.member_id == viewer.id) {
                    let c = chars
                        .iter()
                        .find(|c| c.id == guess.guess_id)
                        .ok_or_else(|| ApiError::invariant("snapshot guess character missing"))?;
                    rows.push(projection::hydrate_guess(
                        c,
                        &serde_json::from_value::<Vec<String>>(guess.statuses.clone())?,
                        guess.is_correct,
                        &fields,
                        match_kind_for_stored_guess(
                            guess.is_correct,
                            &round.answer_id,
                            &guess.guess_id,
                        ),
                    ));
                }
                self_view["guesses"] = json!(rows);
                for member in members.iter().filter(|m| m.id != viewer.id) {
                    let perm = projection::column_permutation(
                        &state.config.multi.projection_secret,
                        &round.id,
                        &viewer.id,
                        &member.id,
                        fields.len(),
                    );
                    let mut rows = vec![];
                    for guess in guesses.iter().filter(|g| g.member_id == member.id) {
                        let statuses: Vec<String> = serde_json::from_value(guess.statuses.clone())?;
                        let statuses = projection::statuses_for_fields(&statuses, &fields);
                        rows.push(json!({"index":guess.sequence,"statuses":perm.iter().map(|&i|&statuses[i]).collect::<Vec<_>>()}));
                    }
                    opponents.push(json!({"memberId":member.id,"seat":member.seat(),"fieldOrder":perm.iter().map(|&i|&fields[i].key).collect::<Vec<_>>(),"rows":rows}));
                }
            }
            if let Some(player) = participants.iter().find(|p| p.member_id == viewer.id) {
                self_view["participationStatus"] = json!(player.status);
                if let Some(rank) = player.finish_rank {
                    self_view["finishRank"] = json!(rank);
                }
            }
            let mut rv = json!({"status":round.status,"startsAt":round.starts_at,"deadline":round.deadline,"maxGuesses":matches::max_guesses_for_match(m),"self":self_view,"opponents":opponents});
            if readonly {
                rv["boards"] =
                    projection::boards(&members, &guesses, &chars, &fields, &round.answer_id)?;
            }
            v["round"] = rv;
        }
        v["match"] = mv;
    }
    let events: Vec<RoomEvent> = sqlx::query_as!(
        RoomEvent,
        r#"
        SELECT id, room_id, sequence, type AS event_type, payload, occurred_at FROM room_event WHERE
        room_id=$1 AND sequence>$2 ORDER BY sequence
        "#,
        id,
        after,
    )
    .fetch_all(&mut *tx)
    .await?;
    let mut projected = vec![];
    for event in events {
        if after == 0
            && room.mode == "relay"
            && !matches!(
                event.event_type.as_str(),
                "relay.stage.ended" | "match.ended"
            )
        {
            continue;
        }
        let p = projection::project_event_tx(state, &mut tx, &event, viewer).await?;
        if p["type"] != "room.cursor" {
            projected.push(p);
        }
    }
    v["events"] = json!(projected);
    tx.commit().await?;
    if let Some(m) = m {
        crate::metrics::METRICS.observe(
            "snapshot_bytes",
            crate::metrics::Labels::new(&room.mode, &m.rule_set_key, m.rule_set_version),
            serde_json::to_vec(&v)?.len() as f64,
        );
    }
    Ok(v)
}
