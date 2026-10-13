mod support;
use anyhow::Result;
use chrono::{DateTime, TimeDelta, Utc};
use serde_json::json;
use std::sync::{Arc, Mutex};
use support::*;
use touhouflandre_api::{
    app::AppState,
    config::Config,
    repository::{
        models::{Match, Member, Room},
        multi as store, relay as storage,
    },
    seed,
    service::multi::{
        self,
        relay::{
            self,
            service::{Action, act},
        },
    },
};

struct Fixture {
    db: Database,
    state: AppState,
    now: Arc<Mutex<DateTime<Utc>>>,
    room: Room,
    m: Match,
    players: Vec<Member>,
}
impl Fixture {
    async fn new(n: i32, rule: &str, format: &str) -> Result<Self> {
        let db = Database::new().await?;
        let data = seed::load_catalog(
            &std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/data/src"),
        )?;
        let version = seed::persist(&db.pool, &data).await?;
        let mut config = Config::from_values(&Default::default())?;
        config.multi.round_countdown = TimeDelta::zero();
        config.multi.intermission = TimeDelta::zero();
        config.multi.system_announcements_enabled = true;
        let now = Arc::new(Mutex::new(
            DateTime::parse_from_rfc3339("2030-01-01T00:00:00Z")?.with_timezone(&Utc),
        ));
        let clock = now.clone();
        let mut state = AppState::new(db.pool.clone(), config);
        state.clock = Arc::new(move || *clock.lock().unwrap());
        state.random_index = Arc::new(|_| 0);
        let room_id = multi::new_id();
        sqlx::query("INSERT INTO multi_room(id,code,format,status,expires_at,mode,turn_seconds,player_limit) VALUES($1,'ABCDEF',$2,'playing','infinity','relay',30,$3)").bind(&room_id).bind(format).bind(n).execute(&db.pool).await?;
        let mut tx = db.pool.begin().await?;
        for seat in 1..=n {
            let id = format!("p{seat}");
            sqlx::query("INSERT INTO multi_member(id,room_id,seat,display_name,token_hash,role,ready) VALUES($1,$2,$3,$4,$5,'player',true)").bind(&id).bind(&room_id).bind(seat).bind(format!("玩家{seat}")).bind(multi::auth::hash_token(&format!("token{seat}"))).execute(&mut *tx).await?;
        }
        let plan = relay::match_plan(n as usize, format, 3, rule == "elimination")?;
        let match_id = multi::new_id();
        sqlx::query("INSERT INTO multi_match(id,room_id,match_index,catalog_version,target_wins,status,started_at,scoring_mode,roster_size,max_rounds,rule_set_key,rule_set_version,rule_config_snapshot,answer_match_policy) VALUES($1,$2,0,$3,$4,'playing',$5,'wins',$6,$7,$8,1,'{}','strict')").bind(&match_id).bind(&room_id).bind(&version).bind(plan.target_wins).bind((state.clock)()).bind(n).bind(plan.max_rounds).bind(rule).execute(&mut *tx).await?;
        for seat in 1..=n {
            sqlx::query("INSERT INTO multi_match_player(match_id,member_id,seat) VALUES($1,$2,$3)")
                .bind(&match_id)
                .bind(format!("p{seat}"))
                .bind(seat)
                .execute(&mut *tx)
                .await?;
        }
        let room = store::room(&mut tx, &room_id, false).await?;
        let m = store::match_by_id(&mut tx, &match_id, false).await?;
        let players = store::members(&mut tx, &room_id).await?;
        relay::start_match_tx(
            &state,
            &mut tx,
            &room,
            &m,
            &players,
            &data.characters,
            (state.clock)(),
        )
        .await?;
        tx.commit().await?;
        Ok(Self {
            db,
            state,
            now,
            room,
            m,
            players,
        })
    }
    async fn encounters(&self, stage: i32) -> Result<Vec<storage::Encounter>> {
        let mut c = self.db.pool.acquire().await?;
        let id: String = sqlx::query_scalar(
            "SELECT id FROM multi_relay_stage WHERE match_id=$1 AND stage_index=$2",
        )
        .bind(&self.m.id)
        .bind(stage)
        .fetch_one(&mut *c)
        .await?;
        Ok(storage::encounters(&mut c, &id).await?)
    }
    fn action(
        &self,
        e: &storage::Encounter,
        stage: i32,
        actor: &str,
        kind: &str,
        key: &str,
        guess: Option<&str>,
    ) -> Action {
        Action {
            room_id: self.room.id.clone(),
            stage_index: stage,
            encounter_id: e.id.clone(),
            actor_id: actor.into(),
            action: kind.into(),
            key: key.into(),
            guess_id: guess.map(str::to_owned),
            legacy_forfeit: false,
        }
    }
    async fn close(self) -> Result<()> {
        drop(self.state);
        self.db.close().await
    }
}
#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn siblings_settle_once_under_concurrency_and_idempotent_replay() -> Result<()> {
    let f = Fixture::new(4, "fixed_points", "bo1").await?;
    let encounters = f.encounters(1).await?;
    let a = f.action(
        &encounters[0],
        1,
        encounters[0].turn_member_id.as_deref().unwrap(),
        "guess",
        "win-a",
        Some(&encounters[0].answer_id),
    );
    let b = f.action(
        &encounters[1],
        1,
        encounters[1].turn_member_id.as_deref().unwrap(),
        "guess",
        "win-b",
        Some(&encounters[1].answer_id),
    );
    let (a, b) = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        tokio::join!(act(&f.state, a.clone()), act(&f.state, b.clone()))
    })
    .await?;
    assert!(a?.body["ended"].as_bool().unwrap());
    assert!(b?.body["ended"].as_bool().unwrap());
    let mut c = f.db.pool.acquire().await?;
    let m = store::match_by_id(&mut c, &f.m.id, false).await?;
    assert_eq!(m.status, "finished");
    let stages = storage::stages(&mut c, &m.id).await?;
    assert_eq!(stages.len(), 1);
    assert_eq!(
        stages[0].settlement_marker.as_deref(),
        Some(format!("relay-stage-settlement/v1:{}", stages[0].id).as_str())
    );
    let rows: i64 =
        sqlx::query_scalar("SELECT count(*) FROM multi_relay_stage_player WHERE match_id=$1")
            .bind(&m.id)
            .fetch_one(&mut *c)
            .await?;
    assert_eq!(rows, 4);
    let events: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM room_event WHERE room_id=$1 AND type='match.ended'",
    )
    .bind(&f.room.id)
    .fetch_one(&mut *c)
    .await?;
    assert_eq!(events, 1);
    let chat: i64 = sqlx::query_scalar("SELECT count(*) FROM multi_chat_message WHERE room_id=$1")
        .bind(&f.room.id)
        .fetch_one(&mut *c)
        .await?;
    assert_eq!(chat, 2);
    drop(c);
    let replay = act(
        &f.state,
        f.action(
            &encounters[0],
            1,
            encounters[0].turn_member_id.as_deref().unwrap(),
            "guess",
            "win-a",
            Some(&encounters[0].answer_id),
        ),
    )
    .await?;
    assert!(replay.body["accepted"].as_bool().unwrap());
    assert!(!replay.effect.game);
    let conflict = act(
        &f.state,
        f.action(
            &encounters[0],
            1,
            encounters[0].turn_member_id.as_deref().unwrap(),
            "pass",
            "win-a",
            None,
        ),
    )
    .await
    .err()
    .unwrap();
    assert_eq!(conflict.code, "IDEMPOTENCY_CONFLICT");
    f.close().await
}
#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn deadlines_commit_conflict_and_legacy_forfeit_keeps_compatibility() -> Result<()> {
    let f = Fixture::new(2, "legacy_wins", "bo3").await?;
    let e = f.encounters(1).await?.remove(0);
    *f.now.lock().unwrap() += TimeDelta::seconds(31);
    let actor = e.turn_member_id.as_deref().unwrap();
    let timeout = act(&f.state, f.action(&e, 1, actor, "pass", "late", None)).await?;
    assert_eq!(timeout.error.unwrap().code, "TURN_EXPIRED");
    assert!(timeout.effect.game);
    let turns: i64 =
        sqlx::query_scalar("SELECT count(*) FROM multi_relay_turn WHERE encounter_id=$1")
            .bind(&e.id)
            .fetch_one(&f.db.pool)
            .await?;
    assert_eq!(turns, 1);
    let forfeiter = f.players.iter().find(|p| p.id == actor).unwrap();
    relay::legacy_action(&f.state, &f.room.id, 1, forfeiter, "forfeit", "", None).await?;
    let stages = f.encounters(2).await?;
    assert_eq!(stages.len(), 1);
    let m = store::match_by_id(&mut *f.db.pool.acquire().await?, &f.m.id, false).await?;
    assert_eq!(m.status, "playing");
    assert_eq!(m.score_slot1 + m.score_slot2, 1);
    let mut tx = f.db.pool.begin().await?;
    let effect = relay::forfeit_member_tx(
        &f.state,
        &mut tx,
        &f.room,
        &f.players[0],
        "forfeit",
        (f.state.clock)(),
    )
    .await?;
    tx.commit().await?;
    assert!(effect.game);
    let m = store::match_by_id(&mut *f.db.pool.acquire().await?, &f.m.id, false).await?;
    assert_eq!(m.status, "finished");
    assert_eq!(m.score_slot1 + m.score_slot2, 1);
    f.close().await
}
#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn snapshots_hide_live_answers_and_history_reveals_only_terminal_stages() -> Result<()> {
    let f = Fixture::new(4, "fixed_points", "bo3").await?;
    let encounters = f.encounters(1).await?;
    relay::sweep(&f.state, 100).await?;
    let mut c = f.db.pool.acquire().await?;
    let m = store::match_by_id(&mut c, &f.m.id, false).await?;
    let snapshot = relay::snapshot(&f.state, &mut c, &f.room, &m, &f.players[0]).await?;
    let details = snapshot["relay"]["currentStage"]["encounterDetails"]
        .as_array()
        .unwrap();
    assert_eq!(details.len(), 2);
    for d in details {
        assert!(d.get("answer").is_none());
        assert!(d.get("answerId").is_none())
    }
    drop(c);
    let injected = json!({"matchIndex":0,"stageId":"s","stageIndex":1,"encounterId":"e","encounterIndex":1,"status":"playing","members":[{"memberId":"p1","seat":1,"side":1,"token":"secret"}],"answerId":"secret","answer":{"id":"secret"},"maxTurnsPerPlayer":8,"maxSkipsPerPlayer":2});
    let projected = relay::project_payload("relay.encounter.started", &injected, &f.players[0])?;
    assert!(!projected.to_string().contains("secret"));
    for (i, e) in encounters.iter().enumerate() {
        act(
            &f.state,
            f.action(
                e,
                1,
                e.turn_member_id.as_deref().unwrap(),
                "guess",
                &format!("win-{i}"),
                Some(&e.answer_id),
            ),
        )
        .await?;
    }
    let router = touhouflandre_api::router::router(f.state.clone()).unwrap();
    let history = request(
        &router,
        "GET",
        &format!("/api/rooms/{}/matches/0/stages?limit=1", f.room.id),
        Some("token1"),
        None,
    )
    .await;
    assert_eq!(history.0, axum::http::StatusCode::OK, "{}", history.1);
    assert_eq!(history.1["stages"].as_array().unwrap().len(), 1);
    assert!(
        history.1["stages"][0]["encounters"][0]
            .get("answer")
            .is_some()
    );
    assert!(history.1.get("nextCursor").is_none());
    drop(router);
    f.close().await
}
#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn sweep_recovery_and_batch_departure_are_transactional() -> Result<()> {
    let f = Fixture::new(4, "fixed_points", "bo3").await?;
    *f.now.lock().unwrap() += TimeDelta::seconds(3000);
    let effects = relay::sweep(&f.state, 100).await?;
    assert_eq!(effects.len(), 1);
    assert!(effects[0].game);
    assert_eq!(f.encounters(2).await?.len(), 2);
    // A stale disconnect selection must not remove a player who reconnected.
    let mut selected = f.players[0].clone();
    selected.status = "disconnected".into();
    selected.grace_until = Some((f.state.clock)() - TimeDelta::seconds(1));
    let mut tx = f.db.pool.begin().await?;
    let stale = relay::forfeit_members_tx(
        &f.state,
        &mut tx,
        &f.room,
        &[selected],
        "disconnect",
        (f.state.clock)(),
    )
    .await?;
    tx.commit().await?;
    assert!(!stale.game);
    sqlx::query("UPDATE multi_member SET status='disconnected',grace_until=$2 WHERE room_id=$1")
        .bind(&f.room.id)
        .bind((f.state.clock)() - TimeDelta::seconds(1))
        .execute(&f.db.pool)
        .await?;
    let mut tx = f.db.pool.begin().await?;
    let effect = relay::forfeit_members_tx(
        &f.state,
        &mut tx,
        &f.room,
        &f.players,
        "disconnect",
        (f.state.clock)(),
    )
    .await?;
    tx.commit().await?;
    assert!(effect.game);
    let m = store::match_by_id(&mut *f.db.pool.acquire().await?, &f.m.id, false).await?;
    assert_eq!(m.status, "finished");
    assert!(m.winner_member_id.is_none());
    assert!(relay::terminate_active(&f.state).await?.is_empty());
    f.close().await
}
#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn restart_terminates_active_encounters_once_without_announcements() -> Result<()> {
    let f = Fixture::new(4, "elimination", "bo1").await?;
    let effects = relay::terminate_active(&f.state).await?;
    assert_eq!(effects.len(), 1);
    assert!(!effects[0].chat);
    assert!(relay::terminate_active(&f.state).await?.is_empty());
    let ends:i64=sqlx::query_scalar("SELECT count(*) FROM multi_relay_encounter WHERE match_id=$1 AND status='ended' AND outcome='server_restart' AND turn_member_id IS NULL").bind(&f.m.id).fetch_one(&f.db.pool).await?;
    assert_eq!(ends, 2);
    let chat: i64 = sqlx::query_scalar("SELECT count(*) FROM multi_chat_message")
        .fetch_one(&f.db.pool)
        .await?;
    assert_eq!(chat, 0);
    f.close().await
}

