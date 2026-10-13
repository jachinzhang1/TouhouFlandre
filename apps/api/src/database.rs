//! Migration bootstrap intentionally uses runtime queries: Goose/adoption ledgers
//! may be absent or have an older schema before migration, so the final application
//! schema used by query! cannot describe every supported starting state.
use std::time::Duration;

use anyhow::{Context, Result, bail};
use sqlx::{
    Connection, PgConnection, PgPool,
    migrate::{Migrate, Migrator},
    postgres::PgPoolOptions,
};

pub static MIGRATOR: Migrator = sqlx::migrate!("db/migrations");

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LegacyAdoption {
    Refuse,
    AdoptGoose,
}

pub async fn connect(url: &str) -> Result<PgPool> {
    if url.is_empty() {
        bail!("DATABASE_URL_PG is required");
    }
    PgPoolOptions::new()
        .max_connections(20)
        .acquire_timeout(Duration::from_secs(5))
        .connect(url)
        .await
        .context("connect to PostgreSQL")
}

/// Migration is a separate command, never an implicit server-start operation.
/// Detach the migration connection so session-level locks cannot leak into a pool.
pub async fn migrate(pool: &PgPool, adoption: LegacyAdoption) -> Result<()> {
    let mut connection = pool.acquire().await?.detach();
    connection.lock().await?;
    let result = migrate_locked(&mut connection, adoption).await;
    let unlock = connection.unlock().await;
    result?;
    unlock?;
    Ok(())
}

async fn migrate_locked(connection: &mut PgConnection, adoption: LegacyAdoption) -> Result<()> {
    let adoption_exists: bool = sqlx::query_scalar(
        "SELECT to_regclass('public._touhouflandre_migration_adoption') IS NOT NULL",
    )
    .fetch_one(&mut *connection)
    .await?;
    let sqlx_exists: bool =
        sqlx::query_scalar("SELECT to_regclass('public._sqlx_migrations') IS NOT NULL")
            .fetch_one(&mut *connection)
            .await?;
    if adoption_exists {
        let adopted_version: Option<i64> = sqlx::query_scalar(
            "SELECT goose_version FROM _touhouflandre_migration_adoption WHERE singleton",
        )
        .fetch_optional(&mut *connection)
        .await?;
        if adopted_version.is_none() || !sqlx_exists {
            bail!("incomplete migration adoption metadata; refusing to reconstruct history");
        }
        // Once adoption commits, SQLx owns the migration history. In particular,
        // a legitimate SQLx undo must not be checked against the stale Goose ledger.
        MIGRATOR.run(&mut *connection).await?;
        return Ok(());
    }
    let goose_exists: bool =
        sqlx::query_scalar("SELECT to_regclass('public.goose_db_version') IS NOT NULL")
            .fetch_one(&mut *connection)
            .await?;
    if goose_exists {
        let history: Vec<(i64, bool)> = sqlx::query_as("SELECT DISTINCT ON (version_id) version_id, is_applied FROM goose_db_version WHERE version_id > 0 ORDER BY version_id, id DESC")
            .fetch_all(&mut *connection).await?;
        let known: Vec<i64> = MIGRATOR
            .iter()
            .filter(|m| m.migration_type.is_up_migration())
            .map(|m| m.version)
            .collect();
        let version = validate_goose_history(&history, &known)?;
        let has_sqlx_history = if sqlx_exists {
            sqlx::query_scalar::<_, bool>("SELECT EXISTS(SELECT 1 FROM _sqlx_migrations)")
                .fetch_one(&mut *connection)
                .await?
        } else {
            false
        };
        if has_sqlx_history {
            bail!(
                "SQLx history exists without a completed Goose adoption; refusing to fill history gaps"
            );
        }
        if adoption != LegacyAdoption::AdoptGoose {
            bail!(
                "existing Goose history requires the explicit `migrate adopt-goose` command before SQLx can run"
            );
        }
        if version > 0 {
            // A history table alone is not evidence of an initialized database.
            let base_schema_exists: bool = sqlx::query_scalar("SELECT to_regclass('public.game_session') IS NOT NULL AND to_regclass('public.catalog_snapshot') IS NOT NULL AND to_regclass('public.character') IS NOT NULL AND to_regclass('public.work') IS NOT NULL")
                .fetch_one(&mut *connection).await?;
            if !base_schema_exists {
                bail!("Goose ledger exists but its base schema is missing");
            }
        }
        adopt_goose(connection, version).await?;
    }
    MIGRATOR.run(&mut *connection).await?;
    Ok(())
}

async fn adopt_goose(connection: &mut PgConnection, version: i64) -> Result<()> {
    let mut transaction = connection.begin().await?;
    let result: Result<()> = async {
        sqlx::raw_sql(
            "CREATE TABLE _touhouflandre_migration_adoption (
                singleton boolean PRIMARY KEY CHECK (singleton),
                goose_version bigint NOT NULL CHECK (goose_version >= 0),
                adopted_at timestamptz NOT NULL DEFAULT now()
            )",
        )
        .execute(&mut *transaction)
        .await?;
        // skip alone inserts each checksum separately. Enclose the ledger and
        // completion marker in one transaction so interruption is retryable.
        // Its advisory lock is reentrant; the outer lock also spans pending DDL.
        MIGRATOR.skip(&mut *transaction, Some(version)).await?;
        sqlx::query(
            "INSERT INTO _touhouflandre_migration_adoption (singleton, goose_version) VALUES (true, $1)",
        )
        .bind(version)
        .execute(&mut *transaction)
        .await?;
        Ok(())
    }
    .await;
    match result {
        Ok(()) => transaction.commit().await?,
        Err(error) => {
            transaction
                .rollback()
                .await
                .context("roll back failed Goose adoption")?;
            return Err(error);
        }
    }
    Ok(())
}

fn validate_goose_history(history: &[(i64, bool)], known: &[i64]) -> Result<i64> {
    for (version, _) in history {
        if !known.contains(version) {
            bail!("unknown Goose migration version {version}");
        }
    }
    let applied: Vec<_> = history
        .iter()
        .filter(|(_, applied)| *applied)
        .map(|(v, _)| *v)
        .collect();
    if known.get(..applied.len()) != Some(applied.as_slice()) {
        bail!("Goose migration history is not a contiguous known prefix");
    }
    Ok(applied.last().copied().unwrap_or(0))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn legacy_history_is_fail_closed() {
        assert_eq!(
            validate_goose_history(&[(1, true), (2, true), (3, false)], &[1, 2, 3]).unwrap(),
            2
        );
        assert!(validate_goose_history(&[(1, true), (3, true)], &[1, 2, 3]).is_err());
        assert!(validate_goose_history(&[(1, true), (4, false)], &[1, 2, 3]).is_err());
        assert!(validate_goose_history(&[(1, false), (2, true)], &[1, 2, 3]).is_err());
        assert_eq!(validate_goose_history(&[], &[1, 2, 3]).unwrap(), 0);
    }
}
