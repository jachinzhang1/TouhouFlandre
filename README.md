# TouhouFlandre / 东方芙一把

TouhouFlandre（东方芙一把）is a playable Touhou Project themed character guessing game. Players guess a hidden character and use structured tag feedback to narrow down the answer.

This repository is organized as a pnpm workspace plus one Go module:

- `apps/web`: Next.js 16 App Router, React, TypeScript, and Tailwind CSS v4 frontend.
- `apps/api`: Go + Echo API server (OpenAPI-validated, Postgres-backed).
- `packages/shared`: frontend/shared types, field definitions, mode configs, search normalization, and sharing utilities. Authoritative game rules live in Go.
- `packages/data`: validated Touhou character, portrait metadata, and work data.
- `contracts/openapi`: the HTTP API contract and source for generated API types.
- `docs`: gameplay, local development, and product planning documents.

## Local Development

Prerequisites:

- Node.js 24 or later
- pnpm 11
- Go 1.26 or later
- Docker with Compose
- [Task](https://taskfile.dev/)

From the repository root:

```bash
cp .env.example .env
pnpm install
task db:up        # start Postgres via Docker Compose
task db:migrate   # apply goose migrations
task db:seed      # validate catalog and seed it into Postgres
pnpm dev          # same as task dev: start Go API and web app together
```

Ensure `.env` contains the Postgres settings from `.env.example`: the API requires `DATABASE_URL_PG`, and migrations require `GOOSE_DBSTRING` plus `GOOSE_DRIVER`.

Open the web app at `http://localhost:5173`. The API listens on `http://localhost:4000`.

`task db:up` starts Postgres on host port `5433` and stores data in the Docker volume `pgdata`. Runtime data such as daily puzzles and sessions persists while that volume exists; for a fresh database, rerun `task db:migrate` and `task db:seed`.

The frontend defaults to same-origin API calls through Next.js rewrites (`/api/*` to the Go API). To bypass the rewrite and call the API directly from the browser, set `NEXT_PUBLIC_API_BASE_URL=http://localhost:4000` in `.env`; `WEB_ORIGINS` already allows the local web origins.

## Scripts

- `pnpm dev` / `task dev`: start Postgres, then start the Go API and web app together.
- `pnpm build`: build all workspace packages.
- `pnpm test`: run shared, data, and web (Vitest + RTL) tests.
- `pnpm typecheck`: type-check all workspace packages.
- `pnpm test:e2e` (in `apps/web`): run Playwright E2E (needs `task dev` running; 多人场景为双 context 双玩家流程，E2E 自动放宽加入限流额度)。
- `go test ./...` (in `apps/api`): run Go unit and integration tests (needs a reachable Postgres).
- `task db:up` / `db:down`: start/stop the local Postgres container.
- `task db:migrate`: apply goose migrations.
- `task db:seed`: validate the catalog and seed it into Postgres.
- `task gen`: regenerate OpenAPI types, sqlc queries, and the web API client. This requires `sqlc` 1.31.1 on `PATH`.

## Demo Scope

The current release includes a project home page, nested routes, daily puzzles, random puzzles, sortable character search with icon and list views, guess feedback, result sharing, local session persistence through the API, and multiplayer rooms (create/join by 6-character code, BO1/3/5/7 formats, realtime racing, anonymous opponent matrix, rematch; guest identity is room-scoped with no leaderboards or cloud saves). Login, leaderboards, and an admin panel are intentionally left as future modules.

Playable routes:

- `/`: home page
- `/search`: character search
- `/single`: game mode lobby
- `/single/daily`: daily puzzle
- `/single/random`: random puzzle
- `/links`: friend links and third-party asset credits
- `/multi`, `/multi/room`, `/stats`, `/leaderboard`, `/announcement`, `/admin`: scaffolded future pages

The enabled guess tags for the demo are first appearance, release year, species, affiliation, main location, and hair color. Character search includes names, aliases, romanization, first appearance work title, work id, and TH number.

Character cards and portraits are generated from the database. Add or update the character record and its `avatarUrl` in `packages/data/src/characters.demo.json`, then run `task db:seed`; no frontend mapping needs to be maintained.

The four-digit portrait filename prefix is also the character appearance order. For example, `0801` sorts before `0802`, while `0751` is placed between seventh- and eighth-title characters. Portraits without catalog records are intentionally retained for future expansion.

## Development Notes

`contracts/openapi/openapi.yaml` is the single source of truth for HTTP endpoints. Contract updates should be followed by `task gen`, with the generated Go and web API types committed together.

Generated files under `apps/api/internal/generated` and `apps/web/src/generated` should not be edited by hand. Database schema changes belong in `apps/api/migrations`; apply them with `task db:migrate`, regenerate sqlc output with `task gen:repo`, then reseed the catalog with `task db:seed`.

## Content Notice

TouhouFlandre is an unofficial fan project. It is not affiliated with Team Shanghai Alice or any official publisher. Touhou Project names and settings belong to their respective rights holders.

Character pixel portraits are third-party assets used under their respective terms. These images are not covered by the repository's MIT license. See [THIRD_PARTY_ASSETS.md](./THIRD_PARTY_ASSETS.md) for attribution and licensing details.

## License

The original source code in this repository is available under the [MIT License](./LICENSE). Third-party assets, Touhou Project names, characters, and settings are excluded and remain subject to their respective owners' terms.
