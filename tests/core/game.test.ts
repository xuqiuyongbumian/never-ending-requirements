import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceBattle,
  BASE_FRONT_EDGE,
  CHANGE_EVENTS,
  chooseChange,
  createBattle,
  ENGINEER_DEFS,
  ERAS,
  getEngineerDefinition,
  hireEngineer,
  MAX_PROJECT_HEALTH,
  MAX_TRAINING_QUEUE,
  type BattleState,
  type EngineerId,
  type Requirement,
  upgradeEra
} from "../../src/core/game.ts";

function addRequest(state: BattleState, overrides: Partial<Requirement> = {}): Requirement {
  const request: Requirement = {
    id: state.nextRequestId++, code: "R-TEST", title: "测试需求", kind: "feature", x: 500, speed: 0,
    totalWork: 1, remainingWork: 0.1, budgetReward: 50, experienceReward: 24, severity: 10, isFinal: false, agentWork: 0,
    ...overrides
  };
  state.requests.push(request);
  return request;
}

function tick(state: BattleState, seconds: number): void {
  for (let frame = 0; frame < Math.ceil(seconds * 30) && state.phase === "running"; frame += 1) {
    if (state.pendingEvent) chooseChange(state, state.pendingEvent.choices[0].id);
    advanceBattle(state, 1 / 30);
  }
}

function safeChoice(state: BattleState): void {
  const event = state.pendingEvent;
  if (!event) return;
  const preference = ["freeze-scope", "verify-release", state.budget >= 40 ? "fix-alert" : "hotfix-alert", "review-first"];
  const choice = event.choices.find((item) => preference.includes(item.id)) ?? event.choices[0];
  assert.equal(chooseChange(state, choice.id), true);
}

function runWinningPolicy(state: BattleState): void {
  let nextHireAt = 0;
  for (let frame = 0; frame < 30 * 300 && state.phase === "running"; frame += 1) {
    if (state.pendingEvent) safeChoice(state);
    const nextEra = ERAS[state.techEra + 1];
    if (nextEra && state.experience >= nextEra.cost) upgradeEra(state);

    const roster = [...state.engineers.map((engineer) => engineer.role), ...state.queue.map((order) => order.role)];
    let desired: EngineerId | null = null;
    if (roster.filter((role) => role === "frontend").length < 2) desired = "frontend";
    else if (state.techEra >= 1 && !roster.includes("backend")) desired = "backend";
    else if (state.techEra >= 1 && !roster.includes("qa")) desired = "qa";
    else if (state.techEra >= 2 && !roster.includes("agent")) desired = "agent";
    else if (roster.filter((role) => role === "backend").length < 2 && state.techEra >= 1) desired = "backend";
    if (desired && state.elapsed >= nextHireAt && state.queue.length < 2 && hireEngineer(state, desired)) nextHireAt = state.elapsed + 2;
    advanceBattle(state, 1 / 30);
  }
}

test("rejects unaffordable and era-locked hires without spending budget", () => {
  const state = createBattle();
  state.budget = 20;
  assert.equal(hireEngineer(state, "frontend"), false);
  assert.equal(state.budget, 20);
  assert.match(state.notice, /预算不足/);
  state.budget = 200;
  assert.equal(hireEngineer(state, "backend"), false);
  assert.equal(state.budget, 200);
  assert.match(state.notice, /工程化时代/);
});

test("trains a hired engineer and enforces queue/population limits", () => {
  const state = createBattle();
  assert.equal(hireEngineer(state, "frontend"), true);
  assert.equal(state.budget, 90);
  tick(state, 3);
  assert.equal(state.engineers.length, 2);
  assert.equal(state.engineers[1].role, "frontend");
  assert.equal(state.queue.length, 0);

  state.budget = 1000;
  for (let index = 0; index < MAX_TRAINING_QUEUE; index += 1) assert.equal(hireEngineer(state, "intern"), true);
  const remainingBudget = state.budget;
  assert.equal(hireEngineer(state, "intern"), false);
  assert.equal(state.budget, remainingBudget);
});

test("automatically processes a requirement and awards budget and technical experience", () => {
  const state = createBattle();
  state.engineers[0].x = 470;
  const startingBudget = state.budget;
  const request = addRequest(state, { x: 500, totalWork: 1, remainingWork: 0.1 });
  advanceBattle(state, 1 / 30);

  assert.equal(state.requests.some((item) => item.id === request.id), false);
  assert.equal(state.budget, startingBudget + request.budgetReward + 0.05);
  assert.equal(state.experience, request.experienceReward);
  assert.ok(state.telemetry.some((event) => event.type === "request_complete"));
});

test("a missed request lowers project health without combat damage", () => {
  const state = createBattle();
  addRequest(state, { x: BASE_FRONT_EDGE + 1, speed: 60, severity: 17 });
  advanceBattle(state, 1 / 30);
  assert.equal(state.projectHealth, MAX_PROJECT_HEALTH - 17);
  assert.ok(state.telemetry.some((event) => event.type === "request_missed"));
});

