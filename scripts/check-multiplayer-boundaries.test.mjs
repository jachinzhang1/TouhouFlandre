import test from "node:test";
import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import { checkGuessingManifest, checkRustFile } from "./check-multiplayer-boundaries.mjs";

const rejected = (file, text) => assert.ok(checkRustFile(file, text).length > 0);
const accepted = (file, text) => assert.deepEqual(checkRustFile(file, text), []);
const coreManifest = (text) => checkGuessingManifest("crates/touhouflandre-core/Cargo.toml", text);

test("guessing core rejects application and runtime imports, including tests and examples", () => {
  rejected("crates/touhouflandre-core/src/lib.rs", "use touhouflandre_api::{game::Character, app::AppState};");
  rejected("crates/touhouflandre-core/src/attempt.rs", "use tokio::sync::Mutex;");
  rejected("crates/touhouflandre-core/tests/attempt.rs", "use sqlx as storage;");
  rejected("crates/touhouflandre-core/examples/guess.rs", "fn main() { reqwest::get(); }");
  rejected("crates/touhouflandre-core/build.rs", "use axum::{http::StatusCode, Json};");
  accepted("crates/touhouflandre-core/src/lib.rs", "use crate::{error::GuessError, fields::FieldRule}; use std::collections::{HashMap, HashSet}; use thiserror::Error; use serde::{Serialize, Deserialize};");
});
test("guessing core receives external inputs rather than performing standard library I/O", () => {
  rejected("crates/touhouflandre-core/src/catalog.rs", "use std::{collections::HashMap, fs};");
  rejected("crates/touhouflandre-core/src/attempt.rs", "use std as system; fn f() { system::env::var(); }");
  rejected("crates/touhouflandre-core/src/attempt.rs", "use std::time::{Duration, SystemTime};");
  rejected("crates/touhouflandre-core/src/attempt.rs", "fn f() { std::thread::spawn(); }");
  accepted("crates/touhouflandre-core/src/attempt.rs", 'use std::{time::Duration, sync::Arc}; // use std::net::TcpStream;\nconst EXAMPLE: &str = "std::fs::read";');
});
test("guessing core manifest allows only explicit thiserror and optional serde", () => {
  assert.deepEqual(coreManifest(`[package]
name = "touhouflandre-core"

[dependencies]
thiserror = "2" # typed rule errors
serde = { version = "1", optional = true, features = ["derive"] }
`), []);
  assert.deepEqual(coreManifest(`[dependencies.thiserror]
version = "2"
[dependencies.serde]
version = '1'
optional = true
features = ["derive"]
`), []);
  assert.ok(coreManifest('[dependencies]\nserde = "1"').length > 0);
});
test("guessing core rejects runtime dependencies in normal, development, build and target sections", () => {
  for (const section of ["dependencies", "dev-dependencies", "build-dependencies", "target.'cfg(unix)'.dependencies"]) {
    for (const dependency of ["sqlx", "tokio"]) {
      assert.ok(coreManifest(`[${section}]\n${dependency} = "1"`).length > 0, `${section}: ${dependency}`);
      assert.ok(coreManifest(`[${section}.${dependency}]\nversion = "1"`).length > 0, `${section}.${dependency}`);
    }
  }
});
test("guessing core permits JSON only as a test dependency for optional serialization", () => {
  assert.deepEqual(coreManifest('[dev-dependencies]\nserde_json = "1"'), []);
  assert.deepEqual(coreManifest('[dev-dependencies.serde_json]\nversion = "1"'), []);
  for (const section of ["dependencies", "build-dependencies", "target.'cfg(unix)'.dependencies"]) {
    assert.ok(coreManifest(`[${section}]\nserde_json = "1"`).length > 0, section);
  }
});
test("guessing core rejects app paths, package aliases and hidden dependency sources", () => {
  for (const manifest of [
    '[dependencies]\ntouhouflandre-api = { path = "../../apps/api" }',
    '[dependencies]\nserde = { package = "sqlx", version = "0.9", optional = true }',
    '[dependencies.serde]\npackage = "tokio"\nversion = "1"\noptional = true',
    '[dependencies.thiserror]\npath = "../../apps/api"',
    '[dependencies]\nthiserror = { workspace = true }',
    '[dependencies]\nthiserror = { git = "https://example.invalid/custom-error" }',
    '[dev-dependencies]\nserde_json = { package = "sqlx", version = "0.9" }',
    '[dev-dependencies]\nserde_json = { path = "../../apps/api" }',
  ]) assert.ok(coreManifest(manifest).length > 0, manifest);
});
test("guessing core manifest ignores unrelated metadata and dependency-like comments", () => {
  assert.deepEqual(coreManifest(`[package.metadata.example]
tokio = "example documentation"
path = "../../apps/api"
# [dependencies]
# sqlx = "0.9"
[dependencies]
thiserror = '2'
`), []);
});

