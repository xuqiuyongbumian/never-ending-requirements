import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceBattle,
  activateShipIt,
  BASE_FRONT_EDGE,
  CHANGE_EVENTS,
  chooseChange,
  createBattle,
  ENGINEER_DEFS,
  ERAS,
  getEngineerCost,
  getEngineerDefinition,
  hireEngineer,
  MAX_PROJECT_HEALTH,
  MAX_TRAINING_QUEUE,
  prioritizeRequirement,
  SHIP_IT_COOLDOWN,
  SHIP_IT_DEBT_COST,
  SHIP_IT_DURATION,
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

function runWinningPolicyWithPlayerActions(state: BattleState): void {
  let nextHireAt = 0;
  let usedShipIt = false;
  let attemptedPriority = false;
  for (let frame = 0; frame < 30 * 300 && state.phase === "running"; frame += 1) {
    if (state.pendingEvent) safeChoice(state);
    const nextEra = ERAS[state.techEra + 1];
    if (nextEra && state.experience >= nextEra.cost) upgradeEra(state);

    if (!usedShipIt && state.elapsed >= 90 && state.techDebt < 100 && activateShipIt(state)) usedShipIt = true;
    if (!attemptedPriority && state.elapsed >= 90 && state.requests.length >= 1) {
      const highestRisk = [...state.requests].sort((a, b) => b.severity - a.severity)[0];
      attemptedPriority = prioritizeRequirement(state, highestRisk.id);
    }

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

function runFrontOnlyPolicy(state: BattleState): void {
  let nextHireAt = 0;
  let lastPriority = -Infinity;
  for (let frame = 0; frame < 30 * 300 && state.phase === "running"; frame += 1) {
    if (state.pendingEvent) safeChoice(state);
    const nextEra = ERAS[state.techEra + 1];
    if (nextEra && state.experience >= nextEra.cost) upgradeEra(state);
    if (state.elapsed >= nextHireAt && state.queue.length < 2 && state.engineers.length + state.queue.length < 16 && hireEngineer(state, "frontend")) {
      nextHireAt = state.elapsed + 2;
    }
    if (state.elapsed >= 60 && state.elapsed < 230 && state.elapsed >= state.shipItCooldownUntil) activateShipIt(state);
    if (state.elapsed - lastPriority >= 9 && state.requests.length > 0) {
      const urgent = [...state.requests].sort((a, b) => b.severity - a.severity)[0];
      if (prioritizeRequirement(state, urgent.id)) lastPriority = state.elapsed;
    }
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

test("recruit costs rise for repeated roles and the current price is charged and reported", () => {
  const state = createBattle();
  state.budget = 1000;
  assert.equal(getEngineerCost(state, "frontend"), 55);
  assert.equal(hireEngineer(state, "frontend"), true);
  assert.equal(getEngineerCost(state, "frontend"), 100);
  assert.equal(hireEngineer(state, "frontend"), true);
  assert.equal(state.budget, 845);
  assert.deepEqual(state.telemetry.filter((event) => event.type === "recruit").map((event) => event.detail.cost), [55, 100]);
});

test("the first hire lets the player see real request work before the first 30 seconds", () => {
  const state = createBattle();
  assert.equal(hireEngineer(state, "frontend"), true);
  tick(state, 30);
  assert.ok(state.telemetry.some((event) => event.type === "request_complete"), "the opening request should be accepted during the tutorial beat");
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

test("off-specialty work is slower and active requirements keep approaching at a reduced speed", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  state.engineers[0].role = "frontend";
  state.engineers[0].x = 470;
  const request = addRequest(state, { kind: "bug", x: 500, speed: 60, totalWork: 1000, remainingWork: 1000 });

  advanceBattle(state, 1 / 30);
  assert.ok(Math.abs(request.remainingWork - (1000 - 15 * 0.58 / 30)) < 1e-9);
  const afterApproach = request.x;
  advanceBattle(state, 1 / 30);
  assert.ok(Math.abs((afterApproach - request.x) - 60 * 0.55 / 30) < 1e-9);
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
  assert.match(state.notice, /接下需求/);
  assert.ok(state.telemetry.some((event) => event.type === "event_choice" && event.detail.choice === "accept-scope"));
});

test("change-event timing varies by seed but remains inside the onboarding and finale beats", () => {
  const eventTimes = Array.from({ length: 9 }, (_, seed) => createBattle(seed + 1).nextEventAt);
  assert.ok(eventTimes.every((time) => time >= 34 && time <= 42));
  assert.ok(new Set(eventTimes).size > 1, "different runs should not repeat the exact same event timing");
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

test("priority scheduling assigns a suitable subset and leaves other engineers on automatic dispatch", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  state.engineers[0].role = "frontend";
  state.engineers[0].x = 430;
  state.engineers.push(
    { id: 2, role: "intern", lane: 1, x: 500, targetRequestId: null, action: "idle" },
    { id: 3, role: "intern", lane: 2, x: 520, targetRequestId: null, action: "idle" },
    { id: 4, role: "intern", lane: 3, x: 540, targetRequestId: null, action: "idle" }
  );
  const priority = addRequest(state, { kind: "feature", x: 1300, remainingWork: 500, totalWork: 500, speed: 0 });
  const nearby = addRequest(state, { kind: "bug", x: 720, remainingWork: 500, totalWork: 500, speed: 0 });

  assert.equal(prioritizeRequirement(state, priority.id), true);
  assert.equal(state.prioritizedRequestId, priority.id);
  assert.deepEqual(state.priorityEngineerIds, [1]);
  assert.equal(state.engineers[0].targetRequestId, priority.id);
  assert.ok(state.telemetry.some((event) => event.type === "requirement_prioritized" && event.detail.requirementId === priority.id));

  advanceBattle(state, 1 / 30);
  assert.equal(state.engineers[0].targetRequestId, priority.id);
  assert.ok(state.engineers.slice(1).every((engineer) => engineer.targetRequestId === nearby.id));
});

test("priority completion clears the marker and restores nearest-request automation", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  state.engineers[0].x = 470;
  const priority = addRequest(state, { x: 500, speed: 0, totalWork: 1, remainingWork: 0.1 });
  const automatic = addRequest(state, { x: 700, speed: 0, totalWork: 100, remainingWork: 100 });

  assert.equal(prioritizeRequirement(state, priority.id), true);
  advanceBattle(state, 1 / 30);
  assert.equal(state.prioritizedRequestId, null);
  assert.deepEqual(state.priorityEngineerIds, []);
  advanceBattle(state, 1 / 30);
  assert.equal(state.engineers[0].targetRequestId, automatic.id);
});

test("a missed or stale priority request is cleared without blocking dispatch", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  const urgent = addRequest(state, { x: BASE_FRONT_EDGE + 1, speed: 60, severity: 1 });
  const fallback = addRequest(state, { x: 800, speed: 0, totalWork: 100, remainingWork: 100 });
  assert.equal(prioritizeRequirement(state, urgent.id), true);
  advanceBattle(state, 1 / 30);
  assert.equal(state.prioritizedRequestId, null);
  advanceBattle(state, 1 / 30);
  assert.equal(state.engineers[0].targetRequestId, fallback.id);

  assert.equal(prioritizeRequirement(state, 99999), false);
  assert.match(state.notice, /不在待办/);
});

test("priority scheduling explains when every engineer is already working", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  const current = addRequest(state, { x: 500, speed: 0, totalWork: 100, remainingWork: 100 });
  const priority = addRequest(state, { x: 900, speed: 0, totalWork: 100, remainingWork: 100 });
  state.engineers[0].targetRequestId = current.id;
  state.engineers[0].action = "working";

  assert.equal(prioritizeRequirement(state, priority.id), false);
  assert.match(state.notice, /没有可调度工程师/);
  assert.equal(state.prioritizedRequestId, null);
});

test("prioritizing a new request reroutes only a small part of a fully occupied team", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  const existing = [0, 1, 2, 3].map((index) => addRequest(state, { x: 600 + index * 100, speed: 0, totalWork: 1000, remainingWork: 1000 }));
  state.engineers[0].role = "frontend";
  state.engineers[0].action = "working";
  state.engineers[0].targetRequestId = existing[0].id;
  for (let index = 1; index < 4; index += 1) {
    state.engineers.push({ id: index + 1, role: "intern", lane: index, x: 440 + index * 20, action: "working", targetRequestId: existing[index].id });
  }
  const urgent = addRequest(state, { kind: "feature", x: 1400, speed: 0, totalWork: 1000, remainingWork: 1000 });

  assert.equal(prioritizeRequirement(state, urgent.id), true);
  assert.equal(state.priorityEngineerIds.length, 1);
  assert.equal(state.engineers.filter((engineer) => engineer.targetRequestId === urgent.id).length, 1);
  assert.equal(state.engineers.filter((engineer) => existing.some((request) => request.id === engineer.targetRequestId)).length, 3);
  assert.equal(state.telemetry.find((event) => event.type === "requirement_prioritized")?.detail.deferred, existing[0].code);
});

test("priority assignments stay stable and respect the dispatch cooldown", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  state.engineers[0].x = 440;
  const priority = addRequest(state, { x: 1400, speed: 0, totalWork: 2000, remainingWork: 2000 });
  const nearby = addRequest(state, { x: 700, speed: 0, totalWork: 2000, remainingWork: 2000 });

  assert.equal(prioritizeRequirement(state, priority.id), true);
  const selectedTarget = state.engineers[0].targetRequestId;
  assert.equal(prioritizeRequirement(state, nearby.id), false);
  for (let frame = 0; frame < 30; frame += 1) advanceBattle(state, 1 / 30);
  assert.equal(state.engineers[0].targetRequestId, selectedTarget);
  assert.equal(state.prioritizedRequestId, priority.id);
});

test("Ship It adds debt, boosts real work by 40%, expires, and enforces cooldown", () => {
  const baseline = createBattle();
  const boosted = createBattle();
  for (const state of [baseline, boosted]) {
    state.requestScheduleIndex = 12;
    state.eventScheduleIndex = 6;
    state.nextEventAt = Number.POSITIVE_INFINITY;
    state.engineers[0].x = 470;
    addRequest(state, { x: 500, speed: 0, totalWork: 1000, remainingWork: 1000 });
  }
  const baselineWork = baseline.requests[0].remainingWork;
  assert.equal(activateShipIt(boosted), true);
  assert.equal(boosted.techDebt, SHIP_IT_DEBT_COST);
  assert.equal(boosted.shipItUntil, SHIP_IT_DURATION);
  assert.equal(boosted.shipItCooldownUntil, SHIP_IT_COOLDOWN);
  advanceBattle(baseline, 1 / 30);
  advanceBattle(boosted, 1 / 30);
  assert.ok(baselineWork - boosted.requests[0].remainingWork > baselineWork - baseline.requests[0].remainingWork);

  for (let frame = 0; frame < 30 * SHIP_IT_DURATION; frame += 1) advanceBattle(boosted, 1 / 30);
  assert.equal(boosted.shipItUntil, 0);
  assert.ok(boosted.telemetry.some((event) => event.type === "rush_activated"));
  assert.ok(boosted.telemetry.some((event) => event.type === "rush_completed"));
  assert.equal(activateShipIt(boosted), false);
});

test("pause freezes the Ship It duration and cooldown simulation clock", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  assert.equal(activateShipIt(state), true);
  const elapsed = state.elapsed;
  const activeUntil = state.shipItUntil;
  const cooldownUntil = state.shipItCooldownUntil;
  state.paused = true;
  for (let frame = 0; frame < 30 * 20; frame += 1) advanceBattle(state, 1 / 30);
  assert.equal(state.elapsed, elapsed);
  assert.equal(state.shipItUntil, activeUntil);
  assert.equal(state.shipItCooldownUntil, cooldownUntil);
  assert.equal(state.telemetry.some((event) => event.type === "rush_completed"), false);
});

