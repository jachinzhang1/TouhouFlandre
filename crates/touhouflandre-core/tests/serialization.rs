#![cfg(feature = "serde")]

use serde_json::{json, to_value};
use touhouflandre_core::*;

#[test]
fn opt_in_serialization_keeps_semantic_enum_spellings() {
    for (status, spelling) in [
        (FeedbackStatus::Exact, "exact"),
        (FeedbackStatus::Partial, "partial"),
        (FeedbackStatus::Miss, "miss"),
        (FeedbackStatus::Higher, "higher"),
        (FeedbackStatus::Lower, "lower"),
        (FeedbackStatus::Unknown, "unknown"),
    ] {
        assert_eq!(to_value(status).unwrap(), json!(spelling));
        assert_eq!(
            serde_json::from_value::<FeedbackStatus>(json!(spelling)).unwrap(),
            status
        );
    }
    for (kind, spelling) in [
        (MatchKind::None, "none"),
        (MatchKind::Exact, "exact"),
        (MatchKind::Equivalent, "equivalent"),
    ] {
        assert_eq!(to_value(kind).unwrap(), json!(spelling));
    }
    assert_eq!(
        to_value(AnswerMatchPolicy::Strict).unwrap(),
        json!("strict")
    );
    assert_eq!(
        to_value(AnswerMatchPolicy::PublicFieldsV1).unwrap(),
        json!("public_fields_v1")
    );
}

#[test]
fn result_serialization_contains_only_semantics_and_state_round_trips() {
    let result = GuessResult {
        guess_id: "guess".into(),
        is_correct: false,
        match_kind: MatchKind::None,
        feedback: vec![FieldFeedback {
            field: FIELD_RELEASE_YEAR.into(),
            status: FeedbackStatus::Higher,
        }],
    };
    assert_eq!(
        to_value(&result).unwrap(),
        json!({
            "guessId": "guess", "isCorrect": false, "matchKind": "none",
            "feedback": [{ "field": "releaseYear", "status": "higher" }]
        })
    );
    let state = AttemptState {
        guessed_ids: vec!["guess".into()],
        used: 2,
        limit: Some(4),
        closed: false,
    };
    let outcome = AttemptOutcome {
        state,
        guess: result,
    };
    let decoded: AttemptOutcome = serde_json::from_value(to_value(&outcome).unwrap()).unwrap();
    assert_eq!(decoded, outcome);
}

#[test]
fn canonical_serialization_keeps_only_the_known_value_kind() {
    assert_eq!(
        to_value(CanonicalFieldValue {
            number_value: Some(2000),
            ..Default::default()
        })
        .unwrap(),
        json!({"numberValue": 2000})
    );
    assert_eq!(
        to_value(CanonicalFieldValue {
            string_value: Some("work".into()),
            ..Default::default()
        })
        .unwrap(),
        json!({"stringValue": "work"})
    );
    assert_eq!(
        to_value(CanonicalFieldValue {
            set_value: vec!["a".into()],
            ..Default::default()
        })
        .unwrap(),
        json!({"setValue": ["a"]})
    );
}
