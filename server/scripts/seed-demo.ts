import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { openDatabase, runMigrations, saveRun, insertEvents } from "../src/database.ts";
import type { GameEventInput, RunInput } from "../src/schemas.ts";
import { getDecisionChoice } from "../../shared/catalog.ts";

interface Profile {
  key: string;
  nickname: string | null;
  daysAgo: number;
  hour: number;
  result: "win" | "loss";
  completed: number;
  missed: number;
  recruits: number;
  finalEra: number;
  debtPeak: number;
  finalDebt: number;
  health: number;
  choices: string[];
  rushes: number;
  priorities: number;
  incidents: number;
  abandoned?: boolean;
}

const PROFILES: Profile[] = [
  {
    key: "quality", nickname: "上线守门人", daysAgo: 0, hour: 10, result: "win",
    completed: 13, missed: 0, recruits: 6, finalEra: 2, debtPeak: 32, finalDebt: 0, health: 100,
    choices: ["freeze-scope", "verify-release", "fix-alert", "review-first", "freeze-scope", "fix-alert"],
    rushes: 1, priorities: 6, incidents: 0
  },
  {
    key: "speed", nickname: "Sprint 怪兽", daysAgo: 0, hour: 12, result: "win",
    completed: 15, missed: 2, recruits: 9, finalEra: 2, debtPeak: 168, finalDebt: 92, health: 46,
    choices: ["accept-scope", "quick-release", "hotfix-alert", "auto-generate", "accept-scope", "hotfix-alert"],
    rushes: 4, priorities: 3, incidents: 1
  },
  {
    key: "solo", nickname: "孤胆实习生", daysAgo: 0, hour: 14, result: "win",
    completed: 10, missed: 0, recruits: 1, finalEra: 0, debtPeak: 0, finalDebt: 0, health: 100,
    choices: ["freeze-scope", "verify-release", "fix-alert", "review-first"],
    rushes: 0, priorities: 2, incidents: 0
  },
  {
    key: "casual", nickname: "需求受害者", daysAgo: 0, hour: 16, result: "loss",
    completed: 4, missed: 6, recruits: 2, finalEra: 0, debtPeak: 58, finalDebt: 58, health: 0,
    choices: ["quick-release", "hotfix-alert"],
    rushes: 2, priorities: 1, incidents: 0
  },
  {
    key: "agent", nickname: "Agent 驯化师", daysAgo: 1, hour: 11, result: "win",
    completed: 14, missed: 1, recruits: 8, finalEra: 2, debtPeak: 120, finalDebt: 54, health: 72,
    choices: ["accept-scope", "quick-release", "fix-alert", "auto-generate", "review-first", "auto-generate"],
    rushes: 3, priorities: 5, incidents: 1
  },
  {
    key: "tester", nickname: "回归测试永动机", daysAgo: 1, hour: 15, result: "win",
    completed: 12, missed: 0, recruits: 5, finalEra: 1, debtPeak: 24, finalDebt: 6, health: 96,
    choices: ["freeze-scope", "verify-release", "fix-alert", "review-first"],
    rushes: 1, priorities: 4, incidents: 0
  },
  {
    key: "overbudget", nickname: "预算黑洞", daysAgo: 2, hour: 9, result: "loss",
    completed: 8, missed: 4, recruits: 7, finalEra: 1, debtPeak: 96, finalDebt: 96, health: 0,
    choices: ["accept-scope", "quick-release", "hotfix-alert", "auto-generate"],
    rushes: 3, priorities: 2, incidents: 1
  },
  {
    key: "mystery", nickname: null, daysAgo: 2, hour: 17, result: "win",
    completed: 11, missed: 0, recruits: 4, finalEra: 2, debtPeak: 40, finalDebt: 12, health: 88,
    choices: ["freeze-scope", "quick-release", "hotfix-alert", "review-first"],
    rushes: 2, priorities: 3, incidents: 0
  },
  {
    key: "newbie", nickname: "第一次上线", daysAgo: 3, hour: 20, result: "loss",
    completed: 3, missed: 7, recruits: 2, finalEra: 0, debtPeak: 20, finalDebt: 20, health: 0,
    choices: ["accept-scope"],
    rushes: 1, priorities: 0, incidents: 0
  },
  {
    key: "nightowl", nickname: "凌晨三点改需求", daysAgo: 4, hour: 2, result: "win",
    completed: 12, missed: 0, recruits: 6, finalEra: 2, debtPeak: 74, finalDebt: 18, health: 84,
    choices: ["freeze-scope", "verify-release", "fix-alert", "review-first", "freeze-scope", "fix-alert"],
    rushes: 2, priorities: 5, incidents: 0
  },
  {
    key: "incident", nickname: "线上救火队", daysAgo: 5, hour: 13, result: "win",
    completed: 12, missed: 1, recruits: 6, finalEra: 2, debtPeak: 180, finalDebt: 48, health: 34,
    choices: ["accept-scope", "quick-release", "fix-alert", "auto-generate", "hotfix-alert"],
    rushes: 4, priorities: 4, incidents: 2
  },
  {
    key: "unfinished", nickname: "半途而废研究所", daysAgo: 0, hour: 18, result: "loss",
    completed: 0, missed: 0, recruits: 3, finalEra: 1, debtPeak: 46, finalDebt: 0, health: 70,
    choices: ["quick-release", "hotfix-alert"], rushes: 1, priorities: 1, incidents: 0, abandoned: true
  }
];

