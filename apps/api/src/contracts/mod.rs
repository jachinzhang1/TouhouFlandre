//! Wire DTOs generated from the existing OpenAPI contract.
//!
//! HTTP handlers must use [`decode`] (or [`validate_value`] before deserializing)
//! to enforce numeric bounds, patterns, formats, and collection constraints.
//! `serde_json::from_value` alone enforces types/enums/required fields, but does
//! not enforce every OpenAPI constraint. No network/file schema retrieval is
//! enabled; generated references are confined to `#/definitions`.

mod generated;
pub use generated::*;

use serde::{Deserialize, Deserializer, Serialize, de::DeserializeOwned};
use serde_json::Value;
use std::{
    collections::BTreeMap,
    sync::{LazyLock, OnceLock},
};

pub const OPERATIONS_JSON: &str = include_str!("operations.json");
pub const SCHEMAS_JSON: &str = include_str!("schemas.json");

/// Identifies the schema for a generated DTO, including inline operation DTOs.
pub trait Contract {
    const SCHEMA_NAME: &'static str;
}

#[derive(Debug, thiserror::Error)]
pub enum ContractError {
    #[error("unknown contract schema: {0}")]
    UnknownSchema(String),
    #[error("invalid generated contract: {0}")]
    InvalidSchema(String),
    #[error("contract validation failed at {path}")]
    InvalidValue { path: String },
    #[error("invalid JSON contract value: {0}")]
    Json(#[from] serde_json::Error),
}

static SCHEMAS: LazyLock<Value> = LazyLock::new(|| {
    serde_json::from_str(SCHEMAS_JSON).expect("checked-in contract schemas must be valid JSON")
});
type CachedValidator = OnceLock<Result<jsonschema::Validator, String>>;
static VALIDATORS: LazyLock<BTreeMap<String, CachedValidator>> = LazyLock::new(|| {
    SCHEMAS["definitions"]
        .as_object()
        .expect("generated definitions object")
        .keys()
        .map(|name| (name.clone(), OnceLock::new()))
        .collect()
});

fn validator(schema_name: &str) -> Result<&'static jsonschema::Validator, ContractError> {
    let cached = VALIDATORS
        .get(schema_name)
        .ok_or_else(|| ContractError::UnknownSchema(schema_name.to_owned()))?;
    cached
        .get_or_init(|| {
            let mut schema = SCHEMAS.clone();
            schema["$ref"] = Value::String(format!("#/definitions/{schema_name}"));
            jsonschema::draft7::options()
                .should_validate_formats(true)
                .build(&schema)
                .map_err(|error| error.to_string())
        })
        .as_ref()
        .map_err(|error| ContractError::InvalidSchema(error.clone()))
}

/// Validate JSON against a generated component or operation schema.
/// Unknown fields are rejected only where OpenAPI says `additionalProperties: false`.
pub fn validate_value(schema_name: &str, value: &Value) -> Result<(), ContractError> {
    validator(schema_name)?
        .validate(value)
        .map_err(|error| ContractError::InvalidValue {
            // Do not copy the input value into errors: bodies may include guest tokens.
            path: error.instance_path().to_string(),
        })
}

/// Validate every declared constraint, then deserialize into a wire DTO.
pub fn decode<T: Contract + DeserializeOwned>(value: Value) -> Result<T, ContractError> {
    validate_value(T::SCHEMA_NAME, &value)?;
    Ok(serde_json::from_value(value)?)
}

/// Validate a constructed DTO before sending it to a client.
pub fn validate<T: Contract + Serialize>(value: &T) -> Result<(), ContractError> {
    validate_value(T::SCHEMA_NAME, &serde_json::to_value(value)?)
}

/// `default` handles missing fields; present fields must deserialize as `T`.
/// For a nullable field `T` is `Option<U>`, preserving absent/null/value states.
fn deserialize_present<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    T::deserialize(deserializer).map(Some)
}

/// A deserialize hook makes required nullable fields reject a missing key.
fn deserialize_nullable<'de, D, T>(deserializer: D) -> Result<Option<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Option::<T>::deserialize(deserializer)
}