#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn elimination_all_departures_and_restart_snapshots_remain_readable() -> Result<()> {
    for restart in [false, true] {
        let f = Fixture::new(4, "elimination", "bo1").await?;
        if restart {
            relay::terminate_active(&f.state).await?;
        } else {
            let mut tx = f.db.pool.begin().await?;
            relay::forfeit_members_tx(
                &f.state,
                &mut tx,
                &f.room,
                &f.players,
                "forfeit",
                (f.state.clock)(),
            )
            .await?;
            tx.commit().await?;
        }
        let mut c = f.db.pool.acquire().await?;
        let m = store::match_by_id(&mut c, &f.m.id, false).await?;
        assert_eq!(m.status, "finished");
        assert!(m.winner_member_id.is_none());
        let view = relay::snapshot(&f.state, &mut c, &f.room, &m, &f.players[0]).await?;
        let ranking = view["relay"]["ranking"].as_array().unwrap();
        assert_eq!(ranking.len(), 4);
        for rank in ranking {
            assert_eq!(rank["rank"], 1);
            assert_eq!(rank["survivedStages"], if restart { 0 } else { 1 });
            assert_eq!(rank["status"], if restart { "active" } else { "left" });
        }
        touhouflandre_api::contracts::decode::<touhouflandre_api::contracts::RelayMatchFragment>(
            view["relay"].clone(),
        )?;
        drop(c);
        f.close().await?;
    }
    Ok(())
}

