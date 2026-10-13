//! A single process publishes committed database rows; connection queues hold no authoritative state.
use crate::{
    realtime::protocol::ServerControl,
    service::multi::{self, auth},
};

use crate::{
    app::AppState,
    error::ApiError,
    realtime::{
        cursor::Direction,
        registry::{ConnectionRegistry, Registration},
    },
    repository::{
        models::{Member, Room, RoomEvent},
        multi as store,
    },
    service::{chat, multi::projection},
};

use std::{
    collections::HashMap,
    sync::{Arc, Mutex, Weak},
    time::Duration,
};
use tokio::sync::{Mutex as AsyncMutex, Notify};
use tokio_util::{sync::CancellationToken, task::TaskTracker};

type Key = (String, String);
#[derive(Default)]
pub struct RealtimeHub {
    pub registry: ConnectionRegistry,
    pub tracker: TaskTracker,
    pub shutdown: CancellationToken,
    wake: Notify,
    pending: Mutex<HashMap<String, (bool, bool)>>,
    viewers: Mutex<HashMap<Key, (u64, Member)>>,
    sessions: Mutex<HashMap<Key, Weak<AsyncMutex<()>>>>,
}

impl RealtimeHub {
    pub fn invalidate_member(&self, room_id: &str, member_id: &str) {
        self.registry.invalidate_member(room_id, member_id);
    }
    pub fn notify_game(&self, room_id: &str) {
        self.pending
            .lock()
            .expect("realtime notifications poisoned")
            .entry(room_id.to_owned())
            .or_default()
            .0 = true;
        self.wake.notify_one();
    }
    pub fn notify_chat(&self, room_id: &str) {
        self.pending
            .lock()
            .expect("realtime notifications poisoned")
            .entry(room_id.to_owned())
            .or_default()
            .1 = true;
        self.wake.notify_one();
    }
    pub fn session_lock(&self, room_id: &str, member_id: &str) -> Arc<AsyncMutex<()>> {
        let mut sessions = self.sessions.lock().expect("session locks poisoned");
        sessions.retain(|_, weak| weak.strong_count() > 0);
        let weak = sessions
            .entry((room_id.to_owned(), member_id.to_owned()))
            .or_default();
        if let Some(lock) = weak.upgrade() {
            lock
        } else {
            let lock = Arc::new(AsyncMutex::new(()));
            *weak = Arc::downgrade(&lock);
            lock
        }
    }
    pub(crate) fn track(&self, registration: &Registration, member: Member) {
        self.viewers.lock().expect("viewers poisoned").insert(
            (registration.room_id.clone(), registration.member_id.clone()),
            (registration.generation, member),
        );
    }
    pub(crate) fn untrack(&self, registration: &Registration) {
        let mut viewers = self.viewers.lock().expect("viewers poisoned");
        let key = (registration.room_id.clone(), registration.member_id.clone());
        if viewers
            .get(&key)
            .is_some_and(|(generation, _)| *generation == registration.generation)
        {
            viewers.remove(&key);
        }
    }
    fn viewer(&self, registration: &Registration) -> Option<Member> {
        self.viewers
            .lock()
            .expect("viewers poisoned")
            .get(&(registration.room_id.clone(), registration.member_id.clone()))
            .filter(|(generation, _)| *generation == registration.generation)
            .map(|(_, member)| member.clone())
    }
    pub fn connection_count(&self) -> usize {
        self.viewers.lock().expect("viewers poisoned").len()
    }
}

pub fn start(state: AppState) {
    let tracker = state.realtime.tracker.clone();
    tracker.spawn(async move {
        let mut retry=tokio::time::interval(Duration::from_secs(1));
        loop {
            tokio::select! { _=state.realtime.shutdown.cancelled()=>break, _=state.realtime.wake.notified()=>{}, _=retry.tick()=>{} }
            let pending=std::mem::take(&mut *state.realtime.pending.lock().expect("realtime notifications poisoned"));
            for (room,(game,chat)) in pending {
                if game && !publication_succeeded(tokio::time::timeout(Duration::from_secs(5),publish_game(&state,&room)).await, "websocket_publish_game") { state.realtime.pending.lock().expect("realtime notifications poisoned").entry(room.clone()).or_default().0=true; }
                if chat && !publication_succeeded(tokio::time::timeout(Duration::from_secs(5),publish_chat(&state,&room)).await, "websocket_publish_chat") { state.realtime.pending.lock().expect("realtime notifications poisoned").entry(room).or_default().1=true; }
            }
        }
    });
}

