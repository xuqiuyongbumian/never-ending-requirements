# Game API

This is a small, provider-neutral Node.js service. It uses Hono for HTTP routing and SQLite for persistence; there is no Cloudflare Worker, D1 binding, Wrangler configuration, or deployment step in this implementation.

## Requirements and local development

- Node.js 22.13 or newer (`node:sqlite` is built in).
- The repository's root dependencies and the `server/` dependencies installed.

```sh
npm install
npm install --prefix server
npm run db:migrate
npm run dev:server
```

The API listens on `http://127.0.0.1:8787`. Set `DATABASE_PATH` to choose the SQLite file, `PORT` to choose the port, and `HOST` to choose the bind address. The default database path is `server/data/game.sqlite` when commands are run from the repository root. This directory is ignored by Git.

In a second terminal, create `.env.local` in the repository root:

```dotenv
VITE_API_BASE_URL=http://127.0.0.1:8787
VITE_GAME_VERSION=0.1.0
```

Then run `npm run dev`. Leave `VITE_API_BASE_URL` empty for browser-only mode. `VITE_ANALYTICS_ENDPOINT` remains supported as a legacy, one-event collector when the new API base URL is not set.

## Migrations

Migration files live in `server/migrations/` and are recorded in `schema_migrations`.

```sh
npm run db:migrate
```

The initial migration creates `game_events` and `game_runs`, including indexes for time, event type, run ID, result, and score queries. The app also applies pending migrations at startup.

## API

### `GET /api/health`

Returns `{ "ok": true }` when the database connection is usable.

### `POST /api/events`

Accepts a single event, an array, or `{ "events": [...] }`. Batches are limited to 25 events and requests to 64 KiB. Event timestamps must be ISO 8601 UTC strings. `eventId` is optional for compatibility with the previous client shape; when omitted, the server derives a stable SHA-256 ID from the event payload. New clients send UUID event IDs.

```json
{
  "events": [
    {
      "eventId": "8ca77e86-95b4-43a1-a7d1-0e9a6c0833e2",
      "sessionId": "b8d0a194-b4d5-49c1-9990-130fa0eef889",
      "runId": "a203c1db-e561-4fb5-aa0a-2ed33e9876da",
      "type": "recruit",
      "timestamp": "2026-10-22T10:00:00.000Z",
      "elapsed": 12.5,
      "properties": { "role": "frontend", "cost": 55 }
    }
  ]
}
```

Supported types are `enter`, `game_start`, `recruit`, `era_upgrade`, `event_choice`, `requirement_prioritized`, `rush_activated`, `request_complete`, `request_missed`, `debt_change`, `online_incident`, `win`, `loss`, `replay`, `change_event`, `rush_completed`, and `load_error`.

Successful writes return HTTP 202 and `{ "ok": true, "received": 1, "inserted": 1, "duplicates": 0 }`. Repeated identical event IDs are acknowledged without another row. Reusing an ID with different content returns 409.

### `POST /api/runs`

Stores one completed run. `score` is computed by the API and is not accepted from the client.

```json
{
  "runId": "a203c1db-e561-4fb5-aa0a-2ed33e9876da",
  "sessionId": "b8d0a194-b4d5-49c1-9990-130fa0eef889",
  "startedAt": "2026-10-22T10:00:00.000Z",
  "endedAt": "2026-10-22T10:05:00.000Z",
  "result": "win",
  "completedRequests": 12,
  "recruitCount": 4,
  "missedRequests": 1,
  "finalEra": 2,
  "finalTechDebt": 35,
  "finalProjectHealth": 87,
  "gameVersion": "0.1.0"
}
```

Score is `max(0, (win ? 1000 : 0) + completedRequests × 100 + round(finalProjectHealth × 10) - round(finalTechDebt × 5) - missedRequests × 100)`. It is deterministic and covered by tests. A run ID is idempotent; an identical retry returns the original score, while a changed payload returns 409.

## Data and operational limits

- No account, nickname, IP address, or device identifier is requested or stored.
- Event fields are schema-validated and event types are allowlisted. SQL writes use prepared statements.
- JSON bodies are limited to 64 KiB. Per-session rate limits are process-local (80 event requests and 10 run submissions per minute by default); this is a best-effort safeguard for this single-process service, not a distributed abuse-prevention system.
- CORS is open without credentials because the game is anonymous and browser hosted. A public deployment should add an origin allowlist if the hosting URL is known.
- Client-reported run metrics remain untrusted. The score is server-calculated from those metrics, which does not prevent a modified client from fabricating them.
- Leaderboards, aggregate statistics, authentication, and public result browsing are not part of this P0 backend.
- For a future host, keep the SQLite database on a persistent volume and run migrations before accepting traffic. No production host or remote API has been configured or deployed.

## Tests

```sh
npm run test:server
npm run build
```

The API tests use a real in-memory SQLite database and exercise migration, validation, idempotency, score calculation, request limits, and rate limiting.
