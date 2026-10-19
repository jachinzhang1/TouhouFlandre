use touhouflandre_api::{config::Config, database, seed};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config = Config::from_env()?;
    let pool = database::connect(&config.database_url).await?;
    let version = seed::run(&pool, &config.catalog_data_dir).await?;
    println!("Seeded catalog {version}");
    pool.close().await;
    Ok(())
}
