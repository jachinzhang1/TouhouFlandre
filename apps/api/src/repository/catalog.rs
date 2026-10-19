use crate::{
    error::{ApiError, not_ready},
    game::*,
    seed::Work,
};
use axum::http::StatusCode;
use serde_json::Value;
use sqlx::{PgConnection, PgPool};
pub async fn load_cached_snapshot(
    pool: &PgPool,
    version: &str,
) -> Result<Vec<Character>, GameError> {
    let value: Option<Value> = sqlx::query_scalar!(
        r#"
        SELECT characters FROM catalog_snapshot WHERE version=$1
        "#,
        version,
    )
    .fetch_optional(pool)
    .await
    .map_err(GameError::catalog_source)?;
    serde_json::from_value(value.ok_or(GameError::CatalogSnapshotMissing)?)
        .map_err(|source| GameError::InvalidCatalogSnapshot(SharedSource::new(source)))
}

pub async fn current_version(connection: &mut PgConnection) -> Result<String, ApiError> {
    sqlx::query_scalar!(
        r#"
        SELECT current_version FROM catalog_state WHERE id='current'
        "#,
    )
    .fetch_optional(connection)
    .await?
    .ok_or_else(|| not_ready("题库尚未初始化，请先运行 seed。"))
}

pub async fn characters_for_version(
    connection: &mut PgConnection,
    version: &str,
) -> Result<Vec<Character>, ApiError> {
    let value: Option<Value> = sqlx::query_scalar!(
        r#"
        SELECT characters FROM catalog_snapshot WHERE version=$1
        "#,
        version,
    )
    .fetch_optional(connection)
    .await?;
    Ok(serde_json::from_value(value.ok_or_else(|| {
        ApiError::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL",
            format!("题库快照缺失：{version}"),
        )
        .with_source(GameError::CatalogSnapshotMissing)
    })?)?)
}

pub async fn works(connection: &mut PgConnection) -> Result<Vec<Work>, ApiError> {
    let rows = sqlx::query!(
        r#"
        SELECT id, title_zh, title_ja, title_en, short_name, pinyin_initials AS
        "pinyin_initials: sqlx::types::Json<Vec<String>>", type AS work_type, release_year, mainline_index,
        era FROM work ORDER BY release_year ASC, mainline_index ASC NULLS LAST, short_name ASC, id ASC
        "#,
    ).fetch_all(connection).await?;
    Ok(rows
        .into_iter()
        .map(|r| Work {
            id: r.id,
            title_zh: r.title_zh,
            title_ja: r.title_ja,
            title_en: r.title_en,
            short_name: r.short_name,
            pinyin_initials: r.pinyin_initials.0,
            work_type: r.work_type,
            release_year: r.release_year,
            mainline_index: r.mainline_index,
            era: r.era,
        })
        .collect())
}
