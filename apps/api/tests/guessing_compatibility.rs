//! Frozen pre-extraction API outputs protect the boundary between rules and display.
use serde_json::{Value, json};
use std::{collections::BTreeMap, error::Error};
use touhouflandre_api::{
    game::*,
    repository::{
        models::Match,
        relay::{Assignment, Encounter, StoredTurn},
    },
    service::multi::{projection, relay::views},
};

// Captured from commit 411426b before introducing touhouflandre-core, then frozen.
// Store serialized strings so omitted properties and property order are covered too.
const BEFORE_EXTRACTION: &str = include_str!("fixtures/guessing-api-before-extraction.json");

fn character(id: &str) -> Character {
    Character {
        id: id.into(),
        avatar_url: format!("/characters/{id}.png"),
        names: LocalizedNames {
            zh_hans: format!("角色 {id}"),
            en: format!("Character {id}"),
            ..Default::default()
        },
        first_appearance: FirstAppearance {
            work_id: "th06".into(),
            work_title: "东方红魔乡".into(),
            work_type: "game".into(),
            release_year: 2002,
            ..Default::default()
        },
        species: vec!["youkai".into(), "magician".into()],
        affiliations: vec!["scarlet".into()],
        locations: vec!["mansion".into()],
        hair_colors: vec!["red".into(), "blue".into()],
        enabled_as_answer: true,
        enabled_as_guess: true,
        ..Default::default()
    }
}

fn mixed_guess() -> Character {
    let mut guess = character("mixed");
    guess.first_appearance.work_id = "th05".into();
    guess.first_appearance.work_title = "东方怪绮谈".into();
    guess.first_appearance.release_year = 1998;
    guess.species = vec!["magician".into(), "human".into()];
    guess.affiliations = vec!["hakurei".into()];
    guess.locations = vec![" UnKnOwN ".into()];
    // Display preserves input order and duplicates; comparison is set-based.
    guess.hair_colors = vec!["none".into(), "red".into(), "red".into()];
    guess
}

fn reordered_fields() -> Vec<GuessField> {
    let mut hidden = guess_field(FIELD_SPECIES, FIELD_MODE_DEFAULT).unwrap();
    hidden.visible = false;
    let mut exact_year = guess_field(FIELD_RELEASE_YEAR, FIELD_MODE_EXACT_ONLY).unwrap();
    exact_year.label = "年份（仅命中）".into();
    let mut hair = guess_field(FIELD_HAIR_COLORS, FIELD_MODE_DEFAULT).unwrap();
    hair.label = "自定义发色".into();
    vec![
        guess_field(FIELD_RELEASE_YEAR, FIELD_MODE_DIRECTIONAL).unwrap(),
        hidden,
        hair,
        exact_year,
        GuessField {
            key: "futureField".into(),
            label: "未来字段".into(),
            visible: true,
            compare_strategy: "futureStrategy".into(),
            ..Default::default()
        },
        guess_field(FIELD_FIRST_APPEARANCE, FIELD_MODE_DEFAULT).unwrap(),
    ]
}