#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn odd_active_roster_rotates_byes_and_keeps_questions_distinct() -> Result<()> {
    let f = Fixture::new(6, "fixed_points", "bo3").await?;
    let mut tx = f.db.pool.begin().await?;
    relay::forfeit_member_tx(
        &f.state,
        &mut tx,
        &f.room,
        &f.players[5],
        "forfeit",
        (f.state.clock)(),
    )
    .await?;
    tx.commit().await?;
    for e in f
        .encounters(1)
        .await?
        .into_iter()
        .filter(|e| e.status != "ended")
    {
        act(
            &f.state,
            f.action(
                &e,
                1,
                e.turn_member_id.as_deref().unwrap(),
                "guess",
                &format!("win-{}", e.id),
                Some(&e.answer_id),
            ),
        )
        .await?;
    }
    let mut c = f.db.pool.acquire().await?;
    let stages = storage::stages(&mut c, &f.m.id).await?;
    let bye2 = storage::bye(&mut c, &stages[1].id).await?.unwrap();
    assert_ne!(bye2.member_id, f.players[5].id);
    drop(c);
    for e in f.encounters(2).await? {
        act(
            &f.state,
            f.action(
                &e,
                2,
                e.turn_member_id.as_deref().unwrap(),
                "guess",
                &format!("win-{}", e.id),
                Some(&e.answer_id),
            ),
        )
        .await?;
    }
    let mut c = f.db.pool.acquire().await?;
    let stages = storage::stages(&mut c, &f.m.id).await?;
    let bye3 = storage::bye(&mut c, &stages[2].id).await?.unwrap();
    assert_ne!(bye2.member_id, bye3.member_id);
    let counts: (i64, i64) = sqlx::query_as(
        "SELECT count(*),count(DISTINCT answer_id) FROM multi_relay_encounter WHERE match_id=$1",
    )
    .bind(&f.m.id)
    .fetch_one(&mut *c)
    .await?;
    assert_eq!(counts, (7, 7));
    drop(c);
    f.close().await
}

