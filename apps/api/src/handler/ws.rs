//! WebSocket upgrade, protocol negotiation and socket lifecycle; durable operations use service::ws.

use crate::{
    app::AppState,
    error::ApiError,
    realtime::{
        cursor::Direction,
        outbound::ConnectionOutput,
        protocol::{self, RefreshReason, RefreshScope, ServerControl},
        transport,
    },
    service::{
        chat,
        ws::{self, mark_connection, replay},
    },
};
use axum::{
    extract::{
        Path, State, WebSocketUpgrade,
        ws::{CloseFrame, Message, WebSocket},
    },
    http::{HeaderMap, StatusCode},
    response::Response,
};
use futures_util::StreamExt;
use std::time::Duration;

pub(crate) async fn upgrade(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Result<Response, ApiError> {
    ws::room(&state, &room_id).await?;
    if !origin_allowed(&headers, &state.config.web_origins) {
        return Err(ApiError::new(
            StatusCode::FORBIDDEN,
            "INVALID_REQUEST",
            "WebSocket 升级校验失败（Origin/子协议不符）。",
        ));
    }
    let requested = headers
        .get("sec-websocket-protocol")
        .and_then(|h| h.to_str().ok())
        .unwrap_or("")
        .to_owned();
    let supports_v3 = requested
        .split(',')
        .any(|p| p.trim() == protocol::SUBPROTOCOL);
    let token = state.realtime.tracker.token();
    let limit = state.config.multi.ws_read_limit;
    Ok(ws.protocols([protocol::SUBPROTOCOL]).max_message_size(limit).max_frame_size(limit).on_upgrade(move|mut socket|async move {
        let _token=token;
        if !supports_v3 {
            if requested.contains("touhouflandre-multi.v2") { let _=send_control(&mut socket,ServerControl::ProtocolRefreshRequired {scope:RefreshScope::All,reason:RefreshReason::ProtocolVersionUnsupported,game_sequence:None,oldest_available_chat_cursor:None,target_chat_cursor:None,required_subprotocol:Some(protocol::SUBPROTOCOL.into())}).await; }
            close(&mut socket,1008,"subprotocol required: touhouflandre-multi.v3").await;return;
        }
        tokio::select! {
            _=state.realtime.shutdown.cancelled()=>{close(&mut socket,1012,"server restart").await;},
            result=receive_hello(&mut socket,limit)=>match result {
                Ok(hello)=>{if let Err(error) = serve(state.clone(),room_id,socket,hello).await && error.status.is_server_error() { error.report("websocket_session"); }},
                Err(_)=>close(&mut socket,1008,"hello required").await,
            }
        }
    }))
}
fn origin_allowed(headers: &HeaderMap, origins: &[String]) -> bool {
    let Some(origin) = headers.get("origin") else {
        return true;
    };
    let Ok(origin) = origin.to_str() else {
        return false;
    };
    let Ok(uri) = origin.parse::<axum::http::Uri>() else {
        return false;
    };
    let Some(authority) = uri.authority() else {
        return false;
    };
    if headers
        .get("host")
        .and_then(|v| v.to_str().ok())
        .is_some_and(|host| host.eq_ignore_ascii_case(authority.as_str()))
    {
        return true;
    }
    origins
        .iter()
        .any(|allowed| allowed == "*" || allowed.eq_ignore_ascii_case(origin))
}
async fn receive_hello(socket: &mut WebSocket, limit: usize) -> Result<protocol::Hello, ()> {
    tokio::time::timeout(protocol::HELLO_TIMEOUT, async {
        loop {
            match socket.next().await {
                Some(Ok(Message::Text(text))) => {
                    return protocol::decode_hello(text.as_bytes(), limit).map_err(|_| ());
                }
                Some(Ok(Message::Binary(bytes))) => {
                    return protocol::decode_hello(&bytes, limit).map_err(|_| ());
                }
                Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
                _ => return Err(()),
            }
        }
    })
    .await
    .map_err(|_| ())?
}
async fn close(socket: &mut WebSocket, code: u16, reason: &str) {
    let _ = tokio::time::timeout(
        Duration::from_secs(5),
        socket.send(Message::Close(Some(CloseFrame {
            code,
            reason: reason.to_owned().into(),
        }))),
    )
    .await;
}
async fn send_control(socket: &mut WebSocket, frame: ServerControl) -> Result<(), ()> {
    let text = frame.to_json();
    let bytes = text.len();
    tokio::time::timeout(
        Duration::from_secs(5),
        socket.send(Message::Text(text.into())),
    )
    .await
    .map_err(|_| ())?
    .map_err(|_| ())?;
    crate::metrics::METRICS.observe(
        "ws_payload_bytes",
        crate::metrics::Labels::new("unknown", "unknown", 0),
        bytes as f64,
    );
    Ok(())
}

async fn serve(
    state: AppState,
    room_id: String,
    mut socket: WebSocket,
    hello: protocol::Hello,
) -> Result<(), ApiError> {
    let member = match ws::authenticate(&state, &hello.token).await {
        Ok(member) if member.room_id == room_id => member,
        Ok(_) => {
            close(&mut socket, 1008, "unauthorized").await;
            return Ok(());
        }
        Err(error) => {
            // Keep the existing close contract while preserving operational
            // failures (e.g. SQLx pool closure) for the session supervisor.
            close(&mut socket, 1008, "unauthorized").await;
            return Err(error);
        }
    };
    let room = ws::room(&state, &room_id).await?;
    let min_game = ws::min_game_sequence(&state, &room_id).await?;
    let game_reason =
        protocol::game_resync_reason(hello.last_game_sequence, room.event_seq, min_game);
    let codec = chat::codec(&state);
    let mut chat_reason = None;
    let mut chat_position = None;
    let mut oldest_cursor = None;
    let mut target_cursor = None;
    if let Some(cursor) = &hello.last_chat_cursor {
        target_cursor = Some(chat::cursor(&codec, &room, room.chat_seq, Direction::After));
        if chat::validate_room(&room, (state.clock)()).is_err() {
            chat_reason = Some(RefreshReason::HistoryUnavailable);
        } else if let Ok(position) = codec.decode(
            cursor,
            &room_id,
            room.created_at.timestamp_micros(),
            Direction::After,
        ) {
            let min = ws::oldest_chat(&state, &room_id).await?;
            if position > room.chat_seq {
                chat_reason = Some(RefreshReason::AheadOfServer);
            } else if protocol::chat_history_unavailable(position, room.chat_seq, min) {
                chat_reason = Some(RefreshReason::HistoryUnavailable);
                oldest_cursor = Some(chat::cursor(
                    &codec,
                    &room,
                    if min > 0 { min - 1 } else { room.chat_seq },
                    Direction::After,
                ));
            } else {
                chat_position = Some(position);
            }
        } else {
            chat_reason = Some(RefreshReason::InvalidCursor);
        }
    }
    if game_reason.is_some() || chat_reason.is_some() {
        let scope = match (game_reason.is_some(), chat_reason.is_some()) {
            (true, true) => RefreshScope::All,
            (true, false) => RefreshScope::Game,
            _ => RefreshScope::Chat,
        };
        let _ = send_control(
            &mut socket,
            ServerControl::ProtocolRefreshRequired {
                scope,
                reason: game_reason.or(chat_reason).expect("reason present"),
                game_sequence: game_reason.map(|_| room.event_seq),
                oldest_available_chat_cursor: oldest_cursor,
                target_chat_cursor: target_cursor,
                required_subprotocol: None,
            },
        )
        .await;
        close(&mut socket, 1008, "game resync required").await;
        return Ok(());
    }
    let lock = state.realtime.session_lock(&room_id, &member.id);
    let guard = lock.lock().await;
    let current = mark_connection(&state, &member, true).await?;
    let (output, outbound) = ConnectionOutput::new(
        state.config.multi.ws_send_queue,
        hello.last_game_sequence,
        chat_position,
    )?;
    let registration =
        state
            .realtime
            .registry
            .register(room_id.clone(), member.id.clone(), output.clone());
    state.realtime.track(&registration, current.clone());
    if hello.last_game_sequence > 0 {
        crate::metrics::METRICS.reconnect();
    }
    drop(guard);
    let task = transport::spawn_authenticated(
        &state.realtime.tracker,
        socket,
        output.clone(),
        outbound,
        state.realtime.shutdown.child_token(),
    );
    match tokio::time::timeout(
        Duration::from_secs(5),
        replay(&state, &registration, &current),
    )
    .await
    {
        Ok(Ok(())) => {}
        Ok(Err(error)) => {
            error.report("websocket_replay");
            output.request_close(None, "replay_failed");
        }
        Err(error) => {
            ApiError::from(error).report("websocket_replay");
            output.request_close(None, "replay_failed");
        }
    }
    if let Err(error) = task.await {
        ApiError::from(error).report("websocket_transport_task");
    }
    if output.close_reason().as_deref() == Some("slow_consumer") {
        crate::metrics::METRICS.increment(
            "ws_queue_drops_total",
            crate::metrics::Labels::new("unknown", "unknown", 0),
        );
    }
    let _guard = lock.lock().await;
    if state.realtime.registry.unregister(&registration) {
        state.realtime.untrack(&registration);
        if !output.skip_disconnect()
            && let Err(error) = mark_connection(&state, &member, false).await
        {
            error.report("websocket_disconnect");
        }
    }
    Ok(())
}
