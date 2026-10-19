use super::{guessing, *};
use std::collections::HashMap;

pub use touhouflandre_core::{AnswerMatchPolicy, MatchResult};

/// Application catalog snapshot and its presentation data. The independent
/// catalog owns only the immutable facts needed to evaluate guesses.
#[derive(Clone, Debug)]
pub struct CatalogRuntime {
    version: String,
    policy: AnswerMatchPolicy,
    characters: Vec<Character>,
    by_id: HashMap<String, Character>,
    rules: touhouflandre_core::Catalog,
}

pub struct GuessAttempt {
    pub state: touhouflandre_core::AttemptState,
    pub guess: GuessResult,
}

pub fn build_catalog_runtime(
    version: &str,
    policy: AnswerMatchPolicy,
    characters: &[Character],
) -> Result<CatalogRuntime, GameError> {
    let facts: Vec<_> = characters.iter().map(guessing::rule_character).collect();
    let rules = touhouflandre_core::Catalog::new(policy, &facts)?;
    Ok(CatalogRuntime {
        version: version.into(),
        policy,
        characters: characters.to_vec(),
        by_id: characters
            .iter()
            .map(|c| (c.id.clone(), c.clone()))
            .collect(),
        rules,
    })
}

impl CatalogRuntime {
    pub fn version(&self) -> &str {
        &self.version
    }

    pub fn policy(&self) -> AnswerMatchPolicy {
        self.policy
    }

    pub fn characters(&self) -> &[Character] {
        &self.characters
    }

    pub fn character(&self, id: &str) -> Option<&Character> {
        self.by_id.get(id)
    }

    pub fn group_key<'a>(&'a self, id: &'a str) -> &'a str {
        self.rules.group_key(id)
    }

    pub fn distinct_ids_by_group(&self, ids: &[String]) -> Vec<String> {
        self.rules.distinct_ids_by_group(ids)
    }

    pub fn match_answer(&self, answer_id: &str, guess_id: &str) -> MatchResult {
        self.rules.match_answer(answer_id, guess_id)
    }

    pub fn evaluate_guess(
        &self,
        answer_id: &str,
        guess_id: &str,
        fields: Option<&[GuessField]>,
    ) -> Result<GuessResult, GameError> {
        let rules = guessing::rule_fields(fields);
        let result = self
            .rules
            .evaluate_guess(answer_id, guess_id, Some(&rules))?;
        Ok(guessing::present_guess(
            result,
            &self.by_id[guess_id],
            fields,
        ))
    }

    pub fn apply_guess(
        &self,
        state: &touhouflandre_core::AttemptState,
        answer_id: &str,
        guess_id: &str,
        fields: Option<&[GuessField]>,
    ) -> Result<GuessAttempt, GameError> {
        let rules = guessing::rule_fields(fields);
        let outcome = self
            .rules
            .apply_guess(state, answer_id, guess_id, Some(&rules))?;
        Ok(GuessAttempt {
            state: outcome.state,
            guess: guessing::present_guess(outcome.guess, &self.by_id[guess_id], fields),
        })
    }
}

pub fn match_kind_for_stored_guess(correct: bool, answer_id: &str, guess_id: &str) -> MatchKind {
    if !correct {
        MatchKind::None
    } else if answer_id == guess_id {
        MatchKind::Exact
    } else {
        MatchKind::Equivalent
    }
}
