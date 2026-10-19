//! The Go-compatible `multi-chat-cursor-v1` codec. The HMAC signs the original
//! base64 text, not a reserialized JSON value. Generation is UTC Unix microseconds.

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use hmac::{Hmac, KeyInit, Mac};
use serde::{Deserialize, Serialize};
use sha2::Sha256;

type HmacSha256 = Hmac<Sha256>;
const DOMAIN: &[u8] = b"multi-chat-cursor-v1:";

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Direction {
    After,
    Before,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(deny_unknown_fields)]
struct Payload {
    // Keep declaration order: Go json.Marshal encodes these fields in this order.
    v: i32,
    r: String,
    p: i64,
    d: Direction,
    g: i64,
}

#[derive(Clone)]
pub struct ChatCursorCodec {
    secret: Vec<u8>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, thiserror::Error)]
#[error("invalid chat cursor")]
pub struct InvalidChatCursor;

impl ChatCursorCodec {
    pub fn new(secret: impl AsRef<[u8]>) -> Self {
        Self {
            secret: secret.as_ref().to_vec(),
        }
    }

    pub fn encode(
        &self,
        room_id: &str,
        generation_micros: i64,
        position: i64,
        direction: Direction,
    ) -> String {
        let json = serde_json::to_string(&Payload {
            v: 1,
            r: room_id.to_owned(),
            p: position,
            d: direction,
            g: generation_micros,
        })
        .expect("cursor payload is JSON representable");
        // Go encoding/json escapes HTML and JavaScript line separators by default.
        // Room IDs are normally ASCII UUIDs, but matching these bytes makes the
        // codec compatible for every UTF-8 identifier accepted by the Go codec.
        let json = json
            .replace('&', "\\u0026")
            .replace('<', "\\u003c")
            .replace('>', "\\u003e")
            .replace('\u{2028}', "\\u2028")
            .replace('\u{2029}', "\\u2029");
        let encoded = URL_SAFE_NO_PAD.encode(json.as_bytes());
        let mut mac =
            HmacSha256::new_from_slice(&self.secret).expect("HMAC accepts any key length");
        mac.update(DOMAIN);
        mac.update(encoded.as_bytes());
        format!(
            "{encoded}.{}",
            URL_SAFE_NO_PAD.encode(mac.finalize().into_bytes())
        )
    }

    pub fn decode(
        &self,
        token: &str,
        room_id: &str,
        generation_micros: i64,
        direction: Direction,
    ) -> Result<i64, InvalidChatCursor> {
        let (encoded, signature) = token.split_once('.').ok_or(InvalidChatCursor)?;
        if encoded.is_empty() || signature.is_empty() || signature.contains('.') {
            return Err(InvalidChatCursor);
        }
        let signature = URL_SAFE_NO_PAD
            .decode(signature)
            .map_err(|_| InvalidChatCursor)?;
        let mut mac =
            HmacSha256::new_from_slice(&self.secret).expect("HMAC accepts any key length");
        mac.update(DOMAIN);
        mac.update(encoded.as_bytes());
        mac.verify_slice(&signature)
            .map_err(|_| InvalidChatCursor)?;
        let json = URL_SAFE_NO_PAD
            .decode(encoded)
            .map_err(|_| InvalidChatCursor)?;
        let payload: Payload = serde_json::from_slice(&json).map_err(|_| InvalidChatCursor)?;
        if payload.v != 1
            || payload.p < 0
            || payload.r != room_id
            || payload.g != generation_micros
            || payload.d != direction
        {
            return Err(InvalidChatCursor);
        }
        Ok(payload.p)
    }
}
