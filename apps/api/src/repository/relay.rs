use crate::{
    domain::relay::{self as domain, Player, Standing},
    error::ApiError,
    game,
    repository::models::Match,
};
use chrono::{DateTime, Utc};
use serde_json::Value;
use sqlx::{FromRow, PgConnection};

#[derive(Debug, Clone, FromRow)]
pub struct Stage {
    pub id: String,
    pub match_id: String,
    pub stage_index: i32,
    pub status: String,
    pub planned_encounter_count: i32,
    pub starts_at: DateTime<Utc>,
    pub settled_at: Option<DateTime<Utc>>,
    pub settlement_marker: Option<String>,
}
#[derive(Debug, Clone, FromRow)]
pub struct Encounter {
    pub id: String,
    pub match_id: String,
    pub stage_id: String,
    pub encounter_index: i32,
    pub status: String,
    pub answer_id: String,
    pub starts_at: DateTime<Utc>,
    pub deadline: DateTime<Utc>,
    pub turn_member_id: Option<String>,
    pub turn_deadline: Option<DateTime<Utc>>,
    pub winner_member_id: Option<String>,
    pub outcome: Option<String>,
    pub ended_at: Option<DateTime<Utc>>,
    pub ended_by_member_id: Option<String>,
    pub end_idempotency_key: Option<String>,
}
#[derive(Debug, Clone, FromRow, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Assignment {
    pub member_id: String,
    pub side: i32,
    pub seat: i32,
}
#[derive(Debug, Clone, FromRow)]
pub struct StoredTurn {
    pub id: String,
    pub member_id: String,
    pub turn_index: i32,
    pub kind: String,
    pub guess_id: Option<String>,
    pub statuses: Option<Value>,
    pub is_correct: bool,
    pub idempotency_key: String,
}
#[derive(Debug, Clone, FromRow)]
pub struct StoredSettlement {
    pub member_id: String,
    pub encounter_id: Option<String>,
    pub assignment: String,
    pub outcome: String,
    pub score_before: i32,
    pub score_delta: i32,
    pub score_after: i32,
    pub life_before: String,
    pub life_after: String,
    pub eliminated_stage: Option<i32>,
}
pub async fn stages(c: &mut PgConnection, match_id: &str) -> Result<Vec<Stage>, ApiError> {
    Ok(
        sqlx::query_as("SELECT * FROM multi_relay_stage WHERE match_id=$1 ORDER BY stage_index")
            .bind(match_id)
            .fetch_all(c)
            .await?,
    )
}
pub async fn encounters(c: &mut PgConnection, stage_id: &str) -> Result<Vec<Encounter>, ApiError> {
    Ok(sqlx::query_as(
        "SELECT * FROM multi_relay_encounter WHERE stage_id=$1 ORDER BY encounter_index",
    )
    .bind(stage_id)
    .fetch_all(c)
    .await?)
}
pub async fn assignments(
    c: &mut PgConnection,
    encounter_id: &str,
) -> Result<Vec<Assignment>, ApiError> {
    let rows=sqlx::query_as("SELECT member_id,seat,side FROM multi_relay_encounter_member WHERE encounter_id=$1 ORDER BY side").bind(encounter_id).fetch_all(c).await?;
    if rows.len() != 2 {
        return Err(ApiError::invariant(
            "relay encounter assignment count mismatch",
        ));
    }
    Ok(rows)
}
pub async fn turns(c: &mut PgConnection, encounter_id: &str) -> Result<Vec<StoredTurn>, ApiError> {
    Ok(
        sqlx::query_as("SELECT * FROM multi_relay_turn WHERE encounter_id=$1 ORDER BY turn_index")
            .bind(encounter_id)
            .fetch_all(c)
            .await?,
    )
}
pub async fn bye(c: &mut PgConnection, stage_id: &str) -> Result<Option<Player>, ApiError> {
    Ok(
        sqlx::query_as("SELECT member_id,seat FROM multi_relay_stage_bye WHERE stage_id=$1")
            .bind(stage_id)
            .fetch_optional(c)
            .await?,
    )
}
pub async fn standings(c: &mut PgConnection, match_id: &str) -> Result<Vec<Standing>, ApiError> {
    #[derive(FromRow)]
    struct Row {
        member_id: String,
        seat: i32,
        score: i32,
        life_state: String,
        status: String,
        eliminated_stage: Option<i32>,
    }
    let rows:Vec<Row>=sqlx::query_as("SELECT p.member_id,p.seat,s.score,s.life_state,p.status,s.eliminated_stage FROM multi_match_player p JOIN multi_relay_match_player_state s ON s.match_id=p.match_id AND s.member_id=p.member_id WHERE p.match_id=$1 ORDER BY p.seat,p.member_id").bind(match_id).fetch_all(c).await?;
    Ok(rows
        .into_iter()
        .map(|r| Standing {
            player: Player {
                member_id: r.member_id,
                seat: r.seat,
            },
            score: r.score,
            life_state: r.life_state,
            status: r.status,
            eliminated_stage: r.eliminated_stage,
        })
        .collect())
}
pub fn scope(m: &Match) -> Option<game::QuestionScopeConfig> {
    m.question_scope
        .as_ref()
        .and_then(|v| serde_json::from_value(v.clone()).ok())
}
pub fn max_turns(m: &Match) -> i32 {
    scope(m)
        .map(|s| game::effective_question_scope_max_guesses(&s.rules))
        .filter(|n| *n > 0)
        .unwrap_or(8)
}
pub fn fields(m: &Match) -> Vec<game::GuessField> {
    scope(m)
        .map(|s| game::fields_for_question_scope(&s))
        .unwrap_or_else(game::character_guess_fields)
}
pub fn storage_fields(m: &Match) -> Vec<game::GuessField> {
    scope(m)
        .map(|s| game::storage_fields_for_question_scope(&s))
        .unwrap_or_else(game::character_guess_fields)
}
pub fn answer_pool(m: &Match, characters: &[game::Character]) -> Vec<String> {
    if let Some(s) = scope(m).filter(|s| !s.selected_character_ids.is_empty()) {
        game::question_scope_answer_pool(&s)
    } else {
        characters
            .iter()
            .filter(|c| c.enabled_as_answer)
            .map(|c| c.id.clone())
            .collect()
    }
}
pub fn encounter_state(
    m: &Match,
    e: &Encounter,
    members: &[Assignment],
    turns: &[StoredTurn],
) -> Result<domain::EncounterState, ApiError> {
    let members: Vec<_> = members
        .iter()
        .map(|a| Player {
            member_id: a.member_id.clone(),
            seat: a.seat,
        })
        .collect();
    Ok(domain::EncounterState {
        ended: e.status == "ended",
        members: members
            .try_into()
            .map_err(|_| ApiError::invariant("relay encounter must have two members"))?,
        turn_member_id: e.turn_member_id.clone().unwrap_or_default(),
        max_turns: max_turns(m),
        turns: turns
            .iter()
            .map(|t| domain::Turn {
                index: t.turn_index,
                member_id: t.member_id.clone(),
                kind: t.kind.clone(),
                guess_id: t.guess_id.clone(),
                correct: t.is_correct,
            })
            .collect(),
    })
}
pub fn validate_match(m: &Match) -> Result<domain::Rule, ApiError> {
    let rule = domain::Rule::parse(&m.rule_set_key, m.rule_set_version)?;
    if m.scoring_mode != "wins"
        || if rule == domain::Rule::Legacy {
            m.roster_size != 2
        } else {
            !matches!(m.roster_size, 4 | 6 | 8)
        }
    {
        return Err(ApiError::invariant("unsupported relay ruleset"));
    }
    Ok(rule)
}
