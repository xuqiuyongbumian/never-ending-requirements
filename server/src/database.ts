import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { calculateRunScore } from "../../shared/scoring.ts";
import type { GameEventInput, RunInput } from "./schemas.ts";

export type StoredEvent = {
  eventId: string;
  sessionId: string;
  runId: string | null;
  type: string;
  timestamp: string;
  elapsed: number | null;
  properties: Record<string, string | number | boolean>;
};

export type StoredRun = Omit<RunInput, "nickname"> & {
  nickname: string | null;
  score: number;
};

const migrationDirectory = resolve(dirname(fileURLToPath(import.meta.url)), "../migrations");

export function openDatabase(path = process.env.DATABASE_PATH ?? "./data/game.sqlite"): DatabaseSync {
  const absolutePath = path === ":memory:" ? path : isAbsolute(path) ? path : resolve(process.cwd(), path);
  if (absolutePath !== ":memory:") mkdirSync(dirname(absolutePath), { recursive: true });
  const db = new DatabaseSync(absolutePath);
  db.exec("PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  if (absolutePath !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  return db;
}

export function runMigrations(db: DatabaseSync, directory = migrationDirectory): string[] {
  db.exec("CREATE TABLE IF NOT EXISTS schema_migrations (name TEXT PRIMARY KEY, applied_at TEXT NOT NULL)");
  const applied = new Set(
    (db.prepare("SELECT name FROM schema_migrations").all() as Array<{ name: string }>).map((row) => row.name)
  );
  const filenames = readdirSync(directory).filter((name) => /^\d+_[a-z0-9_-]+\.sql$/.test(name)).sort();
  const statement = db.prepare("INSERT INTO schema_migrations (name, applied_at) VALUES (?, ?)");
  const completed: string[] = [];

  for (const name of filenames) {
    if (applied.has(name)) continue;
    const sql = readFileSync(resolve(directory, name), "utf8");
    db.exec("BEGIN IMMEDIATE");
    try {
      db.exec(sql);
      statement.run(name, new Date().toISOString());
      db.exec("COMMIT");
      completed.push(name);
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
  return completed;
}

export function legacyEventId(event: GameEventInput): string {
  const canonical = JSON.stringify({
    sessionId: event.sessionId,
    runId: event.runId,
    type: event.type,
    timestamp: event.timestamp,
    elapsed: event.elapsed ?? null,
    properties: event.properties
  });
  return `legacy_${createHash("sha256").update(canonical).digest("hex")}`;
}

export function insertEvents(db: DatabaseSync, events: GameEventInput[], receivedAt = new Date().toISOString()): { inserted: number; duplicates: number } {
  const insert = db.prepare(`
    INSERT INTO game_events (event_id, session_id, run_id, type, timestamp, elapsed, properties_json, received_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(event_id) DO NOTHING
  `);
  const existing = db.prepare("SELECT session_id, run_id, type, timestamp, elapsed, properties_json FROM game_events WHERE event_id = ?");
  let inserted = 0;
  let duplicates = 0;

  db.exec("BEGIN IMMEDIATE");
  try {
    for (const event of events) {
      const eventId = event.eventId ?? legacyEventId(event);
      const propertiesJson = JSON.stringify(event.properties);
      const result = insert.run(
        eventId, event.sessionId, event.runId, event.type, event.timestamp,
        event.elapsed ?? null, propertiesJson, receivedAt
      );
      if (Number(result.changes) > 0) {
        inserted += 1;
        continue;
      }
      const row = existing.get(eventId) as {
        session_id: string; run_id: string | null; type: string; timestamp: string;
        elapsed: number | null; properties_json: string;
      } | undefined;
      if (!row || row.session_id !== event.sessionId || row.run_id !== event.runId || row.type !== event.type ||
          row.timestamp !== event.timestamp || row.elapsed !== (event.elapsed ?? null) || row.properties_json !== propertiesJson) {
        throw new Error("event_id_conflict");
      }
      duplicates += 1;
    }
    db.exec("COMMIT");
    return { inserted, duplicates };
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

export function calculateScore(run: RunInput): number {
  return calculateRunScore(run);
}

export function saveRun(db: DatabaseSync, run: RunInput, receivedAt = new Date().toISOString()): { run: StoredRun; duplicate: boolean } {
  const score = calculateScore(run);
  const nickname = normalizeNickname(run.nickname);
  const result = db.prepare(`
    INSERT INTO game_runs (
      run_id, session_id, started_at, ended_at, result, completed_requests, recruit_count, missed_requests,
      final_era, final_tech_debt, final_project_health, score, game_version, nickname, received_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(run_id) DO NOTHING
  `).run(
    run.runId, run.sessionId, run.startedAt, run.endedAt, run.result, run.completedRequests,
    run.recruitCount, run.missedRequests, run.finalEra, run.finalTechDebt, run.finalProjectHealth,
    score, run.gameVersion, nickname, receivedAt
  );

  const existing = db.prepare(`
    SELECT run_id, session_id, started_at, ended_at, result, completed_requests, recruit_count, missed_requests,
      final_era, final_tech_debt, final_project_health, score, game_version, nickname
    FROM game_runs WHERE run_id = ?
  `).get(run.runId) as {
    run_id: string; session_id: string; started_at: string; ended_at: string; result: "win" | "loss";
    completed_requests: number; recruit_count: number; missed_requests: number; final_era: number;
    final_tech_debt: number; final_project_health: number; score: number; game_version: string;
    nickname: string | null;
  } | undefined;
  if (!existing) throw new Error("run_insert_failed");

  const matches = existing.session_id === run.sessionId && existing.started_at === run.startedAt &&
    existing.ended_at === run.endedAt && existing.result === run.result &&
    existing.completed_requests === run.completedRequests && existing.recruit_count === run.recruitCount &&
    existing.missed_requests === run.missedRequests && existing.final_era === run.finalEra &&
    existing.final_tech_debt === run.finalTechDebt && existing.final_project_health === run.finalProjectHealth &&
    existing.game_version === run.gameVersion && existing.nickname === nickname;
  if (!matches) throw new Error("run_id_conflict");

  return {
    duplicate: Number(result.changes) === 0,
    run: {
      runId: existing.run_id,
      sessionId: existing.session_id,
      startedAt: existing.started_at,
      endedAt: existing.ended_at,
      result: existing.result,
      completedRequests: existing.completed_requests,
      recruitCount: existing.recruit_count,
      missedRequests: existing.missed_requests,
      finalEra: existing.final_era,
      finalTechDebt: existing.final_tech_debt,
      finalProjectHealth: existing.final_project_health,
      gameVersion: existing.game_version,
      nickname: existing.nickname,
      score: existing.score
    }
  };
}

export function normalizeNickname(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim().replace(/\s+/g, " ");
  return trimmed.length > 0 ? trimmed.slice(0, 24) : null;
}
