use crate::{
    error::{ApiError, room_not_found},
    repository::models::*,
};
use sqlx::PgConnection;

pub async fn room(conn: &mut PgConnection, id: &str, lock: bool) -> Result<Room, ApiError> {
    (if lock {
        sqlx::query_as!(
            Room,
            r#"
            SELECT id, code, format, status, event_seq, created_at, CASE WHEN isfinite(expires_at) THEN
            expires_at END AS expires_at, mode, turn_seconds, question_scope, player_limit, chat_seq,
            chat_rate_tokens, chat_rate_refilled_at, race_elimination_enabled FROM multi_room WHERE id=$1 FOR
            UPDATE
            "#,
            id,
        ).fetch_optional(conn).await?
    } else {
        sqlx::query_as!(
            Room,
            r#"
            SELECT id, code, format, status, event_seq, created_at, CASE WHEN isfinite(expires_at) THEN
            expires_at END AS expires_at, mode, turn_seconds, question_scope, player_limit, chat_seq,
            chat_rate_tokens, chat_rate_refilled_at, race_elimination_enabled FROM multi_room WHERE id=$1
            "#,
            id,
        ).fetch_optional(conn).await?
    })
    .ok_or_else(room_not_found)
}
pub async fn room_by_code(
    conn: &mut PgConnection,
    code: &str,
    lock: bool,
) -> Result<Room, ApiError> {
    (if lock {
        sqlx::query_as!(
            Room,
            r#"
            SELECT id, code, format, status, event_seq, created_at, CASE WHEN isfinite(expires_at) THEN
            expires_at END AS expires_at, mode, turn_seconds, question_scope, player_limit, chat_seq,
            chat_rate_tokens, chat_rate_refilled_at, race_elimination_enabled FROM multi_room WHERE code=$1 FOR
            UPDATE
            "#,
            code,
        ).fetch_optional(conn).await?
    } else {
        sqlx::query_as!(
            Room,
            r#"
            SELECT id, code, format, status, event_seq, created_at, CASE WHEN isfinite(expires_at) THEN
            expires_at END AS expires_at, mode, turn_seconds, question_scope, player_limit, chat_seq,
            chat_rate_tokens, chat_rate_refilled_at, race_elimination_enabled FROM multi_room WHERE code=$1
            "#,
            code,
        ).fetch_optional(conn).await?
    })
    .ok_or_else(room_not_found)
}
pub async fn member(conn: &mut PgConnection, id: &str) -> Result<Member, ApiError> {
    Ok(sqlx::query_as!(
        Member,
        r#"
        SELECT id, room_id, seat, display_name, token_hash, status, ready, rematch_ready, grace_until,
        joined_at, role, chat_rate_tokens, chat_rate_refilled_at FROM multi_member WHERE id=$1
        "#,
        id,
    ).fetch_one(conn).await?)
}
/// Includes departed frozen-roster players, matching the original ListMembers.
pub async fn members(conn: &mut PgConnection, room_id: &str) -> Result<Vec<Member>, ApiError> {
    Ok(sqlx::query_as!(
        Member,
        r#"
        SELECT id, room_id, seat, display_name, token_hash, status, ready, rematch_ready, grace_until,
        joined_at, role, chat_rate_tokens, chat_rate_refilled_at FROM multi_member WHERE room_id=$1 AND
        role='player' ORDER BY seat, id
        "#,
        room_id,
    ).fetch_all(conn).await?)
}
pub async fn participants(conn: &mut PgConnection, room_id: &str) -> Result<Vec<Member>, ApiError> {
    Ok(sqlx::query_as!(
        Member,
        r#"
        SELECT id, room_id, seat, display_name, token_hash, status, ready, rematch_ready, grace_until,
        joined_at, role, chat_rate_tokens, chat_rate_refilled_at FROM multi_member WHERE room_id=$1 ORDER BY
        joined_at, id
        "#,
        room_id,
    ).fetch_all(conn).await?)
}
pub async fn spectator_count(conn: &mut PgConnection, room_id: &str) -> Result<i64, ApiError> {
    Ok(sqlx::query_scalar!(
        r#"
        SELECT count(*) AS "value!" FROM multi_member WHERE room_id=$1 AND role='spectator' AND
        status<>'left'
        "#,
        room_id,
    )
    .fetch_one(conn)
    .await?)
}
pub async fn relay_elimination(conn: &mut PgConnection, room_id: &str) -> Result<bool, ApiError> {
    Ok(sqlx::query_scalar!(
        r#"
        SELECT elimination_enabled FROM multi_relay_room_config WHERE room_id=$1
        "#,
        room_id,
    )
    .fetch_optional(conn)
    .await?
    .unwrap_or(false))
}
pub async fn latest_match(
    conn: &mut PgConnection,
    room_id: &str,
    lock: bool,
) -> Result<Option<Match>, ApiError> {
    Ok(if lock {
        sqlx::query_as!(
            Match,
            r#"
            SELECT id, room_id, match_index, catalog_version, target_wins, score_slot1, score_slot2, round_count,
            status, started_at, ended_at, question_scope, winner_member_id, scoring_mode, roster_size,
            max_rounds, rule_set_key, rule_set_version, rule_config_snapshot, answer_match_policy FROM
            multi_match WHERE room_id=$1 ORDER BY match_index DESC LIMIT 1 FOR UPDATE
            "#,
            room_id,
        ).fetch_optional(conn).await?
    } else {
        sqlx::query_as!(
            Match,
            r#"
            SELECT id, room_id, match_index, catalog_version, target_wins, score_slot1, score_slot2, round_count,
            status, started_at, ended_at, question_scope, winner_member_id, scoring_mode, roster_size,
            max_rounds, rule_set_key, rule_set_version, rule_config_snapshot, answer_match_policy FROM
            multi_match WHERE room_id=$1 ORDER BY match_index DESC LIMIT 1
            "#,
            room_id,
        ).fetch_optional(conn).await?
    })
}
pub async fn match_by_id(conn: &mut PgConnection, id: &str, lock: bool) -> Result<Match, ApiError> {
    Ok(if lock {
        sqlx::query_as!(
            Match,
            r#"
            SELECT id, room_id, match_index, catalog_version, target_wins, score_slot1, score_slot2, round_count,
            status, started_at, ended_at, question_scope, winner_member_id, scoring_mode, roster_size,
            max_rounds, rule_set_key, rule_set_version, rule_config_snapshot, answer_match_policy FROM
            multi_match WHERE id=$1 FOR UPDATE
            "#,
            id,
        ).fetch_one(conn).await?
    } else {
        sqlx::query_as!(
            Match,
            r#"
            SELECT id, room_id, match_index, catalog_version, target_wins, score_slot1, score_slot2, round_count,
            status, started_at, ended_at, question_scope, winner_member_id, scoring_mode, roster_size,
            max_rounds, rule_set_key, rule_set_version, rule_config_snapshot, answer_match_policy FROM
            multi_match WHERE id=$1
            "#,
            id,
        ).fetch_one(conn).await?
    })
}
pub async fn latest_round(
    conn: &mut PgConnection,
    match_id: &str,
    lock: bool,
) -> Result<Option<Round>, ApiError> {
    Ok(if lock {
        sqlx::query_as!(
            Round,
            r#"
            SELECT id, match_id, round_index, answer_id, status, winner_slot, starts_at, deadline, ended_at,
            turn_slot, turn_deadline, winner_member_id FROM multi_round WHERE match_id=$1 ORDER BY round_index
            DESC LIMIT 1 FOR UPDATE
            "#,
            match_id,
        ).fetch_optional(conn).await?
    } else {
        sqlx::query_as!(
            Round,
            r#"
            SELECT id, match_id, round_index, answer_id, status, winner_slot, starts_at, deadline, ended_at,
            turn_slot, turn_deadline, winner_member_id FROM multi_round WHERE match_id=$1 ORDER BY round_index
            DESC LIMIT 1
            "#,
            match_id,
        ).fetch_optional(conn).await?
    })
}
pub async fn round_by_id(conn: &mut PgConnection, id: &str, lock: bool) -> Result<Round, ApiError> {
    Ok(if lock {
        sqlx::query_as!(
            Round,
            r#"
            SELECT id, match_id, round_index, answer_id, status, winner_slot, starts_at, deadline, ended_at,
            turn_slot, turn_deadline, winner_member_id FROM multi_round WHERE id=$1 FOR UPDATE
            "#,
            id,
        ).fetch_one(conn).await?
    } else {
        sqlx::query_as!(
            Round,
            r#"
            SELECT id, match_id, round_index, answer_id, status, winner_slot, starts_at, deadline, ended_at,
            turn_slot, turn_deadline, winner_member_id FROM multi_round WHERE id=$1
            "#,
            id,
        ).fetch_one(conn).await?
    })
}
pub async fn match_players(
    conn: &mut PgConnection,
    match_id: &str,
) -> Result<Vec<MatchPlayer>, ApiError> {
    Ok(sqlx::query_as!(
        MatchPlayer,
        r#"
        SELECT match_id, member_id, seat, wins, status, score, best_round_score, eliminated_round FROM
        multi_match_player WHERE match_id=$1 ORDER BY seat
        "#,
        match_id,
    ).fetch_all(conn).await?)
}
pub async fn round_players(
    conn: &mut PgConnection,
    round_id: &str,
) -> Result<Vec<RoundPlayer>, ApiError> {
    Ok(sqlx::query_as!(
        RoundPlayer,
        r#"
        SELECT round_id, member_id, status, finish_rank, points_awarded, completed_at FROM multi_round_player
        WHERE round_id=$1 ORDER BY member_id
        "#,
        round_id,
    ).fetch_all(conn).await?)
}
pub async fn guesses(conn: &mut PgConnection, round_id: &str) -> Result<Vec<Guess>, ApiError> {
    Ok(sqlx::query_as!(
        Guess,
        r#"
        SELECT id, round_id, member_id, sequence, guess_id, statuses, is_correct, idempotency_key, created_at
        FROM multi_guess WHERE round_id=$1 ORDER BY member_id, sequence
        "#,
        round_id,
    ).fetch_all(conn).await?)
}
