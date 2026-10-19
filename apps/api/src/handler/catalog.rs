//! Catalog HTTP endpoints, cache validators and search response headers.

use crate::{
    app::AppState,
    error::ApiError,
    game::*,
    service::catalog::{self, SearchParams, invalid},
};
use axum::{
    Json,
    extract::{Path, Query, State, rejection::QueryRejection},
    http::{HeaderMap, HeaderValue, StatusCode, header},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
pub(crate) async fn site_visits(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    catalog::site_visits(state).await.map(Json)
}

pub(crate) async fn summary(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    catalog::summary(state).await.map(Json)
}

pub(crate) async fn full(State(state): State<AppState>) -> Result<Json<Value>, ApiError> {
    catalog::full(state).await.map(Json)
}

pub(crate) async fn legacy_characters(
    State(state): State<AppState>,
) -> Result<Json<Value>, ApiError> {
    catalog::legacy_characters(state).await.map(Json)
}

pub(crate) async fn search(
    State(state): State<AppState>,
    headers: HeaderMap,
    query: Result<Query<SearchParams>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    let reason = headers
        .get("x-character-search-fallback-reason")
        .map(|v| v.to_str().unwrap_or_default().trim());
    let reason = match reason {
        None => "none",
        Some(
            value @ ("none" | "policy_remote" | "policy_unavailable" | "context_incomplete"
            | "index_transient" | "index_invalid" | "engine_error"),
        ) => value,
        _ => "unknown",
    };
    SEARCH_METRICS.inc_fallback_reason(reason);
    tracing::debug!(reason, "character search fallback reason");
    let started = std::time::Instant::now();
    let result = catalog::search(
        &state,
        query
            .map(|Query(p)| p)
            .map_err(|_| invalid("请求参数不合法。")),
    )
    .await
    .map(Json);
    SEARCH_METRICS.observe_remote_latency(started.elapsed());
    SEARCH_METRICS.inc_remote_outcome(if result.is_ok() { "success" } else { "error" });
    result
}

pub(crate) async fn policy(State(state): State<AppState>) -> Response {
    (
        [(header::CACHE_CONTROL, "no-store")],
        Json(catalog::policy(&state)),
    )
        .into_response()
}

pub(crate) async fn index(
    State(state): State<AppState>,
    path: Result<Path<(String, i32)>, axum::extract::rejection::PathRejection>,
    headers: HeaderMap,
) -> Response {
    let result: Result<Response, ApiError> = async {
        let (version, schema) = path.map_err(|_| invalid("不支持的搜索索引版本。"))?.0;
        let snapshot = catalog::search_index(&state, &version, schema).await?;
        let mut response = if catalog::matches_etag(
            headers
                .get(header::IF_NONE_MATCH)
                .and_then(|h| h.to_str().ok())
                .unwrap_or_default(),
            &snapshot.etag,
        ) {
            StatusCode::NOT_MODIFIED.into_response()
        } else {
            // The old HTTP DTO allocated hairColors even when the internal
            // hash payload used a nil slice. Keep this public projection while
            // retaining the historical ETag over the cached internal payload.
            let mut body = serde_json::to_value(&snapshot.index)?;
            for entry in body["entries"]
                .as_array_mut()
                .ok_or_else(|| ApiError::invariant("search index entries must be an array"))?
            {
                if entry["hairColors"].is_null() {
                    entry["hairColors"] = json!([]);
                }
            }
            Json(body).into_response()
        };
        response
            .headers_mut()
            .insert(header::ETAG, HeaderValue::from_str(&snapshot.etag)?);
        response.headers_mut().insert(
            header::CACHE_CONTROL,
            HeaderValue::from_static("public, max-age=31536000, immutable"),
        );
        Ok(response)
    }
    .await;
    result.unwrap_or_else(|error| {
        let mut response = error.into_response();
        response
            .headers_mut()
            .insert(header::CACHE_CONTROL, HeaderValue::from_static("no-store"));
        response
    })
}
