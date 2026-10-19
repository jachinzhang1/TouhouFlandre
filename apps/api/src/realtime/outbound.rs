//! Per-connection FIFO and replay/live handoff. All transitions and nonblocking
//! publications share one short mutex; no database or socket I/O runs under it.

use super::protocol::{ReplacementReason, ServerControl};
use std::{
    collections::BTreeMap,
    sync::{Arc, Mutex},
};
use tokio::sync::{mpsc, watch};

pub const DEFAULT_SEND_QUEUE: usize = 64;
pub type JsonFrame = Arc<str>;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct OutboundFrame {
    pub text: JsonFrame,
    pub close_after: bool,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CloseDirective {
    /// `None` means drop the socket, matching Go's CloseNow paths.
    pub code: Option<u16>,
    pub reason: String,
}

pub struct OutboundReceiver {
    pub frames: mpsc::Receiver<OutboundFrame>,
    /// This channel is independent of `frames` so a full queue cannot prevent
    /// slow-consumer or service-restart shutdown.
    pub close: watch::Receiver<Option<CloseDirective>>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Delivery {
    Queued,
    Buffered,
    Hidden,
    Duplicate,
    Unsubscribed,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("realtime output: {self:?}")]
pub enum OutputError {
    Closed,
    SlowConsumer,
    WrongPhase,
    SequenceGap,
    InvalidSequence,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Watermarks {
    pub game_sequence: i64,
    pub chat_position: Option<i64>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum Phase {
    Buffering,
    Live,
    Closing,
    Closed,
}

struct State {
    phase: Phase,
    watermarks: Watermarks,
    game: BTreeMap<i64, JsonFrame>,
    // None is a hidden chat row: it advances position without disclosing data.
    chat: BTreeMap<i64, Option<JsonFrame>>,
    close_reason: Option<String>,
    skip_disconnect: bool,
}

pub struct ConnectionOutput {
    sender: mpsc::Sender<OutboundFrame>,
    close: watch::Sender<Option<CloseDirective>>,
    state: Mutex<State>,
}

impl ConnectionOutput {
    pub fn new(
        queue_size: usize,
        last_game_sequence: i64,
        last_chat_position: Option<i64>,
    ) -> Result<(Arc<Self>, OutboundReceiver), OutputError> {
        if last_game_sequence < 0 || last_chat_position.is_some_and(|position| position < 0) {
            return Err(OutputError::InvalidSequence);
        }
        let (sender, frames) = mpsc::channel(if queue_size == 0 {
            DEFAULT_SEND_QUEUE
        } else {
            queue_size
        });
        let (close, close_receiver) = watch::channel(None);
        let output = Arc::new(Self {
            sender,
            close,
            state: Mutex::new(State {
                phase: Phase::Buffering,
                watermarks: Watermarks {
                    game_sequence: last_game_sequence,
                    chat_position: last_chat_position,
                },
                game: BTreeMap::new(),
                chat: BTreeMap::new(),
                close_reason: None,
                skip_disconnect: false,
            }),
        });
        Ok((
            output,
            OutboundReceiver {
                frames,
                close: close_receiver,
            },
        ))
    }

    pub fn watermarks(&self) -> Watermarks {
        self.state
            .lock()
            .expect("connection state poisoned")
            .watermarks
    }

    pub fn is_alive(&self) -> bool {
        matches!(
            self.state.lock().expect("connection state poisoned").phase,
            Phase::Buffering | Phase::Live
        )
    }

    pub fn skip_disconnect(&self) -> bool {
        self.state
            .lock()
            .expect("connection state poisoned")
            .skip_disconnect
    }

    pub fn close_reason(&self) -> Option<String> {
        self.state
            .lock()
            .expect("connection state poisoned")
            .close_reason
            .clone()
    }

    /// Queue hello-ok through the same writer before starting replay. Optional
    /// chat fields are omitted for game-only connections by ServerControl.
    pub fn send_control(&self, frame: ServerControl) -> Result<(), OutputError> {
        let mut state = self.state.lock().expect("connection state poisoned");
        Self::ensure_open(&state)?;
        self.enqueue(&mut state, frame.to_json().into(), false)
    }

    pub fn publish_game(&self, sequence: i64, frame: JsonFrame) -> Result<Delivery, OutputError> {
        let mut state = self.state.lock().expect("connection state poisoned");
        Self::ensure_open(&state)?;
        if sequence <= state.watermarks.game_sequence {
            return Ok(Delivery::Duplicate);
        }
        if state.phase == Phase::Buffering {
            return Ok(match state.game.entry(sequence) {
                std::collections::btree_map::Entry::Vacant(entry) => {
                    entry.insert(frame);
                    Delivery::Buffered
                }
                std::collections::btree_map::Entry::Occupied(_) => Delivery::Duplicate,
            });
        }
        Self::check_next(state.watermarks.game_sequence, sequence)?;
        self.enqueue(&mut state, frame, false)?;
        state.watermarks.game_sequence = sequence;
        Ok(Delivery::Queued)
    }

    /// A replay event must already be projected for this member, or be a
    /// room.cursor marker. Game replay uses the existing nonblocking queue policy.
    pub fn replay_game(&self, sequence: i64, frame: JsonFrame) -> Result<Delivery, OutputError> {
        let mut state = self.state.lock().expect("connection state poisoned");
        Self::ensure_buffering(&state)?;
        if sequence <= state.watermarks.game_sequence {
            return Ok(Delivery::Duplicate);
        }
        Self::check_next(state.watermarks.game_sequence, sequence)?;
        self.enqueue(&mut state, frame, false)?;
        state.game.remove(&sequence);
        state.watermarks.game_sequence = sequence;
        Ok(Delivery::Queued)
    }

    pub fn publish_chat(
        &self,
        position: i64,
        frame: Option<JsonFrame>,
    ) -> Result<Delivery, OutputError> {
        let mut state = self.state.lock().expect("connection state poisoned");
        Self::ensure_open(&state)?;
        let Some(last) = state.watermarks.chat_position else {
            return Ok(Delivery::Unsubscribed);
        };
        if position <= last {
            return Ok(Delivery::Duplicate);
        }
        if state.phase == Phase::Buffering {
            return Ok(match state.chat.entry(position) {
                std::collections::btree_map::Entry::Vacant(entry) => {
                    entry.insert(frame);
                    Delivery::Buffered
                }
                std::collections::btree_map::Entry::Occupied(_) => Delivery::Duplicate,
            });
        }
        Self::check_next(last, position)?;
        let delivery = if let Some(frame) = frame {
            self.enqueue(&mut state, frame, false)?;
            Delivery::Queued
        } else {
            Delivery::Hidden
        };
        state.watermarks.chat_position = Some(position);
        Ok(delivery)
    }

    /// Chat replay, unlike live fanout/game replay, waits for writer capacity.
    /// The caller wraps the entire database replay in its existing 5s timeout.
    /// No sequence advances if this future is cancelled. Role invalidation and
    /// queue closure unblock it without waiting for more writer capacity.
    pub async fn replay_chat(
        &self,
        position: i64,
        frame: Option<JsonFrame>,
    ) -> Result<Delivery, OutputError> {
        {
            let mut state = self.state.lock().expect("connection state poisoned");
            Self::ensure_buffering(&state)?;
            let Some(last) = state.watermarks.chat_position else {
                return Ok(Delivery::Unsubscribed);
            };
            if position <= last {
                return Ok(Delivery::Duplicate);
            }
            Self::check_next(last, position)?;
            if frame.is_none() {
                state.chat.remove(&position);
                state.watermarks.chat_position = Some(position);
                return Ok(Delivery::Hidden);
            }
        }
        let mut close = self.close.subscribe();
        if close.borrow().is_some() {
            return Err(OutputError::Closed);
        }
        let permit = tokio::select! {
            permit = self.sender.reserve() => permit.map_err(|_| OutputError::Closed)?,
            _ = close.changed() => return Err(OutputError::Closed),
        };
        let mut state = self.state.lock().expect("connection state poisoned");
        Self::ensure_buffering(&state)?;
        let last = state
            .watermarks
            .chat_position
            .ok_or(OutputError::WrongPhase)?;
        if position <= last {
            return Ok(Delivery::Duplicate);
        }
        Self::check_next(last, position)?;
        permit.send(OutboundFrame {
            text: frame.expect("visible frame checked above"),
            close_after: false,
        });
        state.chat.remove(&position);
        state.watermarks.chat_position = Some(position);
        Ok(Delivery::Queued)
    }

    /// Atomically drain concurrent publications, queue completion, and switch to
    /// live. The cursor factory is a pure HMAC encode operation, never async I/O.
    /// A hole is reported instead of silently skipping a persisted sequence.
    pub fn finish_sync(
        &self,
        encode_chat_cursor: impl FnOnce(i64) -> String,
    ) -> Result<Watermarks, OutputError> {
        let mut state = self.state.lock().expect("connection state poisoned");
        Self::ensure_buffering(&state)?;
        while let Some(next) = state.watermarks.game_sequence.checked_add(1) {
            let Some(frame) = state.game.remove(&next) else {
                break;
            };
            self.enqueue(&mut state, frame, false)?;
            state.watermarks.game_sequence = next;
        }
        if !state.game.is_empty() {
            return Err(OutputError::SequenceGap);
        }
        if let Some(mut last) = state.watermarks.chat_position {
            while let Some(next) = last.checked_add(1) {
                let Some(frame) = state.chat.remove(&next) else {
                    break;
                };
                if let Some(frame) = frame {
                    self.enqueue(&mut state, frame, false)?;
                }
                last = next;
                state.watermarks.chat_position = Some(last);
            }
            if !state.chat.is_empty() {
                return Err(OutputError::SequenceGap);
            }
        }
        let completion = ServerControl::SyncComplete {
            game_sequence: state.watermarks.game_sequence,
            chat_cursor: state.watermarks.chat_position.map(encode_chat_cursor),
        };
        self.enqueue(&mut state, completion.to_json().into(), false)?;
        state.phase = Phase::Live;
        Ok(state.watermarks)
    }

    /// Stop publications immediately but leave already queued data ahead of the
    /// replaced frame. Identity changes suppress the disconnect database write.
    pub fn replace(&self, reason: ReplacementReason) {
        let mut state = self.state.lock().expect("connection state poisoned");
        if Self::ensure_open(&state).is_err() {
            return;
        }
        let label = match reason {
            ReplacementReason::Replaced => "replaced",
            ReplacementReason::MemberChanged => "member_changed",
        };
        state.close_reason.get_or_insert_with(|| label.to_owned());
        state.skip_disconnect |= reason == ReplacementReason::MemberChanged;
        state.phase = Phase::Closing;
        state.game.clear();
        state.chat.clear();
        let frame = OutboundFrame {
            text: ServerControl::Replaced { reason }.to_json().into(),
            close_after: true,
        };
        if self.sender.try_send(frame).is_err() {
            self.signal_close(&mut state, None, label);
        }
    }

    pub fn service_restart(&self) {
        self.request_close(Some(1012), "server_restart");
    }

    pub fn request_close(&self, code: Option<u16>, reason: &str) {
        let mut state = self.state.lock().expect("connection state poisoned");
        if state.phase != Phase::Closed {
            self.signal_close(&mut state, code, reason);
        }
    }

    /// Called exactly when the writer/socket task exits; wakes pending chat
    /// replay and preserves whichever close path supplied the first reason.
    pub fn mark_closed(&self) {
        let mut state = self.state.lock().expect("connection state poisoned");
        self.signal_close(&mut state, None, "peer_closed");
        state.phase = Phase::Closed;
    }

    fn enqueue(
        &self,
        state: &mut State,
        text: JsonFrame,
        close_after: bool,
    ) -> Result<(), OutputError> {
        match self.sender.try_send(OutboundFrame { text, close_after }) {
            Ok(()) => Ok(()),
            Err(mpsc::error::TrySendError::Full(_)) => {
                self.signal_close(state, Some(1013), "slow_consumer");
                Err(OutputError::SlowConsumer)
            }
            Err(mpsc::error::TrySendError::Closed(_)) => {
                self.signal_close(state, None, "peer_closed");
                Err(OutputError::Closed)
            }
        }
    }

    fn signal_close(&self, state: &mut State, code: Option<u16>, reason: &str) {
        state.close_reason.get_or_insert_with(|| reason.to_owned());
        let wire_reason = match code {
            Some(1012) => "server restart",
            Some(1013) => "slow consumer",
            _ => reason,
        }
        .to_owned();
        state.phase = Phase::Closing;
        state.game.clear();
        state.chat.clear();
        // First close directive wins, as in the original sync.Once close path.
        self.close.send_if_modified(|current| {
            if current.is_some() {
                false
            } else {
                *current = Some(CloseDirective {
                    code,
                    reason: wire_reason,
                });
                true
            }
        });
    }

    fn ensure_open(state: &State) -> Result<(), OutputError> {
        if matches!(state.phase, Phase::Closing | Phase::Closed) {
            Err(OutputError::Closed)
        } else {
            Ok(())
        }
    }

    fn ensure_buffering(state: &State) -> Result<(), OutputError> {
        Self::ensure_open(state)?;
        if state.phase != Phase::Buffering {
            Err(OutputError::WrongPhase)
        } else {
            Ok(())
        }
    }

    fn check_next(last: i64, next: i64) -> Result<(), OutputError> {
        if last.checked_add(1) == Some(next) {
            Ok(())
        } else {
            Err(OutputError::SequenceGap)
        }
    }
}
