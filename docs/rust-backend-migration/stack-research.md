# Stack decision — 2026-10-13

Research precedes target implementation. User fixes Tokio/Axum + SQLx; the
implementation choices below are within that grant.

| Component | Choice | Reason |
|---|---|---|
| HTTP/runtime | Axum 0.8.9 + Tokio 1.53.2 | Shared Tokio/Hyper/Tower ecosystem, typed extraction and explicit state. |
| WebSocket server | `axum::extract::ws` (`ws` feature) | Uses tokio-tungstenite 0.29 internally; no second server stack or Socket.IO protocol. |
| Middleware | Tower 0.5.3 + tower-http 0.7.1 | Compatible http 1.x types; explicit CORS, tracing and panic response mapping. |
| Database/migration | SQLx 0.9.0, Postgres-only | Async Tokio driver, typed rows/bind parameters, embedded reversible migrations. |
| TLS | SQLx rustls/ring + native trust roots | No OpenSSL runtime dependency; honors operator/private CA roots. |
| DTO/JSON | Serde + ordered serde_json maps | Preserve existing YAML contract and optional field semantics; ordered catalog identity. |
| Runtime ownership | tokio-util CancellationToken + TaskTracker | WebSocket upgrade tasks require explicit lifecycle ownership beyond HTTP shutdown. |
| Logging | tracing + JSON subscriber | Structured logs with redaction; never log tokens, raw requests, database URLs. |
| Toolchain | Rust 1.99.0 / edition 2024 | Current stable; SQLx 0.9 supported minimum is 1.94. Pin compiler and Cargo.lock for reproducibility. |

The user installed and selected Rust 1.99. Local `rustc +stable --version` and
`cargo +stable --version` both confirm 1.99.0. The named 1.99.0 toolchain remains
pinned in the repository for CI and other developers; this host can use its
already-installed stable alias. Rust and Node execute natively; Docker is only
used for isolated local PostgreSQL.

## SQLx decisions and risks

SQLx supports `Migrator`, `migrate!`, migration locking, checksums and reversible
`.up.sql`/`.down.sql`. Embed migrations and use build.rs `rerun-if-changed` so
new migration files rebuild on stable Rust. Only enable Postgres, Tokio, rustls,
chrono/uuid/json, migrate and macros; don't pull SQLite/MySQL defaults.

Goose scripts must be split at Up/Down; StatementBegin/End are Goose parser
directives, not SQL. Preserve SQL bytes other than these directives. Keep
version numbers and original SHA-256 records. An existing Goose database needs
an explicit validated ledger adoption under an advisory lock before SQLx applies
anything. Never use `ignore_missing` or blanket skipping as an upgrade shortcut.
Reject unknown/gapped histories and conflicting/dirty SQLx ledgers.

SQLx 0.9 changes query arguments to SqlSafeStr; use static SQL and `.bind()`.
Adoption/metadata statements are fixed literals. Queries depending on SQLx
macros need a disposable migrated DB or checked-in offline metadata; plain
query_as/FromRow is acceptable only with real database integration coverage.
`puzzle_resolve_idempotency.expires_at` can be Postgres infinity: keep expiry
comparisons in SQL instead of decoding into chrono's finite DateTime.

The baseline does not support full rollback to an empty schema: migration 0010
has an intentional no-op Down retaining multi_round_player, so later undoing
0002 fails its foreign-key dependency. A real Postgres rehearsal confirmed this.
Preserve this expand-only rollback policy. Verify supported reversible tail
migrations separately; do not introduce CASCADE or rewrite history to make an
unsupported full rollback pass.

## WebSocket decisions and risks

Keep `touhouflandre-multi.v3` and JSON frames. Origin must be validated explicitly;
HTTP CORS is insufficient for WS. Subprotocol negotiation must be checked, not
assumed to reject unsupported versions. Enforce hello timeout 10s, read limit
4096 bytes, bounded queue 64, send timeout 10s, ping interval 30s plus matching
pong timeout 10s. Use interval_at to avoid an immediate first ping.

Per-connection queues must not block room publication. An independent close
signal must still work when a data queue is full. Use generation-aware member
replacement and per-observer projection. Replaying and live delivery need a
single ordered barrier and deduplication; Tokio broadcast lagging is not an
acceptable replacement for this behavior.

Baseline discrepancies recorded (do not silently add new behavior): Go accepts
ACK but ignores its sequence; its 60s ReadTimeout constant is unused. Effective
liveness uses ping/pong. YAML prose suggesting ACK-driven slow-consumer tracking
needs a separate compatibility decision if behavior is to change.

## Contract boundary

Keep the checked-in OpenAPI 3.0.3 contract and existing TypeScript generation.
The present schema uses primitive types, object/array properties, references,
enums, nullable fields and allOf intersections. A narrow deterministic Node
generator reuses js-yaml and produces typed Serde DTOs plus local JSON Schema
validators. It fails on unsupported schema keywords instead of silently dropping
constraints. Runtime handlers must use contracts::decode (not bare Serde) to
enforce bounds, lengths, patterns, formats and additionalProperties. Defaults in
query parameters remain an explicit handler responsibility.