const ROLE_IDS = ["intern", "frontend", "backend", "qa", "agent"];
const ERA_NAMES = ["手搓时代", "工程化时代", "Agent 时代"];
const BASE = new Date();

const dbPath = process.env.DATABASE_PATH ?? resolve(process.cwd(), "data/game.sqlite");
if (process.argv.includes("--force")) cleanup();
const db = openDatabase(dbPath);
runMigrations(db);
cleanup();
seed();

db.close();
console.log(`\n演示数据已写入 ${dbPath}`);
console.log("启动 API 后访问 http://127.0.0.1:8787/admin 查看决策分析台。\n");

function cleanup(): void {
  if (!process.argv.includes("--force")) return;
  const database = openDatabase(dbPath);
  runMigrations(database);
  database.exec("DELETE FROM game_events WHERE event_id LIKE 'demo\\_%' ESCAPE '\\'");
  database.exec("DELETE FROM game_runs WHERE run_id LIKE 'demo\\_%' ESCAPE '\\'");
  database.close();
}

function seed(): void {
  const existing = db.prepare("SELECT COUNT(*) AS n FROM game_runs WHERE run_id LIKE 'demo\\_%' ESCAPE '\\'").get() as { n: number };
  if (existing.n > 0) {
    console.log(`已存在 ${existing.n} 条演示对局，跳过。使用 --force 覆盖演示数据。`);
    return;
  }

  let runNumber = 0;
  PROFILES.forEach((profile, profileIndex) => {
    const sessionId = `demo-session-${String(profileIndex + 1).padStart(2, "0")}`;
    const start = new Date(BASE);
    start.setDate(start.getDate() - profile.daysAgo);
    start.setHours(profile.hour, 12, 0, 0);
    if (start.getTime() > BASE.getTime()) start.setDate(start.getDate() - 1);

    if (profile.abandoned) {
      const events = buildEvents({
        sessionId,
        runId: `demo-run-${String(profileIndex + 1).padStart(3, "0")}`,
        profile,
        startedAt: start,
        duration: 150
      });
      insertEvents(db, events);
      return;
    }

    const runs = profile.key === "quality" ? 2 : profile.key === "speed" ? 3 : 1;
    for (let runIndex = 0; runIndex < runs; runIndex += 1) {
      runNumber += 1;
      const startedAt = new Date(start.getTime() - runIndex * 47 * 60 * 1000);
      const adjusted = { ...profile, daysAgo: 0 };
      if (runIndex > 0) {
        adjusted.completed = Math.max(1, profile.completed - runIndex * 2);
        adjusted.missed = profile.missed + runIndex;
        adjusted.health = Math.max(12, profile.health - runIndex * 18);
        adjusted.finalDebt = Math.min(220, profile.finalDebt + runIndex * 16);
        adjusted.result = profile.key === "quality" ? "win" : profile.result;
      }
      const duration = 205 + ((profileIndex * 17 + runIndex * 11) % 70);
      const runId = `demo-run-${String(runNumber).padStart(3, "0")}`;
      const endedAt = new Date(startedAt.getTime() + duration * 1000);
      const events = buildEvents({
        sessionId,
        runId,
        profile: adjusted,
        startedAt,
        duration
      });
      insertEvents(db, events);
      const run: RunInput = {
        runId,
        sessionId,
        startedAt: startedAt.toISOString(),
        endedAt: endedAt.toISOString(),
        result: adjusted.result,
        completedRequests: adjusted.completed,
        recruitCount: adjusted.recruits,
        missedRequests: adjusted.missed,
        finalEra: adjusted.finalEra,
        finalTechDebt: adjusted.finalDebt,
        finalProjectHealth: adjusted.health,
        gameVersion: "0.1.0",
        ...(profile.nickname ? { nickname: profile.nickname } : {})
      };
      saveRun(db, run);
    }
  });
}

