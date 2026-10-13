mod diagnostics_support;
mod support;
use anyhow::Result;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::time::Duration;
use support::*;
use tokio::{net::TcpStream, time::timeout};
use tokio_tungstenite::{
    MaybeTlsStream, WebSocketStream, connect_async,
    tungstenite::{Message, client::IntoClientRequest},
};
use touhouflandre_api::{
    realtime::{cursor::Direction, protocol::SUBPROTOCOL},
    repository::multi as store,
    service::{
        chat,
        multi::{events, rooms},
        ws,
    },
};
type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

#[tokio::test]
async fn websocket_auth_database_failure_is_reported_without_leaking_credentials() -> Result<()> {
    let db = Database::new().await?;
    let state = db.state();
    let app = app(state.clone());
    let (room, _, token, _, _) = db.room().await?;
    let logs = diagnostics_support::Logs::default();
    // This test uses Tokio's single-thread runtime; the thread-local subscriber
    // also sees the spawned upgrade task, without changing other tests' logger.
    let _guard = tracing::subscriber::set_default(
        tracing_subscriber::fmt()
            .json()
            .with_max_level(tracing::Level::ERROR)
            .with_writer(logs.clone())
            .finish(),
    );
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let stop = tokio_util::sync::CancellationToken::new();
    let stopped = stop.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(stopped.cancelled_owned())
            .await
    });
    let mut request = format!("ws://{addr}/api/rooms/{room}/ws").into_client_request()?;
    request
        .headers_mut()
        .insert("sec-websocket-protocol", SUBPROTOCOL.parse()?);
    let (mut socket, _) = connect_async(request).await?;
    // The upgrade has succeeded; fail authentication's database access next.
    db.pool.close().await;
    socket
        .send(Message::Text(
            json!({"type":"hello","token":token,"lastGameSequence":0})
                .to_string()
                .into(),
        ))
        .await?;
    let close = timeout(Duration::from_secs(5), socket.next())
        .await?
        .unwrap()?;
    assert!(
        matches!(close, Message::Close(Some(ref frame)) if u16::from(frame.code)==1008 && frame.reason=="unauthorized")
    );
    ws::shutdown(&state).await;
    stop.cancel();
    server.await??;
    let events = logs.events();
    assert!(
        events
            .iter()
            .any(|event| event["fields"]["operation"] == "websocket_session"
                && event["fields"]["error_chain"] == "api -> database -> sqlx_pool_closed")
    );
    assert!(!logs.text().contains(&token));
    assert!(!logs.text().contains(&room));
    db.close().await
}
async fn connect(url: &str, token: &str, last: i64, chat: Option<&str>) -> Result<Socket> {
    let mut request = url.into_client_request()?;
    request
        .headers_mut()
        .insert("sec-websocket-protocol", SUBPROTOCOL.parse()?);
    let (mut socket, response) = connect_async(request).await?;
    assert_eq!(response.headers()["sec-websocket-protocol"], SUBPROTOCOL);
    let mut hello = json!({"type":"hello","token":token,"lastGameSequence":last});
    if let Some(cursor) = chat {
        hello["lastChatCursor"] = json!(cursor);
    }
    socket.send(Message::Text(hello.to_string().into())).await?;
    Ok(socket)
}
async fn frame(socket: &mut Socket) -> Value {
    timeout(Duration::from_secs(5), async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(value))) => return serde_json::from_str(&value).unwrap(),
                Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
                other => panic!("unexpected WS read: {other:?}"),
            }
        }
    })
    .await
    .expect("WS frame timed out")
}
async fn synced(socket: &mut Socket) -> Vec<Value> {
    let mut frames = vec![];
    loop {
        let value = frame(socket).await;
        let done = value["type"] == "sync.complete";
        frames.push(value);
        if done {
            return frames;
        }
    }
}
async fn append_update(state: &touhouflandre_api::app::AppState, room: &str) -> Result<i64> {
    let mut tx = state.pool.begin().await?;
    let r = store::room(&mut tx, room, true).await?;
    rooms::append_updated(&mut tx, &r, (state.clock)()).await?;
    tx.commit().await?;
    state.realtime.notify_game(room);
    Ok(r.event_seq + 1)
}