test("three technical eras spend experience and unlock specialized roles", () => {
  const state = createBattle();
  state.experience = 80;
  assert.equal(upgradeEra(state), true);
  assert.equal(state.techEra, 1);
  assert.equal(state.experience, 0);
  state.budget = 1000;
  assert.equal(hireEngineer(state, "qa"), true);

  state.experience = 180;
  assert.equal(upgradeEra(state), true);
  assert.equal(state.techEra, 2);
  assert.equal(getEngineerDefinition("agent").era, 2);
  assert.equal(hireEngineer(state, "agent"), true);
  assert.deepEqual(state.telemetry.filter((event) => event.type === "era_upgrade").map((event) => event.detail.era), ["工程化时代", "Agent 时代"]);
});

test("change-event choices apply real effects and emit behavior events", () => {
  const state = createBattle();
  state.pendingEvent = CHANGE_EVENTS.find((event) => event.id === "scope-creep")!;
  const budget = state.budget;
  assert.equal(chooseChange(state, "accept-scope"), true);
  assert.equal(state.budget, budget + 70);
  assert.equal(state.experience, 18);
  assert.equal(state.techDebt, 24);
  assert.equal(state.requests.length, 1);
  assert.ok(state.telemetry.some((event) => event.type === "event_choice" && event.detail.choice === "accept-scope"));
});

test("rejects an alert repair when its stated budget cost cannot be paid", () => {
  const state = createBattle();
  state.budget = 10;
  state.pendingEvent = CHANGE_EVENTS.find((event) => event.id === "production-alert")!;
  assert.equal(chooseChange(state, "fix-alert"), false);
  assert.notEqual(state.pendingEvent, null);
  assert.equal(state.projectHealth, MAX_PROJECT_HEALTH);
});

test("high technical debt reduces delivery efficiency and triggers an online incident", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.techDebt = 160;
  state.elapsed = 114.99;
  state.nextIncidentAt = 115;
  const request = addRequest(state, { x: 500, totalWork: 100, remainingWork: 100 });
  state.engineers[0].x = 470;
  advanceBattle(state, 1 / 30);
  assert.ok(request.remainingWork > 99.5);
  assert.equal(state.projectHealth, 82);
  assert.equal(state.incidentUntil > state.elapsed, true);
  assert.ok(state.telemetry.some((event) => event.type === "online_incident"));
  assert.ok(state.telemetry.some((event) => event.type === "debt_change"));
});

test("random changes pause the simulation until a choice is made", () => {
  const state = createBattle(2024);
  state.requestScheduleIndex = 12;
  for (let frame = 0; frame < 30 * 45 && !state.pendingEvent; frame += 1) advanceBattle(state, 1 / 30);
  assert.notEqual(state.pendingEvent, null);
  const elapsed = state.elapsed;
  advanceBattle(state, 2);
  assert.equal(state.elapsed, elapsed);
  safeChoice(state);
  advanceBattle(state, 1 / 30);
  assert.ok(state.elapsed > elapsed);
});

test("fixed-step simulation keeps the same clock at 30 Hz and 60 Hz", () => {
  const slow = createBattle();
  const fast = createBattle();
  slow.requestScheduleIndex = fast.requestScheduleIndex = 12;
  slow.eventScheduleIndex = fast.eventScheduleIndex = 6;
  slow.nextEventAt = fast.nextEventAt = Number.POSITIVE_INFINITY;
  for (let frame = 0; frame < 60; frame += 1) advanceBattle(slow, 1 / 30);
  for (let frame = 0; frame < 120; frame += 1) advanceBattle(fast, 1 / 60);
  assert.ok(Math.abs(slow.elapsed - fast.elapsed) < 1 / 30);
  assert.ok(Math.abs(slow.budget - fast.budget) < 0.1);
});

test("finishes the final GO-LIVE request just before the deadline", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  state.elapsed = 299.98;
  state.engineers[0].x = 470;
  addRequest(state, { code: "GO-LIVE", title: "1024 极限上线", kind: "launch", x: 500, isFinal: true, totalWork: 10, remainingWork: 0.1 });
  advanceBattle(state, 1 / 30);
  assert.equal(state.phase, "victory");
  assert.ok(state.telemetry.some((event) => event.type === "result" && event.detail.result === "victory"));
});

test("ends in defeat at the five-minute deadline when GO-LIVE remains incomplete", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  state.elapsed = 299.98;
  addRequest(state, { code: "GO-LIVE", title: "1024 极限上线", kind: "launch", x: 900, isFinal: true, totalWork: 880, remainingWork: 880 });
  advanceBattle(state, 1 / 30);
  assert.equal(state.phase, "defeat");
  assert.match(state.notice, /窗口已关闭/);
});

test("a team strategy can clear the five-minute level and complete the final release", () => {
  const state = createBattle(1024);
  runWinningPolicy(state);
  assert.equal(state.phase, "victory", `failed at ${state.elapsed.toFixed(1)}s with health ${state.projectHealth}, debt ${state.techDebt}, era ${state.techEra}`);
  assert.ok(state.elapsed < 300);
  assert.equal(state.techEra, 2);
  assert.ok(state.telemetry.some((event) => event.type === "result" && event.detail.result === "victory"));
});

test("defines all five supported engineer roles", () => {
  const roles = ENGINEER_DEFS.map((definition) => definition.id);
  assert.deepEqual(roles, ["intern", "frontend", "backend", "qa", "agent"]);
});
