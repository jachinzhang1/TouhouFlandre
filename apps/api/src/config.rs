use std::{collections::HashMap, path::PathBuf, sync::OnceLock};

use anyhow::{Context, Result, bail};
use chrono::TimeDelta;
use rand::TryRng;
use sha2::{Digest, Sha256};

/// Loaded once at startup; callers can inject an environment map in tests.
/// Intentionally does not implement Debug: it contains credentials and secrets.
#[derive(Clone)]
pub struct Config {
    pub database_url: String,
    pub port: u16,
    pub catalog_data_dir: PathBuf,
    pub web_origins: Vec<String>,
    pub log_level: String,
    pub search_scope_filter: bool,
    pub search_mode: String,
    pub search_policy_revision: String,
    pub answer_match_policy: String,
    pub multi: MultiplayerConfig,
}

#[derive(Clone)]
pub struct MultiplayerConfig {
    pub lobby_ttl: TimeDelta,
    pub event_retention: TimeDelta,
    pub chat_retention: TimeDelta,
    pub round_countdown: TimeDelta,
    pub intermission: TimeDelta,
    pub round_seconds: TimeDelta,
    pub race_round_seconds: TimeDelta,
    pub turn_seconds: TimeDelta,
    pub disconnect_grace: TimeDelta,
    pub finished_retention: TimeDelta,
    pub max_rounds_factor: usize,
    pub join_rate_limit: usize,
    pub relay_history_rate_limit: usize,
    pub chat_member_capacity: usize,
    pub chat_member_refill: TimeDelta,
    pub chat_room_capacity: usize,
    pub chat_room_refill: TimeDelta,
    pub ws_read_limit: usize,
    pub ws_send_queue: usize,
    pub mode_registry: String,
    pub n_player_race_enabled: bool,
    pub n_player_relay_enabled: bool,
    pub relay_elimination_enabled: bool,
    pub chat_send_enabled: bool,
    pub system_announcements_enabled: bool,
    pub projection_secret: Vec<u8>,
    pub chat_cursor_secret: Vec<u8>,
}

static PROCESS_SECRET: OnceLock<Vec<u8>> = OnceLock::new();

impl Config {
    pub fn from_env() -> Result<Self> {
        Self::from_values(&std::env::vars().collect())
    }

