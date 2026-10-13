use chrono::{DateTime, TimeDelta, Utc};
use unicode_normalization::UnicodeNormalization;
use unicode_segmentation::UnicodeSegmentation;
use uuid::Uuid;

pub fn normalize(id: &str, kind: &str, content: &str) -> Option<(Uuid, String)> {
    let uuid = Uuid::parse_str(id).ok()?;
    if uuid.to_string() != id {
        return None;
    }
    let content = match kind {
        "text" => {
            let normalized: String = content
                .replace("\r\n", "\n")
                .replace('\r', "\n")
                .nfc()
                .collect();
            let text = normalized.trim();
            if text.is_empty()
                || text.len() > 1024
                || text.matches('\n').count() > 3
                || text.graphemes(true).count() > 280
                || text.chars().any(|c| {
                    c != '\n'
                        && (c <= '\u{1f}'
                            || ('\u{7f}'..='\u{9f}').contains(&c)
                            || ('\u{202a}'..='\u{202e}').contains(&c)
                            || ('\u{2066}'..='\u{2069}').contains(&c))
                })
            {
                return None;
            }
            text.to_owned()
        }
        "emoji"
            if [
                "😀", "😂", "😍", "🤔", "😭", "😡", "👍", "👎", "🎉", "❤️", "✨", "🌸",
            ]
            .contains(&content) =>
        {
            content.to_owned()
        }
        _ => return None,
    };
    Some((uuid, content))
}

pub fn channel(role: &str) -> Option<&'static str> {
    match role {
        "player" => Some("room"),
        "spectator" => Some("spectator"),
        _ => None,
    }
}

pub fn can_view(role: &str, channel: &str) -> bool {
    match role {
        "player" => channel == "room",
        "spectator" => matches!(channel, "room" | "spectator"),
        _ => false,
    }
}

pub fn refill(
    tokens: Option<f64>,
    at: Option<DateTime<Utc>>,
    capacity: usize,
    period: TimeDelta,
    now: DateTime<Utc>,
) -> f64 {
    if capacity == 0 || period <= TimeDelta::zero() {
        return 0.0;
    }
    match (tokens, at) {
        (Some(tokens), Some(at)) => (tokens
            + (now - at).num_microseconds().unwrap_or(i64::MAX).max(0) as f64
                / period.num_microseconds().unwrap_or(i64::MAX) as f64)
            .min(capacity as f64),
        _ => capacity as f64,
    }
}

pub fn wait_millis(tokens: f64, period: TimeDelta) -> i64 {
    if tokens >= 1.0 {
        0
    } else {
        ((1.0 - tokens) * period.num_microseconds().unwrap_or(i64::MAX) as f64 / 1000.0).ceil()
            as i64
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    const ID: &str = "00000000-0000-0000-0000-000000000001";
    #[test]
    fn unicode_and_whitespace_match_existing_chat() {
        assert_eq!(
            normalize(ID, "text", "  e\u{301}\r\n东方  ").unwrap().1,
            "é\n东方"
        );
        assert!(normalize(ID, "text", "a\tb").is_none());
        assert!(normalize(ID, "text", "a\u{202e}b").is_none());
        assert!(normalize(ID, "text", &"a".repeat(281)).is_none());
        assert!(normalize(ID, "text", &"a".repeat(280)).is_some());
        assert!(normalize(ID, "emoji", "❤️").is_some());
        assert!(normalize(ID, "emoji", "❤").is_none());
        assert!(normalize("00000000000000000000000000000001", "text", "a").is_none());
    }
    #[test]
    fn roles_and_bucket_recovery() {
        assert!(!can_view("player", "spectator"));
        assert!(can_view("spectator", "room"));
        let now = Utc::now();
        let period = TimeDelta::seconds(2);
        assert_eq!(refill(None, None, 5, period, now), 5.0);
        assert_eq!(
            refill(Some(0.0), Some(now), 5, period, now + TimeDelta::seconds(1)),
            0.5
        );
        assert_eq!(wait_millis(0.5, period), 1000);
        assert_eq!(
            refill(Some(1.0), Some(now), 5, period, now - TimeDelta::seconds(1)),
            1.0
        );
    }
}
