# Evidence

Evidence domain is local/isolated only. No production operation or deployment.
Results are bound to baseline commit 7a5679f22a9991bc9a1d937c3e53c3f59653386d and
the frozen input SHA-256 manifests unless a later artifact identity is stated.

## 2026-10-13 — baseline and prerequisites

- `go test ./internal/game ./internal/config` against original baseline: **pass**.
- PostgreSQL 18.4 in dedicated temporary container
  `touhouflandre-rust-migration-20261013`: reachable on localhost:61724; no host
  volume, unrelated containers and databases unchanged.
- Execute all 23 converted Up scripts separately in real PostgreSQL
  transactions: **pass**. This proves SQL validity, not SQLx driver/adoption.
- Execute all Down scripts to zero: **fail**, matching baseline's documented
  expand-only rollback policy. 0010 intentionally retains roster tables;
  dropping 0002's multi_round encounters their foreign key. No CASCADE was added.
  Disposable rehearsal database was removed. Full-down is not a supported
  migration acceptance claim; SQLx tests exercise the reversible 22/23 tail.
- `rustc +stable --version`: 1.99.0; `cargo +stable --version`: 1.99.0.
- `pnpm install --frozen-lockfile`: **pass** after offline cache lacked two
  packages. No lockfile version changes were requested.
- Initial HTTP/2 connection stalled; disabling HTTP multiplexing unblocked
  downloads. This is a command-local setting, not a global config edit.
- `CARGO_HTTP_MULTIPLEXING=false CARGO_HTTP_TIMEOUT=30 CARGO_NET_RETRY=2 cargo
  +stable check --workspace --all-targets`: **fail** at two SQLx 0.9 test API
  calls (`Migration.sql` is SqlStr, not str). Both now use `as_ref()`; rerun is
  **not_run**. This is not a successful whole-workspace build or test result.
- User reported a broken Rust toolchain and is reinstalling. All agent-owned
  Cargo/rustup/format commands have stopped. Do not invoke or repair Rust tools
  until the user confirms readiness. Non-Rust review may continue.
- `node --check scripts/generate-rust-contracts.mjs`: **pass**.
- `pnpm check:ws-protocol`: **pass** (schema, positive/negative, TS consistency).
- `pnpm check:openapi-refs`: **pass** (44 YAML files, 43 local refs, no orphans).
- SHA-256 check of all 53 frozen contract/fixture files: **pass**, no changes.

## Remaining evidence

R01–R04 are not complete until compiler, focused tests and SQLx integration checks
pass. API/domain integration, multiplayer recovery, black-box parity and Go
retirement are still future acceptance work; code presence does not prove them.

## Toolchain restored and foundation acceptance

User confirmed reinstall complete; pinned `rustc` and `cargo` report 1.99.0.
Rust tools are authorized again. `cargo check --workspace --all-targets`: pass.
Library tests: 4/4 pass; game parity: 19/19 pass; realtime primitives: 17/17 pass.
Database suite: 7/7 pass, including 6 real isolated PostgreSQL tests. An initial
invocation omitted TEST_DATABASE_URL and failed before database access; corrected
invocation used the dedicated localhost:61724 database service and passed.
Atomic Goose adoption now records its completion marker in the same transaction
as SQLx checksums; injection at version2 proves rollback and retry. Completed
adoption makes SQLx authoritative, including undo21 followed by up23. Version0,
concurrent adoption and missing-ledger refusal are covered. Goose must be stopped
before operational adoption: its lock is not the SQLx advisory lock.
R03 contract verification and R05–R07 business implementation are in progress.

## Integrated runtime verification (2026-10-13)

