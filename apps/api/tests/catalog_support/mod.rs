#![allow(dead_code)]
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{HeaderMap, Request, StatusCode},
};
use serde_json::Value;
use sqlx::{
    Connection, Executor, PgConnection, PgPool,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use std::{path::PathBuf, str::FromStr};
use touhouflandre_api::{
    app::AppState,
    config::Config,
    database::{self, LegacyAdoption},
    router as server, seed,
};
use tower::ServiceExt;

pub struct Database {
    admin: PgConnection,
    pub pool: PgPool,
    name: String,
}
impl Database {
    pub async fn new() -> Self {
        let url = std::env::var("TEST_DATABASE_URL")
            .expect("TEST_DATABASE_URL must point to disposable local PostgreSQL");
        let options = PgConnectOptions::from_str(&url).unwrap();
        let mut admin = PgConnection::connect_with(&options).await.unwrap();
        let name = format!("rust_catalog_{}", uuid::Uuid::new_v4().simple());
        admin
            .execute(sqlx::AssertSqlSafe(format!("CREATE DATABASE {name}")))
            .await
            .unwrap();
        let pool = PgPoolOptions::new()
            .max_connections(8)
            .connect_with(options.database(&name))
            .await
            .unwrap();
        database::migrate(&pool, LegacyAdoption::Refuse)
            .await
            .unwrap();
        Self { admin, pool, name }
    }
    pub async fn seed(&self) -> String {
        seed::run(&self.pool, &data_dir()).await.unwrap()
    }
    pub fn state(&self) -> AppState {
        AppState::new(
            self.pool.clone(),
            Config::from_values(&Default::default()).unwrap(),
        )
    }
    pub fn app(&self) -> Router {
        server::router(self.state()).unwrap()
    }
    pub async fn close(mut self) {
        self.pool.close().await;
        self.admin
            .execute(sqlx::AssertSqlSafe(format!("DROP DATABASE {}", self.name)))
            .await
            .unwrap();
        self.admin.close().await.unwrap();
    }
}
pub fn data_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../packages/data/src")
}
pub async fn request(
    app: &Router,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, HeaderMap, Value) {
    let mut builder = Request::builder().method(method).uri(path);
    let body = if let Some(body) = body {
        builder = builder.header("content-type", "application/json");
        Body::from(serde_json::to_vec(&body).unwrap())
    } else {
        Body::empty()
    };
    let response = app
        .clone()
        .oneshot(builder.body(body).unwrap())
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let value = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| panic!("non-JSON response: {}", String::from_utf8_lossy(&bytes)))
    };
    (status, headers, value)
}
