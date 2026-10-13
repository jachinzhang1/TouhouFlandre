pub use crate::error::{invalid, missing_version, not_ready};
use crate::game::*;
use crate::repository::catalog::load_cached_snapshot;
pub use crate::repository::catalog::works;
pub use crate::repository::catalog::{characters_for_version, current_version};
use crate::seed::Work;
use crate::{app::AppState, error::ApiError};
use axum::http::StatusCode;

use serde::Deserialize;
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use sqlx::{PgConnection, PgPool, Row};

pub struct CatalogService {
    pub source: CatalogSearchSourceProvider,
    pub snapshots: CatalogSearchSnapshotProvider,
    pub runtimes: CatalogRuntimeProvider,
}
impl CatalogService {
    pub fn new(pool: PgPool) -> Self {
        let source_pool = pool.clone();
        let source = CatalogSearchSourceProvider::new(move |version| {
            let pool = source_pool.clone();
            async move { load_cached_snapshot(&pool, &version).await }
        });
        Self {
            snapshots: CatalogSearchSnapshotProvider::new(source.clone()),
            source,
            runtimes: CatalogRuntimeProvider::new(move |version| {
                let pool = pool.clone();
                async move { load_cached_snapshot(&pool, &version).await }
            }),
        }
    }
    pub async fn characters(
        &self,
        version: &str,
        requested: bool,
    ) -> Result<Vec<Character>, ApiError> {
        self.source.get(version).await.map_err(|error| {
            if matches!(error, GameError::CatalogSnapshotMissing) {
                if requested {
                    missing_version(version).with_source(error)
                } else {
                    not_ready("题库快照不可用。").with_source(error)
                }
            } else {
                ApiError::from(error)
            }
        })
    }
}

pub async fn current_catalog(
    connection: &mut PgConnection,
) -> Result<(String, Vec<Character>, Vec<Work>), ApiError> {
    let version = current_version(connection).await?;
    let characters = characters_for_version(connection, &version).await?;
    let works = works(connection).await?;
    Ok((version, characters, works))
}
pub fn scope_works(works: &[Work], characters: &[Character]) -> Vec<QuestionScopeWork> {
    if !works.is_empty() {
        return works
            .iter()
            .map(|w| QuestionScopeWork { id: w.id.clone() })
            .collect();
    }
    let mut characters: Vec<_> = characters.iter().collect();
    characters.sort_by(|a, b| {
        a.appearance_order
            .cmp(&b.appearance_order)
            .then(a.id.cmp(&b.id))
    });
    let mut seen = std::collections::HashSet::new();
    characters
        .into_iter()
        .filter_map(|c| {
            let id = &c.first_appearance.work_id;
            if id.is_empty() || !seen.insert(id.clone()) {
                None
            } else {
                Some(QuestionScopeWork { id: id.clone() })
            }
        })
        .collect()
}
pub fn scope_from_json(
    value: Option<&Value>,
    version: &str,
    characters: &[Character],
) -> Result<QuestionScopeConfig, ApiError> {
    let works = scope_works(&[], characters);
    let Some(value) = value else {
        return Ok(default_question_scope(version, &works, characters, "hard"));
    };
    let input: QuestionScopeConfig = if value.is_null() {
        QuestionScopeConfig::default()
    } else {
        serde_json::from_value(value.clone())?
    };
    Ok(normalize_question_scope(Some(&input), version, &works, characters).config)
}
pub fn public_character(character: &Character) -> Value {
    let mut value = serde_json::to_value(character).expect("Character serializes");
    value["firstAppearance"]
        .as_object_mut()
        .expect("appearance object")
        .remove("workPinyinInitials");
    value
}
pub fn search_result(character: &Character, search_text: String, name_sort_key: String) -> Value {
    json!({"id":character.id,"name":character.names.zh_hans,"subtitle":format!("{} · {}",character.names.en,character.first_appearance.work_title),"initials":character.names.zh_hans.chars().take(2).collect::<String>(),"avatarUrl":character.avatar_url,"appearanceOrder":character.appearance_order,"workId":character.first_appearance.work_id,"searchText":search_text,"nameSortKey":name_sort_key,"firstAppearance":{"releaseYear":character.first_appearance.release_year,"workTitle":character.first_appearance.work_title},"species":character.species,"locations":character.locations,"affiliations":character.affiliations,"hairColors":character.hair_colors})
}

