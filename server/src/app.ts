import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import type { DatabaseSync } from "node:sqlite";
import { insertEvents, saveRun } from "./database.ts";
import { getEvents, isIsoDate, validateEventRequest, validateRun } from "./schemas.ts";
import type { GameEventInput, RunInput } from "./schemas.ts";

type RateRecord = { windowStartedAt: number; count: number };
type AppOptions = { now?: () => number; maxPerMinute?: number; maxRunsPerMinute?: number };

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

export function createApp(db: DatabaseSync, options: AppOptions = {}): Hono {
  const app = new Hono();
  const now = options.now ?? Date.now;
  const eventLimiter = new SessionRateLimiter(options.maxPerMinute ?? 80, now);
  const runLimiter = new SessionRateLimiter(options.maxRunsPerMinute ?? 10, now);

  app.use("/api/*", cors({ origin: "*", allowMethods: ["GET", "POST", "OPTIONS"], allowHeaders: ["Content-Type"] }));
  app.use("/api/*", bodyLimit({ maxSize: 64 * 1024, onError: (c) => error(c, 413, "payload_too_large", "Request body exceeds 64 KiB.") }));

  app.get("/api/health", (c) => {
    db.prepare("SELECT 1").get();
    return c.json({ ok: true });
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
      return c.json({ ok: true, duplicate: saved.duplicate, run: saved.run }, saved.duplicate ? 200 : 201);
    } catch (cause) {
      if (cause instanceof Error && cause.message === "run_id_conflict") {
        return error(c, 409, "run_id_conflict", "runId was already used for a different result.");
      }
      throw cause;
    }
  });

  app.notFound((c) => error(c, 404, "not_found", "API route was not found."));
  app.onError((cause, c) => {
    console.error("API request failed", cause instanceof Error ? cause.message : "unknown error");
    return error(c, 500, "internal_error", "The request could not be completed.");
  });
  return app;
}
