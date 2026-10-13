use crate::{
    app::AppState,
    domain::relay::{ForcedEnd, Rule, Transition},
    error::ApiError,
    repository::{
        models::{Member, Room},
        multi as store,
        relay::{self as storage, Encounter},
    },
    service::multi::{
        events::{self, RoomEffect},
        relay::{coordinator, service},
    },
};
use chrono::{DateTime, Utc};
use serde_json::json;
use sqlx::PgConnection;
use std::collections::BTreeMap;

pub async fn forfeit_member_tx(
    state: &AppState,
    c: &mut PgConnection,
    room: &Room,
    member: &Member,
    reason: &str,
    now: DateTime<Utc>,
) -> Result<RoomEffect, ApiError> {
    forfeit_members_tx(state, c, room, std::slice::from_ref(member), reason, now).await
}
/// Lock encounters before match/room. Recheck disconnect expiry under the room
/// lock used by reconnect so a stale sweep selection cannot remove a reconnect.
pub async fn forfeit_members_tx(
    state: &AppState,
    c: &mut PgConnection,
    room: &Room,
    requested: &[Member],
    reason: &str,
    now: DateTime<Utc>,
) -> Result<RoomEffect, ApiError> {
    let mut effect = RoomEffect {
        room_id: room.id.clone(),
        game: false,
        chat: false,
        ..Default::default()
    };
    if requested.is_empty() {
        return Ok(effect);
    }
    if !matches!(reason, "forfeit" | "disconnect") {
        return Err(super::domain::Error::Invalid.into());
    }
    let mut encounters:Vec<Encounter>=sqlx::query_as("SELECT e.* FROM multi_relay_encounter e JOIN multi_match m ON m.id=e.match_id WHERE m.room_id=$1 AND m.status='playing' AND e.status<>'ended' ORDER BY e.id FOR UPDATE OF e").bind(&room.id).fetch_all(&mut *c).await?;
    let _room_lock = store::room(c, &room.id, true).await?;
    let Some(m) = store::latest_match(c, &room.id, true)
        .await?
        .filter(|m| m.status == "playing")
    else {
        return Ok(effect);
    };
    let rule = storage::validate_match(&m)?;
    let mut departed = Vec::new();
    for request in requested {
        if request.room_id != room.id {
            return Err(super::domain::Error::Invalid.into());
        }
        let member: Member = sqlx::query_as("SELECT * FROM multi_member WHERE id=$1 FOR UPDATE")
            .bind(&request.id)
            .fetch_one(&mut *c)
            .await?;
        if reason == "disconnect"
            && (member.status != "disconnected"
                || member.grace_until.is_none_or(|deadline| deadline > now))
        {
            continue;
        }
        if member.status != "left" {
            departed.push(member)
        }
    }
    if departed.is_empty() {
        return Ok(effect);
    }
    let stages = storage::stages(c, &m.id).await?;
    let open: Vec<_> = stages.iter().filter(|s| s.status != "ended").collect();
    for member in &departed {
        let affected=sqlx::query("UPDATE multi_match_player SET status='left' WHERE match_id=$1 AND member_id=$2 AND status='active'").bind(&m.id).bind(&member.id).execute(&mut *c).await?.rows_affected();
        if affected > 0 && rule == Rule::Elimination {
            let stage_index:Option<i32>=sqlx::query_scalar("SELECT s.stage_index FROM multi_relay_stage s WHERE s.match_id=$1 AND s.status<>'ended' AND (EXISTS(SELECT 1 FROM multi_relay_encounter_member a WHERE a.stage_id=s.id AND a.member_id=$2) OR EXISTS(SELECT 1 FROM multi_relay_stage_bye b WHERE b.stage_id=s.id AND b.member_id=$2)) ORDER BY s.stage_index DESC LIMIT 1").bind(&m.id).bind(&member.id).fetch_optional(&mut *c).await?;
            let stage_index = stage_index
                .ok_or_else(|| ApiError::invariant("relay elimination stage missing"))?;
            sqlx::query("UPDATE multi_relay_match_player_state SET eliminated_stage=COALESCE(eliminated_stage,$3) WHERE match_id=$1 AND member_id=$2").bind(&m.id).bind(&member.id).bind(stage_index).execute(&mut *c).await?;
        }
        sqlx::query("UPDATE multi_member SET status='left',grace_until=NULL WHERE id=$1")
            .bind(&member.id)
            .execute(&mut *c)
            .await?;
        effect.forfeits.push(reason.to_owned());
    }
    effect.game = true;
    crate::service::multi::rooms::append_updated(c, room, now).await?;
    for e in &mut encounters {
        let members = storage::assignments(c, &e.id).await?;
        let leaving: Vec<_> = members
            .iter()
            .filter(|a| departed.iter().any(|m| m.id == a.member_id))
            .collect();
        if leaving.is_empty() {
            continue;
        }
        let turns = storage::turns(c, &e.id).await?;
        let (transition, metadata) = if leaving.len() == 1 {
            let actor = &leaving[0].member_id;
            (
                storage::encounter_state(&m, e, &members, &turns)?.forfeit(actor, true)?,
                Some((
                    actor.clone(),
                    format!("match-end/{reason}/{actor}/{}", e.id),
                )),
            )
        } else {
            (Transition::terminal("draw", None), None)
        };
        let forced = if rule == Rule::Legacy {
            Some(ForcedEnd {
                winner: transition.winner.clone(),
                reason: reason.into(),
            })
        } else {
            None
        };
        effect.chat |= service::end_encounter(
            state,
            c,
            &m,
            e,
            &members,
            &turns,
            &transition,
            metadata.as_ref().map(|(a, k)| (a.as_str(), k.as_str())),
            forced.as_ref(),
            now,
        )
        .await?;
    }
    for s in open {
        coordinator::try_settle(state, c, &s.id, None, now).await?;
    }
    Ok(effect)
}
pub async fn sweep(state: &AppState, limit: i64) -> Result<Vec<RoomEffect>, ApiError> {
    let now = (state.clock)();
    let limit = if limit <= 0 { 100 } else { limit };
    let mut effects: BTreeMap<String, RoomEffect> = BTreeMap::new();
    let ids:Vec<String>=sqlx::query_scalar("SELECT e.id FROM multi_relay_encounter e JOIN multi_match m ON m.id=e.match_id JOIN multi_room r ON r.id=m.room_id WHERE r.mode='relay' AND m.status='playing' AND ((e.status IN ('planned','countdown') AND e.starts_at<=$1) OR (e.status='playing' AND (e.deadline<=$1 OR e.turn_deadline<=$1))) ORDER BY e.starts_at,e.id LIMIT $2").bind(now).bind(limit).fetch_all(&state.pool).await?;
    for id in ids {
        let mut tx = state.pool.begin().await?;
        let Some(mut e) = sqlx::query_as::<_, Encounter>(
            "SELECT * FROM multi_relay_encounter WHERE id=$1 FOR UPDATE",
        )
        .bind(&id)
        .fetch_optional(&mut *tx)
        .await?
        else {
            continue;
        };
        if e.status == "ended" {
            continue;
        }
        let m = store::match_by_id(&mut tx, &e.match_id, false).await?;
        if m.status != "playing" {
            continue;
        }
        storage::validate_match(&m)?;
        let members = storage::assignments(&mut tx, &e.id).await?;
        let mut turns = storage::turns(&mut tx, &e.id).await?;
        let mut effect = RoomEffect {
            room_id: m.room_id.clone(),
            game: false,
            chat: false,
            ..Default::default()
        };
        if matches!(e.status.as_str(), "planned" | "countdown") && now >= e.starts_at {
            service::start_encounter(&mut tx, &m, &mut e, &members, now).await?;
            effect.game = true;
        }
        if e.status == "playing" {
            effect.merge(
                &service::expire_turns(state, &mut tx, &m, &mut e, &members, &mut turns, None, now)
                    .await?
                    .effect,
            )
        }
        tx.commit().await?;
        if effect.game || effect.chat {
            // Notify each commit immediately: a later failed candidate must not
            // suppress already committed effects when this batch returns Err.
            events::publish(state, &effect);
            effects
                .entry(effect.room_id.clone())
                .or_default()
                .merge(&effect)
        }
    }
    let candidates:Vec<(String,String,String,i32)>=sqlx::query_as("SELECT s.id,m.room_id,m.rule_set_key,m.rule_set_version FROM multi_relay_stage s JOIN multi_match m ON m.id=s.match_id JOIN multi_room r ON r.id=m.room_id WHERE r.mode='relay' AND m.status='playing' AND s.settlement_marker IS NULL AND NOT EXISTS(SELECT 1 FROM multi_relay_encounter e WHERE e.stage_id=s.id AND e.status<>'ended') ORDER BY s.starts_at LIMIT $1").bind(limit).fetch_all(&state.pool).await?;
    for (stage, room, key, version) in candidates {
        crate::metrics::METRICS.increment(
            "settlement_retries_total",
            crate::metrics::Labels::new("relay", &key, version),
        );
        let mut tx = state.pool.begin().await?;
        let changed = coordinator::try_settle(state, &mut tx, &stage, None, now).await?;
        tx.commit().await?;
        if changed {
            events::publish(state, &RoomEffect::game(&room));
            effects
                .entry(room.clone())
                .or_default()
                .merge(&RoomEffect::game(&room))
        }
    }
    Ok(effects.into_values().collect())
}
/// Startup/shutdown terminates old active games with the same terminal reason;
/// ordinary ticks use `sweep`, which can safely retry an interrupted barrier.
pub async fn terminate_active(state: &AppState) -> Result<Vec<RoomEffect>, ApiError> {
    let rooms:Vec<String>=sqlx::query_scalar("SELECT DISTINCT m.room_id FROM multi_match m JOIN multi_room r ON r.id=m.room_id WHERE m.status='playing' AND r.mode='relay' ORDER BY m.room_id").fetch_all(&state.pool).await?;
    let mut effects = Vec::new();
    for room in rooms {
        let mut tx = state.pool.begin().await?;
        let effect = terminate_room_tx(state, &mut tx, &room, (state.clock)()).await?;
        tx.commit().await?;
        if effect.game {
            events::publish(state, &effect);
            effects.push(effect)
        }
    }
    Ok(effects)
}
pub async fn recover(state: &AppState, _limit: i64) -> Result<Vec<RoomEffect>, ApiError> {
    terminate_active(state).await
}
pub async fn terminate_room_tx(
    state: &AppState,
    c: &mut PgConnection,
    room_id: &str,
    now: DateTime<Utc>,
) -> Result<RoomEffect, ApiError> {
    let mut effect = RoomEffect {
        room_id: room_id.into(),
        game: false,
        chat: false,
        ..Default::default()
    };
    let _:Vec<String>=sqlx::query_scalar("SELECT e.id FROM multi_relay_encounter e JOIN multi_match m ON m.id=e.match_id WHERE m.room_id=$1 AND m.status='playing' AND e.status<>'ended' ORDER BY e.id FOR UPDATE OF e").bind(room_id).fetch_all(&mut *c).await?;
    let _room_lock = store::room(c, room_id, true).await?;
    let Some(m) = store::latest_match(c, room_id, true)
        .await?
        .filter(|m| m.status == "playing")
    else {
        return Ok(effect);
    };
    sqlx::query("UPDATE multi_relay_encounter SET status='ended',outcome='server_restart',winner_member_id=NULL,ended_by_member_id=NULL,end_idempotency_key=NULL,turn_member_id=NULL,turn_deadline=NULL,ended_at=$2 WHERE match_id=$1 AND status<>'ended'").bind(&m.id).bind(now).execute(&mut *c).await?;
    // Pre-stage relay rows remain readable during migration and are terminal too.
    sqlx::query("UPDATE multi_round SET status='ended',ended_at=$2,turn_slot=NULL,turn_deadline=NULL WHERE match_id=$1 AND status<>'ended'").bind(&m.id).bind(now).execute(&mut *c).await?;
    sqlx::query(
        "UPDATE multi_match SET status='finished',ended_at=$2,winner_member_id=NULL WHERE id=$1",
    )
    .bind(&m.id)
    .bind(now)
    .execute(&mut *c)
    .await?;
    let retention = now + state.config.multi.finished_retention;
    sqlx::query("UPDATE multi_room SET status='finished',expires_at=$2 WHERE id=$1")
        .bind(room_id)
        .bind(retention)
        .execute(&mut *c)
        .await?;
    let players = store::match_players(c, &m.id).await?;
    let relay = storage::standings(c, &m.id).await?;
    let scores:Vec<_>=players.iter().map(|p|json!({"memberId":p.member_id,"seat":p.seat,"score":if m.rule_set_key=="elimination"{p.score}else{relay.iter().find(|s|s.player.member_id==p.member_id).map(|s|s.score).unwrap_or(p.score)},"status":p.status})).collect();
    events::append_event(c,room_id,"match.ended",json!({"matchIndex":m.match_index,"memberScores":scores,"scores":{"slot1":m.score_slot1,"slot2":m.score_slot2},"reason":"server_restart","retentionEndsAt":retention}),now).await?;
    effect.game = true;
    Ok(effect)
}
