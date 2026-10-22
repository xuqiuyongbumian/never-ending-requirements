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
  getEngineerHomeX,
  getEngineerWorkstationX,
  getInterpolatedWorldX,
  hireEngineer,
  isAgentBanned,
  MAX_PROJECT_HEALTH,
  MAX_TRAINING_QUEUE,
  PASSIVE_BUDGET_PER_SECOND,
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

test("interpolates fixed-step render positions without changing simulation state", () => {
  const state = createBattle(720);
  const engineer = state.engineers[0];
  const request = addRequest(state, { x: 900, speed: 30, totalWork: 100, remainingWork: 100 });
  const startEngineerX = engineer.x;
  const startRequestX = request.x;

  assert.equal(getInterpolatedWorldX(state, "engineer", engineer.id), startEngineerX);
  assert.equal(getInterpolatedWorldX(state, "request", request.id), request.x);

  advanceBattle(state, 1 / 30);
  const simulatedEngineerX = engineer.x;
  const simulatedRequestX = request.x;
  assert.ok(simulatedEngineerX > startEngineerX);
  assert.equal(getInterpolatedWorldX(state, "engineer", engineer.id), startEngineerX);
  assert.equal(getInterpolatedWorldX(state, "request", request.id), startRequestX);

  advanceBattle(state, 1 / 60);
  const halfwayX = getInterpolatedWorldX(state, "engineer", engineer.id);
  assert.equal(halfwayX, startEngineerX + (simulatedEngineerX - startEngineerX) * 0.5);
  assert.equal(getInterpolatedWorldX(state, "request", request.id), startRequestX + (simulatedRequestX - startRequestX) * 0.5);
  assert.equal(engineer.x, simulatedEngineerX, "render interpolation must not mutate the authoritative simulation position");
});

test("run distance follows simulated travel and stays still while working", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  const engineer = state.engineers[0];
  const request = addRequest(state, { x: 900, speed: 0, totalWork: 10000, remainingWork: 10000 });
  const startX = engineer.x;

  advanceBattle(state, 1 / 30);
  assert.equal(engineer.action, "moving");
  assert.ok(Math.abs(engineer.runDistance - Math.abs(engineer.x - startX)) < 1e-9);
  assert.ok(engineer.runDistance > 0);

  request.x = engineer.x + 20;
  engineer.targetRequestId = request.id;
  advanceBattle(state, 1 / 30);
  assert.equal(engineer.action, "working");
  assert.ok(Math.abs(engineer.runDistance - Math.abs(engineer.x - startX)) < 1e-9, "work ticks must not advance the footstep distance");
});

test("interpolation remains stable while paused and falls back for a fresh or missing entity", () => {
  const state = createBattle(721);
  const engineer = state.engineers[0];
  addRequest(state, { x: 900, speed: 0, totalWork: 100, remainingWork: 100 });
  advanceBattle(state, 1 / 30);
  advanceBattle(state, 1 / 60);
  state.paused = true;
  const heldRenderX = getInterpolatedWorldX(state, "engineer", engineer.id);
  advanceBattle(state, 0.1);
  assert.equal(getInterpolatedWorldX(state, "engineer", engineer.id), heldRenderX);
  const freshRun = createBattle(722);
  assert.equal(getInterpolatedWorldX(freshRun, "engineer", engineer.id), freshRun.engineers[0].x);
  assert.equal(getInterpolatedWorldX(freshRun, "engineer", 999), null);
});

test("engineers hold a capped frontline, then return to their defensive positions", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  addRequest(state, { x: 1450, speed: 15, totalWork: 1000, remainingWork: 1000 });
  tick(state, 24);
  assert.ok(state.engineers.every((engineer) => engineer.x <= 1120), "engineers must stay behind the request entry area");
  assert.ok(state.engineers.some((engineer) => engineer.x >= 900), "the team should make a short advance to the defense line");

  state.requests = [];
  for (const engineer of state.engineers) engineer.targetRequestId = null;
  tick(state, 20);
  assert.ok(state.engineers.every((engineer) => engineer.x < 520), "idle engineers should return to their home slots");
});

