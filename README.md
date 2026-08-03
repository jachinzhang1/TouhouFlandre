# TouhouFlandre / 东方角色芙一把

TouhouFlandre（东方角色芙一把）is a playable Touhou Project themed character guessing game. Players guess a hidden character and use structured tag feedback to narrow down the answer.

This repository is organized as a standard open-source web project with a pnpm workspace:

- `apps/web`: Vite, React, and TypeScript frontend.
- `apps/api`: Express and TypeScript API server.
- `packages/shared`: shared game types, field definitions, comparators, daily puzzle logic, and sharing utilities.
- `packages/data`: demo Touhou character and work data.
- `prisma`: SQLite schema and seed script.
- `docs`: gameplay and product planning documents.

## Local Development

```bash
pnpm install
pnpm db:push
pnpm seed
pnpm dev
```

The API runs on `http://localhost:4000`.
The web app runs on `http://localhost:5173`.

## Scripts

- `pnpm dev`: start the API and web app together.
- `pnpm test`: run shared game logic tests.
- `pnpm typecheck`: type-check all workspace packages.
- `pnpm db:push`: create or update the local SQLite database.
- `pnpm seed`: import the demo character data.

## Demo Scope

The first demo includes a promo home page, nested routes, daily puzzles, random puzzles, character search, guess feedback, result sharing, and local session persistence through the API. Login, leaderboards, multiplayer rooms, and an admin panel are intentionally left as future modules.

Playable routes:

- `/`: home page
- `/search`: character search
- `/single`: game mode lobby
- `/single/daily`: daily puzzle
- `/single/random`: random puzzle
- `/multi`, `/multi/room`, `/stats`, `/leaderboard`, `/announcement`, `/admin`: scaffolded future pages

The enabled guess tags for the demo are first appearance, release year, species, affiliation, main location, and hair color. Character search includes names, aliases, romanization, first appearance work title, work id, and TH number.

## Content Notice

TouhouFlandre is an unofficial fan project. It is not affiliated with Team Shanghai Alice or any official publisher. Touhou Project names and settings belong to their respective rights holders. The demo uses text-based placeholders rather than character artwork to avoid asset licensing issues.
