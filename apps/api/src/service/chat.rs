//! Durable chat uses its own cursor, independent of gameplay sequence numbers.
pub use crate::domain::chat as rules;
pub use crate::repository::chat::{Message, after_rows, min_position};
use crate::{
    app::AppState,
    contracts::{self, SendChatMessageRequest},
};
use crate::{
    error::ApiError,
    realtime::{
        cursor::{ChatCursorCodec, Direction},
        protocol::chat_history_unavailable,
    },
};
use crate::{
    repository::{
        models::{Member, Room},
        multi as store,
    },
    service::multi::{self, auth},
};
use axum::http::StatusCode;

use chrono::{DateTime, Utc};
use serde::Deserialize;
use serde_json::{Value, json};
use sqlx::PgConnection;
use uuid::Uuid;

pub fn codec(state: &AppState) -> ChatCursorCodec {
    ChatCursorCodec::new(&state.config.multi.chat_cursor_secret)
}
pub fn cursor(codec: &ChatCursorCodec, room: &Room, position: i64, direction: Direction) -> String {
    codec.encode(
        &room.id,
        room.created_at.timestamp_micros(),
        position,
        direction,
    )
}
pub fn project(message: &Message, room: &Room, codec: &ChatCursorCodec) -> Value {
    let mut value = json!({"messageId":message.id,"roomId":message.room_id,"senderMemberId":message.sender_member_id,
        "senderDisplayName":message.sender_display_name,"senderRole":message.sender_role,"kind":message.kind,
        "content":message.content,"channel":message.channel,"cursor":cursor(codec,room,message.position,Direction::After),
        "createdAt":message.created_at.to_rfc3339_opts(chrono::SecondsFormat::AutoSi,true)});
    if let Some(seat) = message.sender_seat {
        value["senderSeat"] = json!(seat);
    }
    value
}
pub fn validate_room(room: &Room, now: DateTime<Utc>) -> Result<(), ApiError> {
    if room.status == "playing" {
        return Ok(());
    }
    if room.expires_at.is_some_and(|end| end <= now) {
        return Err(multi::room_not_found());
    }
    match room.status.as_str() {
        "lobby" | "finished" => Ok(()),
        "closed" => Err(multi::conflict("ROOM_CLOSED", "房间已关闭。")),
        _ => Err(multi::room_not_found()),
    }
}
fn unauthorized() -> ApiError {
    ApiError::new(
        StatusCode::UNAUTHORIZED,
        "GUEST_UNAUTHORIZED",
        "成员身份已失效。",
    )
}
fn cursor_invalid() -> ApiError {
    ApiError::new(
        StatusCode::BAD_REQUEST,
        "CHAT_CURSOR_INVALID",
        "聊天 cursor 无效。",
    )
}
fn forbidden() -> ApiError {
    ApiError::new(
        StatusCode::FORBIDDEN,
        "CHAT_SEND_FORBIDDEN",
        "当前成员不可发送聊天消息。",
    )
}

