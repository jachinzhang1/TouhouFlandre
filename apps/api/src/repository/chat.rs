use crate::error::ApiError;
use chrono::{DateTime, Utc};
use sqlx::{FromRow, PgPool};
use uuid::Uuid;
#[derive(Clone, Debug, FromRow)]
pub struct Message {
    pub id: String,
    pub room_id: String,
    pub position: i64,
    pub sender_member_id: String,
    pub sender_display_name: String,
    pub sender_role: String,
    pub sender_seat: Option<i32>,
    pub client_message_id: Uuid,
    pub kind: String,
    pub content: String,
    pub channel: String,
    pub created_at: DateTime<Utc>,
}

pub async fn min_position(
    pool: &PgPool,
    room_id: &str,
    cutoff: DateTime<Utc>,
) -> Result<i64, ApiError> {
    Ok(sqlx::query_scalar!(
        r#"
        SELECT COALESCE(min(position), 0)::bigint AS "value!" FROM multi_chat_message WHERE room_id=$1 AND
        created_at>=$2
        "#,
        room_id,
        cutoff,
    ).fetch_one(pool).await?)
}

pub async fn after_rows(
    pool: &PgPool,
    room_id: &str,
    after: i64,
    high: i64,
    cutoff: DateTime<Utc>,
) -> Result<Vec<Message>, ApiError> {
    Ok(sqlx::query_as!(
        Message,
        r#"
        SELECT id, room_id, position, sender_member_id, sender_display_name, sender_role, sender_seat,
        client_message_id, kind, content, channel, created_at FROM multi_chat_message WHERE room_id=$1 AND
        position>$2 AND position<=$3 AND created_at>=$4 ORDER BY position LIMIT 200
        "#,
        room_id,
        after,
        high,
        cutoff,
    ).fetch_all(pool).await?)
}
