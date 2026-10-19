use crate::{
    AnswerMatchPolicy, CanonicalFieldValue, Character, Error, FieldFeedback, FieldRule,
    GuessResult, MatchKind, MatchResult, compare_feedback, default_fields, fields::equivalence_key,
};
use std::collections::{HashMap, HashSet};

/// An owned, immutable snapshot of comparison facts and the answer policy.
/// Loading, caching, versioning, and choosing an answer belong to the caller.
#[derive(Clone, Debug)]
pub struct Catalog {
    policy: AnswerMatchPolicy,
    by_id: HashMap<String, Character>,
    group_by_id: HashMap<String, String>,
}

impl Catalog {
    pub fn new(policy: AnswerMatchPolicy, characters: &[Character]) -> Result<Self, Error> {
        let mut catalog = Self {
            policy,
            by_id: HashMap::new(),
            group_by_id: HashMap::new(),
        };
        let mut groups: HashMap<Vec<CanonicalFieldValue>, Vec<String>> = HashMap::new();
        for character in characters {
            if character.id.is_empty() {
                return Err(Error::MissingCharacterId);
            }
            if catalog
                .by_id
                .insert(character.id.clone(), character.clone())
                .is_some()
            {
                return Err(Error::DuplicateCharacterId(character.id.clone()));
            }
            catalog
                .group_by_id
                .insert(character.id.clone(), character.id.clone());
            if policy == AnswerMatchPolicy::PublicFieldsV1
                && character.enabled_as_guess
                && let Some(key) = equivalence_key(character)
            {
                groups.entry(key).or_default().push(character.id.clone());
            }
        }
        for mut members in groups.into_values().filter(|members| members.len() >= 2) {
            members.sort();
            let key = format!("equivalent:{}", members[0]);
            for id in members {
                catalog.group_by_id.insert(id, key.clone());
            }
        }
        Ok(catalog)
    }

    pub fn validate_guess(&self, guess_id: &str) -> Result<(), Error> {
        let guess = self.by_id.get(guess_id).ok_or(Error::GuessMissing)?;
        if !guess.enabled_as_guess {
            return Err(Error::GuessDisabled);
        }
        Ok(())
    }

    /// Unknown IDs retain their own identity. Equivalent groups use the
    /// lexicographically smallest member ID, independent of input order.
    pub fn group_key<'a>(&'a self, id: &'a str) -> &'a str {
        self.group_by_id.get(id).map(String::as_str).unwrap_or(id)
    }

    /// Keep the first supplied ID from each group, preserving supplied order.
    pub fn distinct_ids_by_group(&self, ids: &[String]) -> Vec<String> {
        let mut seen = HashSet::new();
        ids.iter()
            .filter(|id| seen.insert(self.group_key(id)))
            .cloned()
            .collect()
    }

    /// Compare IDs without validating existence or guess eligibility. In
    /// particular identical IDs are exact, even if absent from this catalog.
    /// Use [`Self::evaluate_guess`] to validate an actual guess.
    pub fn match_answer(&self, answer_id: &str, guess_id: &str) -> MatchResult {
        let kind = if answer_id == guess_id {
            MatchKind::Exact
        } else if self.policy == AnswerMatchPolicy::PublicFieldsV1
            && self.group_by_id.contains_key(answer_id)
            && self.group_by_id.contains_key(guess_id)
            && self.group_key(answer_id) == self.group_key(guess_id)
        {
            MatchKind::Equivalent
        } else {
            MatchKind::None
        };
        MatchResult {
            correct: kind != MatchKind::None,
            kind,
        }
    }

    /// Evaluate one guess. `None` selects all default feedback fields;
    /// `Some(&[])` produces no feedback but still checks the full answer policy.
    pub fn evaluate_guess(
        &self,
        answer_id: &str,
        guess_id: &str,
        fields: Option<&[FieldRule]>,
    ) -> Result<GuessResult, Error> {
        self.validate_guess(guess_id)?;
        let guess = &self.by_id[guess_id];
        let answer = self.by_id.get(answer_id).ok_or(Error::AnswerMissing)?;
        let result = self.match_answer(answer_id, guess_id);
        let defaults;
        let fields = match fields {
            Some(fields) => fields,
            None => {
                defaults = default_fields();
                &defaults
            }
        };
        Ok(GuessResult {
            guess_id: guess_id.into(),
            is_correct: result.correct,
            match_kind: result.kind,
            feedback: fields
                .iter()
                .map(|field| FieldFeedback {
                    field: field.key.clone(),
                    status: compare_feedback(guess, answer, field),
                })
                .collect(),
        })
    }
}
