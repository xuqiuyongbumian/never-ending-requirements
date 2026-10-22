import assert from "node:assert/strict";
import test from "node:test";
import { summarizeRun, TelemetryReporter } from "../../src/ui/telemetry.ts";

test("persists and broadcasts player events, mapping results to win/loss", () => {
  const stored = new Map<string, string>();
  const events: Array<{ type: string; sessionId: string; runId: string | null }> = [];
  const windowTarget = new EventTarget();
  class TestCustomEvent extends Event {
    detail: { type: string; sessionId: string; runId: string | null };
    constructor(type: string, init: { detail: typeof events[number] }) {
      super(type);
      this.detail = init.detail;
    }
  }
  windowTarget.addEventListener("game:analytics", (event) => {
    events.push((event as TestCustomEvent).detail);
  });
  Object.defineProperty(globalThis, "window", { value: windowTarget, configurable: true });
  Object.defineProperty(globalThis, "CustomEvent", { value: TestCustomEvent, configurable: true });
  Object.defineProperty(globalThis, "location", { value: { pathname: "/" }, configurable: true });
  Object.defineProperty(globalThis, "localStorage", {
    value: {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value)
    },
    configurable: true
  });

  const reporter = new TelemetryReporter();
  reporter.enter();
  reporter.beginRun();
  reporter.consume([
    { type: "debt_change", at: 12, detail: { amount: 24, total: 24 } },
    { type: "result", at: 20, detail: { result: "victory" } }
  ]);

  const saved = JSON.parse(stored.values().next().value ?? "[]") as typeof events;
  assert.deepEqual(events.map((event) => event.type), ["enter", "game_start", "debt_change", "win"]);
  assert.deepEqual(saved.map((event) => event.type), ["enter", "game_start", "debt_change", "win"]);
  assert.equal(events[0]?.runId, null);
  assert.ok(events[1]?.runId);
  assert.ok(events.every((event) => event.sessionId === events[0]?.sessionId));
});

test("summarizes completed requests, hires, and answered change events", () => {
  const summary = summarizeRun([
    { type: "recruit", at: 2, detail: { role: "frontend" } },
    { type: "request_complete", at: 10, detail: { request: "R-001" } },
    { type: "event_choice", at: 38, detail: { choice: "freeze-scope" } },
    { type: "debt_change", at: 39, detail: { delta: -10 } },
    { type: "request_complete", at: 48, detail: { request: "GO-LIVE" } }
  ]);

  assert.deepEqual(summary, { completedRequests: 2, recruitedEngineers: 1, answeredChanges: 1, missedRequests: 0 });
});

test("sends configured events through sendBeacon", async () => {
  const calls: Array<{ url: string; body: Blob }> = [];
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  Object.defineProperty(globalThis, "navigator", {
    value: { sendBeacon: (url: string, body: Blob) => { calls.push({ url, body }); return true; } },
    configurable: true
  });

  try {
    new TelemetryReporter("https://collector.example/events").track("game_start", {});
    assert.equal(calls[0]?.url, "https://collector.example/events");
    assert.equal(calls[0]?.body.type, "application/json");
    const payload = JSON.parse(await calls[0]!.body.text()) as { type: string; properties: Record<string, unknown> };
    assert.equal(payload.type, "game_start");
    assert.deepEqual(payload.properties, {});
  } finally {
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("falls back to keepalive fetch when sendBeacon declines an event", () => {
  const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = [];
  const previousNavigator = Object.getOwnPropertyDescriptor(globalThis, "navigator");
  const previousFetch = globalThis.fetch;
  Object.defineProperty(globalThis, "navigator", { value: { sendBeacon: () => false }, configurable: true });
  globalThis.fetch = (async (url: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url, init });
    return new Response(null, { status: 204 });
  }) as typeof fetch;

  try {
    new TelemetryReporter("https://collector.example/events").track("recruit", { role: "frontend" });
    assert.equal(calls[0]?.url, "https://collector.example/events");
    assert.equal(calls[0]?.init?.method, "POST");
    assert.equal(calls[0]?.init?.keepalive, true);
    const payload = JSON.parse(String(calls[0]?.init?.body)) as {
      sessionId: string;
      runId: string | null;
      type: string;
      properties: Record<string, unknown>;
    };
    assert.ok(payload.sessionId);
    assert.equal(payload.runId, null);
    assert.equal(payload.type, "recruit");
    assert.deepEqual(payload.properties, { role: "frontend" });
  } finally {
    globalThis.fetch = previousFetch;
    if (previousNavigator) Object.defineProperty(globalThis, "navigator", previousNavigator);
    else Reflect.deleteProperty(globalThis, "navigator");
  }
});

test("batches API events and persists a real run result locally and remotely", async () => {
  const stored = new Map<string, string>();
  const calls: Array<{ url: string; body: unknown }> = [];
  Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
  Object.defineProperty(globalThis, "CustomEvent", {
    value: class extends Event { detail: unknown; constructor(type: string, init: { detail: unknown }) { super(type); this.detail = init.detail; } }, configurable: true
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) }, configurable: true
  });
  const reporter = new TelemetryReporter(undefined, {
    apiBaseUrl: "https://game-api.example/",
    gameVersion: "0.1.0",
    flushIntervalMs: 0,
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
      return new Response(null, { status: String(url).endsWith("/api/events") ? 202 : 201 });
    }) as typeof fetch
  });
  reporter.beginRun();
  reporter.track("recruit", { role: "frontend", cost: 55 }, 3);
  reporter.consume([{ type: "result", at: 300, detail: { result: "victory" } }]);
  await reporter.finishRun({
    result: "win", completedRequests: 12, recruitCount: 4, missedRequests: 1,
    finalEra: 2, finalTechDebt: 35, finalProjectHealth: 87
  });

  assert.deepEqual(calls.map((call) => call.url), ["https://game-api.example/api/events", "https://game-api.example/api/runs"]);
  const eventBatch = calls[0]?.body as { events: Array<{ eventId: string; type: string }> };
  assert.equal(eventBatch.events.length, 3);
  assert.ok(eventBatch.events.every((event) => event.eventId));
  assert.deepEqual(eventBatch.events.map((event) => event.type), ["game_start", "recruit", "win"]);
  const run = calls[1]?.body as { runId: string; sessionId: string; result: string; completedRequests: number; recruitCount: number; missedRequests: number; finalEra: number; gameVersion: string };
  assert.ok(run.runId);
  assert.ok(run.sessionId);
  assert.equal(run.result, "win");
  assert.equal(run.completedRequests, 12);
  assert.equal(run.recruitCount, 4);
  assert.equal(run.missedRequests, 1);
  assert.equal(run.finalEra, 2);
  assert.equal(run.gameVersion, "0.1.0");
  assert.equal(JSON.parse(stored.get("1024-ai-game-telemetry") ?? "[]").length, 3);
  assert.equal(JSON.parse(stored.get("1024-ai-game-runs") ?? "[]").length, 1);
  assert.deepEqual(JSON.parse(stored.get("1024-ai-game-pending-events") ?? "[]"), []);
  assert.deepEqual(JSON.parse(stored.get("1024-ai-game-pending-runs") ?? "[]"), []);
});