fn result_cases() -> BTreeMap<&'static str, GuessResult> {
    let answer = character("answer");
    let mixed = mixed_guess();
    let mut equivalent = character("equivalent");
    equivalent.species.reverse();
    equivalent.hair_colors = vec!["blue".into(), "red".into(), "blue".into()];
    let mut unknown = character("unknown");
    unknown.avatar_url.clear();
    unknown.first_appearance.work_id = "未知".into();
    unknown.first_appearance.release_year = 0;
    unknown.species.clear();
    unknown.affiliations = vec![" ".into()];
    unknown.locations = vec!["UNKNOWN".into()];
    unknown.hair_colors = vec!["未知".into()];
    let mut unknown_twin = unknown.clone();
    unknown_twin.id = "unknown-twin".into();
    let characters = vec![answer, mixed, equivalent, unknown, unknown_twin];
    let strict = build_catalog_runtime("frozen", AnswerMatchPolicy::Strict, &characters).unwrap();
    let equivalent =
        build_catalog_runtime("frozen", AnswerMatchPolicy::PublicFieldsV1, &characters).unwrap();
    let ordered = reordered_fields();
    let hidden: Vec<_> = character_guess_fields()
        .into_iter()
        .map(|mut field| {
            field.visible = false;
            field
        })
        .collect();
    BTreeMap::from([
        (
            "default_mixed",
            strict.evaluate_guess("answer", "mixed", None).unwrap(),
        ),
        (
            "ordered_duplicates_hidden_unknown",
            strict
                .evaluate_guess("answer", "mixed", Some(&ordered))
                .unwrap(),
        ),
        (
            "all_hidden",
            strict
                .evaluate_guess("answer", "mixed", Some(&hidden))
                .unwrap(),
        ),
        (
            "explicit_empty",
            equivalent
                .evaluate_guess("answer", "equivalent", Some(&[]))
                .unwrap(),
        ),
        (
            "default_equivalent",
            equivalent
                .evaluate_guess("answer", "equivalent", None)
                .unwrap(),
        ),
        (
            "strict_same_fields",
            strict.evaluate_guess("answer", "equivalent", None).unwrap(),
        ),
        (
            "unknown_fields",
            equivalent
                .evaluate_guess("answer", "unknown", None)
                .unwrap(),
        ),
        (
            "unknowns_do_not_merge",
            equivalent
                .evaluate_guess("unknown-twin", "unknown", None)
                .unwrap(),
        ),
        (
            "same_id_unknowns_exact",
            equivalent
                .evaluate_guess("unknown", "unknown", None)
                .unwrap(),
        ),
    ])
}

#[test]
fn complete_guess_json_matches_before_extraction() {
    let expected: BTreeMap<String, String> = serde_json::from_str(BEFORE_EXTRACTION).unwrap();
    let cases = result_cases();
    assert_eq!(cases.len(), expected.len());
    for (name, result) in cases {
        assert_eq!(
            serde_json::to_string(&result).unwrap(),
            expected[name],
            "{name}"
        );
        let stored: GuessResult = serde_json::from_str(&expected[name]).unwrap();
        assert_eq!(stored, result, "{name}: stored row remains readable");
    }
}

#[test]
fn validation_still_reports_guess_errors_before_answer_errors() {
    let enabled = character("enabled");
    let mut disabled = character("disabled");
    disabled.enabled_as_guess = false;
    let runtime =
        build_catalog_runtime("v1", AnswerMatchPolicy::Strict, &[enabled, disabled]).unwrap();
    for (answer, guess, kind, message) in [
        (
            "absent",
            "absent",
            "guess_missing",
            "guess character missing",
        ),
        (
            "absent",
            "disabled",
            "guess_disabled",
            "guess character disabled",
        ),
        (
            "absent",
            "enabled",
            "answer_missing",
            "answer character missing",
        ),
    ] {
        let error = runtime.evaluate_guess(answer, guess, None).unwrap_err();
        let source = error
            .source()
            .unwrap()
            .downcast_ref::<touhouflandre_core::Error>()
            .expect("the application adapter retains the typed rule error");
        assert_eq!(source.kind(), kind);
        assert_eq!(source.to_string(), message);
        assert_eq!(error.to_string(), message);
    }
}

