use crate::{app::AppState, error::ApiError, service::health};
use axum::{
    Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use serde_json::json;
pub(crate) async fn health() -> Json<serde_json::Value> {
    Json(json!({"ok":true,"service":"touhouflandre-api"}))
}
pub(crate) async fn live() -> Json<serde_json::Value> {
    Json(json!({"ok":true}))
}
pub(crate) async fn ready(State(state): State<AppState>) -> Response {
    match health::check(&state).await {
        Ok(()) => Json(json!({"ok":true})).into_response(),
        Err((message, error)) => {
            error.report("readiness");
            (
                StatusCode::SERVICE_UNAVAILABLE,
                Json(json!({"error":message})),
            )
                .into_response()
        }
    }
}
pub(crate) async fn not_found() -> ApiError {
    ApiError::new(StatusCode::NOT_FOUND, "INVALID_REQUEST", "Not Found")
}
pub(crate) async fn method_not_allowed() -> ApiError {
    ApiError::new(
        StatusCode::METHOD_NOT_ALLOWED,
        "INVALID_REQUEST",
        "Method Not Allowed",
    )
}
