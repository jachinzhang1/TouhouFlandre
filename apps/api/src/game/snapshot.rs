use super::*;
use serde::{Deserialize, Serialize, Serializer};
use sha2::{Digest, Sha256};
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

pub const SEARCH_INDEX_SCHEMA_VERSION: i32 = 2;
const SEARCH_PROVIDER_CACHE_SIZE: usize = 8;
fn nullable_strings<S: Serializer>(values: &[String], serializer: S) -> Result<S::Ok, S::Error> {
    if values.is_empty() {
        serializer.serialize_none()
    } else {
        values.serialize(serializer)
    }
}
fn null_strings<'de, D: serde::Deserializer<'de>>(
    deserializer: D,
) -> Result<Vec<String>, D::Error> {
    Ok(Option::<Vec<String>>::deserialize(deserializer)?.unwrap_or_default())
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SearchIndexFirstAppearance {
    pub release_year: i32,
    pub work_title: String,
}
/// Keep this field order: the strong ETag is over the historical serialized
/// payload. Empty list fields were nil Go slices, hence explicit null encoding.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSearchIndexEntry {
    #[serde(serialize_with = "nullable_strings", deserialize_with = "null_strings")]
    pub affiliations: Vec<String>,
    pub appearance_order: i32,
    pub avatar_url: String,
    pub first_appearance: SearchIndexFirstAppearance,
    #[serde(serialize_with = "nullable_strings", deserialize_with = "null_strings")]
    pub hair_colors: Vec<String>,
    pub id: String,
    pub initials: String,
    #[serde(serialize_with = "nullable_strings", deserialize_with = "null_strings")]
    pub locations: Vec<String>,
    pub name: String,
    pub name_sort_key: String,
    pub search_terms: Vec<SearchTerm>,
    #[serde(serialize_with = "nullable_strings", deserialize_with = "null_strings")]
    pub species: Vec<String>,
    pub subtitle: String,
    pub work_id: String,
}
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CatalogSearchIndex {
    pub catalog_version: String,
    pub entries: Vec<CatalogSearchIndexEntry>,
    pub index_schema_version: i32,
}
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct CatalogSearchSnapshot {
    pub index: CatalogSearchIndex,
    pub payload: Vec<u8>,
    pub etag: String,
}
pub fn build_catalog_search_snapshot(
    version: &str,
    schema_version: i32,
    characters: &[Character],
) -> Result<CatalogSearchSnapshot, GameError> {
    validate_search_key(version, schema_version)?;
    let mut entries = vec![];
    for character in characters.iter().filter(|c| c.enabled_as_guess) {
        let terms = character_search_terms(character);
        let sort_key = character_name_sort_key(character);
        if character.id.is_empty() || terms.is_empty() || sort_key.is_empty() {
            return Err(GameError::InvalidSearchCharacter(character.id.clone()));
        }
        entries.push(CatalogSearchIndexEntry {
            affiliations: character.affiliations.clone(),
            appearance_order: character.appearance_order,
            avatar_url: character.avatar_url.clone(),
            first_appearance: SearchIndexFirstAppearance {
                work_title: character.first_appearance.work_title.clone(),
                release_year: character.first_appearance.release_year,
            },
            hair_colors: character.hair_colors.clone(),
            id: character.id.clone(),
            initials: character.names.zh_hans.chars().take(2).collect(),
            locations: character.locations.clone(),
            name: character.names.zh_hans.clone(),
            name_sort_key: sort_key,
            search_terms: terms,
            species: character.species.clone(),
            subtitle: format!(
                "{} · {}",
                character.names.en, character.first_appearance.work_title
            ),
            work_id: character.first_appearance.work_id.clone(),
        });
    }
    let index = CatalogSearchIndex {
        catalog_version: version.into(),
        entries,
        index_schema_version: schema_version,
    };
    let payload = go_json_bytes(&index)
        .map_err(|err| GameError::SearchSerialization(SharedSource::new(err)))?;
    let hash = Sha256::digest(&payload)
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect::<String>();
    let etag = format!("\"{hash}\"");
    Ok(CatalogSearchSnapshot {
        index,
        payload,
        etag,
    })
}
fn validate_search_key(version: &str, schema: i32) -> Result<(), GameError> {
    if version.trim().is_empty() {
        return Err(GameError::EmptyCatalogVersion);
    }
    if schema != SEARCH_INDEX_SCHEMA_VERSION {
        return Err(GameError::UnsupportedSearchSchema(schema));
    }
    Ok(())
}
type CatalogLoadFuture = Pin<Box<dyn Future<Output = Result<Vec<Character>, GameError>> + Send>>;
type CatalogLoader = dyn Fn(String) -> CatalogLoadFuture + Send + Sync;
#[derive(Clone)]
pub struct CatalogSearchSourceProvider {
    cache: Arc<SharedLru<String, Vec<Character>>>,
    loader: Arc<CatalogLoader>,
    metrics: Arc<SearchMetrics>,
}
impl CatalogSearchSourceProvider {
    pub fn new<F, Fut>(loader: F) -> Self
    where
        F: Fn(String) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<Vec<Character>, GameError>> + Send + 'static,
    {
        Self {
            cache: SharedLru::new(SEARCH_PROVIDER_CACHE_SIZE),
            loader: Arc::new(move |version| Box::pin(loader(version))),
            metrics: Arc::clone(&SEARCH_METRICS),
        }
    }
    pub fn with_metrics(mut self, metrics: Arc<SearchMetrics>) -> Self {
        self.metrics = metrics;
        self
    }
    pub async fn get(&self, version: &str) -> Result<Vec<Character>, GameError> {
        if version.trim().is_empty() {
            return Err(GameError::EmptyCatalogVersion);
        }
        let loader = Arc::clone(&self.loader);
        let version = version.to_owned();
        let load_version = version.clone();
        self.metrics.inc_provider_outcome(
            "source",
            if self.cache.contains(&version) {
                "hit"
            } else {
                "miss"
            },
        );
        let metrics = Arc::clone(&self.metrics);
        let value = self
            .cache
            .get(version, move || async move {
                let result = loader(load_version).await;
                let outcome = if result.is_ok() {
                    "load_success"
                } else {
                    "load_error"
                };
                metrics.inc_provider_outcome("source", outcome);
                tracing::debug!(outcome, "catalog search source load");
                result
            })
            .await?;
        Ok((*value).clone())
    }
}
type SnapshotBuilder =
    dyn Fn(&str, i32, &[Character]) -> Result<CatalogSearchSnapshot, GameError> + Send + Sync;
