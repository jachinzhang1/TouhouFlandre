mod support;
use axum::{Router, http::StatusCode};
use chrono::{TimeZone, Utc};
use serde_json::{Value, json};
use std::{
    collections::HashMap,
    sync::{
        Arc,
        atomic::{AtomicI64, Ordering},
    },
};
use support::{Database, app, request};
use touhouflandre_api::{
    app::AppState,
    config::Config,
    contracts,
    repository::{
        models::{MatchPlayer, RoomEvent},
        multi as store,
    },
    seed,
    service::multi::{self, auth, projection, race, rooms},
};

struct Harness {
    db: Database,
    state: AppState,
    app: Router,
    clock: Arc<AtomicI64>,
}
#[derive(Clone)]
struct Player {
    id: String,
    token: String,
}
struct RoomSetup {
    id: String,
    code: String,
    players: Vec<Player>,
}
impl Harness {
    async fn new() -> Self {
        let db = Database::new().await.unwrap();
        seed::run(
            &db.pool,
            &std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/data/src"),
        )
        .await
        .unwrap();
        let config = Config::from_values(&HashMap::from([
            ("MULTI_JOIN_RATE_LIMIT".into(), "10000".into()),
            ("MULTI_PROJECTION_SECRET".into(), "stable-secret".into()),
        ]))
        .unwrap();
        let mut state = AppState::new(db.pool.clone(), config);
        let clock = Arc::new(AtomicI64::new(1_800_000_000));
        let source = clock.clone();
        state.clock =
            Arc::new(move || Utc.timestamp_opt(source.load(Ordering::SeqCst), 0).unwrap());
        state.random_index = Arc::new(|_| 0);
        let app = app(state.clone());
        Self {
            db,
            state,
            app,
            clock,
        }
    }
    async fn room(&self, n: usize, format: &str, elimination: bool) -> RoomSetup {
        let(status,v,_)=request(&self.app,"POST","/api/rooms",None,Some(json!({"format":format,"mode":"race","playerLimit":n,"raceEliminationEnabled":elimination,"displayName":"  房主\u{0007}😀  "}))).await;
        assert_eq!(status, StatusCode::CREATED, "{v}");
        contracts::validate_value("CreateRoomResponse", &v).unwrap();
        let mut room = RoomSetup {
            id: v["roomId"].as_str().unwrap().into(),
            code: v["roomCode"].as_str().unwrap().into(),
            players: vec![Player {
                id: v["viewer"]["memberId"].as_str().unwrap().into(),
                token: v["guestToken"].as_str().unwrap().into(),
            }],
        };
        for index in 1..n {
            let p = self.join(&room.code, &format!("玩家{index}")).await;
            room.players.push(p);
        }
        room
    }
    async fn join(&self, code: &str, name: &str) -> Player {
        let (status, v, _) = request(
            &self.app,
            "POST",
            &format!("/api/rooms/{code}/join"),
            None,
            Some(json!({"displayName":name})),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{v}");
        contracts::validate_value("JoinRoomResponse", &v).unwrap();
        Player {
            id: v["viewer"]["memberId"].as_str().unwrap().into(),
            token: v["guestToken"].as_str().unwrap().into(),
        }
    }
    async fn ready(&self, r: &RoomSetup, p: &Player) -> StatusCode {
        let (status, v, _) = request(
            &self.app,
            "POST",
            &format!("/api/rooms/{}/ready", r.id),
            Some(&p.token),
            Some(json!({"ready":true})),
        )
        .await;
        assert_eq!(status, StatusCode::NO_CONTENT, "{v}");
        status
    }
    async fn start(&self, r: &RoomSetup) {
        for p in &r.players {
            self.ready(r, p).await;
        }
        self.clock.fetch_add(4, Ordering::SeqCst);
        race::sweep_room(&self.state, &r.id).await.unwrap();
    }
    async fn snapshot(&self, r: &RoomSetup, p: &Player) -> Value {
        let (status, v, _) = request(
            &self.app,
            "GET",
            &format!("/api/rooms/{}/snapshot", r.id),
            Some(&p.token),
            None,
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{v}");
        contracts::validate_value("RoomSnapshot", &v).unwrap();
        v
    }
    async fn current(&self, r: &RoomSetup) -> (String, String, i32) {
        sqlx::query_as("SELECT r.id,r.answer_id,r.round_index FROM multi_round r JOIN multi_match m ON m.id=r.match_id WHERE m.room_id=$1 ORDER BY m.match_index DESC,r.round_index DESC LIMIT 1").bind(&r.id).fetch_one(&self.db.pool).await.unwrap()
    }
    async fn guess(&self, r: &RoomSetup, p: &Player, id: &str, key: &str) -> (StatusCode, Value) {
        let (_, _, index) = self.current(r).await;
        let (status, v, _) = request(
            &self.app,
            "POST",
            &format!("/api/rooms/{}/rounds/{index}/guess", r.id),
            Some(&p.token),
            Some(json!({"guessId":id,"idempotencyKey":key})),
        )
        .await;
        if status == StatusCode::OK {
            contracts::validate_value("RoomsSubmitGuessResponse200", &v).unwrap();
        }
        (status, v)
    }
    async fn close(self) {
        drop(self.app);
        drop(self.state);
        self.db.close().await.unwrap();
    }
}
fn player(id: &str, seat: i32, score: i32, status: &str) -> MatchPlayer {
    MatchPlayer {
        match_id: "m".into(),
        member_id: id.into(),
        seat,
        wins: score,
        status: status.into(),
        score,
        best_round_score: score,
        eliminated_round: None,
    }
}
#[test]
fn identity_and_projection_go_goldens() {
    assert_eq!(rooms::normalize_name(" \n灵\u{0007}梦😀 "), "灵梦😀");
    assert_eq!(rooms::normalize_name("\n\u{0000}"), "匿名玩家");
    assert_eq!(rooms::normalize_name(&"😀".repeat(20)).chars().count(), 16);
    assert_eq!(rooms::normalize_code(" ab-cd ef "), "ABCDEF");
    assert_eq!(auth::credential("Bearer guest:opaque ").unwrap(), "opaque");
    assert!(auth::credential("bearer guest:opaque").is_err());
    let token = auth::generate_token().unwrap();
    assert_eq!(token.len(), 43);
    assert!(!token.contains('='));
    assert_eq!(
        auth::hash_token("abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert_eq!(multi::new_id().len(), 25);
    // Independent Go 1.27.1 math/rand/v2 PCG + Shuffle output, including Unicode seed input.
    for (n, expected) in [
        (0, vec![]),
        (2, vec![0, 1]),
        (6, vec![1, 5, 0, 4, 2, 3]),
        (8, vec![6, 5, 1, 2, 0, 4, 3, 7]),
        (
            17,
            vec![16, 13, 15, 11, 2, 14, 4, 5, 7, 9, 8, 6, 3, 0, 12, 1, 10],
        ),
    ] {
        assert_eq!(
            projection::column_permutation(
                b"stable-secret",
                "round/测试",
                "observer1",
                "subject2",
                n
            ),
            expected
        );
    }
    assert_eq!(
        projection::column_permutation(b"stable-secret", "round/测试", "observer1", "subject2", 1),
        vec![0]
    );
    let tied_low = vec![
        player("a", 1, 0, "active"),
        player("b", 2, 0, "active"),
        player("c", 3, 3, "active"),
    ];
    assert_eq!(
        race::unique_top(&tied_low),
        None,
        "preserve Go's early tie behavior during migration"
    );
    let same = vec![
        player("a", 1, 2, "active"),
        player("b", 2, 2, "active"),
        player("c", 3, 2, "active"),
    ];
    assert!(race::elimination_candidates(&same, 3, 2).is_empty());
    let ranked = race::ranking(&same);
    assert_eq!(ranked[0]["rank"], 1);
    assert_eq!(ranked[2]["rank"], 1);
}

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn lobby_capacity_claim_settings_and_auth() {
    let h = Harness::new().await;
    let r = h.room(4, "bo3", false).await;
    let host = &r.players[0];
    let snap = h.snapshot(&r, host).await;
    assert_eq!(snap["viewer"]["displayName"], "房主😀");
    let (status, info, _) =
        request(&h.app, "GET", &format!("/api/rooms/{}", r.code), None, None).await;
    assert_eq!(status, StatusCode::OK);
    contracts::validate_value("RoomInfo", &info).unwrap();
    assert!(info["members"][0].get("displayName").is_none());
    let spect1 = h.join(&r.code, "旁观1").await;
    let spect2 = h.join(&r.code, "旁观2").await;
    assert_eq!(h.snapshot(&r, &spect1).await["viewer"]["role"], "spectator");
    let (status, error, _) = request(
        &h.app,
        "POST",
        &format!("/api/rooms/{}/ready", r.id),
        Some(&spect1.token),
        Some(json!({"ready":true})),
    )
    .await;
    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(error["code"], "SPECTATOR_READ_ONLY");
    let before = sqlx::query_scalar::<_, i64>("SELECT event_seq FROM multi_room WHERE id=$1")
        .bind(&r.id)
        .fetch_one(&h.db.pool)
        .await
        .unwrap();
    let (status, _, _) = request(
        &h.app,
        "POST",
        &format!("/api/rooms/{}/ready", r.id),
        Some(&host.token),
        Some(json!({"ready":false})),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT);
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT event_seq FROM multi_room WHERE id=$1")
            .bind(&r.id)
            .fetch_one(&h.db.pool)
            .await
            .unwrap(),
        before
    );
    let leave_path = format!("/api/rooms/{}/leave", r.id);
    assert_eq!(
        request(&h.app, "POST", &leave_path, Some(&r.players[1].token), None)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    let path = format!("/api/rooms/{}/claim-seat", r.id);
    let (a, b) = tokio::join!(
        request(&h.app, "POST", &path, Some(&spect1.token), None),
        request(&h.app, "POST", &path, Some(&spect2.token), None)
    );
    assert_eq!(
        [a.0, b.0]
            .iter()
            .filter(|s| **s == StatusCode::NO_CONTENT)
            .count(),
        1
    );
    assert_eq!(
        [a.0, b.0]
            .iter()
            .filter(|s| **s == StatusCode::CONFLICT)
            .count(),
        1
    );
    // Vacate seat 3; shrinking preserves IDs while moving seat 4 into the gap.
    assert_eq!(
        request(&h.app, "POST", &leave_path, Some(&r.players[2].token), None)
            .await
            .0,
        StatusCode::NO_CONTENT
    );
    let (status, value, _) = request(
        &h.app,
        "PATCH",
        &format!("/api/rooms/{}/settings", r.id),
        Some(&host.token),
        Some(json!({"playerLimit":3})),
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{value}");
    assert_eq!(
        sqlx::query_scalar::<_, i32>("SELECT seat FROM multi_member WHERE id=$1")
            .bind(&r.players[3].id)
            .fetch_one(&h.db.pool)
            .await
            .unwrap(),
        3
    );
    assert_eq!(h.snapshot(&r, host).await["playerLimit"], 3);
    let (status, error, _) = request(
        &h.app,
        "GET",
        &format!("/api/rooms/{}/snapshot", r.id),
        Some("bad-token"),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    assert_eq!(error["code"], "GUEST_UNAUTHORIZED");
    h.close().await;
}

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn joining_and_final_ready_have_one_frozen_roster() {
    let h = Harness::new().await;
    for _ in 0..4 {
        let mut r = h.room(2, "bo1", false).await;
        let host = &r.players[0];
        assert_eq!(
            request(
                &h.app,
                "PATCH",
                &format!("/api/rooms/{}/settings", r.id),
                Some(&host.token),
                Some(json!({"playerLimit":3}))
            )
            .await
            .0,
            StatusCode::NO_CONTENT
        );
        h.ready(&r, host).await;
        let ready_path = format!("/api/rooms/{}/ready", r.id);
        let join_path = format!("/api/rooms/{}/join", r.code);
        let (a, b) = tokio::join!(
            request(
                &h.app,
                "POST",
                &ready_path,
                Some(&r.players[1].token),
                Some(json!({"ready":true}))
            ),
            request(&h.app, "POST", &join_path, None, Some(json!({})))
        );
        assert_eq!(a.0, StatusCode::NO_CONTENT, "{}", a.1);
        assert_eq!(b.0, StatusCode::CREATED, "{}", b.1);
        let mut conn = h.db.pool.acquire().await.unwrap();
        let room = store::room(&mut conn, &r.id, false).await.unwrap();
        let m = store::latest_match(&mut conn, &r.id, false).await.unwrap();
        if b.1["joinRole"] == "spectator" {
            assert_eq!(room.status, "playing");
            assert_eq!(m.unwrap().roster_size, 2);
        } else {
            assert_eq!(room.status, "lobby");
            assert!(m.is_none());
            r.players.push(Player {
                id: b.1["viewer"]["memberId"].as_str().unwrap().into(),
                token: b.1["guestToken"].as_str().unwrap().into(),
            });
            drop(conn);
            h.ready(&r, r.players.last().unwrap()).await;
            let count: i64 =
                sqlx::query_scalar("SELECT count(*) FROM multi_match WHERE room_id=$1")
                    .bind(&r.id)
                    .fetch_one(&h.db.pool)
                    .await
                    .unwrap();
            assert_eq!(count, 1);
        }
    }
    h.close().await;
}

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn concurrent_correct_guesses_unique_finish_ranks_and_secret_projection() {
    let h = Harness::new().await;
    let r = h.room(3, "bo1", false).await;
    let spectator = h.join(&r.code, "旁观").await;
    h.start(&r).await;
    let (round, answer, index) = h.current(&r).await;
    let path = format!("/api/rooms/{}/rounds/{index}/guess", r.id);
    let (a, b) = tokio::join!(
        request(
            &h.app,
            "POST",
            &path,
            Some(&r.players[0].token),
            Some(json!({"guessId":answer,"idempotencyKey":"finish-a"}))
        ),
        request(
            &h.app,
            "POST",
            &path,
            Some(&r.players[1].token),
            Some(json!({"guessId":answer,"idempotencyKey":"finish-b"}))
        )
    );
    assert_eq!(a.0, StatusCode::OK, "{}", a.1);
    assert_eq!(b.0, StatusCode::OK, "{}", b.1);
    let mut ranks = vec![
        a.1["finishRank"].as_i64().unwrap(),
        b.1["finishRank"].as_i64().unwrap(),
    ];
    ranks.sort();
    assert_eq!(ranks, vec![1, 2]);
    let snap = h.snapshot(&r, &r.players[2]).await;
    assert!(snap["round"].get("boards").is_none());
    assert_eq!(snap["round"]["opponents"].as_array().unwrap().len(), 2);
    assert!(
        snap["round"]["opponents"]
            .to_string()
            .find("guessId")
            .is_none()
    );
    assert!(snap["round"].get("answer").is_none());
    let spectator_snap = h.snapshot(&r, &spectator).await;
    assert_eq!(
        spectator_snap["round"]["boards"].as_array().unwrap().len(),
        3
    );
    let event:RoomEvent=sqlx::query_as("SELECT * FROM room_event WHERE room_id=$1 AND type='round.opponent.guess' ORDER BY sequence LIMIT 1").bind(&r.id).fetch_one(&h.db.pool).await.unwrap();
    let mut conn = h.db.pool.acquire().await.unwrap();
    let author = store::member(&mut conn, event.payload["memberId"].as_str().unwrap())
        .await
        .unwrap();
    drop(conn);
    let own = projection::project_event(&h.state, &event, &author)
        .await
        .unwrap();
    assert_eq!(own["type"], "room.cursor");
    assert!(own.get("payload").is_none());
    let (status, v) = h.guess(&r, &r.players[2], &answer, "finish-c").await;
    assert_eq!(status, StatusCode::OK, "{v}");
    let ranked:Vec<(i32,i32)>=sqlx::query_as("SELECT finish_rank,points_awarded FROM multi_round_player WHERE round_id=$1 ORDER BY finish_rank").bind(round).fetch_all(&h.db.pool).await.unwrap();
    assert_eq!(ranked, vec![(1, 3), (2, 2), (3, 1)]);
    let finished = h.snapshot(&r, &r.players[0]).await;
    assert_eq!(finished["status"], "finished");
    let end = finished["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["type"] == "round.ended")
        .unwrap();
    assert_eq!(end["payload"]["answer"]["id"], answer);
    assert_eq!(end["payload"]["boards"].as_array().unwrap().len(), 3);
    assert_eq!(
        finished["events"]
            .as_array()
            .unwrap()
            .iter()
            .filter(|e| e["type"] == "match.ended")
            .count(),
        1
    );
    h.close().await;
}

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn wins_rematch_and_timeout_conflict_commit() {
    let h = Harness::new().await;
    let r = h.room(2, "bo1", false).await;
    h.start(&r).await;
    let (_, answer, _) = h.current(&r).await;
    let (status, v) = h.guess(&r, &r.players[0], &answer, "win").await;
    assert_eq!(status, StatusCode::OK, "{v}");
    assert_eq!(h.snapshot(&r, &r.players[0]).await["status"], "finished");
    let path = format!("/api/rooms/{}/rematch", r.id);
    for p in &r.players {
        let (status, v, _) = request(&h.app, "POST", &path, Some(&p.token), None).await;
        assert_eq!(status, StatusCode::NO_CONTENT, "{v}");
    }
    let m: (i32,i32)=sqlx::query_as("SELECT match_index,round_count FROM multi_match WHERE room_id=$1 ORDER BY match_index DESC LIMIT 1").bind(&r.id).fetch_one(&h.db.pool).await.unwrap();
    assert_eq!(m, (1, 1));
    h.clock.fetch_add(4, Ordering::SeqCst);
    race::sweep_room(&h.state, &r.id).await.unwrap();
    let (round, answer, _) = h.current(&r).await;
    h.clock.fetch_add(301, Ordering::SeqCst);
    let (status, v) = h.guess(&r, &r.players[0], &answer, "late").await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(v["code"], "ROUND_NOT_ACTIVE");
    let status: String = sqlx::query_scalar("SELECT status FROM multi_round WHERE id=$1")
        .bind(&round)
        .fetch_one(&h.db.pool)
        .await
        .unwrap();
    assert_eq!(status, "ended");
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM multi_guess WHERE round_id=$1")
        .bind(&round)
        .fetch_one(&h.db.pool)
        .await
        .unwrap();
    assert_eq!(count, 0);
    assert_eq!(h.snapshot(&r, &r.players[0]).await["status"], "finished");
    h.close().await;
}

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn departures_batch_disconnect_and_reconnect_recheck() {
    let h = Harness::new().await;
    let r = h.room(3, "bo3", false).await;
    h.start(&r).await;
    let (round, answer, _) = h.current(&r).await;
    assert_eq!(
        h.guess(&r, &r.players[0], &answer, "early").await.0,
        StatusCode::OK
    );
    let (status, v, _) = request(
        &h.app,
        "POST",
        &format!("/api/rooms/{}/leave", r.id),
        Some(&r.players[0].token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{v}");
    let row:(String,Option<i32>,i32)=sqlx::query_as("SELECT status,finish_rank,points_awarded FROM multi_round_player WHERE round_id=$1 AND member_id=$2").bind(&round).bind(&r.players[0].id).fetch_one(&h.db.pool).await.unwrap();
    assert_eq!(row, ("forfeited".into(), None, 0));
    assert_eq!(
        h.snapshot(&r, &r.players[0]).await["viewer"]["status"],
        "left"
    );
    let rematch = request(
        &h.app,
        "POST",
        &format!("/api/rooms/{}/rematch", r.id),
        Some(&r.players[0].token),
        None,
    )
    .await;
    assert_eq!(rematch.0, StatusCode::UNAUTHORIZED);
    let now = (h.state.clock)();
    sqlx::query("UPDATE multi_member SET status='disconnected',grace_until=$2 WHERE room_id=$1 AND status<>'left'").bind(&r.id).bind(now).execute(&h.db.pool).await.unwrap();
    let mut conn = h.db.pool.acquire().await.unwrap();
    let room = store::room(&mut conn, &r.id, false).await.unwrap();
    let candidates: Vec<_> = store::members(&mut conn, &r.id)
        .await
        .unwrap()
        .into_iter()
        .filter(|m| m.status == "disconnected")
        .collect();
    drop(conn);
    sqlx::query("UPDATE multi_member SET status='connected',grace_until=NULL WHERE id=$1")
        .bind(&r.players[1].id)
        .execute(&h.db.pool)
        .await
        .unwrap();
    let mut tx = h.db.pool.begin().await.unwrap();
    let effect = race::forfeit_members_tx(&h.state, &mut tx, &room, &candidates, "disconnect", now)
        .await
        .unwrap();
    tx.commit().await.unwrap();
    assert!(effect.game);
    let connected: String = sqlx::query_scalar("SELECT status FROM multi_member WHERE id=$1")
        .bind(&r.players[1].id)
        .fetch_one(&h.db.pool)
        .await
        .unwrap();
    assert_eq!(connected, "connected");
    let r2 = h.room(2, "bo3", false).await;
    h.start(&r2).await;
    sqlx::query("UPDATE multi_member SET status='disconnected',grace_until=$2 WHERE room_id=$1")
        .bind(&r2.id)
        .bind((h.state.clock)())
        .execute(&h.db.pool)
        .await
        .unwrap();
    let mut tx = h.db.pool.begin().await.unwrap();
    let room = store::room(&mut tx, &r2.id, false).await.unwrap();
    let members = store::members(&mut tx, &r2.id).await.unwrap();
    race::forfeit_members_tx(
        &h.state,
        &mut tx,
        &room,
        &members,
        "disconnect",
        (h.state.clock)(),
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    let winner: Option<String> =
        sqlx::query_scalar("SELECT winner_member_id FROM multi_match WHERE room_id=$1")
            .bind(&r2.id)
            .fetch_one(&h.db.pool)
            .await
            .unwrap();
    assert!(winner.is_none());
    let statuses:Vec<String>=sqlx::query_scalar("SELECT p.status FROM multi_match_player p JOIN multi_match m ON m.id=p.match_id WHERE m.room_id=$1").bind(&r2.id).fetch_all(&h.db.pool).await.unwrap();
    assert!(statuses.iter().all(|s| s == "left"));
    h.close().await;
}

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn equivalent_answers_survive_snapshots_and_round_end_replay() {
    use touhouflandre_api::game::*;
    use touhouflandre_api::service::catalog;
    let h = Harness::new().await;
    // A second ID with identical public fields makes this regression independent
    // of whether the released catalog currently happens to contain such a pair.
    let mut conn = h.db.pool.acquire().await.unwrap();
    let (version, mut chars, _) = catalog::current_catalog(&mut conn).await.unwrap();
    let answer = chars
        .iter()
        .find(|c| c.enabled_as_answer && c.enabled_as_guess && equivalence_signature(c).is_some())
        .unwrap()
        .clone();
    let mut equivalent = answer.clone();
    equivalent.id = "equivalent-fixture".into();
    equivalent.names.zh_hans = "等价角色".into();
    equivalent.enabled_as_answer = false;
    chars.push(equivalent.clone());
    sqlx::query("UPDATE catalog_snapshot SET characters=$2 WHERE version=$1")
        .bind(&version)
        .bind(json!(chars))
        .execute(&mut *conn)
        .await
        .unwrap();
    drop(conn);
    let r = h.room(3, "bo3", false).await;
    let spectator = h.join(&r.code, "旁观").await;
    h.start(&r).await;
    let (round, _, _) = h.current(&r).await;
    sqlx::query("UPDATE multi_round SET answer_id=$2 WHERE id=$1")
        .bind(&round)
        .bind(&answer.id)
        .execute(&h.db.pool)
        .await
        .unwrap();
    let (status, response) = h
        .guess(&r, &r.players[0], &equivalent.id, "equivalent")
        .await;
    assert_eq!(status, StatusCode::OK, "{response}");
    assert_eq!(response["guess"]["matchKind"], "equivalent");
    assert_eq!(response["guess"]["kind"], "guess");
    let own = h.snapshot(&r, &r.players[0]).await;
    assert_eq!(
        own["round"]["self"]["guesses"][0]["matchKind"],
        "equivalent"
    );
    let observed = h.snapshot(&r, &spectator).await;
    let board = observed["round"]["boards"]
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["memberId"] == r.players[0].id)
        .unwrap();
    assert_eq!(board["guesses"][0]["matchKind"], "equivalent");
    let event = observed["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["type"] == "round.spectator.guess")
        .unwrap();
    assert_eq!(event["payload"]["guess"]["matchKind"], "equivalent");
    assert!(
        event["payload"]["guess"].get("kind").is_none(),
        "legacy event views omit the REST discriminator"
    );
    for p in &r.players[1..] {
        assert_eq!(h.guess(&r, p, &answer.id, "exact").await.0, StatusCode::OK);
    }
    let ended = h.snapshot(&r, &spectator).await;
    assert!(
        ended.get("round").is_none(),
        "original active_round SQL omits ended rounds during intermission"
    );
    let event = ended["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["type"] == "round.ended")
        .unwrap();
    assert_eq!(event["payload"]["answer"]["id"], answer.id);
    let boards = event["payload"]["boards"].as_array().unwrap();
    for (i, p) in r.players.iter().enumerate() {
        let guess = &boards.iter().find(|b| b["memberId"] == p.id).unwrap()["guesses"][0];
        assert_eq!(
            guess["matchKind"],
            if i == 0 { "equivalent" } else { "exact" }
        );
    }
    h.close().await;
}

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn frozen_unknown_rules_and_disabled_modes_reject_without_mutation() {
    let h = Harness::new().await;
    let r = h.room(2, "bo3", false).await;
    h.start(&r).await;
    let (_, answer, _) = h.current(&r).await;
    let original: i64 = sqlx::query_scalar("SELECT event_seq FROM multi_room WHERE id=$1")
        .bind(&r.id)
        .fetch_one(&h.db.pool)
        .await
        .unwrap();
    sqlx::query(
        "UPDATE multi_match SET rule_set_key='future_rule',rule_set_version=2 WHERE room_id=$1",
    )
    .bind(&r.id)
    .execute(&h.db.pool)
    .await
    .unwrap();
    for path in [
        format!("/api/rooms/{}/snapshot", r.id),
        format!("/api/rooms/{}/rounds/1/guess", r.id),
    ] {
        let method = if path.ends_with("guess") {
            "POST"
        } else {
            "GET"
        };
        let body = if method == "POST" {
            Some(json!({"guessId":answer,"idempotencyKey":"unknown"}))
        } else {
            None
        };
        let (status, error, _) =
            request(&h.app, method, &path, Some(&r.players[0].token), body).await;
        assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{error}");
        assert_eq!(error["code"], "INTERNAL");
    }
    assert!(race::sweep_room(&h.state, &r.id).await.is_err());
    let after: i64 = sqlx::query_scalar("SELECT event_seq FROM multi_room WHERE id=$1")
        .bind(&r.id)
        .fetch_one(&h.db.pool)
        .await
        .unwrap();
    assert_eq!(after, original);
    let restricted = AppState::new(
        h.db.pool.clone(),
        Config::from_values(&HashMap::from([
            ("MULTI_MODE_REGISTRY".into(), "relay-only".into()),
            ("MULTI_JOIN_RATE_LIMIT".into(), "10000".into()),
        ]))
        .unwrap(),
    );
    let restricted_app = app(restricted);
    let (status, error, _) = request(
        &restricted_app,
        "GET",
        &format!("/api/rooms/{}", r.code),
        None,
        None,
    )
    .await;
    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR, "{error}");
    assert_eq!(error["code"], "INTERNAL");
    drop(restricted_app);
    h.close().await;
}

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn relay_public_creation_uses_trigger_backed_config_and_freezes_ready_roster() {
    let h = Harness::new().await;
    for elimination in [false, true] {
        let(status,v,_)=request(&h.app,"POST","/api/rooms",None,Some(json!({"format":"bo3","mode":"relay","playerLimit":4,"displayName":"主人","relayEliminationEnabled":elimination}))).await;
        assert_eq!(status, StatusCode::CREATED, "{v}");
        contracts::validate_value("CreateRoomResponse", &v).unwrap();
        let mut r = RoomSetup {
            id: v["roomId"].as_str().unwrap().into(),
            code: v["roomCode"].as_str().unwrap().into(),
            players: vec![Player {
                id: v["viewer"]["memberId"].as_str().unwrap().into(),
                token: v["guestToken"].as_str().unwrap().into(),
            }],
        };
        let config: bool = sqlx::query_scalar(
            "SELECT elimination_enabled FROM multi_relay_room_config WHERE room_id=$1",
        )
        .bind(&r.id)
        .fetch_one(&h.db.pool)
        .await
        .unwrap();
        assert_eq!(config, elimination);
        for index in 1..4 {
            r.players
                .push(h.join(&r.code, &format!("接力{index}")).await);
        }
        for p in &r.players {
            h.ready(&r, p).await;
        }
        let snap = h.snapshot(&r, &r.players[0]).await;
        assert_eq!(snap["status"], "playing");
        assert_eq!(snap["match"]["rosterSize"], 4);
        assert_eq!(
            snap["match"]["ruleSetRef"]["key"],
            if elimination {
                "elimination"
            } else {
                "fixed_points"
            }
        );
        assert!(snap["match"].get("relay").is_some());
        h.clock.fetch_add(4, Ordering::SeqCst);
        multi::relay::sweep(&h.state, 100).await.unwrap();
        let (encounter,answer,actor):(String,String,String)=sqlx::query_as("SELECT e.id,e.answer_id,e.turn_member_id FROM multi_relay_encounter e JOIN multi_match m ON m.id=e.match_id WHERE m.room_id=$1 ORDER BY e.encounter_index LIMIT 1").bind(&r.id).fetch_one(&h.db.pool).await.unwrap();
        let token = &r.players.iter().find(|p| p.id == actor).unwrap().token;
        let (status, action, _) = request(
            &h.app,
            "POST",
            &format!(
                "/api/rooms/{}/stages/1/encounters/{encounter}/actions",
                r.id
            ),
            Some(token),
            Some(json!({"action":"guess","guessId":answer,"idempotencyKey":"modern-scope"})),
        )
        .await;
        assert_eq!(status, StatusCode::OK, "{action}");
        contracts::validate_value("RelayEncounterActionResponse", &action).unwrap();
        h.snapshot(&r, &r.players[0]).await;
    }
    h.close().await;
}

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn exhaustion_idempotency_round_forfeit_and_concurrent_next_round() {
    use touhouflandre_api::game::*;
    use touhouflandre_api::service::catalog;
    let h = Harness::new().await;
    let r = h.room(3, "bo3", false).await;
    sqlx::query("UPDATE multi_room SET question_scope=jsonb_set(question_scope,'{rules,guessLimit}','{\"enabled\":true,\"maxGuesses\":2}') WHERE id=$1").bind(&r.id).execute(&h.db.pool).await.unwrap();
    h.start(&r).await;
    let (round, answer, _) = h.current(&r).await;
    let mut conn = h.db.pool.acquire().await.unwrap();
    let m = store::latest_match(&mut conn, &r.id, false)
        .await
        .unwrap()
        .unwrap();
    let chars = catalog::characters_for_version(&mut conn, &m.catalog_version)
        .await
        .unwrap();
    let runtime = build_catalog_runtime(
        &m.catalog_version,
        m.answer_match_policy.parse().unwrap(),
        &chars,
    )
    .unwrap();
    let wrongs: Vec<_> = chars
        .iter()
        .filter(|c| c.enabled_as_guess && !runtime.match_answer(&answer, &c.id).correct)
        .take(2)
        .map(|c| c.id.clone())
        .collect();
    drop(conn);
    let (status, first) = h.guess(&r, &r.players[0], &wrongs[0], "first").await;
    assert_eq!(status, StatusCode::OK, "{first}");
    let (status, replay) = h.guess(&r, &r.players[0], &wrongs[1], "first").await;
    assert_eq!(status, StatusCode::OK, "{replay}");
    assert_eq!(
        first, replay,
        "same key must return the originally stored guess"
    );
    let (status, duplicate) = h
        .guess(&r, &r.players[0], &wrongs[0], "different-key")
        .await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(duplicate["code"], "DUPLICATE_GUESS");
    let (status, exhausted) = h.guess(&r, &r.players[0], &wrongs[1], "second").await;
    assert_eq!(status, StatusCode::OK, "{exhausted}");
    assert_eq!(exhausted["participationStatus"], "exhausted");
    let (status, limited) = h.guess(&r, &r.players[0], &answer, "third").await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert_eq!(limited["code"], "GUESS_LIMIT_REACHED");
    let (status, error, _) = request(
        &h.app,
        "POST",
        &format!("/api/rooms/{}/rounds/1/forfeit", r.id),
        Some(&r.players[1].token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::NO_CONTENT, "{error}");
    assert_eq!(
        h.guess(&r, &r.players[2], &answer, "finish").await.0,
        StatusCode::OK
    );
    let states:Vec<(String,i32)>=sqlx::query_as("SELECT status,points_awarded FROM multi_round_player WHERE round_id=$1 ORDER BY points_awarded,status").bind(&round).fetch_all(&h.db.pool).await.unwrap();
    assert_eq!(
        states,
        vec![
            ("exhausted".into(), 0),
            ("forfeited".into(), 0),
            ("correct".into(), 3)
        ]
    );
    assert!(h.snapshot(&r, &r.players[0]).await.get("round").is_none());
    h.clock.fetch_add(5, Ordering::SeqCst);
    assert!(
        !race::sweep_room(&h.state, &r.id).await.unwrap().game,
        "strict legacy intermission boundary"
    );
    h.clock.fetch_add(1, Ordering::SeqCst);
    let (a, b) = tokio::join!(
        race::sweep_room(&h.state, &r.id),
        race::sweep_room(&h.state, &r.id)
    );
    a.unwrap();
    b.unwrap();
    let (new_round, new_answer, index) = h.current(&r).await;
    assert_eq!(index, 2);
    assert_ne!(new_round, round);
    assert_ne!(runtime.group_key(&answer), runtime.group_key(&new_answer));
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM multi_round WHERE match_id=$1")
        .bind(&m.id)
        .fetch_one(&h.db.pool)
        .await
        .unwrap();
    assert_eq!(count, 2);
    let active: i64 = sqlx::query_scalar(
        "SELECT count(*) FROM multi_round_player WHERE round_id=$1 AND status='active'",
    )
    .bind(&new_round)
    .fetch_one(&h.db.pool)
    .await
    .unwrap();
    assert_eq!(
        active, 3,
        "round forfeits and exhaustion do not remove the frozen match roster"
    );
    h.close().await;
}

#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn recovered_legacy_relay_snapshot_does_not_require_stages() {
    let h = Harness::new().await;
    // Reproduce the pre-stage schema's shared round storage: the completed
    // match retains a round and its events, with no multi_relay_stage rows.
    let r = h.room(2, "bo1", false).await;
    h.start(&r).await;
    let (_, answer, _) = h.current(&r).await;
    assert_eq!(
        h.guess(&r, &r.players[0], &answer, "legacy-finish").await.0,
        StatusCode::OK
    );
    sqlx::query("UPDATE multi_room SET mode='relay' WHERE id=$1")
        .bind(&r.id)
        .execute(&h.db.pool)
        .await
        .unwrap();
    sqlx::query("UPDATE multi_match SET rule_set_key='legacy_wins' WHERE room_id=$1")
        .bind(&r.id)
        .execute(&h.db.pool)
        .await
        .unwrap();
    let initial = h.snapshot(&r, &r.players[0]).await;
    assert_eq!(initial["status"], "finished");
    assert!(initial["match"].get("relay").is_none());
    let (status, replayed, _) = request(
        &h.app,
        "GET",
        &format!("/api/rooms/{}/snapshot?after=1", r.id),
        Some(&r.players[0].token),
        None,
    )
    .await;
    assert_eq!(status, StatusCode::OK, "{replayed}");
    contracts::validate_value("RoomSnapshot", &replayed).unwrap();
    let ended = replayed["events"]
        .as_array()
        .unwrap()
        .iter()
        .find(|e| e["type"] == "round.ended")
        .unwrap();
    assert_eq!(ended["payload"]["answer"]["id"], answer);
    assert_eq!(ended["payload"]["boards"].as_array().unwrap().len(), 2);
    h.close().await;
}
