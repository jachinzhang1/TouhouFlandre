//! Relay action and history HTTP endpoints.

use crate::{
    app::AppState,
    error::ApiError,
    service::multi::{
        invalid,
        relay::endpoints::{self as relay, HistoryQuery},
    },
};
use axum::{
    Json,
    extract::{Path, Query, State},
    http::HeaderMap,
};
use serde_json::Value;
pub(crate) async fn action(
    State(state): State<AppState>,
    path: Result<Path<(String, i32, String)>, axum::extract::rejection::PathRejection>,
    headers: HeaderMap,
    body: Result<Json<Value>, axum::extract::rejection::JsonRejection>,
) -> Result<Json<Value>, ApiError> {
    relay::action(
        state,
        path.map(|Path(p)| p)
            .map_err(|_| invalid("接力动作参数无效。")),
        super::authorization(&headers),
        body.map(|Json(v)| v)
            .map_err(|_| invalid("接力动作参数无效。")),
    )
    .await
    .map(Json)
}

pub(crate) async fn history(
    State(state): State<AppState>,
    path: Result<Path<(String, i32)>, axum::extract::rejection::PathRejection>,
    headers: HeaderMap,
    query: Result<Query<HistoryQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    relay::history(
        state,
        path.map(|Path(p)| p)
            .map_err(|_| invalid("history 参数无效。")),
        super::authorization(&headers),
        query
            .map(|Query(v)| v)
            .map_err(|_| invalid("history 参数无效。")),
    )
    .await
    .map(Json)
}