fn publication_succeeded(
    result: Result<Result<(), ApiError>, tokio::time::error::Elapsed>,
    operation: &'static str,
) -> bool {
    match result {
        Ok(Ok(())) => true,
        Ok(Err(error)) => {
            error.report(operation);
            false
        }
        Err(error) => {
            ApiError::from(error).report(operation);
            false
        }
    }
}

async fn current_viewer(
    state: &AppState,
    registration: &Registration,
) -> Result<Option<Member>, ApiError> {
    let Some(frozen) = state.realtime.viewer(registration) else {
        return Ok(None);
    };
    let current = sqlx::query_as::<_, Member>("SELECT * FROM multi_member WHERE id=$1")
        .bind(&registration.member_id)
        .fetch_optional(&state.pool)
        .await?;
    if current.as_ref().is_none_or(|current| {
        current.role != frozen.role
            || current.seat != frozen.seat
            || current.room_id != registration.room_id
    }) {
        registration
            .output
            .replace(crate::realtime::protocol::ReplacementReason::MemberChanged);
        return Ok(None);
    }
    Ok(current)
}

pub async fn event_rows(
    state: &AppState,
    room_id: &str,
    after: i64,
    high: i64,
) -> Result<Vec<RoomEvent>, ApiError> {
    Ok(sqlx::query_as("SELECT * FROM room_event WHERE room_id=$1 AND sequence>$2 AND sequence<=$3 ORDER BY sequence")
        .bind(room_id).bind(after).bind(high).fetch_all(&state.pool).await?)
}

async fn publish_game(state: &AppState, room_id: &str) -> Result<(), ApiError> {
    let connections = state.realtime.registry.room_connections(room_id);
    for registration in connections {
        if !registration.output.is_alive() {
            continue;
        }
        let Some(viewer) = current_viewer(state, &registration).await? else {
            continue;
        };
        let after = registration.output.watermarks().game_sequence;
        let high = sqlx::query_scalar::<_, i64>("SELECT event_seq FROM multi_room WHERE id=$1")
            .bind(room_id)
            .fetch_optional(&state.pool)
            .await?;
        let Some(high) = high else {
            registration.output.request_close(None, "room_missing");
            continue;
        };
        for event in event_rows(state, room_id, after, high).await? {
            let frame = projection::project_event(state, &event, &viewer).await?;
            if let Err(error) = registration
                .output
                .publish_game(event.sequence, frame.to_string().into())
            {
                registration
                    .output
                    .request_close(None, "game_publish_failed");
                ApiError::from(error).report("websocket_game_output");
                break;
            }
        }
    }
    Ok(())
}
fn chat_frame(message: &chat::Message, room: &Room, state: &AppState) -> Arc<str> {
    let mut frame = chat::project(message, room, &chat::codec(state));
    frame["type"] = serde_json::json!("chat.message");
    frame.to_string().into()
}
async fn publish_chat(state: &AppState, room_id: &str) -> Result<(), ApiError> {
    let connections = state.realtime.registry.room_connections(room_id);
    if connections.is_empty() {
        return Ok(());
    }
    let mut conn = state.pool.acquire().await?;
    let room = store::room(&mut conn, room_id, false).await?;
    drop(conn);
    for registration in connections {
        if !registration.output.is_alive() {
            continue;
        }
        let Some(mut after) = registration.output.watermarks().chat_position else {
            continue;
        };
        let Some(viewer) = current_viewer(state, &registration).await? else {
            continue;
        };
        while after < room.chat_seq && registration.output.is_alive() {
            let rows = chat::after_rows(
                &state.pool,
                room_id,
                after,
                room.chat_seq,
                (state.clock)() - state.config.multi.chat_retention,
            )
            .await?;
            if rows.is_empty() {
                registration
                    .output
                    .request_close(None, "chat_history_unavailable");
                break;
            }
            for row in rows {
                after = row.position;
                let frame = chat::rules::can_view(&viewer.role, &row.channel)
                    .then(|| chat_frame(&row, &room, state));
                if let Err(error) = registration.output.publish_chat(row.position, frame) {
                    registration
                        .output
                        .request_close(None, "chat_publish_failed");
                    ApiError::from(error).report("websocket_chat_output");
                    break;
                }
            }
        }
    }
    Ok(())
}