test("retries failed API batches at most three times while keeping the local event history", async () => {
  const stored = new Map<string, string>();
  let now = Date.parse("2026-10-22T10:00:00.000Z");
  let attempts = 0;
  Object.defineProperty(globalThis, "window", { value: new EventTarget(), configurable: true });
  Object.defineProperty(globalThis, "CustomEvent", {
    value: class extends Event { detail: unknown; constructor(type: string, init: { detail: unknown }) { super(type); this.detail = init.detail; } }, configurable: true
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) }, configurable: true
  });
  const reporter = new TelemetryReporter(undefined, {
    apiBaseUrl: "https://game-api.example",
    flushIntervalMs: 0,
    now: () => now,
    fetch: (async () => { attempts += 1; throw new Error("offline"); }) as typeof fetch,
    schedule: () => undefined
  });
  reporter.track("enter", { page: "/" });

  await reporter.flush();
  now += 1000;
  await reporter.flush();
  now += 3000;
  await reporter.flush();

  assert.equal(attempts, 3);
  assert.equal(JSON.parse(stored.get("1024-ai-game-telemetry") ?? "[]").length, 1);
  assert.deepEqual(JSON.parse(stored.get("1024-ai-game-pending-events") ?? "[]"), []);
});

test("pagehide sends pending batches as simple text and keeps them until acknowledged", () => {
  const stored = new Map<string, string>();
  const calls: Array<{ url: string; body: Blob }> = [];
  const windowTarget = new EventTarget();
  Object.defineProperty(globalThis, "window", { value: windowTarget, configurable: true });
  Object.defineProperty(globalThis, "CustomEvent", {
    value: class extends Event { detail: unknown; constructor(type: string, init: { detail: unknown }) { super(type); this.detail = init.detail; } }, configurable: true
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) }, configurable: true
  });
  const reporter = new TelemetryReporter(undefined, {
    apiBaseUrl: "https://game-api.example",
    flushIntervalMs: 0,
    sendBeacon: (url, body) => { calls.push({ url, body }); return true; }
  });
  reporter.track("enter", { page: "/" });
  windowTarget.dispatchEvent(new Event("pagehide"));

  assert.equal(calls[0]?.url, "https://game-api.example/api/events");
  assert.equal(calls[0]?.body.type, "text/plain;charset=utf-8");
  assert.equal(JSON.parse(stored.get("1024-ai-game-pending-events") ?? "[]").length, 1);
});

test("pagehide falls back to keepalive fetch when sendBeacon declines the queued payload", () => {
  const stored = new Map<string, string>();
  const calls: Array<{ url: RequestInfo | URL; init?: RequestInit }> = [];
  const windowTarget = new EventTarget();
  Object.defineProperty(globalThis, "window", { value: windowTarget, configurable: true });
  Object.defineProperty(globalThis, "CustomEvent", {
    value: class extends Event { detail: unknown; constructor(type: string, init: { detail: unknown }) { super(type); this.detail = init.detail; } }, configurable: true
  });
  Object.defineProperty(globalThis, "localStorage", {
    value: { getItem: (key: string) => stored.get(key) ?? null, setItem: (key: string, value: string) => stored.set(key, value) }, configurable: true
  });
  const reporter = new TelemetryReporter(undefined, {
    apiBaseUrl: "https://game-api.example",
    flushIntervalMs: 0,
    sendBeacon: () => false,
    fetch: (async (url: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url, init });
      return new Response(null, { status: 202 });
    }) as typeof fetch
  });
  reporter.track("enter", { page: "/" });
  windowTarget.dispatchEvent(new Event("pagehide"));

  assert.equal(calls[0]?.url, "https://game-api.example/api/events");
  assert.equal(calls[0]?.init?.keepalive, true);
  assert.equal(calls[0]?.init?.headers && (calls[0]?.init?.headers as Record<string, string>)["content-type"], "application/json");
  assert.equal(JSON.parse(stored.get("1024-ai-game-pending-events") ?? "[]").length, 1);
});