pub async fn site_visits(state: AppState) -> Result<Value, ApiError> {
    let count: i64 = sqlx::query_scalar("INSERT INTO site_metric(key,value) VALUES('visits_total',1) ON CONFLICT(key) DO UPDATE SET value=site_metric.value+1,updated_at=now() RETURNING value").fetch_one(&state.pool).await?;
    Ok(json!({"count":count}))
}
pub async fn summary(state: AppState) -> Result<Value, ApiError> {
    let mut conn = state.pool.acquire().await?;
    let version = current_version(&mut conn).await?;
    let (total, guessable, answerable): (i64,i64,i64) = sqlx::query_as("SELECT COUNT(*),COUNT(*) FILTER(WHERE enabled_as_guess),COUNT(*) FILTER(WHERE enabled_as_answer) FROM character").fetch_one(&mut *conn).await?;
    let works = works(&mut conn).await?;
    Ok(
        json!({"version":version,"dailyDateKey":puzzle_date_key(&(state.clock)()),"contents":[{"contentType":"character","label":"角色","total":total,"guessable":guessable,"answerable":answerable,"maxGuesses":QUESTION_SCOPE_DEFAULT_GUESSES,"visibleFieldCount":character_guess_fields().len()}],"works":works}),
    )
}
pub async fn full(state: AppState) -> Result<Value, ApiError> {
    let mut conn = state.pool.acquire().await?;
    let (version, characters, works) = current_catalog(&mut conn).await?;
    let scope = default_question_scope(
        &version,
        &scope_works(&works, &characters),
        &characters,
        "normal",
    );
    Ok(
        json!({"version":version,"characters":characters.iter().map(public_character).collect::<Vec<_>>(),"works":works,"fieldDefinitions":field_definitions(),"defaultQuestionScope":scope}),
    )
}
pub async fn legacy_characters(state: AppState) -> Result<Value, ApiError> {
    let mut conn = state.pool.acquire().await?;
    let version = current_version(&mut conn).await?;
    let rows = sqlx::query("SELECT to_jsonb(c) AS data FROM character c WHERE enabled_as_guess ORDER BY name_sort_key,id ASC").fetch_all(&mut *conn).await?;
    let mut characters = vec![];
    for row in rows {
        let raw: Value = row.get("data");
        let mut mapped = serde_json::Map::new();
        for (key, value) in raw
            .as_object()
            .ok_or_else(|| ApiError::invariant("catalog row must be an object"))?
        {
            let mut segments = key.split('_');
            let mut key = segments.next().unwrap_or_default().to_owned();
            for part in segments {
                let mut chars = part.chars();
                if let Some(first) = chars.next() {
                    key.extend(first.to_uppercase());
                    key.push_str(chars.as_str());
                }
            }
            mapped.insert(key, value.clone());
        }
        let character: Character = serde_json::from_value(Value::Object(mapped))?;
        characters.push(search_result(
            &character,
            raw["search_text"].as_str().unwrap_or_default().into(),
            raw["name_sort_key"].as_str().unwrap_or_default().into(),
        ));
    }
    Ok(json!({"version":version,"characters":characters}))
}
#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SearchParams {
    q: Option<String>,
    session_id: Option<String>,
    catalog_version: Option<String>,
    room_id: Option<String>,
    match_index: Option<i32>,
    work_ids: Option<String>,
    limit: Option<i64>,
    offset: Option<i64>,
    sort: Option<String>,
    direction: Option<String>,
}