User-requested native Rust1.99.0; only isolated PostgreSQL18.4 runs in Docker.
`cargo clippy --workspace --all-targets --locked -- -D warnings`: pass after
fixing style warnings. `cargo test --workspace --locked -- --include-ignored`
with explicit TEST_DATABASE_URL: **109 passed, 0 failed, 0 ignored**, including
47 real-PostgreSQL tests, each with a fresh UUID database. Test groups: lib6,
chat2, contracts7, migrations7, game21, lifecycle3, realtime17, relay-domain9,
relay-integration13, rooms/race11, seed2, solo8, integrated-WebSocket3.
`cargo build --workspace --release --locked --bins`: pass (native macOS).
`pnpm typecheck`, `pnpm test` (408 tests) and `pnpm -r build`: pass.
OpenAPI lint/ref checks, WS schema/positive/negative checks, Rust deterministic
regeneration (305 DTOs/32 operations), and Web regeneration with no diff: pass.

The database tests include atomic Goose adoption, injected rollback/retry,
concurrent migrations, seed collision rollback, persisted legacy fingerprints,
concurrent guess/timeout, duplicate chat submission, frozen rosters, rank
assignment, race/relay settlement, departure/reconnection races, stage barrier
recovery, startup validation before any write, retention, and real WebSocket
replay/live/replacement/shutdown. Unknown rulesets fail before mutation.

The independently generated golden vectors include Go-compatible catalog hash
b54d39d7, immutable search-index bytes/ETag, 5 resolve fingerprints, HMAC chat
cursors, PCG anonymous-column permutations and 25 seeded pairing/first-turn
vectors (including odd rosters and rotated byes).

Two separately seeded databases were served by the native baseline Go binary
and the native Rust binary. A 40-request HTTP differential checked catalog,
search, daily/random sessions, daily guess/duplicate/forfeit, race/relay room
creation/join/ready/snapshot and chat. 39 responses matched after normalizing
identifiers, timestamps, signed cursors, per-identity column permutations and
human-readable error wording. The remaining relay snapshot differed only in
the randomly shuffled member array direction; turn ownership matched. The
25 Go pairing vectors separately prove deterministic algorithm equivalence.
The initial relay creation500 exposed a trigger/config duplicate INSERT and
was fixed to UPSERT, then covered by public router/database tests.

Intentional narrow repairs relative to old Go defects: all-departed elimination
settles a terminal draw; restart before any completed relay stage produces a
readable zero-stage ranking; internal server_restart encounter outcomes map
to the existing HTTP draw enum while the match reason stays server_restart.
No new public schema or gameplay scoring rule was added. Go's early-tie race
winner behavior is preserved explicitly by a golden test.

Browser verification is in progress. The initial optional broad run was **not
successful**: 57 passed,34 failed,3 skipped,18 did not run. Failures include
missing macOS screenshot baselines, stale DOM selectors, a macOS select keyboard
expectation, a mobile-chat timeout, and HSO's separate API URL defaulting to
port4000. Baseline comparison and corrected environment runs will be recorded
below. Visual screenshot assertions are outside the backend-only acceptance;
no missing baseline is recorded as a pass.

## Retirement and browser baseline classification

Removed220 obsolete tracked files including184 Go source/test/generated files,
go.mod/go.sum, sqlc/oapi-codegen configuration, SQLc query sources and original
combined Goose migrations. All23 split SQLx Up/Down migrations retain their
frozen SQL digests. No Go source/module files or active Go build/generation
commands remain. The original checkout is untouched. Rust fmt, strict Clippy,
and all109 tests (including47 database cases) passed again after retirement.
The53 frozen schema/fixture files match their baseline hashes after restoring
one generator-only annotation in memory; this exact exception is recorded in
retirement.json. Rust/Web generated artifacts did not change.

The first five failing browser scenarios were rerun unchanged against the
original native Go binary on the same host/browser. Eight of ten instances
failed in the same way (both mode-tab selectors, both multiplayer suggestion
selectors, mobile chat, desktop Home/End selection); two passed in both.
A second baseline run reproduced the3-player fixed-single-answer fixture stall
in both projects: the current Go and Rust rules forbid reusing an answer group,
so a one-answer pool cannot supply the next round. No answer-reuse rule was
silently introduced to make that old fixture pass. The performance resource
entry timing assertion also failed intermittently against both backends.
These failures are retained as limitations, not converted to passing assertions.

