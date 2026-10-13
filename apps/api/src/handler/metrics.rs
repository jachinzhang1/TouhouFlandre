use crate::{app::AppState, service::metrics};
use axum::{extract::State, http::header, response::IntoResponse};
pub(crate) async fn endpoint(State(state): State<AppState>) -> impl IntoResponse {
    (
        [
            (
                header::CONTENT_TYPE,
                "text/plain; version=0.0.4; charset=utf-8",
            ),
            (header::CACHE_CONTROL, "no-store"),
        ],
        metrics::collect(&state).await,
    )
}
