use touhouflandre_core::*;

fn character(id: &str) -> Character {
    Character {
        id: id.into(),
        enabled_as_guess: true,
        first_appearance: FirstAppearance {
            work_id: "work".into(),
            work_type: "game".into(),
            release_year: 2000,
        },
        species: vec!["youkai".into(), "magician".into()],
        affiliations: vec!["group".into()],
        locations: vec!["place".into()],
        hair_colors: vec!["red".into(), "blue".into()],
    }
}

fn field(key: &str) -> FieldRule {
    default_fields()
        .into_iter()
        .find(|field| field.key == key)
        .unwrap()
}

#[test]
fn comparison_covers_year_direction_exact_only_and_unknown() {
    use FeedbackStatus::*;
    let answer = character("a");
    let mut guess = character("b");
    let direction = field(FIELD_RELEASE_YEAR);
    let exact = FieldRule {
        compare_strategy: "numberExact".into(),
        ..direction.clone()
    };
    for (year, status) in [(1999, Higher), (2000, Exact), (2001, Lower), (0, Unknown)] {
        guess.first_appearance.release_year = year;
        assert_eq!(compare_feedback(&guess, &answer, &direction), status);
        assert_eq!(
            compare_feedback(&guess, &answer, &exact),
            match status {
                Higher | Lower => Miss,
                other => other,
            }
        );
    }
    // No subtraction means valid extreme years cannot overflow.
    guess.first_appearance.release_year = i32::MIN;
    assert_eq!(compare_feedback(&guess, &answer, &direction), Higher);
    guess.first_appearance.release_year = i32::MAX;
    assert_eq!(compare_feedback(&guess, &answer, &direction), Lower);
}

#[test]
fn first_appearance_uses_work_identity_then_known_medium() {
    use FeedbackStatus::*;
    let answer = character("a");
    let mut guess = character("b");
    let rule = field(FIELD_FIRST_APPEARANCE);
    guess.first_appearance.work_type = "book".into();
    assert_eq!(compare_feedback(&guess, &answer, &rule), Exact);
    guess.first_appearance.work_id = "another-work".into();
    assert_eq!(compare_feedback(&guess, &answer, &rule), Miss);
    guess.first_appearance.work_type = "game".into();
    assert_eq!(compare_feedback(&guess, &answer, &rule), Partial);
    guess.first_appearance.work_type = "unknown".into();
    assert_eq!(compare_feedback(&guess, &answer, &rule), Miss);
    for unknown in ["", " ", " UnKnOwN ", "未知", " 未知 "] {
        guess.first_appearance.work_id = unknown.into();
        assert_eq!(compare_feedback(&guess, &answer, &rule), Unknown);
    }
}

#[test]
fn sets_are_order_independent_but_known_values_remain_case_and_space_sensitive() {
    use FeedbackStatus::*;
    let answer = character("a");
    let mut guess = character("b");
    let rule = field(FIELD_HAIR_COLORS);
    for (values, expected) in [
        (vec!["blue", "red", "blue"], Exact),
        (vec!["red"], Partial),
        (vec!["red", "green"], Partial),
        (vec!["green"], Miss),
        (vec!["Red", " blue "], Miss),
        (vec![], Unknown),
        (vec!["red", "unknown"], Unknown),
        (vec!["red", " 未知 "], Unknown),
        (vec![" "], Unknown),
    ] {
        guess.hair_colors = values.into_iter().map(String::from).collect();
        assert_eq!(compare_feedback(&guess, &answer, &rule), expected);
    }
    guess.first_appearance.work_id = " work ".into();
    assert_eq!(
        canonical_field_value(&guess, FIELD_FIRST_APPEARANCE)
            .unwrap()
            .string_value,
        Some(" work ".into())
    );
    assert!(!equivalent_characters(&guess, &answer));
}

#[test]
fn unknown_fields_and_unknown_on_either_side_yield_unknown() {
    let mut answer = character("a");
    let guess = character("b");
    for key in ["future", "", "abilityTags", "roles"] {
        assert!(canonical_field_value(&guess, key).is_none());
        assert_eq!(
            compare_feedback(
                &guess,
                &answer,
                &FieldRule {
                    key: key.into(),
                    ..Default::default()
                }
            ),
            FeedbackStatus::Unknown
        );
    }
    answer.species.clear();
    assert_eq!(
        compare_feedback(&guess, &answer, &field(FIELD_SPECIES)),
        FeedbackStatus::Unknown
    );
    assert_eq!(
        compare_feedback(&answer, &guess, &field(FIELD_SPECIES)),
        FeedbackStatus::Unknown
    );
    assert!(!equivalent_characters(&answer, &answer));
}

