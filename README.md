# TouhouFlandre / 东方芙一把

TouhouFlandre（东方芙一把）is a playable Touhou Project themed character guessing game. Players guess a hidden character and use structured tag feedback to narrow down the answer.

This repository is organized as a standard open-source web project with a pnpm workspace:

- `apps/web`: Next.js 16 App Router, React, TypeScript, and Tailwind CSS v4 frontend.
- `apps/api`: Go + Echo API server (OpenAPI-validated, Postgres-backed).
- `packages/shared`: shared game types, field definitions, mode configs, and sharing utilities (authoritative game rules live in the Go `apps/api` package).
- `packages/data`: validated Touhou character, portrait metadata, and work data.
- `docs`: gameplay and product planning documents.

## Local Development

Prerequisites: Node.js 24 (LTS) or later, pnpm 11, Go 1.26+, Docker (for Postgres), and [Task](https://taskfile.dev/). Copy `.env.example` to `.env`, then run:

```bash
pnpm install
task db:up        # start Postgres via Docker Compose
task db:migrate   # apply goose migrations
task db:seed      # validate catalog and seed it into Postgres
pnpm dev          # = task dev: start Go API and web app together
```

`task db:up` starts a disposable Postgres container on port `5433`. Runtime data (daily puzzles, sessions) is not preserved across a fresh database; the catalog is rebuilt from `packages/data` by `task db:seed`.

The API runs on `http://localhost:4000`.
The web app runs on `http://localhost:5173`.

## Scripts

- `pnpm dev` / `task dev`: start the Go API and web app together.
- `pnpm build`: build all workspace packages.
- `pnpm test`: run shared, data, and web (Vitest + RTL) tests.
- `pnpm typecheck`: type-check all workspace packages.
- `pnpm test:e2e` (in `apps/web`): run Playwright E2E (needs `task dev` running).
- `go test ./...` (in `apps/api`): run Go unit and integration tests (needs a reachable Postgres).
- `task db:up` / `db:down`: start/stop the local Postgres container.
- `task db:migrate`: apply goose migrations.
- `task db:seed`: validate the catalog and seed it into Postgres.
- `task gen`: regenerate OpenAPI types, sqlc queries, and the web API client (`gen:openapi` + `gen:repo` + `gen:web`).

## Demo Scope

The current release includes a project home page, nested routes, daily puzzles, random puzzles, sortable character search with icon and list views, guess feedback, result sharing, and local session persistence through the API. Login, leaderboards, multiplayer rooms, and an admin panel are intentionally left as future modules.

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

## Content Notice

TouhouFlandre is an unofficial fan project. It is not affiliated with Team Shanghai Alice or any official publisher. Touhou Project names and settings belong to their respective rights holders.

Character pixel portraits are third-party assets used under their respective terms. These images are not covered by the repository's MIT license. See [THIRD_PARTY_ASSETS.md](./THIRD_PARTY_ASSETS.md) for attribution and licensing details.

## License

The original source code in this repository is available under the [MIT License](./LICENSE). Third-party assets, Touhou Project names, characters, and settings are excluded and remain subject to their respective owners' terms.
