mod support;
use anyhow::Result;
use axum::http::StatusCode;
use serde_json::json;
use support::*;
use touhouflandre_api::{
    contracts, realtime::cursor::Direction, repository::multi as store, service::chat,
};

#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn durable_chat_idempotency_visibility_and_rate_limit() -> Result<()> {
    let db = Database::new().await?;
    let state = db.state();
    let app = app(state.clone());
    let (room, player, token, _spectator, spectator_token) = db.room().await?;
    let path = format!("/api/rooms/{room}/messages");
    let message = json!({"clientMessageId":"00000000-0000-0000-0000-000000000001","kind":"text","content":" e\u{301}\r\n东方 "});
    let (a, b) = tokio::join!(
        request(&app, "POST", &path, Some(&token), Some(message.clone())),
        request(&app, "POST", &path, Some(&token), Some(message.clone()))
    );
    assert_eq!(a.0, StatusCode::OK, "{}", a.1);
    assert_eq!(a.1, b.1);
    contracts::decode::<contracts::ChatMessage>(a.1.clone())?;
    assert_eq!(a.1["content"], "é\n东方");
    let mut different = message.clone();
    different["content"] = json!("different");
    assert_eq!(
        request(&app, "POST", &path, Some(&token), Some(different))
            .await
            .0,
        StatusCode::CONFLICT
    );
    let private = json!({"clientMessageId":"00000000-0000-0000-0000-000000000002","kind":"text","content":"private spectator"});
    let sent = request(&app, "POST", &path, Some(&spectator_token), Some(private)).await;
    assert_eq!(sent.0, StatusCode::OK, "{}", sent.1);
    let public = request(&app, "GET", &path, Some(&token), None).await;
    assert_eq!(public.0, StatusCode::OK);
    assert_eq!(public.1["messages"].as_array().unwrap().len(), 1);
    assert!(!public.1.to_string().contains("private spectator"));
    let spectator = request(&app, "GET", &path, Some(&spectator_token), None).await;
    assert_eq!(spectator.1["messages"].as_array().unwrap().len(), 2);
    let mut conn = db.pool.acquire().await?;
    let room_row = store::room(&mut conn, &room, false).await?;
    drop(conn);
    let after = chat::cursor(&chat::codec(&state), &room_row, 1, Direction::After);
    let hidden = request(
        &app,
        "GET",
        &format!("{path}?after={after}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(hidden.1["messages"], json!([]));
    assert_eq!(hidden.1["hasMore"], false);
    assert_eq!(hidden.1["scannedCursor"], spectator.1["scannedCursor"]);
    sqlx::query("UPDATE multi_member SET chat_rate_tokens=0,chat_rate_refilled_at=now()+interval '1 hour' WHERE id=$1").bind(&player).execute(&db.pool).await?;
    let throttled=request(&app,"POST",&path,Some(&token),Some(json!({"clientMessageId":"00000000-0000-0000-0000-000000000003","kind":"text","content":"too fast"}))).await;
    assert_eq!(throttled.0, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(throttled.1["retryAfterMs"], 2000);
    assert_eq!(throttled.2["retry-after"], "2");
    // Idempotent retry bypasses the depleted bucket without inserting a new row.
    assert_eq!(
        request(&app, "POST", &path, Some(&token), Some(message))
            .await
            .0,
        StatusCode::OK
    );
    let count: i64 = sqlx::query_scalar("SELECT count(*) FROM multi_chat_message")
        .fetch_one(&db.pool)
        .await?;
    assert_eq!(count, 2);
    drop(app);
    drop(state);
    db.close().await
}

#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn chat_retention_and_system_announcement_transactionality() -> Result<()> {
    let db = Database::new().await?;
    let state = db.state();
    let app = app(state.clone());
    let (room, _player, token, _, _) = db.room().await?;
    let now = (state.clock)();
    let mut tx = db.pool.begin().await?;
    assert!(
        chat::append_system(
            &mut tx,
            true,
            &room,
            2,
            "race/round/member/correct",
            "[第 1 轮]测试(P1)已猜中",
            now
        )
        .await?
    );
    assert!(
        !chat::append_system(
            &mut tx,
            true,
            &room,
            2,
            "race/round/member/correct",
            "[第 1 轮]测试(P1)已猜中",
            now
        )
        .await?
    );
    tx.commit().await?;
    let mut tx = db.pool.begin().await?;
    assert!(
        chat::append_system(&mut tx, true, &room, 2, "rollback", "must not persist", now).await?
    );
    tx.rollback().await?;
    let count: i64 = sqlx::query_scalar("SELECT chat_seq FROM multi_room WHERE id=$1")
        .bind(&room)
        .fetch_one(&db.pool)
        .await?;
    assert_eq!(count, 1);
    let path = format!("/api/rooms/{room}/messages");
    let history = request(&app, "GET", &path, Some(&token), None).await;
    assert_eq!(history.1["messages"][0]["senderRole"], "system");
    assert!(history.1["messages"][0].get("senderSeat").is_none());
    let mut conn = db.pool.acquire().await?;
    let row = store::room(&mut conn, &room, false).await?;
    drop(conn);
    let before_all = chat::cursor(&chat::codec(&state), &row, 0, Direction::After);
    sqlx::query("DELETE FROM multi_chat_message WHERE room_id=$1")
        .bind(&room)
        .execute(&db.pool)
        .await?;
    let gone = request(
        &app,
        "GET",
        &format!("{path}?after={before_all}"),
        Some(&token),
        None,
    )
    .await;
    assert_eq!(gone.0, StatusCode::GONE);
    contracts::decode::<contracts::ChatResyncRequiredResponse>(gone.1)?;
    drop(app);
    drop(state);
    db.close().await
}