    pub fn from_values(values: &HashMap<String, String>) -> Result<Self> {
        let raw = |key: &str| values.get(key).map(String::as_str).unwrap_or("");
        let string = |key: &str, fallback: &str| {
            let value = raw(key);
            if value.is_empty() {
                fallback.to_owned()
            } else {
                value.to_owned()
            }
        };
        let normalized = |key: &str, fallback: &str| {
            let value = raw(key).trim().to_lowercase();
            if value.is_empty() {
                fallback.to_owned()
            } else {
                value
            }
        };
        let positive = |key: &str, fallback| {
            raw(key)
                .parse::<usize>()
                .ok()
                .filter(|n| *n > 0)
                .unwrap_or(fallback)
        };
        let boolean = |key: &str, fallback| match raw(key).trim().to_lowercase().as_str() {
            "1" | "true" | "t" | "yes" | "y" | "on" => true,
            "0" | "false" | "f" | "no" | "n" | "off" => false,
            _ => fallback,
        };
        let duration = |key: &str, fallback: i64| {
            parse_go_duration(raw(key)).unwrap_or_else(|| TimeDelta::milliseconds(fallback))
        };
        let answer_match_policy = normalized("ANSWER_MATCH_POLICY", "public_fields_v1");
        if !matches!(answer_match_policy.as_str(), "strict" | "public_fields_v1") {
            bail!("unknown ANSWER_MATCH_POLICY");
        }
        let projection_secret = if !raw("MULTI_PROJECTION_SECRET").is_empty() {
            raw("MULTI_PROJECTION_SECRET").as_bytes().to_vec()
        } else {
            if PROCESS_SECRET.get().is_none() {
                let mut bytes = [0_u8; 32];
                rand::rngs::SysRng
                    .try_fill_bytes(&mut bytes)
                    .context("cannot generate multiplayer secret")?;
                let _ = PROCESS_SECRET.set(bytes.to_vec());
            }
            PROCESS_SECRET.get().expect("initialized above").clone()
        };
        let chat_cursor_secret = if raw("MULTI_CHAT_CURSOR_SECRET").is_empty() {
            let mut hash = Sha256::new();
            hash.update(b"multi-chat-cursor-v1:");
            hash.update(&projection_secret);
            hash.finalize().to_vec()
        } else {
            raw("MULTI_CHAT_CURSOR_SECRET").as_bytes().to_vec()
        };
        let origins = string("WEB_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173");
        let level = raw("LOG_LEVEL").to_lowercase();
        let log_level = match level.as_str() {
            "debug" | "warn" | "error" => level,
            "warning" => "warn".into(),
            _ => "info".into(),
        };
        let revision = raw("CHARACTER_SEARCH_POLICY_REVISION").trim();
        Ok(Self {
            database_url: raw("DATABASE_URL_PG").to_owned(),
            port: string("API_PORT", "4000").parse()?,
            catalog_data_dir: string("CATALOG_DATA_DIR", "../../packages/data/src").into(),
            web_origins: origins
                .split(',')
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(str::to_owned)
                .collect(),
            log_level,
            search_scope_filter: boolean("CHARACTER_SEARCH_QUESTION_SCOPE_FILTER_ENABLED", true),
            search_mode: if normalized("CHARACTER_SEARCH_MODE", "remote") == "local-primary" {
                "local-primary".into()
            } else {
                "remote".into()
            },
            search_policy_revision: if revision.is_empty() {
                "v1".into()
            } else {
                revision.into()
            },
            answer_match_policy,
            multi: MultiplayerConfig {
                lobby_ttl: duration("MULTI_LOBBY_TTL", 1_800_000),
                event_retention: duration("MULTI_EVENT_RETENTION", 86_400_000),
                chat_retention: duration("MULTI_CHAT_RETENTION", 86_400_000),
                round_countdown: duration("MULTI_ROUND_COUNTDOWN", 3_000),
                intermission: duration("MULTI_INTERMISSION", 5_000),
                round_seconds: duration("MULTI_ROUND_SECONDS", 900_000),
                race_round_seconds: duration("MULTI_RACE_ROUND_SECONDS", 300_000),
                turn_seconds: duration("MULTI_TURN_SECONDS", 60_000),
                disconnect_grace: duration("MULTI_DISCONNECT_GRACE", 60_000),
                finished_retention: duration("MULTI_FINISHED_RETENTION", 600_000),
                max_rounds_factor: positive("MULTI_MAX_ROUNDS_FACTOR", 3),
                join_rate_limit: positive("MULTI_JOIN_RATE_LIMIT", 10),
                relay_history_rate_limit: positive("MULTI_RELAY_HISTORY_RATE_LIMIT", 60),
                chat_member_capacity: positive("MULTI_CHAT_MEMBER_CAPACITY", 5),
                chat_member_refill: duration("MULTI_CHAT_MEMBER_REFILL", 2_000),
                chat_room_capacity: positive("MULTI_CHAT_ROOM_CAPACITY", 20),
                chat_room_refill: duration("MULTI_CHAT_ROOM_REFILL", 500),
                ws_read_limit: positive("MULTI_WS_READ_LIMIT", 4096),
                ws_send_queue: positive("MULTI_WS_SEND_QUEUE", 64),
                mode_registry: normalized("MULTI_MODE_REGISTRY", "full"),
                n_player_race_enabled: boolean("MULTI_N_PLAYER_RACE_ENABLED", true),
                n_player_relay_enabled: boolean("MULTI_N_PLAYER_RELAY_ENABLED", true),
                relay_elimination_enabled: boolean("MULTI_RELAY_ELIMINATION_ENABLED", true),
                chat_send_enabled: boolean("MULTI_CHAT_SEND_ENABLED", true),
                system_announcements_enabled: boolean("MULTI_SYSTEM_ANNOUNCEMENTS_ENABLED", true),
                projection_secret,
                chat_cursor_secret,
            },
        })
    }
}

