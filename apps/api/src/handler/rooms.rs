//! Room HTTP endpoints; transactions and membership decisions live in service::multi::rooms.

use crate::{
    app::AppState,
    error::ApiError,
    service::{catalog::invalid, multi::rooms},
};
use axum::{
    Json,
    extract::{ConnectInfo, Path, State, rejection::JsonRejection},
    http::{HeaderMap, StatusCode},
};
use serde_json::Value;
use std::net::SocketAddr;
pub(crate) async fn create(
    State(state): State<AppState>,
    body: Result<Json<Value>, JsonRejection>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    Ok((
        StatusCode::CREATED,
        Json(
            rooms::create(
                state,
                body.map(|Json(value)| value)
                    .map_err(|_| invalid("缺少请求体。")),
            )
            .await?,
        ),
    ))
}

pub(crate) async fn info(
    State(state): State<AppState>,
    Path(code): Path<String>,
    peer: Option<axum::Extension<ConnectInfo<SocketAddr>>>,
) -> Result<Json<Value>, ApiError> {
    rooms::info(state, code, peer.map(|p| p.0.0))
        .await
        .map(Json)
}

pub(crate) async fn join(
    State(state): State<AppState>,
    Path(code): Path<String>,
    peer: Option<axum::Extension<ConnectInfo<SocketAddr>>>,
    body: Result<Json<Value>, JsonRejection>,
) -> Result<(StatusCode, Json<Value>), ApiError> {
    Ok((
        StatusCode::CREATED,
        Json(
            rooms::join(
                state,
                code,
                peer.map(|p| p.0.0),
                body.map(|Json(value)| value)
                    .map_err(|_| invalid("缺少或无效的请求体。")),
            )
            .await?,
        ),
    ))
}

pub(crate) async fn ready(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Result<Json<Value>, JsonRejection>,
) -> Result<StatusCode, ApiError> {
    rooms::ready(
        state,
        id,
        super::authorization(&headers),
        body.map(|Json(value)| value)
            .map_err(|_| invalid("缺少或无效的请求体。")),
    )
    .await
    .map(|()| StatusCode::NO_CONTENT)
}

pub(crate) async fn claim(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    rooms::claim(state, id, super::authorization(&headers))
        .await
        .map(|()| StatusCode::NO_CONTENT)
}

pub(crate) async fn settings(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
    body: Result<Json<Value>, JsonRejection>,
) -> Result<StatusCode, ApiError> {
    rooms::settings(
        state,
        id,
        super::authorization(&headers),
        body.map(|Json(value)| value)
            .map_err(|_| invalid("缺少或无效的请求体。")),
    )
    .await
    .map(|()| StatusCode::NO_CONTENT)
}

pub(crate) async fn close(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    rooms::close(state, id, super::authorization(&headers))
        .await
        .map(|()| StatusCode::NO_CONTENT)
}

pub(crate) async fn leave(
    State(state): State<AppState>,
    Path(id): Path<String>,
    headers: HeaderMap,
) -> Result<StatusCode, ApiError> {
    rooms::leave(state, id, super::authorization(&headers))
        .await
        .map(|()| StatusCode::NO_CONTENT)
}
