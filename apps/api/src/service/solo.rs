pub use crate::repository::solo::{StoredSession, load_session};
use crate::{app::AppState, error::ApiError, game::*};
use crate::{
    repository::solo::read_record,
    service::catalog::{self, invalid},
};
use axum::http::StatusCode;

use rand::TryRng;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, types::Json as SqlJson};

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PuzzleInput {
    question_scope: Option<QuestionScopeConfig>,
    difficulty: Option<String>,
    resume_session_id: Option<String>,
    idempotency_key: Option<String>,
}
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TurnInput {
    guess_id: Option<String>,
    expected_guess_count: Option<usize>,
}

pub fn check_mode(mode: &str) -> Result<(), ApiError> {
    if is_single_player_game_mode(mode) {
        Ok(())
    } else {
        Err(invalid("不支持的模式。"))
    }
}
fn not_found() -> ApiError {
    ApiError::new(
        StatusCode::NOT_FOUND,
        "SESSION_NOT_FOUND",
        "没有找到这一局游戏。",
    )
}
fn closed() -> ApiError {
    ApiError::new(StatusCode::CONFLICT, "SESSION_CLOSED", "这一局已经结束。")
}
fn concurrent() -> ApiError {
    ApiError::new(
        StatusCode::CONFLICT,
        "CONCURRENT_UPDATE",
        "会话刚刚发生变化，请重新提交。",
    )
}

