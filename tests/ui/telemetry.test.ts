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

  assert.deepEqual(summary, { completedRequests: 2, recruitedEngineers: 1, answeredChanges: 1 });
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
