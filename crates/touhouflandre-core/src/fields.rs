use crate::{
    CanonicalFieldValue, Character, FIELD_AFFILIATIONS, FIELD_FIRST_APPEARANCE, FIELD_HAIR_COLORS,
    FIELD_KEYS, FIELD_LOCATIONS, FIELD_RELEASE_YEAR, FIELD_SPECIES, FeedbackStatus, FieldRule,
};
use std::collections::BTreeSet;

pub fn default_fields() -> Vec<FieldRule> {
    FIELD_KEYS
        .iter()
        .map(|key| FieldRule {
            key: (*key).into(),
            compare_strategy: match *key {
                FIELD_FIRST_APPEARANCE => "firstAppearance",
                FIELD_RELEASE_YEAR => "numberDirection",
                _ => "multiSet",
            }
            .into(),
        })
        .collect()
}

fn known_string(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty() && !value.eq_ignore_ascii_case("unknown") && value != "未知"
}

fn set_values<'a>(character: &'a Character, key: &str) -> Option<&'a [String]> {
    match key {
        FIELD_SPECIES => Some(&character.species),
        FIELD_AFFILIATIONS => Some(&character.affiliations),
        FIELD_LOCATIONS => Some(&character.locations),
        FIELD_HAIR_COLORS => Some(&character.hair_colors),
        _ => None,
    }
}

pub fn canonical_field_value(character: &Character, key: &str) -> Option<CanonicalFieldValue> {
    let mut value = CanonicalFieldValue::default();
    match key {
        FIELD_FIRST_APPEARANCE => {
            if !known_string(&character.first_appearance.work_id) {
                return None;
            }
            value.string_value = Some(character.first_appearance.work_id.clone());
        }
        FIELD_RELEASE_YEAR => {
            if character.first_appearance.release_year == 0 {
                return None;
            }
            value.number_value = Some(character.first_appearance.release_year);
        }
        _ => {
            let values = set_values(character, key)?;
            if values.is_empty() || values.iter().any(|value| !known_string(value)) {
                return None;
            }
            value.set_value = values
                .iter()
                .cloned()
                .collect::<BTreeSet<_>>()
                .into_iter()
                .collect();
        }
    }
    Some(value)
}

pub fn compare_feedback(
    guess: &Character,
    answer: &Character,
    field: &FieldRule,
) -> FeedbackStatus {
    use FeedbackStatus::*;
    let (Some(left), Some(right)) = (
        canonical_field_value(guess, &field.key),
        canonical_field_value(answer, &field.key),
    ) else {
        return Unknown;
    };
    match field.key.as_str() {
        FIELD_FIRST_APPEARANCE => {
            if left == right {
                Exact
            } else if known_string(&guess.first_appearance.work_type)
                && known_string(&answer.first_appearance.work_type)
                && guess.first_appearance.work_type == answer.first_appearance.work_type
            {
                Partial
            } else {
                Miss
            }
        }
        FIELD_RELEASE_YEAR => {
            if left == right {
                Exact
            } else if field.compare_strategy == "numberExact" {
                Miss
            } else if guess.first_appearance.release_year < answer.first_appearance.release_year {
                Higher
            } else {
                Lower
            }
        }
        _ => {
            if left == right {
                Exact
            } else if left
                .set_value
                .iter()
                .any(|value| right.set_value.contains(value))
            {
                Partial
            } else {
                Miss
            }
        }
    }
}

pub(crate) fn equivalence_key(character: &Character) -> Option<Vec<CanonicalFieldValue>> {
    FIELD_KEYS
        .iter()
        .map(|key| canonical_field_value(character, key))
        .collect()
}

/// Whether all six canonical fields are known and identical. This does not
/// inspect guess eligibility; catalog grouping additionally requires it.
pub fn equivalent_characters(left: &Character, right: &Character) -> bool {
    matches!(
        (equivalence_key(left), equivalence_key(right)),
        (Some(left), Some(right)) if left == right
    )
}
