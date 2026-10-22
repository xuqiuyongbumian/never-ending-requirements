import { Ajv } from "ajv";

export const ALLOWED_EVENT_TYPES = [
  "enter",
  "game_start",
  "recruit",
  "era_upgrade",
  "event_choice",
  "requirement_prioritized",
  "rush_activated",
  "request_complete",
  "request_missed",
  "debt_change",
  "online_incident",
  "win",
  "loss",
  "replay",
  "change_event",
  "rush_completed",
  "load_error",
  "ui_action",
  "run_abandoned"
] as const;

export type GameEventInput = {
  eventId?: string;
  sessionId: string;
  runId: string | null;
  type: (typeof ALLOWED_EVENT_TYPES)[number];
  timestamp: string;
  elapsed?: number;
  properties: Record<string, string | number | boolean>;
};

export type RunInput = {
  runId: string;
  sessionId: string;
  startedAt: string;
  endedAt: string;
  result: "win" | "loss";
  completedRequests: number;
  recruitCount: number;
  missedRequests: number;
  finalEra: number;
  finalTechDebt: number;
  finalProjectHealth: number;
  gameVersion: string;
  nickname?: string;
};

const idPattern = "^[A-Za-z0-9_-]{8,80}$";
const isoDatePattern = "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z$";
const eventSchema = {
  type: "object",
  required: ["sessionId", "runId", "type", "timestamp", "properties"],
  additionalProperties: false,
  properties: {
    eventId: { type: "string", minLength: 8, maxLength: 100, pattern: "^[A-Za-z0-9_:-]+$" },
    sessionId: { type: "string", minLength: 8, maxLength: 80, pattern: idPattern },
    runId: { anyOf: [{ type: "string", minLength: 8, maxLength: 80, pattern: idPattern }, { type: "null" }] },
    type: { type: "string", enum: ALLOWED_EVENT_TYPES },
    timestamp: { type: "string", pattern: isoDatePattern },
    elapsed: { type: "number", minimum: 0, maximum: 7200 },
    properties: {
      type: "object",
      maxProperties: 24,
      propertyNames: { type: "string", minLength: 1, maxLength: 64, pattern: "^[A-Za-z][A-Za-z0-9_-]*$" },
      additionalProperties: {
        anyOf: [
          { type: "string", maxLength: 500 },
          { type: "number", minimum: -1000000000, maximum: 1000000000 },
          { type: "boolean" }
        ]
      }
    }
  }
} as const;

const eventsArraySchema = { type: "array", minItems: 1, maxItems: 25, items: eventSchema } as const;
const eventRequestSchema = {
  oneOf: [
    eventSchema,
    eventsArraySchema,
    {
      type: "object",
      required: ["events"],
      additionalProperties: false,
      properties: { events: eventsArraySchema }
    }
  ]
} as const;

const runSchema = {
  type: "object",
  required: [
    "runId", "sessionId", "startedAt", "endedAt", "result", "completedRequests",
    "recruitCount", "missedRequests", "finalEra", "finalTechDebt", "finalProjectHealth", "gameVersion"
  ],
  additionalProperties: false,
  properties: {
    runId: { type: "string", minLength: 8, maxLength: 80, pattern: idPattern },
    sessionId: { type: "string", minLength: 8, maxLength: 80, pattern: idPattern },
    startedAt: { type: "string", pattern: isoDatePattern },
    endedAt: { type: "string", pattern: isoDatePattern },
    result: { type: "string", enum: ["win", "loss"] },
    completedRequests: { type: "integer", minimum: 0, maximum: 2000 },
    recruitCount: { type: "integer", minimum: 0, maximum: 100 },
    missedRequests: { type: "integer", minimum: 0, maximum: 2000 },
    finalEra: { type: "integer", minimum: 0, maximum: 2 },
    finalTechDebt: { type: "number", minimum: 0, maximum: 1000 },
    finalProjectHealth: { type: "number", minimum: 0, maximum: 100 },
    gameVersion: { type: "string", minLength: 1, maxLength: 40, pattern: "^[A-Za-z0-9.+_-]+$" },
    nickname: { type: "string", minLength: 1, maxLength: 24 }
  }
} as const;

const ajv = new Ajv({ allErrors: true, strict: false });
export const validateEventRequest = ajv.compile(eventRequestSchema);
export const validateRun = ajv.compile(runSchema);

export function getEvents(payload: unknown): GameEventInput[] {
  if (Array.isArray(payload)) return payload as GameEventInput[];
  if (payload && typeof payload === "object" && "events" in payload) {
    return (payload as { events: GameEventInput[] }).events;
  }
  return [payload as GameEventInput];
}

export function isIsoDate(value: string): boolean {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) && date.toISOString() === value;
}