#[test]
fn presentation_and_catalog_metadata_do_not_change_the_verdict() {
    let answer = character("answer");
    let before = character("guess");
    let mut after = before.clone();
    after.names = LocalizedNames {
        zh_hans: "重新命名".into(),
        ..Default::default()
    };
    after.avatar_url = "/new-avatar.svg".into();
    after.first_appearance.work_title = "另一个显示名称".into();
    after.first_appearance.mainline_index = Some(99);
    after.first_appearance.era = Some("different".into());
    after.first_appearance.work_pinyin_initials = vec!["different".into()];
    after.ability_display = "another ability".into();
    after.ability_tags = vec!["new-tag".into()];
    after.roles = vec!["new-role".into()];
    after.playable = true;
    after.enabled_as_answer = false;
    after.difficulty_tier = "extra".into();
    after.source_refs = vec!["https://example.invalid/new-source".into()];
    after.appearance_order = 999;
    assert_eq!(
        equivalence_signature(&before),
        equivalence_signature(&after)
    );
    let evaluate = |guess: Character| {
        build_catalog_runtime(
            "frozen",
            AnswerMatchPolicy::PublicFieldsV1,
            &[answer.clone(), guess],
        )
        .unwrap()
        .evaluate_guess("answer", "guess", None)
        .unwrap()
    };
    let original = evaluate(before);
    let changed = evaluate(after);
    assert!(original.is_correct && changed.is_correct);
    assert_eq!(original.match_kind, MatchKind::Equivalent);
    assert_eq!(changed.match_kind, MatchKind::Equivalent);
    let statuses =
        |result: &GuessResult| result.feedback.iter().map(|f| f.status).collect::<Vec<_>>();
    assert_eq!(statuses(&original), statuses(&changed));
    assert_eq!(changed.guess_name, "重新命名");
    assert_eq!(changed.guess_avatar_url, "/new-avatar.svg");
    assert_eq!(changed.feedback[0].display_value, ["另一个显示名称"]);
}

#[test]
fn equivalence_signature_preserves_go_html_and_separator_encoding() {
    let mut candidate = character("escaped");
    candidate.first_appearance.work_id = "<&>\u{2028}\u{2029}".into();
    candidate.species = vec!["β".into(), "a<&>".into(), "a<&>".into()];
    candidate.affiliations = vec!["A".into()];
    candidate.locations = vec!["B".into()];
    candidate.hair_colors = vec!["red".into()];
    let expected = concat!(
        r#"[{"key":"firstAppearance","value":{"stringValue":"\u003c\u0026\u003e\u2028\u2029"}},"#,
        r#"{"key":"releaseYear","value":{"numberValue":2002}},"#,
        r#"{"key":"species","value":{"setValue":["a\u003c\u0026\u003e","β"]}},"#,
        r#"{"key":"affiliations","value":{"setValue":["A"]}},"#,
        r#"{"key":"locations","value":{"setValue":["B"]}},"#,
        r#"{"key":"hairColors","value":{"setValue":["red"]}}]"#,
    );
    assert_eq!(equivalence_signature(&candidate).as_deref(), Some(expected));
}

fn restricted_scope() -> QuestionScopeConfig {
    let mut modes = default_field_modes();
    for key in [
        FIELD_FIRST_APPEARANCE,
        FIELD_SPECIES,
        FIELD_AFFILIATIONS,
        FIELD_LOCATIONS,
    ] {
        modes.insert(key.into(), FIELD_MODE_HIDDEN.into());
    }
    modes.insert(FIELD_RELEASE_YEAR.into(), FIELD_MODE_EXACT_ONLY.into());
    QuestionScopeConfig {
        rules: QuestionScopeRules {
            field_modes: modes,
            ..Default::default()
        },
        ..Default::default()
    }
}

fn restricted_guess_json() -> Value {
    json!({
        "kind": "guess",
        "guessId": "mixed",
        "guessName": "角色 mixed",
        "guessAvatarUrl": "/characters/mixed.png",
        "isCorrect": false,
        "matchKind": "none",
        "feedback": [
            {"field": "releaseYear", "label": "初登场年份", "status": "miss", "symbol": "X", "displayValue": ["1998"]},
            {"field": "hairColors", "label": "头发颜色", "status": "partial", "symbol": "~", "displayValue": ["无", "红", "红"]}
        ]
    })
}

