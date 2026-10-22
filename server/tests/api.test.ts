import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createApp } from "../src/app.ts";
import { calculateScore, openDatabase, runMigrations } from "../src/database.ts";
import type { RunInput } from "../src/schemas.ts";

const startedAt = "2026-10-22T10:00:00.000Z";
const endedAt = "2026-10-22T10:05:00.000Z";

function fixture(options: Parameters<typeof createApp>[1] = {}) {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  return { app: createApp(db, options), db };
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "event-0001",
    sessionId: "session-0001",
    runId: "run-0000001",
    type: "recruit",
    timestamp: startedAt,
    elapsed: 2.5,
    properties: { role: "frontend", cost: 55 },
    ...overrides
  };
}

function run(overrides: Partial<RunInput> = {}): RunInput {
  return {
    runId: "run-0000001",
    sessionId: "session-0001",
    startedAt,
    endedAt,
    result: "win",
    completedRequests: 10,
    recruitCount: 4,
    missedRequests: 2,
    finalEra: 2,
    finalTechDebt: 100,
    finalProjectHealth: 90,
    gameVersion: "0.1.0",
    ...overrides
  };
}

async function postJson(app: ReturnType<typeof createApp>, path: string, payload: unknown) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(payload)
  });
}

test("migration creates durable event and run tables exactly once", () => {
  const db = new DatabaseSync(":memory:");
  assert.deepEqual(runMigrations(db), ["0001_initial.sql", "0002_analytics_fields.sql"]);
  assert.deepEqual(runMigrations(db), []);
  const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((row) => row.name);
  assert.deepEqual(names, ["game_events", "game_runs", "schema_migrations"]);
  db.close();
});

test("event API stores a single event and acknowledges exact retries idempotently", async () => {
  const { app, db } = fixture();
  const payload = event();
  const first = await postJson(app, "/api/events", payload);
  const retry = await postJson(app, "/api/events", payload);
  assert.equal(first.status, 202);
  assert.deepEqual(await first.json(), { ok: true, received: 1, inserted: 1, duplicates: 0 });
  assert.equal(retry.status, 202);
  assert.deepEqual(await retry.json(), { ok: true, received: 1, inserted: 0, duplicates: 1 });
  assert.equal(db.prepare("SELECT count(*) AS n FROM game_events").get()?.n, 1);
  assert.equal(db.prepare("SELECT properties_json FROM game_events").get()?.properties_json, JSON.stringify(payload.properties));
  db.close();
});

test("event API accepts batches and deduplicates repeated event IDs", async () => {
  const { app, db } = fixture();
  const first = event();
  const second = event({ eventId: "event-0002", type: "era_upgrade", elapsed: 80 });
  const response = await postJson(app, "/api/events", { events: [first, second, first] });
  assert.equal(response.status, 202);
  assert.deepEqual(await response.json(), { ok: true, received: 3, inserted: 2, duplicates: 1 });
  assert.equal(db.prepare("SELECT count(*) AS n FROM game_events").get()?.n, 2);
  db.close();
});

test("legacy event shape without eventId receives a stable retry key", async () => {
  const { app, db } = fixture();
  const { eventId: _ignored, ...legacy } = event();
  const first = await postJson(app, "/api/events", legacy);
  const retry = await postJson(app, "/api/events", legacy);
  assert.equal(first.status, 202);
  assert.equal(retry.status, 202);
  assert.equal(db.prepare("SELECT count(*) AS n FROM game_events").get()?.n, 1);
  db.close();
});

test("event API rejects unknown event types and mixed-session batches", async () => {
  const { app, db } = fixture();
  const unknown = await postJson(app, "/api/events", event({ type: "made_up" }));
  const mixed = await postJson(app, "/api/events", [event(), event({ eventId: "event-0002", sessionId: "session-0002" })]);
  assert.equal(unknown.status, 400);
  assert.equal(mixed.status, 400);
  db.close();
});

test("event ID reuse with different content is rejected", async () => {
  const { app, db } = fixture();
  assert.equal((await postJson(app, "/api/events", event())).status, 202);
  const conflict = await postJson(app, "/api/events", event({ properties: { role: "qa" } }));
  assert.equal(conflict.status, 409);
  db.close();
});

test("event API rejects oversized bodies and malformed JSON", async () => {
  const { app, db } = fixture();
  const tooLarge = await app.request("/api/events", {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ data: "x".repeat(70_000) })
  });
  const invalidJson = await app.request("/api/events", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{"
  });
  assert.equal(tooLarge.status, 413);
  assert.equal(invalidJson.status, 400);
  db.close();
});

test("event API accepts a sendBeacon text payload and answers browser CORS preflight", async () => {
  const { app, db } = fixture();
  const beacon = await app.request("/api/events", {
    method: "POST",
    headers: { "content-type": "text/plain;charset=UTF-8" },
    body: JSON.stringify(event())
  });
  const preflight = await app.request("/api/events", {
    method: "OPTIONS",
    headers: {
      origin: "https://game.example",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type"
    }
  });
  assert.equal(beacon.status, 202);
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-origin"), "*");
  assert.match(preflight.headers.get("access-control-allow-methods") ?? "", /POST/);
  db.close();
});