#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn action_http_validates_contract_and_snapshot_capabilities() -> Result<()> {
    let f = Fixture::new(2, "legacy_wins", "bo3").await?;
    let e = f.encounters(1).await?.remove(0);
    let router = touhouflandre_api::router::router(f.state.clone()).unwrap();
    let actor = e.turn_member_id.as_deref().unwrap();
    let token = format!(
        "token{}",
        f.players.iter().find(|p| p.id == actor).unwrap().seat()
    );
    let path = format!(
        "/api/rooms/{}/stages/1/encounters/{}/actions",
        f.room.id, e.id
    );
    let bad = request(
        &router,
        "POST",
        &path,
        Some(&token),
        Some(json!({"action":"guess","guessId":e.answer_id,"idempotencyKey":""})),
    )
    .await;
    assert_eq!(bad.0, axum::http::StatusCode::BAD_REQUEST);
    touhouflandre_api::contracts::decode::<touhouflandre_api::contracts::ErrorResponse>(bad.1)?;
    let good = request(
        &router,
        "POST",
        &path,
        Some(&token),
        Some(json!({"action":"guess","guessId":e.answer_id,"idempotencyKey":"http-win"})),
    )
    .await;
    assert_eq!(good.0, axum::http::StatusCode::OK, "{}", good.1);
    touhouflandre_api::contracts::decode::<
        touhouflandre_api::contracts::RelayEncounterActionResponse,
    >(good.1)?;
    let mut c = f.db.pool.acquire().await?;
    let m = store::match_by_id(&mut c, &f.m.id, false).await?;
    let snapshot = relay::snapshot(&f.state, &mut c, &f.room, &m, &f.players[0]).await?;
    touhouflandre_api::contracts::decode::<touhouflandre_api::contracts::RelayMatchFragment>(
        snapshot["relay"].clone(),
    )?;
    let bad_path = request(
        &router,
        "GET",
        &format!("/api/rooms/{}/matches/wrong/stages", f.room.id),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(bad_path.0, axum::http::StatusCode::BAD_REQUEST);
    touhouflandre_api::contracts::decode::<touhouflandre_api::contracts::ErrorResponse>(
        bad_path.1,
    )?;
    drop(c);
    drop(router);
    f.close().await
}