A functional run with corrected HSO API URL, local-primary policy and explicit
write authorization passed87 tests. It excluded the five proven baseline
scenarios and used Playwright --ignore-snapshots for backend functionality;
there is no macOS visual acceptance claim. Remaining failures were the two
single-answer pool cases, one timing assertion and a transient daily-session
reset assertion; the latter and remaining HSO desktop scenarios are checked
separately below. This run does not establish that the full historical browser
suite is green.

## Final acceptance

The remaining HSO functional suite passed16/16 runnable checks; four explicit
legacy-binary combinations were skipped because this run targets the current
Rust backend. The cache/resource timing measurement remains recorded as flaky
on both backends and is not used as compatibility evidence.
The daily browser reset failure was traced to the pagehide save overwriting the
test's injected stale localStorage. The test now injects stale state via
addInitScript before the next document reads it; the existing0/8,1/8,restore,
and rebuild assertions are unchanged. Desktop/mobile each repeated three times:
**6/6 pass**. Web typecheck and diff whitespace checks pass after this test fix.
The backend runtime did not change to accommodate these historical test issues.

R01–R09 and claims C1–C6 are accepted for this local source rewrite. Full browser
visual/regression suite is explicitly not accepted as green: original-Go
failures, single-answer fixture exhaustion, and missing macOS screenshots remain
reported above. No production service, production database or deployed instance
was changed. Production Docker configuration was statically validated only;
application images were not built/run locally under the user's Docker constraint.

Final source identity: implementation-sha256.json (136 files), Cargo.lock,
retirement.json and the frozen baseline manifests. New TypeScript/WS wire
schemas were not introduced. API DTO generation remains305 types/32 operations.
All Go source has been removed from this worktree; the Git baseline remains the
recovery source. Unrelated user files in either checkout were not edited.

Temporary native Go/Rust comparison servers, native Next test server and the
isolated PostgreSQL container were stopped and removed after verification.
The temporary Go executable was removed. Existing user databases were untouched.

## Thiserror follow-up — R10 (2026-10-13)

User authorization: “完善”, following the error-handling audit. The earlier
functional acceptance did not prove retained error causes or useful operational
diagnostics; this item closes that gap. The earlier browser baseline failures
and production/deployment limitations remain unchanged.

- Added typed `ErrorCause`, `GameError` variants and thiserror derives for the
  HTTP, game, cursor, hello and output errors. SQLx/JSON/task/queue sources survive
  `?` propagation, custom public mappings and shared catalog cache failures.
  Removed the unconstrained `db_error` and string comparisons on GameError.
- Replaced anonymous internal failures with fixed invariant descriptions. HTTP
  5xx and background/WS/readiness errors report allowlisted cause categories,
  SQLSTATE, operation and source location. HTTP spans contain route templates.
  Raw source Display/Debug, query parameters, tokens and DB detail/hint are not
  formatted in these diagnostics. Existing wire responses remain unchanged.
- Sweep continues independent cleanup steps, logs each failure and returns the
  first original cause. WS authentication retains database errors even though
  the old 1008/unauthorized close contract remains. Replay, publication and
  disconnect failures have diagnostics. Server shutdown retains task outcomes.
- Regression first reproduced the discarded SQLx cause (failed before fix).
  Fault tests additionally caught Arc source forwarding skipping the original
  leaf; shared sources now preserve downcastable SQLx/JSON errors. Real
  PostgreSQL RAISE EXCEPTION details remain inspectable in the source while
  structured diagnostics expose only classification and SQLSTATE. Corrupt
  catalog loads retain their cause and successfully retry after repair.

Verification on native Rust 1.99.0, isolated PostgreSQL 18.4 (only DB in Docker):

- `cargo test --workspace --locked -- --include-ignored`: **pass**, 119 passed,
  0 failed, 0 ignored. Includes 10 new regressions; full output is
  [error-handling-tests.log](error-handling-tests.log).
- `cargo clippy --workspace --all-targets --locked -- -D warnings`: **pass**.
- `cargo fmt --all -- --check`: **pass**.
- `cargo build --workspace --bins --locked`: **pass**.
- `node scripts/check-multiplayer-boundaries.mjs`: **pass**, 55 source files.
- `node --test scripts/check-multiplayer-boundaries.test.mjs`: **pass**, 5 checks.
- Native migrate + seed + GET /readyz + SIGTERM shutdown against a fresh unique
  database: **pass**, exit 0. Temporary database and native process removed.