fn stored_guesses(session: &StoredSession) -> Result<Vec<GuessResult>, ApiError> {
    let mut value = session.guesses.clone();
    if value.is_null() {
        return Ok(vec![]);
    }
    let entries = value
        .as_array_mut()
        .ok_or_else(|| ApiError::invariant("stored guesses must be an array"))?;
    for entry in entries {
        if entry
            .get("matchKind")
            .and_then(Value::as_str)
            .is_none_or(str::is_empty)
        {
            entry["matchKind"] = serde_json::to_value(match_kind_for_stored_guess(
                entry["isCorrect"].as_bool().unwrap_or(false),
                &session.answer_id,
                entry["guessId"].as_str().unwrap_or_default(),
            ))?;
        }
    }
    Ok(serde_json::from_value(value)?)
}
pub fn public_session(
    session: &StoredSession,
    characters: &[Character],
) -> Result<Value, ApiError> {
    let guesses = stored_guesses(session)?;
    let scope = catalog::scope_from_json(
        session.question_scope.as_ref(),
        &session.catalog_version,
        characters,
    )?;
    let mut hydrated = vec![];
    for mut guess in guesses {
        if guess.kind != "timeout" {
            guess.kind = "guess".into();
        }
        let mut value = serde_json::to_value(&guess)?;
        if guess.guess_avatar_url.is_empty()
            && let Some(c) = characters.iter().find(|c| c.id == guess.guess_id)
        {
            value["guessAvatarUrl"] = json!(c.avatar_url);
        }
        hydrated.push(value);
    }
    let mut value = json!({"id":session.id,"mode":session.mode,"contentType":session.content_type,"status":session.status,"maxGuesses":session.max_guesses,"catalogVersion":session.catalog_version,"questionScope":scope,"activeFields":fields_for_question_scope(&scope),"guesses":hydrated,"startedAt":session.started_at});
    if let Some(key) = &session.puzzle_key {
        value["puzzleKey"] = json!(key);
    }
    if let Some(ended) = session.ended_at {
        value["endedAt"] = json!(ended);
    }
    if session.status != "playing" {
        let answer = characters
            .iter()
            .find(|c| c.id == session.answer_id)
            .ok_or_else(|| ApiError::invariant("terminal session answer missing"))?;
        value["answer"] = catalog::public_character(answer);
    }
    Ok(value)
}
async fn project(
    connection: &mut PgConnection,
    session: &StoredSession,
) -> Result<Value, ApiError> {
    public_session(
        session,
        &catalog::characters_for_version(connection, &session.catalog_version).await?,
    )
}
fn label(session: &Value) -> String {
    if session["mode"] == "daily"
        && let Some(date) = session["puzzleKey"].as_str()
    {
        return format!("每日题 {date}");
    }
    "随机题".into()
}
fn new_session_id() -> Result<String, ApiError> {
    let mut raw = [0u8; 25];
    rand::rngs::SysRng.try_fill_bytes(&mut raw)?;
    let alphabet = b"abcdefghijklmnopqrstuvwxyz0123456789";
    Ok(raw
        .iter()
        .map(|b| alphabet[*b as usize % alphabet.len()] as char)
        .collect())
}
struct Selection {
    answer: Character,
    version: String,
    puzzle_key: Option<String>,
    scope: QuestionScopeConfig,
    policy: String,
}
async fn select_answer(
    connection: &mut PgConnection,
    state: &AppState,
    mode: &str,
    input: &PuzzleInput,
) -> Result<Selection, ApiError> {
    let (version, characters, works) = catalog::current_catalog(connection).await?;
    let works = catalog::scope_works(&works, &characters);
    if mode == "daily" {
        let difficulty = input
            .difficulty
            .as_deref()
            .filter(|v| is_daily_question_difficulty(v))
            .unwrap_or("normal");
        let date = puzzle_date_key(&(state.clock)());
        let mut scope = default_question_scope(&version, &works, &characters, difficulty);
        let existing: Option<(String, String, String)> = sqlx::query!(
            r#"
            SELECT catalog_version, answer_id, answer_match_policy FROM daily_puzzle WHERE date_key=$1 AND
            difficulty=$2
            "#,
            &date,
            difficulty,
        )
            .fetch_optional(&mut *connection)
            .await?
            .map(|row| (row.catalog_version, row.answer_id, row.answer_match_policy));
        let (frozen_version, answer_id, policy) = if let Some(existing) = existing {
            existing
        } else {
            let pool: Vec<_> = characters
                .iter()
                .filter(|c| c.enabled_as_answer && scope.selected_character_ids.contains(&c.id))
                .cloned()
                .collect();
            let answer = daily_answer_from_pool(&pool, &format!("{date}:{difficulty}")).map_err(
                |error| {
                    ApiError::new(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "INTERNAL",
                        "daily puzzle requires at least one enabled answer",
                    )
                    .with_source(error)
                },
            )?;
            let inserted: Option<(String, String, String)> = sqlx::query!(
                r#"
                INSERT INTO daily_puzzle(date_key, difficulty, catalog_version, answer_id, answer_match_policy)
                VALUES($1, $2, $3, $4, $5) ON CONFLICT(date_key, difficulty) DO NOTHING RETURNING catalog_version,
                answer_id, answer_match_policy
                "#,
                &date,
                difficulty,
                &version,
                &answer.id,
                &state.config.answer_match_policy,
            )
                .fetch_optional(&mut *connection)
                .await?
                .map(|row| (row.catalog_version, row.answer_id, row.answer_match_policy));
            if let Some(row) = inserted {
                row
            } else {
                {
                    let row = sqlx::query!(
                        r#"
                        SELECT catalog_version, answer_id, answer_match_policy FROM daily_puzzle WHERE date_key=$1 AND
                        difficulty=$2
                        "#,
                        &date,
                        difficulty,
                    ).fetch_one(&mut *connection).await?;
                    (row.catalog_version, row.answer_id, row.answer_match_policy)
                }
            }
        };
        policy.parse::<AnswerMatchPolicy>()?;
        let frozen = if frozen_version != version {
            let frozen = catalog::characters_for_version(connection, &frozen_version).await?;
            scope = default_question_scope(
                &frozen_version,
                &catalog::scope_works(&[], &frozen),
                &frozen,
                difficulty,
            );
            frozen
        } else {
            characters
        };
        let answer = frozen
            .into_iter()
            .find(|c| c.id == answer_id)
            .ok_or_else(|| {
                ApiError::new(
                    StatusCode::INTERNAL_SERVER_ERROR,
                    "INTERNAL",
                    "每日题快照中缺少答案角色。",
                )
            })?;
        Ok(Selection {
            answer,
            version: frozen_version,
            puzzle_key: Some(date),
            scope,
            policy,
        })
    } else {
        let scope =
            normalize_question_scope(input.question_scope.as_ref(), &version, &works, &characters)
                .config;
        let pool: Vec<_> = characters
            .into_iter()
            .filter(|c| c.enabled_as_answer && scope.selected_character_ids.contains(&c.id))
            .collect();
        if pool.is_empty() {
            return Err(ApiError::new(
                StatusCode::INTERNAL_SERVER_ERROR,
                "INTERNAL",
                "题库中没有可作为答案的角色。",
            ));
        }
        let index = (state.random_index)(pool.len());
        let answer = pool
            .get(index)
            .cloned()
            .ok_or_else(|| ApiError::invariant("random answer index out of bounds"))?;
        Ok(Selection {
            answer,
            version,
            puzzle_key: None,
            scope,
            policy: state.config.answer_match_policy.clone(),
        })
    }
}
async fn create_in(
    connection: &mut PgConnection,
    state: &AppState,
    mode: &str,
    input: &PuzzleInput,
) -> Result<Value, ApiError> {
    let selection = select_answer(connection, state, mode, input).await?;
    let max_guesses = if mode == "daily" {
        QUESTION_SCOPE_DEFAULT_GUESSES
    } else {
        effective_question_scope_max_guesses(&selection.scope.rules)
    };
    let row: StoredSession = sqlx::query_as!(
        StoredSession,
        r#"
        INSERT INTO game_session(id, mode, content_type, answer_id, catalog_version, puzzle_key, status,
        max_guesses, question_scope, answer_match_policy) VALUES($1, $2, 'character', $3, $4, $5, 'playing',
        $6, $7, $8) RETURNING id, mode, content_type, answer_id, catalog_version, puzzle_key, status,
        max_guesses, guesses, version, started_at, ended_at, question_scope, answer_match_policy
        "#,
        new_session_id()?,
        mode,
        &selection.answer.id,
        &selection.version,
        selection.puzzle_key.as_deref(),
        max_guesses,
        SqlJson(&selection.scope) as sqlx::types::Json<_>,
        &selection.policy,
    ).fetch_one(&mut *connection).await?;
    project(connection, &row).await
}
pub async fn create(
    state: AppState,
    mode: String,
    input: Result<PuzzleInput, ApiError>,
) -> Result<Value, ApiError> {
    check_mode(&mode)?;
    let input = input?;
    let mut connection = state.pool.acquire().await?;
    let session = create_in(&mut connection, &state, &mode, &input).await?;
    Ok(json!({"puzzleLabel":label(&session),"session":session}))
}
pub async fn get_session(state: AppState, id: String) -> Result<Value, ApiError> {
    let mut conn = state.pool.acquire().await?;
    let session = load_session(&mut conn, &id, false)
        .await?
        .ok_or_else(not_found)?;
    Ok(json!({"session":project(&mut conn,&session).await?}))
}
async fn update(
    connection: &mut PgConnection,
    state: &AppState,
    session: &StoredSession,
    guesses: &[GuessResult],
    status: &str,
) -> Result<Option<StoredSession>, ApiError> {
    let ended = if status != "playing" {
        Some((state.clock)())
    } else {
        None
    };
    Ok(sqlx::query_as!(
        StoredSession,
        r#"
        UPDATE game_session SET guesses=$1, status=$2, ended_at=$3, version=version+1, updated_at=now() WHERE
        id=$4 AND version=$5 AND status='playing' RETURNING id, mode, content_type, answer_id,
        catalog_version, puzzle_key, status, max_guesses, guesses, version, started_at, ended_at,
        question_scope, answer_match_policy
        "#,
        SqlJson(guesses) as sqlx::types::Json<_>,
        status,
        ended,
        &session.id,
        session.version,
    ).fetch_optional(connection).await?)
}
pub async fn guess(
    state: AppState,
    id: String,
    input: Result<TurnInput, ApiError>,
) -> Result<Value, ApiError> {
    let input = input?;
    let guess_id = input
        .guess_id
        .as_deref()
        .filter(|v| !v.is_empty())
        .ok_or_else(|| invalid("请求格式不正确。"))?;
    for _ in 0..2 {
        let mut conn = state.pool.acquire().await?;
        let session = load_session(&mut conn, &id, false)
            .await?
            .ok_or_else(not_found)?;
        if session.status != "playing" {
            return Err(closed());
        }
        let mut guesses = stored_guesses(&session)?;
        if input
            .expected_guess_count
            .is_some_and(|count| count != guesses.len())
        {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "CONCURRENT_UPDATE",
                "本回合已经发生变化，请重新提交。",
            ));
        }
        if guesses.iter().any(|g| g.guess_id == guess_id) {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "DUPLICATE_GUESS",
                "这个角色已经猜过了。",
            ));
        }
        let characters =
            catalog::characters_for_version(&mut conn, &session.catalog_version).await?;
        if session.content_type != "character" {
            return Err(ApiError::new(
                StatusCode::NOT_IMPLEMENTED,
                "UNSUPPORTED_CONTENT_TYPE",
                format!("暂不支持 {} 类型的猜测。", session.content_type),
            ));
        }
        let scope = catalog::scope_from_json(
            session.question_scope.as_ref(),
            &session.catalog_version,
            &characters,
        )?;
        let policy = session.answer_match_policy.parse()?;
        let result = state
            .catalog
            .runtimes
            .evaluate_guess(
                &session.catalog_version,
                policy,
                &session.answer_id,
                guess_id,
                Some(&fields_for_question_scope(&scope)),
            )
            .await
            .map_err(|e| {
                if matches!(e, GameError::GuessMissing | GameError::GuessDisabled) {
                    ApiError::new(
                        StatusCode::BAD_REQUEST,
                        "INVALID_GUESS",
                        "请选择本局题库中的角色。",
                    )
                    .with_source(e)
                } else if matches!(e, GameError::AnswerMissing) {
                    ApiError::new(
                        StatusCode::INTERNAL_SERVER_ERROR,
                        "INTERNAL",
                        "本局题库快照中缺少答案角色。",
                    )
                    .with_source(e)
                } else {
                    ApiError::from(e)
                }
            })?;
        let correct = result.is_correct;
        guesses.push(result);
        let status = if correct {
            "won"
        } else if guesses.len() >= session.max_guesses as usize {
            "lost"
        } else {
            "playing"
        };
        if let Some(updated) = update(&mut conn, &state, &session, &guesses, status).await? {
            return Ok(json!({"session":public_session(&updated,&characters)?}));
        }
    }
    Err(concurrent())
}
pub async fn timeout(
    state: AppState,
    id: String,
    input: Result<TurnInput, ApiError>,
) -> Result<Value, ApiError> {
    let input = input?;
    for _ in 0..2 {
        let mut conn = state.pool.acquire().await?;
        let session = load_session(&mut conn, &id, false)
            .await?
            .ok_or_else(not_found)?;
        let mut guesses = stored_guesses(&session)?;
        if input
            .expected_guess_count
            .is_some_and(|count| count != guesses.len())
        {
            return Ok(json!({"session":project(&mut conn,&session).await?}));
        }
        if session.status != "playing" {
            return Err(closed());
        }
        if guesses.len() >= session.max_guesses as usize {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "GUESS_LIMIT_REACHED",
                "本局猜测次数已用尽。",
            ));
        }
        let characters =
            catalog::characters_for_version(&mut conn, &session.catalog_version).await?;
        let scope = catalog::scope_from_json(
            session.question_scope.as_ref(),
            &session.catalog_version,
            &characters,
        )?;
        if !scope.rules.turn_limit.enabled {
            return Err(ApiError::new(
                StatusCode::CONFLICT,
                "INVALID_REQUEST",
                "本局未开启单手限时。",
            ));
        }
        guesses.push(GuessResult {
            kind: "timeout".into(),
            guess_id: format!("__timeout__:{}", guesses.len() + 1),
            guess_name: "超时空过".into(),
            guess_avatar_url: String::new(),
            is_correct: false,
            match_kind: MatchKind::None,
            feedback: vec![],
        });
        let status = if guesses.len() >= session.max_guesses as usize {
            "lost"
        } else {
            "playing"
        };
        if let Some(updated) = update(&mut conn, &state, &session, &guesses, status).await? {
            return Ok(json!({"session":public_session(&updated,&characters)?}));
        }
    }
    Err(concurrent())
}
pub async fn forfeit(state: AppState, id: String) -> Result<Value, ApiError> {
    let mut conn = state.pool.acquire().await?;
    let session = load_session(&mut conn, &id, false)
        .await?
        .ok_or_else(not_found)?;
    if session.status != "playing" {
        return Err(closed());
    }
    let characters = catalog::characters_for_version(&mut conn, &session.catalog_version).await?;
    let guesses = stored_guesses(&session)?;
    let updated = update(&mut conn, &state, &session, &guesses, "lost")
        .await?
        .ok_or_else(|| {
            ApiError::new(
                StatusCode::CONFLICT,
                "CONCURRENT_UPDATE",
                "会话刚刚发生变化，请重新执行。",
            )
        })?;
    Ok(json!({"session":public_session(&updated,&characters)?}))
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct Fingerprint<'a> {
    mode: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    resume_session_id: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    difficulty: Option<&'a str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    question_scope: Option<&'a QuestionScopeConfig>,
}
fn fingerprint(mode: &str, input: &PuzzleInput) -> Result<String, ApiError> {
    let payload = go_json_bytes(&Fingerprint {
        mode,
        resume_session_id: input.resume_session_id.as_deref(),
        difficulty: if mode == "daily" {
            Some(input.difficulty.as_deref().unwrap_or("normal"))
        } else {
            None
        },
        question_scope: if mode == "daily" {
            None
        } else {
            input.question_scope.as_ref()
        },
    })?;
    Ok(Sha256::digest(payload)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect())
}
fn same_scope_for_resume(a: &QuestionScopeConfig, b: &QuestionScopeConfig) -> bool {
    let ar = normalize_question_scope_rules(&a.rules);
    let br = normalize_question_scope_rules(&b.rules);
    a.mode == b.mode
        && a.difficulty == b.difficulty
        && a.selected_character_ids.len() == b.selected_character_ids.len()
        && b.selected_character_ids
            .iter()
            .all(|id| a.selected_character_ids.contains(id))
        && ar.field_modes == br.field_modes
        && ar.turn_limit == br.turn_limit
        && ar.guess_limit == br.guess_limit
}
async fn resume_matches(
    connection: &mut PgConnection,
    state: &AppState,
    mode: &str,
    input: &PuzzleInput,
    session: &StoredSession,
) -> Result<bool, ApiError> {
    if session.mode != mode {
        return Ok(false);
    }
    let characters = catalog::characters_for_version(connection, &session.catalog_version).await?;
    if mode == "daily" {
        let scope = catalog::scope_from_json(
            session.question_scope.as_ref(),
            &session.catalog_version,
            &characters,
        )?;
        return Ok(session.puzzle_key.as_deref()
            == Some(puzzle_date_key(&(state.clock)()).as_str())
            && scope.difficulty == input.difficulty.as_deref().unwrap_or("normal"));
    }
    let Some(raw) = &session.question_scope else {
        return Ok(false);
    };
    let Ok(stored) = serde_json::from_value::<QuestionScopeConfig>(raw.clone()) else {
        return Ok(false);
    };
    if stored.catalog_version.is_empty()
        || !(1..=QUESTION_SCOPE_SCHEMA_VERSION).contains(&stored.schema_version)
        || !["preset", "custom"].contains(&stored.mode.as_str())
        || (stored.difficulty != "custom" && !is_question_difficulty_preset(&stored.difficulty))
        || stored.selected_character_ids.is_empty()
    {
        return Ok(false);
    }
    let (current, now_characters, works) = catalog::current_catalog(connection).await?;
    let requested = normalize_question_scope(
        input.question_scope.as_ref(),
        &current,
        &catalog::scope_works(&works, &now_characters),
        &now_characters,
    )
    .config;
    let stored = normalize_question_scope(
        Some(&stored),
        &session.catalog_version,
        &catalog::scope_works(&[], &characters),
        &characters,
    )
    .config;
    Ok(same_scope_for_resume(&requested, &stored))
}