#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn barrier_recovery_and_last_action_share_consistent_lock_order() -> Result<()> {
    let f = Fixture::new(4, "fixed_points", "bo1").await?;
    let encounters = f.encounters(1).await?;
    let first = &encounters[0];
    act(
        &f.state,
        f.action(
            first,
            1,
            first.turn_member_id.as_deref().unwrap(),
            "guess",
            "first",
            Some(&first.answer_id),
        ),
    )
    .await?;
    let e = &encounters[1];
    let action = f.action(
        e,
        1,
        e.turn_member_id.as_deref().unwrap(),
        "guess",
        "last",
        Some(&e.answer_id),
    );
    let stage = e.stage_id.clone();
    let (acted, retried) = tokio::time::timeout(std::time::Duration::from_secs(10), async {
        tokio::join!(act(&f.state, action), async {
            let mut tx = f.db.pool.begin().await?;
            relay::coordinator::try_settle(&f.state, &mut tx, &stage, None, (f.state.clock)())
                .await?;
            tx.commit().await?;
            Ok::<_, anyhow::Error>(())
        })
    })
    .await?;
    assert!(acted?.body["ended"].as_bool().unwrap());
    retried?;
    let count: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM room_event WHERE room_id=$1 AND type='relay.stage.ended'",
    )
    .bind(&f.room.id)
    .fetch_one(&f.db.pool)
    .await?;
    assert_eq!(count, 1);
    f.close().await
}

