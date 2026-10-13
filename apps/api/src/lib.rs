//! Rust backend with explicit HTTP, application and storage boundaries.
pub mod app;
pub mod config;
pub mod contracts;
pub mod database;
pub mod domain;
pub mod error;
pub mod game;
pub(crate) mod handler;
pub mod metrics;
pub mod realtime;
pub mod repository;
pub mod router;
pub mod seed;
pub mod service;