test("home posts are distinct and distributed across the defensive line", () => {
  const state = createBattle();
  for (let id = 2; id <= 8; id += 1) {
    state.engineers.push({ id, role: "intern", lane: id - 1, x: 440, runDistance: 0, targetRequestId: null, action: "idle" });
  }
  const stations = state.engineers.map(getEngineerHomeX);
  assert.equal(new Set(stations).size, state.engineers.length);
  assert.ok(Math.max(...stations) - Math.min(...stations) >= 400, "the team should not stack at one doorway post");
});

test("work starts only after an engineer reaches the same visible world-space station", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  const request = addRequest(state, { x: 600, speed: 0, totalWork: 1000, remainingWork: 1000 });
  const engineer = state.engineers[0];
  engineer.x = 600;
  tick(state, 3);

  const stationX = getEngineerWorkstationX(state, engineer);
  assert.equal(engineer.action, "working");
  assert.ok(stationX !== null);
  assert.equal(engineer.x, stationX);
  assert.ok(Math.abs(request.x - engineer.x) <= getEngineerDefinition(engineer.role).workRange);
});

test("working crews keep stable stations as a moving request advances", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  const request = addRequest(state, { x: 500, speed: 2, totalWork: 5000, remainingWork: 5000 });
  const lead = state.engineers[0];
  lead.x = 470;
  lead.targetRequestId = request.id;
  const partner = { id: 2, role: "intern" as const, lane: 1, x: 564, runDistance: 0, targetRequestId: request.id, action: "working" as const };
  state.engineers.push(partner);

  tick(state, 2);

  assert.equal(lead.action, "working");
  assert.equal(partner.action, "working");
  assert.equal(lead.x, 470);
  assert.equal(partner.x, 564);
  assert.ok(Math.abs(request.x - partner.x) <= getEngineerDefinition(partner.role).workRange);
});

test("unassigned engineers return to home posts while other requests remain active", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  for (let id = 2; id <= 5; id += 1) {
    state.engineers.push({ id, role: "intern", lane: id - 1, x: 850, runDistance: 0, targetRequestId: null, action: "idle" });
  }
  const request = addRequest(state, { x: 1000, speed: 10, totalWork: 1000, remainingWork: 1000 });
  const held = state.engineers[4];
  const heldX = held.x;
  const homeX = getEngineerHomeX(held);

  advanceBattle(state, 1 / 30);

  assert.ok(state.engineers.filter((engineer) => engineer.targetRequestId === request.id).length >= 4);
  assert.equal(held.targetRequestId, null, "the dispatch cap leaves at least one engineer unassigned");
  assert.ok(Math.abs(held.x - homeX) < Math.abs(heldX - homeX), "the unassigned engineer should begin returning to its stable home post");
  assert.equal(held.action, "moving");
});

test("an immobile request beyond the frontline is not assigned to engineers", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  for (let id = 2; id <= 5; id += 1) {
    state.engineers.push({ id, role: "intern", lane: id - 1, x: 440, runDistance: 0, targetRequestId: null, action: "idle" });
  }
  const request = addRequest(state, { x: 1510, speed: 0, totalWork: 1000, remainingWork: 1000, isFinal: true });

  tick(state, 24);

  assert.ok(state.engineers.every((engineer) => engineer.targetRequestId !== request.id));
  assert.ok(state.engineers.every((engineer) => engineer.action === "idle"));
  assert.equal(new Set(state.engineers.map((engineer) => Math.round(engineer.x))).size, state.engineers.length);
  assert.ok(state.engineers.every((engineer) => Math.abs(engineer.x - getEngineerHomeX(engineer)) <= 3));
  assert.equal(prioritizeRequirement(state, request.id), false, "manual priority cannot send the team to an unreachable static request");
});

