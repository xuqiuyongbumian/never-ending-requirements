import type { GameTelemetryEvent } from "../core/game";

const STORAGE_KEY = "1024-ai-game-telemetry";
const PENDING_EVENTS_KEY = "1024-ai-game-pending-events";
const PENDING_RUNS_KEY = "1024-ai-game-pending-runs";
const RUN_HISTORY_KEY = "1024-ai-game-runs";
const MAX_STORED_EVENTS = 1000;
const MAX_PENDING_EVENTS = 1000;
const MAX_BATCH_SIZE = 25;
const MAX_BATCH_BYTES = 48 * 1024;
const MAX_ATTEMPTS = 3;

interface ReportEvent {
  eventId: string;
  sessionId: string;
  runId: string | null;
  type: string;
  timestamp: string;
  elapsed?: number;
  properties: Record<string, unknown>;
}

export interface RunSummary {
  result: "win" | "loss";
  completedRequests: number;
  recruitCount: number;
  missedRequests: number;
  finalEra: number;
  finalTechDebt: number;
  finalProjectHealth: number;
}

interface RunReport extends RunSummary {
  runId: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  gameVersion: string;
  nickname?: string;
}

interface PendingItem<T> {
  value: T;
  attempts: number;
  nextAttemptAt: number;
}

export interface TelemetryOptions {
  apiBaseUrl?: string;
  gameVersion?: string;
  flushIntervalMs?: number;
  now?: () => number;
  fetch?: typeof fetch;
  sendBeacon?: (url: string, body: Blob) => boolean;
  schedule?: (callback: () => void, delayMs: number) => unknown;
}

/**
 * 生产构建默认上报到同源：网关会把 /api/* 反代到后端。
 * 未配置 VITE_API_BASE_URL 时此前会完全不上报，导致线上埋点静默失效。
 * 开发环境保持静默，避免本地调试污染线上数据。
 */
function defaultApiBaseUrl(): string {
  if (!import.meta.env?.PROD) return "";
  if (typeof window === "undefined") return "";
  return window.location.origin;
}

export class TelemetryReporter {
  readonly sessionId = makeId();
  private runId: string | null = null;
  private runStartedAt: string | null = null;
  private nickname: string | null = null;
  private readonly legacyEndpoint: string;
  readonly apiBaseUrl: string;
  private readonly gameVersion: string;
  private readonly now: () => number;
  private readonly fetcher?: typeof fetch;
  private readonly beacon?: (url: string, body: Blob) => boolean;
  private readonly schedule: (callback: () => void, delayMs: number) => unknown;
  private flushInFlight = false;

  constructor(legacyEndpoint?: string, options: TelemetryOptions = {}) {
    const envApiBaseUrl = import.meta.env?.VITE_API_BASE_URL ?? "";
    const envLegacyEndpoint = import.meta.env?.VITE_ANALYTICS_ENDPOINT ?? "";
    const configuredBaseUrl = options.apiBaseUrl ?? (legacyEndpoint === undefined ? envApiBaseUrl : "");
    this.apiBaseUrl = trimTrailingSlash(configuredBaseUrl || defaultApiBaseUrl());
    this.legacyEndpoint = this.apiBaseUrl ? "" : (legacyEndpoint ?? envLegacyEndpoint);
    this.gameVersion = options.gameVersion ?? import.meta.env?.VITE_GAME_VERSION ?? "0.1.0";
    this.now = options.now ?? Date.now;
    this.fetcher = options.fetch;
    this.beacon = options.sendBeacon;
    this.schedule = options.schedule ?? ((callback, delayMs) => globalThis.setTimeout(callback, delayMs));

    if (this.apiBaseUrl && typeof window !== "undefined") {
      window.addEventListener("pagehide", () => this.sendBeaconQueue());
      window.addEventListener("online", () => { void this.flush(); });
      const interval = options.flushIntervalMs ?? 5000;
      if (interval > 0 && typeof window.setInterval === "function") {
        window.setInterval(() => { void this.flush(); }, interval);
      }
    }
  }

