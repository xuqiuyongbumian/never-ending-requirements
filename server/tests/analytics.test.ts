import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";
import { createApp } from "../src/app.ts";
import { runMigrations } from "../src/database.ts";

const startedAt = "2026-10-22T10:00:00.000Z";
const endedAt = "2026-10-22T10:05:00.000Z";

function fixture(options: Parameters<typeof createApp>[1] = {}) {
  const db = new DatabaseSync(":memory:");
  runMigrations(db);
  return { app: createApp(db, options), db };
}

async function postJson(app: ReturnType<typeof createApp>, path: string, payload: unknown, headers: Record<string, string> = {}) {
  return app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(payload)
  });
}

function event(overrides: Record<string, unknown> = {}) {
  return {
    eventId: "event-analytics-1",
    sessionId: "session-analytics-1",
    runId: "run-analytics-1",
    type: "recruit",
    timestamp: startedAt,
    elapsed: 2.5,
    properties: { role: "frontend", cost: 55 },
    ...overrides
  };
}

function run(overrides: Record<string, unknown> = {}) {
  return {
    runId: "run-analytics-1",
    sessionId: "session-analytics-1",
    startedAt,
    endedAt,
    result: "win",
    completedRequests: 12,
    recruitCount: 4,
    missedRequests: 0,
    finalEra: 2,
    finalTechDebt: 0,
    finalProjectHealth: 100,
    gameVersion: "0.1.0",
    ...overrides
  };
}

async function seedSession(
  app: ReturnType<typeof createApp>,
  options: {
    sessionId: string;
    runId: string;
    nickname?: string;
    result?: "win" | "loss";
    choices?: string[];
    rushes?: number;
    finalDebt?: number;
    health?: number;
    completed?: number;
    missed?: number;
    era?: number;
    recruits?: number;
    startedAt?: string;
    endedAt?: string;
  }
): Promise<void> {
  const sessionId = options.sessionId;
  const runId = options.runId;
  const sessionStartedAt = options.startedAt ?? startedAt;
  const sessionEndedAt = options.endedAt ?? endedAt;
  const events: Array<Record<string, unknown>> = [
    {
      eventId: `${runId}-start`, sessionId, runId, type: "game_start",
      timestamp: sessionStartedAt, elapsed: 0,
      properties: options.nickname ? { nickname: options.nickname } : {}
    }
  ];
  let sequence = 0;
  for (const choice of options.choices ?? []) {
    sequence += 1;
    events.push({
      eventId: `${runId}-choice-${sequence}`, sessionId, runId, type: "event_choice",
      timestamp: sessionEndedAt, elapsed: sequence,
      properties: { event: choice.split(":")[0] ?? "scope-creep", choice: choice.split(":")[1] ?? choice }
    });
  }
  for (let index = 0; index < (options.rushes ?? 0); index += 1) {
    events.push({
      eventId: `${runId}-rush-${index}`, sessionId, runId, type: "rush_activated",
      timestamp: sessionEndedAt, elapsed: 10 + index,
      properties: { duration: 12, workBonus: 0.4, techDebt: 25 }
    });
  }
  const completed = options.completed ?? 12;
  for (let index = 0; index < completed; index += 1) {
    events.push({
      eventId: `${runId}-done-${index}`, sessionId, runId, type: "request_complete",
      timestamp: sessionEndedAt, elapsed: 30 + index,
      properties: { request: index === completed - 1 && options.result !== "loss" ? "GO-LIVE" : `R-${index + 1}`, final: index === completed - 1 }
    });
  }
  for (let index = 0; index < (options.missed ?? 0); index += 1) {
    events.push({
      eventId: `${runId}-miss-${index}`, sessionId, runId, type: "request_missed",
      timestamp: sessionEndedAt, elapsed: 20 + index,
      properties: { request: `R-M${index + 1}`, severity: 10 }
    });
  }
  events.push({
    eventId: `${runId}-debt`, sessionId, runId, type: "debt_change",
    timestamp: sessionEndedAt, elapsed: 200,
    properties: { from: 0, to: options.finalDebt ?? 0, delta: options.finalDebt ?? 0, reason: "test" }
  });
  events.push({
    eventId: `${runId}-result`, sessionId, runId, type: options.result === "loss" ? "loss" : "win",
    timestamp: sessionEndedAt, elapsed: 300,
    properties: { result: options.result === "loss" ? "defeat" : "victory" }
  });

  for (let index = 0; index < events.length; index += 25) {
    const eventResponse = await postJson(app, "/api/events", { events: events.slice(index, index + 25) });
    assert.equal(eventResponse.status, 202);
  }
  const runResponse = await postJson(app, "/api/runs", run({
    sessionId,
    runId,
    nickname: options.nickname,
    result: options.result ?? "win",
    completedRequests: completed,
    recruitCount: options.recruits ?? 4,
    missedRequests: options.missed ?? 0,
    finalEra: options.era ?? 2,
    finalTechDebt: options.finalDebt ?? 0,
    finalProjectHealth: options.health ?? 100
  }));
  assert.ok(runResponse.status === 201 || runResponse.status === 200);
}

