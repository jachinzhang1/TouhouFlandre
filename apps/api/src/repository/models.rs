//! Internal PostgreSQL rows; public responses are projected separately.
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::FromRow;

#[derive(Debug, Clone, FromRow)]
pub struct Room {
    pub id: String,
    pub code: String,
    pub format: String,
    pub status: String,
    pub event_seq: i64,
    pub created_at: DateTime<Utc>,
    /// None is PostgreSQL infinity, projected by store::ROOM_COLUMNS.
    pub expires_at: Option<DateTime<Utc>>,
    pub mode: String,
    pub turn_seconds: i32,
    pub question_scope: Value,
    pub player_limit: i32,
    pub chat_seq: i64,
    pub chat_rate_tokens: Option<f64>,
    pub chat_rate_refilled_at: Option<DateTime<Utc>>,
    pub race_elimination_enabled: bool,
}
#[derive(Debug, Clone, FromRow)]
pub struct Member {
    pub id: String,
    pub room_id: String,
    pub seat: Option<i32>,
    pub display_name: String,
    pub token_hash: String,
    pub status: String,
    pub ready: bool,
    pub rematch_ready: bool,
    pub grace_until: Option<DateTime<Utc>>,
    pub joined_at: DateTime<Utc>,
    pub role: String,
    pub chat_rate_tokens: Option<f64>,
    pub chat_rate_refilled_at: Option<DateTime<Utc>>,
}
impl Member {
    pub fn is_player(&self) -> bool {
        self.role.is_empty() || self.role == "player"
    }
    pub fn is_spectator(&self) -> bool {
        self.role == "spectator"
    }
    pub fn seat(&self) -> i32 {
        self.seat.unwrap_or(0)
    }
}
#[derive(Debug, Clone, FromRow)]
pub struct Match {
    pub id: String,
    pub room_id: String,
    pub match_index: i32,
    pub catalog_version: String,
    pub target_wins: i32,
    pub score_slot1: i32,
    pub score_slot2: i32,
    pub round_count: i32,
    pub status: String,
    pub started_at: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub question_scope: Option<Value>,
    pub winner_member_id: Option<String>,
    pub scoring_mode: String,
    pub roster_size: i32,
    pub max_rounds: i32,
    pub rule_set_key: String,
    pub rule_set_version: i32,
    pub rule_config_snapshot: Value,
    pub answer_match_policy: String,
}
#[derive(Debug, Clone, FromRow)]
pub struct MatchPlayer {
    pub match_id: String,
    pub member_id: String,
    pub seat: i32,
    pub wins: i32,
    pub status: String,
    pub score: i32,
    pub best_round_score: i32,
    pub eliminated_round: Option<i32>,
}
#[derive(Debug, Clone, FromRow)]
pub struct Round {
    pub id: String,
    pub match_id: String,
    pub round_index: i32,
    pub answer_id: String,
    pub status: String,
    pub winner_slot: Option<i32>,
    pub starts_at: DateTime<Utc>,
    pub deadline: DateTime<Utc>,
    pub ended_at: Option<DateTime<Utc>>,
    pub turn_slot: Option<i32>,
    pub turn_deadline: Option<DateTime<Utc>>,
    pub winner_member_id: Option<String>,
}
#[derive(Debug, Clone, FromRow)]
pub struct RoundPlayer {
    pub round_id: String,
    pub member_id: String,
    pub status: String,
    pub finish_rank: Option<i32>,
    pub points_awarded: i32,
    pub completed_at: Option<DateTime<Utc>>,
}
#[derive(Debug, Clone, FromRow)]
pub struct Guess {
    pub id: String,
    pub round_id: String,
    pub member_id: String,
    pub sequence: i32,
    pub guess_id: String,
    pub statuses: Value,
    pub is_correct: bool,
    pub idempotency_key: String,
    pub created_at: DateTime<Utc>,
}
#[derive(Debug, Clone, FromRow)]
pub struct RoomEvent {
    pub id: i64,
    pub room_id: String,
    pub sequence: i64,
    #[sqlx(rename = "type")]
    pub event_type: String,
    pub payload: Value,
    pub occurred_at: DateTime<Utc>,
}
