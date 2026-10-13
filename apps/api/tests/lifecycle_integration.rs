mod support;

use anyhow::Result;
use axum::http::StatusCode;
use chrono::{Duration, Utc};
use serde_json::json;
use std::sync::Arc;
use support::{Database, app, request};
use touhouflandre_api::{
    seed,
    service::{chat, lifecycle},
};

#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn retention_closes_once_then_deletes_with_dependents() -> Result<()> {
    let db = Database::new().await?;
    let mut state = db.state();
    let now = Utc::now();
    state.clock = Arc::new(move || now);
    let (room, _, _, _, _) = db.room().await?;
    let mut tx = db.pool.begin().await?;
    chat::append_system(
        &mut tx,
        true,
        &room,
        2,
        "old",
        "expired",
        now - state.config.multi.chat_retention - Duration::seconds(1),
    )
    .await?;
    tx.commit().await?;
    sqlx::query("UPDATE multi_room SET expires_at=$2 WHERE id=$1")
        .bind(&room)
        .bind(now - Duration::seconds(1))
        .execute(&db.pool)
        .await?;
    lifecycle::sweep_once(&state).await?;
    lifecycle::sweep_once(&state).await?;
    let row: (String, chrono::DateTime<Utc>) =
        sqlx::query_as("SELECT status,expires_at FROM multi_room WHERE id=$1")
            .bind(&room)
            .fetch_one(&db.pool)
            .await?;
    assert_eq!(
        row,
        ("closed".into(), now + state.config.multi.event_retention)
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>(
            "SELECT count(*) FROM room_event WHERE room_id=$1 AND type='room.closed'"
        )
        .bind(&room)
        .fetch_one(&db.pool)
        .await?,
        1
    );
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM multi_chat_message")
            .fetch_one(&db.pool)
            .await?,
        0
    );
    let later = now + state.config.multi.event_retention + Duration::seconds(1);
    state.clock = Arc::new(move || later);
    lifecycle::sweep_once(&state).await?;
    for table in ["multi_room", "multi_member", "room_event"] {
        assert_eq!(
            sqlx::query_scalar::<_, i64>(sqlx::AssertSqlSafe(format!(
                "SELECT count(*) FROM {table}"
            )))
            .fetch_one(&db.pool)
            .await?,
            0
        );
    }
    drop(state);
    db.close().await
}

#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn disconnect_grace_rechecks_reconnection_and_closes_lobby_for_host() -> Result<()> {
    let db = Database::new().await?;
    let state = db.state();
    let (room, host, _, spectator, _) = db.room().await?;
    let past = (state.clock)() - Duration::seconds(1);
    sqlx::query("UPDATE multi_member SET status='disconnected',grace_until=$1")
        .bind(past)
        .execute(&db.pool)
        .await?;
    sqlx::query("UPDATE multi_member SET status='connected',grace_until=NULL WHERE id=$1")
        .bind(&host)
        .execute(&db.pool)
        .await?;
    lifecycle::sweep_once(&state).await?;
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM multi_member WHERE id=$1")
            .bind(&host)
            .fetch_one(&db.pool)
            .await?,
        "connected"
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM multi_member WHERE id=$1")
            .bind(&spectator)
            .fetch_one(&db.pool)
            .await?,
        "left"
    );
    assert_eq!(
        sqlx::query_scalar::<_, String>("SELECT status FROM multi_room WHERE id=$1")
            .bind(&room)
            .fetch_one(&db.pool)
            .await?,
        "lobby"
    );
    sqlx::query("UPDATE multi_member SET status='disconnected',grace_until=$2 WHERE id=$1")
        .bind(&host)
        .bind(past)
        .execute(&db.pool)
        .await?;
    lifecycle::sweep_once(&state).await?;
    let reason: String = sqlx::query_scalar(
        "SELECT payload->>'reason' FROM room_event WHERE room_id=$1 AND type='room.closed'",
    )
    .bind(&room)
    .fetch_one(&db.pool)
    .await?;
    assert_eq!(reason, "host_left");
    drop(state);
    db.close().await
}

#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn restart_validates_all_rules_before_settling_any_active_match() -> Result<()> {
    let db = Database::new().await?;
    seed::run(
        &db.pool,
        &std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/data/src"),
    )
    .await?;
    let state = db.state();
    let router = app(state.clone());
    for mode in ["race", "relay"] {
        let (status, created, _) = request(
            &router,
            "POST",
            "/api/rooms",
            None,
            Some(json!({"format":"bo3","mode":mode})),
        )
        .await;
        assert_eq!(status, StatusCode::CREATED, "{created}");
        let room = created["roomId"].as_str().unwrap();
        let (_, joined, _) = request(
            &router,
            "POST",
            &format!("/api/rooms/{}/join", created["roomCode"].as_str().unwrap()),
            None,
            Some(json!({})),
        )
        .await;
        for member in [&created, &joined] {
            let (status, body, _) = request(
                &router,
                "POST",
                &format!("/api/rooms/{room}/ready"),
                member["guestToken"].as_str(),
                Some(json!({"ready":true})),
            )
            .await;
            assert_eq!(status, StatusCode::NO_CONTENT, "{body}");
        }
    }
    sqlx::query("UPDATE multi_match m SET rule_set_version=99 FROM multi_room r WHERE r.id=m.room_id AND r.mode='relay'").execute(&db.pool).await?;
    let before: Vec<(String, i64)> =
        sqlx::query_as("SELECT id,event_seq FROM multi_room ORDER BY id")
            .fetch_all(&db.pool)
            .await?;
    assert!(lifecycle::terminate_active(&state).await.is_err());
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM multi_match WHERE status='playing'")
            .fetch_one(&db.pool)
            .await?,
        2
    );
    let after: Vec<(String, i64)> =
        sqlx::query_as("SELECT id,event_seq FROM multi_room ORDER BY id")
            .fetch_all(&db.pool)
            .await?;
    assert_eq!(before, after);
    sqlx::query("UPDATE multi_match SET rule_set_version=1")
        .execute(&db.pool)
        .await?;
    lifecycle::terminate_active(&state).await?;
    lifecycle::terminate_active(&state).await?;
    assert_eq!(
        sqlx::query_scalar::<_, i64>("SELECT count(*) FROM multi_match WHERE status='playing'")
            .fetch_one(&db.pool)
            .await?,
        0
    );
    assert_eq!(sqlx::query_scalar::<_,i64>("SELECT count(*) FROM room_event WHERE type='match.ended' AND payload->>'reason'='server_restart'").fetch_one(&db.pool).await?, 2);
    drop(router);
    drop(state);
    db.close().await
}
