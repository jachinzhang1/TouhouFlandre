//! Relay-owned stages, paired encounters and their transactional lifecycle.
pub mod coordinator;
pub use crate::domain::relay as domain;
pub mod endpoints;
pub mod lifecycle;
pub mod service;
pub use crate::repository::relay as storage;
pub mod views;
pub use coordinator::start_match_tx;

pub use lifecycle::{
    forfeit_member_tx, forfeit_members_tx, recover, sweep, terminate_active, terminate_room_tx,
};
pub use service::legacy_action;
pub use views::{project_payload, snapshot};

use crate::{error::ApiError, service::multi::invalid};
#[derive(Debug, Clone, Copy)]
pub struct MatchPlan {
    pub ruleset_key: &'static str,
    pub ruleset_version: i32,
    pub scoring_mode: &'static str,
    pub target_wins: i32,
    pub max_rounds: i32,
}
pub fn match_plan(
    player_count: usize,
    format: &str,
    max_rounds_factor: usize,
    elimination_enabled: bool,
) -> Result<MatchPlan, ApiError> {
    let n = match format {
        "bo1" => 1,
        "bo3" => 3,
        "bo5" => 5,
        "bo7" => 7,
        _ => return Err(invalid("接力赛制无效。")),
    };
    let rule = match player_count {
        2 => domain::Rule::Legacy,
        4 | 6 | 8 => {
            if elimination_enabled {
                domain::Rule::Elimination
            } else {
                domain::Rule::Fixed
            }
        }
        _ => return Err(invalid("接力参赛人数必须是 2、4、6 或 8。")),
    };
    let max_rounds = if rule == domain::Rule::Legacy {
        i32::try_from(max_rounds_factor)
            .ok()
            .and_then(|factor| factor.checked_mul(n))
            .filter(|n| *n > 0)
            .ok_or_else(|| invalid("接力总局数无效。"))?
    } else {
        n
    };
    Ok(MatchPlan {
        ruleset_key: rule.key(),
        ruleset_version: 1,
        scoring_mode: "wins",
        target_wins: (n + 1) / 2,
        max_rounds,
    })
}
impl From<domain::Error> for ApiError {
    #[track_caller]
    fn from(error: domain::Error) -> Self {
        use axum::http::StatusCode;
        use domain::Error::*;
        let (status, code, message) = match error {
            NotFound => (
                StatusCode::NOT_FOUND,
                "ENCOUNTER_NOT_FOUND",
                "没有找到目标接力对局。",
            ),
            NotPlayer => (
                StatusCode::CONFLICT,
                "NOT_ENCOUNTER_PLAYER",
                "你不是该接力对局的参赛者。",
            ),
            NotYourTurn => (
                StatusCode::CONFLICT,
                "NOT_YOUR_TURN",
                "还没轮到你提交猜测。",
            ),
            Ended => (
                StatusCode::CONFLICT,
                "ENCOUNTER_ENDED",
                "该接力对局已经结束。",
            ),
            NotActive => (
                StatusCode::CONFLICT,
                "ROUND_NOT_ACTIVE",
                "该接力对局尚未开始。",
            ),
            TurnExpired => (StatusCode::CONFLICT, "TURN_EXPIRED", "本轮已超时空过。"),
            InvalidGuess => (
                StatusCode::BAD_REQUEST,
                "INVALID_GUESS",
                "该角色不在本局题库中。",
            ),
            DuplicateGuess => (
                StatusCode::CONFLICT,
                "DUPLICATE_GUESS",
                "本局已猜过该角色。",
            ),
            Idempotency => (
                StatusCode::CONFLICT,
                "IDEMPOTENCY_CONFLICT",
                "幂等键已用于不同的接力动作。",
            ),
            Invalid => (
                StatusCode::BAD_REQUEST,
                "INVALID_REQUEST",
                "接力动作参数无效。",
            ),
            PoolTooSmall => (
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL",
                "服务器暂时无法处理请求。",
            ),
        };
        Self::new(status, code, message).with_source(error)
    }
}
