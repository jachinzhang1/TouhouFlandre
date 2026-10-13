//! One scheduler drives deadlines and retention; gameplay modules own settlement.
use crate::{
    app::AppState,
    error::ApiError,
    repository::{
        models::{Match, Member},
        multi as store,
    },
    service::multi::{self, events, race, relay, rooms},
};
use std::{collections::BTreeMap, time::Duration};
use tokio_util::sync::CancellationToken;

pub fn start(state: AppState, stop: CancellationToken) -> tokio::task::JoinHandle<()> {
    tokio::spawn(async move {
        let mut ticks = tokio::time::interval(Duration::from_secs(1));
        ticks.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
        loop {
            tokio::select! {
                _ = stop.cancelled() => break,
                _ = ticks.tick() => {
                    // sweep_once reports each failed step and retains the first
                    // cause for callers. The next tick retries independently.
                    let _ = sweep_once(&state).await;
                }
            }
        }
    })
}

pub async fn terminate_active(state: &AppState) -> Result<(), ApiError> {
    // Validate every frozen ruleset before changing any match during recovery.
    let active: Vec<Match> =
        sqlx::query_as("SELECT * FROM multi_match WHERE status='playing' ORDER BY id")
            .fetch_all(&state.pool)
            .await?;
    let mut connection = state.pool.acquire().await?;
    for game in &active {
        let room = store::room(&mut connection, &game.room_id, false).await?;
        multi::validate_ruleset(state, &room, game)?;
    }
    drop(connection);
    let matches:Vec<Match>=sqlx::query_as("SELECT m.* FROM multi_match m JOIN multi_room r ON r.id=m.room_id WHERE m.status='playing' AND r.mode='race' ORDER BY m.id").fetch_all(&state.pool).await?;
    for m in matches {
        let mut tx = state.pool.begin().await?;
        let round = store::latest_round(&mut tx, &m.id, true).await?;
        let locked = store::match_by_id(&mut tx, &m.id, true).await?;
        if locked.status != "playing" {
            tx.commit().await?;
            continue;
        }
        let room = store::room(&mut tx, &m.room_id, true).await?;
        let effect = race::terminate_match_tx(
            state,
            &mut tx,
            &room,
            &locked,
            round.as_ref(),
            "server_restart",
            (state.clock)(),
        )
        .await?;
        tx.commit().await?;
        events::publish(state, &effect);
    }
    for effect in relay::recover(state, 100).await? {
        events::publish(state, &effect);
    }
    Ok(())
}

