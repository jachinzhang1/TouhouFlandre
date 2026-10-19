//! Wire-level control frames. Business event payloads remain in the domain layer.

use serde::{Deserialize, Serialize};

pub const SUBPROTOCOL: &str = "touhouflandre-multi.v3";
pub const DEFAULT_READ_LIMIT: usize = 4096;
pub const HELLO_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
pub const WRITE_TIMEOUT: std::time::Duration = std::time::Duration::from_secs(10);
pub const HEARTBEAT_INTERVAL: std::time::Duration = std::time::Duration::from_secs(30);

#[derive(Clone, PartialEq, Eq)]
pub struct Hello {
    pub token: String,
    pub last_game_sequence: i64,
    pub last_chat_cursor: Option<String>,
}

impl std::fmt::Debug for Hello {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Hello")
            .field("token", &"[redacted]")
            .field("last_game_sequence", &self.last_game_sequence)
            .field("last_chat_cursor", &self.last_chat_cursor)
            .finish()
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum HelloError {
    #[error("hello exceeds the message limit")]
    TooLarge,
    #[error("first frame must be hello")]
    Invalid,
}

/// Mirrors Go's strict first-frame decoder. A negative sequence is syntactically
/// valid here so the room service can return `negative_sequence`, as before.
pub fn decode_hello(data: &[u8], read_limit: usize) -> Result<Hello, HelloError> {
    if data.len() > read_limit {
        return Err(HelloError::TooLarge);
    }
    #[derive(Deserialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    struct RawHello {
        #[serde(rename = "type")]
        kind: String,
        token: String,
        last_game_sequence: i64,
        last_chat_cursor: Option<String>,
    }
    let raw: RawHello = serde_json::from_slice(data).map_err(|_| HelloError::Invalid)?;
    if raw.kind != "hello" || raw.token.is_empty() {
        return Err(HelloError::Invalid);
    }
    Ok(Hello {
        token: raw.token,
        last_game_sequence: raw.last_game_sequence,
        last_chat_cursor: raw.last_chat_cursor,
    })
}

/// Existing Go behavior deliberately only checks the message type. The v3
/// contract describes an ACK watermark, but the current server does not persist
/// or enforce it. Avoid changing disconnection behavior during the migration.
pub fn is_legacy_ack(data: &[u8]) -> bool {
    #[derive(Deserialize)]
    struct Kind {
        #[serde(rename = "type")]
        kind: String,
    }
    serde_json::from_slice::<Kind>(data).is_ok_and(|value| value.kind == "ack")
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RefreshScope {
    Game,
    Chat,
    All,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum RefreshReason {
    NegativeSequence,
    AheadOfServer,
    HistoryUnavailable,
    InvalidCursor,
    ProtocolVersionUnsupported,
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ReplacementReason {
    Replaced,
    MemberChanged,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", deny_unknown_fields)]
pub enum ServerControl {
    #[serde(rename = "hello-ok")]
    HelloOk {
        #[serde(rename = "roomId")]
        room_id: String,
        #[serde(rename = "targetGameSequence")]
        target_game_sequence: i64,
        #[serde(rename = "targetChatCursor", skip_serializing_if = "Option::is_none")]
        target_chat_cursor: Option<String>,
    },
    #[serde(rename = "sync.complete")]
    SyncComplete {
        #[serde(rename = "gameSequence")]
        game_sequence: i64,
        #[serde(rename = "chatCursor", skip_serializing_if = "Option::is_none")]
        chat_cursor: Option<String>,
    },
    #[serde(rename = "protocol.refresh_required")]
    ProtocolRefreshRequired {
        scope: RefreshScope,
        reason: RefreshReason,
        #[serde(rename = "gameSequence", skip_serializing_if = "Option::is_none")]
        game_sequence: Option<i64>,
        #[serde(
            rename = "oldestAvailableChatCursor",
            skip_serializing_if = "Option::is_none"
        )]
        oldest_available_chat_cursor: Option<String>,
        #[serde(rename = "targetChatCursor", skip_serializing_if = "Option::is_none")]
        target_chat_cursor: Option<String>,
        #[serde(
            rename = "requiredSubprotocol",
            skip_serializing_if = "Option::is_none"
        )]
        required_subprotocol: Option<String>,
    },
    #[serde(rename = "replaced")]
    Replaced { reason: ReplacementReason },
}

impl ServerControl {
    pub fn to_json(&self) -> String {
        // This enum contains only JSON-representable strings, integers and enums.
        serde_json::to_string(self).expect("control message is JSON representable")
    }
}

/// An observer must still receive a sequence marker when the domain projection
/// hides an event. This type cannot accidentally serialize the private payload.
#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(
    tag = "type",
    rename = "room.cursor",
    rename_all = "camelCase",
    deny_unknown_fields
)]
pub struct GameCursor {
    pub event_id: String,
    pub room_id: String,
    pub sequence: i64,
    pub occurred_at: String,
}

pub fn game_resync_reason(last: i64, current: i64, min_replay: i64) -> Option<RefreshReason> {
    if last < 0 {
        Some(RefreshReason::NegativeSequence)
    } else if last > current {
        Some(RefreshReason::AheadOfServer)
    } else if last < current && (min_replay == 0 || min_replay > last + 1) {
        Some(RefreshReason::HistoryUnavailable)
    } else {
        None
    }
}

/// Chat positions are exclusive boundaries. The position immediately before the
/// oldest retained row is still replayable; a cursor already at the high watermark
/// remains valid even when retention has removed every preceding row.
pub fn chat_history_unavailable(position: i64, high: i64, min_position: i64) -> bool {
    if position >= high {
        return false;
    }
    let oldest_boundary = if min_position > 0 {
        min_position - 1
    } else {
        high
    };
    position < oldest_boundary
}
