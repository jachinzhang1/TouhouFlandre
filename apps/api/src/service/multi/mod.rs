//! Multiplayer transactions share one durable event stream and explicit observer projections.
pub use crate::error::room_not_found;
pub mod auth;
pub mod commands;
pub mod events;
pub mod matches;
pub use crate::repository::models;
pub mod projection;
pub mod race;
pub mod relay;
pub mod rooms;
pub mod snapshot;
pub use crate::repository::multi as store;

use crate::error::ApiError;
use axum::http::StatusCode;
pub use events::RoomEffect;
use rand::TryRng;

pub fn conflict(code: &'static str, message: &str) -> ApiError {
    ApiError::new(StatusCode::CONFLICT, code, message)
}
pub fn invalid(message: &str) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, "INVALID_REQUEST", message)
}
pub fn new_id() -> String {
    const ALPHABET: &[u8] = b"abcdefghijklmnopqrstuvwxyz0123456789";
    let mut raw = [0u8; 25];
    rand::rngs::SysRng
        .try_fill_bytes(&mut raw)
        .expect("operating system random source");
    raw.into_iter()
        .map(|b| ALPHABET[b as usize % ALPHABET.len()] as char)
        .collect()
}

pub fn ruleset_key<'a>(room: &models::Room, m: &'a models::Match) -> &'a str {
    if !m.rule_set_key.is_empty() {
        &m.rule_set_key
    } else if room.mode == "relay" && m.scoring_mode == "wins" {
        "legacy_wins"
    } else {
        &m.scoring_mode
    }
}
pub fn validate_ruleset(
    state: &crate::app::AppState,
    room: &models::Room,
    m: &models::Match,
) -> Result<(), ApiError> {
    let legacy =
        m.rule_set_key.is_empty() && m.rule_set_version == 0 && m.rule_config_snapshot.is_null();
    let complete =
        !m.rule_set_key.is_empty() && m.rule_set_version > 0 && m.rule_config_snapshot.is_object();
    if !legacy && !complete {
        return Err(ApiError::invariant("incomplete frozen ruleset"));
    }
    let key = ruleset_key(room, m);
    let version = if m.rule_set_key.is_empty() && m.rule_set_version == 0 {
        1
    } else {
        m.rule_set_version
    };
    validate_mode(state, &room.mode)?;
    let known = match room.mode.as_str() {
        "race" => ["wins", "points", "placement"].contains(&key),
        "relay" => ["legacy_wins", "fixed_points", "elimination"].contains(&key),
        _ => false,
    };
    if !known || version != 1 {
        return Err(ApiError::invariant("unsupported frozen ruleset"));
    }
    Ok(())
}

/// Persisted unsupported modes are an operational error, never a guessed ruleset.
pub fn validate_mode(state: &crate::app::AppState, mode: &str) -> Result<(), ApiError> {
    let profile = &state.config.multi.mode_registry;
    if (mode == "race" && profile != "relay-only") || (mode == "relay" && profile != "race-only") {
        Ok(())
    } else {
        Err(ApiError::invariant("room mode mismatch"))
    }
}
