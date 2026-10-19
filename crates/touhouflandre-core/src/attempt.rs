use crate::{Catalog, Error, FieldRule, GuessResult};

/// A simple attempt sequence, without players, clocks, or persistence.
///
/// The caller chooses the scope of `guessed_ids` and `used`. Non-guess actions
/// may consume attempts, so `used` may exceed the number of guessed IDs. Each
/// supplied guess history entry must correspond to a consumed attempt.
/// `None` means no attempt limit. A sequence closes after a correct guess or
/// after consuming its last allowed attempt.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct AttemptState {
    pub guessed_ids: Vec<String>,
    pub used: usize,
    pub limit: Option<usize>,
    pub closed: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct AttemptOutcome {
    pub state: AttemptState,
    pub guess: GuessResult,
}

impl AttemptState {
    fn validate_open(&self) -> Result<(), Error> {
        if self.used < self.guessed_ids.len() || self.used == usize::MAX {
            return Err(Error::InvalidAttemptState);
        }
        if self.closed {
            return Err(Error::AttemptsClosed);
        }
        Ok(())
    }

    fn validate_capacity(&self) -> Result<(), Error> {
        if self.limit.is_some_and(|limit| self.used >= limit) {
            return Err(Error::AttemptLimitReached);
        }
        Ok(())
    }

    /// Validate state, closure, duplicate history, and remaining capacity,
    /// in that order. Catalog validity is checked separately.
    pub fn validate_guess(&self, guess_id: &str) -> Result<(), Error> {
        self.validate_open()?;
        if self.guessed_ids.iter().any(|id| id == guess_id) {
            return Err(Error::DuplicateGuess);
        }
        self.validate_capacity()
    }

    fn advanced(&self) -> Self {
        // Every call is preceded by validate_open(), which rejects overflow.
        let mut next = self.clone();
        next.used += 1;
        next.closed = next.limit.is_some_and(|limit| next.used >= limit);
        next
    }
}

impl Catalog {
    /// Return a new attempt state and semantic feedback. Neither the input
    /// state nor catalog is mutated, including when validation fails.
    pub fn apply_guess(
        &self,
        state: &AttemptState,
        answer_id: &str,
        guess_id: &str,
        fields: Option<&[FieldRule]>,
    ) -> Result<AttemptOutcome, Error> {
        state.validate_guess(guess_id)?;
        let guess = self.evaluate_guess(answer_id, guess_id, fields)?;
        let mut next = state.advanced();
        next.guessed_ids.push(guess_id.into());
        next.closed |= guess.is_correct;
        Ok(AttemptOutcome { state: next, guess })
    }
}

/// Consume an attempt without adding a guess. The caller decides whether an
/// event such as a timeout or pass should call this function at all.
pub fn consume_attempt(state: &AttemptState) -> Result<AttemptState, Error> {
    state.validate_open()?;
    state.validate_capacity()?;
    Ok(state.advanced())
}