test("engineers wait at home posts, then move continuously to intercept a slow far request", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  for (let id = 2; id <= 5; id += 1) {
    state.engineers.push({ id, role: "intern", lane: id - 1, x: 440, runDistance: 0, targetRequestId: null, action: "idle" });
  }
  const request = addRequest(state, { x: 1510, speed: 20, totalWork: 10000, remainingWork: 10000, isFinal: true });

  tick(state, 3.5);
  assert.ok(state.engineers.every((engineer) => engineer.targetRequestId === request.id));
  for (const engineer of state.engineers) {
    if (engineer.action === "idle") assert.ok(Math.abs(engineer.x - getEngineerHomeX(engineer)) <= 3, "idle workers wait at their home post");
  }

  tick(state, 1);
  const first = state.engineers[0];
  assert.equal(first.action, "moving");
  assert.ok(first.x > getEngineerHomeX(first), "the first worker departs only when it can keep moving toward the request");

  for (let frame = 0; frame < 11.5 * 30 && state.phase === "running"; frame += 1) {
    if (state.pendingEvent) chooseChange(state, state.pendingEvent.choices[0].id);
    advanceBattle(state, 1 / 30);
    for (const engineer of state.engineers) {
      if (engineer.action === "idle") {
        const waitingAtHome = Math.abs(engineer.x - getEngineerHomeX(engineer)) <= 3;
        const holdingFrontline = engineer.x === 1120 && Math.abs(request.x - engineer.x) <= getEngineerDefinition(engineer.role).workRange + 2;
        assert.ok(waitingAtHome || holdingFrontline, "an outbound engineer must not idle in the middle of the lane");
      }
    }
  }
  assert.ok(state.engineers.some((engineer) => engineer.action === "working"));
  assert.ok(state.engineers.filter((engineer) => engineer.action === "working").every((engineer) => Math.abs(request.x - engineer.x) <= getEngineerDefinition(engineer.role).workRange));
});

