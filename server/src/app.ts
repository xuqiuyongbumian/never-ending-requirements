import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { readFileSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import {
  getAchievementStats,
  getDecisionStats,
  getLeaderboard,
  getOverview,
  getRunAchievementReport,
  getSessionAchievements,
  getSessionDetail,
  getSessionRank,
  listSessions,
  type LeaderboardSort
} from "./analytics.ts";
import { insertEvents, saveRun } from "./database.ts";
import { getEvents, isIsoDate, validateEventRequest, validateRun } from "./schemas.ts";
import type { GameEventInput, RunInput } from "./schemas.ts";

type RateRecord = { windowStartedAt: number; count: number };
type AppOptions = {
  now?: () => number;
  maxPerMinute?: number;
  maxRunsPerMinute?: number;
  adminToken?: string;
  dashboard?: boolean;
};

class SessionRateLimiter {
  private readonly sessions = new Map<string, RateRecord>();
  private readonly maxPerMinute: number;
  private readonly now: () => number;

  constructor(maxPerMinute: number, now: () => number) {
    this.maxPerMinute = maxPerMinute;
    this.now = now;
  }

  allow(sessionId: string): boolean {
    const now = this.now();
    const current = this.sessions.get(sessionId);
    if (!current || now - current.windowStartedAt >= 60_000) {
      this.sessions.set(sessionId, { windowStartedAt: now, count: 1 });
      this.prune(now);
      return true;
    }
    if (current.count >= this.maxPerMinute) return false;
    current.count += 1;
    this.prune(now);
    return true;
  }

  private prune(now: number): void {
    if (this.sessions.size > 10_000) {
      for (const [key, record] of this.sessions) {
        if (now - record.windowStartedAt >= 60_000) this.sessions.delete(key);
      }
      while (this.sessions.size > 10_000) {
        const oldest = this.sessions.keys().next().value as string | undefined;
        if (!oldest) break;
        this.sessions.delete(oldest);
      }
    }
  }
}

function error(c: { json: (value: unknown, status?: number) => Response }, status: number, code: string, message: string): Response {
  return c.json({ error: { code, message } }, status);
}

function validationMessage(errors: Array<{ instancePath?: string; message?: string }> | null | undefined): string {
  return (errors ?? []).slice(0, 4).map((issue) => `${issue.instancePath || "/"} ${issue.message || "is invalid"}`).join("; ");
}

const adminFiles = new Map<string, { body: string; type: string }>();
try {
  adminFiles.set("/admin", {
    body: readFileSync(new URL("../public/admin/index.html", import.meta.url), "utf8"),
    type: "text/html; charset=utf-8"
  });
  adminFiles.set("/admin/admin.css", {
    body: readFileSync(new URL("../public/admin/admin.css", import.meta.url), "utf8"),
    type: "text/css; charset=utf-8"
  });
  adminFiles.set("/admin/admin.js", {
    body: readFileSync(new URL("../public/admin/admin.js", import.meta.url), "utf8"),
    type: "text/javascript; charset=utf-8"
  });
} catch (cause) {
  console.warn("Admin dashboard assets are unavailable", cause instanceof Error ? cause.message : cause);
}

export function createApp(db: DatabaseSync, options: AppOptions = {}): Hono {
  const app = new Hono();
  const now = options.now ?? Date.now;
  const eventLimiter = new SessionRateLimiter(options.maxPerMinute ?? 80, now);
  const runLimiter = new SessionRateLimiter(options.maxRunsPerMinute ?? 10, now);
  const adminToken = options.adminToken ?? process.env.ADMIN_TOKEN ?? "";

  app.use("/api/*", cors({
    origin: "*",
    allowMethods: ["GET", "POST", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization"]
  }));
  app.use("/api/*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => error(c, 413, "payload_too_large", "Request body exceeds 64 KiB.") }));

  app.get("/api/health", (c) => {
    db.prepare("SELECT 1").get();
    return c.json({ ok: true });
  });

  app.get("/api/admin/meta", (c) => c.json({
    ok: true,
    authRequired: Boolean(adminToken),
    dashboard: true,
    gameVersion: process.env.GAME_VERSION ?? "0.1.0",
    gameUrl: process.env.GAME_URL ?? ""
  }));

  app.use("/api/admin/*", async (c, next) => {
    if (!adminToken) {
      await next();
      return;
    }
    const header = c.req.header("authorization") ?? "";
    const token = header.toLowerCase().startsWith("bearer ") ? header.slice(7).trim() : (c.req.query("token") ?? "");
    if (token !== adminToken) {
      return error(c, 401, "unauthorized", "A valid admin bearer token is required.");
    }
    await next();
  });

  app.post("/api/events", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return error(c, 400, "invalid_json", "Request body must be valid JSON.");
    }
    if (!validateEventRequest(payload)) {
      return error(c, 400, "invalid_event", validationMessage(validateEventRequest.errors));
    }
    const events = getEvents(payload);
    if (!events.every((event) => isIsoDate(event.timestamp))) {
      return error(c, 400, "invalid_timestamp", "Event timestamps must be ISO 8601 UTC strings.");
    }
    const sessionId = events[0].sessionId;
    if (events.some((event) => event.sessionId !== sessionId)) {
      return error(c, 400, "mixed_sessions", "A batch may contain events from only one session.");
    }
    if (!eventLimiter.allow(sessionId)) {
      return error(c, 429, "rate_limited", "Event upload limit reached. Retry after the current minute.");
    }
    try {
      const result = insertEvents(db, events);
      return c.json({ ok: true, received: events.length, ...result }, 202);
    } catch (cause) {
      if (cause instanceof Error && cause.message === "event_id_conflict") {
        return error(c, 409, "event_id_conflict", "eventId was already used for a different event.");
      }
      throw cause;
    }
  });

  app.post("/api/runs", async (c) => {
    let payload: unknown;
    try {
      payload = await c.req.json();
    } catch {
      return error(c, 400, "invalid_json", "Request body must be valid JSON.");
    }
    if (!validateRun(payload)) {
      return error(c, 400, "invalid_run", validationMessage(validateRun.errors));
    }
    const run = payload as RunInput;
    if (!isIsoDate(run.startedAt) || !isIsoDate(run.endedAt)) {
      return error(c, 400, "invalid_timestamp", "Run timestamps must be ISO 8601 UTC strings.");
    }
    const durationMs = Date.parse(run.endedAt) - Date.parse(run.startedAt);
    if (durationMs < 1000 || durationMs > 2 * 60 * 60 * 1000) {
      return error(c, 400, "invalid_duration", "Run duration must be between 1 second and 2 hours.");
    }
    if (run.result === "win" && run.finalProjectHealth <= 0) {
      return error(c, 400, "inconsistent_result", "A winning run must have project health above zero.");
    }
    if (run.result === "win" && run.completedRequests === 0) {
      return error(c, 400, "inconsistent_result", "A winning run must include at least one completed request.");
    }
    if (!runLimiter.allow(run.sessionId)) {
      return error(c, 429, "rate_limited", "Run upload limit reached. Retry after the current minute.");
    }
    try {
      const saved = saveRun(db, run);
      const achievementReport = getRunAchievementReport(db, run.runId);
      return c.json({
        ok: true,
        duplicate: saved.duplicate,
        run: saved.run,
        achievements: achievementReport?.achievements ?? [],
        achievementPoints: achievementReport?.points ?? 0,
        unlockedAchievements: achievementReport?.unlocked ?? 0,
        rank: getSessionRank(db, run.sessionId)
      }, saved.duplicate ? 200 : 201);
    } catch (cause) {
      if (cause instanceof Error && cause.message === "run_id_conflict") {
        return error(c, 409, "run_id_conflict", "runId was already used for a different result.");
      }
      throw cause;
    }
  });

  app.get("/api/leaderboard", (c) => {
    const sort = parseLeaderboardSort(c.req.query("sort"));
    const entries = getLeaderboard(db, {
      limit: parsePositiveInt(c.req.query("limit"), 10),
      sort,
      sessionId: c.req.query("sessionId")
    }).map(({ sessionId: _sessionId, ...entry }) => entry);
    return c.json({ ok: true, sort, entries });
  });

  app.get("/api/achievements", (c) => {
    const runId = c.req.query("runId");
    const sessionId = c.req.query("sessionId");
    if (runId) {
      const report = getRunAchievementReport(db, runId);
      if (!report) return error(c, 404, "run_not_found", "No run exists for this runId.");
      return c.json({
        ok: true,
        scope: "run",
        run: report.run,
        achievements: report.achievements,
        unlockedAchievements: report.unlocked,
        achievementPoints: report.points
      });
    }
    if (sessionId) {
      return c.json({ ok: true, scope: "session", ...getSessionAchievements(db, sessionId) });
    }
    return error(c, 400, "missing_identifier", "Provide a sessionId or runId query parameter.");
  });

  app.get("/api/admin/overview", (c) => c.json({ ok: true, overview: getOverview(db) }));

  app.get("/api/admin/sessions", (c) => {
    const result = listSessions(db, {
      limit: parsePositiveInt(c.req.query("limit"), 20),
      offset: parseNonNegativeInt(c.req.query("offset"), 0),
      search: c.req.query("search") ?? ""
    });
    return c.json({ ok: true, ...result });
  });

  app.get("/api/admin/sessions/:sessionId", (c) => {
    const detail = getSessionDetail(db, c.req.param("sessionId"));
    if (!detail) return error(c, 404, "session_not_found", "No events or runs exist for this session.");
    return c.json({ ok: true, ...detail });
  });

  app.get("/api/admin/decisions", (c) => {
    const sessionId = c.req.query("sessionId");
    return c.json({ ok: true, decisions: getDecisionStats(db, sessionId) });
  });

  app.get("/api/admin/achievements", (c) => c.json({ ok: true, ...getAchievementStats(db) }));

  app.get("/api/admin/leaderboard", (c) => {
    const sort = parseLeaderboardSort(c.req.query("sort"));
    const entries = getLeaderboard(db, {
      limit: parsePositiveInt(c.req.query("limit"), 20),
      sort,
      sessionId: c.req.query("sessionId"),
      includeSessionId: true
    });
    return c.json({ ok: true, sort, entries });
  });

  if (options.dashboard !== false && adminFiles.size > 0) {
    for (const [path, asset] of adminFiles) {
      app.get(path, (c) => c.body(asset.body, 200, {
        "content-type": asset.type,
        "cache-control": "no-store",
        "x-content-type-options": "nosniff",
        "referrer-policy": "same-origin"
      }));
    }
  }

  app.notFound((c) => error(c, 404, "not_found", "API route was not found."));
  app.onError((cause, c) => {
    console.error("API request failed", cause instanceof Error ? cause.message : "unknown error");
    return error(c, 500, "internal_error", "The request could not be completed.");
  });
  return app;
}

function parseLeaderboardSort(value: string | undefined): LeaderboardSort {
  return value === "wins" || value === "completed" ? value : "score";
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function parseNonNegativeInt(value: string | undefined, fallback: number): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}
