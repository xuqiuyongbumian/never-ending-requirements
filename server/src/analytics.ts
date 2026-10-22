import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import {
  achievementMetadata,
  achievementPoints,
  buildRunFacts,
  countUnlocked,
  evaluateAchievements,
  mergeAchievementWall,
  type AchievementDefinition,
  type AchievementResult,
  type AchievementWallEntry
} from "../../shared/achievements.ts";
import {
  DECISION_CATALOG,
  ERA_CATALOG,
  ROLE_CATALOG,
  getChoiceLabel,
  getDecisionChoice,
  getDecisionEvent,
  getRoleName
} from "../../shared/catalog.ts";
import type { StoredEvent, StoredRun } from "./database.ts";

type RunRow = {
  run_id: string;
  session_id: string;
  started_at: string;
  ended_at: string;
  result: "win" | "loss";
  completed_requests: number;
  recruit_count: number;
  missed_requests: number;
  final_era: number;
  final_tech_debt: number;
  final_project_health: number;
  score: number;
  game_version: string;
  nickname: string | null;
};

type EventRow = {
  event_id: string;
  session_id: string;
  run_id: string | null;
  type: string;
  timestamp: string;
  elapsed: number | null;
  properties_json: string;
};

export type Overview = {
  generatedAt: string;
  sessions: number;
  runs: number;
  wins: number;
  losses: number;
  winRate: number;
  avgScore: number;
  avgCompletedRequests: number;
  avgMissedRequests: number;
  avgProjectHealth: number;
  avgTechDebt: number;
  avgDurationSeconds: number;
  events: number;
  abandonedRuns: number;
  latestActivityAt: string | null;
  resultDistribution: Array<{ result: "win" | "loss"; label: string; count: number; share: number }>;
  eraDistribution: Array<{ era: number; name: string; count: number; share: number }>;
  daily: Array<{ date: string; runs: number; wins: number; events: number }>;
  decisionStyle: { quality: number; speed: number; qualityShare: number };
  achievement: { unlockedRuns: number; playersWithAny: number; pointsAwarded: number };
  topAchievements: AchievementStat[];
};

export type AchievementStat = AchievementDefinition & {
  unlockedRuns: number;
  players: number;
  rate: number;
  lastUnlockedAt: string | null;
};

export type RecentUnlock = {
  achievementId: string;
  achievementName: string;
  icon: string;
  tier: string;
  points: number;
  sessionId: string;
  displayName: string;
  runId: string;
  unlockedAt: string;
};

export type AchievementReport = {
  definitions: AchievementDefinition[];
  stats: AchievementStat[];
  recentUnlocks: RecentUnlock[];
  totals: { runs: number; unlockedRuns: number; playersWithAny: number; pointsAwarded: number };
};

export type DecisionStats = {
  sessions: number;
  runs: number;
  decisions: number;
  choices: Array<{
    eventId: string;
    title: string;
    category: string;
    total: number;
    choices: Array<{ id: string; label: string; tone: string; count: number; share: number }>;
  }>;
  choiceTone: { quality: number; speed: number; qualityShare: number };
  roles: Array<{ id: string; name: string; count: number; share: number }>;
  rush: { total: number; runsWithRush: number; avgPerRun: number };
  priorities: { total: number; runsWithPriority: number; avgPerRun: number };
  eraUpgrades: Array<{ era: string; name: string; count: number }>;
  requestOutcomes: Array<{ code: string; completed: number; missed: number; completionRate: number }>;
  debtReasons: Array<{ reason: string; count: number; totalDelta: number; avgDelta: number }>;
  incidents: number;
  uiActions: Array<{ action: string; count: number }>;
  abandoned: number;
};

export type SessionSummary = {
  sessionId: string;
  displayName: string;
  nickname: string | null;
  runs: number;
  wins: number;
  losses: number;
  winRate: number;
  bestScore: number;
  bestCompleted: number;
  totalCompleted: number;
  totalMissed: number;
  avgHealth: number;
  avgDebt: number;
  eventCount: number;
  decisions: number;
  achievementCount: number;
  achievementPoints: number;
  lastActiveAt: string | null;
  lastRunAt: string | null;
};

export type SessionList = { total: number; sessions: SessionSummary[] };

export type DecisionLogEntry = {
  runId: string | null;
  at: number | null;
  timestamp: string;
  kind: "choice" | "recruit" | "era" | "priority" | "rush";
  title: string;
  detail: string;
  tone: "speed" | "quality" | "neutral";
};

export type TimelineEntry = {
  id: string;
  runId: string | null;
  type: string;
  timestamp: string;
  at: number | null;
  label: string;
  category: "decision" | "outcome" | "system" | "risk" | "session";
  properties: Record<string, string | number | boolean>;
};

export type SessionDetail = {
  session: SessionSummary;
  rank: { rank: number; total: number } | null;
  runs: Array<StoredRun & {
    achievements: AchievementResult[];
    unlockedAchievements: number;
    points: number;
    events: StoredEvent[];
  }>;
  achievements: AchievementWallEntry[];
  decisionLog: DecisionLogEntry[];
  timeline: TimelineEntry[];
  decisions: DecisionStats;
  unfinishedRunIds: string[];
};

export type LeaderboardEntry = {
  rank: number;
  sessionId: string;
  playerKey: string;
  displayName: string;
  nickname: string | null;
  bestScore: number;
  wins: number;
  losses: number;
  runs: number;
  winRate: number;
  bestCompleted: number;
  lastPlayedAt: string | null;
  isYou: boolean;
};