#[test]
fn race_storage_keeps_all_columns_and_projects_full_or_legacy_active_rows() {
    let scope = restricted_scope();
    let visible = fields_for_question_scope(&scope);
    let storage = storage_fields_for_question_scope(&scope);
    let guess = mixed_guess();
    let runtime = build_catalog_runtime(
        "frozen",
        AnswerMatchPolicy::Strict,
        &[character("answer"), guess.clone()],
    )
    .unwrap();
    let stored = runtime
        .evaluate_guess("answer", "mixed", Some(&storage))
        .unwrap();
    let expected_statuses = ["partial", "miss", "partial", "miss", "unknown", "partial"];
    assert_eq!(
        serde_json::to_value(stored.feedback.iter().map(|f| f.status).collect::<Vec<_>>()).unwrap(),
        json!(expected_statuses)
    );
    assert_eq!(
        serde_json::to_value(
            runtime
                .evaluate_guess("answer", "mixed", Some(&visible))
                .unwrap()
        )
        .unwrap(),
        restricted_guess_json()
    );
    for statuses in [expected_statuses.to_vec(), vec!["miss", "partial"]] {
        let statuses: Vec<String> = statuses.into_iter().map(String::from).collect();
        assert_eq!(
            projection::hydrate_guess(&guess, &statuses, false, &visible, MatchKind::None),
            restricted_guess_json()
        );
    }
}

fn relay_records(scope: &QuestionScopeConfig) -> (Match, Encounter, Vec<Assignment>) {
    let now = chrono::DateTime::parse_from_rfc3339("2026-10-18T00:00:00Z")
        .unwrap()
        .to_utc();
    let game = Match {
        id: "match".into(),
        room_id: "room".into(),
        match_index: 1,
        catalog_version: "frozen".into(),
        target_wins: 1,
        score_slot1: 0,
        score_slot2: 0,
        round_count: 1,
        status: "playing".into(),
        started_at: now,
        ended_at: None,
        question_scope: Some(serde_json::to_value(scope).unwrap()),
        winner_member_id: None,
        scoring_mode: "wins".into(),
        roster_size: 2,
        max_rounds: 3,
        rule_set_key: "legacy_wins".into(),
        rule_set_version: 1,
        rule_config_snapshot: json!({}),
        answer_match_policy: "strict".into(),
    };
    let encounter = Encounter {
        id: "encounter".into(),
        match_id: "match".into(),
        stage_id: "stage".into(),
        encounter_index: 1,
        status: "playing".into(),
        answer_id: "answer".into(),
        starts_at: now,
        deadline: now,
        turn_member_id: Some("member".into()),
        turn_deadline: Some(now),
        winner_member_id: None,
        outcome: None,
        ended_at: None,
        ended_by_member_id: None,
        end_idempotency_key: None,
    };
    (
        game,
        encounter,
        vec![Assignment {
            member_id: "member".into(),
            side: 1,
            seat: 3,
        }],
    )
}

#[test]
fn relay_hydration_preserves_status_indices_and_http_event_discriminators() {
    let (game, encounter, members) = relay_records(&restricted_scope());
    for statuses in [
        json!(["partial", "miss", "partial", "miss", "unknown", "partial"]),
        json!(["miss", "partial"]),
    ] {
        let turn = StoredTurn {
            id: "turn".into(),
            member_id: "member".into(),
            turn_index: 2,
            kind: "guess".into(),
            guess_id: Some("mixed".into()),
            statuses: Some(statuses),
            is_correct: false,
            idempotency_key: "key".into(),
        };
        let mut row =
            views::hydrate_turn(&game, &encounter, &members, &turn, &[mixed_guess()]).unwrap();
        let mut event_guess = restricted_guess_json();
        event_guess.as_object_mut().unwrap().remove("kind");
        assert_eq!(
            row,
            json!({"index": 2, "memberId": "member", "seat": 3, "kind": "guess", "guess": event_guess})
        );
        views::http_turn(&mut row);
        assert_eq!(row["guess"], restricted_guess_json());
    }
}
