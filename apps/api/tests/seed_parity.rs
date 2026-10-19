mod catalog_support;
use catalog_support::*;
use touhouflandre_api::seed;

#[test]
fn catalog_hash_matches_original_go_seed() {
    let catalog = seed::load_catalog(&data_dir()).unwrap();
    // Captured from the unmodified Go seed loader/computeCatalogVersion on the
    // migration branch baseline, not derived by the Rust implementation.
    assert_eq!(catalog.version, "b54d39d7");
    assert!(!catalog.works.is_empty());
    assert!(!catalog.characters.is_empty());
    assert!(
        catalog
            .characters
            .iter()
            .all(|c| c.appearance_order > 0 && !c.first_appearance.work_title.is_empty())
    );
}
#[tokio::test]
#[ignore = "requires isolated TEST_DATABASE_URL"]
async fn seed_is_idempotent_and_collision_rolls_back_all_writes() {
    let db = Database::new().await;
    let version = db.seed().await;
    assert_eq!(db.seed().await, version);
    let mut catalog = seed::load_catalog(&data_dir()).unwrap();
    let original = catalog.characters[0].names.zh_hans.clone();
    catalog.characters[0].names.zh_hans = "must roll back".into();
    catalog.works[0].title_zh = "must roll back".into();
    assert!(seed::persist(&db.pool, &catalog).await.is_err());
    let actual: String = sqlx::query_scalar("SELECT names->>'zhHans' FROM character WHERE id=$1")
        .bind(&catalog.characters[0].id)
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(actual, original);
    catalog.version = seed::compute_version(&catalog.works, &catalog.characters).unwrap();
    let new_version = seed::persist(&db.pool, &catalog).await.unwrap();
    assert_ne!(new_version, version);
    let snapshots: i64 = sqlx::query_scalar("SELECT count(*) FROM catalog_snapshot")
        .fetch_one(&db.pool)
        .await
        .unwrap();
    assert_eq!(snapshots, 2);
    db.close().await;
}