#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn websocket_replay_live_replacement_and_restart_close() -> Result<()> {
    let db = Database::new().await?;
    let state = db.state();
    let app = app(state.clone());
    let (room, player, token, _, _) = db.room().await?;
    append_update(&state, &room).await?;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let stop = tokio_util::sync::CancellationToken::new();
    let stopped = stop.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(stopped.cancelled_owned())
            .await
    });
    ws::start(state.clone());
    let url = format!("ws://{addr}/api/rooms/{room}/ws");
    let mut socket = connect(&url, &token, 0, None).await?;
    let frames = synced(&mut socket).await;
    assert_eq!(frames[0]["type"], "hello-ok");
    assert_eq!(frames[0]["targetGameSequence"], 2);
    assert!(frames[0].get("targetChatCursor").is_none());
    let sequences: Vec<_> = frames
        .iter()
        .filter_map(|f| f["sequence"].as_i64())
        .collect();
    assert_eq!(sequences, [1, 2]);
    assert_eq!(frames.last().unwrap()["gameSequence"], 2);
    let next = append_update(&state, &room).await?;
    let event = frame(&mut socket).await;
    assert_eq!(event["type"], "room.updated");
    assert_eq!(event["sequence"], next);
    let mut replacement = connect(&url, &token, next, None).await?;
    let replaced = frame(&mut socket).await;
    assert_eq!(replaced, json!({"type":"replaced","reason":"replaced"}));
    let frames = synced(&mut replacement).await;
    assert_eq!(frames.last().unwrap()["gameSequence"], next + 1);
    let status: String = sqlx::query_scalar("SELECT status FROM multi_member WHERE id=$1")
        .bind(&player)
        .fetch_one(&db.pool)
        .await?;
    assert_eq!(
        status, "connected",
        "superseded cleanup must not disconnect replacement"
    );
    assert_eq!(state.realtime.connection_count(), 1);
    ws::shutdown(&state).await;
    let close = timeout(Duration::from_secs(5), replacement.next())
        .await?
        .unwrap()?;
    assert!(matches!(close,Message::Close(Some(close)) if u16::from(close.code)==1012));
    stop.cancel();
    server.await??;
    drop(state);
    db.close().await
}

#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn websocket_cursor_rejection_and_private_chat_replay() -> Result<()> {
    let db = Database::new().await?;
    let state = db.state();
    let app = app(state.clone());
    let (room, _, token, _, spectator_token) = db.room().await?;
    let path = format!("/api/rooms/{room}/messages");
    for (id, token, content) in [
        (1, &token, "public"),
        (2, &spectator_token, "secret spectator message"),
    ] {
        let result=request(&app,"POST",&path,Some(token),Some(json!({"clientMessageId":format!("00000000-0000-0000-0000-{id:012}"),"kind":"text","content":content}))).await;
        assert_eq!(result.0, axum::http::StatusCode::OK, "{}", result.1);
    }
    let mut conn = db.pool.acquire().await?;
    let r = store::room(&mut conn, &room, false).await?;
    drop(conn);
    let cursor = chat::cursor(&chat::codec(&state), &r, 0, Direction::After);
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let stop = tokio_util::sync::CancellationToken::new();
    let stopped = stop.clone();
    let server = tokio::spawn(async move {
        axum::serve(listener, app)
            .with_graceful_shutdown(stopped.cancelled_owned())
            .await
    });
    ws::start(state.clone());
    let url = format!("ws://{addr}/api/rooms/{room}/ws");
    let mut rejected = connect(&url, &token, -1, None).await?;
    let refresh = frame(&mut rejected).await;
    assert_eq!(refresh["type"], "protocol.refresh_required");
    assert_eq!(refresh["reason"], "negative_sequence");
    assert_eq!(refresh["scope"], "game");
    let mut invalid = connect(&url, &token, 0, Some("not-signed")).await?;
    let refresh = frame(&mut invalid).await;
    assert_eq!(refresh["reason"], "invalid_cursor");
    assert_eq!(refresh["scope"], "chat");
    let mut socket = connect(&url, &token, 0, Some(&cursor)).await?;
    let frames = synced(&mut socket).await;
    let messages: Vec<_> = frames
        .iter()
        .filter(|f| f["type"] == "chat.message")
        .collect();
    assert_eq!(messages.len(), 1);
    assert_eq!(messages[0]["content"], "public");
    assert!(!json!(frames).to_string().contains("secret spectator"));
    let completion = frames.last().unwrap();
    assert_eq!(
        chat::codec(&state).decode(
            completion["chatCursor"].as_str().unwrap(),
            &room,
            r.created_at.timestamp_micros(),
            Direction::After
        )?,
        2,
        "hidden row must still advance the independent cursor"
    );
    let mut bad_origin = url.clone().into_client_request()?;
    bad_origin
        .headers_mut()
        .insert("origin", "https://evil.example".parse()?);
    bad_origin
        .headers_mut()
        .insert("sec-websocket-protocol", SUBPROTOCOL.parse()?);
    assert!(connect_async(bad_origin).await.is_err());
    ws::shutdown(&state).await;
    stop.cancel();
    server.await??;
    drop(socket);
    drop(rejected);
    drop(invalid);
    drop(state);
    db.close().await
}

#[tokio::test]
#[ignore = "requires explicitly isolated TEST_DATABASE_URL"]
async fn websocket_hides_unknown_private_relay_payload() -> Result<()> {
    let db = Database::new().await?;
    let state = db.state();
    let (room, player, _token, _, _) = db.room().await?;
    let mut tx = db.pool.begin().await?;
    let event=events::append_event(&mut tx,&room,"relay.encounter.started",json!({"answerId":"TOP_SECRET","privateGuess":"TOP_SECRET","matchIndex":0,"stageId":"s","stageIndex":1,"encounterId":"e","encounterIndex":1,"status":"playing","members":[]}),(state.clock)()).await?;
    tx.commit().await?;
    let mut conn = db.pool.acquire().await?;
    let member = store::member(&mut conn, &player).await?;
    drop(conn);
    let projected =
        touhouflandre_api::service::multi::projection::project_event(&state, &event, &member)
            .await?;
    assert!(!projected.to_string().contains("TOP_SECRET"));
    drop(state);
    db.close().await
}
