//! Chat HTTP endpoints and mapping of throttling/resync outcomes to wire responses.

use crate::{
    app::AppState,
    error::ApiError,
    service::{
        chat::{self, ChatOutcome, HistoryQuery},
        multi,
    },
};
use axum::{
    Json,
    extract::{Path, Query, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
    response::{IntoResponse, Response},
};
use serde_json::{Value, json};
fn response(outcome: ChatOutcome) -> Response {
    match outcome {
  ChatOutcome::Data(value) => Json(value).into_response(),
  ChatOutcome::ResyncRequired(value) => (StatusCode::GONE, Json(value)).into_response(),
  ChatOutcome::RateLimited(wait) => (StatusCode::TOO_MANY_REQUESTS,[("retry-after",((wait+999)/1000).max(1).to_string())],Json(json!({"code":"RATE_LIMITED","error":"发送过于频繁，请稍后再试。","retryAfterMs":wait.max(1)}))).into_response(),
 }
}
pub(crate) async fn send(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
    body: Result<Json<Value>, JsonRejection>,
) -> Result<Response, ApiError> {
    Ok(response(
        chat::send(
            state,
            room_id,
            super::authorization(&headers),
            body.map(|Json(v)| v)
                .map_err(|_| multi::invalid("缺少聊天消息。")),
        )
        .await?,
    ))
}

pub(crate) async fn list(
    State(state): State<AppState>,
    Path(room_id): Path<String>,
    headers: HeaderMap,
    query: Result<Query<HistoryQuery>, axum::extract::rejection::QueryRejection>,
) -> Result<Response, ApiError> {
    Ok(response(
        chat::list(
            state,
            room_id,
            super::authorization(&headers),
            query
                .map(|Query(v)| v)
                .map_err(|_| multi::invalid("聊天历史查询参数不合法。")),
        )
        .await?,
    ))
}
