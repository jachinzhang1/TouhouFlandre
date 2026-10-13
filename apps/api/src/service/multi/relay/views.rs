use crate::{
    app::AppState,
    domain::relay::{self as domain, Rule},
    error::ApiError,
    game,
    repository::{
        models::{Match, Member, Room},
        multi as store,
        relay::{self as storage, Assignment, Encounter, Stage, StoredSettlement, StoredTurn},
    },
};
use serde_json::{Value, json};
use sqlx::PgConnection;

pub fn hydrate_turn(
    m: &Match,
    e: &Encounter,
    members: &[Assignment],
    turn: &StoredTurn,
    characters: &[game::Character],
) -> Result<Value, ApiError> {
    let seat = members
        .iter()
        .find(|a| a.member_id == turn.member_id)
        .map(|a| a.seat)
        .ok_or_else(|| ApiError::invariant("relay turn member assignment missing"))?;
    let mut row =
        json!({"index":turn.turn_index,"memberId":turn.member_id,"seat":seat,"kind":turn.kind});
    if turn.kind == "guess" {
        let guess = characters
            .iter()
            .find(|g| Some(&g.id) == turn.guess_id.as_ref())
            .ok_or_else(|| ApiError::invariant("relay turn guess character missing"))?;
        let statuses: Vec<game::FeedbackStatus> = serde_json::from_value(
            turn.statuses
                .clone()
                .ok_or_else(|| ApiError::invariant("relay turn statuses missing"))?,
        )?;
        let fields = storage::fields(m);
        let full = game::character_guess_fields();
        let feedback: Vec<_> = fields
            .iter()
            .enumerate()
            .filter(|(_, f)| f.visible)
            .map(|(i, f)| {
                let index = if statuses.len() == fields.len() {
                    i
                } else {
                    full.iter().position(|v| v.key == f.key).unwrap_or(i)
                };
                let status = statuses
                    .get(index)
                    .copied()
                    .unwrap_or(game::FeedbackStatus::Miss);
                game::FieldFeedback {
                    field: f.key.clone(),
                    label: f.label.clone(),
                    status,
                    symbol: game::status_to_symbol(status).into(),
                    display_value: game::display_values_for_field(guess, &f.key),
                }
            })
            .collect();
        row["guess"] = serde_json::to_value(game::GuessResult {
            kind: String::new(),
            guess_id: guess.id.clone(),
            guess_name: guess.names.zh_hans.clone(),
            guess_avatar_url: guess.avatar_url.clone(),
            is_correct: turn.is_correct,
            match_kind: game::match_kind_for_stored_guess(turn.is_correct, &e.answer_id, &guess.id),
            feedback,
        })?;
    }
    Ok(row)
}
/// HTTP GuessResult has a discriminator which canonical WebSocket GuessResultView
/// does not. Add it only at the HTTP projection boundary.
pub fn http_turn(row: &mut Value) {
    if let Some(guess) = row.get_mut("guess") {
        guess["kind"] = json!("guess")
    }
}
pub fn answer_view(answer: &game::Character) -> Value {
    let code = answer
        .first_appearance
        .mainline_index
        .map(|n| format!("TH{n:02}"))
        .unwrap_or_else(|| "TH--".into());
    json!({"id":answer.id,"name":answer.names.zh_hans,"avatarUrl":answer.avatar_url,"workId":answer.first_appearance.work_id,"workTitle":answer.first_appearance.work_title,"workCode":code})
}
fn settlement_view(s: StoredSettlement) -> Value {
    let transition = if s.eliminated_stage.is_some() {
        "eliminated"
    } else if s.life_before == "healthy" && s.life_after == "near_death" {
        "entered_near_death"
    } else {
        "none"
    };
    let mut v = json!({"memberId":s.member_id,"assignment":s.assignment,"outcome":s.outcome,"scoreBefore":s.score_before,"scoreDelta":s.score_delta,"scoreAfter":s.score_after,"lifeBefore":s.life_before,"lifeAfter":s.life_after,"lifeTransition":transition});
    if let Some(id) = s.encounter_id {
        v["encounterId"] = json!(id)
    }
    if let Some(index) = s.eliminated_stage {
        v["eliminatedStage"] = json!(index)
    }
    v
}
pub async fn stage_view(
    c: &mut PgConnection,
    m: &Match,
    stage: &Stage,
    observer: &Member,
    details: bool,
    characters: &[game::Character],
) -> Result<Value, ApiError> {
    let roster = store::match_players(c, &m.id).await?;
    let mut summaries = Vec::new();
    let mut detail_rows = Vec::new();
    for e in storage::encounters(c, &stage.id).await? {
        let members = storage::assignments(c, &e.id).await?;
        let summary = json!({"encounterId":e.id,"encounterIndex":e.encounter_index,"status":e.status,"members":members});
        summaries.push(summary.clone());
        if details {
            let mut detail = summary;
            let turns = storage::turns(c, &e.id).await?;
            let mut rows: Vec<_> = turns
                .iter()
                .map(|t| hydrate_turn(m, &e, &members, t, characters))
                .collect::<Result<_, _>>()?;
            for row in &mut rows {
                http_turn(row)
            }
            let can = observer.is_player()
                && observer.status != "left"
                && roster
                    .iter()
                    .any(|p| p.member_id == observer.id && p.status == "active")
                && e.status == "playing"
                && members.iter().any(|p| p.member_id == observer.id)
                && e.turn_member_id.as_ref() == Some(&observer.id);
            detail["capabilities"] = json!({"canGuess":can,"canPass":can,"canForfeit":can});
            detail["rows"] = json!(rows);
            detail["startsAt"] = json!(e.starts_at);
            detail["deadline"] = json!(e.deadline);
            detail["maxTurnsPerPlayer"] = json!(storage::max_turns(m));
            detail["maxSkipsPerPlayer"] = json!(2);
            if let Some(id) = &e.turn_member_id {
                detail["turnMemberId"] = json!(id);
                detail["turnSeat"] = json!(
                    members
                        .iter()
                        .find(|a| &a.member_id == id)
                        .map(|a| a.seat)
                        .unwrap_or(0)
                );
            }
            if let Some(deadline) = e.turn_deadline {
                detail["turnDeadline"] = json!(deadline)
            }
            if e.status == "ended" {
                let answer = characters
                    .iter()
                    .find(|c| c.id == e.answer_id)
                    .ok_or_else(|| ApiError::invariant("relay answer character missing"))?;
                detail["answer"] = crate::service::catalog::public_character(answer);
                if let Some(outcome) = &e.outcome {
                    // The HTTP terminal vocabulary represents an interrupted
                    // encounter as a draw; the match keeps server_restart.
                    detail["outcome"] = json!(if outcome == "server_restart" {
                        "draw"
                    } else {
                        outcome
                    })
                }
                if let Some(id) = &e.winner_member_id {
                    detail["winnerMemberId"] = json!(id)
                }
            }
            detail_rows.push(detail);
        }
    }
    let mut view = json!({"stageId":stage.id,"stageIndex":stage.stage_index,"status":stage.status,"startsAt":stage.starts_at,"encounters":summaries});
    if let Some(bye) = storage::bye(c, &stage.id).await? {
        view["byeMemberId"] = json!(bye.member_id)
    }
    let settled: Vec<StoredSettlement> = sqlx::query_as(
        "SELECT * FROM multi_relay_stage_player WHERE stage_id=$1 ORDER BY member_id",
    )
    .bind(&stage.id)
    .fetch_all(&mut *c)
    .await?;
    if !settled.is_empty() {
        view["settlement"] = Value::Array(settled.into_iter().map(settlement_view).collect())
    }
    if details {
        view["encounterDetails"] = json!(detail_rows)
    }
    Ok(view)
}
/// Returns root snapshot extensions: `relay`, `round` for the N=2 compatibility
/// board, and `roundIndex`. The common snapshot owns all other fields.
pub async fn snapshot(
    state: &AppState,
    c: &mut PgConnection,
    room: &Room,
    m: &Match,
    observer: &Member,
) -> Result<Value, ApiError> {
    crate::service::multi::validate_ruleset(state, room, m)?;
    let rule = storage::validate_match(m)?;
    let standings = storage::standings(c, &m.id).await?;
    if standings.len() != m.roster_size as usize {
        return Err(ApiError::invariant("relay roster size mismatch"));
    }
    // The terminal stage records both departure and elimination. The frozen
    // roster status distinguishes them; a departure must not become elimination.
    let stages = storage::stages(c, &m.id).await?;
    let stage = stages
        .last()
        .ok_or_else(|| ApiError::invariant("relay stage missing"))?;
    let characters = crate::service::catalog::characters_for_version(c, &m.catalog_version).await?;
    let mut fragment =
        json!({"ruleSetRef":{"mode":"relay","key":rule.key(),"version":1},"standings":standings});
    if rule == Rule::Fixed {
        fragment["plannedStages"] = json!(m.max_rounds)
    }
    if m.status == "finished" && rule != Rule::Legacy {
        let completed = stages
            .iter()
            .filter(|s| s.status == "ended")
            .map(|s| s.stage_index)
            .max()
            .unwrap_or(0);
        // A restart may happen before any stage settles. Zero completed stages
        // is a readable all-player draw, while earlier departure markers retain
        // their existing survived-stage meaning.
        let ranking_stage = completed.max(
            standings
                .iter()
                .filter_map(|s| s.eliminated_stage)
                .max()
                .unwrap_or(0),
        );
        fragment["ranking"] = json!(domain::ranking(&standings, rule, ranking_stage, None)?.0)
    }
    let mut history = Vec::new();
    for previous in stages.iter().filter(|s| s.status == "ended") {
        history.push(stage_view(c, m, previous, observer, false, &characters).await?)
    }
    if !history.is_empty() {
        fragment["historySummary"] = json!(history)
    }
    let current = stage_view(c, m, stage, observer, true, &characters).await?;
    fragment["currentStage"] = current.clone();
    let mut extension = json!({"relay":fragment,"roundIndex":stage.stage_index});
    if m.roster_size == 2
        && let Some(details) = current["encounterDetails"]
            .as_array()
            .filter(|d| d.len() == 1)
    {
        let detail = &details[0];
        let rows = detail["rows"].clone();
        let self_guesses = if observer.is_player() {
            rows.as_array()
                .into_iter()
                .flatten()
                .filter(|row| row["memberId"].as_str() == Some(&observer.id))
                .filter_map(|row| row.get("guess").cloned())
                .collect::<Vec<_>>()
        } else {
            Vec::new()
        };
        let mut self_view = json!({"guesses":self_guesses});
        if observer.is_player() {
            self_view["memberId"] = json!(observer.id);
            self_view["seat"] = json!(observer.seat())
        }
        let mut round = json!({"status":if detail["status"]=="planned"{Value::String("countdown".into())}else{detail["status"].clone()},"startsAt":detail["startsAt"],"deadline":detail["deadline"],"maxGuesses":storage::max_turns(m),"maxTurnsPerPlayer":storage::max_turns(m),"maxSkipsPerPlayer":2,"opponents":[],"self":self_view,"shared":{"rows":rows}});
        for key in ["turnMemberId", "turnSeat", "turnDeadline"] {
            if let Some(v) = detail.get(key) {
                round[key] = v.clone()
            }
        }
        extension["round"] = round;
    }
    Ok(extension)
}

