import assert from "node:assert/strict";
import test from "node:test";
import {
  buildRunFacts,
  evaluateAchievements,
  mergeAchievementWall,
  type AchievementSourceEvent
} from "../../shared/achievements.ts";
import { calculateRunScore } from "../../shared/scoring.ts";

function perfectEvents(): AchievementSourceEvent[] {
  const events: AchievementSourceEvent[] = [
    { type: "game_start", properties: { nickname: "测试员" } },
    { type: "recruit", properties: { role: "frontend" } },
    { type: "recruit", properties: { role: "qa" } },
    { type: "era_upgrade", properties: { era: "工程化时代" } },
    { type: "era_upgrade", properties: { era: "Agent 时代" } },
    { type: "event_choice", properties: { event: "scope-creep", choice: "freeze-scope" } },
    { type: "event_choice", properties: { event: "release-window", choice: "verify-release" } },
    { type: "event_choice", properties: { event: "production-alert", choice: "fix-alert" } },
    { type: "event_choice", properties: { event: "ai-policy", choice: "review-first" } },
    { type: "event_choice", properties: { event: "scope-creep", choice: "freeze-scope" } },
    { type: "event_choice", properties: { event: "production-alert", choice: "fix-alert" } },
    { type: "rush_activated", properties: { duration: 12 } },
    { type: "rush_activated", properties: { duration: 12 } },
    { type: "rush_activated", properties: { duration: 12 } },
    { type: "requirement_prioritized", properties: { requirement: "R-001" } },
    { type: "requirement_prioritized", properties: { requirement: "R-002" } },
    { type: "requirement_prioritized", properties: { requirement: "R-003" } },
    { type: "requirement_prioritized", properties: { requirement: "R-004" } },
    { type: "requirement_prioritized", properties: { requirement: "R-005" } },
    { type: "debt_change", properties: { from: 0, to: 20, delta: 20, reason: "冲刺" } }
  ];
  for (let index = 0; index < 14; index += 1) {
    events.push({ type: "request_complete", properties: { request: `R-${index + 1}` } });
  }
  return events;
}

test("builds run facts from event properties", () => {
  const facts = buildRunFacts({
    result: "win",
    completedRequests: 14,
    recruitCount: 8,
    missedRequests: 0,
    finalEra: 2,
    finalTechDebt: 0,
    finalProjectHealth: 100,
    durationSeconds: 230,
    events: perfectEvents()
  });

  assert.equal(facts.choices.length, 6);
  assert.equal(facts.roles.length, 2);
  assert.equal(facts.rushCount, 3);
  assert.equal(facts.priorityCount, 5);
  assert.equal(facts.eraUpgrades, 2);
  assert.equal(facts.maxTechDebt, 20);
  assert.equal(facts.completedCodes.length, 14);
  assert.equal(facts.durationSeconds, 230);
});

test("perfect run unlocks the expected delivery, decision and speed achievements", () => {
  const facts = buildRunFacts({
    result: "win",
    completedRequests: 14,
    recruitCount: 8,
    missedRequests: 0,
    finalEra: 2,
    finalTechDebt: 0,
    finalProjectHealth: 100,
    durationSeconds: 230,
    events: perfectEvents()
  });
  const results = evaluateAchievements(facts);
  const unlocked = new Set(results.filter((result) => result.unlocked).map((result) => result.id));

  for (const id of [
    "first-run",
    "first-launch",
    "flawless-launch",
    "all-hands",
    "agent-era",
    "debt-free",
    "iron-health",
    "speed-run",
    "decision-maker",
    "scope-guard",
    "quality-first",
    "rush-addict",
    "priority-master",
    "completionist"
  ]) {
    assert.ok(unlocked.has(id), `expected ${id} to unlock`);
  }
  assert.equal(unlocked.has("solo-carry"), false);
  assert.equal(unlocked.has("comeback"), false);
  assert.equal(unlocked.has("firefighter"), false);
  assert.equal(unlocked.has("debt-survivor"), false);

  const allHands = results.find((result) => result.id === "all-hands");
  assert.equal(allHands?.progress, 1);
  assert.equal(allHands?.target, 8);
  assert.equal(allHands?.value, 8);
});

test("a losing run still records play but not launch achievements", () => {
  const facts = buildRunFacts({
    result: "loss",
    completedRequests: 3,
    recruitCount: 2,
    missedRequests: 5,
    finalEra: 0,
    finalTechDebt: 58,
    finalProjectHealth: 0,
    durationSeconds: 300,
    events: [
      { type: "event_choice", properties: { event: "scope-creep", choice: "accept-scope" } },
      { type: "rush_activated", properties: {} }
    ]
  });
  const results = evaluateAchievements(facts);
  const unlocked = new Set(results.filter((result) => result.unlocked).map((result) => result.id));

  assert.ok(unlocked.has("first-run"));
  assert.equal(unlocked.has("first-launch"), false);
  assert.equal(unlocked.has("debt-free"), false);
  assert.equal(unlocked.has("flawless-launch"), false);
});

test("merges per-run results into one wall with earliest unlock", () => {
  const first = evaluateAchievements(buildRunFacts({
    result: "win",
    completedRequests: 10,
    recruitCount: 4,
    missedRequests: 0,
    finalEra: 1,
    finalTechDebt: 0,
    finalProjectHealth: 100,
    durationSeconds: 290,
    events: []
  }));
  const second = evaluateAchievements(buildRunFacts({
    result: "win",
    completedRequests: 15,
    recruitCount: 8,
    missedRequests: 0,
    finalEra: 2,
    finalTechDebt: 0,
    finalProjectHealth: 100,
    durationSeconds: 220,
    events: [
      { type: "event_choice", properties: { event: "scope-creep", choice: "freeze-scope" } },
      { type: "event_choice", properties: { event: "scope-creep", choice: "freeze-scope" } }
    ]
  }));

  const wall = mergeAchievementWall([
    { runId: "run-first", endedAt: "2026-10-20T10:00:00.000Z", achievements: first },
    { runId: "run-second", endedAt: "2026-10-21T10:00:00.000Z", achievements: second }
  ]);
  const firstLaunch = wall.find((achievement) => achievement.id === "first-launch");
  const allHands = wall.find((achievement) => achievement.id === "all-hands");
  const solo = wall.find((achievement) => achievement.id === "solo-carry");

  assert.equal(firstLaunch?.unlocked, true);
  assert.equal(firstLaunch?.unlockedAt, "2026-10-20T10:00:00.000Z");
  assert.equal(firstLaunch?.unlockedRuns, 2);
  assert.equal(allHands?.unlocked, true);
  assert.equal(allHands?.unlockedAt, "2026-10-21T10:00:00.000Z");
  assert.equal(solo?.unlocked, false);
});

test("scores deterministically and never goes negative", () => {
  assert.equal(calculateRunScore({
    result: "win",
    completedRequests: 12,
    missedRequests: 0,
    finalProjectHealth: 90,
    finalTechDebt: 20
  }), 3000);
  assert.equal(calculateRunScore({
    result: "loss",
    completedRequests: 2,
    missedRequests: 8,
    finalProjectHealth: 0,
    finalTechDebt: 100
  }), 0);
});
