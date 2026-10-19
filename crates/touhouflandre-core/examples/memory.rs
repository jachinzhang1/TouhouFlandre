use touhouflandre_core::{AnswerMatchPolicy, AttemptState, Catalog, Character, FirstAppearance};

fn main() -> Result<(), touhouflandre_core::Error> {
    let characters = [
        Character {
            id: "reimu".into(),
            enabled_as_guess: true,
            first_appearance: FirstAppearance {
                work_id: "th01".into(),
                work_type: "game".into(),
                release_year: 1996,
            },
            species: vec!["human".into()],
            affiliations: vec!["hakurei-shrine".into()],
            locations: vec!["hakurei-shrine".into()],
            hair_colors: vec!["black".into()],
        },
        Character {
            id: "marisa".into(),
            enabled_as_guess: true,
            first_appearance: FirstAppearance {
                work_id: "th02".into(),
                work_type: "game".into(),
                release_year: 1997,
            },
            species: vec!["human".into()],
            affiliations: vec!["kirisame-magic-shop".into()],
            locations: vec!["forest-of-magic".into()],
            hair_colors: vec!["blonde".into()],
        },
    ];
    let catalog = Catalog::new(AnswerMatchPolicy::Strict, &characters)?;
    let mut state = AttemptState {
        limit: Some(6),
        ..Default::default()
    };

    // This caller chooses the answer and how to render semantic feedback.
    for guess_id in ["marisa", "reimu"] {
        let outcome = catalog.apply_guess(&state, "reimu", guess_id, None)?;
        println!("guess={guess_id}, match={:?}", outcome.guess.match_kind);
        for feedback in outcome.guess.feedback {
            println!("  {}: {:?}", feedback.field, feedback.status);
        }
        state = outcome.state;
        if state.closed {
            break;
        }
    }
    println!("closed={}, attempts={}", state.closed, state.used);
    Ok(())
}
