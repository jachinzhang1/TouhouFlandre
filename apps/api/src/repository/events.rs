use crate::{error::ApiError, repository::models::RoomEvent};
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgConnection;
/// Allocate durable sequence and persist canonical payload inside the caller's transaction.
pub async fn append_event(
    conn: &mut PgConnection,
    room_id: &str,
    event_type: &str,
    payload: Value,
    now: DateTime<Utc>,
) -> Result<RoomEvent, ApiError> {
    let event = sqlx::query_as!(
        RoomEvent,
        r#"
        WITH seq AS (UPDATE multi_room SET event_seq=event_seq+1 WHERE id=$1 RETURNING event_seq) INSERT INTO
        room_event(room_id, sequence, type, payload, occurred_at) SELECT $1, event_seq, $2, $3, $4 FROM seq
        RETURNING id, room_id, sequence, type AS event_type, payload, occurred_at
        "#,
        room_id,
        event_type,
        payload,
        now,
    ).fetch_one(conn).await?;
    crate::metrics::METRICS.event(event_type);
    Ok(event)
}