Established alternatives were considered: Typify is types-only but documents
collapsing optional collection absence and emptiness, and needs OpenAPI-to-JSON
Schema normalization; Progenitor generates clients; OpenAPI Generator's
rust-axum server generator is beta. The scoped generator avoids those changes
while keeping omission/null/empty-array semantics. It is not a general-purpose
OpenAPI compiler. jsonschema 0.58.6 runs with default features disabled; generated
references are local only. Domain/seed structs remain separate because catalog
key order and non-public fields are not fully described by wire DTO schemas.

## Primary sources

- [Axum 0.8.9 manifest](https://docs.rs/crate/axum/0.8.9/source/Cargo.toml)
- [Axum WebSocketUpgrade](https://docs.rs/axum/0.8.9/axum/extract/ws/struct.WebSocketUpgrade.html)
- [Axum WS message/control handling](https://docs.rs/axum/0.8.9/axum/extract/ws/enum.Message.html)
- [Tokio 1.53.2 manifest](https://docs.rs/crate/tokio/1.53.2/source/Cargo.toml)
- [Tokio graceful shutdown](https://tokio.rs/tokio/topics/shutdown)
- [Tokio mpsc try_send](https://docs.rs/tokio/latest/tokio/sync/mpsc/struct.Sender.html#method.try_send)
- [Tokio broadcast lagging](https://docs.rs/tokio/latest/tokio/sync/broadcast/index.html)
- [Tower 0.5.3 manifest](https://docs.rs/crate/tower/0.5.3/source/Cargo.toml)
- [tower-http 0.7.1 manifest](https://docs.rs/crate/tower-http/0.7.1/source/Cargo.toml)
- [SQLx 0.9 changelog/MSRV/query changes](https://github.com/transact-rs/sqlx/blob/v0.9.0/CHANGELOG.md)
- [SQLx migration API](https://docs.rs/sqlx/latest/sqlx/migrate/struct.Migrator.html)
- [SQLx migration embedding/build tracking](https://docs.rs/sqlx/latest/sqlx/macro.migrate.html)
- [SQLx query/bind API](https://docs.rs/sqlx/0.9.0/sqlx/fn.query.html)
- [Rust 1.99 release](https://blog.rust-lang.org/2026/10/01/Rust-1.99.0/)
- [Typify object/collection mapping](https://github.com/oxidecomputer/typify#objects)
- [Progenitor purpose](https://github.com/oxidecomputer/progenitor)
- [OpenAPI Generator rust-axum status](https://openapi-generator.tech/docs/generators/rust-axum/)
- [Serde field attributes](https://serde.rs/field-attrs.html)
- [serde_json ordered maps](https://docs.rs/serde_json/latest/serde_json/value/enum.Value.html)
- [jsonschema local validation](https://docs.rs/jsonschema/0.58.6/jsonschema/)

## Dependency follow-up — R11 (2026-10-13)

Checked the crates.io release metadata, official documentation and the downloaded
crate manifests/changelogs before changing direct dependencies. These are stable,
non-yanked releases compatible with the selected Rust 1.99.0 toolchain:

| Direct dependency | Previous lock | Selected | Minimum Rust |
|---|---|---|---|
| base64 | 0.22.1 | 0.23.1 | 1.71 |
| hmac | 0.12.1 | 0.13.0 | 1.85 |
| rand | 0.9.5 | 0.10.3 | 1.85 |
| sha2 | 0.10.9 | 0.11.1 | 1.88 |
| tokio-tungstenite | 0.29.0 | 0.29.0 (unchanged at user's request) | 1.63 |

HMAC and SHA-256 move together to digest 0.11. Import `KeyInit` for HMAC key
construction and keep the existing MAC verification. The new digest output does
not implement LowerHex; format each byte as two lowercase hexadecimal digits to
preserve token hashes, quoted ETags, idempotency fingerprints and migration
checksums. Existing Go-generated fixtures remain unchanged.

Rand 0.10 renames `OsRng`/`TryRngCore` to `SysRng`/`TryRng`. Security-sensitive
random bytes still come from the operating system, and fallible paths propagate
the typed `SysError` through thiserror. A regression verifies the retained source
and generic HTTP response. Base64 continues to use explicit `URL_SAFE_NO_PAD`;
its existing wire alphabet, padding policy and signed input remain unchanged.

Axum 0.8.9 requires tokio-tungstenite 0.29, which excludes 0.30. The user explicitly
excluded this upgrade, so both the test client and server keep 0.29.0. No Axum
fork, patch or extra 0.30 dependency remains. Older transitive base64 (Axum/SQLx),
sha2 (SQLx) and rand (tungstenite) remain where upstream version constraints need
them; this change upgrades the application's direct dependencies only.

Sources:

- [base64 0.23.1](https://docs.rs/crate/base64/0.23.1)
- [hmac 0.13.0](https://docs.rs/crate/hmac/0.13.0)
- [sha2 0.11.1](https://docs.rs/crate/sha2/0.11.1)
- [Rand 0.10 migration guide](https://rust-random.github.io/book/update-0.10.html)
- [rand 0.10.3 SysRng](https://docs.rs/rand/0.10.3/rand/rngs/struct.SysRng.html)
- [Axum 0.8.9 dependency manifest](https://docs.rs/crate/axum/0.8.9/source/Cargo.toml)
