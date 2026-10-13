use crate::{app::AppState, error::ApiError};
use std::time::Duration;
pub async fn check(state: &AppState) -> Result<(), (&'static str, ApiError)> {
    let result = tokio::time::timeout(Duration::from_secs(3), async {
        sqlx::query_scalar!(
            r#"
            SELECT 1 AS "alive!"
            "#,
        )
            .fetch_one(&state.pool)
            .await
            .map_err(|source| ("database unavailable", ApiError::from(source)))?;
        let snapshot = sqlx::query_scalar!(
            r#"
            SELECT s.characters FROM catalog_state c JOIN catalog_snapshot s ON s.version = c.current_version
            WHERE c.id = 'current'
            "#,
        )
            .fetch_one(&state.pool)
            .await
            .map_err(|source| ("catalog search unavailable", ApiError::from(source)))?;
        serde_json::from_value::<Vec<crate::game::Character>>(snapshot)
            .map_err(|source| ("catalog search unavailable", ApiError::from(source)))?;
        Ok::<_, (&str, ApiError)>(())
    })
    .await;
    match result {
        Ok(result) => result,
        Err(source) => Err(("database unavailable", ApiError::from(source))),
    }
}
