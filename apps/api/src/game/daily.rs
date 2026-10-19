use super::{Character, GameError};
use chrono::{DateTime, TimeZone};

pub const PUZZLE_TIME_ZONE: &str = "Asia/Shanghai";
pub fn puzzle_date_key<T: TimeZone>(date: &DateTime<T>) -> String {
    date.with_timezone(&chrono_tz::Asia::Shanghai)
        .format("%Y-%m-%d")
        .to_string()
}
/// Historical Go FNV-1a hashes Unicode scalar values, not UTF-8 bytes. This
/// matches JavaScript charCodeAt for BMP catalog IDs and dates; supplementary
/// characters intentionally retain the historical Go behavior during migration.
pub fn hash_string(value: &str) -> u32 {
    value.chars().fold(2_166_136_261u32, |hash, ch| {
        (hash ^ ch as u32).wrapping_mul(16_777_619)
    })
}
pub fn daily_answer<'a>(
    characters: &'a [Character],
    date_key: &str,
) -> Result<&'a Character, GameError> {
    select_daily(characters.iter().filter(|c| c.enabled_as_answer), date_key)
}
pub fn daily_answer_from_pool<'a>(
    pool: &'a [Character],
    date_key: &str,
) -> Result<&'a Character, GameError> {
    select_daily(pool.iter(), date_key)
}
fn select_daily<'a>(
    mut pool: impl Iterator<Item = &'a Character>,
    date_key: &str,
) -> Result<&'a Character, GameError> {
    let mut selected = pool.next().ok_or(GameError::NoEnabledAnswer)?;
    for candidate in pool {
        let score = |c: &Character| hash_string(&format!("touhouflandre:{date_key}:{}", c.id));
        if score(candidate) > score(selected) {
            selected = candidate;
        }
    }
    Ok(selected)
}
