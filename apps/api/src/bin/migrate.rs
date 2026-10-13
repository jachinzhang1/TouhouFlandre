use touhouflandre_api::database::{self, LegacyAdoption};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let adoption = match std::env::args().nth(1).as_deref() {
        None | Some("up") => LegacyAdoption::Refuse,
        Some("adopt-goose") => LegacyAdoption::AdoptGoose,
        _ => anyhow::bail!("usage: migrate [up|adopt-goose]"),
    };
    let url = std::env::var("DATABASE_URL_PG")
        .map_err(|_| anyhow::anyhow!("DATABASE_URL_PG is required"))?;
    let pool = database::connect(&url).await?;
    database::migrate(&pool, adoption).await?;
    pool.close().await;
    println!("database migrations complete");
    Ok(())
}
