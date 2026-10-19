// This is deliberately a compiler for the repository's OpenAPI schema subset.
// It generates wire DTOs, not handlers, domain models, or a second API contract.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";

const { load } = createRequire(import.meta.url)("js-yaml");
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = resolve(root, "contracts/openapi");
const entryFile = resolve(sourceRoot, "openapi.yaml");
const outputDir = resolve(root, "apps/api/src/contracts");
const check = process.argv.includes("--check");
if (process.argv.slice(2).some((argument) => argument !== "--check")) {
  throw new Error("Usage: node scripts/generate-rust-contracts.mjs [--check]");
}

const documents = new Map();
const definitions = new Map();
const references = new Map();
const operations = [];
const keywords = new Set([
  "$ref", "type", "properties", "required", "items", "enum", "allOf",
  "additionalProperties", "nullable", "description", "title", "default",
  "example", "deprecated", "format", "minimum", "maximum", "minLength",
  "maxLength", "minItems", "maxItems", "pattern", "uniqueItems",
  "x-enum-varnames",
]);
const annotations = new Set([
  "description", "title", "example", "deprecated", "x-enum-varnames",
]);
const supportedFormats = new Set(["date-time", "date", "uri", "uuid", "int32", "int64", "float", "double"]);
const keywordsRust = new Set("as async await break const continue crate dyn else enum extern false fn for if impl in let loop match mod move mut pub ref return self Self static struct super trait true type union unsafe use where while abstract become box do final macro override priv typeof unsized virtual yield try gen".split(" "));
const quote = (text) => JSON.stringify(text);
const pascal = (name) => {
  const value = name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").split(/[^a-zA-Z0-9]+/).filter(Boolean).map((part) => part[0].toUpperCase() + part.slice(1)).join("");
  return /^\d/.test(value) ? `Value${value}` : value;
};
const snake = (name) => {
  const value = name.replace(/([A-Z]+)([A-Z][a-z])/g, "$1_$2").replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[^a-zA-Z0-9_]/g, "_").toLowerCase();
  if (["self", "super", "crate"].includes(value)) return `${value}_value`;
  return keywordsRust.has(value) ? `r#${value}` : value;
};
function document(file) {
  if (!documents.has(file)) documents.set(file, load(readFileSync(file, "utf8")));
  return documents.get(file);
}
function resolveReference(ref, file) {
  if (typeof ref !== "string" || /^\w+:/.test(ref)) throw new Error(`Only local references are supported: ${ref}`);
  const [path, fragment = ""] = ref.split("#");
  const target = path ? resolve(dirname(file), path) : file;
  if (target !== sourceRoot && !target.startsWith(sourceRoot + sep)) throw new Error(`Reference escapes contract directory: ${ref}`);
  const parts = fragment ? fragment.replace(/^\//, "").split("/").map((part) => decodeURIComponent(part).replaceAll("~1", "/").replaceAll("~0", "~")) : [];
  let schema = document(target);
  for (const part of parts) {
    if (!schema || !Object.hasOwn(schema, part)) throw new Error(`Unresolved reference ${ref} in ${file}`);
    schema = schema[part];
  }
  return { schema, file: target, key: `${target}#${fragment}`, suggestedName: parts.at(-1) };
}
function dereference(schema, file) {
  const seen = new Set();
  while (schema.$ref) {
    const resolved = resolveReference(schema.$ref, file);
    if (seen.has(resolved.key)) throw new Error(`Cyclic schema alias: ${resolved.key}`);
    seen.add(resolved.key);
    ({ schema, file } = resolved);
  }
  return { schema, file };
}
function register(name, schema, file, key) {
  name = pascal(name);
  if (!name) throw new Error("Empty Rust type name");
  if (key && references.has(key)) return references.get(key);
  if (definitions.has(name)) {
    const previous = definitions.get(name);
    if (previous.file !== file || JSON.stringify(previous.schema) !== JSON.stringify(schema)) throw new Error(`Generated type name collision: ${name}`);
  } else definitions.set(name, { schema, file });
  if (key) references.set(key, name);
  return name;
}
function referenceName(ref, file) {
  const target = resolveReference(ref, file);
  if (references.has(target.key)) return references.get(target.key);
  return register(target.suggestedName, target.schema, target.file, target.key);
}
function inspect(schema, location) {
  if (!schema || Array.isArray(schema) || typeof schema !== "object") throw new Error(`Expected schema object at ${location}`);
  for (const key of Object.keys(schema)) if (!keywords.has(key)) throw new Error(`Unsupported schema keyword ${key} at ${location}`);
  if (schema.format && !supportedFormats.has(schema.format)) throw new Error(`Unsupported format ${schema.format} at ${location}`);
  if (schema.nullable !== undefined && typeof schema.nullable !== "boolean") throw new Error(`Invalid nullable at ${location}`);
  if (schema.nullable && (!["string", "integer", "number", "boolean"].includes(schema.type) || schema.enum)) throw new Error(`Nullable composite/enum schemas require an explicit generator extension at ${location}`);
  if (schema.type && !["object", "array", "string", "integer", "number", "boolean"].includes(schema.type)) throw new Error(`Unsupported type at ${location}`);
  if (schema.enum && (!Array.isArray(schema.enum) || !schema.enum.length || !["string", "integer"].includes(schema.type))) throw new Error(`Only nonempty string/integer enums are supported at ${location}`);
  if (schema.enum && schema.enum.some((value) => schema.type === "string" ? typeof value !== "string" : !Number.isSafeInteger(value))) throw new Error(`Enum value/type mismatch at ${location}`);
}

// Canonical JSON Schema uses only internal references. Runtime validation keeps
// allOf intact; DTO generation merges only compatible object intersections.
function canonical(schema, file, location) {
  inspect(schema, location);
  if (schema.$ref) {
    const unsupported = Object.keys(schema).filter((key) => key !== "$ref" && !annotations.has(key));
    if (unsupported.length) throw new Error(`Unsupported $ref sibling ${unsupported.join(", ")} at ${location}`);
    return { $ref: `#/definitions/${referenceName(schema.$ref, file)}` };
  }
  const result = {};
  for (const [key, value] of Object.entries(schema)) {
    if (annotations.has(key) || key === "nullable") continue;
    if (key === "properties") result.properties = Object.fromEntries(Object.entries(value).map(([name, child]) => [name, canonical(child, file, `${location}.${name}`)]));
    else if (key === "items") result.items = canonical(value, file, `${location}[]`);
    else if (key === "additionalProperties" && typeof value === "object") result[key] = canonical(value, file, `${location}.*`);
    else if (key === "allOf") result.allOf = value.map((child, index) => canonical(child, file, `${location}.allOf[${index}]`));
    else if (key === "format" && ["int32", "int64", "float", "double"].includes(value)) continue;
    else result[key] = value;
  }
  if (schema.nullable) {
    if (!schema.type) throw new Error(`nullable requires a type at ${location}`);
    result.type = [schema.type, "null"];
    if (result.enum) result.enum = [...result.enum, null];
  }
  return result;
}
const spec = document(entryFile);
if (spec.openapi !== "3.0.3") throw new Error(`Expected OpenAPI 3.0.3, received ${spec.openapi}`);
for (const [name, schema] of Object.entries(spec.components.schemas)) {
  if (schema.$ref) {
    const target = resolveReference(schema.$ref, entryFile);
    register(name, target.schema, target.file, target.key);
  } else register(name, schema, entryFile);
}
for (const [path, rawPath] of Object.entries(spec.paths)) {
  const resolved = dereference(rawPath, entryFile);
  for (const method of ["get", "post", "put", "patch", "delete", "options", "head"]) {
    const operation = resolved.schema[method];
    if (!operation) continue;
    if (!operation.operationId) throw new Error(`Missing operationId: ${method} ${path}`);
    const prefix = pascal(operation.operationId);
    const metadata = { operationId: operation.operationId, method: method.toUpperCase(), path };
    const body = operation.requestBody?.content?.["application/json"]?.schema;
    if (body) metadata.requestBody = register(`${prefix}RequestBody`, body, resolved.file);
    for (const location of ["path", "query", "header"]) {
      const params = [...(resolved.schema.parameters ?? []), ...(operation.parameters ?? [])].filter((param) => param.in === location);
      if (params.length) metadata[`${location}Parameters`] = register(`${prefix}${pascal(location)}`, {
        type: "object",
        properties: Object.fromEntries(params.map((param) => [param.name, param.schema])),
        required: params.filter((param) => param.required).map((param) => param.name),
      }, resolved.file);
    }
    metadata.responses = {};
    for (const [status, response] of Object.entries(operation.responses)) {
      const schema = response.content?.["application/json"]?.schema;
      if (schema) metadata.responses[status] = register(`${prefix}Response${status}`, schema, resolved.file);
    }
    operations.push(metadata);
  }
}
const schemas = {};
for (const [name, definition] of definitions) schemas[name] = canonical(definition.schema, definition.file, name);

function expand(schema, stack = []) {
  if (schema.$ref) {
    const name = schema.$ref.split("/").at(-1);
    if (stack.includes(name)) throw new Error(`Recursive allOf is unsupported: ${name}`);
    return expand(schemas[name], [...stack, name]);
  }
  if (!schema.allOf) return schema;
  const { allOf, ...own } = schema;
  return [own, ...allOf].reduce((left, right) => merge(left, expand(right, stack)), {});
}
function merge(left, right) {
  const result = { ...left };
  for (const [key, value] of Object.entries(right)) {
    if (!(key in result) || JSON.stringify(result[key]) === JSON.stringify(value)) { result[key] = value; continue; }
    if (key === "properties") {
      result.properties = { ...result.properties };
      for (const [name, child] of Object.entries(value)) {
        if (!(name in result.properties) || JSON.stringify(result.properties[name]) === JSON.stringify(child)) result.properties[name] = child;
        else result.properties[name] = merge(expand(result.properties[name]), expand(child));
      }
    } else if (key === "required") result.required = [...new Set([...result.required, ...value])];
    else if (key === "enum") result.enum = result.enum.filter((item) => value.includes(item));
    else if (["minimum", "minLength", "minItems"].includes(key)) result[key] = Math.max(result[key], value);
    else if (["maximum", "maxLength", "maxItems"].includes(key)) result[key] = Math.min(result[key], value);
    else throw new Error(`Unsupported allOf intersection for ${key}`);
  }
  if (result.enum?.length === 0) throw new Error("Empty allOf enum intersection");
  return result;
}

const emitted = new Map();
const typeSchemas = new Map(Object.entries(schemas));
function nested(name, schema) {
  if (typeSchemas.has(name) && JSON.stringify(typeSchemas.get(name)) !== JSON.stringify(schema)) throw new Error(`Inline type collision: ${name}`);
  typeSchemas.set(name, schema);
  return name;
}
function typeFor(schema, name) {
  if (schema.$ref) return schema.$ref.split("/").at(-1);
  if (schema.allOf) {
    if (schema.allOf.length === 1 && schema.allOf[0].$ref && Object.keys(schema).every((key) => ["allOf", "type"].includes(key))) return typeFor(schema.allOf[0], name);
    return nested(name, schema);
  }
  const type = Array.isArray(schema.type) ? schema.type.find((item) => item !== "null") : schema.type;
  if (schema.enum) return nested(name, { ...schema, type, enum: schema.enum.filter((value) => value !== null) });
  if (type === "string") return "String";
  if (type === "integer") return "i64";
  if (type === "number") return "f64";
  if (type === "boolean") return "bool";
  if (type === "array") return `Vec<${typeFor(schema.items, `${name}Item`)}>`;
  if (type === "object") {
    if (schema.properties) return nested(name, schema);
    if (schema.additionalProperties === false) return nested(name, { ...schema, properties: {} });
    const value = typeof schema.additionalProperties === "object" ? typeFor(schema.additionalProperties, `${name}Value`) : "serde_json::Value";
    return `std::collections::BTreeMap<String, ${value}>`;
  }
  throw new Error(`Schema has no supported type: ${name}`);
}
function emit(name, original) {
  let schema = original;
  if (schema.$ref) {
    const target = typeFor(schema, name);
    return `#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\n#[serde(transparent)]\npub struct ${name}(pub ${target});\n`;
  }
  schema = expand(schema);
  if (Array.isArray(schema.type)) {
    const type = typeFor({ ...schema, type: schema.type.find((value) => value !== "null") }, `${name}Value`);
    return `#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\n#[serde(transparent)]\npub struct ${name}(pub Option<${type}>);\n`;
  }
  if (schema.enum) {
    const variants = schema.enum.map((value) => typeof value === "number" ? `Value${value < 0 ? `Negative${-value}` : value}` : (pascal(value) || `Symbol${Array.from(value).map((character) => character.codePointAt(0).toString(16).toUpperCase()).join("U")}`));
    if (variants.some((variant) => !variant || keywordsRust.has(variant)) || new Set(variants).size !== variants.length) throw new Error(`Invalid enum variants: ${name}`);
    if (schema.type === "string") return `#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]\npub enum ${name} {\n${variants.map((variant, index) => `    #[serde(rename = ${quote(schema.enum[index])})]\n    ${variant},`).join("\n")}\n}\n`;
    if (schema.type === "integer") return `#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]\n#[serde(try_from = "i64", into = "i64")]\npub enum ${name} {\n${variants.map((variant) => `    ${variant},`).join("\n")}\n}\nimpl TryFrom<i64> for ${name} {\n    type Error = String;\n    fn try_from(value: i64) -> Result<Self, Self::Error> {\n        match value {\n${variants.map((variant, index) => `            ${schema.enum[index]} => Ok(Self::${variant}),`).join("\n")}\n            _ => Err(format!("invalid ${name}: {value}")),\n        }\n    }\n}\nimpl From<${name}> for i64 {\n    fn from(value: ${name}) -> Self {\n        match value {\n${variants.map((variant, index) => `            ${name}::${variant} => ${schema.enum[index]},`).join("\n")}\n        }\n    }\n}\n`;
  }
  if (schema.type === "object" && schema.properties) {
    const required = new Set(schema.required ?? []);
    for (const property of required) if (!Object.hasOwn(schema.properties, property)) throw new Error(`Required property absent: ${name}.${property}`);
    const fieldNames = new Set();
    const fields = Object.entries(schema.properties).map(([field, child]) => {
      const rustField = snake(field);
      if (fieldNames.has(rustField)) throw new Error(`Rust field name collision: ${name}.${field}`);
      fieldNames.add(rustField);
      const isRequired = required.has(field);
      const nullable = Array.isArray(child.type) && child.type.includes("null");
      let type = typeFor(child, `${name}${pascal(field)}`);
      if (nullable) type = `Option<${type}>`;
      const attrs = [`rename = ${quote(field)}`];
      if (!isRequired) {
        type = `Option<${type}>`;
        attrs.push("default", 'skip_serializing_if = "Option::is_none"', 'deserialize_with = "super::deserialize_present"');
      } else if (nullable) attrs.push('deserialize_with = "super::deserialize_nullable"');
      return `    #[serde(${attrs.join(", ")})]\n    pub ${rustField}: ${type},`;
    });
    if (schema.additionalProperties && typeof schema.additionalProperties === "object") {
      fields.push(`    #[serde(flatten)]\n    pub additional_properties: std::collections::BTreeMap<String, ${typeFor(schema.additionalProperties, `${name}AdditionalProperty`)}>,`);
    }
    return `#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\n${schema.additionalProperties === false ? "#[serde(deny_unknown_fields)]\n" : ""}pub struct ${name} {\n${fields.join("\n")}\n}\n`;
  }
  return `#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]\n#[serde(transparent)]\npub struct ${name}(pub ${typeFor(schema, `${name}Value`)});\n`;
}
for (const [name, schema] of typeSchemas) {
  emitted.set(name, emit(name, schema));
}
const generated = [
  "// @generated by scripts/generate-rust-contracts.mjs; do not edit.",
  "// Source: contracts/openapi/openapi.yaml (OpenAPI 3.0.3).",
  "// Dates/URIs remain strings to preserve exact wire text; validate before decoding.",
  "#![allow(clippy::large_enum_variant)]",
  "use serde::{Deserialize, Serialize};",
  "",
  ...[...emitted].sort(([a], [b]) => a.localeCompare(b, "en")).map(([name, body]) => `${body}\nimpl super::Contract for ${name} {\n    const SCHEMA_NAME: &'static str = ${quote(name)};\n}\n`),
].join("\n");
const formatted = spawnSync("rustfmt", ["--edition", "2024"], {
  cwd: root, input: generated, encoding: "utf8", maxBuffer: 8 * 1024 * 1024,
});
if (formatted.error || formatted.status !== 0) throw new Error(`rustfmt failed: ${formatted.error ?? formatted.stderr}`);
const schemaDocument = { $schema: "http://json-schema.org/draft-07/schema#", definitions: Object.fromEntries([...typeSchemas].sort(([a], [b]) => a.localeCompare(b, "en"))) };
const artifacts = new Map([
  ["generated.rs", formatted.stdout],
  ["schemas.json", `${JSON.stringify(schemaDocument, null, 2)}\n`],
  ["operations.json", `${JSON.stringify(operations, null, 2)}\n`],
]);
mkdirSync(outputDir, { recursive: true });
for (const [name, content] of artifacts) {
  const path = resolve(outputDir, name);
  if (check) {
    let existing;
    try { existing = readFileSync(path, "utf8"); } catch { /* handled below */ }
    if (existing !== content) throw new Error(`Stale generated contract: ${relative(root, path)}. Run node scripts/generate-rust-contracts.mjs.`);
  } else writeFileSync(path, content);
}
console.log(`[rust-contracts] ${check ? "checked" : "generated"} ${emitted.size} DTOs and ${operations.length} operations`);
