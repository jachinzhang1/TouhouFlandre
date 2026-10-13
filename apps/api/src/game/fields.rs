use super::*;
use serde::{Deserialize, Serialize};
use std::collections::{BTreeMap, BTreeSet};

pub const CHARACTER_FIELD_REGISTRY_VERSION: i32 = 1;
pub const FIELD_MODE_HIDDEN: &str = "hidden";
pub const FIELD_MODE_DEFAULT: &str = "default";
pub const FIELD_MODE_EXACT_ONLY: &str = "exactOnly";
pub const FIELD_MODE_DIRECTIONAL: &str = "directional";
const FIELD_KEYS: [&str; 6] = [
    FIELD_FIRST_APPEARANCE,
    FIELD_RELEASE_YEAR,
    FIELD_SPECIES,
    FIELD_AFFILIATIONS,
    FIELD_LOCATIONS,
    FIELD_HAIR_COLORS,
];
pub type FieldModes = BTreeMap<String, String>;

fn mode(key: &str, label: &str, enabled: bool) -> GuessFieldModeDefinition {
    GuessFieldModeDefinition {
        key: key.into(),
        label: label.into(),
        enabled,
    }
}
pub fn field_definitions() -> Vec<GuessFieldDefinition> {
    FIELD_KEYS
        .iter()
        .map(|key| {
            let (label, field_type, help, default) = match *key {
                FIELD_FIRST_APPEARANCE => (
                    "初登场作品",
                    "hierarchy",
                    "具体作品相同为命中，同类媒介为部分匹配。",
                    FIELD_MODE_DEFAULT,
                ),
                FIELD_RELEASE_YEAR => (
                    "初登场年份",
                    "number",
                    "箭头指向答案所在年份。",
                    FIELD_MODE_DIRECTIONAL,
                ),
                FIELD_SPECIES => ("种族", "multi_enum", "", FIELD_MODE_DEFAULT),
                FIELD_AFFILIATIONS => ("阵营", "multi_enum", "", FIELD_MODE_DEFAULT),
                FIELD_LOCATIONS => ("地点", "multi_enum", "", FIELD_MODE_DEFAULT),
                _ => ("头发颜色", "multi_enum", "", FIELD_MODE_DEFAULT),
            };
            let modes = if *key == FIELD_RELEASE_YEAR {
                vec![
                    mode(FIELD_MODE_HIDDEN, "关闭", false),
                    mode(FIELD_MODE_EXACT_ONLY, "仅精确", true),
                    mode(FIELD_MODE_DIRECTIONAL, "方向提示", true),
                ]
            } else {
                vec![
                    mode(FIELD_MODE_HIDDEN, "关闭", false),
                    mode(FIELD_MODE_DEFAULT, "开启", true),
                ]
            };
            GuessFieldDefinition {
                key: (*key).into(),
                label: label.into(),
                field_type: field_type.into(),
                help_text: help.into(),
                configurable: true,
                default_mode: default.into(),
                modes,
                equivalence: true,
            }
        })
        .collect()
}
pub fn default_field_modes() -> FieldModes {
    field_definitions()
        .into_iter()
        .map(|f| (f.key, f.default_mode))
        .collect()
}
pub fn field_mode_valid(key: &str, mode: &str) -> bool {
    if !FIELD_KEYS.contains(&key) {
        return false;
    }
    mode == FIELD_MODE_HIDDEN
        || if key == FIELD_RELEASE_YEAR {
            matches!(mode, FIELD_MODE_EXACT_ONLY | FIELD_MODE_DIRECTIONAL)
        } else {
            mode == FIELD_MODE_DEFAULT
        }
}
pub fn guess_field(key: &str, mode: &str) -> Option<GuessField> {
    if !field_mode_valid(key, mode) || mode == FIELD_MODE_HIDDEN {
        return None;
    }
    let definition = field_definitions().into_iter().find(|f| f.key == key)?;
    let strategy = match key {
        FIELD_FIRST_APPEARANCE => "firstAppearance",
        FIELD_RELEASE_YEAR if mode == FIELD_MODE_EXACT_ONLY => "numberExact",
        FIELD_RELEASE_YEAR => "numberDirection",
        _ => "multiSet",
    };
    Some(GuessField {
        key: definition.key,
        label: definition.label,
        field_type: definition.field_type,
        visible: true,
        compare_strategy: strategy.into(),
        help_text: definition.help_text,
    })
}
pub fn fields_for_modes(modes: &FieldModes) -> Vec<GuessField> {
    FIELD_KEYS
        .iter()
        .filter_map(|key| guess_field(key, modes.get(*key).map(String::as_str).unwrap_or("")))
        .collect()
}
pub fn character_guess_fields() -> Vec<GuessField> {
    fields_for_modes(&default_field_modes())
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CanonicalFieldValue {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub string_value: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub number_value: Option<i32>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub set_value: Vec<String>,
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
    let mut value = CanonicalFieldValue {
        string_value: None,
        number_value: None,
        set_value: vec![],
    };
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
            if values.is_empty() || values.iter().any(|v| !known_string(v)) {
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
pub fn display_values_for_field(character: &Character, key: &str) -> Vec<String> {
    match key {
        FIELD_FIRST_APPEARANCE => vec![character.first_appearance.work_title.clone()],
        FIELD_RELEASE_YEAR => vec![character.first_appearance.release_year.to_string()],
        FIELD_HAIR_COLORS => character
            .hair_colors
            .iter()
            .map(|c| hair_color_label(c).to_owned())
            .collect(),
        _ => set_values(character, key).unwrap_or_default().to_vec(),
    }
}
pub fn hair_color_label(color: &str) -> &str {
    match color {
        "black" => "黑",
        "brown" => "棕",
        "blonde" => "金",
        "white" => "白",
        "silver" => "银",
        "red" => "红",
        "pink" => "粉",
        "purple" => "紫",
        "blue" => "蓝",
        "green" => "绿",
        "orange" => "橙",
        "gray" => "灰",
        "multicolor" => "多色",
        "other" => "其他",
        "none" => "无",
        _ => color,
    }
}
pub fn compare_feedback(
    guess: &Character,
    answer: &Character,
    field: &GuessField,
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
            } else if left.set_value.iter().any(|v| right.set_value.contains(v)) {
                Partial
            } else {
                Miss
            }
        }
    }
}
pub fn status_to_symbol(status: FeedbackStatus) -> &'static str {
    match status {
        FeedbackStatus::Exact => "O",
        FeedbackStatus::Partial => "~",
        FeedbackStatus::Higher => "↑",
        FeedbackStatus::Lower => "↓",
        FeedbackStatus::Unknown => "?",
        FeedbackStatus::Miss => "X",
    }
}
pub fn compare_field(guess: &Character, answer: &Character, field: &GuessField) -> FieldFeedback {
    let status = compare_feedback(guess, answer, field);
    FieldFeedback {
        field: field.key.clone(),
        label: field.label.clone(),
        status,
        symbol: status_to_symbol(status).into(),
        display_value: display_values_for_field(guess, &field.key),
    }
}
pub fn compare_character_with_match(
    guess: &Character,
    answer: &Character,
    fields: Option<&[GuessField]>,
    result: MatchResult,
) -> GuessResult {
    let defaults = character_guess_fields();
    GuessResult {
        kind: "guess".into(),
        guess_id: guess.id.clone(),
        guess_name: guess.names.zh_hans.clone(),
        guess_avatar_url: guess.avatar_url.clone(),
        is_correct: result.correct,
        match_kind: result.kind,
        feedback: fields
            .unwrap_or(&defaults)
            .iter()
            .filter(|f| f.visible)
            .map(|f| compare_field(guess, answer, f))
            .collect(),
    }
}
pub fn equivalence_signature(character: &Character) -> Option<String> {
    #[derive(Serialize)]
    struct SignatureField {
        key: &'static str,
        value: CanonicalFieldValue,
    }
    let signature = FIELD_KEYS
        .iter()
        .map(|key| {
            Some(SignatureField {
                key,
                value: canonical_field_value(character, key)?,
            })
        })
        .collect::<Option<Vec<_>>>()?;
    Some(
        String::from_utf8(
            go_json_bytes(&signature).expect("field signature serialization cannot fail"),
        )
        .expect("JSON is UTF-8"),
    )
}
pub fn equivalent_characters(left: &Character, right: &Character) -> bool {
    matches!((equivalence_signature(left), equivalence_signature(right)), (Some(a), Some(b)) if a == b)
}
