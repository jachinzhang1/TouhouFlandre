mod diagnostics_support;
mod support;
use axum::{body::to_bytes, http::StatusCode, response::IntoResponse};
use diagnostics_support::{Logs, cause};
use serde_json::json;
use touhouflandre_api::{error::ApiError, game::GameError};

#[tokio::test]
async fn postgres_details_stay_in_source_and_only_sqlstate_reaches_logs() -> anyhow::Result<()> {
    let db = support::Database::new().await?;
    let source = sqlx::query("DO $$ BEGIN RAISE EXCEPTION USING ERRCODE = 'P0001', MESSAGE = 'guest-token-private', DETAIL = 'answer-private', HINT = 'postgres://user:private@host/db'; END $$")
        .execute(&db.pool).await.unwrap_err();
    let error = ApiError::from(source);
    let pg = cause::<sqlx::Error>(&error)
        .unwrap()
        .as_database_error()
        .unwrap();
    assert_eq!(pg.code().as_deref(), Some("P0001"));
    assert_eq!(pg.message(), "guest-token-private");
    let logs = Logs::default();
    let response = tracing::subscriber::with_default(logs.subscriber(), || error.into_response());
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    let body = to_bytes(response.into_body(), 4096).await?;
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body)?,
        json!({"code":"INTERNAL","error":"服务器暂时无法处理请求。"})
    );
    assert_eq!(logs.events()[0]["fields"]["sqlstate"], "P0001");
    assert!(logs.text().contains("sqlx_database"));
    for secret in [
        "guest-token-private",
        "answer-private",
        "postgres://",
        "SELECT",
        "RAISE",
    ] {
        assert!(!logs.text().contains(secret), "diagnostics leaked {secret}");
    }
    db.close().await
}

#[tokio::test]
async fn catalog_missing_and_corrupt_snapshot_keep_distinct_typed_causes() -> anyhow::Result<()> {
    let db = support::Database::new().await?;
    let state = db.state();
    let missing = state.catalog.characters("missing", true).await.unwrap_err();
    assert_eq!(missing.status, StatusCode::NOT_FOUND);
    assert_eq!(missing.code, "CATALOG_VERSION_NOT_FOUND");
    assert!(matches!(
        cause::<GameError>(&missing),
        Some(GameError::CatalogSnapshotMissing)
    ));
    let not_ready = state
        .catalog
        .characters("missing", false)
        .await
        .unwrap_err();
    assert_eq!(not_ready.status, StatusCode::SERVICE_UNAVAILABLE);
    assert_eq!(not_ready.code, "CATALOG_NOT_READY");

    sqlx::query("INSERT INTO catalog_snapshot(version,characters) VALUES('corrupt',$1)")
        .bind(json!("private-snapshot-content"))
        .execute(&db.pool)
        .await?;
    let error = state.catalog.characters("corrupt", true).await.unwrap_err();
    assert!(matches!(
        cause::<GameError>(&error),
        Some(GameError::InvalidCatalogSnapshot(_))
    ));
    assert!(
        cause::<serde_json::Error>(&error)
            .unwrap()
            .to_string()
            .contains("private-snapshot-content")
    );
    let logs = Logs::default();
    let response = tracing::subscriber::with_default(logs.subscriber(), || error.into_response());
    assert_eq!(response.status(), StatusCode::INTERNAL_SERVER_ERROR);
    assert!(logs.text().contains("invalid_catalog_snapshot"));
    assert!(logs.text().contains("json_data"));
    assert!(!logs.text().contains("private-snapshot-content"));
    // A failed cached load must remain retryable after the underlying data is repaired.
    sqlx::query("UPDATE catalog_snapshot SET characters='[]'::jsonb WHERE version='corrupt'")
        .execute(&db.pool)
        .await?;
    assert!(state.catalog.characters("corrupt", true).await?.is_empty());
    db.close().await
}
