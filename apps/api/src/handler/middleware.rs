use crate::error::ApiError;
use axum::{
    extract::{MatchedPath, Request},
    http::header,
    middleware::Next,
    response::{IntoResponse, Response},
};
use std::time::Instant;
use tracing::Instrument;
pub(crate) async fn request_log(request: Request, next: Next) -> Response {
    let started = Instant::now();
    let method = request.method().clone();
    let route = request
        .extensions()
        .get::<MatchedPath>()
        .map(MatchedPath::as_str)
        .unwrap_or("unmatched")
        .to_owned();
    let mut response = next
        .run(request)
        .instrument(tracing::info_span!("http_request", %method, %route))
        .await;
    // Axum path/query rejections must use the same public JSON error envelope.
    if response.status().is_client_error()
        && !response
            .headers()
            .get(header::CONTENT_TYPE)
            .and_then(|value| value.to_str().ok())
            .is_some_and(|value| value.starts_with("application/json"))
    {
        response =
            ApiError::new(response.status(), "INVALID_REQUEST", "请求参数不合法。").into_response();
    }
    // Route templates only: never raw URL/query/body, guest token or room identifiers.
    tracing::info!(%method, %route, status = response.status().as_u16(), latency_ms = started.elapsed().as_millis() as u64, "request");
    response
}

pub(crate) fn cors(config: &crate::config::Config) -> anyhow::Result<tower_http::cors::CorsLayer> {
    use axum::http::{HeaderValue, Method};
    use tower_http::cors::{Any, CorsLayer};
    let origins = config
        .web_origins
        .iter()
        .map(|origin| origin.parse::<HeaderValue>())
        .collect::<Result<Vec<_>, _>>()?;
    let cors = if config.web_origins.iter().any(|origin| origin == "*") {
        CorsLayer::new().allow_origin(Any)
    } else {
        CorsLayer::new().allow_origin(origins)
    }
    .allow_methods([
        Method::GET,
        Method::POST,
        Method::PUT,
        Method::PATCH,
        Method::DELETE,
        Method::HEAD,
        Method::OPTIONS,
    ])
    .allow_headers([
        header::ORIGIN,
        header::CONTENT_TYPE,
        header::ACCEPT,
        header::AUTHORIZATION,
        header::HeaderName::from_static("x-character-search-fallback-reason"),
    ])
    .expose_headers([header::ETAG, header::CACHE_CONTROL]);
    Ok(cors)
}
