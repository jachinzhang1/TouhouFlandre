//! Room snapshot HTTP endpoint.

use crate::{
    app::AppState,
    error::ApiError,
    service::{
        catalog::invalid,
        multi::snapshot::{self, Params},
    },
};
use axum::{
    Json,
    extract::{Path, Query, State, rejection::QueryRejection},
    http::HeaderMap,
};
use serde_json::Value;
pub(crate) async fn snapshot(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    params: Result<Query<Params>, QueryRejection>,
) -> Result<Json<Value>, ApiError> {
    snapshot::snapshot(
        state,
        id,
        super::authorization(&headers),
        params
            .map(|Query(value)| value)
            .map_err(|_| invalid("请求参数不合法。")),
    )
    .await
    .map(Json)
}
