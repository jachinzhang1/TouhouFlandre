//! Transactional catalog ingestion. Struct order below is part of the catalog
//! identity shared with the former Go seed and the TypeScript catalog loader.
use crate::game::{self, Character};
use anyhow::{Context, Result, bail};
use serde::{Deserialize, Serialize};
use sqlx::{PgPool, types::Json};
use std::{collections::HashMap, path::Path};

#[derive(Clone, Debug, Serialize, Deserialize, sqlx::FromRow)]
#[serde(rename_all = "camelCase")]
pub struct Work {
    pub id: String,
    pub title_zh: String,
    pub title_ja: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title_en: Option<String>,
    pub short_name: String,
    #[sqlx(json)]
    pub pinyin_initials: Vec<String>,
    #[serde(rename = "type")]
    #[sqlx(rename = "type")]
    pub work_type: String,
    pub release_year: i32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub mainline_index: Option<i32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub era: Option<String>,
}
#[derive(Clone, Debug)]
pub struct SeedCatalog {
    pub works: Vec<Work>,
    pub characters: Vec<Character>,
    pub version: String,
}
pub fn load_catalog(data_dir: &Path) -> Result<SeedCatalog> {
    let works: Vec<Work> = serde_json::from_slice(
        &std::fs::read(data_dir.join("works.demo.json")).context("read works")?,
    )
    .context("parse works")?;
    let mut characters: Vec<Character> = serde_json::from_slice(
        &std::fs::read(data_dir.join("characters.demo.json")).context("read characters")?,
    )
    .context("parse characters")?;
    let by_id: HashMap<_, _> = works.iter().map(|work| (work.id.as_str(), work)).collect();
    for character in &mut characters {
        let work = by_id
            .get(character.first_appearance.work_id.as_str())
            .with_context(|| {
                format!(
                    "{} references missing work {}",
                    character.id, character.first_appearance.work_id
                )
            })?;
        let suffix = character
            .avatar_url
            .strip_prefix("/characters/")
            .and_then(|value| value.strip_suffix(".png"));
        let Some((order, name)) = suffix.and_then(|value| value.split_once('-')) else {
            bail!(
                "avatar URL does not contain a four-digit order: {}",
                character.avatar_url
            )
        };
        if order.len() != 4
            || !order.bytes().all(|b| b.is_ascii_digit())
            || name.is_empty()
            || name.contains('/')
        {
            bail!(
                "avatar URL does not contain a four-digit order: {}",
                character.avatar_url
            );
        }
        character.appearance_order = order.parse()?;
        character.first_appearance = game::FirstAppearance {
            work_id: work.id.clone(),
            work_title: work.title_zh.clone(),
            work_type: work.work_type.clone(),
            release_year: work.release_year,
            mainline_index: work.mainline_index,
            era: work.era.clone(),
            work_pinyin_initials: work.pinyin_initials.clone(),
        };
    }
    let version = compute_version(&works, &characters)?;
    Ok(SeedCatalog {
        works,
        characters,
        version,
    })
}
pub fn compute_version(works: &[Work], characters: &[Character]) -> Result<String> {
    #[derive(Serialize)]
    struct Payload<'a> {
        works: &'a [Work],
        characters: &'a [Character],
    }
    let payload = String::from_utf8(game::go_json_bytes(&Payload { works, characters })?)?;
    Ok(format!("{:08x}", game::hash_string(&payload)))
}
pub async fn run(pool: &PgPool, data_dir: &Path) -> Result<String> {
    persist(pool, &load_catalog(data_dir)?).await
}
pub async fn persist(pool: &PgPool, catalog: &SeedCatalog) -> Result<String> {
    let mut tx = pool.begin().await?;
    for work in &catalog.works {
        sqlx::query("INSERT INTO work (id,title_zh,title_ja,title_en,short_name,pinyin_initials,type,release_year,mainline_index,era) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT(id) DO UPDATE SET title_zh=EXCLUDED.title_zh,title_ja=EXCLUDED.title_ja,title_en=EXCLUDED.title_en,short_name=EXCLUDED.short_name,pinyin_initials=EXCLUDED.pinyin_initials,type=EXCLUDED.type,release_year=EXCLUDED.release_year,mainline_index=EXCLUDED.mainline_index,era=EXCLUDED.era,updated_at=now()")
            .bind(&work.id).bind(&work.title_zh).bind(&work.title_ja).bind(&work.title_en).bind(&work.short_name).bind(Json(&work.pinyin_initials)).bind(&work.work_type).bind(work.release_year).bind(work.mainline_index).bind(&work.era).execute(&mut *tx).await?;
    }
    for c in &catalog.characters {
        sqlx::query("INSERT INTO character (id,avatar_url,display_name,name_sort_key,search_text,appearance_order,first_appearance_work_id,names,first_appearance,species,ability_display,ability_tags,affiliations,locations,roles,hair_colors,playable,enabled_as_answer,enabled_as_guess,difficulty_tier,source_refs) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21) ON CONFLICT(id) DO UPDATE SET avatar_url=EXCLUDED.avatar_url,display_name=EXCLUDED.display_name,name_sort_key=EXCLUDED.name_sort_key,search_text=EXCLUDED.search_text,appearance_order=EXCLUDED.appearance_order,first_appearance_work_id=EXCLUDED.first_appearance_work_id,names=EXCLUDED.names,first_appearance=EXCLUDED.first_appearance,species=EXCLUDED.species,ability_display=EXCLUDED.ability_display,ability_tags=EXCLUDED.ability_tags,affiliations=EXCLUDED.affiliations,locations=EXCLUDED.locations,roles=EXCLUDED.roles,hair_colors=EXCLUDED.hair_colors,playable=EXCLUDED.playable,enabled_as_answer=EXCLUDED.enabled_as_answer,enabled_as_guess=EXCLUDED.enabled_as_guess,difficulty_tier=EXCLUDED.difficulty_tier,source_refs=EXCLUDED.source_refs,updated_at=now()")
            .bind(&c.id).bind(&c.avatar_url).bind(&c.names.zh_hans).bind(game::character_name_sort_key(c)).bind(game::character_search_text(c)).bind(c.appearance_order).bind(&c.first_appearance.work_id).bind(Json(&c.names)).bind(Json(&c.first_appearance)).bind(Json(&c.species)).bind(&c.ability_display).bind(Json(&c.ability_tags)).bind(Json(&c.affiliations)).bind(Json(&c.locations)).bind(Json(&c.roles)).bind(Json(&c.hair_colors)).bind(c.playable).bind(c.enabled_as_answer).bind(c.enabled_as_guess).bind(&c.difficulty_tier).bind(Json(&c.source_refs)).execute(&mut *tx).await?;
    }
    let ids: Vec<_> = catalog.characters.iter().map(|c| c.id.as_str()).collect();
    sqlx::query("DELETE FROM character WHERE id <> ALL($1::text[])")
        .bind(&ids)
        .execute(&mut *tx)
        .await?;
    let ids: Vec<_> = catalog.works.iter().map(|w| w.id.as_str()).collect();
    sqlx::query("DELETE FROM work WHERE id <> ALL($1::text[])")
        .bind(&ids)
        .execute(&mut *tx)
        .await?;
    let snapshot = serde_json::to_value(&catalog.characters)?;
    sqlx::query("INSERT INTO catalog_snapshot(version,characters) VALUES($1,$2) ON CONFLICT(version) DO NOTHING").bind(&catalog.version).bind(&snapshot).execute(&mut *tx).await?;
    let stored: serde_json::Value =
        sqlx::query_scalar("SELECT characters FROM catalog_snapshot WHERE version=$1")
            .bind(&catalog.version)
            .fetch_one(&mut *tx)
            .await?;
    if stored != snapshot {
        bail!(
            "catalog snapshot {} already exists with different content",
            catalog.version
        );
    }
    sqlx::query("INSERT INTO catalog_state(id,current_version) VALUES('current',$1) ON CONFLICT(id) DO UPDATE SET current_version=EXCLUDED.current_version,updated_at=now()").bind(&catalog.version).execute(&mut *tx).await?;
    tx.commit().await?;
    Ok(catalog.version.clone())
}