#[derive(Clone)]
pub struct CatalogSearchSnapshotProvider {
    source: CatalogSearchSourceProvider,
    cache: Arc<SharedLru<(String, i32), CatalogSearchSnapshot>>,
    builder: Arc<SnapshotBuilder>,
    metrics: Arc<SearchMetrics>,
}
impl CatalogSearchSnapshotProvider {
    pub fn new(source: CatalogSearchSourceProvider) -> Self {
        Self::with_builder(source, build_catalog_search_snapshot)
    }
    pub fn with_builder<F>(source: CatalogSearchSourceProvider, builder: F) -> Self
    where
        F: Fn(&str, i32, &[Character]) -> Result<CatalogSearchSnapshot, GameError>
            + Send
            + Sync
            + 'static,
    {
        Self {
            metrics: Arc::clone(&source.metrics),
            source,
            cache: SharedLru::new(SEARCH_PROVIDER_CACHE_SIZE),
            builder: Arc::new(builder),
        }
    }
    pub async fn get(
        &self,
        version: &str,
        schema: i32,
    ) -> Result<CatalogSearchSnapshot, GameError> {
        validate_search_key(version, schema)?;
        let source = self.source.clone();
        let builder = Arc::clone(&self.builder);
        let version = version.to_owned();
        self.metrics.inc_provider_outcome(
            "snapshot",
            if self.cache.contains(&(version.clone(), schema)) {
                "hit"
            } else {
                "miss"
            },
        );
        let metrics = Arc::clone(&self.metrics);
        let value = self
            .cache
            .get((version.clone(), schema), move || async move {
                let characters = source.get(&version).await.inspect_err(|_| {
                    metrics.inc_provider_outcome("snapshot", "load_error");
                    tracing::debug!(
                        outcome = "load_error",
                        "catalog search snapshot source failed"
                    );
                })?;
                let started = std::time::Instant::now();
                let result = builder(&version, schema, &characters);
                metrics.observe_index_build(started.elapsed());
                let outcome = if result.is_ok() {
                    "build_success"
                } else {
                    "build_error"
                };
                metrics.inc_provider_outcome("snapshot", outcome);
                tracing::debug!(outcome, "catalog search snapshot build");
                result
            })
            .await?;
        Ok((*value).clone())
    }
}
#[derive(Clone)]
pub struct CatalogRuntimeProvider {
    loader: Arc<CatalogLoader>,
    cache: Arc<SharedLru<(String, AnswerMatchPolicy), CatalogRuntime>>,
}
impl CatalogRuntimeProvider {
    pub fn new<F, Fut>(loader: F) -> Self
    where
        F: Fn(String) -> Fut + Send + Sync + 'static,
        Fut: Future<Output = Result<Vec<Character>, GameError>> + Send + 'static,
    {
        Self {
            loader: Arc::new(move |version| Box::pin(loader(version))),
            cache: SharedLru::new(usize::MAX),
        }
    }
    pub async fn get(
        &self,
        version: &str,
        policy: AnswerMatchPolicy,
    ) -> Result<Arc<CatalogRuntime>, GameError> {
        let loader = Arc::clone(&self.loader);
        self.get_with_loader(version, policy, move |version| loader(version))
            .await
    }
    /// Override the owned asynchronous loader while sharing the immutable
    /// version/policy cache. Borrowed transaction callers should instead build
    /// a runtime directly using `build_catalog_runtime`.
    pub async fn get_with_loader<F, Fut>(
        &self,
        version: &str,
        policy: AnswerMatchPolicy,
        loader: F,
    ) -> Result<Arc<CatalogRuntime>, GameError>
    where
        F: FnOnce(String) -> Fut + Send + 'static,
        Fut: Future<Output = Result<Vec<Character>, GameError>> + Send + 'static,
    {
        let version = version.to_owned();
        self.cache
            .get((version.clone(), policy), move || async move {
                let characters = loader(version.clone()).await?;
                build_catalog_runtime(&version, policy, &characters)
            })
            .await
    }
    pub async fn evaluate_guess(
        &self,
        version: &str,
        policy: AnswerMatchPolicy,
        answer: &str,
        guess: &str,
        fields: Option<&[GuessField]>,
    ) -> Result<GuessResult, GameError> {
        self.get(version, policy)
            .await?
            .evaluate_guess(answer, guess, fields)
    }
}