#[test]
fn default_feedback_order_is_stable_and_custom_order_duplicates_are_preserved() {
    let mut guess = character("guess");
    guess.first_appearance.release_year = 1999;
    let catalog = Catalog::new(AnswerMatchPolicy::Strict, &[character("answer"), guess]).unwrap();
    let defaults = catalog.evaluate_guess("answer", "guess", None).unwrap();
    assert_eq!(
        defaults
            .feedback
            .iter()
            .map(|field| field.field.as_str())
            .collect::<Vec<_>>(),
        FIELD_KEYS
    );
    let requested = [
        FieldRule {
            key: FIELD_RELEASE_YEAR.into(),
            compare_strategy: "numberExact".into(),
        },
        field(FIELD_SPECIES),
        field(FIELD_RELEASE_YEAR),
    ];
    let custom = catalog
        .evaluate_guess("answer", "guess", Some(&requested))
        .unwrap();
    assert_eq!(
        custom
            .feedback
            .iter()
            .map(|field| field.status)
            .collect::<Vec<_>>(),
        [
            FeedbackStatus::Miss,
            FeedbackStatus::Exact,
            FeedbackStatus::Higher,
        ]
    );
    assert!(
        catalog
            .evaluate_guess("answer", "guess", Some(&[]))
            .unwrap()
            .feedback
            .is_empty()
    );
}

#[test]
fn equivalence_is_structured_full_field_equality_and_independent_of_feedback_selection() {
    let answer = character("answer");
    let mut equivalent = character("equivalent");
    equivalent.species = vec!["magician".into(), "youkai".into(), "magician".into()];
    equivalent.hair_colors.reverse();
    // Medium affects partial feedback, but work ID is the equivalence fact.
    equivalent.first_appearance.work_type = "book".into();
    assert!(equivalent_characters(&answer, &equivalent));
    let mut different = character("different");
    different.locations = vec!["another-place".into()];
    let catalog = Catalog::new(
        AnswerMatchPolicy::PublicFieldsV1,
        &[answer, equivalent, different],
    )
    .unwrap();
    for fields in [vec![], vec![field(FIELD_SPECIES)], default_fields()] {
        let result = catalog
            .evaluate_guess("answer", "equivalent", Some(&fields))
            .unwrap();
        assert!(result.is_correct);
        assert_eq!(result.match_kind, MatchKind::Equivalent);
        assert!(
            !catalog
                .evaluate_guess("answer", "different", Some(&fields))
                .unwrap()
                .is_correct
        );
    }
}

#[test]
fn groups_are_stable_and_keep_first_supplied_representative() {
    let mut characters = vec![character("z"), character("a"), character("m")];
    for _ in 0..characters.len() {
        let catalog = Catalog::new(AnswerMatchPolicy::PublicFieldsV1, &characters).unwrap();
        for id in ["a", "m", "z"] {
            assert_eq!(catalog.group_key(id), "equivalent:a");
        }
        let ids = ["m", "z", "missing", "a", "missing", "other"].map(String::from);
        assert_eq!(
            catalog.distinct_ids_by_group(&ids),
            ["m", "missing", "other"]
        );
        assert_eq!(catalog.group_key("missing"), "missing");
        characters.rotate_left(1);
    }
}

#[test]
fn disabled_or_incomplete_characters_do_not_join_equivalent_groups() {
    let answer = character("answer");
    let mut disabled = character("disabled");
    disabled.enabled_as_guess = false;
    let mut unknown_a = character("unknown-a");
    unknown_a.affiliations.clear();
    let mut unknown_b = unknown_a.clone();
    unknown_b.id = "unknown-b".into();
    let catalog = Catalog::new(
        AnswerMatchPolicy::PublicFieldsV1,
        &[
            answer,
            character("equivalent"),
            disabled,
            unknown_a,
            unknown_b,
        ],
    )
    .unwrap();
    assert_eq!(catalog.group_key("disabled"), "disabled");
    assert_eq!(catalog.group_key("unknown-a"), "unknown-a");
    assert!(!catalog.match_answer("unknown-a", "unknown-b").correct);
    assert!(!catalog.match_answer("answer", "disabled").correct);
    assert_eq!(
        catalog.evaluate_guess("answer", "disabled", None),
        Err(Error::GuessDisabled)
    );
}