pub async fn search(
    state: &AppState,
    query: Result<SearchParams, ApiError>,
) -> Result<Value, ApiError> {
    let p = query?;
    if p.limit.is_some_and(|v| !(1..=250).contains(&v))
        || p.offset.is_some_and(|v| v < 0)
        || p.match_index.is_some_and(|v| v < 0)
        || p.sort
            .as_deref()
            .is_some_and(|v| !["name", "appearance", "relevance"].contains(&v))
        || p.direction
            .as_deref()
            .is_some_and(|v| !["asc", "desc"].contains(&v))
    {
        return Err(invalid("请求参数不合法。"));
    }
    if p.session_id.is_some() && p.catalog_version.is_some() {
        return Err(invalid("sessionId 与 catalogVersion 不能同时提供。"));
    }
    if p.room_id.is_some() != p.match_index.is_some() {
        return Err(invalid("roomId 与 matchIndex 必须同时提供。"));
    }
    if p.room_id.is_some() && (p.session_id.is_some() || p.catalog_version.is_some()) {
        return Err(invalid(
            "多人场次上下文不能与 sessionId 或 catalogVersion 同时提供。",
        ));
    }
    let mut scope = None;
    let version = if let Some(id) = &p.session_id {
        let row: Option<(String, Option<Value>)> =
            sqlx::query_as("SELECT catalog_version,question_scope FROM game_session WHERE id=$1")
                .bind(id)
                .fetch_optional(&state.pool)
                .await?;
        let (version, value) = row.ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "SESSION_NOT_FOUND",
                "没有找到这一局游戏。",
            )
        })?;
        scope = value;
        version
    } else if let Some(id) = &p.room_id {
        let row: Option<(String,Option<Value>)> = sqlx::query_as("SELECT catalog_version,question_scope FROM multi_match WHERE room_id=$1 AND match_index=$2").bind(id).bind(p.match_index).fetch_optional(&state.pool).await?;
        let (version, value) = row.ok_or_else(|| {
            ApiError::new(
                StatusCode::NOT_FOUND,
                "ROOM_NOT_FOUND",
                "没有找到这一场游戏。",
            )
        })?;
        scope = value;
        version
    } else if let Some(version) = &p.catalog_version {
        version.clone()
    } else {
        current_version(&mut *state.pool.acquire().await?).await?
    };
    let characters = state
        .catalog
        .characters(&version, p.catalog_version.is_some())
        .await?;
    let mut filters = vec![CharacterSearchFilter::EnabledAsGuess];
    if let Some(work_ids) = p.work_ids {
        filters.push(CharacterSearchFilter::work_ids(
            &work_ids
                .split(',')
                .map(str::trim)
                .filter(|v| !v.is_empty())
                .map(String::from)
                .collect::<Vec<_>>(),
        ));
    }
    if state.config.search_scope_filter && (p.session_id.is_some() || p.room_id.is_some()) {
        filters.push(CharacterSearchFilter::character_ids(
            &scope_from_json(scope.as_ref(), &version, &characters)?.selected_character_ids,
        ));
    }
    let page = search_characters(
        &characters,
        &CharacterSearchOptions {
            query: p.q.unwrap_or_default(),
            filters,
            sort_by: p.sort.unwrap_or_else(|| "name".into()),
            descending: p.direction.as_deref() == Some("desc"),
            offset: p.offset.unwrap_or(0),
            limit: p.limit.unwrap_or(50),
        },
    );
    Ok(
        json!({"results":page.characters.iter().map(|c| search_result(c,character_search_text(c),character_name_sort_key(c))).collect::<Vec<_>>(),"total":page.total}),
    )
}
pub fn policy_revision(base: &str, mode: &str, scope: &str) -> String {
    let hash = Sha256::digest(format!(
        "{base}\0{mode}\0{scope}\0{SEARCH_INDEX_SCHEMA_VERSION}"
    ));
    format!(
        "{base}-{}",
        hash[..8]
            .iter()
            .map(|v| format!("{v:02x}"))
            .collect::<String>()
    )
}
pub fn policy(state: &AppState) -> Value {
    SEARCH_METRICS.inc_policy_outcome("success");
    let mode = &state.config.search_mode;
    let scope = if state.config.search_scope_filter {
        "strict"
    } else {
        "full"
    };
    json!({"mode":mode,"indexSchemaVersion":SEARCH_INDEX_SCHEMA_VERSION,"revision":policy_revision(&state.config.search_policy_revision,mode,scope),"gameScopeMode":scope,"revalidateAfterSeconds":60})
}
pub fn matches_etag(value: &str, etag: &str) -> bool {
    value.split(',').any(|v| {
        let v = v.trim();
        v == "*" || v == etag || v.strip_prefix("W/") == Some(etag)
    })
}

pub async fn search_index(
    state: &AppState,
    version: &str,
    schema: i32,
) -> Result<CatalogSearchSnapshot, ApiError> {
    current_version(&mut *state.pool.acquire().await?).await?;
    let snapshot = state
        .catalog
        .snapshots
        .get(version, schema)
        .await
        .map_err(|err| {
            if schema != SEARCH_INDEX_SCHEMA_VERSION {
                invalid("不支持的搜索索引版本。").with_source(err)
            } else if matches!(err, GameError::CatalogSnapshotMissing) {
                missing_version(version).with_source(err)
            } else {
                not_ready("题库搜索索引暂时不可用。").with_source(err)
            }
        })?;
    Ok(snapshot)
}