/// Go's duration syntax is part of the existing deployment interface.
pub fn parse_go_duration(value: &str) -> Option<TimeDelta> {
    let (negative, mut rest) = match value.as_bytes().first()? {
        b'-' => (true, &value[1..]),
        b'+' => (false, &value[1..]),
        _ => (false, value),
    };
    if rest == "0" {
        return Some(TimeDelta::zero());
    }
    if rest.is_empty() {
        return None;
    }
    let mut total: i128 = 0;
    while !rest.is_empty() {
        let digits = rest
            .find(|c: char| !c.is_ascii_digit() && c != '.')
            .unwrap_or(rest.len());
        if digits == 0 {
            return None;
        }
        let number = &rest[..digits];
        rest = &rest[digits..];
        let (suffix, scale) = [
            ("ns", 1_i128),
            ("us", 1_000),
            ("µs", 1_000),
            ("μs", 1_000),
            ("ms", 1_000_000),
            ("s", 1_000_000_000),
            ("m", 60_000_000_000),
            ("h", 3_600_000_000_000),
        ]
        .into_iter()
        .find(|(suffix, _)| rest.starts_with(suffix))?;
        rest = &rest[suffix.len()..];
        let mut parts = number.split('.');
        let whole = parts.next()?;
        let fraction = parts.next();
        if parts.next().is_some() || (whole.is_empty() && fraction.is_none_or(str::is_empty)) {
            return None;
        }
        let integer = if whole.is_empty() {
            0
        } else {
            whole.parse::<i128>().ok()?
        };
        total = total.checked_add(integer.checked_mul(scale)?)?;
        if let Some(fraction) = fraction {
            // Digits beyond nanosecond precision can only truncate to zero.
            let kept = &fraction[..fraction.len().min(18)];
            if !kept.is_empty() {
                total = total.checked_add(
                    kept.parse::<i128>().ok()?.checked_mul(scale)? / 10_i128.pow(kept.len() as u32),
                )?;
            }
        }
    }
    let nanos = i64::try_from(if negative { -total } else { total }).ok()?;
    Some(TimeDelta::nanoseconds(nanos))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn duration_compatibility() {
        for (input, nanos) in [
            ("1h30m", 5_400_000_000_000),
            ("500ms", 500_000_000),
            (".5s", 500_000_000),
            ("-1s", -1_000_000_000),
            ("0", 0),
            ("1µs", 1000),
            ("1.000000001s", 1_000_000_001),
        ] {
            assert_eq!(
                parse_go_duration(input).unwrap().num_nanoseconds(),
                Some(nanos),
                "{input}"
            );
        }
        for input in [
            "",
            "1",
            "5days",
            "1..2s",
            "1e3s",
            "1 s",
            "9223372036854775808ns",
        ] {
            assert!(parse_go_duration(input).is_none(), "{input}");
        }
    }

    #[test]
    fn defaults_flags_and_secrets_match_existing_configuration() {
        let config = Config::from_values(&HashMap::new()).unwrap();
        assert_eq!(config.port, 4000);
        assert_eq!(config.search_mode, "remote");
        assert!(config.multi.n_player_race_enabled && config.multi.chat_send_enabled);
        assert_eq!(config.multi.finished_retention, TimeDelta::minutes(10));
        assert_eq!(config.multi.projection_secret.len(), 32);
        assert_eq!(
            config.multi.projection_secret,
            Config::from_values(&HashMap::new())
                .unwrap()
                .multi
                .projection_secret
        );
        assert_ne!(
            config.multi.projection_secret,
            config.multi.chat_cursor_secret
        );
        let values = HashMap::from([("ANSWER_MATCH_POLICY".into(), "unknown".into())]);
        assert!(Config::from_values(&values).is_err());
        let values = HashMap::from([
            ("MULTI_CHAT_SEND_ENABLED".into(), "off".into()),
            ("MULTI_PROJECTION_SECRET".into(), "configured".into()),
            ("CHARACTER_SEARCH_MODE".into(), " local-primary ".into()),
        ]);
        let config = Config::from_values(&values).unwrap();
        assert!(!config.multi.chat_send_enabled);
        assert_eq!(config.multi.projection_secret, b"configured");
        assert_eq!(config.search_mode, "local-primary");
    }
}
