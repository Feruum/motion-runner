# Motion Runner API

The Hono API serves health checks and the Classic Run leaderboard. It defaults to Bun's local SQLite database, so it can run without Supabase credentials.

## Run locally

From the repository root:

```sh
bun install
bun run --filter @motion-runner/api dev
```

The API listens on `127.0.0.1:3002` by default. Set `API_HOST`, `API_PORT`, or `DATABASE_PATH` to override the local settings. SQLite data is stored in `apps/api/data/leaderboard.sqlite` and is ignored by Git.

Use `bun run --filter @motion-runner/api test` and `bun run --filter @motion-runner/api check` to run the API tests and TypeScript check.

## Routes

- `GET /api/health` reports that the API is running and identifies its configured storage.
- `GET /api/leaderboard?limit=10&playerId=<uuid>` returns ranked entries and, when requested, that player's best result. The limit is capped at 25.
- `POST /api/leaderboard` submits `{ "playerId": "<uuid>", "name": "Runner", "score": 100, "cleared": 11, "collisions": 0 }`. The API validates the payload and keeps only a player's best score for the mode.

## Use Supabase

1. Create a Supabase project and run [`../../supabase/migrations/202609290001_leaderboard.sql`](../../supabase/migrations/202609290001_leaderboard.sql) once in its SQL Editor.
2. Copy `.env.example` to `.env` in `apps/api` and set `LEADERBOARD_STORAGE=supabase`, `SUPABASE_URL`, and `SUPABASE_SECRET_KEY`.
3. Restart the API. Keep the Supabase secret on the API host only; never expose it to browser code or commit it.

The migration enables row-level security, denies direct access to browser roles, and exposes reads and atomic best-score submissions to the server role. GitHub Pages hosts only the static game; a shared leaderboard also needs this Hono API deployed on a reachable Bun-compatible host with those server-side environment variables configured. Live Supabase credentials and deployment are not configured in this repository.