pub async fn send(
    state: AppState,
    room_id: String,
    authorization: &str,
    body: Result<Value, ApiError>,
) -> Result<ChatOutcome, ApiError> {
    let member = auth::authenticate(&state, authorization, &room_id, true).await?;
    if !state.config.multi.chat_send_enabled {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "CHAT_SEND_FORBIDDEN",
            "聊天发送仍在灰度中，当前暂未开放。",
        ));
    }
    let raw = body?;
    let input: SendChatMessageRequest =
        contracts::decode(raw).map_err(|_| multi::invalid("聊天消息格式不合法。"))?;
    let (client_id, content) =
        rules::normalize(&input.client_message_id, &input.kind, &input.content).ok_or_else(
            || {
                ApiError::new(
                    StatusCode::BAD_REQUEST,
                    "CHAT_MESSAGE_INVALID",
                    "聊天消息格式不合法。",
                )
            },
        )?;
    let mut tx = state.pool.begin().await?;
    let room = store::room(&mut tx, &room_id, true).await?;
    let now = (state.clock)();
    validate_room(&room, now)?;
    let current: Member = sqlx::query_as("SELECT * FROM multi_member WHERE id=$1 FOR UPDATE")
        .bind(&member.id)
        .fetch_optional(&mut *tx)
        .await?
        .ok_or_else(unauthorized)?;
    if current.room_id != room_id {
        return Err(unauthorized());
    }
    if current.status != "connected" {
        return Err(forbidden());
    }
    let channel = rules::channel(&current.role).ok_or_else(forbidden)?;
    if let Some(existing) = sqlx::query_as::<_,Message>("SELECT * FROM multi_chat_message WHERE room_id=$1 AND sender_member_id=$2 AND client_message_id=$3")
        .bind(&room_id).bind(&current.id).bind(client_id).fetch_optional(&mut *tx).await? {
        if existing.kind != input.kind || existing.content != content { return Err(multi::conflict("CHAT_IDEMPOTENCY_CONFLICT","该幂等键已用于另一条消息。")); }
        return Ok(ChatOutcome::Data(project(&existing,&room,&codec(&state))));
    }
    let config = &state.config.multi;
    let member_tokens = rules::refill(
        current.chat_rate_tokens,
        current.chat_rate_refilled_at,
        config.chat_member_capacity,
        config.chat_member_refill,
        now,
    );
    let room_tokens = rules::refill(
        room.chat_rate_tokens,
        room.chat_rate_refilled_at,
        config.chat_room_capacity,
        config.chat_room_refill,
        now,
    );
    let wait = rules::wait_millis(member_tokens, config.chat_member_refill)
        .max(rules::wait_millis(room_tokens, config.chat_room_refill));
    if wait > 0 {
        return Ok(ChatOutcome::RateLimited(wait));
    }
    let position: i64 = sqlx::query_scalar("UPDATE multi_room SET chat_seq=chat_seq+1,chat_rate_tokens=$2,chat_rate_refilled_at=$3 WHERE id=$1 RETURNING chat_seq")
        .bind(&room_id).bind(room_tokens-1.0).bind(now).fetch_one(&mut *tx).await?;
    sqlx::query("UPDATE multi_member SET chat_rate_tokens=$2,chat_rate_refilled_at=$3 WHERE id=$1")
        .bind(&current.id)
        .bind(member_tokens - 1.0)
        .bind(now)
        .execute(&mut *tx)
        .await?;
    let message: Message = sqlx::query_as("INSERT INTO multi_chat_message(id,room_id,position,sender_member_id,sender_display_name,sender_role,sender_seat,client_message_id,kind,content,channel,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING *")
        .bind(multi::new_id()).bind(&room_id).bind(position).bind(&current.id).bind(&current.display_name).bind(&current.role).bind(current.seat).bind(client_id).bind(input.kind).bind(content).bind(channel).bind(now).fetch_one(&mut *tx).await?;
    tx.commit().await?;
    state.realtime.notify_chat(&room_id);
    Ok(ChatOutcome::Data(project(&message, &room, &codec(&state))))
}

#[derive(Default, Deserialize)]
pub struct HistoryQuery {
    after: Option<String>,
    before: Option<String>,
    limit: Option<usize>,
}
pub async fn list(
    state: AppState,
    room_id: String,
    authorization: &str,
    query: Result<HistoryQuery, ApiError>,
) -> Result<ChatOutcome, ApiError> {
    let member = auth::authenticate(&state, authorization, &room_id, true).await?;
    let query = query?;
    let limit = query.limit.unwrap_or(50);
    if !(1..=100).contains(&limit) || (query.after.is_some() && query.before.is_some()) {
        return Err(multi::invalid("聊天历史查询参数不合法。"));
    }
    let mut connection = state.pool.acquire().await?;
    let room = store::room(&mut connection, &room_id, false).await?;
    let now = (state.clock)();
    validate_room(&room, now)?;
    let current = store::member(&mut connection, &member.id).await?;
    if current.room_id != room_id
        || (current.status == "left" && room.status != "finished")
        || rules::channel(&current.role).is_none()
    {
        return Err(unauthorized());
    }
    drop(connection);
    let cutoff = now - state.config.multi.chat_retention;
    let oldest = min_position(&state.pool, &room_id, cutoff).await?;
    let codec = codec(&state);
    let mut response;
    if let Some(after) = query.after {
        let position = codec
            .decode(
                &after,
                &room_id,
                room.created_at.timestamp_micros(),
                Direction::After,
            )
            .map_err(|_| cursor_invalid())?;
        if position > room.chat_seq {
            return Err(multi::conflict(
                "CHAT_CURSOR_AHEAD",
                "聊天 cursor 超过服务端水位。",
            ));
        }
        if chat_history_unavailable(position, room.chat_seq, oldest) {
            return Ok(ChatOutcome::ResyncRequired(resync(&room, oldest, &codec)));
        }
        let rows = after_rows(&state.pool, &room_id, position, room.chat_seq, cutoff).await?;
        let mut messages = Vec::new();
        let mut scanned = position;
        for row in rows {
            scanned = row.position;
            if rules::can_view(&current.role, &row.channel) {
                messages.push(project(&row, &room, &codec));
                if messages.len() == limit {
                    break;
                }
            }
        }
        response = json!({"messages":messages,"hasMore":scanned<room.chat_seq,"scannedCursor":cursor(&codec,&room,scanned,Direction::After)});
    } else {
        let position = if let Some(before) = &query.before {
            let position = codec
                .decode(
                    before,
                    &room_id,
                    room.created_at.timestamp_micros(),
                    Direction::Before,
                )
                .map_err(|_| cursor_invalid())?;
            if position > room.chat_seq.saturating_add(1) {
                return Err(cursor_invalid());
            }
            if oldest > 0 && position < oldest {
                return Ok(ChatOutcome::ResyncRequired(resync(&room, oldest, &codec)));
            }
            position
        } else {
            room.chat_seq.saturating_add(1)
        };
        let rows: Vec<Message> = sqlx::query_as("SELECT * FROM multi_chat_message WHERE room_id=$1 AND position<$2 AND created_at>=$3 ORDER BY position DESC LIMIT 200")
            .bind(&room_id).bind(position).bind(cutoff).fetch_all(&state.pool).await?;
        let mut messages = Vec::new();
        let mut scanned = 0;
        for row in rows {
            scanned = row.position;
            if rules::can_view(&current.role, &row.channel) {
                messages.push(project(&row, &room, &codec));
                if messages.len() == limit {
                    break;
                }
            }
        }
        messages.reverse();
        let more = scanned > 0 && oldest > 0 && scanned > oldest;
        response = json!({"messages":messages,"hasMore":more});
        if more {
            response["beforeCursor"] = json!(cursor(&codec, &room, scanned, Direction::Before));
        }
        if query.before.is_none() {
            response["scannedCursor"] =
                json!(cursor(&codec, &room, room.chat_seq, Direction::After));
        }
    }
    Ok(ChatOutcome::Data(response))
}