export type LeaderboardSort = "score" | "wins" | "completed";

const DEFAULT_LIMIT = 20;

export function aliasForSession(sessionId: string): string {
  const hash = createHash("sha256").update(sessionId).digest("hex").slice(0, 4).toUpperCase();
  return `匿名工程师·${hash}`;
}

export function playerKeyForSession(sessionId: string): string {
  return createHash("sha256").update(sessionId).digest("hex").slice(0, 10);
}

export function displayNameFor(nickname: string | null | undefined, sessionId: string): string {
  const value = nickname?.trim();
  return value ? value : aliasForSession(sessionId);
}

export function loadRuns(db: DatabaseSync, sessionId?: string): StoredRun[] {
  const sql = `SELECT run_id, session_id, started_at, ended_at, result, completed_requests, recruit_count,
      missed_requests, final_era, final_tech_debt, final_project_health, score, game_version, nickname
    FROM game_runs ${sessionId ? "WHERE session_id = ?" : ""}
    ORDER BY ended_at ASC`;
  const rows = (sessionId ? db.prepare(sql).all(sessionId) : db.prepare(sql).all()) as unknown as RunRow[];
  return rows.map(mapRun);
}

export function loadEvents(db: DatabaseSync, filter: { sessionId?: string; runId?: string } = {}): StoredEvent[] {
  const clauses: string[] = [];
  const params: string[] = [];
  if (filter.sessionId) {
    clauses.push("session_id = ?");
    params.push(filter.sessionId);
  }
  if (filter.runId) {
    clauses.push("run_id = ?");
    params.push(filter.runId);
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = db.prepare(`
    SELECT event_id, session_id, run_id, type, timestamp, elapsed, properties_json
    FROM game_events ${where}
    ORDER BY timestamp ASC, rowid ASC
  `).all(...params) as unknown as EventRow[];
  return rows.map(mapEvent);
}

export function runAchievements(run: StoredRun, events: readonly StoredEvent[]): AchievementResult[] {
  const facts = buildRunFacts({
    result: run.result,
    completedRequests: run.completedRequests,
    recruitCount: run.recruitCount,
    missedRequests: run.missedRequests,
    finalEra: run.finalEra,
    finalTechDebt: run.finalTechDebt,
    finalProjectHealth: run.finalProjectHealth,
    startedAt: run.startedAt,
    endedAt: run.endedAt,
    events: events.map((event) => ({ type: event.type, properties: event.properties }))
  });
  return evaluateAchievements(facts);
}

export function getRunAchievementReport(db: DatabaseSync, runId: string): {
  run: StoredRun;
  events: StoredEvent[];
  achievements: AchievementResult[];
  points: number;
  unlocked: number;
} | null {
  const row = db.prepare(`
    SELECT run_id, session_id, started_at, ended_at, result, completed_requests, recruit_count,
      missed_requests, final_era, final_tech_debt, final_project_health, score, game_version, nickname
    FROM game_runs WHERE run_id = ?
  `).get(runId) as unknown as RunRow | undefined;
  if (!row) return null;
  const run = mapRun(row);
  const events = loadEvents(db, { runId });
  const achievements = runAchievements(run, events);
  return {
    run,
    events,
    achievements,
    points: achievementPoints(achievements),
    unlocked: countUnlocked(achievements)
  };
}

export function getSessionAchievements(db: DatabaseSync, sessionId: string): {
  sessionId: string;
  displayName: string;
  totalPoints: number;
  unlockedCount: number;
  achievements: AchievementWallEntry[];
  runs: Array<{ runId: string; endedAt: string; unlocked: number; points: number }>;
} {
  const runs = loadRuns(db, sessionId);
  const events = loadEvents(db, { sessionId });
  const eventsByRun = groupEventsByRun(events);
  const perRun = runs.map((run) => ({
    runId: run.runId,
    endedAt: run.endedAt,
    achievements: runAchievements(run, eventsByRun.get(run.runId) ?? [])
  }));
  const wall = mergeAchievementWall(perRun);
  return {
    sessionId,
    displayName: displayNameFor(latestNickname(runs) ?? nicknameFromEvents(events), sessionId),
    totalPoints: achievementPoints(wall),
    unlockedCount: countUnlocked(wall),
    achievements: wall,
    runs: perRun.map((entry) => ({
      runId: entry.runId,
      endedAt: entry.endedAt,
      unlocked: countUnlocked(entry.achievements),
      points: achievementPoints(entry.achievements)
    }))
  };
}

export function getLeaderboard(
  db: DatabaseSync,
  options: { limit?: number; sort?: LeaderboardSort; sessionId?: string; includeSessionId?: boolean } = {}
): LeaderboardEntry[] {
  const sort: LeaderboardSort = options.sort ?? "score";
  const limit = clamp(options.limit ?? DEFAULT_LIMIT, 1, 100);
  const order = sort === "wins"
    ? "wins DESC, best_score DESC, last_played_at ASC"
    : sort === "completed"
      ? "best_completed DESC, best_score DESC, last_played_at ASC"
      : "best_score DESC, wins DESC, last_played_at ASC";
  const rows = db.prepare(`
    SELECT session_id,
      COUNT(*) AS runs,
      SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
      MAX(score) AS best_score,
      MAX(completed_requests) AS best_completed,
      MAX(ended_at) AS last_played_at,
      (SELECT n.nickname FROM game_runs n
        WHERE n.session_id = game_runs.session_id AND n.nickname IS NOT NULL
        ORDER BY n.ended_at DESC LIMIT 1) AS nickname
    FROM game_runs
    GROUP BY session_id
    ORDER BY ${order}
    LIMIT ?
  `).all(limit) as unknown as Array<{
    session_id: string; runs: number; wins: number; best_score: number; best_completed: number;
    last_played_at: string; nickname: string | null;
  }>;

  return rows.map((row, index) => {
    const bestScore = Number(row.best_score) || 0;
    const wins = Number(row.wins) || 0;
    const runs = Number(row.runs) || 0;
    return {
      rank: index + 1,
      sessionId: row.session_id,
      playerKey: playerKeyForSession(row.session_id),
      displayName: displayNameFor(row.nickname, row.session_id),
      nickname: row.nickname,
      bestScore,
      wins,
      losses: runs - wins,
      runs,
      winRate: runs > 0 ? wins / runs : 0,
      bestCompleted: Number(row.best_completed) || 0,
      lastPlayedAt: row.last_played_at,
      isYou: Boolean(options.sessionId && options.sessionId === row.session_id)
    };
  });
}

export function getSessionRank(db: DatabaseSync, sessionId: string): { rank: number; total: number } | null {
  const best = db.prepare("SELECT MAX(score) AS best FROM game_runs WHERE session_id = ?").get(sessionId) as { best: number | null } | undefined;
  if (best?.best === null || best?.best === undefined) return null;
  const total = (db.prepare("SELECT COUNT(DISTINCT session_id) AS n FROM game_runs").get() as { n: number }).n;
  const better = (db.prepare(`
    SELECT COUNT(*) AS n FROM (
      SELECT session_id, MAX(score) AS best FROM game_runs GROUP BY session_id
    ) WHERE best > ?
  `).get(best.best) as { n: number }).n;
  return { rank: better + 1, total };
}

export function getOverview(db: DatabaseSync): Overview {
  const runs = loadRuns(db);
  const events = loadEvents(db);
  const sessions = new Set<string>();
  for (const run of runs) sessions.add(run.sessionId);
  for (const event of events) sessions.add(event.sessionId);

  const wins = runs.filter((run) => run.result === "win").length;
  const losses = runs.length - wins;
  const completed = sum(runs.map((run) => run.completedRequests));
  const missed = sum(runs.map((run) => run.missedRequests));
  const health = average(runs.map((run) => run.finalProjectHealth));
  const debt = average(runs.map((run) => run.finalTechDebt));
  const durations = runs
    .map((run) => (Date.parse(run.endedAt) - Date.parse(run.startedAt)) / 1000)
    .filter((value) => Number.isFinite(value) && value >= 0);
  const achievementReport = getAchievementStats(db, { runs, events });
  const decisionStats = computeDecisionStats(events, runs);
  const latestActivityAt = [runs.at(-1)?.endedAt, events.at(-1)?.timestamp].filter(Boolean).sort().at(-1) ?? null;

  return {
    generatedAt: new Date().toISOString(),
    sessions: sessions.size,
    runs: runs.length,
    wins,
    losses,
    winRate: runs.length > 0 ? wins / runs.length : 0,
    avgScore: average(runs.map((run) => run.score)),
    avgCompletedRequests: runs.length > 0 ? completed / runs.length : 0,
    avgMissedRequests: runs.length > 0 ? missed / runs.length : 0,
    avgProjectHealth: health,
    avgTechDebt: debt,
    avgDurationSeconds: average(durations),
    events: events.length,
    abandonedRuns: events.filter((event) => event.type === "run_abandoned").length,
    latestActivityAt,
    resultDistribution: [
      { result: "win", label: "上线成功", count: wins, share: runs.length > 0 ? wins / runs.length : 0 },
      { result: "loss", label: "未上线", count: losses, share: runs.length > 0 ? losses / runs.length : 0 }
    ],
    eraDistribution: ERA_CATALOG.map((era) => {
      const count = runs.filter((run) => run.finalEra === era.id).length;
      return { era: era.id, name: era.name, count, share: runs.length > 0 ? count / runs.length : 0 };
    }),
    daily: dailyActivity(runs, events, 7),
    decisionStyle: decisionStats.choiceTone,
    achievement: {
      unlockedRuns: achievementReport.totals.unlockedRuns,
      playersWithAny: achievementReport.totals.playersWithAny,
      pointsAwarded: achievementReport.totals.pointsAwarded
    },
    topAchievements: achievementReport.stats
      .filter((stat) => stat.unlockedRuns > 0)
      .sort((a, b) => b.unlockedRuns - a.unlockedRuns)
      .slice(0, 6)
  };
}

export function getAchievementStats(
  db: DatabaseSync,
  preloaded?: { runs: StoredRun[]; events: StoredEvent[] }
): AchievementReport {
  const runs = preloaded?.runs ?? loadRuns(db);
  const events = preloaded?.events ?? loadEvents(db);
  const eventsByRun = groupEventsByRun(events);
  const stats = new Map<string, AchievementStat & { playerSet: Set<string> }>();
  for (const definition of achievementMetadata()) {
    stats.set(definition.id, {
      ...definition,
      unlockedRuns: 0,
      players: 0,
      rate: 0,
      lastUnlockedAt: null,
      playerSet: new Set()
    });
  }

  const recentUnlocks: RecentUnlock[] = [];
  let unlockedRuns = 0;
  let pointsAwarded = 0;
  const playersWithAny = new Set<string>();

  for (const run of runs) {
    const achievements = runAchievements(run, eventsByRun.get(run.runId) ?? []);
    const unlocked = achievements.filter((achievement) => achievement.unlocked);
    if (unlocked.length > 0) {
      unlockedRuns += 1;
      playersWithAny.add(run.sessionId);
    }
    for (const achievement of unlocked) {
      pointsAwarded += achievement.points;
      const stat = stats.get(achievement.id);
      if (!stat) continue;
      stat.unlockedRuns += 1;
      stat.playerSet.add(run.sessionId);
      if (!stat.lastUnlockedAt || run.endedAt > stat.lastUnlockedAt) stat.lastUnlockedAt = run.endedAt;
      recentUnlocks.push({
        achievementId: achievement.id,
        achievementName: achievement.name,
        icon: achievement.icon,
        tier: achievement.tier,
        points: achievement.points,
        sessionId: run.sessionId,
        displayName: displayNameFor(run.nickname, run.sessionId),
        runId: run.runId,
        unlockedAt: run.endedAt
      });
    }
  }

  const result = [...stats.values()].map((stat) => ({
    id: stat.id,
    name: stat.name,
    description: stat.description,
    hint: stat.hint,
    icon: stat.icon,
    tier: stat.tier,
    category: stat.category,
    points: stat.points,
    unlockedRuns: stat.unlockedRuns,
    players: stat.playerSet.size,
    rate: runs.length > 0 ? stat.unlockedRuns / runs.length : 0,
    lastUnlockedAt: stat.lastUnlockedAt
  }));

  return {
    definitions: achievementMetadata(),
    stats: result,
    recentUnlocks: recentUnlocks.sort((a, b) => b.unlockedAt.localeCompare(a.unlockedAt)).slice(0, 12),
    totals: {
      runs: runs.length,
      unlockedRuns,
      playersWithAny: playersWithAny.size,
      pointsAwarded
    }
  };
}

export function getDecisionStats(db: DatabaseSync, sessionId?: string): DecisionStats {
  const runs = loadRuns(db, sessionId);
  const events = loadEvents(db, { sessionId });
  return computeDecisionStats(events, runs);
}

export function listSessions(db: DatabaseSync, options: { limit?: number; offset?: number; search?: string } = {}): SessionList {
  const limit = clamp(options.limit ?? 20, 1, 100);
  const offset = Math.max(0, options.offset ?? 0);
  const search = (options.search ?? "").trim();
  const pattern = search ? `%${search}%` : "%";
  const emptySearch = search ? 1 : 0;

  const baseCte = `
    WITH ids AS (
      SELECT session_id FROM game_runs
      UNION
      SELECT session_id FROM game_events
    ),
    run_stats AS (
      SELECT session_id, COUNT(*) AS runs,
        SUM(CASE WHEN result = 'win' THEN 1 ELSE 0 END) AS wins,
        MAX(score) AS best_score,
        MAX(completed_requests) AS best_completed,
        SUM(completed_requests) AS total_completed,
        SUM(missed_requests) AS total_missed,
        AVG(final_project_health) AS avg_health,
        AVG(final_tech_debt) AS avg_debt,
        MAX(ended_at) AS last_run_at
      FROM game_runs GROUP BY session_id
    ),
    event_stats AS (
      SELECT session_id, COUNT(*) AS event_count,
        MAX(timestamp) AS last_event_at,
        SUM(CASE WHEN type = 'event_choice' THEN 1 ELSE 0 END) AS decisions
      FROM game_events GROUP BY session_id
    )
  `;

  const where = `
    WHERE ? = 0 OR ids.session_id LIKE ? OR EXISTS (
      SELECT 1 FROM game_runs nick
      WHERE nick.session_id = ids.session_id AND nick.nickname LIKE ?
    )
  `;

  const total = (db.prepare(`${baseCte}
    SELECT COUNT(*) AS n FROM ids ${where}
  `).get(emptySearch, pattern, pattern) as { n: number }).n;

  const rows = db.prepare(`${baseCte}
    SELECT ids.session_id,
      COALESCE(rs.runs, 0) AS runs,
      COALESCE(rs.wins, 0) AS wins,
      COALESCE(rs.best_score, 0) AS best_score,
      COALESCE(rs.best_completed, 0) AS best_completed,
      COALESCE(rs.total_completed, 0) AS total_completed,
      COALESCE(rs.total_missed, 0) AS total_missed,
      COALESCE(rs.avg_health, 0) AS avg_health,
      COALESCE(rs.avg_debt, 0) AS avg_debt,
      rs.last_run_at,
      COALESCE(es.event_count, 0) AS event_count,
      COALESCE(es.decisions, 0) AS decisions,
      es.last_event_at,
      (SELECT n.nickname FROM game_runs n
        WHERE n.session_id = ids.session_id AND n.nickname IS NOT NULL
        ORDER BY n.ended_at DESC LIMIT 1) AS nickname
    FROM ids
    LEFT JOIN run_stats rs ON rs.session_id = ids.session_id
    LEFT JOIN event_stats es ON es.session_id = ids.session_id
    ${where}
    ORDER BY MAX(COALESCE(rs.last_run_at, ''), COALESCE(es.last_event_at, '')) DESC, ids.session_id ASC
    LIMIT ? OFFSET ?
  `).all(emptySearch, pattern, pattern, limit, offset) as unknown as Array<{
    session_id: string; runs: number; wins: number; best_score: number; best_completed: number;
    total_completed: number; total_missed: number; avg_health: number; avg_debt: number;
    last_run_at: string | null; event_count: number; decisions: number; last_event_at: string | null;
    nickname: string | null;
  }>;

  const sessionIds = rows.map((row) => row.session_id);
  const runsBySession = new Map<string, StoredRun[]>();
  const eventsBySession = new Map<string, StoredEvent[]>();
  if (sessionIds.length > 0) {
    const placeholders = sessionIds.map(() => "?").join(",");
    const runRows = db.prepare(`
      SELECT run_id, session_id, started_at, ended_at, result, completed_requests, recruit_count,
        missed_requests, final_era, final_tech_debt, final_project_health, score, game_version, nickname
      FROM game_runs WHERE session_id IN (${placeholders}) ORDER BY ended_at ASC
    `).all(...sessionIds) as unknown as RunRow[];
    for (const row of runRows) {
      const run = mapRun(row);
      const list = runsBySession.get(run.sessionId) ?? [];
      list.push(run);
      runsBySession.set(run.sessionId, list);
    }
    const eventRows = db.prepare(`
      SELECT event_id, session_id, run_id, type, timestamp, elapsed, properties_json
      FROM game_events WHERE session_id IN (${placeholders}) ORDER BY timestamp ASC, rowid ASC
    `).all(...sessionIds) as unknown as EventRow[];
    for (const row of eventRows) {
      const event = mapEvent(row);
      const list = eventsBySession.get(event.sessionId) ?? [];
      list.push(event);
      eventsBySession.set(event.sessionId, list);
    }
  }

  const sessions = rows.map((row) => {
    const sessionRuns = runsBySession.get(row.session_id) ?? [];
    const sessionEvents = eventsBySession.get(row.session_id) ?? [];
    const eventsByRun = groupEventsByRun(sessionEvents);
    const wall = mergeAchievementWall(sessionRuns.map((run) => ({
      runId: run.runId,
      endedAt: run.endedAt,
      achievements: runAchievements(run, eventsByRun.get(run.runId) ?? [])
    })));
    const runsCount = Number(row.runs) || 0;
    const wins = Number(row.wins) || 0;
    const lastRunAt = row.last_run_at;
    const lastEventAt = row.last_event_at;
    const nickname = row.nickname ?? nicknameFromEvents(sessionEvents);
    return {
      sessionId: row.session_id,
      displayName: displayNameFor(nickname, row.session_id),
      nickname,
      runs: runsCount,
      wins,
      losses: runsCount - wins,
      winRate: runsCount > 0 ? wins / runsCount : 0,
      bestScore: Number(row.best_score) || 0,
      bestCompleted: Number(row.best_completed) || 0,
      totalCompleted: Number(row.total_completed) || 0,
      totalMissed: Number(row.total_missed) || 0,
      avgHealth: Number(row.avg_health) || 0,
      avgDebt: Number(row.avg_debt) || 0,
      eventCount: Number(row.event_count) || 0,
      decisions: Number(row.decisions) || 0,
      achievementCount: countUnlocked(wall),
      achievementPoints: achievementPoints(wall),
      lastActiveAt: maxIso(lastRunAt, lastEventAt),
      lastRunAt
    } satisfies SessionSummary;
  });

  return { total, sessions };
}

export function getSessionDetail(db: DatabaseSync, sessionId: string): SessionDetail | null {
  const runs = loadRuns(db, sessionId);
  const events = loadEvents(db, { sessionId });
  if (runs.length === 0 && events.length === 0) return null;
  const eventsByRun = groupEventsByRun(events);
  const runsWithAchievements = runs.map((run) => {
    const runEvents = eventsByRun.get(run.runId) ?? [];
    const achievements = runAchievements(run, runEvents);
    return {
      ...run,
      events: runEvents,
      achievements,
      unlockedAchievements: countUnlocked(achievements),
      points: achievementPoints(achievements)
    };
  });
  const wall = mergeAchievementWall(runsWithAchievements.map((run) => ({
    runId: run.runId,
    endedAt: run.endedAt,
    achievements: run.achievements
  })));
  const wins = runs.filter((run) => run.result === "win").length;
  const latestRun = runs.at(-1);
  const lastEventAt = events.at(-1)?.timestamp ?? null;
  const decisionStats = computeDecisionStats(events, runs);
  const nickname = latestNickname(runs) ?? nicknameFromEvents(events);
  const runIds = new Set(runs.map((run) => run.runId));
  const unfinishedRunIds = [...new Set(events
    .map((event) => event.runId)
    .filter((id): id is string => typeof id === "string" && !runIds.has(id)))];

  const session: SessionSummary = {
    sessionId,
    displayName: displayNameFor(nickname, sessionId),
    nickname,
    runs: runs.length,
    wins,
    losses: runs.length - wins,
    winRate: runs.length > 0 ? wins / runs.length : 0,
    bestScore: runs.reduce((best, run) => Math.max(best, run.score), 0),
    bestCompleted: runs.reduce((best, run) => Math.max(best, run.completedRequests), 0),
    totalCompleted: runs.reduce((total, run) => total + run.completedRequests, 0),
    totalMissed: runs.reduce((total, run) => total + run.missedRequests, 0),
    avgHealth: average(runs.map((run) => run.finalProjectHealth)),
    avgDebt: average(runs.map((run) => run.finalTechDebt)),
    eventCount: events.length,
    decisions: decisionStats.decisions,
    achievementCount: countUnlocked(wall),
    achievementPoints: achievementPoints(wall),
    lastActiveAt: maxIso(latestRun?.endedAt, lastEventAt),
    lastRunAt: latestRun?.endedAt ?? null
  };

  return {
    session,
    rank: getSessionRank(db, sessionId),
    runs: runsWithAchievements,
    achievements: wall,
    decisionLog: buildDecisionLog(events),
    timeline: events.map(buildTimelineEntry),
    decisions: decisionStats,
    unfinishedRunIds
  };
}

function computeDecisionStats(events: readonly StoredEvent[], runs: readonly StoredRun[]): DecisionStats {
  const choiceGroups = new Map<string, {
    eventId: string;
    title: string;
    category: string;
    choices: Map<string, { id: string; label: string; tone: string; count: number }>;
  }>();
  const toneCounts = { quality: 0, speed: 0 };
  const roleCounts = new Map<string, number>();
  const eraCounts = new Map<string, number>();
  const requestOutcomes = new Map<string, { completed: number; missed: number }>();
  const debtReasons = new Map<string, { count: number; totalDelta: number }>();
  const uiActions = new Map<string, number>();
  const runsWithRush = new Set<string>();
  const runsWithPriority = new Set<string>();
  const sessions = new Set<string>();
  let rushTotal = 0;
  let priorityTotal = 0;
  let incidents = 0;
  let abandoned = 0;
  let decisions = 0;

  for (const run of runs) sessions.add(run.sessionId);

  for (const event of events) {
    sessions.add(event.sessionId);
    const properties = event.properties;
    switch (event.type) {
      case "event_choice": {
        decisions += 1;
        const eventId = stringValue(properties.event) || "unknown";
        const choiceId = stringValue(properties.choice) || "unknown";
        const catalogEvent = getDecisionEvent(eventId);
        const catalogChoice = getDecisionChoice(choiceId);
        const group = choiceGroups.get(eventId) ?? {
          eventId,
          title: catalogEvent?.title ?? eventId,
          category: catalogEvent?.category ?? "unknown",
          choices: new Map()
        };
        const choice = group.choices.get(choiceId) ?? {
          id: choiceId,
          label: catalogChoice?.choice.label ?? getChoiceLabel(choiceId),
          tone: catalogChoice?.choice.tone ?? "neutral",
          count: 0
        };
        choice.count += 1;
        group.choices.set(choiceId, choice);
        choiceGroups.set(eventId, group);
        if (catalogChoice?.choice.tone === "quality") toneCounts.quality += 1;
        if (catalogChoice?.choice.tone === "speed") toneCounts.speed += 1;
        break;
      }
      case "recruit": {
        const role = stringValue(properties.role) || "unknown";
        roleCounts.set(role, (roleCounts.get(role) ?? 0) + 1);
        break;
      }
      case "rush_activated":
        rushTotal += 1;
        if (event.runId) runsWithRush.add(event.runId);
        break;
      case "requirement_prioritized":
        priorityTotal += 1;
        if (event.runId) runsWithPriority.add(event.runId);
        break;
      case "era_upgrade": {
        const era = stringValue(properties.era) || "未知时代";
        eraCounts.set(era, (eraCounts.get(era) ?? 0) + 1);
        break;
      }
      case "request_complete": {
        const code = stringValue(properties.request) || "unknown";
        const outcome = requestOutcomes.get(code) ?? { completed: 0, missed: 0 };
        outcome.completed += 1;
        requestOutcomes.set(code, outcome);
        break;
      }
      case "request_missed": {
        const code = stringValue(properties.request) || "unknown";
        const outcome = requestOutcomes.get(code) ?? { completed: 0, missed: 0 };
        outcome.missed += 1;
        requestOutcomes.set(code, outcome);
        break;
      }
      case "debt_change": {
        const reason = stringValue(properties.reason) || "未标注";
        const delta = numberValue(properties.delta);
        const record = debtReasons.get(reason) ?? { count: 0, totalDelta: 0 };
        record.count += 1;
        record.totalDelta += delta;
        debtReasons.set(reason, record);
        break;
      }
      case "online_incident":
        incidents += 1;
        break;
      case "ui_action": {
        const action = stringValue(properties.action) || "unknown";
        uiActions.set(action, (uiActions.get(action) ?? 0) + 1);
        break;
      }
      case "run_abandoned":
        abandoned += 1;
        break;
    }
  }

  const choices: DecisionStats["choices"] = DECISION_CATALOG.map((catalogEvent) => {
    const group = choiceGroups.get(catalogEvent.id);
    const total = group ? [...group.choices.values()].reduce((sum, choice) => sum + choice.count, 0) : 0;
    return {
      eventId: catalogEvent.id,
      title: catalogEvent.title,
      category: catalogEvent.category,
      total,
      choices: catalogEvent.choices.map((catalogChoice) => {
        const count = group?.choices.get(catalogChoice.id)?.count ?? 0;
        return {
          id: catalogChoice.id,
          label: catalogChoice.label,
          tone: catalogChoice.tone,
          count,
          share: total > 0 ? count / total : 0
        };
      })
    };
  });
  for (const [eventId, group] of choiceGroups) {
    if (DECISION_CATALOG.some((event) => event.id === eventId)) continue;
    const total = [...group.choices.values()].reduce((sum, choice) => sum + choice.count, 0);
    choices.push({
      eventId,
      title: group.title,
      category: group.category,
      total,
      choices: [...group.choices.values()].map((choice) => ({
        ...choice,
        share: total > 0 ? choice.count / total : 0
      }))
    });
  }

  const roleTotal = sum([...roleCounts.values()]);
  const roles = ROLE_CATALOG.map((role) => {
    const count = roleCounts.get(role.id) ?? 0;
    return { id: role.id, name: role.name, count, share: roleTotal > 0 ? count / roleTotal : 0 };
  });

  const eraUpgrades: DecisionStats["eraUpgrades"] = ERA_CATALOG.map((era) => ({
    era: era.name,
    name: era.name,
    count: eraCounts.get(era.name) ?? 0
  }));
  for (const [era, count] of eraCounts) {
    if (!ERA_CATALOG.some((entry) => entry.name === era)) eraUpgrades.push({ era, name: era, count });
  }

  const requestOutcomesList = [...requestOutcomes.entries()]
    .map(([code, outcome]) => ({
      code,
      completed: outcome.completed,
      missed: outcome.missed,
      completionRate: outcome.completed + outcome.missed > 0
        ? outcome.completed / (outcome.completed + outcome.missed)
        : 0
    }))
    .sort((a, b) => a.code.localeCompare(b.code, "en", { numeric: true }));

  const quality = toneCounts.quality;
  const speed = toneCounts.speed;

  return {
    sessions: sessions.size,
    runs: runs.length,
    decisions,
    choices,
    choiceTone: {
      quality,
      speed,
      qualityShare: quality + speed > 0 ? quality / (quality + speed) : 0
    },
    roles,
    rush: {
      total: rushTotal,
      runsWithRush: runsWithRush.size,
      avgPerRun: runs.length > 0 ? rushTotal / runs.length : 0
    },
    priorities: {
      total: priorityTotal,
      runsWithPriority: runsWithPriority.size,
      avgPerRun: runs.length > 0 ? priorityTotal / runs.length : 0
    },
    eraUpgrades,
    requestOutcomes: requestOutcomesList,
    debtReasons: [...debtReasons.entries()]
      .map(([reason, record]) => ({
        reason,
        count: record.count,
        totalDelta: Math.round(record.totalDelta),
        avgDelta: record.count > 0 ? record.totalDelta / record.count : 0
      }))
      .sort((a, b) => b.count - a.count),
    incidents,
    uiActions: [...uiActions.entries()]
      .map(([action, count]) => ({ action, count }))
      .sort((a, b) => b.count - a.count),
    abandoned
  };
}

function buildDecisionLog(events: readonly StoredEvent[]): DecisionLogEntry[] {
  const log: DecisionLogEntry[] = [];
  for (const event of events) {
    const properties = event.properties;
    switch (event.type) {
      case "event_choice": {
        const eventId = stringValue(properties.event);
        const choiceId = stringValue(properties.choice);
        const decision = getDecisionChoice(choiceId);
        log.push({
          runId: event.runId,
          at: event.elapsed,
          timestamp: event.timestamp,
          kind: "choice",
          title: decision?.event.title ?? getDecisionEvent(eventId)?.title ?? (eventId || "需求变更"),
          detail: decision?.choice.label ?? getChoiceLabel(choiceId),
          tone: decision?.choice.tone ?? "neutral"
        });
        break;
      }
      case "recruit":
        log.push({
          runId: event.runId,
          at: event.elapsed,
          timestamp: event.timestamp,
          kind: "recruit",
          title: `招募 ${getRoleName(stringValue(properties.role))}`,
          detail: `花费 ${Math.round(numberValue(properties.cost))} 预算`,
          tone: "neutral"
        });
        break;
      case "era_upgrade":
        log.push({
          runId: event.runId,
          at: event.elapsed,
          timestamp: event.timestamp,
          kind: "era",
          title: `升级到 ${stringValue(properties.era) || "新时代"}`,
          detail: `消耗 ${Math.round(numberValue(properties.experienceCost))} 经验`,
          tone: "neutral"
        });
        break;
      case "requirement_prioritized":
        log.push({
          runId: event.runId,
          at: event.elapsed,
          timestamp: event.timestamp,
          kind: "priority",
          title: `优先调度 ${stringValue(properties.requirement) || "需求"}`,
          detail: `${Math.round(numberValue(properties.engineers))} 名工程师响应`,
          tone: "neutral"
        });
        break;
      case "rush_activated":
        log.push({
          runId: event.runId,
          at: event.elapsed,
          timestamp: event.timestamp,
          kind: "rush",
          title: "极限冲刺",
          detail: `效率 +${Math.round(numberValue(properties.workBonus) * 100)}%，技术债 +${Math.round(numberValue(properties.techDebt))}`,
          tone: "speed"
        });
        break;
    }
  }
  return log;
}

function buildTimelineEntry(event: StoredEvent): TimelineEntry {
  const properties = event.properties;
  const base = {
    id: event.eventId,
    runId: event.runId,
    type: event.type,
    timestamp: event.timestamp,
    at: event.elapsed,
    properties
  };
  switch (event.type) {
    case "enter":
      return { ...base, label: "进入游戏", category: "session" };
    case "game_start":
      return { ...base, label: "开始新项目", category: "session" };
    case "recruit":
      return { ...base, label: `招募 ${getRoleName(stringValue(properties.role))}`, category: "decision" };
    case "era_upgrade":
      return { ...base, label: `升级到 ${stringValue(properties.era) || "新时代"}`, category: "decision" };
    case "event_choice": {
      const decision = getDecisionChoice(stringValue(properties.choice));
      return {
        ...base,
        label: decision
          ? `${decision.event.title} → ${decision.choice.label}`
          : `需求变更 → ${getChoiceLabel(stringValue(properties.choice))}`,
        category: "decision"
      };
    }
    case "requirement_prioritized":
      return { ...base, label: `优先调度 ${stringValue(properties.requirement) || "需求"}`, category: "decision" };
    case "rush_activated":
      return { ...base, label: "使用极限冲刺", category: "decision" };
    case "rush_completed":
      return { ...base, label: "极限冲刺结束", category: "outcome" };
    case "request_complete":
      return { ...base, label: `验收 ${stringValue(properties.request) || "需求"}`, category: "outcome" };
    case "request_missed":
      return { ...base, label: `漏单 ${stringValue(properties.request) || "需求"}`, category: "outcome" };
    case "debt_change":
      return {
        ...base,
        label: `${stringValue(properties.reason) || "技术债变化"} ${Math.round(numberValue(properties.from))} → ${Math.round(numberValue(properties.to))}`,
        category: "risk"
      };
    case "online_incident":
      return { ...base, label: "线上故障", category: "risk" };
    case "win":
      return { ...base, label: "项目上线成功", category: "outcome" };
    case "loss":
      return { ...base, label: `项目未上线：${stringValue(properties.reason) || "未达成目标"}`, category: "outcome" };
    case "replay":
      return { ...base, label: "再开一个项目", category: "session" };
    case "change_event":
      return { ...base, label: "出现需求变更", category: "risk" };
    case "load_error":
      return { ...base, label: "载入失败", category: "system" };
    case "ui_action":
      return { ...base, label: `界面操作：${stringValue(properties.action) || "unknown"}`, category: "session" };
    case "run_abandoned":
      return { ...base, label: "中途离开项目", category: "session" };
    default:
      return { ...base, label: event.type, category: "system" };
  }
}

function dailyActivity(runs: readonly StoredRun[], events: readonly StoredEvent[], days: number): Array<{ date: string; runs: number; wins: number; events: number }> {
  const buckets = new Map<string, { runs: number; wins: number; events: number }>();
  const today = new Date();
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - offset));
    buckets.set(date.toISOString().slice(0, 10), { runs: 0, wins: 0, events: 0 });
  }
  for (const run of runs) {
    const bucket = buckets.get(run.endedAt.slice(0, 10));
    if (!bucket) continue;
    bucket.runs += 1;
    if (run.result === "win") bucket.wins += 1;
  }
  for (const event of events) {
    const bucket = buckets.get(event.timestamp.slice(0, 10));
    if (bucket) bucket.events += 1;
  }
  return [...buckets.entries()].map(([date, bucket]) => ({ date, ...bucket }));
}

