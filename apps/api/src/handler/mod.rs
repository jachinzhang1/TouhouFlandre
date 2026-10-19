//! HTTP adapters: extraction, wire responses and WebSocket framing.
//! Route registration is centralized in crate::router; application work lives in service/.
pub(crate) mod catalog;
pub(crate) mod chat;
pub(crate) mod commands;
pub(crate) mod health;
pub(crate) mod matches;
pub(crate) mod metrics;
pub(crate) mod middleware;
pub(crate) mod relay;
pub(crate) mod rooms;
pub(crate) mod snapshot;
pub(crate) mod solo;
pub(crate) mod ws;

fn authorization(headers: &axum::http::HeaderMap) -> &str {
    headers
        .get(axum::http::header::AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .unwrap_or("")
}
