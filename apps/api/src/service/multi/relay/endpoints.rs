use crate::repository::models::Match;
use crate::{
    app::AppState,
    error::{ApiError, room_not_found},
    repository::{
        multi as store,
        relay::{self as storage, Stage},
    },
    service::multi::{
        auth, invalid,
        relay::{
            service::{self, Action},
            views,
        },
    },
};

use base64::{Engine, engine::general_purpose::URL_SAFE_NO_PAD};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ActionBody {
    action: String,
    idempotency_key: String,
    #[serde(default)]
    guess_id: Option<String>,
}
pub async fn action(
    state: AppState,
    path: Result<(String, i32, String), ApiError>,
    authorization: &str,
    body: Result<Value, ApiError>,
) -> Result<Value, ApiError> {
    let (room_id, stage_index, encounter_id) = path?;
    let member = auth::authenticate(&state, authorization, &room_id, false).await?;
    auth::require_player(&member)?;
    let value = body?;
    crate::contracts::validate_value("RelayEncounterActionRequest", &value)
        .map_err(|_| invalid("接力动作参数无效。"))?;
    let body: ActionBody =
        serde_json::from_value(value).map_err(|_| invalid("接力动作参数无效。"))?;
    let mut result = service::act(
        &state,
        Action {
            room_id,
            stage_index,
            encounter_id,
            actor_id: member.id,
            action: body.action,
            guess_id: body.guess_id,
            key: body.idempotency_key,
            legacy_forfeit: false,
        },
    )
    .await?;
    if let Some(error) = result.error {
        return Err(error);
    }
    if let Some(row) = result.body.get_mut("turn") {
        views::http_turn(row)
    }
    Ok(result.body)
}
#[derive(Deserialize)]
pub struct HistoryQuery {
    limit: Option<i64>,
    after: Option<String>,
}
#[derive(Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct HistoryCursor {
    v: i32,
    match_index: i32,
    after_stage_index: i32,
}
pub fn encode_history_cursor(match_index: i32, after_stage_index: i32) -> String {
    URL_SAFE_NO_PAD.encode(
        serde_json::to_vec(&HistoryCursor {
            v: 1,
            match_index,
            after_stage_index,
        })
        .expect("history cursor serializes"),
    )
}
pub fn decode_history_cursor(value: Option<&str>, match_index: i32) -> Result<i32, ApiError> {
    let Some(value) = value.filter(|v| !v.is_empty()) else {
        return Ok(0);
    };
    let bytes = URL_SAFE_NO_PAD
        .decode(value)
        .map_err(|_| invalid("history cursor 无效。"))?;
    let cursor: HistoryCursor =
        serde_json::from_slice(&bytes).map_err(|_| invalid("history cursor 无效。"))?;
    if cursor.v != 1 || cursor.match_index != match_index || cursor.after_stage_index < 0 {
        return Err(invalid("history cursor 无效。"));
    }
    Ok(cursor.after_stage_index)
}
pub async fn history(
    state: AppState,
    path: Result<(String, i32), ApiError>,
    authorization: &str,
    query: Result<HistoryQuery, ApiError>,
) -> Result<Value, ApiError> {
    let (room_id, match_index) = path?;
    if match_index < 0 {
        return Err(invalid("history 参数无效。"));
    }
    let started = std::time::Instant::now();
    let observer = auth::authenticate(&state, authorization, &room_id, false).await?;
    let query = query?;
    let limit = query.limit.unwrap_or(10);
    if !(1..=20).contains(&limit) {
        return Err(invalid("limit 超出允许范围。"));
    }
    let after = decode_history_cursor(query.after.as_deref(), match_index)?;
    let mut c = state.pool.acquire().await?;
    let room = store::room(&mut c, &room_id, false).await?;
    if room.mode != "relay" {
        return Err(invalid("只有接力场次支持 stage 历史。"));
    }
    let m = sqlx::query_as!(
        Match,
        r#"
        SELECT id, room_id, match_index, catalog_version, target_wins, score_slot1, score_slot2, round_count,
        status, started_at, ended_at, question_scope, winner_member_id, scoring_mode, roster_size,
        max_rounds, rule_set_key, rule_set_version, rule_config_snapshot, answer_match_policy FROM
        multi_match WHERE room_id=$1 AND match_index=$2
        "#,
        &room_id,
        match_index,
    )
        .fetch_optional(&mut *c)
        .await?
        .ok_or_else(room_not_found)?;
    storage::validate_match(&m)?;
    crate::service::multi::validate_ruleset(&state, &room, &m)?;
    let mut stages: Vec<Stage> = sqlx::query_as!(
        Stage,
        r#"
        SELECT id, match_id, stage_index, status, planned_encounter_count, starts_at, settled_at,
        settlement_marker FROM multi_relay_stage WHERE match_id=$1 AND status='ended' AND stage_index>$2
        ORDER BY stage_index LIMIT $3
        "#,
        &m.id,
        after,
        limit+1,
    ).fetch_all(&mut *c).await?;
    let next = if stages.len() > limit as usize {
        stages.truncate(limit as usize);
        stages
            .last()
            .map(|s| encode_history_cursor(match_index, s.stage_index))
    } else {
        None
    };
    let characters =
        crate::service::catalog::characters_for_version(&mut c, &m.catalog_version).await?;
    let mut result = Vec::new();
    for stage in stages {
        let view = views::stage_view(&mut c, &m, &stage, &observer, true, &characters).await?;
        let details = view["encounterDetails"]
            .as_array()
            .ok_or_else(|| ApiError::invariant("relay history details must be an array"))?;
        if details.iter().any(|d| {
            d["status"] != "ended" || d.get("answer").is_none() || d.get("outcome").is_none()
        }) {
            return Err(ApiError::invariant("relay history encounter not terminal"));
        }
        let mut history = json!({"stageId":stage.id,"stageIndex":stage.stage_index,"status":"ended","encounters":details,"settlement":view.get("settlement").cloned().unwrap_or_else(||json!([]))});
        if let Some(bye) = view.get("byeMemberId") {
            history["byeMemberId"] = bye.clone()
        }
        result.push(history)
    }
    crate::metrics::METRICS.observe(
        "history_latency_seconds",
        crate::metrics::Labels::new("relay", &m.rule_set_key, m.rule_set_version),
        started.elapsed().as_secs_f64(),
    );
    let mut response = json!({"stages":result});
    if let Some(cursor) = next {
        response["nextCursor"] = json!(cursor)
    }
    Ok(response)
}
