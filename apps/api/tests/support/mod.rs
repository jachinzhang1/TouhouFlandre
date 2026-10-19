#![allow(dead_code)]
use anyhow::Result;
use axum::{
    Router,
    body::{Body, to_bytes},
    http::{Request, StatusCode},
};
use serde_json::{Value, json};
use sqlx::{
    Connection, Executor, PgConnection, PgPool,
    postgres::{PgConnectOptions, PgPoolOptions},
};
use std::{collections::HashMap, str::FromStr};
use touhouflandre_api::{
    app::AppState,
    config::Config,
    database::{self, LegacyAdoption},
    router::router,
    service::multi,
};
use tower::ServiceExt;

pub struct Database {
    admin: PgConnection,
    pub pool: PgPool,
    name: String,
}
impl Database {
    pub async fn new() -> Result<Self> {
        let url = std::env::var("TEST_DATABASE_URL")
            .expect("TEST_DATABASE_URL required for isolated integration tests");
        let options = PgConnectOptions::from_str(&url)?;
        let mut admin = PgConnection::connect_with(&options).await?;
        let name = format!("rust_behavior_{}", uuid::Uuid::new_v4().simple());
        admin
            .execute(sqlx::AssertSqlSafe(format!("CREATE DATABASE {name}")))
            .await?;
        let pool = PgPoolOptions::new()
            .max_connections(12)
            .connect_with(options.database(&name))
            .await?;
        database::migrate(&pool, LegacyAdoption::Refuse).await?;
        Ok(Self { admin, pool, name })
    }
    pub fn state(&self) -> AppState {
        let values = HashMap::from([("MULTI_CHAT_SEND_ENABLED".into(), "true".into())]);
        AppState::new(self.pool.clone(), Config::from_values(&values).unwrap())
    }
    pub async fn close(mut self) -> Result<()> {
        self.pool.close().await;
        self.admin
            .execute(sqlx::AssertSqlSafe(format!("DROP DATABASE {}", self.name)))
            .await?;
        self.admin.close().await?;
        Ok(())
    }
    pub async fn room(&self) -> Result<(String, String, String, String, String)> {
        let id = multi::new_id();
        let player = multi::new_id();
        let spectator = multi::new_id();
        let token = "test-player-token".to_string();
        let spectator_token = "test-spectator-token".to_string();
        sqlx::query("INSERT INTO multi_room(id,code,format,status,expires_at,mode) VALUES($1,'ABCDEF','bo1','lobby',now()+interval '1 hour','race')").bind(&id).execute(&self.pool).await?;
        for (member, role, seat, token) in [
            (&player, "player", Some(1), &token),
            (&spectator, "spectator", None, &spectator_token),
        ] {
            sqlx::query("INSERT INTO multi_member(id,room_id,seat,display_name,token_hash,role) VALUES($1,$2,$3,'测试',$4,$5)").bind(member).bind(&id).bind(seat).bind(multi::auth::hash_token(token)).bind(role).execute(&self.pool).await?;
        }
        Ok((id, player, token, spectator, spectator_token))
    }
}
pub async fn request(
    app: &Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Option<Value>,
) -> (StatusCode, Value, axum::http::HeaderMap) {
    let mut builder = Request::builder().method(method).uri(path);
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer guest:{token}"));
    }
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    let response = app
        .clone()
        .oneshot(
            builder
                .body(
                    body.map(|v| Body::from(v.to_string()))
                        .unwrap_or_else(Body::empty),
                )
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let bytes = to_bytes(response.into_body(), 4 * 1024 * 1024)
        .await
        .unwrap();
    let value = serde_json::from_slice(&bytes)
        .unwrap_or_else(|_| json!({"raw":String::from_utf8_lossy(&bytes)}));
    (status, value, headers)
}
pub fn app(state: AppState) -> Router {
    router(state).unwrap()
}