#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn eight_player_last_encounters_settle_one_barrier_and_no_legacy_scores() -> Result<()> {
    let f = Fixture::new(8, "fixed_points", "bo1").await?;
    let encounters = f.encounters(1).await?;
    assert_eq!(encounters.len(), 4);
    let actions = encounters.iter().map(|e| {
        act(
            &f.state,
            f.action(
                e,
                1,
                e.turn_member_id.as_deref().unwrap(),
                "guess",
                &format!("win-{}", e.id),
                Some(&e.answer_id),
            ),
        )
    });
    let results = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        futures_util::future::join_all(actions),
    )
    .await?;
    for result in results {
        assert!(result?.body["ended"].as_bool().unwrap())
    }
    let mut c = f.db.pool.acquire().await?;
    let m = store::match_by_id(&mut c, &f.m.id, false).await?;
    assert_eq!(m.status, "finished");
    assert_eq!((m.score_slot1, m.score_slot2), (0, 0));
    let common = store::match_players(&mut c, &f.m.id).await?;
    assert!(common.iter().all(|p| p.score == 0 && p.wins == 0));
    let standings = storage::standings(&mut c, &f.m.id).await?;
    assert_eq!(standings.iter().filter(|p| p.score == 2).count(), 4);
    drop(c);
    f.close().await
}

#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn elimination_ignores_format_cap_and_settles_survival_winner() -> Result<()> {
    let f = Fixture::new(4, "elimination", "bo1").await?;
    // Previously reached near death, still active. A second negative result
    // eliminates, while a win cannot heal or add legacy wins/score.
    sqlx::query("UPDATE multi_relay_match_player_state SET score=0,life_state='near_death' WHERE match_id=$1").bind(&f.m.id).execute(&f.db.pool).await?;
    for e in f.encounters(1).await? {
        act(
            &f.state,
            f.action(
                &e,
                1,
                e.turn_member_id.as_deref().unwrap(),
                "guess",
                &format!("win-{}", e.id),
                Some(&e.answer_id),
            ),
        )
        .await?;
    }
    let next = f.encounters(2).await?;
    assert_eq!(next.len(), 1);
    let e = &next[0];
    act(
        &f.state,
        f.action(
            e,
            2,
            e.turn_member_id.as_deref().unwrap(),
            "guess",
            "last",
            Some(&e.answer_id),
        ),
    )
    .await?;
    let mut c = f.db.pool.acquire().await?;
    let m = store::match_by_id(&mut c, &f.m.id, false).await?;
    assert_eq!(m.max_rounds, 1);
    assert_eq!(m.round_count, 2);
    assert_eq!(m.status, "finished");
    assert_eq!(m.winner_member_id, e.turn_member_id);
    let view = relay::snapshot(&f.state, &mut c, &f.room, &m, &f.players[0]).await?;
    assert_eq!(view["relay"]["ranking"][0]["score"], 0);
    assert_eq!(view["relay"]["ranking"][0]["survivedStages"], 2);
    assert_eq!(
        view["relay"]["ranking"][0]["memberId"],
        e.turn_member_id.as_deref().unwrap()
    );
    touhouflandre_api::contracts::decode::<touhouflandre_api::contracts::RelayMatchFragment>(
        view["relay"].clone(),
    )?;
    drop(c);
    f.close().await
}