function latestNickname(runs: readonly StoredRun[]): string | null {
  for (let index = runs.length - 1; index >= 0; index -= 1) {
    const nickname = runs[index]?.nickname;
    if (nickname) return nickname;
  }
  return null;
}

function nicknameFromEvents(events: readonly StoredEvent[]): string | null {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const value = events[index]?.properties.nickname;
    if (typeof value === "string" && value.trim()) return value.trim().slice(0, 24);
  }
  return null;
}

function groupEventsByRun(events: readonly StoredEvent[]): Map<string, StoredEvent[]> {
  const grouped = new Map<string, StoredEvent[]>();
  for (const event of events) {
    if (!event.runId) continue;
    const list = grouped.get(event.runId) ?? [];
    list.push(event);
    grouped.set(event.runId, list);
  }
  return grouped;
}

function mapRun(row: RunRow): StoredRun {
  return {
    runId: row.run_id,
    sessionId: row.session_id,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    result: row.result,
    completedRequests: Number(row.completed_requests),
    recruitCount: Number(row.recruit_count),
    missedRequests: Number(row.missed_requests),
    finalEra: Number(row.final_era),
    finalTechDebt: Number(row.final_tech_debt),
    finalProjectHealth: Number(row.final_project_health),
    gameVersion: row.game_version,
    nickname: row.nickname,
    score: Number(row.score)
  };
}

function mapEvent(row: EventRow): StoredEvent {
  return {
    eventId: row.event_id,
    sessionId: row.session_id,
    runId: row.run_id,
    type: row.type,
    timestamp: row.timestamp,
    elapsed: row.elapsed === null ? null : Number(row.elapsed),
    properties: parseProperties(row.properties_json)
  };
}

function parseProperties(value: string): Record<string, string | number | boolean> {
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const result: Record<string, string | number | boolean> = {};
    for (const [key, entry] of Object.entries(parsed)) {
      if (typeof entry === "string" || typeof entry === "number" || typeof entry === "boolean") {
        result[key] = entry;
      }
    }
    return result;
  } catch {
    return {};
  }
}

function maxIso(a: string | null | undefined, b: string | null | undefined): string | null {
  return [a, b].filter((value): value is string => Boolean(value)).sort().at(-1) ?? null;
}

function sum(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function average(values: readonly number[]): number {
  return values.length > 0 ? sum(values) / values.length : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, Math.round(value)));
}

function stringValue(value: string | number | boolean | undefined): string {
  return typeof value === "string" ? value : value === undefined ? "" : String(value);
}

function numberValue(value: string | number | boolean | undefined): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}