test("per-session event rate limit returns 429 without writing rejected data", async () => {
  let time = 1_000;
  const { app, db } = fixture({ maxPerMinute: 1, now: () => time });
  assert.equal((await postJson(app, "/api/events", event())).status, 202);
  assert.equal((await postJson(app, "/api/events", event({ eventId: "event-0002" }))).status, 429);
  time += 60_001;
  assert.equal((await postJson(app, "/api/events", event({ eventId: "event-0003" }))).status, 202);
  assert.equal(db.prepare("SELECT count(*) AS n FROM game_events").get()?.n, 2);
  db.close();
});

test("run API calculates deterministic score, stores result and treats identical retries as idempotent", async () => {
  const { app, db } = fixture();
  const payload = run();
  const first = await postJson(app, "/api/runs", payload);
  const retry = await postJson(app, "/api/runs", payload);
  assert.equal(calculateScore(payload), 2_200);
  assert.equal(first.status, 201);
  const body = await first.json() as {
    ok: boolean; duplicate: boolean; run: Record<string, unknown>;
    achievements: Array<{ id: string; unlocked: boolean }>; achievementPoints: number;
    unlockedAchievements: number; rank: { rank: number; total: number };
  };
  assert.equal(body.ok, true);
  assert.equal(body.duplicate, false);
  assert.deepEqual(body.run, { ...payload, nickname: null, score: 2_200 });
  assert.equal(body.rank.rank, 1);
  assert.equal(body.achievements.length, 20);
  assert.equal(body.unlockedAchievements, body.achievements.filter((achievement) => achievement.unlocked).length);
  assert.ok(body.achievementPoints > 0);
  assert.equal(retry.status, 200);
  const retryBody = await retry.json() as { duplicate: boolean; run: Record<string, unknown> };
  assert.equal(retryBody.duplicate, true);
  assert.deepEqual(retryBody.run, { ...payload, nickname: null, score: 2_200 });
  assert.equal(db.prepare("SELECT count(*) AS n FROM game_runs").get()?.n, 1);
  db.close();
});

test("run API rejects invalid duration, impossible win state and client-supplied score", async () => {
  const { app, db } = fixture();
  const negativeDuration = await postJson(app, "/api/runs", run({ endedAt: "2026-10-22T09:59:00.000Z" }));
  const zeroHealthWin = await postJson(app, "/api/runs", run({ finalProjectHealth: 0 }));
  const emptyWin = await postJson(app, "/api/runs", run({ completedRequests: 0 }));
  const suppliedScore = await postJson(app, "/api/runs", { ...run(), score: 99_999 });
  assert.equal(negativeDuration.status, 400);
  assert.equal(zeroHealthWin.status, 400);
  assert.equal(emptyWin.status, 400);
  assert.equal(suppliedScore.status, 400);
  db.close();
});

test("run ID reuse with different result is rejected", async () => {
  const { app, db } = fixture();
  assert.equal((await postJson(app, "/api/runs", run())).status, 201);
  const conflict = await postJson(app, "/api/runs", run({ completedRequests: 9 }));
  assert.equal(conflict.status, 409);
  db.close();
});

test("health route confirms local database is ready", async () => {
  const { app, db } = fixture();
  const response = await app.request("/api/health");
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true });
  db.close();
});

test("two anonymous sessions persist separate events and results across database reopen", async () => {
  const directory = mkdtempSync(join(tmpdir(), "never-ending-requirements-api-"));
  const databasePath = join(directory, "game.sqlite");
  let db = openDatabase(databasePath);
  try {
    runMigrations(db);
    const app = createApp(db);
    for (const player of ["a", "b"] as const) {
      const sessionId = `session-player-${player}`;
      const runId = `run-player-${player}`;
      const eventResponse = await postJson(app, "/api/events", event({
        eventId: `event-player-${player}`,
        sessionId,
        runId,
        type: "game_start",
        properties: { mode: "campaign" }
      }));
      const runResponse = await postJson(app, "/api/runs", run({
        runId,
        sessionId,
        result: player === "a" ? "win" : "loss",
        completedRequests: player === "a" ? 12 : 4
      }));
      assert.equal(eventResponse.status, 202);
      assert.equal(runResponse.status, 201);
    }
    db.close();
    db = openDatabase(databasePath);
    const sessions = (db.prepare("SELECT DISTINCT session_id FROM game_events ORDER BY session_id").all() as Array<{ session_id: string }>).map((row) => row.session_id);
    const runs = db.prepare("SELECT count(*) AS n FROM game_runs").get() as { n: number };
    assert.deepEqual(sessions, ["session-player-a", "session-player-b"]);
    assert.equal(runs.n, 2);
    assert.equal(db.prepare("SELECT result FROM game_runs WHERE run_id = 'run-player-a'").get()?.result, "win");
  } finally {
    db.close();
    rmSync(directory, { recursive: true, force: true });
  }
});
