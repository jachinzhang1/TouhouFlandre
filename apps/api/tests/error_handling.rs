use std::error::Error;
use touhouflandre_api::error::ApiError;
mod diagnostics_support;
use axum::{
    body::{Body, to_bytes},
    http::{Request, StatusCode},
    response::IntoResponse,
};
use diagnostics_support::{Logs, cause};
use serde_json::json;
use touhouflandre_api::{
    app::AppState,
    config::Config,
    domain::relay as domain,
    game::{CatalogSearchSourceProvider, GameError},
    router::router,
    service::lifecycle,
};
use tower::ServiceExt;
use tracing::instrument::WithSubscriber;

#[test]
fn database_cause_survives_http_conversion() {
    let error = ApiError::from(sqlx::Error::PoolClosed);
    let mut source = error.source();
    while let Some(cause) = source {
        if matches!(
            cause.downcast_ref::<sqlx::Error>(),
            Some(sqlx::Error::PoolClosed)
        ) {
            return;
        }
        source = cause.source();
    }
    panic!("SQLx cause was discarded at the HTTP boundary");
}

#[tokio::test]
async fn guessing_cause_survives_adaptation_without_logging_character_ids() {
    let source = touhouflandre_core::Error::DuplicateCharacterId("private-character-id".into());
    let error = ApiError::from(source.clone());
    assert_eq!(cause::<touhouflandre_core::Error>(&error), Some(&source));
    assert!(matches!(
        cause::<GameError>(&error),
        Some(GameError::Guessing(_))
    ));
    let logs = Logs::default();
    let response = tracing::subscriber::with_default(logs.subscriber(), || error.into_response());
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        json!({"code":"INTERNAL","error":"服务器暂时无法处理请求。"})
    );
    assert!(logs.text().contains("guessing -> duplicate_character_id"));
    assert!(!logs.text().contains("private-character-id"));
}

#[tokio::test]
async fn system_random_failure_retains_cause_and_generic_http_response() {
    let error = ApiError::from(rand::rngs::SysError::UNSUPPORTED);
    assert_eq!(
        cause::<rand::rngs::SysError>(&error),
        Some(&rand::rngs::SysError::UNSUPPORTED)
    );
    let logs = Logs::default();
    let response = tracing::subscriber::with_default(logs.subscriber(), || error.into_response());
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        json!({"code":"INTERNAL","error":"服务器暂时无法处理请求。"})
    );
    assert!(logs.text().contains("random_source"));
    assert!(
        !logs
            .text()
            .contains(&rand::rngs::SysError::UNSUPPORTED.to_string())
    );
}

#[tokio::test]
async fn nested_catalog_causes_survive_shared_loads_and_retries() {
    let provider = CatalogSearchSourceProvider::new(|_| async {
        Err(GameError::catalog_source(sqlx::Error::PoolTimedOut))
    });
    for _ in 0..2 {
        let (first, second) = tokio::join!(provider.get("v1"), provider.get("v1"));
        for result in [first, second] {
            let error = ApiError::from(result.unwrap_err());
            assert!(matches!(
                cause::<sqlx::Error>(&error),
                Some(sqlx::Error::PoolTimedOut)
            ));
        }
    }
}

#[tokio::test]
async fn json_and_database_values_are_redacted_from_responses_and_logs() {
    let secret = "guest-token-do-not-log";
    let source = serde_json::from_value::<u32>(json!(secret)).unwrap_err();
    assert!(source.to_string().contains(secret));
    let logs = Logs::default();
    let line = line!() + 1;
    let error = ApiError::from(source);
    assert!(cause::<serde_json::Error>(&error).is_some());
    let response = tracing::subscriber::with_default(logs.subscriber(), || error.into_response());
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        json!({"code":"INTERNAL","error":"服务器暂时无法处理请求。"})
    );
    let events = logs.events();
    assert_eq!(
        events[0]["fields"]["error_chain"],
        "api -> json -> json_data"
    );
    assert_eq!(events[0]["fields"]["error_file"], file!());
    assert_eq!(events[0]["fields"]["error_line"], line);
    let error = ApiError::from(sqlx::Error::Protocol(format!("query: SELECT '{secret}'")));
    tracing::subscriber::with_default(logs.subscriber(), || error.into_response());
    assert!(!logs.text().contains(secret));
    assert!(!logs.text().contains("SELECT"));
    assert!(logs.text().contains("sqlx_protocol"));
}

