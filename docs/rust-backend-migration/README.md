# Rust backend migration

## Outcome and authority

The user requested on 2026-10-13: create a branch and worktree, research the stack
before implementing, rewrite the Go backend using Tokio/Axum and SQLx, select
the WebSocket library, and ultimately retain no Go code. This authorizes local
implementation, tests, reversible schema/tooling changes, and repository removal
of superseded Go after parity is proved. It does not authorize production
deployment, production data access, publishing, or waiving missing evidence.
This grant remains active until revoked; the user is the authority.
The user subsequently required Rust **1.99** and native local development/test
processes. Only PostgreSQL may run in Docker locally; do not run Rust, Node,
builds or the application in Docker for local development.

- Branch: `wtf/rust-rewrite-everything-belike` (renamed at the user’s request)
- Worktree: `/Users/clct/.codex/worktrees/rust-axum-backend/TouhouFlandre`
- Baseline: `feature/cd` at `7a5679f22a9991bc9a1d937c3e53c3f59653386d`
- Main checkout's untracked handover reports are excluded and remain untouched.
- Single status source: [work.json](work.json). Root owns its updates.
- Research/decisions: [stack-research.md](stack-research.md).
- Frozen inputs: [contracts-baseline.json](contracts-baseline.json),
  [migration-baseline.json](migration-baseline.json).

## Acceptance claims

| ID | Required result |
|---|---|
| C1 | All 32 OpenAPI operations, health/readiness/metrics, errors and JSON shape remain compatible. |
| C2 | WS v3 authentication, replay barrier, game/chat positions, privacy projection, backpressure, replacement and shutdown remain compatible. |
| C3 | All 23 migrations work on fresh databases; existing Goose databases are adopted without replaying DDL or changing user data. |
| C4 | Catalog identity, search ranking, question scopes, equivalence and solo/multi rules preserve golden behavior. |
| C5 | Concurrency, idempotency, event-after-commit and race/relay recovery pass real-Postgres integration tests. |
| C6 | Build, CI, scripts, generation and deployment run Rust; no .go, go.mod/go.sum or active Go tooling remains. |

The baseline has 22,448 handwritten Go LOC, 13,922 generated LOC, 20,324 test LOC,
390 test functions and 181 named SQL queries. Test counts alone are not proof of
parity. A scaffold or an HTTP server with only health routes does not satisfy C1.

## Compatibility and recovery

OpenAPI YAML and WS v3 stay authoritative. Contract schemas are frozen. Retirement removed only the obsolete x-go-type
generator annotation; the before/after digest is in retirement.json. Any public
schema change requires a separate decision. Catalog versions depend on
ordered JSON and Go's current rune-based FNV hash (TS parity holds for current
BMP data). Keep optional-field omission, empty arrays, Unicode normalization,
UTC timestamps, Asia/Shanghai daily boundary, HMAC cursor bytes and room creation
microseconds. Frozen match settings must not follow later feature-flag changes.

Database state and its event log are authoritative. Each mutation commits state
and events atomically, then publishes; queues are ephemeral and recovery reads
the log. Room sequence and chat cursor remain independent. Preserve lock order,
idempotency keys, observer filtering and startup termination of active matches.
Shutdown stops accepting HTTP, drains requests for up to10 seconds, stops the
sweeper, terminates matches, closes WS with1012 and drains tracked socket tasks. Do not run old and new writers against the same database.

Go source, generated repositories, sqlc/oapi-codegen configuration and duplicate
Goose migration sources have been retired from this worktree. The baseline Git
commit preserves the old implementation for rollback. No
production cutover or retirement of deployed instances is claimed by this work.
Tests use isolated databases; never use production secrets or the fixed shared
Go test database concurrently.

## Work procedure and resumption

Read this file, work.json, stack-research.md and the evidence referenced by the
active item. Each item below is independently verifiable. Do not mark an item
complete based on code presence or skipped database tests. Record commands,
environment, result and limitations in evidence.md. Root coordinates shared
Cargo/lib/app files; workers own the explicit paths listed in work.json.

R01 establishes the build/runtime and migration bridge. R02 ports pure rules and
golden tests. R03 carries the existing schemas into typed Rust DTOs and checks
deterministic generation. R04 ports realtime protocol/ordering primitives. R05
connects catalog/solo requests; R06 implements rooms/race; R07 implements relay,
chat, sweeping and full WS integration; R08 proves black-box/database/recovery
parity; R09 switches all tooling and removes Go only after R08 passes.

Recovery for an unaccepted item is its local diff; never overwrite unrelated
work. A failed test remains failed until fixed. Stop external operations at the
authority boundary above. Replan domain work as needed without weakening any
claim. Build and local tests can continue without further confirmation.


## Error handling follow-up

On 2026-10-13 the user explicitly requested improving the incomplete thiserror
integration. R10 authorizes the error type/propagation/diagnostics changes and
local verification on the existing branch/worktree. Public HTTP/WS contracts,
native Rust 1.99 and database-only Docker constraints remain in force.

## Layered architecture follow-up

On 2026-10-13 the user requested a layered architecture with discoverable handlers.
R12 authorizes local source/module reorganization, architecture checks and regression
tests in the same worktree. All routes move to `src/router.rs`, HTTP adapters to
`src/handler`, application transactions to `src/service`, shared storage to
`src/repository`, and pure chat/relay rules to `src/domain`. Shared game and realtime
primitives retain their existing boundaries. Services remain transaction owners,
including use-case-specific SQL; repositories expose reusable operations on the
caller's connection. Public contracts, SQL statements, lock/commit/publication
order and the selected dependency versions remain unchanged. Earlier acceptance
evidence is historical until the R12 verification is complete. Recovery uses the
local pre-refactor archive recorded in work.json; unrelated user changes stay intact.

## Compile-time SQL follow-up

On 2026-10-13 the user requested using SQLx `query!` macros. R13 covers the local
business-query conversion, offline metadata, native prepare/check tooling, CI and
regression verification. Database schema, API contracts, transaction ownership and
selected dependencies remain unchanged. Commit 6575336 preserves the pre-macro
implementation. Only disposable local databases are created for verification.
