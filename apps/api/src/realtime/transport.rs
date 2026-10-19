//! Axum socket driver after authentication. The upgrade handler owns Origin,
//! subprotocol and read-limit checks; the room service owns hello validation,
//! registration, replay and cleanup. No token or room payload is logged here.

use super::{
    outbound::{ConnectionOutput, OutboundReceiver},
    protocol::{HEARTBEAT_INTERVAL, WRITE_TIMEOUT, is_legacy_ack},
};
use axum::extract::ws::{CloseFrame, Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use std::sync::Arc;
use tokio::{
    sync::watch,
    time::{Instant, MissedTickBehavior, interval_at, sleep_until, timeout, timeout_at},
};
use tokio_util::{sync::CancellationToken, task::TaskTracker};

/// Call inside `on_upgrade` after hello authentication. The returned join handle
/// allows the room service to replay concurrently, then wait for socket exit and
/// perform generation-aware database cleanup. Register the upgrade callback
/// itself with a TaskTracker token *before* returning the upgrade response so
/// shutdown also accounts for connections still waiting for hello/authentication.
pub fn spawn_authenticated(
    tracker: &TaskTracker,
    socket: WebSocket,
    output: Arc<ConnectionOutput>,
    outbound: OutboundReceiver,
    shutdown: CancellationToken,
) -> tokio::task::JoinHandle<()> {
    tracker.spawn(run_authenticated(socket, output, outbound, shutdown))
}

pub async fn run_authenticated(
    socket: WebSocket,
    output: Arc<ConnectionOutput>,
    outbound: OutboundReceiver,
    shutdown: CancellationToken,
) {
    let (mut writer, mut reader) = socket.split();
    let OutboundReceiver {
        mut frames,
        mut close,
    } = outbound;
    let mut read_close = close.clone();
    let (pong_sender, mut pong_receiver) = watch::channel(Vec::<u8>::new());
    let read_output = output.clone();

    let read = async move {
        loop {
            if read_close.borrow().is_some() {
                break;
            }
            tokio::select! {
                _ = read_close.changed() => break,
                message = reader.next() => match message {
                    Some(Ok(Message::Text(text))) => {
                        if !is_legacy_ack(text.as_bytes()) {
                            read_output.request_close(None, "bad_message");
                            break;
                        }
                    },
                    // Go's websocket.Read decodes both text and binary data as JSON.
                    Some(Ok(Message::Binary(data))) => {
                        if !is_legacy_ack(&data) {
                            read_output.request_close(None, "bad_message");
                            break;
                        }
                    },
                    Some(Ok(Message::Pong(data))) => { pong_sender.send_replace(data.to_vec()); },
                    Some(Ok(Message::Ping(_))) => {}, // Tungstenite replies automatically.
                    Some(Ok(Message::Close(_))) | Some(Err(_)) | None => {
                        read_output.request_close(None, "peer_closed");
                        break;
                    },
                },
            }
        }
    };

    let write_output = output.clone();
    let write = async move {
        let mut heartbeat = interval_at(Instant::now() + HEARTBEAT_INTERVAL, HEARTBEAT_INTERVAL);
        heartbeat.set_missed_tick_behavior(MissedTickBehavior::Delay);
        let mut nonce = 0u64;
        let mut awaiting_pong: Option<(Vec<u8>, Instant)> = None;
        loop {
            let directive = close.borrow().clone();
            if let Some(directive) = directive {
                if let Some(code) = directive.code {
                    let _ = timeout(
                        WRITE_TIMEOUT,
                        writer.send(Message::Close(Some(CloseFrame {
                            code,
                            reason: directive.reason.into(),
                        }))),
                    )
                    .await;
                }
                break;
            }
            // A disabled select branch does not poll its sleep future.
            let pong_deadline = awaiting_pong
                .as_ref()
                .map(|(_, deadline)| *deadline)
                .unwrap_or_else(|| Instant::now() + HEARTBEAT_INTERVAL);
            tokio::select! {
                biased;
                _ = shutdown.cancelled() => {
                    write_output.service_restart();
                },
                _ = close.changed() => {},
                _ = sleep_until(pong_deadline), if awaiting_pong.is_some() => {
                    write_output.request_close(None, "heartbeat_dead");
                },
                changed = pong_receiver.changed(), if awaiting_pong.is_some() => {
                    if changed.is_err() {
                        write_output.request_close(None, "peer_closed");
                    } else if awaiting_pong.as_ref().is_some_and(|(nonce, _)| *nonce == *pong_receiver.borrow_and_update()) {
                        awaiting_pong = None;
                    }
                },
                _ = heartbeat.tick(), if awaiting_pong.is_none() => {
                    nonce = nonce.wrapping_add(1);
                    let payload = nonce.to_be_bytes().to_vec();
                    let deadline = Instant::now() + WRITE_TIMEOUT;
                    if !matches!(timeout_at(deadline, writer.send(Message::Ping(payload.clone().into()))).await, Ok(Ok(()))) {
                        write_output.request_close(None, "heartbeat_dead");
                    } else {
                        awaiting_pong = Some((payload, deadline));
                    }
                },
                frame = frames.recv(), if awaiting_pong.is_none() => {
                    let Some(frame) = frame else { break; };
                    if !matches!(timeout(WRITE_TIMEOUT, writer.send(Message::Text(frame.text.to_string().into()))).await, Ok(Ok(()))) {
                        write_output.request_close(None, "write_error");
                    } else {
                        crate::metrics::METRICS.observe("ws_payload_bytes",crate::metrics::Labels::new("unknown","unknown",0),frame.text.len() as f64);
                        if frame.close_after { break; }
                    }
                },
            }
        }
        write_output.mark_closed();
    };
    tokio::join!(read, write);
    output.mark_closed();
}
