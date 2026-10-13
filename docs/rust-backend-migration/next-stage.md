# Runtime handoff

Implementation and retirement are complete; see work.json and evidence.md for
accepted checks and the separately recorded baseline browser-test limitations.
This file replaces the earlier integration proposal.

- Rust1.99.0 / Axum0.8.9 / Tokio1.53.2 / SQLx0.9.0. Axum native WS uses
  tokio-tungstenite0.29; protocol remains touhouflandre-multi.v3.
- Native development: follow ../development.md. Docker runs only PostgreSQL.
- Runtime binaries: server, migrate, seed, healthcheck. Migrations are embedded
  and explicit; startup never mutates the schema automatically.
- Existing Goose databases require stopped old writers, backup, then the
  documented explicit migrate adopt-goose command. No production operation was
  performed during this task. Reversible tail migrations are tested; expanded
  historical roster schemas intentionally do not support full down-to-zero.
- PostgreSQL transactions and durable room events remain authoritative. Publish
  RoomEffect only after commit. Shared events/storage have no concrete mode
  dependency; race and relay are independent.
- Race locks round→match→room. Relay actions lock encounter→room→stage/match;
  stage settlement does not lock sibling encounters, preventing inversions.
- Live, replay and snapshot projections enforce observer privacy. Chat cursors
  and game sequence are separate. Per-identity HMAC/PCG column ordering remains
  byte compatible with the former backend.
- The final local source contains no Go code. Historical planning documents and
  golden JSON provenance still refer to the baseline implementation deliberately.

The original checkout and unrelated local files are unchanged. This worktree
contains the Rust rewrite on codex/rust-axum-backend; no deployment was performed.
