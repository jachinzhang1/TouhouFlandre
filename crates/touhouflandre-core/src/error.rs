#[derive(Clone, Debug, PartialEq, Eq, thiserror::Error)]
pub enum Error {
    #[error("unknown answer match policy {0:?}")]
    UnknownAnswerMatchPolicy(String),
    #[error("catalog contains a character without an id")]
    MissingCharacterId,
    #[error("catalog contains duplicate character id {0:?}")]
    DuplicateCharacterId(String),
    #[error("guess character missing")]
    GuessMissing,
    #[error("guess character disabled")]
    GuessDisabled,
    #[error("answer character missing")]
    AnswerMissing,
    #[error("attempt sequence closed")]
    AttemptsClosed,
    #[error("character already guessed")]
    DuplicateGuess,
    #[error("attempt limit reached")]
    AttemptLimitReached,
    #[error("invalid attempt state")]
    InvalidAttemptState,
}

impl Error {
    /// Fixed diagnostic labels that never include character IDs or user input.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::UnknownAnswerMatchPolicy(_) => "unknown_answer_match_policy",
            Self::MissingCharacterId => "missing_character_id",
            Self::DuplicateCharacterId(_) => "duplicate_character_id",
            Self::GuessMissing => "guess_missing",
            Self::GuessDisabled => "guess_disabled",
            Self::AnswerMissing => "answer_missing",
            Self::AttemptsClosed => "attempts_closed",
            Self::DuplicateGuess => "duplicate_guess",
            Self::AttemptLimitReached => "attempt_limit_reached",
            Self::InvalidAttemptState => "invalid_attempt_state",
        }
    }
}