pub async fn sweep_once(state: &AppState) -> Result<(), ApiError> {
    // Complete all independent steps even if one room has invalid persisted data.
    let mut failure = None;
    match relay::sweep(state, 100).await {
        Ok(effects) => {
            for effect in effects {
                events::publish(state, &effect)
            }
        }
        Err(error) => record_failure(&mut failure, error, "sweep_relay"),
    }
    match sqlx::query_scalar::<_,String>("SELECT DISTINCT r.id FROM multi_room r JOIN multi_match m ON m.room_id=r.id WHERE r.mode='race' AND m.status='playing'").fetch_all(&state.pool).await {
        Ok(ids) => for id in ids {
            match race::sweep_room(state, &id).await {
                Ok(effect) => events::publish(state, &effect),
                Err(error) => record_failure(&mut failure, error, "sweep_race_room"),
            }
        },
        Err(error) => record_failure(&mut failure, error.into(), "sweep_race_list"),
    }
    if let Err(error) = expire_members(state).await {
        record_failure(&mut failure, error, "expire_members");
    }
    if let Err(error) = expire_rooms(state).await {
        record_failure(&mut failure, error, "expire_rooms");
    }
    if let Err(error) = sqlx::query("DELETE FROM multi_chat_message WHERE created_at<$1")
        .bind((state.clock)() - state.config.multi.chat_retention)
        .execute(&state.pool)
        .await
    {
        record_failure(&mut failure, error.into(), "prune_chat");
    }
    if let Err(error) =
        sqlx::query("DELETE FROM multi_room WHERE status='closed' AND expires_at<$1")
            .bind((state.clock)())
            .execute(&state.pool)
            .await
    {
        record_failure(&mut failure, error.into(), "prune_rooms");
    }
    failure.map_or(Ok(()), Err)
}
fn record_failure(first: &mut Option<ApiError>, error: ApiError, operation: &'static str) {
    error.report(operation);
    if first.is_none() {
        *first = Some(error);
    }
}
async fn expire_rooms(state: &AppState) -> Result<(), ApiError> {
    let now = (state.clock)();
    let ids:Vec<String>=sqlx::query_scalar("SELECT id FROM multi_room WHERE status IN ('lobby','finished') AND expires_at<$1 ORDER BY id").bind(now).fetch_all(&state.pool).await?;
    for id in ids {
        let mut tx = state.pool.begin().await?;
        let room = store::room(&mut tx, &id, true).await?;
        if !matches!(room.status.as_str(), "lobby" | "finished")
            || room.expires_at.is_none_or(|time| time >= now)
        {
            tx.commit().await?;
            continue;
        }
        let reason = if room.status == "lobby" {
            "ttl"
        } else {
            "retention"
        };
        close_room(state, &mut tx, &id, reason).await?;
        tx.commit().await?;
        state.realtime.notify_game(&id);
    }
    Ok(())
}
async fn close_room(
    state: &AppState,
    conn: &mut sqlx::PgConnection,
    id: &str,
    reason: &str,
) -> Result<(), ApiError> {
    let now = (state.clock)();
    sqlx::query("UPDATE multi_room SET status='closed',expires_at=$2 WHERE id=$1")
        .bind(id)
        .bind(now + state.config.multi.event_retention)
        .execute(&mut *conn)
        .await?;
    events::append_event(
        conn,
        id,
        "room.closed",
        serde_json::json!({"reason":reason}),
        now,
    )
    .await?;
    Ok(())
}
async fn expire_members(state: &AppState) -> Result<(), ApiError> {
    let now = (state.clock)();
    let members:Vec<Member>=sqlx::query_as("SELECT * FROM multi_member WHERE status='disconnected' AND grace_until<=$1 ORDER BY room_id,id").bind(now).fetch_all(&state.pool).await?;
    let mut groups: BTreeMap<String, Vec<Member>> = BTreeMap::new();
    for member in members {
        groups
            .entry(member.room_id.clone())
            .or_default()
            .push(member);
    }
    for (id, members) in groups {
        let mut conn = state.pool.acquire().await?;
        let room = store::room(&mut conn, &id, false).await?;
        drop(conn);
        let players: Vec<_> = members.iter().filter(|m| m.is_player()).cloned().collect();
        if room.status == "playing" && !players.is_empty() {
            let mut tx = state.pool.begin().await?;
            let effect = if room.mode == "race" {
                race::forfeit_members_tx(state, &mut tx, &room, &players, "disconnect", now).await?
            } else if room.mode == "relay" {
                relay::forfeit_members_tx(state, &mut tx, &room, &players, "disconnect", now)
                    .await?
            } else {
                return Err(ApiError::invariant(
                    "unknown room mode during member expiry",
                ));
            };
            tx.commit().await?;
            events::publish(state, &effect);
        }
        for member in members {
            if room.status == "playing" && member.is_player() {
                continue;
            }
            let mut tx = state.pool.begin().await?;
            let current_room = store::room(&mut tx, &id, true).await?;
            let Some(current) =
                sqlx::query_as::<_, Member>("SELECT * FROM multi_member WHERE id=$1 FOR UPDATE")
                    .bind(&member.id)
                    .fetch_optional(&mut *tx)
                    .await?
            else {
                continue;
            };
            if current.status != "disconnected"
                || current.grace_until.is_none_or(|end| end > now)
                || current_room.status == "closed"
            {
                tx.commit().await?;
                continue;
            }
            if current.is_player() && current_room.status == "playing" {
                tx.commit().await?;
                continue;
            }
            if current.is_player() && current_room.status == "lobby" && current.seat() == 1 {
                close_room(state, &mut tx, &id, "host_left").await?;
            } else {
                if current.is_player() && current_room.status == "lobby" {
                    sqlx::query("DELETE FROM multi_member WHERE id=$1")
                        .bind(&current.id)
                        .execute(&mut *tx)
                        .await?;
                } else {
                    sqlx::query(
                        "UPDATE multi_member SET status='left',grace_until=NULL WHERE id=$1",
                    )
                    .bind(&current.id)
                    .execute(&mut *tx)
                    .await?;
                }
                rooms::append_updated(&mut tx, &current_room, now).await?;
            }
            tx.commit().await?;
            state.realtime.notify_game(&id);
        }
    }
    Ok(())
}