test("collaborators add less work at each additional slot instead of multiplying linearly", () => {
  const one = createBattle();
  const two = createBattle();
  for (const state of [one, two]) {
    state.requestScheduleIndex = 12;
    state.eventScheduleIndex = 6;
    state.nextEventAt = Number.POSITIVE_INFINITY;
    state.engineers[0].x = 470;
    addRequest(state, { x: 500, speed: 0, totalWork: 1000, remainingWork: 1000 });
  }
  two.engineers.push({ id: 2, role: "intern", lane: 1, x: 564, runDistance: 0, targetRequestId: null, action: "idle" });
  advanceBattle(one, 1 / 30);
  advanceBattle(two, 1 / 30);
  const singleWork = 1000 - one.requests[0].remainingWork;
  const pairWork = 1000 - two.requests[0].remainingWork;
  assert.ok(pairWork > singleWork);
  assert.ok(pairWork < singleWork * 2);
});

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
  for (let frame = 0; frame < 30 * 300 && state.phase === "running"; frame += 1) {
    if (state.pendingEvent) safeChoice(state);
    const nextEra = ERAS[state.techEra + 1];
    if (nextEra && state.experience >= nextEra.cost) upgradeEra(state);

    if (state.elapsed >= state.priorityCooldownUntil && state.requests.length > 0) {
      const highestRisk = [...state.requests].sort((a, b) => {
        const risk = (request: Requirement) => {
          const workers = state.engineers.filter((engineer) => engineer.targetRequestId === request.id && engineer.action === "working").length;
          const speed = request.speed * (workers > 0 ? 0.55 : 1);
          const secondsToBase = Math.max(0.1, (request.x - BASE_FRONT_EDGE) / Math.max(1, speed));
          const workRate = state.engineers.reduce((sum, engineer) => {
            if (engineer.targetRequestId !== request.id) return sum;
            return sum + (engineer.action === "working" ? 12 : 4);
          }, 0);
          const timeToFinish = request.remainingWork / Math.max(1, workRate);
          return request.severity / Math.max(1, secondsToBase - timeToFinish);
        };
        return risk(b) - risk(a);
      })[0];
      if (highestRisk) prioritizeRequirement(state, highestRisk.id);
    }
    if (!usedShipIt && state.requests.some((request) => request.isFinal) && state.techDebt < 180 && activateShipIt(state)) {
      usedShipIt = true;
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
  assert.equal(state.budget, 55);
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
  assert.equal(state.budget, startingBudget + request.budgetReward + PASSIVE_BUDGET_PER_SECOND / 30);
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
  assert.equal(state.budget, budget + 45);
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

test("seeded battle plans vary the middle wave and boss while keeping tutorial and GO-LIVE anchors", () => {
  const plans = Array.from({ length: 100 }, (_, seed) => createBattle(seed + 1).plan);
  assert.deepEqual(createBattle(42).plan, createBattle(42).plan, "the same seed must reproduce its complete plan");
  assert.ok(new Set(plans.map((plan) => plan.profile)).size >= 4, "the seed should select several wave compositions");
  assert.ok(new Set(plans.map((plan) => plan.requests.slice(1, -1).map((request) => request.kind).join(","))).size > 20, "the request order should vary within each composition");
  assert.ok(new Set(plans.map((plan) => plan.events.map((event) => event.id).join(","))).size > 20, "event choices should not fall into a short repeating cycle");
  assert.ok(new Set(plans.map((plan) => plan.boss.kind)).size > 1);
  assert.ok(new Set(plans.map((plan) => plan.bossAt)).size > 1);
  assert.ok(new Set(plans.map((plan) => plan.requests[1]?.speed)).size > 1);
  assert.ok(new Set(plans.map((plan) => plan.requests[1]?.severity)).size > 1);
  assert.ok(new Set(plans.map((plan) => plan.requests[1]?.budgetReward)).size > 1);
  assert.ok(new Set(plans.map((plan) => plan.requestTimes[1])).size > 1);

  for (const plan of plans) {
    assert.equal(plan.requests[0]?.code, "R-001");
    assert.equal(plan.requests.at(-1)?.code, "GO-LIVE");
    assert.equal(plan.requestTimes[0], 5);
    assert.equal(plan.requestTimes.at(-1), 240);
    assert.ok(plan.requestTimes.every((time, index, times) => index === 0 || time - times[index - 1]! >= 13));
    assert.equal(new Set(plan.requests.map((request) => request.code)).size, plan.requests.length);
    assert.ok(plan.requests.slice(1, -1).every((request) => request.totalWork >= 120 && request.totalWork <= 400 && request.speed >= 20 && request.speed <= 38));
    assert.ok(plan.bossAt >= 145 && plan.bossAt <= 165);
    assert.ok(plan.boss.totalWork >= 850 && plan.boss.totalWork <= 960);
    assert.ok(plan.events.every((event, index) => index < 2 || event.id !== plan.events[index - 1]?.id && event.id !== plan.events[index - 2]?.id));
  }
});

test("the same seed and same player inputs reproduce the battle result", () => {
  const play = (seed: number) => {
    const state = createBattle(seed);
    for (let frame = 0; frame < 30 * 110 && state.phase === "running"; frame += 1) {
      if (state.pendingEvent) chooseChange(state, state.pendingEvent.choices[0]!.id);
      advanceBattle(state, 1 / 30);
    }
    return { elapsed: state.elapsed, requests: state.requests, telemetry: state.telemetry };
  };
  assert.deepEqual(play(0x1024), play(0x1024));
});

test("repeated scope-change acceptances keep request codes unique", () => {
  const state = createBattle(5);
  for (let count = 0; count < 2; count += 1) {
    state.pendingEvent = CHANGE_EVENTS.find((event) => event.id === "scope-creep")!;
    assert.equal(chooseChange(state, "accept-scope"), true);
  }
  assert.deepEqual(state.requests.map((request) => request.code), ["R-CHANGE", "R-CHANGE-02"]);
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
    { id: 2, role: "intern", lane: 1, x: 500, runDistance: 0, targetRequestId: null, action: "idle" },
    { id: 3, role: "intern", lane: 2, x: 520, runDistance: 0, targetRequestId: null, action: "idle" },
    { id: 4, role: "intern", lane: 3, x: 540, runDistance: 0, targetRequestId: null, action: "idle" }
  );
  const priority = addRequest(state, { kind: "feature", x: 1300, remainingWork: 500, totalWork: 500, speed: 20 });
  const nearby = addRequest(state, { kind: "bug", x: 720, remainingWork: 500, totalWork: 500, speed: 0 });

  assert.equal(prioritizeRequirement(state, priority.id), true);
  assert.equal(state.prioritizedRequestId, priority.id);
  assert.deepEqual(state.priorityEngineerIds, [1]);
  assert.equal(state.engineers[0].targetRequestId, priority.id);
  assert.ok(state.telemetry.some((event) => event.type === "requirement_prioritized" && event.detail.requirementId === priority.id));

  advanceBattle(state, 1 / 30);
  assert.equal(state.engineers[0].targetRequestId, priority.id);
  const automaticTargets = state.engineers.slice(1).map((engineer) => engineer.targetRequestId);
  assert.ok(automaticTargets.includes(nearby.id), "automatic dispatch should keep engineers on the nearby request");
  assert.ok(automaticTargets.some((targetId) => targetId !== priority.id), "priority dispatch should not pull the whole team off automatic work");
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
  const urgent = addRequest(state, { x: BASE_FRONT_EDGE + 1, speed: 30, severity: 1 });
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
    state.engineers.push({ id: index + 1, role: "intern", lane: index, x: 440 + index * 20, runDistance: 0, action: "working", targetRequestId: existing[index].id });
  }
  const urgent = addRequest(state, { kind: "feature", x: 1400, speed: 20, totalWork: 1000, remainingWork: 1000 });

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
  const priority = addRequest(state, { x: 1400, speed: 20, totalWork: 2000, remainingWork: 2000 });
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
  state.bossSpawned = true;
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

test("spawns the boss request once at the mid-game beat", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  state.elapsed = state.plan.bossAt - 0.1;
  advanceBattle(state, 0.5);

  const bosses = state.requests.filter((request) => request.isBoss === true);
  assert.equal(bosses.length, 1);
  assert.equal(bosses[0].code, "BOSS-01");
  assert.ok(bosses[0].totalWork >= 850 && bosses[0].totalWork <= 960);

  advanceBattle(state, 10);
  assert.equal(state.requests.filter((request) => request.isBoss === true).length, 1, "boss must not respawn");
  assert.ok(state.telemetry.some((event) => event.type === "boss_spawn"));
});

test("a missed boss request costs 45 health without ending the battle", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.bossSpawned = true;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  addRequest(state, { code: "BOSS-01", isBoss: true, x: BASE_FRONT_EDGE - 1, speed: 10, totalWork: 900, remainingWork: 900, severity: 45 });

  advanceBattle(state, 1 / 30);

  assert.equal(state.projectHealth, MAX_PROJECT_HEALTH - 45);
  assert.equal(state.phase, "running");
  assert.ok(state.telemetry.some((event) => event.type === "request_missed" && event.detail.boss === true));
});

