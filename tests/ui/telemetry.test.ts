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
