//! Persisted single-player sessions are adapted to one independent attempt
//! sequence. Concurrency, timeout eligibility and saving remain in the service.
use crate::{
    error::ApiError,
    game::{GameError, GuessResult},
    repository::solo::StoredSession,
};
use axum::http::StatusCode;
use touhouflandre_core::{AttemptState, Error};

pub(super) fn from_stored(
    session: &StoredSession,
    guesses: &[GuessResult],
) -> Result<AttemptState, ApiError> {
    let limit = usize::try_from(session.max_guesses)
        .map_err(|_| ApiError::invariant("negative stored session guess limit"))?;
    Ok(AttemptState {
        // Preserve legacy duplicate rejection even for synthetic timeout IDs.
        // The core treats IDs as opaque and never generates these markers.
        guessed_ids: guesses.iter().map(|guess| guess.guess_id.clone()).collect(),
        used: guesses.len(),
        limit: Some(limit),
        closed: session.status != "playing",
    })
}

pub(super) fn status(state: &AttemptState, correct: bool) -> &'static str {
    if correct {
        "won"
    } else if state.closed {
        "lost"
    } else {
        "playing"
    }
}

pub(super) fn game_error(error: GameError) -> ApiError {
    match error {
        GameError::Guessing(source) => self::error(source),
        other => other.into(),
    }
}

pub(super) fn error(error: Error) -> ApiError {
    let response = match &error {
        Error::AttemptsClosed => super::closed(),
        Error::DuplicateGuess => ApiError::new(
            StatusCode::CONFLICT,
            "DUPLICATE_GUESS",
            "这个角色已经猜过了。",
        ),
        Error::AttemptLimitReached => ApiError::new(
            StatusCode::CONFLICT,
            "GUESS_LIMIT_REACHED",
            "本局猜测次数已用尽。",
        ),
        Error::GuessMissing | Error::GuessDisabled => ApiError::new(
            StatusCode::BAD_REQUEST,
            "INVALID_GUESS",
            "请选择本局题库中的角色。",
        ),
        Error::AnswerMissing => ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL",
            "本局题库快照中缺少答案角色。",
        ),
        _ => return error.into(),
    };
    response.with_source(GameError::from(error))
}
