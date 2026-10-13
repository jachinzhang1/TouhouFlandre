//! Application error boundary. Causes stay inspectable via `Error::source`;
//! responses and diagnostics never format arbitrary source messages or values.
use axum::{
    Json,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use std::{error::Error, fmt, panic::Location};

use crate::{domain::relay as domain, game::GameError, realtime::outbound::OutputError};

#[derive(Debug, thiserror::Error)]
pub enum ErrorCause {
    #[error("database operation failed")]
    Database(#[from] sqlx::Error),
    #[error("JSON conversion failed")]
    Json(#[from] serde_json::Error),
    #[error("game operation failed")]
    Game(#[from] GameError),
    #[error("relay operation failed")]
    Relay(#[from] domain::Error),
    #[error("realtime output failed")]
    Output(#[from] OutputError),
    #[error("invalid response header")]
    Header(#[from] axum::http::header::InvalidHeaderValue),
    #[error("random source failed")]
    Random(#[from] rand::rngs::SysError),
    #[error("operation timed out")]
    Timeout(#[from] tokio::time::error::Elapsed),
    #[error("background task failed")]
    Task(#[from] tokio::task::JoinError),
    #[error("internal invariant failed: {0}")]
    Invariant(&'static str),
    #[error("request panicked")]
    Panic,
}

/// The existing wire status/code/message plus a server-only typed cause.
#[derive(Debug, thiserror::Error)]
#[error("{code}: {message}")]
pub struct ApiError {
    pub status: StatusCode,
    pub code: &'static str,
    pub message: String,
    #[source]
    cause: Option<ErrorCause>,
    location: &'static Location<'static>,
}

impl ApiError {
    #[track_caller]
    pub fn new(status: StatusCode, code: &'static str, message: impl Into<String>) -> Self {
        Self {
            status,
            code,
            message: message.into(),
            cause: None,
            location: Location::caller(),
        }
    }

    #[track_caller]
    pub fn internal() -> Self {
        Self::invariant("unexpected internal state")
    }

    #[track_caller]
    pub fn invariant(context: &'static str) -> Self {
        Self::from_source(ErrorCause::Invariant(context))
    }

    #[track_caller]
    pub fn from_source(cause: impl Into<ErrorCause>) -> Self {
        Self::new(
            StatusCode::INTERNAL_SERVER_ERROR,
            "INTERNAL",
            "服务器暂时无法处理请求。",
        )
        .with_source(cause)
    }

    #[track_caller]
    pub fn with_source(mut self, cause: impl Into<ErrorCause>) -> Self {
        self.cause = Some(cause.into());
        self.location = Location::caller();
        self
    }

    /// Static operation names only. Never emit Display/Debug for a source:
    /// database errors can contain bound values, and JSON errors can quote input.
    pub fn report(&self, operation: &'static str) {
        tracing::error!(
            operation,
            code = self.code,
            status = self.status.as_u16(),
            error_chain = %SafeErrorChain(self),
            sqlstate = sqlstate(self),
            error_file = self.location.file(),
            error_line = self.location.line(),
            "application operation failed"
        );
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        if self.status.is_server_error() {
            self.report("http_response");
        }
        (
            self.status,
            Json(serde_json::json!({"code": self.code, "error": self.message})),
        )
            .into_response()
    }
}

macro_rules! internal_from {
    ($($source:ty),+ $(,)?) => {$ (
        impl From<$source> for ApiError {
            #[track_caller]
            fn from(source: $source) -> Self { Self::from_source(source) }
        }
    )+ };
}
internal_from!(
    sqlx::Error,
    serde_json::Error,
    GameError,
    OutputError,
    axum::http::header::InvalidHeaderValue,
    rand::rngs::SysError,
    tokio::time::error::Elapsed,
    tokio::task::JoinError
);

struct SafeErrorChain<'a>(&'a (dyn Error + 'static));
impl fmt::Display for SafeErrorChain<'_> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let mut next = Some(self.0);
        // Bound diagnostics even if a custom error implements a cyclic source.
        for index in 0..16 {
            let Some(error) = next else { break };
            if index > 0 {
                f.write_str(" -> ")?;
            }
            f.write_str(safe_kind(error))?;
            next = error.source();
        }
        Ok(())
    }
}

fn safe_kind(error: &(dyn Error + 'static)) -> &'static str {
    if error.is::<ApiError>() {
        return "api";
    }
    if let Some(cause) = error.downcast_ref::<ErrorCause>() {
        return match cause {
            ErrorCause::Database(_) => "database",
            ErrorCause::Json(_) => "json",
            ErrorCause::Game(_) => "game",
            ErrorCause::Relay(_) => "relay",
            ErrorCause::Output(_) => "realtime_output",
            ErrorCause::Header(_) => "response_header",
            ErrorCause::Random(_) => "random_source",
            ErrorCause::Timeout(_) => "timeout",
            ErrorCause::Task(_) => "task",
            ErrorCause::Invariant(context) => context,
            ErrorCause::Panic => "panic",
        };
    }
    if let Some(error) = error.downcast_ref::<sqlx::Error>() {
        return match error {
            sqlx::Error::Database(_) => "sqlx_database",
            sqlx::Error::PoolTimedOut => "sqlx_pool_timeout",
            sqlx::Error::PoolClosed => "sqlx_pool_closed",
            sqlx::Error::RowNotFound => "sqlx_row_not_found",
            sqlx::Error::Io(_) => "sqlx_io",
            sqlx::Error::Tls(_) => "sqlx_tls",
            sqlx::Error::Configuration(_) => "sqlx_configuration",
            sqlx::Error::Protocol(_) => "sqlx_protocol",
            sqlx::Error::ColumnDecode { .. } | sqlx::Error::Decode(_) => "sqlx_decode",
            sqlx::Error::Encode(_) => "sqlx_encode",
            sqlx::Error::ColumnNotFound(_) | sqlx::Error::ColumnIndexOutOfBounds { .. } => {
                "sqlx_column"
            }
            _ => "sqlx_other",
        };
    }
    if let Some(error) = error.downcast_ref::<serde_json::Error>() {
        return match error.classify() {
            serde_json::error::Category::Io => "json_io",
            serde_json::error::Category::Syntax => "json_syntax",
            serde_json::error::Category::Data => "json_data",
            serde_json::error::Category::Eof => "json_eof",
        };
    }
    if let Some(error) = error.downcast_ref::<GameError>() {
        return error.kind();
    }
    if let Some(error) = error.downcast_ref::<domain::Error>() {
        // All relay variants have static messages without user data.
        return match error {
            domain::Error::Invalid => "relay_invalid",
            domain::Error::NotFound => "relay_not_found",
            domain::Error::NotPlayer => "relay_not_player",
            domain::Error::NotYourTurn => "relay_not_your_turn",
            domain::Error::Ended => "relay_ended",
            domain::Error::NotActive => "relay_not_active",
            domain::Error::TurnExpired => "relay_turn_expired",
            domain::Error::InvalidGuess => "relay_invalid_guess",
            domain::Error::DuplicateGuess => "relay_duplicate_guess",
            domain::Error::Idempotency => "relay_idempotency",
            domain::Error::PoolTooSmall => "relay_pool_too_small",
        };
    }
    if let Some(error) = error.downcast_ref::<OutputError>() {
        return match error {
            OutputError::Closed => "output_closed",
            OutputError::SlowConsumer => "output_slow_consumer",
            OutputError::WrongPhase => "output_wrong_phase",
            OutputError::SequenceGap => "output_sequence_gap",
            OutputError::InvalidSequence => "output_invalid_sequence",
        };
    }
    if error.is::<std::io::Error>() {
        return "io";
    }
    if error.is::<tokio::time::error::Elapsed>() {
        return "timeout";
    }
    if let Some(error) = error.downcast_ref::<tokio::task::JoinError>() {
        return if error.is_panic() {
            "task_panic"
        } else {
            "task_cancelled"
        };
    }
    "source"
}

fn sqlstate(error: &(dyn Error + 'static)) -> Option<String> {
    let mut next = Some(error);
    for _ in 0..16 {
        let error = next?;
        if let Some(database) = error
            .downcast_ref::<sqlx::Error>()
            .and_then(sqlx::Error::as_database_error)
        {
            return database
                .code()
                .filter(|code| {
                    code.len() == 5
                        && code
                            .bytes()
                            .all(|b| b.is_ascii_uppercase() || b.is_ascii_digit())
                })
                .map(|code| code.into_owned());
        }
        next = error.source();
    }
    None
}

pub fn invalid(message: &str) -> ApiError {
    ApiError::new(StatusCode::BAD_REQUEST, "INVALID_REQUEST", message)
}

pub fn not_ready(message: &str) -> ApiError {
    ApiError::new(
        StatusCode::SERVICE_UNAVAILABLE,
        "CATALOG_NOT_READY",
        message,
    )
}

pub fn missing_version(version: &str) -> ApiError {
    ApiError::new(
        StatusCode::NOT_FOUND,
        "CATALOG_VERSION_NOT_FOUND",
        format!("没有找到题库版本：{version}"),
    )
}

pub fn room_not_found() -> ApiError {
    ApiError::new(
        StatusCode::NOT_FOUND,
        "ROOM_NOT_FOUND",
        "房间不存在或已关闭。",
    )
}