fn select(value: &Value, keys: &[&str]) -> Result<Value, ApiError> {
    let object = value
        .as_object()
        .ok_or_else(|| ApiError::invariant("relay projection must be an object"))?;
    Ok(Value::Object(
        keys.iter()
            .filter_map(|k| object.get(*k).map(|v| ((*k).to_string(), v.clone())))
            .collect(),
    ))
}
fn clean_array(value: &mut Value, key: &str, keys: &[&str]) -> Result<(), ApiError> {
    if let Some(array) = value.get_mut(key) {
        let entries = array
            .as_array_mut()
            .ok_or_else(|| ApiError::invariant("relay projection field must be an array"))?;
        for entry in entries {
            *entry = select(entry, keys)?
        }
    }
    Ok(())
}
fn clean_row(value: &Value) -> Result<Value, ApiError> {
    let mut row = select(value, &["index", "memberId", "seat", "kind", "guess"])?;
    if let Some(guess) = row.get_mut("guess") {
        *guess = select(
            guess,
            &[
                "guessId",
                "guessName",
                "guessAvatarUrl",
                "isCorrect",
                "matchKind",
                "feedback",
            ],
        )?;
        clean_array(
            guess,
            "feedback",
            &["field", "label", "status", "symbol", "displayValue"],
        )?;
    }
    Ok(row)
}
/// Reconstruct the public shape. Persisted canonical JSON is never forwarded
/// verbatim, especially on started/turn events where an answer is still secret.
pub fn project_payload(
    event_type: &str,
    payload: &Value,
    _viewer: &Member,
) -> Result<Value, ApiError> {
    let mut value = match event_type {
        "relay.stage.started" => {
            let mut v = select(
                payload,
                &[
                    "matchIndex",
                    "stageId",
                    "stageIndex",
                    "startsAt",
                    "status",
                    "encounters",
                    "byeMemberId",
                ],
            )?;
            clean_array(
                &mut v,
                "encounters",
                &["encounterId", "encounterIndex", "status", "members"],
            )?;
            if let Some(rows) = v["encounters"].as_array_mut() {
                for row in rows {
                    clean_array(row, "members", &["memberId", "seat", "side"])?
                }
            }
            v
        }
        "relay.encounter.started" => {
            let mut v = select(
                payload,
                &[
                    "matchIndex",
                    "stageId",
                    "stageIndex",
                    "encounterId",
                    "encounterIndex",
                    "status",
                    "members",
                    "startsAt",
                    "deadline",
                    "turnMemberId",
                    "turnSeat",
                    "turnDeadline",
                    "maxTurnsPerPlayer",
                    "maxSkipsPerPlayer",
                ],
            )?;
            clean_array(&mut v, "members", &["memberId", "seat", "side"])?;
            v
        }
        "relay.encounter.turn.guess"
        | "relay.encounter.turn.pass"
        | "relay.encounter.turn.timeout" => {
            let mut v = select(
                payload,
                &[
                    "matchIndex",
                    "stageId",
                    "stageIndex",
                    "encounterId",
                    "memberId",
                    "row",
                    "nextTurnMemberId",
                    "nextTurnSeat",
                    "nextTurnDeadline",
                ],
            )?;
            v["row"] = clean_row(&v["row"])?;
            v
        }
        "relay.encounter.ended" => {
            if payload["status"] != "ended"
                || payload["answer"]["id"].as_str().is_none_or(str::is_empty)
            {
                return Err(ApiError::invariant("terminal relay event incomplete"));
            }
            let mut v = select(
                payload,
                &[
                    "matchIndex",
                    "stageId",
                    "stageIndex",
                    "encounterId",
                    "status",
                    "outcome",
                    "winnerMemberId",
                    "answer",
                    "turns",
                ],
            )?;
            v["answer"] = select(
                &v["answer"],
                &["id", "name", "avatarUrl", "workId", "workTitle", "workCode"],
            )?;
            if let Some(rows) = v.get_mut("turns").and_then(Value::as_array_mut) {
                for row in rows {
                    *row = clean_row(row)?
                }
            }
            v
        }
        "relay.stage.ended" => {
            let mut v = select(
                payload,
                &[
                    "matchIndex",
                    "stageId",
                    "stageIndex",
                    "status",
                    "settlement",
                    "standings",
                    "eliminatedMemberIds",
                    "nextStageIndex",
                    "byeMemberId",
                ],
            )?;
            clean_array(
                &mut v,
                "settlement",
                &[
                    "memberId",
                    "encounterId",
                    "assignment",
                    "outcome",
                    "scoreBefore",
                    "scoreDelta",
                    "scoreAfter",
                    "lifeBefore",
                    "lifeAfter",
                    "lifeTransition",
                    "eliminatedStage",
                ],
            )?;
            clean_array(
                &mut v,
                "standings",
                &[
                    "memberId",
                    "seat",
                    "score",
                    "status",
                    "lifeState",
                    "eliminatedStage",
                ],
            )?;
            v
        }
        _ => return Err(ApiError::invariant("unknown relay event type")),
    };
    // These identities are required by every relay envelope.
    if value["matchIndex"].as_i64().is_none()
        || value["stageIndex"].as_i64().is_none_or(|v| v < 1)
        || value["stageId"].as_str().is_none_or(str::is_empty)
    {
        return Err(ApiError::invariant("relay event envelope incomplete"));
    }
    if let Some(object) = value.as_object_mut() {
        object.retain(|key, v| {
            !v.is_null() || (event_type == "relay.encounter.ended" && key == "winnerMemberId")
        })
    }
    Ok(value)
}
