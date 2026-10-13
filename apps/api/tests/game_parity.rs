use serde::Deserialize;
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};
use touhouflandre_api::game::*;

const SEARCH_PARITY: &str =
    include_str!("../../../docs/hybrid-search-optimization/fixtures/search-parity-v2.json");
const SCOPED_PARITY: &str =
    include_str!("../../../docs/hybrid-search-optimization/fixtures/scoped-search-v1.json");
const SEARCH_RANKING: &str =
    include_str!("../../../docs/hybrid-search-optimization/fixtures/search-ranking-v2.json");
// Generated once from the original Go game package before replacement. It is
// independent of the Rust implementation and preserves its exact wire bytes.
const GO_REFERENCE: &str = include_str!("../src/game/fixtures/go-reference.json");

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchFixture {
    contract: String,
    catalog_version: String,
    index_schema_version: i32,
    characters: Vec<Character>,
    cases: Vec<SearchCase>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct SearchCase {
    name: String,
    query: String,
    selected_character_ids: Option<Vec<String>>,
    work_ids: Option<Vec<String>>,
    sort_by: String,
    descending: bool,
    offset: i64,
    limit: i64,
    expected: SearchExpected,
}
#[derive(Deserialize)]
struct SearchExpected {
    ids: Vec<String>,
    total: usize,
}
fn assert_search_fixture(source: &str, count: usize, contract: &str) {
    let fixture: SearchFixture = serde_json::from_str(source).unwrap();
    assert_eq!(fixture.contract, contract);
    assert_eq!(fixture.cases.len(), count);
    for case in fixture.cases {
        let mut filters = vec![CharacterSearchFilter::EnabledAsGuess];
        if let Some(ids) = case.selected_character_ids {
            filters.push(CharacterSearchFilter::character_ids(&ids));
        }
        if let Some(ids) = case.work_ids {
            filters.push(CharacterSearchFilter::work_ids(&ids));
        }
        let actual = search_characters(
            &fixture.characters,
            &CharacterSearchOptions {
                query: case.query,
                filters,
                sort_by: case.sort_by,
                descending: case.descending,
                offset: case.offset,
                limit: case.limit,
            },
        );
        assert_eq!(actual.total, case.expected.total, "{} total", case.name);
        assert_eq!(
            actual
                .characters
                .iter()
                .map(|c| c.id.clone())
                .collect::<Vec<_>>(),
            case.expected.ids,
            "{} IDs",
            case.name
        );
    }
}
#[test]
fn shared_search_parity_23_cases() {
    assert_search_fixture(SEARCH_PARITY, 23, "hso.search-parity.v2");
}
#[test]
fn shared_scoped_search_parity_16_cases() {
    assert_search_fixture(SCOPED_PARITY, 16, "hso.scoped-search.v1");
}
#[derive(Deserialize)]
struct RankingFixture {
    contract: String,
    cases: Vec<RankingCase>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RankingCase {
    name: String,
    query: String,
    descending: bool,
    entries: Vec<RankingEntry>,
    expected_ids: Vec<String>,
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct RankingEntry {
    id: String,
    appearance_order: i32,
    search_terms: Vec<SearchTerm>,
    expected_rank: Option<SearchMatchRank>,
}
#[test]
fn shared_ranking_fixture_checks_rune_offsets_and_ties() {
    let fixture: RankingFixture = serde_json::from_str(SEARCH_RANKING).unwrap();
    assert_eq!(fixture.contract, "hso.search-ranking.v2");
    assert!(!fixture.cases.is_empty());
    for case in fixture.cases {
        let mut ranked = vec![];
        for entry in case.entries {
            let rank = rank_search_terms(&case.query, &entry.search_terms);
            assert_eq!(
                rank, entry.expected_rank,
                "{}: {} rank",
                case.name, entry.id
            );
            if case.query.is_empty() || rank.is_some() {
                ranked.push((entry, rank));
            }
        }
        ranked.sort_by(|(a, a_rank), (b, b_rank)| {
            if let (Some(left), Some(right)) = (a_rank, b_rank)
                && left != right
            {
                return if case.descending {
                    right.cmp(left)
                } else {
                    left.cmp(right)
                };
            }
            a.appearance_order
                .cmp(&b.appearance_order)
                .then_with(|| a.id.cmp(&b.id))
        });
        assert_eq!(
            ranked
                .into_iter()
                .map(|(entry, _)| entry.id)
                .collect::<Vec<_>>(),
            case.expected_ids,
            "{} order",
            case.name
        );
    }
}
#[test]
fn search_snapshot_bytes_and_etag_match_pre_migration_go() {
    let fixture: SearchFixture = serde_json::from_str(SEARCH_PARITY).unwrap();
    let reference: Value = serde_json::from_str(GO_REFERENCE).unwrap();
    let actual = build_catalog_search_snapshot(
        &fixture.catalog_version,
        fixture.index_schema_version,
        &fixture.characters,
    )
    .unwrap();
    assert_eq!(
        String::from_utf8(actual.payload.clone()).unwrap(),
        reference["payload"].as_str().unwrap()
    );
    assert_eq!(actual.etag, reference["etag"].as_str().unwrap());
    assert_eq!(
        serde_json::to_value(actual.index).unwrap(),
        reference["index"]
    );
    assert_eq!(
        serde_json::to_value(field_definitions()).unwrap(),
        reference["definitions"]
    );
    let decoded: Vec<GuessFieldDefinition> =
        serde_json::from_value(reference["definitions"].clone()).unwrap();
    assert_eq!(decoded, field_definitions());
}
#[test]
fn snapshot_rejects_invalid_source_and_schema() {
    let mut characters: Vec<Character> = serde_json::from_str::<SearchFixture>(SEARCH_PARITY)
        .unwrap()
        .characters;
    assert!(build_catalog_search_snapshot(" ", 2, &characters).is_err());
    assert!(build_catalog_search_snapshot("v1", 1, &characters).is_err());
    characters[0].id.clear();
    assert!(build_catalog_search_snapshot("v1", 2, &characters).is_err());
    characters[0].enabled_as_guess = false;
    assert!(build_catalog_search_snapshot("v1", 2, &characters).is_ok());
    characters[1].names.en.clear();
    characters[1].names.romaji = Some(String::new());
    assert!(build_catalog_search_snapshot("v1", 2, &characters).is_err());
}
#[test]
fn snapshot_nil_slices_and_go_html_escaping_are_stable() {
    let character = Character {
        id: "a<&>".into(),
        names: LocalizedNames {
            zh_hans: "😀星光".into(),
            en: "A\u{2028}B\u{2029}".into(),
            ..Default::default()
        },
        enabled_as_guess: true,
        ..Default::default()
    };
    let snapshot = build_catalog_search_snapshot("v1", 2, &[character]).unwrap();
    assert_eq!(snapshot.index.entries[0].initials, "😀星");
    let payload = String::from_utf8(snapshot.payload).unwrap();
    assert!(payload.contains("a\\u003c\\u0026\\u003e"));
    assert!(payload.contains("\\u2028"));
    assert!(payload.contains("\\u2029"));
    assert!(payload.contains("\"species\":null"));
    let decoded: CatalogSearchIndex = serde_json::from_str(&payload).unwrap();
    assert!(decoded.entries[0].species.is_empty());
}
#[test]
fn unicode_normalization_and_query_boundaries() {
    assert_eq!(normalize_search_text(" ＴＨ０６_・·.- \t"), "th06");
    assert_eq!(normalize_search_text("İ"), "i");
    assert_eq!(
        parse_search_query("  霊夢 @ 東方@作品  "),
        ParsedSearchQuery {
            scoped: true,
            text: String::new(),
            character_text: "霊夢".into(),
            work_text: "東方@作品".into()
        }
    );
    assert!(!parse_search_query("霊夢＠東方").scoped);
    let mut c = equivalent_fixture("a");
    c.names.en = "boundary".into();
    c.names.aliases = vec!["negative".into()];
    assert!(!match_character_query(&c, "boundarynegative"));
    assert!(!match_character_query(&c, "@"));
    assert!(!match_character_query(&c, "work"));
    assert!(match_character_query(&c, "@work"));
    assert_eq!(search_term_field_priority("future"), 4);
    assert_eq!(search_term_domain_for_source("future"), None);
}
fn equivalent_fixture(id: &str) -> Character {
    Character {
        id: id.into(),
        names: LocalizedNames {
            zh_hans: id.into(),
            en: id.into(),
            ..Default::default()
        },
        first_appearance: FirstAppearance {
            work_id: "work".into(),
            work_title: "Work".into(),
            work_type: "game".into(),
            release_year: 2000,
            ..Default::default()
        },
        species: vec!["youkai".into(), "magician".into()],
        affiliations: vec!["group".into()],
        locations: vec!["place".into()],
        hair_colors: vec!["red".into(), "blue".into()],
        enabled_as_answer: true,
        enabled_as_guess: true,
        ..Default::default()
    }
}
#[test]
fn canonical_signature_matches_go_and_equivalence_ignores_set_order_and_duplicates() {
    let a = equivalent_fixture("a");
    let mut b = equivalent_fixture("b");
    b.species = vec!["magician".into(), "youkai".into(), "magician".into()];
    b.hair_colors.reverse();
    assert!(equivalent_characters(&a, &b));
    let reference: Value = serde_json::from_str(GO_REFERENCE).unwrap();
    assert_eq!(
        equivalence_signature(&a).unwrap(),
        reference["signature"].as_str().unwrap()
    );
    let runtime = build_catalog_runtime("v1", AnswerMatchPolicy::PublicFieldsV1, &[b, a]).unwrap();
    assert_eq!(runtime.group_key("a"), "equivalent:a");
    assert_eq!(runtime.group_key("b"), "equivalent:a");
    assert_eq!(
        runtime.distinct_ids_by_group(&["b".into(), "a".into(), "unknown".into()]),
        vec!["b", "unknown"]
    );
}
#[test]
fn equivalence_unknowns_disabled_and_full_public_fields_do_not_merge() {
    let answer = equivalent_fixture("answer");
    let equivalent = equivalent_fixture("equivalent");
    let mut different = equivalent_fixture("different");
    different.locations = vec!["elsewhere".into()];
    let mut disabled = equivalent_fixture("disabled");
    disabled.enabled_as_guess = false;
    let mut unknown_a = equivalent_fixture("unknown-a");
    unknown_a.locations.clear();
    let mut unknown_b = unknown_a.clone();
    unknown_b.id = "unknown-b".into();
    let chars = vec![
        answer, equivalent, different, disabled, unknown_a, unknown_b,
    ];
    let runtime = build_catalog_runtime("v1", AnswerMatchPolicy::PublicFieldsV1, &chars).unwrap();
    assert_ne!(
        runtime.group_key("unknown-a"),
        runtime.group_key("unknown-b")
    );
    assert_ne!(runtime.group_key("answer"), runtime.group_key("disabled"));
    let fields = vec![guess_field(FIELD_SPECIES, FIELD_MODE_DEFAULT).unwrap()];
    assert_eq!(
        runtime
            .evaluate_guess("answer", "equivalent", Some(&fields))
            .unwrap()
            .match_kind,
        MatchKind::Equivalent
    );
    assert!(
        !runtime
            .evaluate_guess("answer", "different", Some(&fields))
            .unwrap()
            .is_correct
    );
    assert_eq!(
        runtime
            .evaluate_guess("answer", "disabled", None)
            .unwrap_err()
            .to_string(),
        "guess character disabled"
    );
    assert_eq!(
        runtime
            .evaluate_guess("answer", "absent", None)
            .unwrap_err()
            .to_string(),
        "guess character missing"
    );
    assert_eq!(
        runtime
            .evaluate_guess("absent", "answer", None)
            .unwrap_err()
            .to_string(),
        "answer character missing"
    );
    assert_eq!(
        runtime
            .evaluate_guess("answer", "answer", Some(&[]))
            .unwrap()
            .feedback
            .len(),
        0
    );
    let strict = build_catalog_runtime("v1", AnswerMatchPolicy::Strict, &chars).unwrap();
    assert!(!strict.match_answer("answer", "equivalent").correct);
    assert_eq!(
        strict.match_answer("answer", "answer").kind,
        MatchKind::Exact
    );
    assert!(
        build_catalog_runtime("v1", AnswerMatchPolicy::Strict, &[Character::default()]).is_err()
    );
    assert!(
        build_catalog_runtime(
            "v1",
            AnswerMatchPolicy::Strict,
            &[chars[0].clone(), chars[0].clone()]
        )
        .is_err()
    );
    assert!("future".parse::<AnswerMatchPolicy>().is_err());
}
#[test]
fn field_feedback_handles_unknowns_direction_exact_only_and_partial_sets() {
    use FeedbackStatus::*;
    let answer = equivalent_fixture("a");
    let mut guess = answer.clone();
    let field = guess_field(FIELD_RELEASE_YEAR, FIELD_MODE_DIRECTIONAL).unwrap();
    guess.first_appearance.release_year = 1999;
    assert_eq!(compare_feedback(&guess, &answer, &field), Higher);
    guess.first_appearance.release_year = 2001;
    assert_eq!(compare_feedback(&guess, &answer, &field), Lower);
    assert_eq!(
        compare_feedback(
            &guess,
            &answer,
            &guess_field(FIELD_RELEASE_YEAR, FIELD_MODE_EXACT_ONLY).unwrap()
        ),
        Miss
    );
    guess.first_appearance.release_year = 0;
    assert_eq!(compare_feedback(&guess, &answer, &field), Unknown);
    let field = guess_field(FIELD_FIRST_APPEARANCE, FIELD_MODE_DEFAULT).unwrap();
    guess.first_appearance.work_id = "other".into();
    assert_eq!(compare_feedback(&guess, &answer, &field), Partial);
    guess.first_appearance.work_type = "book".into();
    assert_eq!(compare_feedback(&guess, &answer, &field), Miss);
    guess.first_appearance.work_id = " UnKnOwN ".into();
    assert_eq!(compare_feedback(&guess, &answer, &field), Unknown);
    let field = guess_field(FIELD_HAIR_COLORS, FIELD_MODE_DEFAULT).unwrap();
    for (colors, status) in [
        (vec!["red", "blue", "red"], Exact),
        (vec!["red"], Partial),
        (vec!["green"], Miss),
        (vec![], Unknown),
        (vec!["未知"], Unknown),
        (vec![" "], Unknown),
    ] {
        guess.hair_colors = colors.into_iter().map(String::from).collect();
        assert_eq!(compare_feedback(&guess, &answer, &field), status);
    }
    guess.hair_colors = vec!["none".into(), "teal".into()];
    assert_eq!(
        display_values_for_field(&guess, FIELD_HAIR_COLORS),
        vec!["无", "teal"]
    );
    assert!(!field_mode_valid("future", "default"));
    assert!(guess_field(FIELD_SPECIES, FIELD_MODE_HIDDEN).is_none());
    let feedback = compare_character_with_match(
        &answer,
        &answer,
        None,
        MatchResult {
            correct: true,
            kind: MatchKind::Exact,
        },
    );
    assert_eq!(feedback.feedback.len(), 6);
    assert!(feedback.feedback.iter().all(|f| f.status == Exact));
}
#[test]
fn daily_timezone_rune_hash_and_deterministic_answer() {
    let date = chrono::DateTime::parse_from_rfc3339("2026-08-02T16:30:00Z").unwrap();
    assert_eq!(puzzle_date_key(&date), "2026-08-03");
    let reference: Value = serde_json::from_str(GO_REFERENCE).unwrap();
    for (value, hash) in reference["hashes"].as_object().unwrap() {
        assert_eq!(
            hash_string(value),
            hash.as_u64().unwrap() as u32,
            "hash {value}"
        );
    }
    let pool = vec![
        equivalent_fixture("a"),
        equivalent_fixture("b"),
        equivalent_fixture("c"),
    ];
    let mut reversed = pool.clone();
    reversed.reverse();
    assert_eq!(
        daily_answer(&pool, "2026-08-03").unwrap().id,
        daily_answer(&reversed, "2026-08-03").unwrap().id
    );
    let mut disabled = equivalent_fixture("disabled");
    disabled.enabled_as_answer = false;
    assert!(daily_answer(&[disabled], "2026-08-03").is_err());
    assert!(daily_answer_from_pool(&[], "2026-08-03").is_err());
}
#[test]
fn question_scope_25_pre_migration_go_reference_cases() {
    let reference: Value = serde_json::from_str(GO_REFERENCE).unwrap();
    let characters: Vec<Character> =
        serde_json::from_value(reference["scopeCharacters"].clone()).unwrap();
    let works = vec![
        QuestionScopeWork { id: "work".into() },
        QuestionScopeWork { id: "empty".into() },
    ];
    let cases = reference["scopeCases"].as_array().unwrap();
    assert_eq!(cases.len(), 25);
    for case in cases {
        let input: QuestionScopeConfig = serde_json::from_value(case["input"].clone()).unwrap();
        let actual = normalize_question_scope(
            Some(&input),
            case["version"].as_str().unwrap(),
            &works,
            &characters,
        );
        assert_eq!(
            serde_json::to_value(actual.config).unwrap(),
            case["expected"]["Config"],
            "{} config",
            case["name"]
        );
        assert_eq!(
            actual.changed,
            case["expected"]["Changed"].as_bool().unwrap(),
            "{} changed",
            case["name"]
        );
        assert_eq!(
            actual.reason,
            case["expected"]["Reason"].as_str().unwrap(),
            "{} reason",
            case["name"]
        );
    }
}
#[test]
fn scope_presets_limits_and_storage_visibility() {
    let easy = preset_question_scope_rules("easy");
    assert_eq!(effective_question_scope_max_guesses(&easy), 999);
    let hard = preset_question_scope_rules("hard");
    assert!(hard.turn_limit.enabled);
    assert_eq!(hard.turn_limit.seconds, 45);
    assert_ne!(hard.field_modes[FIELD_FIRST_APPEARANCE], FIELD_MODE_HIDDEN);
    assert!(is_question_difficulty_preset("extra"));
    assert!(!is_daily_question_difficulty("extra"));
    assert!(!is_daily_question_difficulty("custom"));
    let mut scope = default_question_scope("v1", &[], &[equivalent_fixture("a")], "normal");
    scope
        .rules
        .field_modes
        .insert(FIELD_FIRST_APPEARANCE.into(), FIELD_MODE_HIDDEN.into());
    scope
        .rules
        .field_modes
        .insert(FIELD_RELEASE_YEAR.into(), FIELD_MODE_EXACT_ONLY.into());
    assert_eq!(fields_for_question_scope(&scope).len(), 5);
    assert_eq!(storage_fields_for_question_scope(&scope).len(), 6);
    assert_eq!(
        storage_fields_for_question_scope(&scope)
            .iter()
            .find(|f| f.key == FIELD_RELEASE_YEAR)
            .unwrap()
            .compare_strategy,
        "numberExact"
    );
    let mut rules = scope.rules;
    rules.guess_limit = QuestionScopeGuessLimit {
        enabled: true,
        max_guesses: 1,
    };
    assert_eq!(effective_question_scope_max_guesses(&rules), 1);
    rules.guess_limit.max_guesses = 100;
    rules.turn_limit.seconds = 200;
    let rules = normalize_question_scope_rules(&rules);
    assert_eq!(rules.guess_limit.max_guesses, 20);
    assert_eq!(rules.turn_limit.seconds, 120);
}

#[tokio::test]
async fn snapshot_provider_coalesces_24_readers_and_defends_cached_data() {
    let loads = Arc::new(AtomicUsize::new(0));
    let (release, gate) = tokio::sync::watch::channel(false);
    let count = Arc::clone(&loads);
    let source = CatalogSearchSourceProvider::new(move |_| {
        let count = Arc::clone(&count);
        let mut gate = gate.clone();
        async move {
            count.fetch_add(1, Ordering::SeqCst);
            gate.wait_for(|ready| *ready)
                .await
                .map_err(GameError::catalog_source)?;
            Ok(vec![equivalent_fixture("a")])
        }
    });
    let provider = CatalogSearchSnapshotProvider::new(source.clone());
    let mut readers = vec![];
    for _ in 0..24 {
        let provider = provider.clone();
        readers.push(tokio::spawn(
            async move { provider.get("v1", 2).await.unwrap() },
        ));
    }
    tokio::task::yield_now().await;
    release.send(true).unwrap();
    for reader in readers {
        assert_eq!(reader.await.unwrap().index.entries[0].id, "a");
    }
    assert_eq!(loads.load(Ordering::SeqCst), 1);
    let mut value = provider.get("v1", 2).await.unwrap();
    value.index.entries[0].species.clear();
    value.payload.clear();
    let pristine = provider.get("v1", 2).await.unwrap();
    assert_eq!(
        pristine.index.entries[0].species,
        vec!["youkai", "magician"]
    );
    assert!(!pristine.payload.is_empty());
    let mut source_value = source.get("v1").await.unwrap();
    source_value[0].names.en = "mutated".into();
    assert_eq!(source.get("v1").await.unwrap()[0].names.en, "a");
}
#[tokio::test]
async fn shared_cache_cancellation_does_not_cancel_load_or_other_readers() {
    let cache = SharedLru::<String, usize>::new(2);
    let loads = Arc::new(AtomicUsize::new(0));
    let (started, began) = tokio::sync::oneshot::channel();
    let (release, gate) = tokio::sync::oneshot::channel();
    let first_cache = Arc::clone(&cache);
    let count = Arc::clone(&loads);
    let first = tokio::spawn(async move {
        first_cache
            .get("a".into(), move || async move {
                count.fetch_add(1, Ordering::SeqCst);
                started.send(()).unwrap();
                gate.await.unwrap();
                Ok(7)
            })
            .await
    });
    began.await.unwrap();
    first.abort();
    let second_cache = Arc::clone(&cache);
    let second = tokio::spawn(async move {
        second_cache
            .get("a".into(), || async { panic!("duplicate load") })
            .await
    });
    tokio::task::yield_now().await;
    release.send(()).unwrap();
    assert_eq!(
        *tokio::time::timeout(Duration::from_secs(2), second)
            .await
            .unwrap()
            .unwrap()
            .unwrap(),
        7
    );
    assert_eq!(loads.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn shared_cache_retries_failure_and_evicts_least_recently_used() {
    let cache = SharedLru::<String, usize>::new(2);
    assert!(
        cache
            .get("a".into(), || async {
                Err(GameError::catalog_source(std::io::Error::other(
                    "transient",
                )))
            })
            .await
            .is_err()
    );
    assert!(cache.is_empty());
    assert_eq!(*cache.get("a".into(), || async { Ok(1) }).await.unwrap(), 1);
    cache.get("b".into(), || async { Ok(2) }).await.unwrap();
    cache
        .get("a".into(), || async { panic!("already cached") })
        .await
        .unwrap();
    cache.get("c".into(), || async { Ok(3) }).await.unwrap();
    assert_eq!(cache.len(), 2);
    assert!(cache.contains(&"a".into()));
    assert!(!cache.contains(&"b".into()));
    assert!(cache.contains(&"c".into()));
}
#[tokio::test]
async fn runtime_provider_freezes_catalog_and_policy_with_custom_loaders() {
    let calls = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&calls);
    let provider = CatalogRuntimeProvider::new(move |_| {
        let count = Arc::clone(&count);
        async move {
            count.fetch_add(1, Ordering::SeqCst);
            Ok(vec![equivalent_fixture("default")])
        }
    });
    let a = provider
        .get_with_loader("v1", AnswerMatchPolicy::PublicFieldsV1, |_| async {
            Ok(vec![equivalent_fixture("a"), equivalent_fixture("b")])
        })
        .await
        .unwrap();
    let b = provider
        .get("v1", AnswerMatchPolicy::PublicFieldsV1)
        .await
        .unwrap();
    assert!(Arc::ptr_eq(&a, &b));
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    assert_eq!(
        provider
            .evaluate_guess("v1", AnswerMatchPolicy::PublicFieldsV1, "a", "b", None)
            .await
            .unwrap()
            .match_kind,
        MatchKind::Equivalent
    );
    let strict = provider.get("v1", AnswerMatchPolicy::Strict).await.unwrap();
    assert!(strict.by_id.contains_key("default"));
    assert_eq!(calls.load(Ordering::SeqCst), 1);
    provider.get("v2", AnswerMatchPolicy::Strict).await.unwrap();
    assert_eq!(calls.load(Ordering::SeqCst), 2);
}
#[test]
fn stored_guess_and_mode_wire_contracts() {
    assert_eq!(
        match_kind_for_stored_guess(false, "a", "b"),
        MatchKind::None
    );
    assert_eq!(
        match_kind_for_stored_guess(true, "a", "b"),
        MatchKind::Equivalent
    );
    assert_eq!(
        match_kind_for_stored_guess(true, "a", "a"),
        MatchKind::Exact
    );
    assert_eq!(
        serde_json::to_value(single_player_mode_definition("daily").unwrap()).unwrap(),
        json!({"id":"daily","label":"每日题","puzzleLabel":"今日每日题","contentType":"character"})
    );
    assert!(is_single_player_game_mode("random"));
    assert!(!is_single_player_game_mode("multiplayer"));
    let statuses: HashMap<_, _> = [
        (FeedbackStatus::Exact, "O"),
        (FeedbackStatus::Partial, "~"),
        (FeedbackStatus::Miss, "X"),
        (FeedbackStatus::Higher, "↑"),
        (FeedbackStatus::Lower, "↓"),
        (FeedbackStatus::Unknown, "?"),
    ]
    .map(|(status, symbol)| (serde_json::to_string(&status).unwrap(), symbol))
    .into();
    for status in [
        FeedbackStatus::Exact,
        FeedbackStatus::Partial,
        FeedbackStatus::Miss,
        FeedbackStatus::Higher,
        FeedbackStatus::Lower,
        FeedbackStatus::Unknown,
    ] {
        assert_eq!(
            status_to_symbol(status),
            statuses[&serde_json::to_string(&status).unwrap()]
        );
    }
}

#[tokio::test]
async fn snapshot_validation_precedes_loading_and_projection_failure_preserves_source() {
    let loads = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&loads);
    let source = CatalogSearchSourceProvider::new(move |_| {
        let count = Arc::clone(&count);
        async move {
            count.fetch_add(1, Ordering::SeqCst);
            Ok(vec![equivalent_fixture("a")])
        }
    });
    let builds = Arc::new(AtomicUsize::new(0));
    let count = Arc::clone(&builds);
    let provider = CatalogSearchSnapshotProvider::with_builder(
        source.clone(),
        move |version, schema, characters| {
            if count.fetch_add(1, Ordering::SeqCst) == 0 {
                Err(GameError::catalog_source(std::io::Error::other(
                    "temporary projection error",
                )))
            } else {
                build_catalog_search_snapshot(version, schema, characters)
            }
        },
    );
    assert!(provider.get("v1", 1).await.is_err());
    assert!(provider.get("", 2).await.is_err());
    assert_eq!(loads.load(Ordering::SeqCst), 0);
    assert_eq!(builds.load(Ordering::SeqCst), 0);
    assert!(provider.get("v1", 2).await.is_err());
    assert_eq!(source.get("v1").await.unwrap()[0].id, "a");
    assert_eq!(
        provider.get("v1", 2).await.unwrap().index.entries[0].id,
        "a"
    );
    assert_eq!(loads.load(Ordering::SeqCst), 1);
    assert_eq!(builds.load(Ordering::SeqCst), 2);
}

#[test]
fn search_metrics_only_emit_fixed_labels_and_original_histogram_buckets() {
    let metrics = SearchMetrics::default();
    metrics.inc_policy_outcome("query-secret");
    metrics.inc_provider_outcome("catalog-v1", "hit");
    metrics.inc_fallback_reason("");
    metrics.inc_fallback_reason("room-secret");
    metrics.inc_remote_outcome("success");
    metrics.observe_index_build(Duration::from_millis(1));
    metrics.observe_remote_latency(Duration::from_millis(2));
    let text = metrics.prometheus_text();
    assert!(text.contains("touhouflandre_search_policy_total{outcome=\"unknown\"} 1"));
    assert!(text.contains("touhouflandre_search_fallback_reason_total{reason=\"none\"} 1"));
    assert!(text.contains("touhouflandre_search_fallback_reason_total{reason=\"unknown\"} 1"));
    assert!(text.contains("touhouflandre_search_remote_total{outcome=\"success\"} 1"));
    assert!(text.contains("touhouflandre_search_remote_latency_seconds_bucket{le=\"0.001\"} 0"));
    assert!(text.contains("touhouflandre_search_remote_latency_seconds_bucket{le=\"0.005\"} 1"));
    assert!(text.contains("touhouflandre_search_remote_latency_seconds_bucket{le=\"5\"} 1"));
    assert!(
        !text.contains("query-secret")
            && !text.contains("catalog-v1")
            && !text.contains("room-secret")
    );
    assert_eq!(text.matches("# TYPE ").count(), 7);
}

#[tokio::test]
async fn provider_metrics_distinguish_cache_hits_load_failures_and_build_failures() {
    let metrics = Arc::new(SearchMetrics::default());
    let loads = Arc::new(AtomicUsize::new(0));
    let build_attempts = Arc::new(AtomicUsize::new(0));
    let source = CatalogSearchSourceProvider::new({
        let loads = loads.clone();
        move |_| {
            let loads = loads.clone();
            async move {
                if loads.fetch_add(1, Ordering::SeqCst) == 0 {
                    return Err(GameError::catalog_source(std::io::Error::other(
                        "unavailable",
                    )));
                }
                Ok(vec![equivalent_fixture("a")])
            }
        }
    })
    .with_metrics(metrics.clone());
    let snapshots = CatalogSearchSnapshotProvider::with_builder(source, {
        let builds = build_attempts.clone();
        move |version, schema, characters| {
            if builds.fetch_add(1, Ordering::SeqCst) == 0 {
                return Err(GameError::catalog_source(std::io::Error::other(
                    "invalid projection",
                )));
            }
            build_catalog_search_snapshot(version, schema, characters)
        }
    });
    assert!(snapshots.get("v1", 2).await.is_err());
    assert!(snapshots.get("v1", 2).await.is_err());
    snapshots.get("v1", 2).await.unwrap();
    snapshots.get("v1", 2).await.unwrap();
    assert_eq!(loads.load(Ordering::SeqCst), 2);
    assert_eq!(build_attempts.load(Ordering::SeqCst), 2);
    let text = metrics.prometheus_text();
    for (family, outcome, count) in [
        ("source", "miss", 2),
        ("source", "hit", 1),
        ("source", "load_error", 1),
        ("source", "load_success", 1),
        ("snapshot", "miss", 3),
        ("snapshot", "hit", 1),
        ("snapshot", "load_error", 1),
        ("snapshot", "build_error", 1),
        ("snapshot", "build_success", 1),
    ] {
        assert!(
            text.contains(&format!(
                "touhouflandre_search_{family}_total{{outcome=\"{outcome}\"}} {count}"
            )),
            "{text}"
        );
    }
    assert!(text.contains("touhouflandre_search_index_build_seconds_count 2"));
}
