use crate::{
    error::{ApiError, room_not_found},
    repository::models::*,
};
use sqlx::{AssertSqlSafe, PgConnection};

pub const ROOM_COLUMNS: &str = "id, code, format, status, event_seq, created_at, CASE WHEN isfinite(expires_at) THEN expires_at END AS expires_at, mode, turn_seconds, question_scope, player_limit, chat_seq, chat_rate_tokens, chat_rate_refilled_at, race_elimination_enabled";

pub async fn room(conn: &mut PgConnection, id: &str, lock: bool) -> Result<Room, ApiError> {
    sqlx::query_as(AssertSqlSafe(format!(
        "SELECT {ROOM_COLUMNS} FROM multi_room WHERE id=$1{}",
        if lock { " FOR UPDATE" } else { "" }
    )))
    .bind(id)
    .fetch_optional(conn)
    .await?
    .ok_or_else(room_not_found)
}
pub async fn room_by_code(
    conn: &mut PgConnection,
    code: &str,
    lock: bool,
) -> Result<Room, ApiError> {
    sqlx::query_as(AssertSqlSafe(format!(
        "SELECT {ROOM_COLUMNS} FROM multi_room WHERE code=$1{}",
        if lock { " FOR UPDATE" } else { "" }
    )))
    .bind(code)
    .fetch_optional(conn)
    .await?
    .ok_or_else(room_not_found)
}
pub async fn member(conn: &mut PgConnection, id: &str) -> Result<Member, ApiError> {
    Ok(sqlx::query_as("SELECT * FROM multi_member WHERE id=$1")
        .bind(id)
        .fetch_one(conn)
        .await?)
}
/// Includes departed frozen-roster players, matching the original ListMembers.
pub async fn members(conn: &mut PgConnection, room_id: &str) -> Result<Vec<Member>, ApiError> {
    Ok(sqlx::query_as(
        "SELECT * FROM multi_member WHERE room_id=$1 AND role='player' ORDER BY seat,id",
    )
    .bind(room_id)
    .fetch_all(conn)
    .await?)
}
pub async fn participants(conn: &mut PgConnection, room_id: &str) -> Result<Vec<Member>, ApiError> {
    Ok(
        sqlx::query_as("SELECT * FROM multi_member WHERE room_id=$1 ORDER BY joined_at,id")
            .bind(room_id)
            .fetch_all(conn)
            .await?,
    )
}
pub async fn spectator_count(conn: &mut PgConnection, room_id: &str) -> Result<i64, ApiError> {
    Ok(sqlx::query_scalar("SELECT count(*) FROM multi_member WHERE room_id=$1 AND role='spectator' AND status<>'left'").bind(room_id).fetch_one(conn).await?)
}
pub async fn relay_elimination(conn: &mut PgConnection, room_id: &str) -> Result<bool, ApiError> {
    Ok(sqlx::query_scalar(
        "SELECT elimination_enabled FROM multi_relay_room_config WHERE room_id=$1",
    )
    .bind(room_id)
    .fetch_optional(conn)
    .await?
    .unwrap_or(false))
}
pub async fn latest_match(
    conn: &mut PgConnection,
    room_id: &str,
    lock: bool,
) -> Result<Option<Match>, ApiError> {
    Ok(sqlx::query_as(AssertSqlSafe(format!(
        "SELECT * FROM multi_match WHERE room_id=$1 ORDER BY match_index DESC LIMIT 1{}",
        if lock { " FOR UPDATE" } else { "" }
    )))
    .bind(room_id)
    .fetch_optional(conn)
    .await?)
}
pub async fn match_by_id(conn: &mut PgConnection, id: &str, lock: bool) -> Result<Match, ApiError> {
    Ok(sqlx::query_as(AssertSqlSafe(format!(
        "SELECT * FROM multi_match WHERE id=$1{}",
        if lock { " FOR UPDATE" } else { "" }
    )))
    .bind(id)
    .fetch_one(conn)
    .await?)
}
pub async fn latest_round(
    conn: &mut PgConnection,
    match_id: &str,
    lock: bool,
) -> Result<Option<Round>, ApiError> {
    Ok(sqlx::query_as(AssertSqlSafe(format!(
        "SELECT * FROM multi_round WHERE match_id=$1 ORDER BY round_index DESC LIMIT 1{}",
        if lock { " FOR UPDATE" } else { "" }
    )))
    .bind(match_id)
    .fetch_optional(conn)
    .await?)
}
pub async fn round_by_id(conn: &mut PgConnection, id: &str, lock: bool) -> Result<Round, ApiError> {
    Ok(sqlx::query_as(AssertSqlSafe(format!(
        "SELECT * FROM multi_round WHERE id=$1{}",
        if lock { " FOR UPDATE" } else { "" }
    )))
    .bind(id)
    .fetch_one(conn)
    .await?)
}
pub async fn match_players(
    conn: &mut PgConnection,
    match_id: &str,
) -> Result<Vec<MatchPlayer>, ApiError> {
    Ok(
        sqlx::query_as("SELECT * FROM multi_match_player WHERE match_id=$1 ORDER BY seat")
            .bind(match_id)
            .fetch_all(conn)
            .await?,
    )
}
pub async fn round_players(
    conn: &mut PgConnection,
    round_id: &str,
) -> Result<Vec<RoundPlayer>, ApiError> {
    Ok(
        sqlx::query_as("SELECT * FROM multi_round_player WHERE round_id=$1 ORDER BY member_id")
            .bind(round_id)
            .fetch_all(conn)
            .await?,
    )
}
pub async fn guesses(conn: &mut PgConnection, round_id: &str) -> Result<Vec<Guess>, ApiError> {
    Ok(
        sqlx::query_as("SELECT * FROM multi_guess WHERE round_id=$1 ORDER BY member_id,sequence")
            .bind(round_id)
            .fetch_all(conn)
            .await?,
    )
}
