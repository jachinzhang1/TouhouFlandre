use serde::{Deserialize, Serialize};
use std::{error::Error, sync::Arc};

pub(crate) fn deserialize_null_default<'de, D, T>(deserializer: D) -> Result<T, D::Error>
where
    D: serde::Deserializer<'de>,
    T: Deserialize<'de> + Default,
{
    Ok(Option::<T>::deserialize(deserializer)?.unwrap_or_default())
}

/// A shared wrapper adds a source link instead of forwarding `E::source()`.
/// This preserves the original leaf error when cache waiters clone an Arc:
/// `Arc<E>` by itself forwards source() and can skip E during downcasting.
#[derive(Debug, thiserror::Error)]
#[error("shared catalog source failed")]
pub struct SharedSource(#[source] Box<dyn Error + Send + Sync>);
impl SharedSource {
    pub fn new(source: impl Error + Send + Sync + 'static) -> Arc<Self> {
        Arc::new(Self(Box::new(source)))
    }
}

#[derive(Clone, Debug, thiserror::Error)]
pub enum GameError {
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
    #[error("daily puzzle requires at least one enabled answer")]
    NoEnabledAnswer,
    #[error("invalid search index: character {0:?}")]
    InvalidSearchCharacter(String),
    #[error("invalid search index: empty catalog version")]
    EmptyCatalogVersion,
    #[error("unsupported search index schema: {0}")]
    UnsupportedSearchSchema(i32),
    #[error("catalog snapshot missing")]
    CatalogSnapshotMissing,
    /// Shared cache waiters retain the same cause without making pure game
    /// rules depend on a particular database/transport implementation.
    #[error("catalog source failed")]
    CatalogSource(#[source] Arc<SharedSource>),
    #[error("catalog snapshot invalid")]
    InvalidCatalogSnapshot(#[source] Arc<SharedSource>),
    #[error("invalid search index: marshal failed")]
    SearchSerialization(#[source] Arc<SharedSource>),
    #[error("catalog loader panicked")]
    LoaderPanicked,
    #[error("catalog load ended without a result")]
    LoaderStopped,
}

impl GameError {
    pub fn catalog_source(source: impl Error + Send + Sync + 'static) -> Self {
        Self::CatalogSource(SharedSource::new(source))
    }

    /// Allowlisted diagnostic labels; no character identifiers or input values.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::UnknownAnswerMatchPolicy(_) => "unknown_answer_match_policy",
            Self::MissingCharacterId => "missing_character_id",
            Self::DuplicateCharacterId(_) => "duplicate_character_id",
            Self::GuessMissing => "guess_missing",
            Self::GuessDisabled => "guess_disabled",
            Self::AnswerMissing => "answer_missing",
            Self::NoEnabledAnswer => "no_enabled_answer",
            Self::InvalidSearchCharacter(_) => "invalid_search_character",
            Self::EmptyCatalogVersion => "empty_catalog_version",
            Self::UnsupportedSearchSchema(_) => "unsupported_search_schema",
            Self::CatalogSnapshotMissing => "catalog_snapshot_missing",
            Self::CatalogSource(_) => "catalog_source",
            Self::InvalidCatalogSnapshot(_) => "invalid_catalog_snapshot",
            Self::SearchSerialization(_) => "search_serialization",
            Self::LoaderPanicked => "catalog_loader_panicked",
            Self::LoaderStopped => "catalog_loader_stopped",
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FeedbackStatus {
    Exact,
    Partial,
    Miss,
    Higher,
    Lower,
    Unknown,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MatchKind {
    None,
    Exact,
    Equivalent,
}

pub const FIELD_FIRST_APPEARANCE: &str = "firstAppearance";
pub const FIELD_RELEASE_YEAR: &str = "releaseYear";
pub const FIELD_SPECIES: &str = "species";
pub const FIELD_ABILITY_TAGS: &str = "abilityTags";
pub const FIELD_AFFILIATIONS: &str = "affiliations";
pub const FIELD_LOCATIONS: &str = "locations";
pub const FIELD_ROLES: &str = "roles";
pub const FIELD_HAIR_COLORS: &str = "hairColors";

#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GuessField {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub field_type: String,
    pub visible: bool,
    pub compare_strategy: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub help_text: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuessFieldModeDefinition {
    pub key: String,
    pub label: String,
    pub enabled: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuessFieldDefinition {
    pub key: String,
    pub label: String,
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub help_text: String,
    pub configurable: bool,
    pub default_mode: String,
    #[serde(deserialize_with = "deserialize_null_default")]
    pub modes: Vec<GuessFieldModeDefinition>,
    pub equivalence: bool,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FieldFeedback {
    pub field: String,
    pub label: String,
    pub status: FeedbackStatus,
    pub symbol: String,
    #[serde(deserialize_with = "deserialize_null_default")]
    pub display_value: Vec<String>,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GuessResult {
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub kind: String,
    pub guess_id: String,
    pub guess_name: String,
    #[serde(default, skip_serializing_if = "String::is_empty")]
    pub guess_avatar_url: String,
    pub is_correct: bool,
    pub match_kind: MatchKind,
    #[serde(deserialize_with = "deserialize_null_default")]
    pub feedback: Vec<FieldFeedback>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LocalizedNames {
    pub zh_hans: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub zh_hant: Option<String>,
    pub ja: String,
    pub en: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub romaji: Option<String>,
    #[serde(deserialize_with = "deserialize_null_default")]
    pub aliases: Vec<String>,
}
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct FirstAppearance {
    pub work_id: String,
    pub work_title: String,
    pub work_type: String,
    pub release_year: i32,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mainline_index: Option<i32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub era: Option<String>,
    #[serde(skip_serializing_if = "Vec::is_empty")]
    #[serde(deserialize_with = "deserialize_null_default")]
    pub work_pinyin_initials: Vec<String>,
}
/// Field order is part of the catalog-version contract. Keep it aligned with
/// packages/data and the historical Go encoder; never hash an unordered map.
#[derive(Clone, Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Character {
    pub id: String,
    pub avatar_url: String,
    pub names: LocalizedNames,
    pub first_appearance: FirstAppearance,
    #[serde(deserialize_with = "deserialize_null_default")]
    pub species: Vec<String>,
    pub ability_display: String,
    #[serde(deserialize_with = "deserialize_null_default")]
    pub ability_tags: Vec<String>,
    #[serde(deserialize_with = "deserialize_null_default")]
    pub affiliations: Vec<String>,
    #[serde(deserialize_with = "deserialize_null_default")]
    pub locations: Vec<String>,
    #[serde(deserialize_with = "deserialize_null_default")]
    pub roles: Vec<String>,
    #[serde(deserialize_with = "deserialize_null_default")]
    pub hair_colors: Vec<String>,
    pub playable: bool,
    pub enabled_as_answer: bool,
    pub enabled_as_guess: bool,
    pub difficulty_tier: String,
    #[serde(deserialize_with = "deserialize_null_default")]
    pub source_refs: Vec<String>,
    pub appearance_order: i32,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SinglePlayerModeDefinition {
    pub id: String,
    pub label: String,
    pub puzzle_label: String,
    pub content_type: String,
}
pub fn single_player_mode_definition(mode: &str) -> Option<SinglePlayerModeDefinition> {
    let (label, puzzle_label) = match mode {
        "daily" => ("每日题", "今日每日题"),
        "random" => ("随机题", "随机题"),
        _ => return None,
    };
    Some(SinglePlayerModeDefinition {
        id: mode.into(),
        label: label.into(),
        puzzle_label: puzzle_label.into(),
        content_type: "character".into(),
    })
}
pub fn is_single_player_game_mode(mode: &str) -> bool {
    matches!(mode, "daily" | "random")
}

/// Match encoding/json's default HTML and JavaScript separator escaping for
/// payload hashes and persisted signatures that predate the Rust migration.
pub fn go_json_bytes<T: Serialize>(value: &T) -> Result<Vec<u8>, serde_json::Error> {
    let json = serde_json::to_string(value)?;
    Ok(json
        .replace('&', "\\u0026")
        .replace('<', "\\u003c")
        .replace('>', "\\u003e")
        .replace('\u{2028}', "\\u2028")
        .replace('\u{2029}', "\\u2029")
        .into_bytes())
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GameContentType {
    Character,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GameMode {
    Daily,
    Random,
    Multiplayer,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SessionStatus {
    Playing,
    Won,
    Lost,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct GameContentDefinition {
    pub label: &'static str,
    pub max_guesses: i32,
    pub fields: Vec<GuessField>,
}
pub fn game_content_definition() -> GameContentDefinition {
    GameContentDefinition {
        label: "角色",
        max_guesses: super::QUESTION_SCOPE_DEFAULT_GUESSES,
        fields: super::character_guess_fields(),
    }
}
