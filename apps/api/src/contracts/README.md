# Rust contract boundary

`contracts/openapi/openapi.yaml` remains the only HTTP contract. Run
`node scripts/generate-rust-contracts.mjs` after changing it; CI uses the same
command with `--check`. The generated files are `generated.rs`, `schemas.json`,
and `operations.json`. Do not edit them manually. TypeScript generation remains
unchanged.

The generator is deliberately restricted to the schema features used here:
local references, primitive types, string/integer enums, objects, arrays,
dictionaries, required and optional fields, nullable scalar fields, and compatible
object `allOf` intersections. New unsupported keywords, remote references,
conflicting intersections, and type/field-name collisions fail generation.
Nullable composite types and nullable enums require an explicit extension to the
generator; neither occurs in the current contract.
Single-reference `allOf` wrappers reuse the referenced DTO. `allOf` intersections
remain intact in validation schemas, including narrowed terminal-state enums.

Optional fields use `Option<T>` and omit absent values. Optional nullable fields
use `Option<Option<T>>`: `None` omits the field, `Some(None)` emits `null`, and
`Some(Some(value))` emits a value. Required nullable fields still require a key.
Required arrays serialize as `[]` when empty; optional arrays preserve absent
versus explicitly empty. Integer enums serialize as JSON numbers. Dates, URIs,
and UUIDs use strings so the original wire spelling is preserved.

Handlers must call `contracts::decode::<Dto>(value)` to enforce the full schema
before deserializing. Serde alone is insufficient for bounds, string patterns,
lengths, array limits, and formats. `decode` validates these with the established
`jsonschema` validator, using cached validators and local references only.
Unknown fields are rejected only for `additionalProperties: false`; this is not
applied globally. Protocol authentication and domain rules remain handler/domain
responsibilities. Request/query defaults are retained as schema annotations;
handlers apply them explicitly, as JSON Schema validation does not insert them.
`operations.json` records every operation's body, path, query, header, and JSON
response DTO names for router coverage checks and future request adapters.

The narrow generator was selected after comparing established options:

- [Typify](https://github.com/oxidecomputer/typify) generates types from JSON
  Schema, but its optional collection heuristic does not preserve
  `Option<Vec<T>>`; the existing wire contract distinguishes omission from `[]`.
  OpenAPI 3.0 also needs a normalization layer before using Typify.
- [Progenitor](https://github.com/oxidecomputer/progenitor) is an OpenAPI client
  generator, bringing a client layer into this server-only boundary.
- [OpenAPI Generator's Axum target](https://openapi-generator.tech/docs/generators/rust-axum/)
  is marked beta and generates server integration beyond the DTO boundary.
- [Serde field attributes](https://serde.rs/field-attrs.html) support the precise
  omission behavior. [jsonschema](https://docs.rs/jsonschema/0.58.6/jsonschema/)
  supplies standards-based validation rather than reimplementing it here.

Domain and catalog-hash structs are separate from these DTOs. Generated property
ordering must never define the catalog version: that version depends on the
TypeScript seed object's JSON ordering, which has its own compatibility fixture.
