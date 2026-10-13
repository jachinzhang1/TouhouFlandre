use crate::{
    app::AppState,
    domain::relay::{self as domain, Error, ForcedEnd, Transition},
    error::ApiError,
    game,
    repository::{
        models::{Match, Member},
        multi as store,
        relay::{self as storage, Assignment, Encounter, StoredTurn},
    },
    service::multi::{
        events::{self, RoomEffect},
        new_id,
        relay::{coordinator, views},
    },
};
use chrono::{DateTime, TimeDelta, Utc};
use serde_json::{Value, json};
use sqlx::PgConnection;

#[derive(Debug, Clone)]
pub struct Action {
    pub room_id: String,
    pub stage_index: i32,
    pub encounter_id: String,
    pub actor_id: String,
    pub action: String,
    pub guess_id: Option<String>,
    pub key: String,
    pub legacy_forfeit: bool,
}
pub struct ActionResult {
    pub body: Value,
    pub guess: Option<Value>,
    pub error: Option<ApiError>,
    pub effect: RoomEffect,
}
impl ActionResult {
    fn new(action: &Action) -> Self {
        Self {
            body: json!({"stageIndex":action.stage_index,"encounterId":action.encounter_id,"accepted":false,"ended":false}),
            guess: None,
            error: None,
            effect: RoomEffect {
                room_id: action.room_id.clone(),
                game: false,
                chat: false,
                ..Default::default()
            },
        }
    }
}

