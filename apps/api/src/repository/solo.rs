use crate::error::ApiError;
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::PgConnection;
#[derive(Debug, Clone, sqlx::FromRow)]
pub struct StoredSession {
    pub id: String,
    pub mode: String,
    pub content_type: String,
    pub answer_id: String,
    pub catalog_version: String,
    pub puzzle_key: Option<String>,
    pub status: String,
    pub max_guesses: i32,
    pub guesses: Value,
    pub version: i32,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub question_scope: Option<Value>,
    pub answer_match_policy: String,
}
#[derive(sqlx::FromRow)]
pub struct ResolveRecord {
    pub request_fingerprint: String,
    pub session_id: Option<String>,
    pub resolution: Option<String>,
    pub superseded_session_id: Option<String>,
    pub expired: bool,
}
pub async fn load_session(
    connection: &mut PgConnection,
    id: &str,
    lock: bool,
) -> Result<Option<StoredSession>, ApiError> {
    Ok(if lock {
        sqlx::query_as!(
            StoredSession,
            r#"
            SELECT id, mode, content_type, answer_id, catalog_version, puzzle_key, status, max_guesses, guesses,
            version, started_at, ended_at, question_scope, answer_match_policy FROM game_session WHERE id=$1 FOR
            UPDATE
            "#,
            id,
        ).fetch_optional(connection).await?
    } else {
        sqlx::query_as!(
            StoredSession,
            r#"
            SELECT id, mode, content_type, answer_id, catalog_version, puzzle_key, status, max_guesses, guesses,
            version, started_at, ended_at, question_scope, answer_match_policy FROM game_session WHERE id=$1
            "#,
            id,
        ).fetch_optional(connection).await?
    })
}

pub async fn read_record(
    connection: &mut PgConnection,
    key: &str,
    now: DateTime<Utc>,
) -> Result<ResolveRecord, ApiError> {
    // PostgreSQL infinity stays in SQL; chrono never attempts to decode it.
    Ok(sqlx::query_as!(
        ResolveRecord,
        r#"
        SELECT request_fingerprint, session_id, resolution, superseded_session_id, (expires_at <= $2) AS
        "expired!" FROM puzzle_resolve_idempotency WHERE idempotency_key=$1 FOR UPDATE
        "#,
        key,
        now,
    ).fetch_one(connection).await?)
}
