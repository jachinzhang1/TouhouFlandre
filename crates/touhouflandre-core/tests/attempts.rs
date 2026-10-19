use touhouflandre_core::*;

fn catalog() -> Catalog {
    Catalog::new(
        AnswerMatchPolicy::Strict,
        &[
            Character {
                id: "answer".into(),
                enabled_as_guess: true,
                ..Default::default()
            },
            Character {
                id: "wrong".into(),
                enabled_as_guess: true,
                ..Default::default()
            },
            Character {
                id: "other".into(),
                enabled_as_guess: true,
                ..Default::default()
            },
            Character {
                id: "disabled".into(),
                ..Default::default()
            },
        ],
    )
    .unwrap()
}

#[test]
fn guesses_advance_without_mutating_the_input_and_correct_answer_closes() {
    let catalog = catalog();
    let start = AttemptState {
        limit: Some(3),
        ..Default::default()
    };
    let first = catalog
        .apply_guess(&start, "answer", "wrong", None)
        .unwrap();
    assert_eq!(first.state.used, 1);
    assert_eq!(first.state.guessed_ids, ["wrong"]);
    assert!(!first.state.closed);
    assert!(!first.guess.is_correct);
    assert_eq!(start.used, 0);
    assert!(start.guessed_ids.is_empty());
    let won = catalog
        .apply_guess(&first.state, "answer", "answer", None)
        .unwrap();
    assert_eq!(won.state.used, 2);
    assert_eq!(won.state.guessed_ids, ["wrong", "answer"]);
    assert!(won.state.closed);
    assert!(won.guess.is_correct);
    assert_eq!(first.state.guessed_ids, ["wrong"]);
    assert_eq!(
        catalog.apply_guess(&won.state, "answer", "other", None),
        Err(Error::AttemptsClosed)
    );
    assert_eq!(consume_attempt(&won.state), Err(Error::AttemptsClosed));
}

#[test]
fn last_attempt_closes_for_both_wrong_and_correct_guesses() {
    let catalog = catalog();
    for (guess_id, correct) in [("wrong", false), ("answer", true)] {
        let state = AttemptState {
            limit: Some(1),
            ..Default::default()
        };
        let result = catalog
            .apply_guess(&state, "answer", guess_id, Some(&[]))
            .unwrap();
        assert_eq!(result.state.used, 1);
        assert!(result.state.closed);
        assert_eq!(result.guess.is_correct, correct);
        assert!(result.guess.feedback.is_empty());
    }
}

#[test]
fn consume_does_not_add_history_and_caller_chooses_which_events_count() {
    let catalog = catalog();
    let start = AttemptState {
        limit: Some(3),
        ..Default::default()
    };
    let after_skip = consume_attempt(&start).unwrap();
    assert_eq!(after_skip.used, 1);
    assert!(after_skip.guessed_ids.is_empty());
    let guessed = catalog
        .apply_guess(&after_skip, "answer", "wrong", None)
        .unwrap();
    assert_eq!(guessed.state.used, 2);
    assert_eq!(guessed.state.guessed_ids, ["wrong"]);
    let exhausted = consume_attempt(&guessed.state).unwrap();
    assert_eq!(exhausted.used, 3);
    assert_eq!(exhausted.guessed_ids, ["wrong"]);
    assert!(exhausted.closed);
    assert_eq!(start.used, 0);
    assert_eq!(
        catalog.apply_guess(&exhausted, "answer", "answer", None),
        Err(Error::AttemptsClosed)
    );
}

#[test]
fn limits_can_be_absent_zero_or_already_consumed() {
    let mut unlimited = AttemptState::default();
    for _ in 0..1000 {
        unlimited = consume_attempt(&unlimited).unwrap();
    }
    assert_eq!(unlimited.used, 1000);
    assert!(!unlimited.closed);
    assert!(
        catalog()
            .apply_guess(&unlimited, "answer", "answer", None)
            .unwrap()
            .state
            .closed
    );
    for (used, limit) in [(0, 0), (2, 2), (3, 2)] {
        let state = AttemptState {
            used,
            limit: Some(limit),
            ..Default::default()
        };
        assert_eq!(
            state.validate_guess("wrong"),
            Err(Error::AttemptLimitReached)
        );
        assert_eq!(consume_attempt(&state), Err(Error::AttemptLimitReached));
    }
}

#[test]
fn history_count_and_overflow_validation_prevent_invalid_transitions() {
    for state in [
        AttemptState {
            guessed_ids: vec!["wrong".into()],
            used: 0,
            ..Default::default()
        },
        AttemptState {
            used: usize::MAX,
            ..Default::default()
        },
    ] {
        assert_eq!(
            state.validate_guess("other"),
            Err(Error::InvalidAttemptState)
        );
        assert_eq!(consume_attempt(&state), Err(Error::InvalidAttemptState));
        assert_eq!(
            catalog().apply_guess(&state, "missing", "missing", None),
            Err(Error::InvalidAttemptState)
        );
    }
    let near_max = AttemptState {
        used: usize::MAX - 1,
        ..Default::default()
    };
    let max = consume_attempt(&near_max).unwrap();
    assert_eq!(max.used, usize::MAX);
    assert_eq!(consume_attempt(&max), Err(Error::InvalidAttemptState));
}

#[test]
fn attempt_errors_precede_catalog_lookup_and_duplicates_precede_exhaustion() {
    let catalog = catalog();
    let closed = AttemptState {
        closed: true,
        ..Default::default()
    };
    assert_eq!(
        catalog.apply_guess(&closed, "absent", "absent", None),
        Err(Error::AttemptsClosed)
    );
    let prior = AttemptState {
        guessed_ids: vec!["absent".into()],
        used: 1,
        limit: Some(1),
        closed: false,
    };
    assert_eq!(
        catalog.apply_guess(&prior, "absent", "absent", None),
        Err(Error::DuplicateGuess)
    );
    assert_eq!(
        catalog.apply_guess(&prior, "absent", "wrong", None),
        Err(Error::AttemptLimitReached)
    );
}

#[test]
fn failed_catalog_lookups_preserve_state_and_never_consume_an_attempt() {
    let catalog = catalog();
    let state = AttemptState {
        guessed_ids: vec!["other".into()],
        used: 2,
        limit: Some(4),
        closed: false,
    };
    let original = state.clone();
    for (answer, guess, error) in [
        ("answer", "other", Error::DuplicateGuess),
        ("answer", "absent", Error::GuessMissing),
        ("answer", "disabled", Error::GuessDisabled),
        ("absent", "wrong", Error::AnswerMissing),
    ] {
        assert_eq!(catalog.apply_guess(&state, answer, guess, None), Err(error));
        assert_eq!(state, original);
    }
    let result = catalog
        .apply_guess(&state, "answer", "wrong", None)
        .unwrap();
    assert_eq!(result.state.used, 3);
    assert_eq!(result.state.guessed_ids, ["other", "wrong"]);
}

#[test]
fn callers_choose_history_scope_without_player_ids_or_room_state() {
    let catalog = catalog();
    let one_sequence = catalog
        .apply_guess(&AttemptState::default(), "answer", "wrong", None)
        .unwrap();
    assert_eq!(
        catalog.apply_guess(&one_sequence.state, "answer", "wrong", None),
        Err(Error::DuplicateGuess)
    );
    assert!(
        catalog
            .apply_guess(&AttemptState::default(), "answer", "wrong", None)
            .is_ok()
    );
    // A different guess with identical feedback is not a duplicate ID.
    assert!(
        catalog
            .apply_guess(&one_sequence.state, "answer", "other", None)
            .is_ok()
    );
}