test("event rush and Ship It use the stronger multiplier instead of multiplying together", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  state.rushUntil = 20;
  state.engineers[0].x = 470;
  const request = addRequest(state, { x: 500, speed: 0, totalWork: 1000, remainingWork: 1000 });
  assert.equal(activateShipIt(state), true);
  advanceBattle(state, 1 / 30);
  const work = 1000 - request.remainingWork;
  assert.ok(work <= 8 * 1.55 / 30 + 1e-9);
});

test("a fresh run resets priority, active skill, and cooldown state after a finished run", () => {
  const finished = createBattle();
  assert.equal(activateShipIt(finished), true);
  finished.prioritizedRequestId = 42;
  finished.priorityEngineerIds = [1];
  finished.phase = "victory";

  const replay = createBattle();
  assert.equal(replay.phase, "running");
  assert.equal(replay.elapsed, 0);
  assert.equal(replay.shipItUntil, 0);
  assert.equal(replay.shipItCooldownUntil, 0);
  assert.equal(replay.prioritizedRequestId, null);
  assert.deepEqual(replay.priorityEngineerIds, []);
  assert.equal(replay.telemetry.length, 0);
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
  assert.equal(activateShipIt(state), true);
  addRequest(state, { code: "GO-LIVE", title: "1024 极限上线", kind: "launch", x: 500, isFinal: true, totalWork: 10, remainingWork: 0.1 });
  advanceBattle(state, 1 / 30);
  assert.equal(state.phase, "victory");
  assert.ok(state.telemetry.some((event) => event.type === "result" && event.detail.result === "victory"));
  assert.ok(state.telemetry.some((event) => event.type === "rush_completed" && event.detail.interrupted === true));
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

test("the mixed-team win path survives representative deterministic event seeds", () => {
  for (const seed of [1, 2024, 4096, 1024, 0xabcdef]) {
    const state = createBattle(seed);
    runWinningPolicy(state);
    assert.equal(state.phase, "victory", `seed ${seed} ended at ${state.elapsed.toFixed(1)}s with health ${state.projectHealth}, debt ${state.techDebt}`);
  }
});

test("a mixed team can win while using priority scheduling and Ship It", () => {
  const state = createBattle(4096);
  runWinningPolicyWithPlayerActions(state);
  assert.equal(state.phase, "victory", `failed at ${state.elapsed.toFixed(1)}s with health ${state.projectHealth}, debt ${state.techDebt}, era ${state.techEra}`);
  assert.ok(state.telemetry.some((event) => event.type === "requirement_prioritized"));
  assert.ok(state.telemetry.some((event) => event.type === "rush_activated"));
});

test("a front-end-only team cannot trivially win even when using priority and Ship It", () => {
  const state = createBattle(2024);
  runFrontOnlyPolicy(state);
  assert.equal(state.phase, "defeat");
  assert.ok(state.telemetry.some((event) => event.type === "rush_activated"));
  assert.ok(state.telemetry.some((event) => event.type === "requirement_prioritized"));
});

test("defines all five supported engineer roles", () => {
  const roles = ENGINEER_DEFS.map((definition) => definition.id);
  assert.deepEqual(roles, ["intern", "frontend", "backend", "qa", "agent"]);
});
