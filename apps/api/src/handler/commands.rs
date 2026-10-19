//! Round action HTTP endpoints for guesses, forfeits and passes.

use crate::{
    app::AppState,
    error::ApiError,
    service::{catalog::invalid, multi::commands},
};
use axum::{
    Json,
    extract::{Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
};
use serde_json::Value;
pub(crate) async fn guess(
    State(state): State<AppState>,
    Path((room_id, index)): Path<(String, i32)>,
    headers: HeaderMap,
    body: Result<Json<Value>, JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    commands::guess(
        state,
        (room_id, index),
        super::authorization(&headers),
        body.map(|Json(value)| value)
            .map_err(|_| invalid("缺少请求体。")),
    )
    .await
    .map(Json)
}

pub(crate) async fn forfeit(
    State(state): State<AppState>,
    Path((id, index)): Path<(String, i32)>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    commands::forfeit(state, (id, index), super::authorization(&headers))
        .await
        .map(|()| StatusCode::NO_CONTENT)
}

pub(crate) async fn pass(
    State(state): State<AppState>,
    Path((id, index)): Path<(String, i32)>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    commands::pass(state, (id, index), super::authorization(&headers))
        .await
        .map(|()| StatusCode::NO_CONTENT)
}