test("keeps a settled engineer working through small station drift", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.bossSpawned = true;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  const request = addRequest(state, { x: 500, speed: 0, totalWork: 10000, remainingWork: 10000 });
  state.engineers[0].x = 460;
  tick(state, 3);
  assert.equal(state.engineers[0].action, "working");

  request.x += 6;
  advanceBattle(state, 1 / 30);
  assert.equal(state.engineers[0].action, "working", "a 6-unit drift must not restart the run cycle");

  request.x += 40;
  advanceBattle(state, 1 / 30);
  assert.equal(state.engineers[0].action, "moving", "a real station change still has to be chased");
});

test("technical debt charges compounding-looking interest on the budget", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.bossSpawned = true;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  state.techDebt = 100;
  const noDebtBudget = state.budget;
  tick(state, 1);
  // 100 债的利息是 2 预算/秒，被动收入只有 0.35/秒，净现金流必须为负。
  assert.ok(state.budget < noDebtBudget - 1, "100 debt must cost more than the passive income");
});

test("agents accrue debt while posted and get risk-banned past the threshold", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.bossSpawned = true;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  state.engineers.push({ id: state.nextEngineerId++, role: "agent", lane: 1, x: 440, runDistance: 0, targetRequestId: null, action: "idle" });
  state.techDebt = 0;
  tick(state, 1);
  assert.ok(Math.abs(state.techDebt - 0.5) < 1e-9, "a deployed agent must accrue its debt interest");

  state.techDebt = 119.6;
  tick(state, 1);
  assert.ok(state.techDebt >= 120, "loan interest should cross the ban threshold");
  assert.ok(isAgentBanned(state), "agent must be banned once the debt clears the threshold");

  state.elapsed = state.aiBanUntil;
  tick(state, 0.1);
  assert.equal(state.aiBanUntil, 0, "the ban must lapse after its duration");
  assert.ok(state.aiBanCooldownUntil > state.elapsed, "a cooldown must stop an instant re-ban");
  assert.ok(state.aiBanCooldownUntil > state.elapsed, "a cooldown must stop an instant re-ban");
});