test("public leaderboard hides session ids and supports sorting", async () => {
  const { app, db } = fixture();
  await seedSession(app, { sessionId: "session-alpha", runId: "run-alpha-0001", nickname: "Alpha", finalDebt: 0, health: 100, completed: 12 });
  await seedSession(app, {
    sessionId: "session-beta", runId: "run-beta-0001", nickname: "Beta", result: "loss",
    finalDebt: 30, health: 0, completed: 3, missed: 5, era: 0
  });

  const response = await app.request("/api/leaderboard?limit=10&sort=score&sessionId=session-alpha");
  assert.equal(response.status, 200);
  const body = await response.json() as {
    entries: Array<Record<string, unknown> & { displayName: string; isYou: boolean; playerKey: string }>;
  };
  assert.equal(body.entries.length, 2);
  assert.equal(body.entries[0].displayName, "Alpha");
  assert.equal(body.entries[0].isYou, true);
  assert.equal(body.entries[0].sessionId, undefined);
  assert.match(body.entries[0].playerKey, /^[a-f0-9]{10}$/);
  assert.equal(body.entries[1].displayName, "Beta");

  const wins = await app.request("/api/leaderboard?sort=wins");
  const winsBody = await wins.json() as { entries: Array<{ displayName: string }> };
  assert.deepEqual(winsBody.entries.map((entry) => entry.displayName), ["Alpha", "Beta"]);
  db.close();
});

test("achievement endpoint derives run and session progress from stored events", async () => {
  const { app, db } = fixture();
  await seedSession(app, {
    sessionId: "session-achievement",
    runId: "run-achievement-1",
    nickname: "成就测试员",
    choices: [
      "scope-creep:freeze-scope",
      "release-window:verify-release",
      "production-alert:fix-alert",
      "ai-policy:review-first",
      "scope-creep:freeze-scope",
      "production-alert:fix-alert"
    ],
    rushes: 3,
    completed: 14,
    missed: 0,
    finalDebt: 0,
    health: 100
  });

  const runResponse = await app.request("/api/achievements?runId=run-achievement-1");
  assert.equal(runResponse.status, 200);
  const runBody = await runResponse.json() as {
    unlockedAchievements: number;
    achievements: Array<{ id: string; unlocked: boolean; progress: number }>;
  };
  assert.ok(runBody.unlockedAchievements >= 10);
  assert.equal(runBody.achievements.find((achievement) => achievement.id === "first-launch")?.unlocked, true);
  assert.equal(runBody.achievements.find((achievement) => achievement.id === "decision-maker")?.unlocked, true);
  assert.equal(runBody.achievements.find((achievement) => achievement.id === "scope-guard")?.unlocked, true);

  const sessionResponse = await app.request("/api/achievements?sessionId=session-achievement");
  const sessionBody = await sessionResponse.json() as {
    unlockedCount: number;
    totalPoints: number;
    achievements: Array<{ id: string; unlockedAt: string | null }>;
  };
  assert.ok(sessionBody.unlockedCount > 0);
  assert.ok(sessionBody.totalPoints > 0);
  assert.equal(sessionBody.achievements.find((achievement) => achievement.id === "first-launch")?.unlockedAt, endedAt);

  const missing = await app.request("/api/achievements");
  assert.equal(missing.status, 400);
  db.close();
});

