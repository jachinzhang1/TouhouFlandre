# TouhouFlandre / 东方角色芙一把

TouhouFlandre（东方角色芙一把）is a playable Touhou Project themed character guessing game. Players guess a hidden character and use structured tag feedback to narrow down the answer.

This repository is organized as a standard open-source web project with a pnpm workspace:

- `apps/web`: Vite, React, and TypeScript frontend.
- `apps/api`: Express and TypeScript API server.
- `packages/shared`: shared game types, field definitions, comparators, daily puzzle logic, and sharing utilities.
- `packages/data`: validated Touhou character, portrait metadata, and work data.
- `prisma`: SQLite schema, migrations, and seed script.
- `docs`: gameplay and product planning documents.

## Local Development

Prerequisites: Node.js 20.19+ or 22.12+ and pnpm 11. Copy `.env.example` to `.env`, then run:

```bash
pnpm install
pnpm exec prisma migrate deploy
pnpm seed
pnpm dev
```

`prisma migrate deploy` expects an empty database or one already managed by Prisma migrations. For a disposable local database that contains tables but no migration history (`P3005`), either point `DATABASE_URL` to a new SQLite file or use `pnpm db:push` to synchronize that local schema.

The API runs on `http://localhost:4000`.
The web app runs on `http://localhost:5173`.

## Scripts

- `pnpm dev`: start the API and web app together.
- `pnpm build`: build all workspace packages.
- `pnpm test`: run all shared, data, and API tests.
- `pnpm typecheck`: type-check all workspace packages.
- `pnpm db:generate`: regenerate Prisma Client after schema changes.
- `pnpm exec prisma migrate deploy`: apply the checked-in database migrations.
- `pnpm db:push`: sync local schema experiments without creating a migration.
- `pnpm seed`: synchronize the demo character and work catalog.

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

Character cards and portraits are generated from the database. Add or update the character record and its `avatarUrl` in `packages/data/src/characters.demo.json`, then run `pnpm seed`; no frontend mapping needs to be maintained.

The four-digit portrait filename prefix is also the character appearance order. For example, `0801` sorts before `0802`, while `0751` is placed between seventh- and eighth-title characters. Portraits without catalog records are intentionally retained for future expansion.

## Content Notice

TouhouFlandre is an unofficial fan project. It is not affiliated with Team Shanghai Alice or any official publisher. Touhou Project names and settings belong to their respective rights holders.

Character pixel portraits are third-party assets used under their respective terms. These images are not covered by the repository's MIT license. See [THIRD_PARTY_ASSETS.md](./THIRD_PARTY_ASSETS.md) for attribution and licensing details.

## License

The original source code in this repository is available under the [MIT License](./LICENSE). Third-party assets, Touhou Project names, characters, and settings are excluded and remain subject to their respective owners' terms.