  enter(): void {
    this.track("enter", { page: location.pathname });
  }

  setNickname(value: string | null | undefined): void {
    const trimmed = (value ?? "").trim().replace(/\s+/g, " ");
    this.nickname = trimmed.length > 0 ? trimmed.slice(0, 24) : null;
  }

  getNickname(): string | null {
    return this.nickname;
  }

  getRunId(): string | null {
    return this.runId;
  }

  getRunStartedAt(): string | null {
    return this.runStartedAt;
  }

  beginRun(): void {
    this.runId = makeId();
    this.runStartedAt = new Date(this.now()).toISOString();
    this.track("game_start", this.nickname ? { nickname: this.nickname } : {});
  }

  trackInteraction(action: string, properties: Record<string, string | number | boolean> = {}): void {
    this.track("ui_action", { action, ...properties });
  }

  abandonRun(summary: {
    elapsed: number;
    completedRequests: number;
    recruitCount: number;
    missedRequests: number;
    finalEra: number;
    finalTechDebt: number;
    finalProjectHealth: number;
  }): void {
    if (!this.runId) return;
    this.track("run_abandoned", this.nickname ? { ...summary, nickname: this.nickname } : { ...summary }, summary.elapsed);
    this.runId = null;
    this.runStartedAt = null;
  }

  consume(events: readonly GameTelemetryEvent[]): void {
    for (const event of events) {
      const { type, at, detail } = event;
      if (type === "result") {
        this.track(detail.result === "victory" ? "win" : "loss", { ...detail }, at);
      } else {
        this.track(type, { ...detail }, at);
      }
    }
  }

  track(type: string, properties: Record<string, unknown>, elapsed?: number): void {
    const event: ReportEvent = {
      eventId: makeId(),
      sessionId: this.sessionId,
      runId: this.runId,
      type,
      timestamp: new Date(this.now()).toISOString(),
      ...(elapsed === undefined ? {} : { elapsed }),
      properties
    };
    this.persist(event);
    window.dispatchEvent(new CustomEvent("game:analytics", { detail: event }));

    if (this.apiBaseUrl) {
      this.enqueue(PENDING_EVENTS_KEY, event);
      if (this.pendingEvents().length >= MAX_BATCH_SIZE) void this.flush();
    } else if (this.legacyEndpoint) {
      this.sendLegacy(event);
    }
  }

  finishRun(summary: RunSummary): Promise<void> {
    if (!this.runId) return Promise.resolve();
    const endedAt = new Date(this.now()).toISOString();
    const report: RunReport = {
      ...summary,
      runId: this.runId,
      sessionId: this.sessionId,
      startedAt: this.runStartedAt ?? endedAt,
      endedAt,
      gameVersion: this.gameVersion,
      ...(this.nickname ? { nickname: this.nickname } : {})
    };
    this.persistRun(report);
    if (this.apiBaseUrl) {
      this.enqueue(PENDING_RUNS_KEY, report);
      return this.flush();
    }
    return Promise.resolve();
  }

  async flush(): Promise<void> {
    if (!this.apiBaseUrl || this.flushInFlight) return;
    this.flushInFlight = true;
    try {
      await this.flushEvents();
      await this.flushRuns();
    } finally {
      this.flushInFlight = false;
      this.scheduleReadyRetry();
    }
  }

