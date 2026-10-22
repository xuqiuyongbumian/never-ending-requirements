import {
  achievementPoints,
  buildRunFacts,
  countUnlocked,
  evaluateAchievements,
  mergeAchievementWall,
  type AchievementResult,
  type AchievementWallEntry
} from "../../shared/achievements.ts";
import { calculateRunScore } from "../../shared/scoring.ts";
import type { GameTelemetryEvent } from "../core/game";

const STORAGE_KEY = "1024-ai-game-telemetry";
const RUN_HISTORY_KEY = "1024-ai-game-runs";

export interface LocalRunRecord {
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
}

interface LocalEvent {
  eventId: string;
  sessionId: string;
  runId: string | null;
  type: string;
  timestamp: string;
  elapsed?: number;
  properties: Record<string, string | number | boolean>;
}

export interface LocalAchievementWall {
  achievements: AchievementWallEntry[];
  totalPoints: number;
  unlockedCount: number;
  runs: number;
}

export interface LocalBestRun {
  rank: number;
  score: number;
  result: "win" | "loss";
  endedAt: string;
  displayName: string;
  completedRequests: number;
  missedRequests: number;
  finalProjectHealth: number;
  finalTechDebt: number;
}

export function readLocalRuns(): LocalRunRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(RUN_HISTORY_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isRunRecord);
  } catch {
    return [];
  }
}

export function readLocalEvents(): LocalEvent[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(isLocalEvent);
  } catch {
    return [];
  }
}

export function evaluateCurrentRun(
  summary: {
    result: "win" | "loss";
    completedRequests: number;
    recruitCount: number;
    missedRequests: number;
    finalEra: number;
    finalTechDebt: number;
    finalProjectHealth: number;
    durationSeconds: number;
  },
  events: readonly GameTelemetryEvent[]
): AchievementResult[] {
  return evaluateAchievements(buildRunFacts({
    ...summary,
    events: events.map((event) => ({ type: event.type, properties: event.detail }))
  }));
}

export function buildLocalAchievementWall(): LocalAchievementWall {
  const runs = readLocalRuns();
  const events = readLocalEvents();
  const eventsByRun = new Map<string, LocalEvent[]>();
  for (const event of events) {
    if (!event.runId) continue;
    const list = eventsByRun.get(event.runId) ?? [];
    list.push(event);
    eventsByRun.set(event.runId, list);
  }
  const perRun = runs.map((run) => ({
    runId: run.runId,
    endedAt: run.endedAt,
    achievements: evaluateAchievements(buildRunFacts({
      result: run.result,
      completedRequests: run.completedRequests,
      recruitCount: run.recruitCount,
      missedRequests: run.missedRequests,
      finalEra: run.finalEra,
      finalTechDebt: run.finalTechDebt,
      finalProjectHealth: run.finalProjectHealth,
      startedAt: run.startedAt,
      endedAt: run.endedAt,
      events: (eventsByRun.get(run.runId) ?? []).map((event) => ({ type: event.type, properties: event.properties }))
    }))
  }));
  const wall = mergeAchievementWall(perRun);
  return {
    achievements: wall,
    totalPoints: achievementPoints(wall),
    unlockedCount: countUnlocked(wall),
    runs: runs.length
  };
}

export function buildLocalBestRuns(limit = 10): LocalBestRun[] {
  return readLocalRuns()
    .map((run) => ({
      run,
      score: calculateRunScore(run)
    }))
    .sort((a, b) => b.score - a.score || b.run.endedAt.localeCompare(a.run.endedAt))
    .slice(0, limit)
    .map(({ run, score }, index) => ({
      rank: index + 1,
      score,
      result: run.result,
      endedAt: run.endedAt,
      displayName: run.nickname || "本机玩家",
      completedRequests: run.completedRequests,
      missedRequests: run.missedRequests,
      finalProjectHealth: run.finalProjectHealth,
      finalTechDebt: run.finalTechDebt
    }));
}

export function localPersonalBest(): LocalBestRun | null {
  return buildLocalBestRuns(1)[0] ?? null;
}

function isRunRecord(value: unknown): value is LocalRunRecord {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalRunRecord>;
  return typeof candidate.runId === "string" &&
    typeof candidate.sessionId === "string" &&
    typeof candidate.startedAt === "string" &&
    typeof candidate.endedAt === "string" &&
    (candidate.result === "win" || candidate.result === "loss") &&
    typeof candidate.completedRequests === "number" &&
    typeof candidate.recruitCount === "number" &&
    typeof candidate.missedRequests === "number" &&
    typeof candidate.finalEra === "number" &&
    typeof candidate.finalTechDebt === "number" &&
    typeof candidate.finalProjectHealth === "number";
}

function isLocalEvent(value: unknown): value is LocalEvent {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<LocalEvent>;
  return typeof candidate.type === "string" &&
    typeof candidate.sessionId === "string" &&
    (candidate.runId === null || typeof candidate.runId === "string") &&
    typeof candidate.timestamp === "string" &&
    Boolean(candidate.properties && typeof candidate.properties === "object");
}
