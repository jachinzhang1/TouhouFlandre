//! Single-player HTTP endpoints and OpenAPI request decoding.

use crate::{
    app::AppState,
    contracts,
    error::ApiError,
    service::{catalog::invalid, solo},
};
use axum::{
    Json,
    body::Bytes,
    extract::{Path, State},
    http::{HeaderMap, StatusCode, header},
};
use serde_json::{Value, json};
fn read_body<T: serde::de::DeserializeOwned>(
    bytes: &Bytes,
    headers: &HeaderMap,
    optional: bool,
    schema: &str,
) -> Result<T, ApiError> {
    if bytes.is_empty() && !optional {
        return Err(invalid("请求格式不正确。"));
    }
    if !bytes.is_empty()
        && !headers
            .get(header::CONTENT_TYPE)
            .and_then(|v| v.to_str().ok())
            .is_some_and(|v| {
                v.split(';')
                    .next()
                    .unwrap_or_default()
                    .trim()
                    .eq_ignore_ascii_case("application/json")
            })
    {
        return Err(ApiError::new(
            StatusCode::UNSUPPORTED_MEDIA_TYPE,
            "INVALID_REQUEST",
            "请求内容类型必须是 application/json。",
        ));
    }
    let value = if bytes.is_empty() {
        json!({})
    } else {
        serde_json::from_slice(bytes).map_err(|_| invalid("请求格式不正确。"))?
    };
    contracts::validate_value(schema, &value).map_err(|_| invalid("请求格式不正确。"))?;
    serde_json::from_value(value).map_err(|_| invalid("请求格式不正确。"))
}

pub(crate) async fn create(
    State(state): State<AppState>,
    Path(mode): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let input = read_body(&body, &headers, true, "PuzzleCreateRequest");
    solo::create(state, mode, input).await.map(Json)
}

pub(crate) async fn get_session(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    solo::get_session(state, id).await.map(Json)
}

pub(crate) async fn guess(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let input = read_body(&body, &headers, false, "SessionsSubmitGuessRequestBody");
    solo::guess(state, id, input).await.map(Json)
}

pub(crate) async fn timeout(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let input = read_body(&body, &headers, true, "SessionsTimeoutRequestBody");
    solo::timeout(state, id, input).await.map(Json)
}

pub(crate) async fn forfeit(
    State(state): State<AppState>,
    Path(id): Path<String>,
) -> Result<Json<Value>, ApiError> {
    solo::forfeit(state, id).await.map(Json)
}

pub(crate) async fn resolve(
    State(state): State<AppState>,
    Path(mode): Path<String>,
    headers: HeaderMap,
    body: Bytes,
) -> Result<Json<Value>, ApiError> {
    let input = read_body(&body, &headers, false, "PuzzleResolveRequest");
    solo::resolve(state, mode, input).await.map(Json)
}
