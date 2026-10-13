//! Rematch HTTP endpoint.

use crate::{app::AppState, error::ApiError, service::multi::matches};
use axum::{
    extract::{Path, State},
    http::{HeaderMap, StatusCode},
};
pub(crate) async fn rematch(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    matches::rematch(state, id, super::authorization(&headers))
        .await
        .map(|()| StatusCode::NO_CONTENT)
}
