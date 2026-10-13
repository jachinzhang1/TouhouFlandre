use crate::config::Config;
use sqlx::PgPool;
use std::sync::Arc;
#[derive(Clone)]
pub struct AppState {
    pub pool: PgPool,
    pub config: Arc<Config>,
    pub catalog: Arc<crate::service::catalog::CatalogService>,
    pub clock: Arc<dyn Fn() -> chrono::DateTime<chrono::Utc> + Send + Sync>,
    pub random_index: Arc<dyn Fn(usize) -> usize + Send + Sync>,
    pub realtime: Arc<crate::service::ws::RealtimeHub>,
}

impl AppState {
    pub fn new(pool: PgPool, config: Config) -> Self {
        Self {
            catalog: Arc::new(crate::service::catalog::CatalogService::new(pool.clone())),
            pool,
            config: Arc::new(config),
            clock: Arc::new(chrono::Utc::now),
            random_index: Arc::new(|upper| rand::random_range(0..upper)),
            realtime: Arc::new(crate::service::ws::RealtimeHub::default()),
        }
    }
}