  exportCurrentRun(): void {
    const events = this.readStored().filter((event) => event.sessionId === this.sessionId && event.runId === this.runId);
    const blob = new Blob([JSON.stringify(events, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `1024-game-${this.runId ?? "session"}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  private persist(event: ReportEvent): void {
    try {
      const events = this.readStored();
      events.push(event);
      localStorage.setItem(STORAGE_KEY, JSON.stringify(events.slice(-MAX_STORED_EVENTS)));
    } catch {
      // Telemetry must never interrupt a game when storage is unavailable.
    }
  }

  private persistRun(run: RunReport): void {
    try {
      const runs = JSON.parse(localStorage.getItem(RUN_HISTORY_KEY) ?? "[]") as RunReport[];
      runs.push(run);
      localStorage.setItem(RUN_HISTORY_KEY, JSON.stringify(runs.slice(-100)));
    } catch {
      // Local run history is best-effort, like the event log.
    }
  }

  private readStored(): ReportEvent[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as ReportEvent[];
    } catch {
      return [];
    }
  }

  private pendingEvents(): PendingItem<ReportEvent>[] {
    return this.readPending<ReportEvent>(PENDING_EVENTS_KEY);
  }

  private pendingRuns(): PendingItem<RunReport>[] {
    return this.readPending<RunReport>(PENDING_RUNS_KEY);
  }

  private readPending<T>(key: string): PendingItem<T>[] {
    try {
      const value = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
      if (!Array.isArray(value)) return [];
      return value.filter((item): item is PendingItem<T> => {
        if (!item || typeof item !== "object") return false;
        const candidate = item as Partial<PendingItem<T>>;
        return "value" in candidate && Number.isInteger(candidate.attempts) && Number(candidate.attempts) >= 0 &&
          Number.isFinite(candidate.nextAttemptAt) && Number(candidate.nextAttemptAt) >= 0;
      });
    } catch {
      return [];
    }
  }

  private enqueue<T extends { eventId?: string; runId?: string | null }>(key: string, value: T): void {
    try {
      const items = this.readPending<T>(key);
      const keyValue = getQueueId(value);
      if (items.some((item) => getQueueId(item.value) === keyValue)) return;
      items.push({ value, attempts: 0, nextAttemptAt: 0 });
      const limit = key === PENDING_EVENTS_KEY ? MAX_PENDING_EVENTS : 100;
      localStorage.setItem(key, JSON.stringify(items.slice(-limit)));
    } catch {
      // Queue storage can be unavailable in private browsing; gameplay still proceeds.
    }
  }

  private async flushEvents(): Promise<void> {
    const now = this.now();
    const batch = selectEventBatch(this.pendingEvents().filter((item) => item.nextAttemptAt <= now));
    if (batch.length === 0) return;
    const response = await this.post(`${this.apiBaseUrl}/api/events`, { events: batch.map((item) => item.value) });
    if (response) {
      const sentIds = new Set(batch.map((item) => item.value.eventId));
      this.writePending(PENDING_EVENTS_KEY, this.pendingEvents().filter((item) => !sentIds.has(item.value.eventId)));
      return;
    }
    this.retry(PENDING_EVENTS_KEY, batch, (item) => item.value.eventId);
  }

  private async flushRuns(): Promise<void> {
    const now = this.now();
    const batch = this.pendingRuns().filter((item) => item.nextAttemptAt <= now).slice(0, 1);
    if (batch.length === 0) return;
    const response = await this.post(`${this.apiBaseUrl}/api/runs`, batch[0]!.value);
    if (response) {
      const sentIds = new Set(batch.map((item) => item.value.runId));
      this.writePending(PENDING_RUNS_KEY, this.pendingRuns().filter((item) => !sentIds.has(item.value.runId)));
      return;
    }
    this.retry(PENDING_RUNS_KEY, batch, (item) => item.value.runId);
  }

  private async post(url: string, body: unknown): Promise<boolean> {
    const fetcher = this.fetcher ?? globalThis.fetch;
    if (typeof fetcher !== "function") return false;
    try {
      const response = await fetcher(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        keepalive: true
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  private retry<T>(key: string, submitted: PendingItem<T>[], getId: (item: PendingItem<T>) => string): void {
    const submittedIds = new Set(submitted.map(getId));
    const next: PendingItem<T>[] = [];
    for (const item of this.readPending<T>(key)) {
      if (!submittedIds.has(getId(item))) {
        next.push(item);
        continue;
      }
      const attempts = item.attempts + 1;
      if (attempts >= MAX_ATTEMPTS) continue;
      next.push({ ...item, attempts, nextAttemptAt: this.now() + (attempts === 1 ? 1000 : 3000) });
    }
    this.writePending(key, next);
  }

  private writePending<T>(key: string, items: PendingItem<T>[]): void {
    try {
      localStorage.setItem(key, JSON.stringify(items));
    } catch {
      // Network delivery is best-effort and cannot affect the game loop.
    }
  }

  private scheduleReadyRetry(): void {
    const now = this.now();
    const delayedItems = [...this.pendingEvents(), ...this.pendingRuns()].filter((item) => item.nextAttemptAt > now);
    if (delayedItems.length > 0) {
      const delay = Math.max(0, Math.min(...delayedItems.map((item) => item.nextAttemptAt)) - now);
      this.schedule(() => { void this.flush(); }, delay);
      return;
    }
    const hasReady = this.pendingEvents().some((item) => item.nextAttemptAt <= now) ||
      this.pendingRuns().some((item) => item.nextAttemptAt <= now);
    if (hasReady) this.schedule(() => { void this.flush(); }, 0);
  }

  private sendBeaconQueue(): void {
    if (!this.apiBaseUrl) return;
    const sendBeacon = this.beacon ?? ((url: string, body: Blob) => navigator.sendBeacon?.(url, body) ?? false);
    const events = selectEventBatch(this.pendingEvents()).map((item) => item.value);
    const run = this.pendingRuns()[0]?.value;
    if (events.length > 0) this.sendPageExit(`${this.apiBaseUrl}/api/events`, { events }, sendBeacon);
    if (run) this.sendPageExit(`${this.apiBaseUrl}/api/runs`, run, sendBeacon);
  }

  private sendPageExit(url: string, payload: unknown, sendBeacon: (url: string, body: Blob) => boolean): void {
    let queued = false;
    try {
      queued = sendBeacon(url, new Blob([JSON.stringify(payload)], { type: "text/plain;charset=UTF-8" }));
    } catch {
      // Fall through to fetch keepalive when beacon is unavailable.
    }
    if (!queued) void this.post(url, payload);
    // A true beacon result only means the browser queued bytes; keep entries until an HTTP acknowledgement.
  }

  private sendLegacy(event: ReportEvent): void {
    const body = JSON.stringify(event);
    try {
      if (navigator.sendBeacon?.(this.legacyEndpoint, new Blob([body], { type: "application/json" }))) return;
      void fetch(this.legacyEndpoint, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    } catch {
      // The local event log remains available if the configured collector is offline.
    }
  }
}

export function summarizeRun(events: readonly GameTelemetryEvent[]) {
  return {
    completedRequests: events.filter((event) => event.type === "request_complete").length,
    recruitedEngineers: events.filter((event) => event.type === "recruit").length,
    answeredChanges: events.filter((event) => event.type === "event_choice").length,
    missedRequests: events.filter((event) => event.type === "request_missed").length
  };
}

function getQueueId(value: { eventId?: string; runId?: string | null }): string | undefined {
  return value.eventId ?? value.runId ?? undefined;
}

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

function selectEventBatch(items: PendingItem<ReportEvent>[]): PendingItem<ReportEvent>[] {
  const batch: PendingItem<ReportEvent>[] = [];
  for (const item of items.slice(0, MAX_BATCH_SIZE)) {
    const candidate = [...batch, item];
    const bytes = new TextEncoder().encode(JSON.stringify({ events: candidate.map((entry) => entry.value) })).byteLength;
    if (bytes > MAX_BATCH_BYTES) break;
    batch.push(item);
  }
  return batch;
}

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
