use crate::{
    app::AppState,
    domain::relay::{self as domain, ForcedEnd, Player, Rule},
    error::ApiError,
    game::{self, Character},
    repository::{
        models::{Match, Member, Room},
        multi as store,
        relay::{self as storage, Stage},
    },
    service::multi::{events, new_id},
};
use chrono::{DateTime, TimeDelta, Utc};
use serde_json::{Value, json};
use sqlx::PgConnection;

pub async fn start_match_tx(
    state: &AppState,
    c: &mut PgConnection,
    room: &Room,
    m: &Match,
    roster: &[Member],
    characters: &[Character],
    now: DateTime<Utc>,
) -> Result<(), ApiError> {
    crate::service::multi::validate_ruleset(state, room, m)?;
    let rule = storage::validate_match(m)?;
    let mut players = Vec::new();
    for member in roster
        .iter()
        .filter(|m| m.is_player() && m.status != "left")
    {
        let seat = member
            .seat
            .ok_or_else(|| ApiError::invariant("relay player seat missing"))?;
        players.push(Player {
            member_id: member.id.clone(),
            seat,
        });
        sqlx::query("INSERT INTO multi_relay_match_player_state(match_id,member_id,score,life_state) VALUES($1,$2,$3,'healthy') ON CONFLICT(match_id,member_id) DO NOTHING").bind(&m.id).bind(&member.id).bind(if rule==Rule::Elimination{10}else{0}).execute(&mut *c).await?;
    }
    players.sort_by_key(|p| p.seat);
    create_stage(
        state,
        c,
        room,
        m,
        1,
        &players,
        None,
        characters,
        now + state.config.multi.round_countdown,
        now,
    )
    .await?;
    Ok(())
}
#[allow(clippy::too_many_arguments)]
pub async fn create_stage(
    state: &AppState,
    c: &mut PgConnection,
    room: &Room,
    m: &Match,
    index: i32,
    players: &[Player],
    previous_bye: Option<&str>,
    characters: &[Character],
    starts: DateTime<Utc>,
    now: DateTime<Utc>,
) -> Result<Stage, ApiError> {
    if let Some(s) = sqlx::query_as::<_, Stage>(
        "SELECT * FROM multi_relay_stage WHERE match_id=$1 AND stage_index=$2 FOR UPDATE",
    )
    .bind(&m.id)
    .bind(index)
    .fetch_optional(&mut *c)
    .await?
    {
        return Ok(s);
    }
    if index > 1 {
        let previous: Option<Stage> = sqlx::query_as(
            "SELECT * FROM multi_relay_stage WHERE match_id=$1 AND stage_index=$2 FOR UPDATE",
        )
        .bind(&m.id)
        .bind(index - 1)
        .fetch_optional(&mut *c)
        .await?;
        if !previous.is_some_and(|s| s.status == "ended" && s.settlement_marker.is_some()) {
            return Err(ApiError::invariant("previous relay stage not settled"));
        }
    }
    let labels = crate::metrics::Labels::new("relay", &m.rule_set_key, m.rule_set_version);
    let pairing =
        domain::pair(players, previous_bye, state.random_index.as_ref()).map_err(|error| {
            crate::metrics::METRICS.increment("pairing_failures_total", labels.clone());
            ApiError::from_source(error)
        })?;
    let policy = m.answer_match_policy.parse()?;
    let runtime = game::build_catalog_runtime(&m.catalog_version, policy, characters)?;
    let used:Vec<String>=sqlx::query_scalar("SELECT answer_id FROM multi_relay_encounter WHERE match_id=$1 ORDER BY stage_id,encounter_index").bind(&m.id).fetch_all(&mut *c).await?;
    let used_groups: std::collections::HashSet<_> =
        used.iter().map(|id| runtime.group_key(id)).collect();
    let candidates = runtime
        .distinct_ids_by_group(&storage::answer_pool(m, characters))
        .into_iter()
        .filter(|id| !used_groups.contains(runtime.group_key(id)))
        .collect::<Vec<_>>();
    let answers = domain::questions(
        &candidates,
        &[],
        pairing.pairs.len(),
        state.random_index.as_ref(),
    )
    .map_err(|error| {
        if error == domain::Error::PoolTooSmall {
            crate::metrics::METRICS.increment("pool_too_small_total", labels.clone());
            if index == 1 {
                return crate::service::multi::conflict(
                    "QUESTION_POOL_TOO_SMALL_FOR_PAIRINGS",
                    "题库中的可用答案不足以创建本轮对局。",
                )
                .with_source(error);
            }
        } else {
            crate::metrics::METRICS.increment("pairing_failures_total", labels.clone());
        }
        ApiError::from_source(error)
    })?;
    let stage_id = new_id();
    let stage:Stage=sqlx::query_as("INSERT INTO multi_relay_stage(id,match_id,stage_index,status,planned_encounter_count,starts_at) VALUES($1,$2,$3,'planned',$4,$5) RETURNING *").bind(&stage_id).bind(&m.id).bind(index).bind(pairing.pairs.len() as i32).bind(starts).fetch_one(&mut *c).await?;
    let mut summaries = Vec::new();
    let deadline = starts + state.config.multi.round_seconds;
    let turn_deadline = (starts + TimeDelta::seconds(room.turn_seconds as i64)).min(deadline);
    if deadline <= starts || turn_deadline <= starts {
        return Err(ApiError::invariant("relay deadline is not after start"));
    }
    for (i, pair) in pairing.pairs.iter().enumerate() {
        let id = new_id();
        let first = domain::first_turn(index, pair)?;
        sqlx::query("INSERT INTO multi_relay_encounter(id,match_id,stage_id,encounter_index,status,answer_id,starts_at,deadline,turn_member_id,turn_deadline) VALUES($1,$2,$3,$4,'countdown',$5,$6,$7,$8,$9)").bind(&id).bind(&m.id).bind(&stage.id).bind(i as i32+1).bind(&answers[i]).bind(starts).bind(deadline).bind(&first.member_id).bind(turn_deadline).execute(&mut *c).await?;
        let mut members = Vec::new();
        for (side, p) in pair.iter().enumerate() {
            sqlx::query("INSERT INTO multi_relay_encounter_member(match_id,stage_id,encounter_id,member_id,side,seat) VALUES($1,$2,$3,$4,$5,$6)").bind(&m.id).bind(&stage.id).bind(&id).bind(&p.member_id).bind(side as i32+1).bind(p.seat).execute(&mut *c).await?;
            members.push(json!({"memberId":p.member_id,"seat":p.seat,"side":side+1}));
        }
        summaries.push(
            json!({"encounterId":id,"encounterIndex":i+1,"status":"planned","members":members}),
        );
    }
    if let Some(bye) = &pairing.bye {
        sqlx::query("INSERT INTO multi_relay_stage_bye(stage_id,match_id,member_id,seat) VALUES($1,$2,$3,$4)").bind(&stage.id).bind(&m.id).bind(&bye.member_id).bind(bye.seat).execute(&mut *c).await?;
    }
    sqlx::query("UPDATE multi_match SET round_count=GREATEST(round_count,$2) WHERE id=$1")
        .bind(&m.id)
        .bind(index)
        .execute(&mut *c)
        .await?;
    let mut payload = json!({"matchIndex":m.match_index,"stageId":stage.id,"stageIndex":index,"startsAt":starts,"status":"planned","encounters":summaries});
    if let Some(bye) = pairing.bye {
        payload["byeMemberId"] = json!(bye.member_id)
    }
    events::append_event(c, &room.id, "relay.stage.started", payload, now).await?;
    Ok(stage)
}
/// Never lock sibling encounters: one sibling may be ending concurrently while
/// waiting to append its durable room event. Recovery acquires that same room
/// sequence lock before the barrier to avoid stage -> room inversion with Act.
pub async fn try_settle(
    state: &AppState,
    c: &mut PgConnection,
    stage_id: &str,
    forced: Option<&ForcedEnd>,
    now: DateTime<Utc>,
) -> Result<bool, ApiError> {
    let room_id:String=sqlx::query_scalar("SELECT m.room_id FROM multi_relay_stage s JOIN multi_match m ON m.id=s.match_id WHERE s.id=$1").bind(stage_id).fetch_one(&mut *c).await?;
    let _room_lock = store::room(c, &room_id, true).await?;
    let waiting = std::time::Instant::now();
    let stage: Stage = sqlx::query_as("SELECT * FROM multi_relay_stage WHERE id=$1 FOR UPDATE")
        .bind(stage_id)
        .fetch_one(&mut *c)
        .await?;
    if stage.status == "ended" && stage.settlement_marker.is_some() {
        return Ok(false);
    }
    let encounters = storage::encounters(c, stage_id).await?;
    if encounters.len() != stage.planned_encounter_count as usize {
        return Err(ApiError::invariant("relay encounter count mismatch"));
    }
    if encounters.iter().any(|e| e.status != "ended") {
        return Ok(false);
    }
    let m = store::match_by_id(c, &stage.match_id, true).await?;
    let labels = crate::metrics::Labels::new("relay", &m.rule_set_key, m.rule_set_version);
    crate::metrics::METRICS.observe(
        "stage_barrier_wait_seconds",
        labels.clone(),
        waiting.elapsed().as_secs_f64(),
    );
    let rule = storage::validate_match(&m)?;
    if m.status != "playing" {
        return Ok(false);
    }
    let room = store::room(c, &m.room_id, false).await?;
    let mut participants = Vec::new();
    for e in &encounters {
        let assignments = storage::assignments(c, &e.id).await?;
        if e.winner_member_id
            .as_ref()
            .is_some_and(|id| !assignments.iter().any(|a| &a.member_id == id))
        {
            return Err(ApiError::invariant(
                "relay winner not assigned to encounter",
            ));
        }
        for a in assignments {
            participants.push(domain::Participant {
                player: Player {
                    member_id: a.member_id.clone(),
                    seat: a.seat,
                },
                encounter_id: Some(e.id.clone()),
                outcome: if let Some(winner) = &e.winner_member_id {
                    if *winner == a.member_id {
                        "win"
                    } else {
                        "loss"
                    }
                } else {
                    "draw"
                }
                .into(),
            });
        }
    }
    let bye = storage::bye(c, stage_id).await?;
    if let Some(player) = &bye {
        participants.push(domain::Participant {
            player: player.clone(),
            encounter_id: None,
            outcome: "bye".into(),
        })
    }
    let standings = storage::standings(c, &m.id).await?;
    let decision = domain::settle(
        rule,
        stage.stage_index,
        m.max_rounds,
        m.target_wins,
        &standings,
        &participants,
        forced,
    )?;
    for s in &decision.players {
        sqlx::query("INSERT INTO multi_relay_stage_player(match_id,stage_id,member_id,encounter_id,assignment,outcome,score_before,score_delta,score_after,life_before,life_after,eliminated_stage,settled_at) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)").bind(&m.id).bind(stage_id).bind(&s.member_id).bind(&s.encounter_id).bind(s.assignment).bind(&s.outcome).bind(s.score_before).bind(s.score_delta).bind(s.score_after).bind(&s.life_before).bind(&s.life_after).bind(s.eliminated_stage).bind(now).execute(&mut *c).await?;
        sqlx::query("UPDATE multi_relay_match_player_state SET score=$3,life_state=$4,eliminated_stage=$5 WHERE match_id=$1 AND member_id=$2").bind(&m.id).bind(&s.member_id).bind(s.score_after).bind(&s.life_after).bind(s.eliminated_stage).execute(&mut *c).await?;
        if s.life_transition == "eliminated" {
            sqlx::query("UPDATE multi_match_player SET status='eliminated' WHERE match_id=$1 AND member_id=$2 AND status='active'").bind(&m.id).bind(&s.member_id).execute(&mut *c).await?;
        }
    }
    if let Some(d) = &decision.match_decision {
        apply_match_decision(state, c, &m, rule, d, &decision.standings, now).await?;
    }
    sqlx::query("UPDATE multi_relay_stage SET status='ended',settled_at=$2,settlement_marker=$3 WHERE id=$1 AND settlement_marker IS NULL").bind(stage_id).bind(now).bind(format!("relay-stage-settlement/v1:{stage_id}")).execute(&mut *c).await?;
    crate::metrics::METRICS.observe(
        "stage_duration_seconds",
        labels,
        (now - stage.starts_at).num_milliseconds() as f64 / 1000.0,
    );
    let next_index = if decision.next.is_empty() {
        None
    } else {
        Some(stage.stage_index + 1)
    };
    let mut payload = json!({"matchIndex":m.match_index,"stageId":stage_id,"stageIndex":stage.stage_index,"status":"ended","settlement":decision.players,"standings":decision.standings,"eliminatedMemberIds":decision.eliminated});
    if let Some(index) = next_index {
        payload["nextStageIndex"] = json!(index)
    }
    if let Some(bye) = &bye {
        payload["byeMemberId"] = json!(bye.member_id)
    }
    events::append_event(c, &m.room_id, "relay.stage.ended", payload, now).await?;
    if let Some(index) = next_index {
        let characters =
            crate::service::catalog::characters_for_version(c, &m.catalog_version).await?;
        create_stage(
            state,
            c,
            &room,
            &m,
            index,
            &decision.next,
            bye.as_ref().map(|p| p.member_id.as_str()),
            &characters,
            now + state.config.multi.intermission,
            now,
        )
        .await?;
    }
    Ok(true)
}
pub async fn apply_match_decision(
    state: &AppState,
    c: &mut PgConnection,
    m: &Match,
    rule: Rule,
    d: &domain::MatchDecision,
    standings: &[domain::Standing],
    now: DateTime<Utc>,
) -> Result<(), ApiError> {
    if rule == Rule::Legacy {
        sqlx::query("UPDATE multi_match SET score_slot1=$2,score_slot2=$3 WHERE id=$1")
            .bind(&m.id)
            .bind(d.scores[0])
            .bind(d.scores[1])
            .execute(&mut *c)
            .await?;
        sqlx::query("UPDATE multi_match_player p SET score=s.score,wins=s.score FROM multi_relay_match_player_state s WHERE p.match_id=$1 AND s.match_id=p.match_id AND s.member_id=p.member_id").bind(&m.id).execute(&mut *c).await?;
    }
    if !d.ended {
        return Ok(());
    }
    sqlx::query(
        "UPDATE multi_match SET status='finished',ended_at=$2,winner_member_id=$3 WHERE id=$1",
    )
    .bind(&m.id)
    .bind(now)
    .bind(&d.winner)
    .execute(&mut *c)
    .await?;
    let retention = now + state.config.multi.finished_retention;
    sqlx::query("UPDATE multi_room SET status='finished',expires_at=$2 WHERE id=$1")
        .bind(&m.room_id)
        .bind(retention)
        .execute(&mut *c)
        .await?;
    let roster = store::match_players(c, &m.id).await?;
    let scores:Vec<_>=standings.iter().map(|s|json!({"memberId":s.player.member_id,"seat":s.player.seat,"score":if rule==Rule::Elimination{roster.iter().find(|p|p.member_id==s.player.member_id).map(|p|p.score).unwrap_or(0)}else{s.score},"status":s.status})).collect();
    let mut payload = json!({"matchIndex":m.match_index,"memberScores":scores,"scores":{"slot1":d.scores[0],"slot2":d.scores[1]},"reason":d.reason,"retentionEndsAt":retention,"relay":{"standings":standings,"ranking":d.ranking}});
    if let Some(id) = &d.winner {
        payload["winnerMemberId"] = json!(id);
        if let Some(p) = roster.iter().find(|p| p.member_id == *id) {
            payload["winnerSlot"] = json!(p.seat)
        }
    }
    if rule != Rule::Elimination && !d.ranking.is_empty() {
        payload["ranking"]=Value::Array(d.ranking.iter().map(|r|json!({"memberId":r.standing.player.member_id,"seat":r.standing.player.seat,"rank":r.rank,"score":r.standing.score,"status":r.standing.status})).collect())
    }
    events::append_event(c, &m.room_id, "match.ended", payload, now).await?;
    Ok(())
}