#[tokio::test]
async fn relay_business_mapping_retains_typed_cause_without_server_error_log() {
    let error = ApiError::from(domain::Error::NotYourTurn);
    assert_eq!(
        cause::<domain::Error>(&error),
        Some(&domain::Error::NotYourTurn)
    );
    let logs = Logs::default();
    let response = tracing::subscriber::with_default(logs.subscriber(), || error.into_response());
    assert_eq!(response.status(), StatusCode::CONFLICT);
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        json!({"code":"NOT_YOUR_TURN","error":"还没轮到你提交猜测。"})
    );
    assert!(logs.text().is_empty());
}

async fn closed_pool_state() -> AppState {
    let pool = sqlx::postgres::PgPoolOptions::new()
        .connect_lazy("postgres://test:test@127.0.0.1:1/test")
        .unwrap();
    pool.close().await;
    AppState::new(pool, Config::from_values(&Default::default()).unwrap())
}

#[tokio::test]
async fn http_diagnostics_include_route_template_and_database_cause() {
    let app = router(closed_pool_state().await).unwrap();
    let logs = Logs::default();
    let response = app
        .oneshot(
            Request::builder()
                .uri("/api/rooms/private-room-id/snapshot?token=private-query-token")
                .header("authorization", "Bearer guest:private-header-token")
                .body(Body::empty())
                .unwrap(),
        )
        .with_subscriber(logs.subscriber())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let events = logs.events();
    let failure = events
        .iter()
        .find(|v| v["fields"]["operation"] == "http_response")
        .unwrap();
    assert_eq!(
        failure["fields"]["error_chain"],
        "api -> database -> sqlx_pool_closed"
    );
    assert_eq!(failure["span"]["route"], "/api/rooms/{room_id}/snapshot");
    assert_eq!(failure["span"]["method"], "GET");
    assert!(
        failure["fields"]["error_file"]
            .as_str()
            .unwrap()
            .ends_with("multi/auth.rs")
    );
    for secret in [
        "private-room-id",
        "private-query-token",
        "private-header-token",
    ] {
        assert!(!logs.text().contains(secret));
    }
}

#[tokio::test]
async fn sweeper_reports_each_failure_and_returns_the_original_cause() {
    let state = closed_pool_state().await;
    let logs = Logs::default();
    let error = lifecycle::sweep_once(&state)
        .with_subscriber(logs.subscriber())
        .await
        .unwrap_err();
    assert!(matches!(
        cause::<sqlx::Error>(&error),
        Some(sqlx::Error::PoolClosed)
    ));
    let events = logs.events();
    for operation in [
        "sweep_relay",
        "sweep_race_list",
        "expire_members",
        "expire_rooms",
        "prune_chat",
        "prune_rooms",
    ] {
        assert!(
            events.iter().any(|v| v["fields"]["operation"] == operation
                && v["fields"]["error_chain"] == "api -> database -> sqlx_pool_closed"),
            "missing {operation}"
        );
    }
}

#[tokio::test]
async fn readiness_keeps_wire_message_and_reports_cause() {
    let logs = Logs::default();
    let response = router(closed_pool_state().await)
        .unwrap()
        .oneshot(
            Request::builder()
                .uri("/readyz")
                .body(Body::empty())
                .unwrap(),
        )
        .with_subscriber(logs.subscriber())
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::SERVICE_UNAVAILABLE);
    let body = to_bytes(response.into_body(), 4096).await.unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        json!({"error":"database unavailable"})
    );
    assert!(logs.text().contains("sqlx_pool_closed"));
    assert!(logs.text().contains("readiness"));
}
