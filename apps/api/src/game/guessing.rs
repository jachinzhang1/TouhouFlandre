//! Conversion between application/catalog DTOs and the independent rule types.
//! Display fields stay here; they never participate in core comparisons.
use super::*;

pub(super) fn rule_character(character: &Character) -> touhouflandre_core::Character {
    touhouflandre_core::Character {
        id: character.id.clone(),
        enabled_as_guess: character.enabled_as_guess,
        first_appearance: touhouflandre_core::FirstAppearance {
            work_id: character.first_appearance.work_id.clone(),
            work_type: character.first_appearance.work_type.clone(),
            release_year: character.first_appearance.release_year,
        },
        species: character.species.clone(),
        affiliations: character.affiliations.clone(),
        locations: character.locations.clone(),
        hair_colors: character.hair_colors.clone(),
    }
}

pub(super) fn rule_field(field: &GuessField) -> touhouflandre_core::FieldRule {
    touhouflandre_core::FieldRule {
        key: field.key.clone(),
        compare_strategy: field.compare_strategy.clone(),
    }
}

pub(super) fn rule_fields(fields: Option<&[GuessField]>) -> Vec<touhouflandre_core::FieldRule> {
    let defaults = character_guess_fields();
    fields
        .unwrap_or(&defaults)
        .iter()
        .filter(|field| field.visible)
        .map(rule_field)
        .collect()
}

pub(super) fn present_field(
    guess: &Character,
    field: &GuessField,
    status: FeedbackStatus,
) -> FieldFeedback {
    FieldFeedback {
        field: field.key.clone(),
        label: field.label.clone(),
        status,
        symbol: status_to_symbol(status).into(),
        display_value: display_values_for_field(guess, &field.key),
    }
}

pub(super) fn present_guess(
    result: touhouflandre_core::GuessResult,
    guess: &Character,
    fields: Option<&[GuessField]>,
) -> GuessResult {
    let defaults = character_guess_fields();
    GuessResult {
        kind: "guess".into(),
        guess_id: result.guess_id,
        guess_name: guess.names.zh_hans.clone(),
        guess_avatar_url: guess.avatar_url.clone(),
        is_correct: result.is_correct,
        match_kind: result.match_kind,
        // Preserve order and repeated keys, including distinct display labels.
        feedback: fields
            .unwrap_or(&defaults)
            .iter()
            .filter(|field| field.visible)
            .zip(result.feedback)
            .map(|(field, feedback)| present_field(guess, field, feedback.status))
            .collect(),
    }
}