pub async fn resolve(
    state: AppState,
    mode: String,
    input: Result<PuzzleInput, ApiError>,
) -> Result<Value, ApiError> {
    check_mode(&mode)?;
    let mut input = input?;
    let key = input
        .idempotency_key
        .as_deref()
        .unwrap_or_default()
        .trim()
        .to_owned();
    if key.is_empty() || key.len() > 200 {
        return Err(invalid("幂等键不合法。"));
    }
    input.resume_session_id = input
        .resume_session_id
        .take()
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty());
    if mode == "daily"
        && !is_daily_question_difficulty(input.difficulty.as_deref().unwrap_or("normal"))
    {
        return Err(invalid("每日题难度不合法。"));
    }
    let fingerprint = fingerprint(&mode, &input)?;
    let mut tx = state.pool.begin().await?;
    let mut inserted = sqlx::query!(
        r#"
        INSERT INTO puzzle_resolve_idempotency(idempotency_key, request_fingerprint, mode) VALUES($1, $2, $3)
        ON CONFLICT(idempotency_key) DO NOTHING
        "#,
        &key,
        &fingerprint,
        &mode,
    ).execute(&mut *tx).await?.rows_affected() > 0;
    let mut record = read_record(&mut tx, &key, (state.clock)()).await?;
    if !inserted && record.expired {
        sqlx::query!(
            r#"
            UPDATE puzzle_resolve_idempotency SET request_fingerprint=$2, mode=$3, session_id=NULL,
            resolution=NULL, superseded_session_id=NULL, created_at=now(), expires_at='infinity'::timestamptz
            WHERE idempotency_key=$1 AND expires_at<=now()
            "#,
            &key,
            &fingerprint,
            &mode,
        ).execute(&mut *tx).await?;
        record = read_record(&mut tx, &key, (state.clock)()).await?;
        inserted = true;
    }
    if record.request_fingerprint != fingerprint {
        return Err(ApiError::new(
            StatusCode::CONFLICT,
            "IDEMPOTENCY_KEY_REUSED",
            "这个幂等键已用于其他题局请求。",
        ));
    }
    let result = if !inserted {
        let session = load_session(
            &mut tx,
            record
                .session_id
                .as_deref()
                .ok_or_else(|| ApiError::invariant("idempotency record session id missing"))?,
            false,
        )
        .await?
        .ok_or_else(|| ApiError::invariant("idempotency session missing"))?;
        let session = project(&mut tx, &session).await?;
        let mut result = json!({"puzzleLabel":label(&session),"resolution":record.resolution.ok_or_else(|| ApiError::invariant("idempotency resolution missing"))?,"session":session});
        if let Some(id) = record.superseded_session_id {
            let session = load_session(&mut tx, &id, false)
                .await?
                .ok_or_else(|| ApiError::invariant("superseded idempotency session missing"))?;
            result["supersededSession"] = project(&mut tx, &session).await?;
        }
        result
    } else {
        let mut superseded = None;
        let mut resumed = None;
        if let Some(id) = &input.resume_session_id
            && let Some(stored) = load_session(&mut tx, id, true).await?
        {
            if resume_matches(&mut tx, &state, &mode, &input, &stored).await? {
                resumed = Some(project(&mut tx, &stored).await?);
            } else {
                superseded = Some(stored);
            }
        }
        let (session, resolution) = if let Some(session) = resumed {
            (session, "resumed")
        } else {
            (create_in(&mut tx, &state, &mode, &input).await?, "created")
        };
        let superseded_id = superseded.as_ref().map(|s| s.id.clone());
        sqlx::query!(
            r#"
            UPDATE puzzle_resolve_idempotency SET session_id=$2, resolution=$3, superseded_session_id=$4 WHERE
            idempotency_key=$1
            "#,
            &key,
            session["id"].as_str(),
            resolution,
            superseded_id,
        ).execute(&mut *tx).await?;
        let mut result =
            json!({"puzzleLabel":label(&session),"resolution":resolution,"session":session});
        if let Some(stored) = superseded {
            result["supersededSession"] = project(&mut tx, &stored).await?;
        }
        result
    };
    tx.commit().await?;
    Ok(result)
}
