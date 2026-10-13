use chrono::{TimeDelta, Utc};
use touhouflandre_api::{
    domain::relay::*,
    service::multi::relay::{
        endpoints::{decode_history_cursor, encode_history_cursor},
        match_plan,
    },
};
fn p(seat: i32) -> Player {
    Player {
        member_id: format!("p{seat}"),
        seat,
    }
}
fn standing(seat: i32, score: i32) -> Standing {
    Standing {
        player: p(seat),
        score,
        life_state: "healthy".into(),
        status: "active".into(),
        eliminated_stage: None,
    }
}
fn participant(seat: i32, outcome: &str) -> Participant {
    Participant {
        player: p(seat),
        encounter_id: if outcome == "bye" {
            None
        } else {
            Some(format!("e{}", (seat + 1) / 2))
        },
        outcome: outcome.into(),
    }
}
#[test]
fn pairing_and_provision_are_stable_and_validate_random_bounds() {
    let active = (1..=5).map(p).collect::<Vec<_>>();
    let plan = pair(&active, Some("p1"), &|_| 0).unwrap();
    assert_eq!(plan.bye, Some(p(2)));
    assert_eq!(plan.pairs, vec![[p(3), p(4)], [p(5), p(1)]]);
    assert_eq!(pair(&active, None, &|n| n), Err(Error::Invalid));
    assert!(pair(&[p(2), p(1)], None, &|_| 0).is_err());
    let pool = vec!["c".into(), "b".into(), "b".into(), "a".into(), "".into()];
    assert_eq!(
        questions(&pool, &["b".into()], 2, &|_| 0).unwrap(),
        vec!["a", "c"]
    );
    assert_eq!(
        questions(&pool, &["b".into()], 3, &|_| 0),
        Err(Error::PoolTooSmall)
    );
    assert_eq!(first_turn(1, &[p(8), p(2)]).unwrap(), &p(2));
    assert_eq!(first_turn(2, &[p(8), p(2)]).unwrap(), &p(8));
}