test("an idle qa pays down technical debt", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.bossSpawned = true;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  state.techDebt = 60;
  state.engineers.push({ id: state.nextEngineerId++, role: "qa", lane: 1, x: 440, runDistance: 0, targetRequestId: null, action: "idle" });
  const qa = state.engineers.at(-1)!;
  qa.x = getEngineerHomeX(qa);
  advanceBattle(state, 1 / 60);
  assert.notEqual(qa.action, "moving", "the qa should stand at its home station before repaying");
  const debtBefore = state.techDebt;
  tick(state, 1);
  assert.ok(state.techDebt < debtBefore - 0.5, "an idle qa must repay debt steadily");
});

test("ends in defeat at the five-minute deadline when GO-LIVE remains incomplete", () => {
  const state = createBattle();
  state.requestScheduleIndex = 12;
  state.eventScheduleIndex = 6;
  state.bossSpawned = true;
  state.nextEventAt = Number.POSITIVE_INFINITY;
  state.elapsed = 299.98;
  addRequest(state, { code: "GO-LIVE", title: "1024 极限上线", kind: "launch", x: 900, isFinal: true, totalWork: 880, remainingWork: 880 });
  advanceBattle(state, 1 / 30);
  assert.equal(state.phase, "defeat");
  assert.match(state.notice, /窗口已关闭/);
});

test("a balanced team can win by prioritizing deadlines and using the final Ship It window", () => {
  const state = createBattle(1024);
  runWinningPolicyWithPlayerActions(state);
  assert.equal(state.phase, "victory", `failed at ${state.elapsed.toFixed(1)}s with health ${state.projectHealth}, debt ${state.techDebt}, era ${state.techEra}`);
  assert.ok(state.elapsed < 300);
  assert.equal(state.techEra, 2);
  assert.ok(state.telemetry.some((event) => event.type === "result" && event.detail.result === "victory"));
});

test("the mixed-team win path survives representative deterministic event seeds", () => {
  for (const seed of [1, 2024, 4096, 1024, 0xabcdef]) {
    const state = createBattle(seed);
    runWinningPolicyWithPlayerActions(state);
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

test("a balanced roster without active dispatch leaves GO-LIVE overdue", () => {
  const state = createBattle(1024);
  runWinningPolicy(state);
  assert.equal(state.phase, "defeat");
  assert.ok(state.telemetry.some((event) => event.type === "request_missed" && event.detail.request === "GO-LIVE"));
  assert.equal(state.telemetry.some((event) => event.type === "request_complete" && event.detail.request === "GO-LIVE"), false);
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