- API Go source scan: 0 files. `git diff --check`: **pass**.

Current code identity is [error-handling-sha256.json](error-handling-sha256.json);
`implementation-sha256.json` remains the historical pre-follow-up identity.
Frontend/browser and release-container checks were not rerun for this backend
error-handling change; their earlier results are historical, not new evidence.
No production operations, commit, push or PR were performed.

## Dependency upgrades — R11 (2026-10-13)

User authorized the dependency upgrades, then explicitly excluded
tokio-tungstenite. The application now directly uses base64 0.23.1, hmac 0.13.0,
rand 0.10.3 and sha2 0.11.1. Both Axum's server dependency and the test client
remain on tokio-tungstenite 0.29.0. The dependency graph contains no 0.30 copy.
Research and upstream constraints are recorded in
[stack-research.md](stack-research.md#dependency-follow-up--r11-2026-10-13).

Adapted HMAC key construction and operating-system RNG imports/error types.
Initial compilation exposed the new digest output's missing LowerHex; explicit
two-digit lowercase byte formatting preserves the original hash representation.
Existing golden vectors and migration-baseline data were not changed. Added one
regression for SysError source retention and HTTP/log redaction. Older transitive
base64, rand and sha2 versions remain where Axum/SQLx/tungstenite require them.

Verification on native Rust 1.99.0 with an isolated PostgreSQL 18.4 database
(only PostgreSQL ran in Docker):

- `cargo test --workspace --locked -- --include-ignored`: **pass**, 120 passed,
  0 failed, 0 ignored; [full output](dependency-upgrade-tests.log).
- Includes signed cursor and token hash goldens, HMAC-derived column ordering,
  SHA-256 catalog/ETag and resolve fingerprints, frozen migration checksums,
  real database transactions/concurrency, WebSocket and source-chain checks.
- `cargo clippy --workspace --all-targets --locked -- -D warnings`: **pass**.
- `cargo fmt --all -- --check`: **pass**.
- `cargo build --workspace --bins --locked`: **pass**.
- Architecture boundaries: **pass**, 55 Rust source files and 5 checker tests.
- `git diff --check`: **pass**; API Go source scan: 0 files.

Current code identity is
[dependency-upgrade-sha256.json](dependency-upgrade-sha256.json). Previous
identity manifests and verification logs remain historical evidence. The
disposable PostgreSQL container was removed after the test run. No frontend or
release-container rerun, production changes, commit, push or PR were performed.

## Layered architecture — R12 (2026-10-13)

User requested an explicit layered architecture because handlers were difficult
to locate. All 32 OpenAPI operations plus the extra operational/WS endpoints now
register in `src/router.rs` and target concrete functions in `src/handler`.
`app.rs` owns shared-state construction; the previous mixed `server.rs` is gone.
HTTP extraction, statuses, JSON/headers, CORS/logging and socket framing are in
handlers. Plain use-case inputs/results, permissions, transactions and publication
live in `service`; reusable SQLx reads, row models and event writes in `repository`;
chat/relay rules in `domain`. Game and realtime primitives retain their boundaries.

Services deliberately remain transaction owners, including use-case-specific SQL;
this is not a claim that every SQL statement moved into a generic repository.
Repository operations receive a pool or the caller's transaction connection and
do not depend on AppState/services. Deferred plain `Result` inputs retain the
existing authentication/mode-validation precedence over extraction errors.
Chat throttling/resync outcomes become HTTP responses only in the handler.
WebSocket replay and persistent connection changes are application operations.

Verification on native Rust 1.99.0 and isolated PostgreSQL 18.4 (database-only Docker):

- Full Rust suite: **122 passed, 0 failed, 0 ignored**, including the complete
  database, concurrency, migration, cryptographic golden and WebSocket suites.
  [Full output](layered-architecture-tests.log).
- Two new regressions cover auth/mode/body-error precedence and metrics response
  headers when the database is unavailable. Existing tests still verify 201/204,
  cache validators/304, Retry-After, source chains and privacy projections.
- Architecture checker: **pass**, 77 source files; **10 checker tests passed**.
  New negative tests first failed with the old checker. The updated rules reject
  handler SQL/pool access, service HTTP adapters/responses, repository dependencies
  on application state, domain I/O, and decentralized route registration.
  The route inventory test checks all frozen operations and concrete handler targets.
  [Checker output](layered-architecture-boundaries.log).
- `cargo clippy --workspace --all-targets --locked -- -D warnings`: **pass**.
- `cargo fmt --all -- --check`: **pass**.
- `cargo build --workspace --bins --locked`: **pass**.
- Compared with the pre-refactor archive: all **191 SQL string occurrences** are
  unchanged; Cargo manifests/lock and generated DTO/schema/operation files are
  byte-identical. No schema or dependency change is part of this refactor.
- `git diff --check`: **pass**; API Go source files: **0**.

The directory responsibilities and URL-to-handler examples are documented in
[architecture.md](../architecture.md#后端结构). Current code identity is
[layered-architecture-sha256.json](layered-architecture-sha256.json); earlier
manifests remain historical. The temporary PostgreSQL container was removed.
Frontend/browser and release-image checks were not rerun for this internal backend
reorganization. No production changes, commit, push or PR were performed.
Commit preparation: removed extra trailing blank lines in the Cargo/toolchain
manifests, research notes and saved test output. No executable content or dependency
version changed; the current identity manifest records this normalization. The
full test results above apply to the same executable content.


## SQLx query macros — R13 (2026-10-13)

Converted every application/repository/seed query to `query!`, `query_as!` or
`query_scalar!`: 189 call sites, 176 distinct checked-in query metadata files.
Named projections replace `SELECT *` where a row struct is constructed; fixed
locking variants have separate literal queries. Room infinity handling, nullable
fields, JSON encoding, SQL parameters and transaction/commit boundaries remain.
The migration bootstrap and historical-schema/fixture/failure-injection tests
retain runtime queries. No unchecked query macros or dependency upgrades added.

Default Cargo compilation uses `.sqlx` offline metadata. The native pinned CLI
script creates a random disposable database, applies all migrations, prepares or
checks workspace/all-target metadata, then drops the database. CI runs the same
check; Taskfile and development instructions expose prepare/check commands. The
production Dockerfile now copies `.cargo` and `.sqlx` into the builder.

Verification (native Rust 1.99.0; PostgreSQL 18.4 was the only task workload in Docker):

- Full suite: **122 passed, 0 failed, 0 ignored**, including DB concurrency,
  migrations, seed, HTTP and WebSocket tests; [output](sqlx-macros-tests.txt).
- Initial regression exposed a test that waited for a lock by matching the old
  `SELECT e.*` text. It now observes `pg_blocking_pids` for the connection holding
  the lock; the original post-lock clock/timeout assertions remain and pass.
- Prepare/check against a fresh migrated database: **pass**. Removing one cache
  entry caused the expected nonzero stale-cache failure, and the temporary DB was
  still deleted. The cache was restored and the complete positive check passed.
- Offline negative check: binding an i64 to a text parameter failed compilation
  with a type mismatch. The source was restored byte-for-byte afterward.
- Stopped PostgreSQL, cleaned the API package build artifacts, and built all native
  binaries with DATABASE_URL/SQLX_OFFLINE unset: **pass**, using Cargo's default
  offline setting. Offline all-target Clippy with `-D warnings`: **pass**.
- Formatting, 77-file architecture scan, 10 checker tests and diff checks: **pass**.
- The isolated database container has been removed; Cargo.lock, migrations and
  public HTTP/WS contracts are unchanged. No Go source was introduced.

[Verification details](sqlx-macros-verification.json) and
[current artifact identity](sqlx-macros-sha256.json) supersede earlier identity
manifests for this follow-up. Frontend/browser and production image execution were
not rerun; no production operations, commit or push were performed in R13.
