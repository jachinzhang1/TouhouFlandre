use super::*;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

pub const QUESTION_SCOPE_SCHEMA_VERSION: i32 = 3;
pub const QUESTION_SCOPE_MIN_TURN_SECONDS: i32 = 30;
pub const QUESTION_SCOPE_HARD_TURN_SECONDS: i32 = 45;
pub const QUESTION_SCOPE_MAX_TURN_SECONDS: i32 = 120;
pub const QUESTION_SCOPE_MIN_GUESSES: i32 = 1;
pub const QUESTION_SCOPE_DEFAULT_GUESSES: i32 = 8;
pub const QUESTION_SCOPE_MAX_GUESSES: i32 = 20;
pub const QUESTION_SCOPE_UNLIMITED_GUESSES: i32 = 999;
const PRESETS: [&str; 5] = ["easy", "normal", "hard", "lunatic", "extra"];

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuestionScopeFieldRules {
    pub first_appearance: bool,
    pub release_year: String,
    pub species: bool,
    pub affiliations: bool,
    pub locations: bool,
    pub hair_colors: bool,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuestionScopeTurnLimit {
    pub enabled: bool,
    pub seconds: i32,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuestionScopeGuessLimit {
    pub enabled: bool,
    pub max_guesses: i32,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuestionScopeRules {
    #[serde(skip_serializing_if = "FieldModes::is_empty")]
    #[serde(deserialize_with = "deserialize_null_default")]
    pub field_modes: FieldModes,
    pub turn_limit: QuestionScopeTurnLimit,
    pub guess_limit: QuestionScopeGuessLimit,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub fields: Option<QuestionScopeFieldRules>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    #[serde(deserialize_with = "deserialize_null_default")]
    pub hidden_fields: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub turn_seconds: Option<i32>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuestionScopeWorkState {
    pub work_id: String,
    pub state: String,
    pub selected_count: usize,
    pub total_count: usize,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct QuestionScopeConfig {
    pub schema_version: i32,
    pub catalog_version: String,
    pub mode: String,
    pub difficulty: String,
    #[serde(deserialize_with = "deserialize_null_default")]
    pub selected_character_ids: Vec<String>,
    #[serde(deserialize_with = "deserialize_null_default")]
    pub work_states: Vec<QuestionScopeWorkState>,
    pub rules: QuestionScopeRules,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QuestionScopeWork {
    pub id: String,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QuestionScopeCorrection {
    pub config: QuestionScopeConfig,
    pub changed: bool,
    pub reason: String,
}

pub fn is_question_difficulty_preset(value: &str) -> bool {
    PRESETS.contains(&value)
}
pub fn is_daily_question_difficulty(value: &str) -> bool {
    PRESETS[..4].contains(&value)
}
pub fn preset_question_scope_rules(preset: &str) -> QuestionScopeRules {
    let mut rules = QuestionScopeRules {
        field_modes: default_field_modes(),
        turn_limit: QuestionScopeTurnLimit {
            enabled: false,
            seconds: QUESTION_SCOPE_MIN_TURN_SECONDS,
        },
        guess_limit: QuestionScopeGuessLimit {
            enabled: true,
            max_guesses: QUESTION_SCOPE_DEFAULT_GUESSES,
        },
        ..Default::default()
    };
    if preset == "easy" {
        rules.guess_limit.enabled = false;
    }
    if matches!(preset, "hard" | "lunatic" | "extra") {
        rules.turn_limit.enabled = true;
        rules.turn_limit.seconds = if preset == "hard" {
            QUESTION_SCOPE_HARD_TURN_SECONDS
        } else {
            QUESTION_SCOPE_MIN_TURN_SECONDS
        };
    }
    if matches!(preset, "lunatic" | "extra") {
        rules
            .field_modes
            .insert(FIELD_FIRST_APPEARANCE.into(), FIELD_MODE_HIDDEN.into());
    }
    rules
}
pub fn preset_question_scope_ids(preset: &str, characters: &[Character]) -> Vec<String> {
    let Some(index) = PRESETS.iter().position(|p| *p == preset) else {
        return vec![];
    };
    let mut pool: Vec<_> = characters
        .iter()
        .filter(|c| {
            c.enabled_as_answer
                && (preset == "extra" || PRESETS[..=index].contains(&c.difficulty_tier.as_str()))
        })
        .collect();
    pool.sort_by(|a, b| {
        a.appearance_order
            .cmp(&b.appearance_order)
            .then_with(|| a.id.cmp(&b.id))
    });
    pool.into_iter().map(|c| c.id.clone()).collect()
}
pub fn default_question_scope(
    catalog_version: &str,
    works: &[QuestionScopeWork],
    characters: &[Character],
    preset: &str,
) -> QuestionScopeConfig {
    let preset = if is_question_difficulty_preset(preset) {
        preset
    } else {
        "normal"
    };
    canonical_question_scope(
        catalog_version,
        works,
        characters,
        &preset_question_scope_ids(preset, characters),
        preset_question_scope_rules(preset),
        preset,
    )
}
fn legacy_field_modes(fields: Option<&QuestionScopeFieldRules>) -> FieldModes {
    let mut modes = default_field_modes();
    let Some(fields) = fields else {
        return modes;
    };
    for (key, enabled) in [
        (FIELD_FIRST_APPEARANCE, fields.first_appearance),
        (FIELD_SPECIES, fields.species),
        (FIELD_AFFILIATIONS, fields.affiliations),
        (FIELD_LOCATIONS, fields.locations),
        (FIELD_HAIR_COLORS, fields.hair_colors),
    ] {
        if !enabled {
            modes.insert(key.into(), FIELD_MODE_HIDDEN.into());
        }
    }
    modes.insert(
        FIELD_RELEASE_YEAR.into(),
        match fields.release_year.as_str() {
            FIELD_MODE_HIDDEN => FIELD_MODE_HIDDEN,
            FIELD_MODE_EXACT_ONLY => FIELD_MODE_EXACT_ONLY,
            _ => FIELD_MODE_DIRECTIONAL,
        }
        .into(),
    );
    modes
}
fn normalize_field_modes(rules: &QuestionScopeRules, missing_mode: &str) -> FieldModes {
    if rules.field_modes.is_empty() {
        return legacy_field_modes(rules.fields.as_ref());
    }
    field_definitions()
        .into_iter()
        .map(|definition| {
            let fallback = if missing_mode.is_empty() {
                definition.default_mode.as_str()
            } else {
                missing_mode
            };
            let mut mode = rules
                .field_modes
                .get(&definition.key)
                .map(String::as_str)
                .unwrap_or(fallback);
            if !field_mode_valid(&definition.key, mode) {
                mode = if field_mode_valid(&definition.key, missing_mode) {
                    missing_mode
                } else {
                    &definition.default_mode
                };
            }
            (definition.key.clone(), mode.to_owned())
        })
        .collect()
}
fn normalize_turn_limit(mut limit: QuestionScopeTurnLimit) -> QuestionScopeTurnLimit {
    limit.seconds = limit.seconds.clamp(
        QUESTION_SCOPE_MIN_TURN_SECONDS,
        QUESTION_SCOPE_MAX_TURN_SECONDS,
    );
    limit
}
fn normalize_guess_limit(mut limit: QuestionScopeGuessLimit) -> QuestionScopeGuessLimit {
    if !limit.enabled && limit.max_guesses == 0 {
        return QuestionScopeGuessLimit {
            enabled: true,
            max_guesses: QUESTION_SCOPE_DEFAULT_GUESSES,
        };
    }
    limit.max_guesses = limit
        .max_guesses
        .clamp(QUESTION_SCOPE_MIN_GUESSES, QUESTION_SCOPE_MAX_GUESSES);
    limit
}
pub fn normalize_question_scope_rules(rules: &QuestionScopeRules) -> QuestionScopeRules {
    QuestionScopeRules {
        field_modes: normalize_field_modes(rules, ""),
        turn_limit: normalize_turn_limit(rules.turn_limit.clone()),
        guess_limit: normalize_guess_limit(rules.guess_limit.clone()),
        ..Default::default()
    }
}
pub fn effective_question_scope_max_guesses(rules: &QuestionScopeRules) -> i32 {
    let limit = normalize_guess_limit(rules.guess_limit.clone());
    if limit.enabled {
        limit.max_guesses
    } else {
        QUESTION_SCOPE_UNLIMITED_GUESSES
    }
}
fn legacy_question_scope_rules(
    rules: &QuestionScopeRules,
    requested: &str,
    schema: i32,
) -> QuestionScopeRules {
    if schema >= 2 && rules.fields.is_some() {
        return normalize_question_scope_rules(rules);
    }
    let mut normalized = preset_question_scope_rules(if requested.is_empty() {
        "normal"
    } else {
        requested
    });
    normalized.guess_limit = QuestionScopeGuessLimit {
        enabled: true,
        max_guesses: QUESTION_SCOPE_DEFAULT_GUESSES,
    };
    // All six current registry fields existed in legacy schemas. Unknown legacy
    // keys remain ignored, as in the historical schema conversion.
    for key in &rules.hidden_fields {
        if normalized.field_modes.contains_key(key) {
            normalized
                .field_modes
                .insert(key.clone(), FIELD_MODE_HIDDEN.into());
        }
    }
    if let Some(seconds) = rules.turn_seconds {
        normalized.turn_limit = QuestionScopeTurnLimit {
            enabled: true,
            seconds,
        };
    }
    normalize_question_scope_rules(&normalized)
}
pub fn same_question_scope_rules(left: &QuestionScopeRules, right: &QuestionScopeRules) -> bool {
    let left = normalize_question_scope_rules(left);
    let right = normalize_question_scope_rules(right);
    left.field_modes == right.field_modes
        && left.turn_limit.enabled == right.turn_limit.enabled
        && (!left.turn_limit.enabled || left.turn_limit.seconds == right.turn_limit.seconds)
        && left.guess_limit == right.guess_limit
}
fn infer_difficulty(
    selected: &[String],
    rules: &QuestionScopeRules,
    characters: &[Character],
    preferred: &str,
) -> String {
    let matches = |preset: &str| {
        selected == preset_question_scope_ids(preset, characters)
            && same_question_scope_rules(rules, &preset_question_scope_rules(preset))
    };
    if is_question_difficulty_preset(preferred) && matches(preferred) {
        return preferred.into();
    }
    PRESETS
        .into_iter()
        .find(|preset| matches(preset))
        .unwrap_or("custom")
        .into()
}
pub fn fields_for_question_scope(config: &QuestionScopeConfig) -> Vec<GuessField> {
    fields_for_modes(&normalize_question_scope_rules(&config.rules).field_modes)
}
pub fn storage_fields_for_question_scope(config: &QuestionScopeConfig) -> Vec<GuessField> {
    let rules = normalize_question_scope_rules(&config.rules);
    let mut modes = default_field_modes();
    if rules
        .field_modes
        .get(FIELD_RELEASE_YEAR)
        .is_some_and(|m| m == FIELD_MODE_EXACT_ONLY)
    {
        modes.insert(FIELD_RELEASE_YEAR.into(), FIELD_MODE_EXACT_ONLY.into());
    }
    fields_for_modes(&modes)
}
pub fn question_scope_answer_pool(config: &QuestionScopeConfig) -> Vec<String> {
    config.selected_character_ids.clone()
}
fn normalize_ids(ids: &[String], characters: &[Character]) -> Vec<String> {
    let selected: HashSet<_> = ids.iter().collect();
    let mut pool: Vec<_> = characters
        .iter()
        .filter(|c| c.enabled_as_answer && selected.contains(&c.id))
        .collect();
    pool.sort_by(|a, b| {
        a.appearance_order
            .cmp(&b.appearance_order)
            .then_with(|| a.id.cmp(&b.id))
    });
    let mut seen = HashSet::new();
    pool.into_iter()
        .filter(|c| seen.insert(&c.id))
        .map(|c| c.id.clone())
        .collect()
}
pub fn build_question_scope_work_states(
    works: &[QuestionScopeWork],
    characters: &[Character],
    selected_ids: &[String],
) -> Vec<QuestionScopeWorkState> {
    let selected: HashSet<_> = selected_ids.iter().collect();
    let mut counts: HashMap<&str, (usize, usize)> = HashMap::new();
    for c in characters.iter().filter(|c| c.enabled_as_answer) {
        let count = counts.entry(&c.first_appearance.work_id).or_default();
        count.1 += 1;
        if selected.contains(&c.id) {
            count.0 += 1;
        }
    }
    works
        .iter()
        .map(|w| {
            let (selected_count, total_count) =
                counts.get(w.id.as_str()).copied().unwrap_or_default();
            let state = if total_count > 0 && selected_count == total_count {
                "all"
            } else if selected_count > 0 {
                "partial"
            } else {
                "none"
            };
            QuestionScopeWorkState {
                work_id: w.id.clone(),
                state: state.into(),
                selected_count,
                total_count,
            }
        })
        .collect()
}
fn canonical_question_scope(
    version: &str,
    works: &[QuestionScopeWork],
    characters: &[Character],
    ids: &[String],
    rules: QuestionScopeRules,
    preferred: &str,
) -> QuestionScopeConfig {
    let ids = normalize_ids(ids, characters);
    let rules = normalize_question_scope_rules(&rules);
    let difficulty = infer_difficulty(&ids, &rules, characters, preferred);
    QuestionScopeConfig {
        schema_version: QUESTION_SCOPE_SCHEMA_VERSION,
        catalog_version: version.into(),
        mode: if difficulty == "custom" {
            "custom"
        } else {
            "preset"
        }
        .into(),
        difficulty,
        work_states: build_question_scope_work_states(works, characters, &ids),
        selected_character_ids: ids,
        rules,
    }
}
pub fn normalize_question_scope(
    input: Option<&QuestionScopeConfig>,
    version: &str,
    works: &[QuestionScopeWork],
    characters: &[Character],
) -> QuestionScopeCorrection {
    let Some(input) = input else {
        return QuestionScopeCorrection {
            config: default_question_scope(version, works, characters, "normal"),
            changed: true,
            reason: String::new(),
        };
    };
    let mut requested = if is_question_difficulty_preset(&input.difficulty) {
        input.difficulty.as_str()
    } else {
        ""
    };
    let mut rules = normalize_question_scope_rules(&input.rules);
    if !input.rules.field_modes.is_empty() {
        rules.field_modes = normalize_field_modes(
            &input.rules,
            if input.mode == "custom" {
                FIELD_MODE_HIDDEN
            } else {
                ""
            },
        );
    }
    if input.schema_version < QUESTION_SCOPE_SCHEMA_VERSION {
        rules = legacy_question_scope_rules(&input.rules, requested, input.schema_version);
    }
    let incoming = if !requested.is_empty()
        && ((input.catalog_version != version && input.mode == "preset")
            || input.selected_character_ids.is_empty())
    {
        preset_question_scope_ids(requested, characters)
    } else {
        input.selected_character_ids.clone()
    };
    let mut selected = normalize_ids(&incoming, characters);
    let mut reason = "";
    if selected.is_empty() {
        selected = preset_question_scope_ids("normal", characters);
        rules = preset_question_scope_rules("normal");
        requested = "normal";
        reason = "empty-pool-fallback";
    } else if selected.len() != incoming.len() {
        reason = "invalid-ids-dropped";
    }
    let config = canonical_question_scope(version, works, characters, &selected, rules, requested);
    let changed = input.catalog_version != version
        || input.schema_version != QUESTION_SCOPE_SCHEMA_VERSION
        || input.mode != config.mode
        || input.difficulty != config.difficulty
        || input.selected_character_ids != config.selected_character_ids
        || !same_question_scope_rules(&input.rules, &config.rules);
    if reason.is_empty() && input.catalog_version != version {
        reason = "catalog-updated";
    }
    QuestionScopeCorrection {
        config,
        changed,
        reason: reason.into(),
    }
}