test("admin endpoints require a token when configured and expose session decisions", async () => {
  const { app, db } = fixture({ adminToken: "top-secret" });
  await seedSession(app, {
    sessionId: "session-admin",
    runId: "run-admin-1",
    nickname: "后台测试员",
    choices: ["scope-creep:accept-scope", "release-window:quick-release"],
    rushes: 2,
    finalDebt: 80,
    health: 60,
    completed: 8
  });

  const meta = await app.request("/api/admin/meta");
  assert.deepEqual(await meta.json(), { ok: true, authRequired: true, dashboard: true, gameVersion: "0.1.0", gameUrl: "" });
  assert.equal((await app.request("/api/admin/overview")).status, 401);
  assert.equal((await app.request("/api/admin/sessions", { headers: { authorization: "Bearer wrong" } })).status, 401);

  const auth = { authorization: "Bearer top-secret" };
  const overview = await app.request("/api/admin/overview", { headers: auth });
  assert.equal(overview.status, 200);
  const overviewBody = await overview.json() as { overview: { sessions: number; runs: number; decisions?: unknown } };
  assert.equal(overviewBody.overview.sessions, 1);
  assert.equal(overviewBody.overview.runs, 1);

  const sessions = await app.request("/api/admin/sessions?search=后台", { headers: auth });
  const sessionsBody = await sessions.json() as {
    total: number; sessions: Array<{ sessionId: string; displayName: string; decisions: number; achievementCount: number }>;
  };
  assert.equal(sessionsBody.total, 1);
  assert.equal(sessionsBody.sessions[0]?.displayName, "后台测试员");
  assert.equal(sessionsBody.sessions[0]?.decisions, 2);

  const detail = await app.request("/api/admin/sessions/session-admin", { headers: auth });
  assert.equal(detail.status, 200);
  const detailBody = await detail.json() as {
    session: { sessionId: string; displayName: string };
    decisionLog: Array<{ kind: string }>;
    achievements: Array<{ unlocked: boolean }>;
    decisions: { choices: Array<{ eventId: string; choices: Array<{ id: string; count: number }> }> };
  };
  assert.equal(detailBody.session.sessionId, "session-admin");
  assert.equal(detailBody.decisionLog.filter((entry) => entry.kind === "choice").length, 2);
  assert.ok(detailBody.achievements.some((achievement) => achievement.unlocked));
  assert.equal(detailBody.decisions.choices.find((event) => event.eventId === "scope-creep")?.choices.find((choice) => choice.id === "accept-scope")?.count, 1);

  const missing = await app.request("/api/admin/sessions/nope", { headers: auth });
  assert.equal(missing.status, 404);
  db.close();
});

test("event-only sessions retain their nickname for abandoned runs", async () => {
  const { app, db } = fixture();
  const events = [
    event({
      eventId: "event-abandon-start",
      sessionId: "session-abandon",
      runId: "run-abandon-1",
      type: "game_start",
      properties: { nickname: "中途离场者" }
    }),
    event({
      eventId: "event-abandon-end",
      sessionId: "session-abandon",
      runId: "run-abandon-1",
      type: "run_abandoned",
      properties: { elapsed: 90, nickname: "中途离场者" }
    })
  ];
  assert.equal((await postJson(app, "/api/events", { events })).status, 202);

  const sessions = await app.request("/api/admin/sessions");
  const body = await sessions.json() as { sessions: Array<{ displayName: string; runs: number; eventCount: number }> };
  assert.equal(body.sessions[0]?.displayName, "中途离场者");
  assert.equal(body.sessions[0]?.runs, 0);
  assert.equal(body.sessions[0]?.eventCount, 2);

  const detail = await app.request("/api/admin/sessions/session-abandon");
  const detailBody = await detail.json() as { session: { displayName: string }; unfinishedRunIds: string[] };
  assert.equal(detailBody.session.displayName, "中途离场者");
  assert.deepEqual(detailBody.unfinishedRunIds, ["run-abandon-1"]);
  db.close();
});

test("dashboard assets are served and new event types are accepted", async () => {
  const { app, db } = fixture();
  const dashboard = await app.request("/admin");
  const html = await dashboard.text();
  const css = await app.request("/admin/admin.css");
  const js = await app.request("/admin/admin.js");
  assert.equal(dashboard.status, 200);
  assert.match(html, /决策分析台/);
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type") ?? "", /text\/css/);
  assert.equal(js.status, 200);
  assert.match(js.headers.get("content-type") ?? "", /javascript/);

  const interaction = await postJson(app, "/api/events", event({
    eventId: "event-ui-action",
    type: "ui_action",
    properties: { action: "pause", paused: true }
  }));
  assert.equal(interaction.status, 202);
  const abandoned = await postJson(app, "/api/events", event({
    eventId: "event-abandoned",
    type: "run_abandoned",
    properties: { elapsed: 40 }
  }));
  assert.equal(abandoned.status, 202);
  db.close();
});
