use crate::Error;
use std::str::FromStr;

pub const FIELD_FIRST_APPEARANCE: &str = "firstAppearance";
pub const FIELD_RELEASE_YEAR: &str = "releaseYear";
pub const FIELD_SPECIES: &str = "species";
pub const FIELD_AFFILIATIONS: &str = "affiliations";
pub const FIELD_LOCATIONS: &str = "locations";
pub const FIELD_HAIR_COLORS: &str = "hairColors";

/// The complete, ordered field set used for equivalence, independent of which
/// feedback fields a caller requests.
pub const FIELD_KEYS: [&str; 6] = [
    FIELD_FIRST_APPEARANCE,
    FIELD_RELEASE_YEAR,
    FIELD_SPECIES,
    FIELD_AFFILIATIONS,
    FIELD_LOCATIONS,
    FIELD_HAIR_COLORS,
];

#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct Character {
    pub id: String,
    pub enabled_as_guess: bool,
    pub first_appearance: FirstAppearance,
    pub species: Vec<String>,
    pub affiliations: Vec<String>,
    pub locations: Vec<String>,
    pub hair_colors: Vec<String>,
}

#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct FirstAppearance {
    pub work_id: String,
    pub work_type: String,
    pub release_year: i32,
}

/// A requested feedback field. Ordering and duplicate keys are preserved.
///
/// `numberExact` suppresses year direction. Other strategies retain the
/// field's default comparison behavior; an unknown field yields `Unknown`.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase", default))]
pub struct FieldRule {
    pub key: String,
    pub compare_strategy: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "lowercase"))]
pub enum FeedbackStatus {
    Exact,
    Partial,
    Miss,
    Higher,
    Lower,
    Unknown,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "lowercase"))]
pub enum MatchKind {
    None,
    Exact,
    Equivalent,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "snake_case"))]
pub enum AnswerMatchPolicy {
    Strict,
    PublicFieldsV1,
}

impl FromStr for AnswerMatchPolicy {
    type Err = Error;

    fn from_str(value: &str) -> Result<Self, Self::Err> {
        match value {
            "strict" => Ok(Self::Strict),
            "public_fields_v1" => Ok(Self::PublicFieldsV1),
            _ => Err(Error::UnknownAnswerMatchPolicy(value.into())),
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct MatchResult {
    pub correct: bool,
    pub kind: MatchKind,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
pub struct FieldFeedback {
    pub field: String,
    pub status: FeedbackStatus,
}

#[derive(Clone, Debug, PartialEq, Eq)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct GuessResult {
    pub guess_id: String,
    pub is_correct: bool,
    pub match_kind: MatchKind,
    pub feedback: Vec<FieldFeedback>,
}

/// A normalized semantic value. Known strings remain case and space sensitive;
/// sets are sorted and deduplicated. Unknown values have no canonical value.
#[derive(Clone, Debug, Default, PartialEq, Eq, Hash)]
#[cfg_attr(feature = "serde", derive(serde::Serialize, serde::Deserialize))]
#[cfg_attr(feature = "serde", serde(rename_all = "camelCase"))]
pub struct CanonicalFieldValue {
    #[cfg_attr(feature = "serde", serde(skip_serializing_if = "Option::is_none"))]
    pub string_value: Option<String>,
    #[cfg_attr(feature = "serde", serde(skip_serializing_if = "Option::is_none"))]
    pub number_value: Option<i32>,
    #[cfg_attr(
        feature = "serde",
        serde(default, skip_serializing_if = "Vec::is_empty")
    )]
    pub set_value: Vec<String>,
}
