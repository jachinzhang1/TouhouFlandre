use super::Character;
use serde::{Deserialize, Serialize};
use std::collections::HashSet;
use unicode_normalization::UnicodeNormalization;

pub fn normalize_search_text(value: &str) -> String {
    // Go unicode.ToLower uses simple one-scalar mappings; Rust's string-level
    // lowercase expands U+0130. Keep one scalar before NFKC for compatibility.
    let lowered: String = value
        .chars()
        .map(|c| c.to_lowercase().next().unwrap_or(c))
        .collect();
    lowered
        .nfkc()
        .filter(|c| !c.is_whitespace() && !matches!(c, '_' | '.' | '・' | '·' | '-'))
        .collect()
}
pub fn character_name_sort_key(character: &Character) -> String {
    normalize_search_text(
        character
            .names
            .romaji
            .as_deref()
            .unwrap_or(&character.names.en),
    )
}
#[derive(Clone, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SearchTerm {
    pub value: String,
    pub source: String,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum SearchTermDomain {
    Character,
    Work,
}
pub fn search_term_domain_for_source(source: &str) -> Option<SearchTermDomain> {
    match source {
        "zhHans" | "zhHant" | "ja" | "en" | "romaji" | "alias" => Some(SearchTermDomain::Character),
        "workTitle" | "workId" | "workPinyinInitials" | "mainlineIndex" => {
            Some(SearchTermDomain::Work)
        }
        _ => None,
    }
}
pub fn search_term_field_priority(source: &str) -> u8 {
    match source {
        "zhHans" | "zhHant" => 0,
        "ja" | "en" | "romaji" => 1,
        "alias" => 2,
        "workTitle" | "workId" | "workPinyinInitials" | "mainlineIndex" => 3,
        _ => 4,
    }
}
pub fn character_search_terms(character: &Character) -> Vec<SearchTerm> {
    let mut values: Vec<(String, &str)> = vec![(character.names.zh_hans.clone(), "zhHans")];
    if let Some(value) = &character.names.zh_hant {
        values.push((value.clone(), "zhHant"));
    }
    values.push((character.names.ja.clone(), "ja"));
    values.push((character.names.en.clone(), "en"));
    if let Some(value) = &character.names.romaji {
        values.push((value.clone(), "romaji"));
    }
    values.extend(character.names.aliases.iter().map(|v| (v.clone(), "alias")));
    values.push((character.first_appearance.work_title.clone(), "workTitle"));
    values.push((character.first_appearance.work_id.clone(), "workId"));
    values.extend(
        character
            .first_appearance
            .work_pinyin_initials
            .iter()
            .map(|v| (v.clone(), "workPinyinInitials")),
    );
    if let Some(index) = character.first_appearance.mainline_index {
        values.push((format!("TH{index:02}"), "mainlineIndex"));
    }
    let mut seen = HashSet::new();
    values
        .into_iter()
        .map(|(value, source)| SearchTerm {
            value: normalize_search_text(&value),
            source: source.into(),
        })
        .filter(|term| !term.value.is_empty() && seen.insert(term.clone()))
        .collect()
}
pub fn character_search_text(character: &Character) -> String {
    character_search_terms(character)
        .into_iter()
        .map(|term| term.value)
        .collect::<Vec<_>>()
        .join(" ")
}
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ParsedSearchQuery {
    pub scoped: bool,
    pub text: String,
    pub character_text: String,
    pub work_text: String,
}
pub fn parse_search_query(input: &str) -> ParsedSearchQuery {
    if let Some((character, work)) = input.split_once('@') {
        ParsedSearchQuery {
            scoped: true,
            character_text: character.trim().into(),
            work_text: work.trim().into(),
            ..Default::default()
        }
    } else {
        ParsedSearchQuery {
            text: input.trim().into(),
            ..Default::default()
        }
    }
}
fn normalized_query(input: &str) -> ParsedSearchQuery {
    let parsed = parse_search_query(input);
    ParsedSearchQuery {
        scoped: parsed.scoped,
        text: normalize_search_text(&parsed.text),
        character_text: normalize_search_text(&parsed.character_text),
        work_text: normalize_search_text(&parsed.work_text),
    }
}
fn terms_for_domain(terms: &[SearchTerm], domain: SearchTermDomain) -> Vec<SearchTerm> {
    terms
        .iter()
        .filter(|t| search_term_domain_for_source(&t.source) == Some(domain))
        .cloned()
        .collect()
}
fn matches_term(query: &str, terms: &[SearchTerm], domain: SearchTermDomain) -> bool {
    terms.iter().any(|t| {
        search_term_domain_for_source(&t.source) == Some(domain) && t.value.contains(query)
    })
}
fn matches_query(query: &ParsedSearchQuery, terms: &[SearchTerm]) -> bool {
    if !query.scoped {
        return query.text.is_empty()
            || matches_term(&query.text, terms, SearchTermDomain::Character);
    }
    (!query.character_text.is_empty() || !query.work_text.is_empty())
        && (query.character_text.is_empty()
            || matches_term(&query.character_text, terms, SearchTermDomain::Character))
        && (query.work_text.is_empty()
            || matches_term(&query.work_text, terms, SearchTermDomain::Work))
}
pub fn match_character_query(character: &Character, query: &str) -> bool {
    matches_query(&normalized_query(query), &character_search_terms(character))
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SearchMatchKind {
    Exact,
    Prefix,
    Substring,
}
#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchMatchRank {
    pub kind: SearchMatchKind,
    pub field_priority: u8,
    pub position: usize,
    pub length_gap: usize,
}
pub fn rank_search_terms(query: &str, terms: &[SearchTerm]) -> Option<SearchMatchRank> {
    if query.is_empty() {
        return None;
    }
    let length = query.chars().count();
    terms
        .iter()
        .filter_map(|term| {
            let byte_position = term.value.find(query)?;
            let position = term.value[..byte_position].chars().count();
            let term_length = term.value.chars().count();
            let kind = if position == 0 {
                if term_length == length {
                    SearchMatchKind::Exact
                } else {
                    SearchMatchKind::Prefix
                }
            } else {
                SearchMatchKind::Substring
            };
            Some(SearchMatchRank {
                kind,
                field_priority: search_term_field_priority(&term.source),
                position,
                length_gap: term_length - length,
            })
        })
        .min()
}
fn rank_query(query: &ParsedSearchQuery, terms: &[SearchTerm]) -> Option<Vec<SearchMatchRank>> {
    if !query.scoped {
        return Some(vec![rank_search_terms(
            &query.text,
            &terms_for_domain(terms, SearchTermDomain::Character),
        )?]);
    }
    let mut ranks = vec![];
    for (text, domain) in [
        (&query.character_text, SearchTermDomain::Character),
        (&query.work_text, SearchTermDomain::Work),
    ] {
        if !text.is_empty() {
            ranks.push(rank_search_terms(text, &terms_for_domain(terms, domain))?);
        }
    }
    Some(ranks)
}
#[derive(Clone, Debug)]
pub enum CharacterSearchFilter {
    EnabledAsGuess,
    CharacterIds(HashSet<String>),
    WorkIds(HashSet<String>),
}
impl CharacterSearchFilter {
    pub fn character_ids(ids: &[String]) -> Self {
        Self::CharacterIds(ids.iter().filter(|id| !id.is_empty()).cloned().collect())
    }
    pub fn work_ids(ids: &[String]) -> Self {
        Self::WorkIds(ids.iter().filter(|id| !id.is_empty()).cloned().collect())
    }
    fn matches(&self, c: &Character) -> bool {
        match self {
            Self::EnabledAsGuess => c.enabled_as_guess,
            Self::CharacterIds(ids) => ids.contains(&c.id),
            Self::WorkIds(ids) => ids.contains(&c.first_appearance.work_id),
        }
    }
}
#[derive(Clone, Debug, Default)]
pub struct CharacterSearchOptions {
    pub query: String,
    pub filters: Vec<CharacterSearchFilter>,
    pub sort_by: String,
    pub descending: bool,
    pub offset: i64,
    pub limit: i64,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CharacterSearchPage {
    pub characters: Vec<Character>,
    pub total: usize,
}
pub fn search_characters(
    characters: &[Character],
    options: &CharacterSearchOptions,
) -> CharacterSearchPage {
    let query = normalized_query(&options.query);
    let relevance = options.sort_by == "relevance"
        && if query.scoped {
            !query.character_text.is_empty() || !query.work_text.is_empty()
        } else {
            !query.text.is_empty()
        };
    let mut matches: Vec<_> = characters
        .iter()
        .filter(|c| options.filters.iter().all(|f| f.matches(c)))
        .filter_map(|c| {
            let terms = character_search_terms(c);
            if !matches_query(&query, &terms) {
                return None;
            }
            Some((
                c,
                if relevance {
                    rank_query(&query, &terms)
                } else {
                    None
                },
            ))
        })
        .collect();
    matches.sort_by(|(left, left_rank), (right, right_rank)| {
        if options.sort_by == "relevance" {
            if relevance {
                match (left_rank, right_rank) {
                    (Some(a), Some(b)) if a != b => {
                        return if options.descending {
                            b.cmp(a)
                        } else {
                            a.cmp(b)
                        };
                    }
                    (Some(_), None) => return std::cmp::Ordering::Less,
                    (None, Some(_)) => return std::cmp::Ordering::Greater,
                    _ => {}
                }
            }
            return left
                .appearance_order
                .cmp(&right.appearance_order)
                .then_with(|| left.id.cmp(&right.id));
        }
        let cmp = if options.sort_by == "appearance" {
            left.appearance_order.cmp(&right.appearance_order)
        } else {
            character_name_sort_key(left).cmp(&character_name_sort_key(right))
        };
        if cmp.is_eq() {
            left.id.cmp(&right.id)
        } else if options.descending {
            cmp.reverse()
        } else {
            cmp
        }
    });
    let total = matches.len();
    let start = (options.offset.max(0) as usize).min(total);
    let end = if options.limit < 0 {
        total
    } else {
        start.saturating_add(options.limit as usize).min(total)
    };
    CharacterSearchPage {
        characters: matches[start..end]
            .iter()
            .map(|(c, _)| (*c).clone())
            .collect(),
        total,
    }
}
