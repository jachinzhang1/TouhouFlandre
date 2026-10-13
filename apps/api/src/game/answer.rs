use super::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::str::FromStr;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AnswerMatchPolicy {
    Strict,
    PublicFieldsV1,
}
impl FromStr for AnswerMatchPolicy {
    type Err = GameError;
    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "strict" => Ok(Self::Strict),
            "public_fields_v1" => Ok(Self::PublicFieldsV1),
            _ => Err(GameError::UnknownAnswerMatchPolicy(value.into())),
        }
    }
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MatchResult {
    pub correct: bool,
    pub kind: MatchKind,
}
#[derive(Clone, Debug)]
pub struct CatalogRuntime {
    pub version: String,
    pub policy: AnswerMatchPolicy,
    pub characters: Vec<Character>,
    pub by_id: HashMap<String, Character>,
    group_by_id: HashMap<String, String>,
}
pub fn build_catalog_runtime(
    version: &str,
    policy: AnswerMatchPolicy,
    characters: &[Character],
) -> Result<CatalogRuntime, GameError> {
    let mut runtime = CatalogRuntime {
        version: version.into(),
        policy,
        characters: characters.to_vec(),
        by_id: HashMap::new(),
        group_by_id: HashMap::new(),
    };
    let mut signatures: HashMap<String, Vec<String>> = HashMap::new();
    for character in characters {
        if character.id.is_empty() {
            return Err(GameError::MissingCharacterId);
        }
        if runtime
            .by_id
            .insert(character.id.clone(), character.clone())
            .is_some()
        {
            return Err(GameError::DuplicateCharacterId(character.id.clone()));
        }
        runtime
            .group_by_id
            .insert(character.id.clone(), character.id.clone());
        if policy == AnswerMatchPolicy::PublicFieldsV1
            && character.enabled_as_guess
            && let Some(signature) = equivalence_signature(character)
        {
            signatures
                .entry(signature)
                .or_default()
                .push(character.id.clone());
        }
    }
    for mut members in signatures
        .into_values()
        .filter(|members| members.len() >= 2)
    {
        members.sort();
        let key = format!("equivalent:{}", members[0]);
        for id in members {
            runtime.group_by_id.insert(id, key.clone());
        }
    }
    Ok(runtime)
}
impl CatalogRuntime {
    pub fn group_key<'a>(&'a self, id: &'a str) -> &'a str {
        self.group_by_id.get(id).map(String::as_str).unwrap_or(id)
    }
    pub fn distinct_ids_by_group(&self, ids: &[String]) -> Vec<String> {
        let mut seen = HashSet::new();
        ids.iter()
            .filter(|id| seen.insert(self.group_key(id)))
            .cloned()
            .collect()
    }
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
    pub fn evaluate_guess(
        &self,
        answer_id: &str,
        guess_id: &str,
        fields: Option<&[GuessField]>,
    ) -> Result<GuessResult, GameError> {
        let guess = self.by_id.get(guess_id).ok_or(GameError::GuessMissing)?;
        if !guess.enabled_as_guess {
            return Err(GameError::GuessDisabled);
        }
        let answer = self.by_id.get(answer_id).ok_or(GameError::AnswerMissing)?;
        Ok(compare_character_with_match(
            guess,
            answer,
            fields,
            self.match_answer(answer_id, guess_id),
        ))
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