pub async fn act(state: &AppState, input: Action) -> Result<ActionResult, ApiError> {
    if input.room_id.is_empty()
        || input.stage_index < 1
        || input.encounter_id.is_empty()
        || input.actor_id.is_empty()
        || input.key.is_empty()
        || !matches!(input.action.as_str(), "guess" | "pass" | "forfeit")
        || (input.action == "guess") != input.guess_id.as_ref().is_some_and(|s| !s.is_empty())
    {
        return Err(Error::Invalid.into());
    }
    let mut tx = state.pool.begin().await?;
    let result = act_tx(state, &mut tx, &input).await?;
    tx.commit().await?;
    events::publish(state, &result.effect);
    Ok(result)
}
async fn act_tx(
    state: &AppState,
    c: &mut PgConnection,
    input: &Action,
) -> Result<ActionResult, ApiError> {
    let started = std::time::Instant::now();
    let mut result = ActionResult::new(input);
    let mut e:Encounter=sqlx::query_as("SELECT e.* FROM multi_relay_encounter e JOIN multi_relay_stage s ON s.id=e.stage_id JOIN multi_match m ON m.id=e.match_id WHERE m.room_id=$1 AND s.stage_index=$2 AND e.id=$3 FOR UPDATE OF e").bind(&input.room_id).bind(input.stage_index).bind(&input.encounter_id).fetch_optional(&mut *c).await?.ok_or(Error::NotFound)?;
    let m = store::match_by_id(c, &e.match_id, false).await?;
    storage::validate_match(&m)?;
    let room = store::room(c, &m.room_id, false).await?;
    crate::service::multi::validate_ruleset(state, &room, &m)?;
    let _timer = (input.action == "guess").then(|| GuessTimer {
        started,
        labels: crate::metrics::Labels::new("relay", &m.rule_set_key, m.rule_set_version),
    });
    let members = storage::assignments(c, &e.id).await?;
    if !members.iter().any(|a| a.member_id == input.actor_id) {
        return Err(Error::NotPlayer.into());
    }
    let mut turns = storage::turns(c, &e.id).await?;
    if e.ended_by_member_id.as_ref() == Some(&input.actor_id)
        && e.end_idempotency_key.as_ref() == Some(&input.key)
    {
        if input.action != "forfeit" {
            return Err(Error::Idempotency.into());
        }
        result.body["accepted"] = json!(true);
        result.body["ended"] = json!(true);
        return Ok(result);
    }
    if let Some(existing) = turns
        .iter()
        .find(|t| t.member_id == input.actor_id && t.idempotency_key == input.key)
    {
        if input.action != existing.kind
            || (input.action == "guess" && input.guess_id != existing.guess_id)
        {
            return Err(Error::Idempotency.into());
        }
        let characters =
            crate::service::catalog::characters_for_version(c, &m.catalog_version).await?;
        let row = views::hydrate_turn(&m, &e, &members, existing, &characters)?;
        result.guess = row.get("guess").cloned();
        result.body["turn"] = row;
        result.body["accepted"] = json!(true);
        result.body["ended"] = json!(e.status == "ended");
        return Ok(result);
    }
    if m.status != "playing" || e.status == "ended" {
        return Err(Error::Ended.into());
    }
    // Sample after the encounter lock; queued requests cannot use a stale
    // pre-lock timestamp to bypass a turn that expired while they waited.
    let now = (state.clock)();
    if matches!(e.status.as_str(), "planned" | "countdown") {
        if now < e.starts_at {
            return Err(Error::NotActive.into());
        }
        start_encounter(c, &m, &mut e, &members, now).await?;
        result.effect.game = true;
    }
    let expired = expire_turns(
        state,
        c,
        &m,
        &mut e,
        &members,
        &mut turns,
        Some(&input.actor_id),
        now,
    )
    .await?;
    result.effect.merge(&expired.effect);
    if e.status == "ended" {
        result.body["ended"] = json!(true);
        result.error = Some(Error::Ended.into());
        return Ok(result);
    }
    if expired.own_turn {
        result.error = Some(Error::TurnExpired.into());
        return Ok(result);
    }
    let encounter_state = storage::encounter_state(&m, &e, &members, &turns)?;
    if input.action == "forfeit" {
        let transition = encounter_state.forfeit(&input.actor_id, input.legacy_forfeit)?;
        result.effect.chat |= end_encounter(
            state,
            c,
            &m,
            &mut e,
            &members,
            &turns,
            &transition,
            Some((&input.actor_id, &input.key)),
            None,
            now,
        )
        .await?;
        result.body["accepted"] = json!(true);
        result.body["ended"] = json!(true);
        result.effect.game = true;
        return Ok(result);
    }
    let characters = crate::service::catalog::characters_for_version(c, &m.catalog_version).await?;
    let mut statuses = None;
    let mut correct = false;
    if let Some(guess_id) = &input.guess_id {
        let policy = m.answer_match_policy.parse()?;
        let runtime = game::build_catalog_runtime(&m.catalog_version, policy, &characters)?;
        if !runtime
            .by_id
            .get(guess_id)
            .is_some_and(|g| g.enabled_as_guess)
        {
            return Err(Error::InvalidGuess.into());
        }
        let feedback =
            runtime.evaluate_guess(&e.answer_id, guess_id, Some(&storage::storage_fields(&m)))?;
        correct = feedback.is_correct;
        statuses = Some(json!(
            feedback
                .feedback
                .iter()
                .map(|f| f.status)
                .collect::<Vec<_>>()
        ));
    }
    let room = store::room(c, &m.room_id, false).await?;
    let next_deadline = (now + TimeDelta::seconds(room.turn_seconds as i64)).min(e.deadline);
    let turn = StoredTurn {
        id: new_id(),
        member_id: input.actor_id.clone(),
        turn_index: turns.len() as i32 + 1,
        kind: input.action.clone(),
        guess_id: input.guess_id.clone(),
        statuses,
        is_correct: correct,
        idempotency_key: input.key.clone(),
    };
    let transition = store_turn(c, &m, &mut e, &members, &turns, &turn, next_deadline, now).await?;
    let row = views::hydrate_turn(&m, &e, &members, &turn, &characters)?;
    turns.push(turn);
    if transition.ended {
        result.effect.chat |= end_encounter(
            state,
            c,
            &m,
            &mut e,
            &members,
            &turns,
            &transition,
            None,
            None,
            now,
        )
        .await?;
        result.body["ended"] = json!(true)
    }
    result.body["accepted"] = json!(true);
    result.guess = row.get("guess").cloned();
    result.body["turn"] = row;
    result.effect.game = true;
    Ok(result)
}
struct GuessTimer {
    started: std::time::Instant,
    labels: crate::metrics::Labels,
}
impl Drop for GuessTimer {
    fn drop(&mut self) {
        crate::metrics::METRICS.observe(
            "guess_latency_seconds",
            self.labels.clone(),
            self.started.elapsed().as_secs_f64(),
        );
    }
}
pub async fn legacy_action(
    state: &AppState,
    room_id: &str,
    stage_index: i32,
    member: &Member,
    action: &str,
    key: &str,
    guess: Option<&str>,
) -> Result<Value, ApiError> {
    let encounter:Option<String>=sqlx::query_scalar("SELECT e.id FROM multi_relay_encounter e JOIN multi_relay_stage s ON s.id=e.stage_id JOIN multi_match m ON m.id=e.match_id WHERE m.room_id=$1 AND m.status='playing' AND s.stage_index=$2 AND e.encounter_index=1 ORDER BY m.match_index DESC LIMIT 1").bind(room_id).bind(stage_index).fetch_optional(&state.pool).await?;
    let encounter_id = encounter.ok_or(Error::NotFound)?;
    let key = if action == "forfeit" && key.is_empty() {
        format!("legacy-forfeit/{}/{}", member.id, encounter_id)
    } else {
        key.to_owned()
    };
    let result = act(
        state,
        Action {
            room_id: room_id.into(),
            stage_index,
            encounter_id,
            actor_id: member.id.clone(),
            action: action.into(),
            guess_id: guess.map(str::to_owned),
            key,
            legacy_forfeit: action == "forfeit",
        },
    )
    .await?;
    if let Some(error) = result.error {
        return Err(if error.code == "ENCOUNTER_ENDED" {
            crate::service::multi::conflict("ROUND_ENDED", "本局已结束。")
        } else {
            error
        });
    }
    if action == "guess" {
        let mut guess = result
            .guess
            .ok_or_else(|| ApiError::invariant("relay guess result missing"))?;
        guess["kind"] = json!("guess");
        Ok(guess)
    } else {
        Ok(json!({"accepted":true}))
    }
}
pub async fn start_encounter(
    c: &mut PgConnection,
    m: &Match,
    e: &mut Encounter,
    members: &[Assignment],
    now: DateTime<Utc>,
) -> Result<(), ApiError> {
    sqlx::query("UPDATE multi_relay_encounter SET status='playing' WHERE id=$1 AND status IN ('planned','countdown')").bind(&e.id).execute(&mut *c).await?;
    sqlx::query("UPDATE multi_relay_stage SET status='playing' WHERE id=$1 AND status='planned'")
        .bind(&e.stage_id)
        .execute(&mut *c)
        .await?;
    e.status = "playing".into();
    let index = stage_index(c, e).await?;
    let seat = e
        .turn_member_id
        .as_ref()
        .and_then(|id| members.iter().find(|a| &a.member_id == id))
        .map(|a| a.seat);
    let payload = json!({"matchIndex":m.match_index,"stageId":e.stage_id,"stageIndex":index,"encounterId":e.id,"encounterIndex":e.encounter_index,"status":"playing","members":members,"startsAt":e.starts_at,"deadline":e.deadline,"turnMemberId":e.turn_member_id,"turnSeat":seat,"turnDeadline":e.turn_deadline,"maxTurnsPerPlayer":storage::max_turns(m),"maxSkipsPerPlayer":2});
    events::append_event(c, &m.room_id, "relay.encounter.started", payload, now).await?;
    Ok(())
}
pub struct Expired {
    pub own_turn: bool,
    pub effect: RoomEffect,
}
// Keep the locked transaction context and its captured time explicit.
#[allow(clippy::too_many_arguments)]
pub async fn expire_turns(
    state: &AppState,
    c: &mut PgConnection,
    m: &Match,
    e: &mut Encounter,
    members: &[Assignment],
    turns: &mut Vec<StoredTurn>,
    actor: Option<&str>,
    now: DateTime<Utc>,
) -> Result<Expired, ApiError> {
    let mut result = Expired {
        own_turn: false,
        effect: RoomEffect {
            room_id: m.room_id.clone(),
            game: false,
            chat: false,
            ..Default::default()
        },
    };
    if now >= e.deadline {
        result.effect.chat = end_encounter(
            state,
            c,
            m,
            e,
            members,
            turns,
            &Transition::terminal("timeout", None),
            None,
            None,
            now,
        )
        .await?;
        result.effect.game = true;
        return Ok(result);
    }
    let room = store::room(c, &m.room_id, false).await?;
    while let Some(deadline) = e.turn_deadline.filter(|deadline| *deadline <= now) {
        let member = e
            .turn_member_id
            .clone()
            .ok_or_else(|| ApiError::invariant("relay turn member missing"))?;
        result.own_turn |= Some(member.as_str()) == actor;
        let turn = StoredTurn {
            id: new_id(),
            member_id: member,
            turn_index: turns.len() as i32 + 1,
            kind: "timeout".into(),
            guess_id: None,
            statuses: None,
            is_correct: false,
            idempotency_key: timeout_key(deadline),
        };
        let next = (deadline + TimeDelta::seconds(room.turn_seconds as i64)).min(e.deadline);
        let transition = store_turn(c, m, e, members, turns, &turn, next, now).await?;
        turns.push(turn);
        result.effect.game = true;
        crate::metrics::METRICS.increment(
            "turn_timeouts_total",
            crate::metrics::Labels::new("relay", &m.rule_set_key, m.rule_set_version),
        );
        if transition.ended {
            result.effect.chat |=
                end_encounter(state, c, m, e, members, turns, &transition, None, None, now).await?;
            break;
        }
    }
    Ok(result)
}
// One atomic transition consumes both persisted state and the submitted action.
#[allow(clippy::too_many_arguments)]
async fn store_turn(
    c: &mut PgConnection,
    m: &Match,
    e: &mut Encounter,
    members: &[Assignment],
    turns: &[StoredTurn],
    turn: &StoredTurn,
    next: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<Transition, ApiError> {
    let transition = storage::encounter_state(m, e, members, turns)?.apply(
        &domain::Turn {
            index: turn.turn_index,
            member_id: turn.member_id.clone(),
            kind: turn.kind.clone(),
            guess_id: turn.guess_id.clone(),
            correct: turn.is_correct,
        },
        next,
    )?;
    sqlx::query("INSERT INTO multi_relay_turn(id,match_id,stage_id,encounter_id,member_id,turn_index,kind,guess_id,statuses,is_correct,idempotency_key,created_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)").bind(&turn.id).bind(&e.match_id).bind(&e.stage_id).bind(&e.id).bind(&turn.member_id).bind(turn.turn_index).bind(&turn.kind).bind(&turn.guess_id).bind(&turn.statuses).bind(turn.is_correct).bind(&turn.idempotency_key).bind(now).execute(&mut *c).await?;
    if !transition.ended {
        sqlx::query(
            "UPDATE multi_relay_encounter SET turn_member_id=$2,turn_deadline=$3 WHERE id=$1",
        )
        .bind(&e.id)
        .bind(&transition.next_member)
        .bind(transition.next_deadline)
        .execute(&mut *c)
        .await?;
        e.turn_member_id = transition.next_member.clone();
        e.turn_deadline = transition.next_deadline;
    }
    let characters = crate::service::catalog::characters_for_version(c, &m.catalog_version).await?;
    let row = views::hydrate_turn(m, e, members, turn, &characters)?;
    let index = stage_index(c, e).await?;
    let mut payload = json!({"matchIndex":m.match_index,"stageId":e.stage_id,"stageIndex":index,"encounterId":e.id,"memberId":turn.member_id,"row":row});
    if let Some(id) = &transition.next_member {
        payload["nextTurnMemberId"] = json!(id);
        payload["nextTurnSeat"] = json!(
            members
                .iter()
                .find(|a| &a.member_id == id)
                .map(|a| a.seat)
                .unwrap_or(0)
        );
    }
    if let Some(deadline) = transition.next_deadline {
        payload["nextTurnDeadline"] = json!(deadline)
    }
    events::append_event(
        c,
        &m.room_id,
        &format!("relay.encounter.turn.{}", turn.kind),
        payload,
        now,
    )
    .await?;
    Ok(transition)
}
#[allow(clippy::too_many_arguments)]
pub async fn end_encounter(
    state: &AppState,
    c: &mut PgConnection,
    m: &Match,
    e: &mut Encounter,
    members: &[Assignment],
    turns: &[StoredTurn],
    transition: &Transition,
    forfeit: Option<(&str, &str)>,
    forced: Option<&ForcedEnd>,
    now: DateTime<Utc>,
) -> Result<bool, ApiError> {
    if !transition.ended {
        return Err(ApiError::invariant("invalid relay terminal transition"));
    }
    let reason = transition
        .reason
        .ok_or_else(|| ApiError::invariant("relay terminal reason missing"))?;
    sqlx::query("UPDATE multi_relay_encounter SET status='ended',winner_member_id=$2,outcome=$3,ended_at=$4,ended_by_member_id=$5,end_idempotency_key=$6,turn_member_id=NULL,turn_deadline=NULL WHERE id=$1 AND status<>'ended'").bind(&e.id).bind(&transition.winner).bind(reason).bind(now).bind(forfeit.map(|v|v.0)).bind(forfeit.map(|v|v.1)).execute(&mut *c).await?;
    e.status = "ended".into();
    e.winner_member_id = transition.winner.clone();
    e.outcome = Some(reason.into());
    e.turn_member_id = None;
    e.turn_deadline = None;
    e.ended_at = Some(now);
    let characters = crate::service::catalog::characters_for_version(c, &m.catalog_version).await?;
    let answer = characters
        .iter()
        .find(|a| a.id == e.answer_id)
        .ok_or_else(|| ApiError::invariant("relay answer character missing"))?;
    let rows: Vec<_> = turns
        .iter()
        .map(|t| views::hydrate_turn(m, e, members, t, &characters))
        .collect::<Result<_, _>>()?;
    let index = stage_index(c, e).await?;
    let mut payload = json!({"matchIndex":m.match_index,"stageId":e.stage_id,"stageIndex":index,"encounterId":e.id,"status":"ended","outcome":reason,"winnerMemberId":transition.winner,"answer":views::answer_view(answer)});
    if !rows.is_empty() {
        payload["turns"] = json!(rows)
    }
    events::append_event(c, &m.room_id, "relay.encounter.ended", payload, now).await?;
    let mut chat = false;
    if reason != "server_restart" && state.config.multi.system_announcements_enabled {
        let mut ordered = members.to_vec();
        ordered.sort_by_key(|a| a.seat);
        let prefix = format!(
            "[第 {} 轮][P{} vs P{}]",
            index, ordered[0].seat, ordered[1].seat
        );
        let content = if let Some(winner) = &transition.winner {
            let member = store::member(c, winner).await?;
            let seat = members
                .iter()
                .find(|a| a.member_id == *winner)
                .ok_or_else(|| ApiError::invariant("relay winner member missing"))?
                .seat;
            format!("{prefix}{}(P{seat})胜出", member.display_name)
        } else {
            format!("{prefix}双方平局")
        };
        chat = crate::service::chat::append_system(
            c,
            true,
            &m.room_id,
            m.roster_size,
            &format!("relay/{}/ended", e.id),
            &content,
            now,
        )
        .await?;
    }
    crate::metrics::METRICS.observe(
        "encounter_duration_seconds",
        crate::metrics::Labels::new("relay", &m.rule_set_key, m.rule_set_version),
        (now - e.starts_at).num_milliseconds() as f64 / 1000.0,
    );
    coordinator::try_settle(state, c, &e.stage_id, forced, now).await?;
    Ok(chat)
}
pub async fn stage_index(c: &mut PgConnection, e: &Encounter) -> Result<i32, ApiError> {
    Ok(
        sqlx::query_scalar("SELECT stage_index FROM multi_relay_stage WHERE id=$1")
            .bind(&e.stage_id)
            .fetch_one(c)
            .await?,
    )
}
/// Go's RFC3339Nano trims every fractional trailing zero (chrono AutoSi only
/// chooses millisecond/microsecond/nanosecond precision). Persist the same key.
pub fn timeout_key(deadline: DateTime<Utc>) -> String {
    let base = deadline.format("%Y-%m-%dT%H:%M:%S");
    let nanos = deadline.timestamp_subsec_nanos();
    if nanos == 0 {
        format!("timeout/{base}Z")
    } else {
        let fraction = format!("{nanos:09}");
        format!("timeout/{base}.{}Z", fraction.trim_end_matches('0'))
    }
}