#[test]
fn every_equivalence_field_is_required_and_nonzero_years_remain_known() {
    let complete = character("complete");
    for key in FIELD_KEYS {
        let mut incomplete = complete.clone();
        match key {
            FIELD_FIRST_APPEARANCE => incomplete.first_appearance.work_id.clear(),
            FIELD_RELEASE_YEAR => incomplete.first_appearance.release_year = 0,
            FIELD_SPECIES => incomplete.species.clear(),
            FIELD_AFFILIATIONS => incomplete.affiliations.clear(),
            FIELD_LOCATIONS => incomplete.locations.clear(),
            FIELD_HAIR_COLORS => incomplete.hair_colors.clear(),
            _ => unreachable!(),
        }
        assert!(!equivalent_characters(&complete, &incomplete), "{key}");
        assert!(!equivalent_characters(&incomplete, &incomplete), "{key}");
    }
    let mut historical = complete.clone();
    historical.first_appearance.release_year = -1;
    assert!(canonical_field_value(&historical, FIELD_RELEASE_YEAR).is_some());
}

#[test]
fn catalog_owns_facts_and_result_mutations_cannot_change_future_evaluations() {
    let mut characters = vec![character("answer"), character("guess")];
    let catalog = Catalog::new(AnswerMatchPolicy::PublicFieldsV1, &characters).unwrap();
    let original = catalog.evaluate_guess("answer", "guess", None).unwrap();
    characters[1].id = "mutated".into();
    characters[1].enabled_as_guess = false;
    characters[1].species.clear();
    let mut changed = original.clone();
    changed.feedback.clear();
    changed.guess_id.clear();
    assert_eq!(
        catalog.evaluate_guess("answer", "guess", None).unwrap(),
        original
    );
    assert_eq!(catalog.validate_guess("mutated"), Err(Error::GuessMissing));
}

#[test]
fn catalog_validation_error_precedence_and_low_level_match_are_explicit() {
    assert!(matches!(
        Catalog::new(AnswerMatchPolicy::Strict, &[Character::default()]),
        Err(Error::MissingCharacterId)
    ));
    assert!(
        matches!(Catalog::new(AnswerMatchPolicy::Strict, &[character("a"), character("a")]), Err(Error::DuplicateCharacterId(id)) if id == "a")
    );
    let mut disabled = character("disabled");
    disabled.enabled_as_guess = false;
    let catalog = Catalog::new(
        AnswerMatchPolicy::Strict,
        &[character("a"), character("b"), disabled],
    )
    .unwrap();
    assert_eq!(
        catalog.evaluate_guess("missing", "absent", None),
        Err(Error::GuessMissing)
    );
    assert_eq!(
        catalog.evaluate_guess("missing", "disabled", None),
        Err(Error::GuessDisabled)
    );
    assert_eq!(
        catalog.evaluate_guess("missing", "a", None),
        Err(Error::AnswerMissing)
    );
    assert_eq!(
        catalog.match_answer("absent", "absent").kind,
        MatchKind::Exact
    );
    assert_eq!(catalog.match_answer("a", "b").kind, MatchKind::None);
    assert_eq!(catalog.match_answer("a", "a").kind, MatchKind::Exact);
    assert!(Catalog::new(AnswerMatchPolicy::Strict, &[]).is_ok());
}

#[test]
fn policy_parsing_and_error_kinds_do_not_expose_input_in_labels() {
    assert_eq!("strict".parse(), Ok(AnswerMatchPolicy::Strict));
    assert_eq!(
        "public_fields_v1".parse(),
        Ok(AnswerMatchPolicy::PublicFieldsV1)
    );
    let error = "secret-input".parse::<AnswerMatchPolicy>().unwrap_err();
    assert_eq!(
        error,
        Error::UnknownAnswerMatchPolicy("secret-input".into())
    );
    assert_eq!(error.kind(), "unknown_answer_match_policy");
    assert_eq!(
        Error::DuplicateCharacterId("secret-id".into()).kind(),
        "duplicate_character_id"
    );
    for (error, kind) in [
        (Error::MissingCharacterId, "missing_character_id"),
        (Error::GuessMissing, "guess_missing"),
        (Error::GuessDisabled, "guess_disabled"),
        (Error::AnswerMissing, "answer_missing"),
        (Error::AttemptsClosed, "attempts_closed"),
        (Error::DuplicateGuess, "duplicate_guess"),
        (Error::AttemptLimitReached, "attempt_limit_reached"),
        (Error::InvalidAttemptState, "invalid_attempt_state"),
    ] {
        assert_eq!(error.kind(), kind);
    }
}
