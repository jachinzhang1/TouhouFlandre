use serde_json::{Value, json};
use touhouflandre_api::contracts::{self, *};

#[test]
fn optional_collections_preserve_missing_and_empty() {
    let missing: ChatHistoryResponse =
        contracts::decode(json!({"messages": [], "hasMore": false})).unwrap();
    assert_eq!(
        serde_json::to_value(missing).unwrap(),
        json!({"messages": [], "hasMore": false})
    );
    let base = json!({});
    let missing: QuestionScopeRulesInput = contracts::decode(base.clone()).unwrap();
    assert!(
        serde_json::to_value(missing)
            .unwrap()
            .get("hiddenFields")
            .is_none()
    );
    let mut empty = base;
    empty["hiddenFields"] = json!([]);
    let parsed: QuestionScopeRulesInput = contracts::decode(empty.clone()).unwrap();
    assert_eq!(serde_json::to_value(parsed).unwrap(), empty);
}

#[test]
fn optional_non_nullable_fields_reject_explicit_null() {
    let body = json!({"messages": [], "hasMore": false, "beforeCursor": null});
    assert!(serde_json::from_value::<ChatHistoryResponse>(body.clone()).is_err());
    assert!(contracts::decode::<ChatHistoryResponse>(body).is_err());
}

fn encounter() -> Value {
    json!({
        "encounterId":"encounter-1", "encounterIndex":1, "status":"playing",
        "members":[], "capabilities":{"canGuess":true,"canPass":false,"canForfeit":true}, "rows":[]
    })
}

#[test]
fn optional_nullable_field_has_three_states() {
    let absent = encounter();
    let dto: RelayEncounterView = serde_json::from_value(absent).unwrap();
    assert_eq!(dto.winner_member_id, None);
    assert!(
        serde_json::to_value(dto)
            .unwrap()
            .get("winnerMemberId")
            .is_none()
    );
    let mut null = encounter();
    null["winnerMemberId"] = Value::Null;
    let dto: RelayEncounterView = serde_json::from_value(null.clone()).unwrap();
    assert_eq!(dto.winner_member_id, Some(None));
    assert_eq!(serde_json::to_value(dto).unwrap(), null);
    let mut present = encounter();
    present["winnerMemberId"] = json!("member-1");
    let dto: RelayEncounterView = serde_json::from_value(present.clone()).unwrap();
    assert_eq!(dto.winner_member_id, Some(Some("member-1".into())));
    assert_eq!(serde_json::to_value(dto).unwrap(), present);
}

#[test]
fn required_nullable_field_cannot_be_omitted() {
    let mut terminal = encounter();
    terminal["status"] = json!("ended");
    terminal["outcome"] = json!("draw");
    terminal["members"] = json!([
        {"memberId":"one", "seat":1, "side":1},
        {"memberId":"two", "seat":2, "side":2}
    ]);
    terminal["answer"] = json!({
        "id":"reimu", "avatarUrl":"/characters/0001-reimu.png", "appearanceOrder":1,
        "names":{"zhHans":"灵梦", "ja":"霊夢", "en":"Reimu", "aliases":[]},
        "firstAppearance":{"workId":"th01", "workTitle":"灵异传", "workType":"game", "releaseYear":1996},
        "species":["human"], "abilityDisplay":"flight", "abilityTags":["flight"],
        "affiliations":["shrine"], "locations":["shrine"], "roles":["hero"], "hairColors":["black"],
        "playable":true, "enabledAsAnswer":true, "enabledAsGuess":true, "difficultyTier":"easy",
        "sourceRefs":["https://example.com/reimu"]
    });
    assert!(serde_json::from_value::<RelayEncounterHistoryView>(terminal.clone()).is_err());
    assert!(contracts::decode::<RelayEncounterHistoryView>(terminal.clone()).is_err());
    terminal["winnerMemberId"] = Value::Null;
    let dto: RelayEncounterHistoryView = contracts::decode(terminal.clone()).unwrap();
    assert_eq!(serde_json::to_value(dto).unwrap(), terminal);
    terminal["status"] = json!("playing");
    assert!(contracts::decode::<RelayEncounterHistoryView>(terminal).is_err());
}

#[test]
fn validates_bounds_unknown_properties_and_enums() {
    assert!(
        contracts::validate_value("RoomsUpdateSettingsRequestBody", &json!({"playerLimit": 8}))
            .is_ok()
    );
    assert!(
        contracts::validate_value("RoomsUpdateSettingsRequestBody", &json!({"playerLimit": 9}))
            .is_err()
    );
    assert!(
        contracts::validate_value("RoomsUpdateSettingsRequestBody", &json!({"playerLimit": 1}))
            .is_err()
    );
    assert!(
        contracts::validate_value(
            "RoomsUpdateSettingsRequestBody",
            &json!({"unexpected": true})
        )
        .is_err()
    );
    assert!(serde_json::from_value::<RoomFormat>(json!("unknown")).is_err());
    assert!(serde_json::from_value::<RoomInfoTurnSeconds>(json!(45)).is_err());
    let seconds: RoomInfoTurnSeconds = serde_json::from_value(json!(60)).unwrap();
    assert_eq!(serde_json::to_value(seconds).unwrap(), json!(60));
}

#[test]
fn validates_patterns_dates_and_array_limits_without_rewriting_wire_text() {
    let body = json!({
        "messageId":"a123456789012345678901234", "roomId":"room", "senderMemberId":"member",
        "senderDisplayName":"灵梦", "senderRole":"player", "senderSeat":1,
        "kind":"text", "content":"hello", "channel":"room", "cursor":"opaque",
        "createdAt":"2026-10-13T10:11:12.123456+08:00"
    });
    let dto: ChatMessage = contracts::decode(body.clone()).unwrap();
    assert_eq!(serde_json::to_value(dto).unwrap(), body);
    let mut invalid = body.clone();
    invalid["messageId"] = json!("UPPERCASE");
    assert!(contracts::decode::<ChatMessage>(invalid).is_err());
    let mut invalid = body;
    invalid["createdAt"] = json!("tomorrow");
    assert!(contracts::decode::<ChatMessage>(invalid).is_err());
    assert!(contracts::validate_value("RelayEncounterView", &encounter()).is_err());
}

#[test]
fn all_generated_schemas_compile_and_all_operations_are_indexed() {
    let document: Value = serde_json::from_str(contracts::SCHEMAS_JSON).unwrap();
    for name in document["definitions"].as_object().unwrap().keys() {
        let result = contracts::validate_value(name, &Value::Null);
        assert!(
            !matches!(result, Err(contracts::ContractError::InvalidSchema(_))),
            "{name}: {result:?}"
        );
    }
    let operations: Vec<Value> = serde_json::from_str(contracts::OPERATIONS_JSON).unwrap();
    assert_eq!(operations.len(), 32);
    assert!(
        operations
            .iter()
            .any(|operation| operation["path"] == "/api/rooms/{roomId}/ws")
    );
}
