//! All HTTP endpoints are registered here; each target lives in handler/.
use crate::{
    app::AppState,
    error::ApiError,
    handler::{
        catalog, chat, commands, health, matches, metrics, relay, rooms, snapshot, solo, ws,
    },
};
use axum::{
    Router, middleware,
    response::IntoResponse,
    routing::{get, patch, post},
};
use tower_http::catch_panic::CatchPanicLayer;
pub fn router(state: AppState) -> anyhow::Result<Router> {
    let cors = crate::handler::middleware::cors(&state.config)?;
    Ok(Router::new()
        // Single-player puzzles and sessions.
        .route("/api/puzzles/{mode}", post(solo::create))
        .route("/api/puzzles/{mode}/resolve", post(solo::resolve))
        .route("/api/sessions/{sessionId}", get(solo::get_session))
        .route("/api/sessions/{sessionId}/guess", post(solo::guess))
        .route("/api/sessions/{sessionId}/timeout", post(solo::timeout))
        .route("/api/sessions/{sessionId}/forfeit", post(solo::forfeit))
        // Room membership, round actions and snapshots.
        .route("/api/rooms", post(rooms::create))
        .route(
            "/api/rooms/{room_id}",
            get(rooms::info).delete(rooms::close),
        )
        .route("/api/rooms/{room_id}/join", post(rooms::join))
        .route("/api/rooms/{room_id}/ready", post(rooms::ready))
        .route("/api/rooms/{room_id}/settings", patch(rooms::settings))
        .route("/api/rooms/{room_id}/claim-seat", post(rooms::claim))
        .route("/api/rooms/{room_id}/leave", post(rooms::leave))
        .route(
            "/api/rooms/{room_id}/rounds/{round_index}/guess",
            post(commands::guess),
        )
        .route(
            "/api/rooms/{room_id}/rounds/{round_index}/forfeit",
            post(commands::forfeit),
        )
        .route(
            "/api/rooms/{room_id}/rounds/{round_index}/pass",
            post(commands::pass),
        )
        .route("/api/rooms/{room_id}/rematch", post(matches::rematch))
        .route("/api/rooms/{room_id}/snapshot", get(snapshot::snapshot))
        // Catalog and search.
        .route("/api/site/visits", post(catalog::site_visits))
        .route("/api/characters/search", get(catalog::search))
        .route("/api/catalog", get(catalog::summary))
        .route("/api/catalog/characters", get(catalog::legacy_characters))
        .route("/api/catalog/full", get(catalog::full))
        .route("/api/catalog/search-policy", get(catalog::policy))
        .route(
            "/api/catalog/{catalogVersion}/search-index/{indexSchemaVersion}",
            get(catalog::index),
        )
        .route(
            "/api/rooms/{room_id}/messages",
            get(chat::list).post(chat::send),
        )
        .route(
            "/api/rooms/{room_id}/stages/{stage_index}/encounters/{encounter_id}/actions",
            post(relay::action),
        )
        .route(
            "/api/rooms/{room_id}/matches/{match_index}/stages",
            get(relay::history),
        )
        .route("/api/rooms/{room_id}/ws", get(ws::upgrade))
        // Operational endpoints.
        .route("/api/health", get(health::health))
        .route("/livez", get(health::live))
        .route("/readyz", get(health::ready))
        .route("/metrics", get(metrics::endpoint))
        .fallback(health::not_found)
        .method_not_allowed_fallback(health::method_not_allowed)
        .with_state(state)
        .layer(cors)
        .layer(CatchPanicLayer::custom(|_| {
            ApiError::from_source(crate::error::ErrorCause::Panic).into_response()
        }))
        .layer(middleware::from_fn(crate::handler::middleware::request_log)))
}
#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::Config;
    use axum::body::Body;
    use axum::body::to_bytes;
    use axum::http::Request;
    use axum::http::{StatusCode, header};
    use serde_json::json;
    use tower::ServiceExt;

    fn app() -> Router {
        router(AppState::new(
            sqlx::postgres::PgPoolOptions::new()
                .connect_lazy("postgres://test:test@127.0.0.1:1/test")
                .unwrap(),
            Config::from_values(&Default::default()).unwrap(),
        ))
        .unwrap()
    }

    #[tokio::test]
    async fn extraction_errors_keep_authentication_and_mode_validation_precedence() {
        for (path, content_type, body, status, message) in [
            (
                "/api/rooms/example/ready",
                "application/json",
                "{",
                StatusCode::UNAUTHORIZED,
                "缺少令牌。",
            ),
            (
                "/api/puzzles/unsupported",
                "application/json",
                "{",
                StatusCode::BAD_REQUEST,
                "不支持的模式。",
            ),
            (
                "/api/puzzles/random",
                "text/plain",
                "{}",
                StatusCode::UNSUPPORTED_MEDIA_TYPE,
                "请求内容类型必须是 application/json。",
            ),
        ] {
            let response = app()
                .oneshot(
                    Request::builder()
                        .method("POST")
                        .uri(path)
                        .header(header::CONTENT_TYPE, content_type)
                        .body(Body::from(body))
                        .unwrap(),
                )
                .await
                .unwrap();
            assert_eq!(response.status(), status, "{path}");
            let body = to_bytes(response.into_body(), 4096).await.unwrap();
            let value: serde_json::Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(value["error"], message, "{path}");
        }
    }

    #[tokio::test]
    async fn metrics_handler_keeps_content_type_and_cache_headers_when_database_is_down() {
        let state = AppState::new(
            sqlx::postgres::PgPoolOptions::new()
                .connect_lazy("postgres://test:test@127.0.0.1:1/test")
                .unwrap(),
            Config::from_values(&Default::default()).unwrap(),
        );
        state.pool.close().await;
        let response = router(state)
            .unwrap()
            .oneshot(
                Request::builder()
                    .uri("/metrics")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        assert_eq!(
            response.headers()[header::CONTENT_TYPE],
            "text/plain; version=0.0.4; charset=utf-8"
        );
        assert_eq!(response.headers()[header::CACHE_CONTROL], "no-store");
        let body = to_bytes(response.into_body(), 1024 * 1024).await.unwrap();
        assert!(
            std::str::from_utf8(&body)
                .unwrap()
                .contains("touhouflandre_multi_ws_connections 0")
        );
    }

    #[tokio::test]
    async fn health_and_public_error_shape() {
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/api/health")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::OK);
        let value: serde_json::Value =
            serde_json::from_slice(&to_bytes(response.into_body(), 1024).await.unwrap()).unwrap();
        assert_eq!(value, json!({"ok":true, "service":"touhouflandre-api"}));
        let response = app()
            .oneshot(
                Request::builder()
                    .uri("/missing?token=must-not-leak")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        let bytes = to_bytes(response.into_body(), 1024).await.unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
            json!({"code":"INVALID_REQUEST", "error":"Not Found"})
        );
        let response = app()
            .oneshot(
                Request::builder()
                    .method("POST")
                    .uri("/api/rooms/room/rounds/not-an-integer/guess")
                    .body(Body::empty())
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let bytes = to_bytes(response.into_body(), 1024).await.unwrap();
        assert_eq!(
            serde_json::from_slice::<serde_json::Value>(&bytes).unwrap()["code"],
            "INVALID_REQUEST"
        );
    }
}
