import type { GameTelemetryEvent } from "../core/game";

const STORAGE_KEY = "1024-ai-game-telemetry";
const MAX_STORED_EVENTS = 1000;

interface ReportEvent {
  sessionId: string;
  runId: string | null;
  type: string;
  timestamp: string;
  elapsed?: number;
  properties: Record<string, unknown>;
}

export class TelemetryReporter {
  private readonly sessionId = makeId();
  private runId: string | null = null;
  private readonly endpoint = import.meta.env?.VITE_ANALYTICS_ENDPOINT ?? "";

  enter(): void {
    this.track("enter", { page: location.pathname });
  }

  beginRun(): void {
    this.runId = makeId();
    this.track("game_start", {});
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
      sessionId: this.sessionId,
      runId: this.runId,
      type,
      timestamp: new Date().toISOString(),
      ...(elapsed === undefined ? {} : { elapsed }),
      properties
    };
    this.persist(event);
    window.dispatchEvent(new CustomEvent("game:analytics", { detail: event }));
    if (this.endpoint) this.send(event);
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

  private readStored(): ReportEvent[] {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as ReportEvent[];
    } catch {
      return [];
    }
  }

  private send(event: ReportEvent): void {
    const body = JSON.stringify(event);
    try {
      if (navigator.sendBeacon?.(this.endpoint, new Blob([body], { type: "application/json" }))) return;
      void fetch(this.endpoint, { method: "POST", headers: { "content-type": "application/json" }, body, keepalive: true }).catch(() => undefined);
    } catch {
      // The local event log remains available if the configured collector is offline.
    }
  }
}

function makeId(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