#[test]
fn pairing_and_first_turn_match_independent_go_pcg_vectors() {
    // Captured by executing the original Go RandomPairingPolicy.Plan and
    // FirstTurnPlayer with math/rand/v2 PCG seeds. Replaying its recorded
    // IntN bounds/draws isolates rules from the production random generator.
    #[derive(serde::Deserialize)]
    struct Fixture {
        cases: Vec<Case>,
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Case {
        name: String,
        roster: Vec<Player>,
        previous_bye: Option<String>,
        draws: Vec<Draw>,
        plan: Plan,
        odd_first: Vec<Player>,
        even_first: Vec<Player>,
    }
    #[derive(serde::Deserialize)]
    struct Draw {
        n: usize,
        value: usize,
    }
    #[derive(serde::Deserialize)]
    struct Plan {
        pairs: Vec<Pair>,
        bye: Option<Player>,
    }
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct Pair {
        encounter_index: usize,
        members: [Player; 2],
    }
    let fixture: Fixture =
        serde_json::from_str(include_str!("fixtures/relay-pairing-go.json")).unwrap();
    let mut two_player_orientations = [false; 2];
    for case in fixture.cases {
        let draws = std::cell::RefCell::new(case.draws.iter());
        let actual = pair(&case.roster, case.previous_bye.as_deref(), &|n| {
            let mut draws = draws.borrow_mut();
            let next = draws.next().expect("Rust requested an extra random draw");
            assert_eq!(n, next.n, "{} random bound", case.name);
            next.value
        })
        .unwrap();
        assert!(draws.borrow_mut().next().is_none(), "{}", case.name);
        assert_eq!(actual.bye, case.plan.bye, "{} bye", case.name);
        assert_eq!(actual.pairs.len(), case.plan.pairs.len(), "{}", case.name);
        for (index, (members, expected)) in actual.pairs.iter().zip(&case.plan.pairs).enumerate() {
            assert_eq!(expected.encounter_index, index + 1, "{}", case.name);
            assert_eq!(members, &expected.members, "{} pair", case.name);
            assert_eq!(
                first_turn(1, members).unwrap(),
                &case.odd_first[index],
                "{} odd stage first turn",
                case.name
            );
            assert_eq!(
                first_turn(2, members).unwrap(),
                &case.even_first[index],
                "{} even stage first turn",
                case.name
            );
        }
        if case.roster.len() == 2 {
            two_player_orientations[(actual.pairs[0][0].seat - 1) as usize] = true;
        }
    }
    assert!(two_player_orientations.iter().all(|covered| *covered));
}
#[test]
fn turns_preserve_third_skip_loss_and_legacy_forfeit() {
    let next = Utc::now() + TimeDelta::seconds(30);
    let mut state = EncounterState {
        ended: false,
        members: [p(1), p(2)],
        turn_member_id: "p1".into(),
        max_turns: 8,
        turns: vec![],
    };
    assert_eq!(state.forfeit("p2", false), Err(Error::NotYourTurn));
    assert_eq!(state.forfeit("p2", true).unwrap().winner, Some("p1".into()));
    for index in 1..=5 {
        let actor = if index % 2 == 1 { "p1" } else { "p2" };
        let turn = Turn {
            index,
            member_id: actor.into(),
            kind: if index == 3 { "timeout" } else { "pass" }.into(),
            guess_id: None,
            correct: false,
        };
        let result = state.apply(&turn, next).unwrap();
        assert_eq!(result.ended, index == 5);
        if index == 5 {
            assert_eq!(result.reason, Some("loss"));
            assert_eq!(result.winner, Some("p2".into()))
        } else {
            state.turn_member_id = result.next_member.unwrap()
        }
        state.turns.push(turn);
    }
    let duplicate = EncounterState {
        ended: false,
        members: [p(1), p(2)],
        turn_member_id: "p2".into(),
        max_turns: 8,
        turns: vec![Turn {
            index: 1,
            member_id: "p1".into(),
            kind: "guess".into(),
            guess_id: Some("a".into()),
            correct: false,
        }],
    };
    assert_eq!(
        duplicate.apply(
            &Turn {
                index: 2,
                member_id: "p2".into(),
                kind: "guess".into(),
                guess_id: Some("a".into()),
                correct: false
            },
            next
        ),
        Err(Error::DuplicateGuess)
    );
}
#[test]
fn turn_limits_draw_or_keep_actor_when_other_exhausted() {
    let now = Utc::now();
    let mut state = EncounterState {
        ended: false,
        members: [p(1), p(2)],
        turn_member_id: "p1".into(),
        max_turns: 1,
        turns: vec![],
    };
    let t = Turn {
        index: 1,
        member_id: "p1".into(),
        kind: "guess".into(),
        guess_id: Some("a".into()),
        correct: false,
    };
    assert_eq!(state.apply(&t, now).unwrap().next_member, Some("p2".into()));
    state.turns.push(t);
    state.turn_member_id = "p2".into();
    assert_eq!(
        state
            .apply(
                &Turn {
                    index: 2,
                    member_id: "p2".into(),
                    kind: "guess".into(),
                    guess_id: Some("b".into()),
                    correct: false
                },
                now
            )
            .unwrap()
            .reason,
        Some("draw")
    );
}
#[test]
fn frozen_rule_selection_and_legacy_cap_do_not_award_departure_points() {
    assert_eq!(
        match_plan(2, "bo3", 3, true).unwrap().ruleset_key,
        "legacy_wins"
    );
    assert_eq!(match_plan(4, "bo3", 3, false).unwrap().max_rounds, 3);
    assert_eq!(
        match_plan(4, "bo3", 3, true).unwrap().ruleset_key,
        "elimination"
    );
    assert!(match_plan(3, "bo1", 3, false).is_err());
    let states = [standing(1, 1), standing(2, 0)];
    let participants = [participant(1, "draw"), participant(2, "draw")];
    let cap = settle(Rule::Legacy, 9, 9, 2, &states, &participants, None)
        .unwrap()
        .match_decision
        .unwrap();
    assert!(cap.ended);
    assert_eq!(cap.reason, "round_cap");
    assert_eq!(cap.winner, None);
    assert_eq!(cap.ranking[0].rank, 1);
    let d = settle(
        Rule::Legacy,
        1,
        9,
        2,
        &states,
        &[participant(1, "win"), participant(2, "loss")],
        Some(&ForcedEnd {
            winner: Some("p1".into()),
            reason: "disconnect".into(),
        }),
    )
    .unwrap();
    assert_eq!(d.players[0].score_delta, 0);
    assert_eq!(d.match_decision.unwrap().scores, [1, 0]);
}
#[test]
fn fixed_points_rank_ties_and_byes_without_a_bonus() {
    let mut states = (1..=4).map(|i| standing(i, 0)).collect::<Vec<_>>();
    states[3].status = "left".into();
    let d = settle(
        Rule::Fixed,
        1,
        1,
        1,
        &states,
        &[
            participant(1, "draw"),
            participant(2, "draw"),
            participant(3, "bye"),
        ],
        None,
    )
    .unwrap();
    assert_eq!(
        d.standings.iter().map(|s| s.score).collect::<Vec<_>>(),
        [1, 1, 0, 0]
    );
    let m = d.match_decision.unwrap();
    assert_eq!(
        m.ranking.iter().map(|r| r.rank).collect::<Vec<_>>(),
        [1, 1, 3, 3]
    );
    assert_eq!(m.winner, None);
}
#[test]
fn elimination_near_death_requires_another_negative_stage_and_ranks_survival() {
    let states = (1..=4).map(|i| standing(i, 10)).collect::<Vec<_>>();
    let outcomes = [
        participant(1, "win"),
        participant(2, "loss"),
        participant(3, "draw"),
        participant(4, "draw"),
    ];
    let d = settle(Rule::Elimination, 10, 1, 1, &states, &outcomes, None).unwrap();
    assert_eq!(d.standings[0].score, 10);
    assert_eq!(d.standings[1].score, 0);
    assert_eq!(d.standings[1].life_state, "near_death");
    assert_eq!(d.next.len(), 4);
    let next = settle(Rule::Elimination, 11, 1, 1, &d.standings, &outcomes, None).unwrap();
    assert_eq!(next.standings[1].status, "eliminated");
    assert_eq!(next.standings[1].score, -11);
    assert_eq!(next.eliminated, vec!["p2"]);
    let mut final_states = next.standings;
    final_states[2].status = "left".into();
    final_states[2].eliminated_stage = Some(11);
    final_states[3].status = "eliminated".into();
    final_states[3].eliminated_stage = Some(11);
    final_states[3].score = -1;
    final_states[3].life_state = "near_death".into();
    let (ranking, winner) = ranking(&final_states, Rule::Elimination, 11, None).unwrap();
    assert_eq!(winner, Some("p1".into()));
    assert_eq!(ranking[0].rank, 1);
    assert_eq!(ranking[1].rank, 1);
    assert_eq!(ranking[2].survived_stages, Some(10));
}
#[test]
fn history_cursor_is_bound_to_match_and_rejects_negative_positions() {
    let encoded = encode_history_cursor(2, 5);
    assert_eq!(
        encoded,
        "eyJ2IjoxLCJtYXRjaEluZGV4IjoyLCJhZnRlclN0YWdlSW5kZXgiOjV9"
    );
    assert_eq!(decode_history_cursor(Some(&encoded), 2).unwrap(), 5);
    assert!(decode_history_cursor(Some(&encoded), 1).is_err());
    assert!(decode_history_cursor(Some(&encode_history_cursor(2, -1)), 2).is_err());
    assert_eq!(decode_history_cursor(None, 2).unwrap(), 0);
}

#[test]
fn timeout_keys_match_go_rfc3339_nano_fraction_trimming() {
    for input in [
        "2030-01-01T00:00:00Z",
        "2030-01-01T00:00:00.1234Z",
        "2030-01-01T00:00:00.1234567Z",
    ] {
        let time = chrono::DateTime::parse_from_rfc3339(input)
            .unwrap()
            .with_timezone(&Utc);
        assert_eq!(
            touhouflandre_api::service::multi::relay::service::timeout_key(time),
            format!("timeout/{input}")
        );
    }
}