#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn too_small_initial_pool_rolls_back_frozen_stage_and_roster_changes() -> Result<()> {
    let f = Fixture::new(4, "fixed_points", "bo1").await?;
    let mut tx = f.db.pool.begin().await?;
    sqlx::query("DELETE FROM multi_relay_stage WHERE match_id=$1")
        .bind(&f.m.id)
        .execute(&mut *tx)
        .await?;
    let mut m = f.m.clone();
    let chars = seed::load_catalog(
        &std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/data/src"),
    )?
    .characters;
    let answer = chars.iter().find(|c| c.enabled_as_answer).unwrap();
    m.question_scope = Some(json!({"selectedCharacterIds":[answer.id]}));
    let error = relay::start_match_tx(
        &f.state,
        &mut tx,
        &f.room,
        &m,
        &f.players,
        &chars,
        (f.state.clock)(),
    )
    .await
    .unwrap_err();
    assert_eq!(error.code, "QUESTION_POOL_TOO_SMALL_FOR_PAIRINGS");
    assert_eq!(error.status, axum::http::StatusCode::CONFLICT);
    tx.rollback().await?;
    let encounters = f.encounters(1).await?;
    assert_eq!(encounters.len(), 2);
    let events: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM room_event WHERE room_id=$1 AND type='relay.stage.started'",
    )
    .bind(&f.room.id)
    .fetch_one(&f.db.pool)
    .await?;
    assert_eq!(events, 1);
    f.close().await
}

#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn queued_action_uses_time_after_encounter_lock() -> Result<()> {
    let f = Fixture::new(2, "legacy_wins", "bo3").await?;
    let e = f.encounters(1).await?.remove(0);
    let mut blocker = f.db.pool.begin().await?;
    sqlx::query("SELECT id FROM multi_relay_encounter WHERE id=$1 FOR UPDATE")
        .bind(&e.id)
        .fetch_one(&mut *blocker)
        .await?;
    let state = f.state.clone();
    let input = f.action(
        &e,
        1,
        e.turn_member_id.as_deref().unwrap(),
        "pass",
        "queued",
        None,
    );
    let pending = tokio::spawn(async move { act(&state, input).await });
    tokio::time::timeout(std::time::Duration::from_secs(3),async{loop{let waiting:bool=sqlx::query_scalar("SELECT EXISTS(SELECT 1 FROM pg_stat_activity WHERE datname=current_database() AND wait_event_type='Lock' AND query LIKE 'SELECT e.* FROM multi_relay_encounter e JOIN multi_relay_stage%')").fetch_one(&f.db.pool).await.unwrap();if waiting{break}tokio::time::sleep(std::time::Duration::from_millis(10)).await;}}).await?;
    *f.now.lock().unwrap() += TimeDelta::seconds(31);
    blocker.commit().await?;
    let result = pending.await??;
    assert_eq!(result.error.unwrap().code, "TURN_EXPIRED");
    let kinds: Vec<String> = sqlx::query_scalar(
        "SELECT kind FROM multi_relay_turn WHERE encounter_id=$1 ORDER BY turn_index",
    )
    .bind(&e.id)
    .fetch_all(&f.db.pool)
    .await?;
    assert_eq!(kinds, vec!["timeout"]);
    f.close().await
}