function buildEvents(options: {
  sessionId: string;
  runId: string;
  profile: Profile;
  startedAt: Date;
  duration: number;
}): GameEventInput[] {
  const { sessionId, runId, profile, startedAt, duration } = options;
  const events: GameEventInput[] = [];
  let sequence = 0;
  let elapsed = 2;
  const push = (type: GameEventInput["type"], properties: GameEventInput["properties"], at?: number): void => {
    sequence += 1;
    events.push({
      eventId: `demo_${sessionId.slice(-2)}_${runId.slice(-3)}_e${String(sequence).padStart(3, "0")}`,
      sessionId,
      runId,
      type,
      timestamp: new Date(startedAt.getTime() + Math.min(duration, Math.max(0, at ?? elapsed)) * 1000).toISOString(),
      elapsed: Math.min(duration, Math.max(0, at ?? elapsed)),
      properties
    });
  };

  push("game_start", profile.nickname ? { nickname: profile.nickname } : {}, 1);
  elapsed = 8;
  for (let index = 0; index < profile.recruits; index += 1) {
    push("recruit", { role: ROLE_IDS[index % ROLE_IDS.length], cost: 35 + index * 15, budget: 120 - index * 8 }, elapsed);
    elapsed += 9;
  }
  for (let era = 1; era <= profile.finalEra; era += 1) {
    push("era_upgrade", { era: ERA_NAMES[era], experienceCost: era === 1 ? 80 : 180, productivity: era === 1 ? 1.1 : 1.2 }, elapsed);
    elapsed += 12;
  }
  for (let index = 0; index < profile.priorities; index += 1) {
    push("requirement_prioritized", {
      requirement: index === 0 ? "GO-LIVE" : `R-${String(index + 1).padStart(3, "0")}`,
      engineers: (index % 3) + 1,
      roles: ROLE_IDS[index % ROLE_IDS.length],
      deferred: ""
    }, elapsed);
    elapsed += 7;
  }
  for (let index = 0; index < profile.rushes; index += 1) {
    push("rush_activated", { duration: 12, workBonus: 0.4, techDebt: 25, cooldown: 45 }, elapsed);
    elapsed += 13;
  }
  profile.choices.forEach((choiceId, index) => {
    const found = getDecisionChoice(choiceId);
    push("change_event", { event: found?.event.id ?? "unknown" }, elapsed);
    push("event_choice", {
      event: found?.event.id ?? "unknown",
      choice: choiceId,
      budget: 80,
      experience: 20 + index * 5,
      techDebt: Math.min(profile.debtPeak, 20 + index * 10)
    }, elapsed + 2);
    elapsed += 17;
  });
  push("ui_action", { action: "speed", speed: 2 }, elapsed);
  push("ui_action", { action: "pause", paused: true }, elapsed + 1);
  push("debt_change", { from: 0, to: profile.debtPeak, delta: profile.debtPeak, reason: "需求压力与冲刺" }, Math.min(duration - 20, elapsed));
  if (profile.finalDebt !== profile.debtPeak) {
    push("debt_change", {
      from: profile.debtPeak,
      to: profile.finalDebt,
      delta: profile.finalDebt - profile.debtPeak,
      reason: "回归与复盘"
    }, Math.min(duration - 10, elapsed + 8));
  }
  for (let index = 0; index < profile.incidents; index += 1) {
    push("online_incident", { projectHealth: Math.max(0, profile.health - 18), techDebt: profile.finalDebt, duration: 10 }, Math.min(duration - 5, elapsed + 12 + index * 7));
  }
  const completedCodes = buildCompletedCodes(profile.completed, profile.result === "win");
  completedCodes.forEach((code, index) => {
    push("request_complete", {
      request: code,
      budget: 60 + index * 5,
      experience: 25 + index * 3,
      final: code === "GO-LIVE"
    }, Math.min(duration - 3, 30 + index * 14));
  });
  for (let index = 0; index < profile.missed; index += 1) {
    push("request_missed", { request: `R-${String(20 + index).padStart(3, "0")}`, severity: 10, projectHealth: Math.max(0, profile.health - index * 10) }, Math.min(duration - 2, 60 + index * 21));
  }
  push(profile.result === "win" ? "win" : "loss", {
    result: profile.result === "win" ? "victory" : "defeat",
    reason: profile.result === "win" ? "最终需求按时交付" : "项目健康度归零",
    elapsed: Math.round(duration),
    era: ERA_NAMES[profile.finalEra],
    projectHealth: profile.health,
    techDebt: profile.finalDebt
  }, duration);

  if (profile.abandoned) {
    push("run_abandoned", {
      elapsed: 150,
      completedRequests: 0,
      recruitCount: profile.recruits,
      missedRequests: 0,
      finalEra: profile.finalEra,
      finalTechDebt: profile.debtPeak,
      finalProjectHealth: profile.health,
      ...(profile.nickname ? { nickname: profile.nickname } : {})
    }, 150);
  }
  return events;
}

function buildCompletedCodes(count: number, win: boolean): string[] {
  const codes: string[] = [];
  for (let index = 1; index <= 11 && codes.length < count; index += 1) {
    codes.push(`R-${String(index).padStart(3, "0")}`);
  }
  while (codes.length < count - (win ? 1 : 0)) codes.push("R-CHANGE");
  if (win) codes.push("GO-LIVE");
  return codes.slice(0, count);
}
