use tokio_util::sync::CancellationToken;
use touhouflandre_api::{
    app::AppState,
    config::Config,
    database,
    error::ApiError,
    router::router,
    service::{lifecycle, ws},
};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::from_env()?;
    tracing_subscriber::fmt()
        .json()
        .with_env_filter(config.log_level.clone())
        .init();
    let pool = database::connect(&config.database_url).await?;
    let port = config.port;
    let state = AppState::new(pool.clone(), config);
    // Startup explicitly ends persisted active matches. Migrations remain a separate command.
    lifecycle::terminate_active(&state)
        .await
        .inspect_err(|error| error.report("startup_recovery"))?;
    ws::start(state.clone());
    let sweep_stop = CancellationToken::new();
    let sweep = lifecycle::start(state.clone(), sweep_stop.clone());
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", port)).await?;
    let http_stop = CancellationToken::new();
    let app = router(state.clone())?;
    let stop = http_stop.clone();
    let mut server = tokio::spawn(async move {
        axum::serve(
            listener,
            app.into_make_service_with_connect_info::<std::net::SocketAddr>(),
        )
        .with_graceful_shutdown(stop.cancelled_owned())
        .await
    });
    tracing::info!(port, "Rust API listening");
    let mut result = tokio::select! {result=&mut server=>Some(result),_=shutdown_signal()=>None};
    http_stop.cancel();
    if result.is_none() {
        match tokio::time::timeout(std::time::Duration::from_secs(10), &mut server).await {
            Ok(completed) => result = Some(completed),
            Err(error) => {
                ApiError::from(error).report("http_shutdown_drain");
                server.abort();
                // Cancellation after the drain deadline is intentional.
                let _ = server.await;
            }
        }
    }
    sweep_stop.cancel();
    let sweep_result = sweep.await.map_err(ApiError::from);
    if let Err(error) = &sweep_result {
        error.report("sweeper_task");
    }
    let recovery = lifecycle::terminate_active(&state)
        .await
        .inspect_err(|error| error.report("shutdown_recovery"));
    ws::shutdown(&state).await;
    pool.close().await;
    recovery?;
    sweep_result?;
    if let Some(result) = result {
        result??;
    }
    Ok(())
}
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::SignalKind;
        use tokio::signal::unix::signal;
        let mut terminate = signal(SignalKind::terminate()).expect("install SIGTERM handler");
        tokio::select! {_=tokio::signal::ctrl_c()=>{},_=terminate.recv()=>{}}
    }
    #[cfg(not(unix))]
    {
        let _ = tokio::signal::ctrl_c().await;
    }
}