test("pure game rejects direct, grouped and aliased I/O imports", () => {
  rejected("game/search.rs", "use sqlx::PgPool;");
  rejected("game/search.rs", "use crate::{game::Character, app::AppState};");
  rejected("game/search.rs", "use axum as transport;");
  rejected("game/search.rs", "fn f() { sqlx::query(); }");
  accepted("game/cache.rs", "use tokio::sync::{watch, Mutex}; use super::GameError;");
});
test("realtime transport remains independent of application state", () => {
  rejected("realtime/protocol.rs", "use crate::service::multi::{models::Room, store};");
  rejected("realtime/transport.rs", "use super::super::app::AppState;");
  accepted("realtime/transport.rs", "use axum::extract::ws::WebSocket;");
});
test("relative grouped mode dependencies cannot bypass shared boundaries", () => {
  rejected("repository/multi.rs", "use crate::{repository::models::Room, service::multi::relay::views};");
  rejected("service/multi/race/service.rs", "use super::super::relay as other;");
  rejected("service/multi/race/service.rs", "use crate::service::multi as shared; fn f() { shared::relay::run(); }");
  rejected("service/multi/race/service.rs", "use crate as app; fn f() { app::service::multi::relay::run(); }");
  rejected("service/multi/race.rs", "use super::*;");
  rejected("domain/relay.rs", "use crate::service::multi::race::domain::Points;");
  accepted("service/multi/matches.rs", "use super::{race, relay, store};");
});
test("domain code cannot call adapters or SQL", () => {
  rejected("domain/relay.rs", "use crate::repository::relay::Stage;");
  rejected("domain/relay.rs", "use sqlx::{FromRow, query};");
  rejected("domain/relay.rs", "fn f() { crate::error::ApiError::internal(); }");
  accepted("domain/relay.rs", "#[derive(sqlx::FromRow)] struct Player {} use chrono::Utc;");
});
test("comments, raw strings, strings and characters are not dependencies", () => {
  accepted("game/search.rs", String.raw`// use axum::Router;
/* use sqlx::PgPool; /* nested */ */
const EXAMPLE: &str = r##"use crate::{multi::relay, server::ApiError};"##;
const MORE: &str = "sqlx::query(\"quoted\")";
const QUOTE: char = '\'';
fn legitimate<'a>(v: &'a str) { let _ = v; }
use std::{collections::HashSet, sync::Arc};`);
});

test("handlers cannot query storage or borrow the database pool", () => {
  rejected("handler/rooms.rs", "use sqlx::{PgPool, query};");
  rejected("handler/rooms.rs", "use crate::repository::{multi as rooms, models::Room};");
  rejected("handler/rooms.rs", "async fn create(state: AppState) { state.pool.begin().await; }");
  accepted("handler/rooms.rs", "use crate::service::multi::rooms; use axum::{Json, extract::State};");
});
test("application services cannot depend on HTTP adapters or response types", () => {
  rejected("service/solo.rs", "use crate::handler::solo;");
  rejected("service/solo.rs", "use axum::{extract::State, response::IntoResponse};");
  rejected("service/solo.rs", "use crate::router as wire; fn f() { wire::router(); }");
  accepted("service/solo.rs", "use sqlx::PgConnection; use crate::{repository::solo, game::Character};");
});
test("repositories and domains cannot import application state", () => {
  rejected("repository/solo.rs", "use crate::{service::solo, app::AppState};");
  rejected("domain/chat.rs", "use crate::repository::chat::Message;");
  rejected("domain/relay.rs", "use crate::service::multi::relay::coordinator;");
  accepted("repository/solo.rs", "use sqlx::{PgConnection, FromRow}; use crate::game::Character;");
});
test("route registration has one source", () => {
  rejected("service/chat.rs", "use axum::routing::get;");
  rejected("handler/chat.rs", "use axum::Router;");
  rejected("router.rs", "use crate::service::chat;");
  accepted("router.rs", "use axum::{Router, routing::get}; use crate::handler::chat;");
});
test("central routes cover every frozen operation and point to concrete handlers", () => {
  const read = (path) => readFileSync(new URL(`../apps/api/src/${path}`, import.meta.url), "utf8");
  const normalized = (method, path) => `${method.toUpperCase()} ${path.replace(/\{[^}]+\}/g, "{}")}`;
  const expected = new Set(JSON.parse(read("contracts/operations.json")).map((op) => normalized(op.method, op.path)));
  for (const path of ["/livez", "/readyz", "/metrics", "/api/rooms/{room_id}/ws"]) expected.add(normalized("GET", path));
  const actual = new Set();
  for (const match of read("router.rs").matchAll(/\.route\(\s*"([^"]+)"\s*,([\s\S]*?)(?=\n\s*\.(?:route|fallback)\()/g)) {
    const calls = [...match[2].matchAll(/\b(get|post|patch|put|delete)\((\w+)::(\w+)\)/g)];
    assert.ok(calls.length, `missing handler: ${match[1]}`);
    for (const [,method,module,name] of calls) {
      const key = normalized(method, match[1]);
      assert.ok(!actual.has(key), `duplicate route: ${key}`);
      actual.add(key);
      assert.match(read(`handler/${module}.rs`), new RegExp(`pub\\(crate\\) async fn ${name}\\b`));
    }
  }
  assert.deepEqual([...actual].sort(), [...expected].sort());
});