fn resync(room: &Room, oldest: i64, codec: &ChatCursorCodec) -> Value {
    json!({"code":"CHAT_RESYNC_REQUIRED","error":"聊天历史已超出保留范围，请重新同步。",
        "oldestAvailableCursor":cursor(codec,room,if oldest>0 {oldest-1} else {room.chat_seq},Direction::After),
        "highWatermarkCursor":cursor(codec,room,room.chat_seq,Direction::After)})
}

/// Call within the gameplay transaction; the trigger UUID is compatible with Go.
pub async fn append_system(
    conn: &mut PgConnection,
    enabled: bool,
    room_id: &str,
    roster_size: i32,
    trigger: &str,
    content: &str,
    now: DateTime<Utc>,
) -> Result<bool, ApiError> {
    if !enabled || roster_size < 2 {
        return Ok(false);
    }
    if room_id.is_empty() || trigger.is_empty() || content.is_empty() {
        return Err(ApiError::invariant("invalid system chat announcement"));
    }
    sqlx::query("SELECT id FROM multi_room WHERE id=$1 FOR UPDATE")
        .bind(room_id)
        .fetch_one(&mut *conn)
        .await?;
    let namespace = Uuid::from_u128(0x9a6c2eaff56a50a4a82cc5bc77fb8f4f);
    let id = Uuid::new_v5(&namespace, format!("{room_id}\0{trigger}").as_bytes());
    if let Some(existing)=sqlx::query_as::<_,Message>("SELECT * FROM multi_chat_message WHERE room_id=$1 AND sender_member_id='system' AND client_message_id=$2").bind(room_id).bind(id).fetch_optional(&mut *conn).await? {
        if existing.content!=content || existing.sender_role!="system" { return Err(ApiError::invariant("system announcement idempotency mismatch")); }
        return Ok(false);
    }
    let position: i64 = sqlx::query_scalar(
        "UPDATE multi_room SET chat_seq=chat_seq+1 WHERE id=$1 RETURNING chat_seq",
    )
    .bind(room_id)
    .fetch_one(&mut *conn)
    .await?;
    sqlx::query("INSERT INTO multi_chat_message(id,room_id,position,sender_member_id,sender_display_name,sender_role,sender_seat,client_message_id,kind,content,channel,created_at) VALUES ($1,$2,$3,'system','系统','system',NULL,$4,'text',$5,'room',$6)")
        .bind(multi::new_id()).bind(room_id).bind(position).bind(id).bind(content).bind(now).execute(conn).await?;
    Ok(true)
}

pub enum ChatOutcome {
    Data(Value),
    RateLimited(i64),
    ResyncRequired(Value),
}