pub async fn shutdown(state: &AppState) {
    state.realtime.registry.close_all_for_restart();
    state.realtime.shutdown.cancel();
    state.realtime.tracker.close();
    state.realtime.tracker.wait().await;
}

pub async fn replay(
    state: &AppState,
    registration: &Registration,
    member: &Member,
) -> Result<(), ApiError> {
    let mut conn = state.pool.acquire().await?;
    let room = store::room(&mut conn, &registration.room_id, false).await?;
    drop(conn);
    let output = &registration.output;
    let watermarks = output.watermarks();
    let codec = chat::codec(state);
    output.send_control(ServerControl::HelloOk {
        room_id: room.id.clone(),
        target_game_sequence: room.event_seq,
        target_chat_cursor: watermarks
            .chat_position
            .map(|_| chat::cursor(&codec, &room, room.chat_seq, Direction::After)),
    })?;
    state.realtime.notify_game(&room.id);
    if watermarks.chat_position.is_some() {
        state.realtime.notify_chat(&room.id);
    }
    for event in event_rows(state, &room.id, watermarks.game_sequence, room.event_seq).await? {
        let frame = projection::project_event(state, &event, member).await?;
        output.replay_game(event.sequence, frame.to_string().into())?;
    }
    if output.watermarks().game_sequence != room.event_seq {
        return Err(ApiError::invariant("game replay sequence gap"));
    }
    if let Some(mut position) = watermarks.chat_position {
        let Some(viewer) = current_viewer(state, registration).await? else {
            return Err(ApiError::invariant("chat replay viewer unavailable"));
        };
        while position < room.chat_seq {
            let rows = chat::after_rows(
                &state.pool,
                &room.id,
                position,
                room.chat_seq,
                (state.clock)() - state.config.multi.chat_retention,
            )
            .await?;
            if rows.is_empty() {
                return Err(ApiError::invariant("chat replay history unavailable"));
            }
            for row in rows {
                position = row.position;
                let frame = chat::rules::can_view(&viewer.role, &row.channel)
                    .then(|| chat_frame(&row, &room, state));
                output.replay_chat(position, frame).await?;
            }
        }
    }
    output.finish_sync(|position| chat::cursor(&codec, &room, position, Direction::After))?;
    Ok(())
}

pub async fn mark_connection(
    state: &AppState,
    member: &Member,
    connected: bool,
) -> Result<Member, ApiError> {
    let mut tx = state.pool.begin().await?;
    let room = store::room(&mut tx, &member.room_id, true).await?;
    let current = store::member(&mut tx, &member.id).await?;
    if current.status == "left" {
        return Err(auth::unauthorized("成员已离开。"));
    }
    let status = if connected {
        "connected"
    } else {
        "disconnected"
    };
    let grace = (!connected).then(|| (state.clock)() + state.config.multi.disconnect_grace);
    let updated: Member =
        sqlx::query_as("UPDATE multi_member SET status=$2,grace_until=$3 WHERE id=$1 RETURNING *")
            .bind(&member.id)
            .bind(status)
            .bind(grace)
            .fetch_one(&mut *tx)
            .await?;
    multi::rooms::append_updated(&mut tx, &room, (state.clock)()).await?;
    tx.commit().await?;
    state.realtime.notify_game(&room.id);
    Ok(updated)
}

pub async fn room(state: &AppState, room_id: &str) -> Result<Room, ApiError> {
    store::room(&mut *state.pool.acquire().await?, room_id, false).await
}
pub async fn authenticate(state: &AppState, token: &str) -> Result<Member, ApiError> {
    auth::authenticate_token(&state.pool, token, false).await
}
pub async fn oldest_chat(state: &AppState, room_id: &str) -> Result<i64, ApiError> {
    chat::min_position(
        &state.pool,
        room_id,
        (state.clock)() - state.config.multi.chat_retention,
    )
    .await
}
pub async fn min_game_sequence(state: &AppState, room_id: &str) -> Result<i64, ApiError> {
    Ok(sqlx::query_scalar(
        "SELECT coalesce(min(sequence),0)::bigint FROM room_event WHERE room_id=$1",
    )
    .bind(room_id)
    .fetch_one(&state.pool)
    .await?)
}
