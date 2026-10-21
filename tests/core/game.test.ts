import assert from "node:assert/strict";
import test from "node:test";
import {
  advanceBattle,
  BASE_FRONT_EDGES,
  createBattle,
  deployUnit,
  getUnitDefinition,
  MAX_TRAINING_QUEUE,
  MAX_POPULATION,
  type BattleState,
  type BattleUnit,
  type Side,
  type UnitId
} from "../../src/core/game.ts";

function addUnit(state: BattleState, unitId: UnitId, side: Side, x: number, hp = getUnitDefinition(unitId).hp): BattleUnit {
  const unit = getUnitDefinition(unitId);
  const battleUnit: BattleUnit = {
    id: state.nextUnitId++, unitId, side, x, hp, maxHp: unit.hp,
    attackCooldown: 0, flashUntil: 0, targetId: null
  };
  state.units.push(battleUnit);
  return battleUnit;
}

function advanceSeconds(state: BattleState, seconds: number): void {
  for (let frame = 0; frame < Math.round(seconds * 30); frame += 1) advanceBattle(state, 1 / 30);
}

test("rejects unaffordable training without spending gold", () => {
  const state = createBattle();
  state.gold[0] = 20;

  assert.equal(deployUnit(state, "U11"), false);
  assert.equal(state.gold[0], 20);
  assert.match(state.notice, /还差25金/);
});

test("blocks a unit that has already died from taking another action", () => {
  const state = createBattle();
  state.aiTimer = 100;
  addUnit(state, "U11", 0, 700, 0);
  const target = addUnit(state, "U11", 1, 720, 100);

  advanceBattle(state, 1 / 30);

  assert.equal(target.hp, 100);
  assert.equal(state.experience[0], 0);
  assert.deepEqual(state.units.map((unit) => unit.id), [target.id]);
});

test("grants combat experience exactly once when an enemy unit is killed", () => {
  const state = createBattle();
  state.aiTimer = 100;
  const attacker = addUnit(state, "U14", 0, 700);
  attacker.attackCooldown = 0;
  addUnit(state, "U11", 1, 730, 1);

  advanceBattle(state, 1 / 30);
  advanceBattle(state, 1 / 30);

  assert.equal(state.experience[0], 11);
  assert.equal(Math.floor(state.gold[0]), 255);
});

test("keeps opposing melee units in range instead of letting them pass through", () => {
  const state = createBattle();
  state.aiTimer = 100;
  const friendly = addUnit(state, "U11", 0, 700, 1000);
  const enemy = addUnit(state, "U11", 1, 760, 1000);
  friendly.attackCooldown = enemy.attackCooldown = 100;

  advanceSeconds(state, 2);

  assert.ok(friendly.x < enemy.x);
  assert.ok(enemy.x - friendly.x <= 42.1);
});

test("maintains formation spacing between friendly units", () => {
  const state = createBattle();
  state.aiTimer = 100;
  const front = addUnit(state, "U11", 0, 500);
  const rear = addUnit(state, "U11", 0, 460);

  advanceSeconds(state, 1);

  assert.ok(front.x - rear.x >= 45.9);
});

test("attacks the enemy base at its visible front edge and ends the battle", () => {
  const state = createBattle();
  state.aiTimer = 100;
  state.baseHp[1] = 1;
  const attacker = addUnit(state, "U14", 0, 1170);

  advanceSeconds(state, 1);

  assert.equal(state.phase, "victory");
  assert.equal(state.baseHp[1], 0);
  assert.ok(attacker.x <= BASE_FRONT_EDGES[1] - getUnitDefinition("U14").range + 0.1);
});

test("enforces the army population cap", () => {
  const state = createBattle();
  state.gold[0] = 999;
  for (let index = 0; index < MAX_POPULATION; index += 1) addUnit(state, "U11", 0, 500 + index * 50);

  assert.equal(deployUnit(state, "U11"), false);
  assert.equal(state.gold[0], 999);
  assert.match(state.notice, /部队已达上限/);
});

test("keeps completed production in the queue when the spawn lane is occupied", () => {
  const state = createBattle();
  state.aiTimer = 100;
  addUnit(state, "U11", 0, 245);
  assert.equal(deployUnit(state, "U11"), true);
  state.queues[0][0].remaining = 0;

  advanceBattle(state, 1 / 30);

  assert.equal(state.units.length, 2);
  assert.ok(Math.abs(state.units[0].x - state.units[1].x) >= 45.9);
});

test("limits the training queue and preserves the remaining gold", () => {
  const state = createBattle();
  for (let index = 0; index < MAX_TRAINING_QUEUE; index += 1) assert.equal(deployUnit(state, "U11"), true);
  const remainingGold = state.gold[0];

  assert.equal(deployUnit(state, "U11"), false);
  assert.equal(state.gold[0], remainingGold);
  assert.match(state.notice, /训练队列已满/);
});

test("makes the AI counter heavy units after establishing a frontline", () => {
  const state = createBattle();
  state.aiTimer = 1 / 30;
  advanceBattle(state, 1 / 30);
  assert.equal(state.queues[1][0]?.unitId, "U11");

  addUnit(state, "U14", 0, 900);
  state.aiTimer = 1 / 30;
  advanceBattle(state, 1 / 30);

  assert.equal(state.queues[1][1]?.unitId, "U13");
});

test("uses a fixed simulation step across 30 Hz and 60 Hz render updates", () => {
  const slow = createBattle();
  const fast = createBattle();
  slow.aiTimer = fast.aiTimer = 100;
  for (let frame = 0; frame < 60; frame += 1) advanceBattle(slow, 1 / 30);
  for (let frame = 0; frame < 120; frame += 1) advanceBattle(fast, 1 / 60);

  assert.ok(Math.abs(slow.elapsed - fast.elapsed) < 1 / 30);
  assert.ok(Math.abs(slow.gold[0] - fast.gold[0]) < 0.1);
});

test("can complete a full match with a ranged-unit strategy", () => {
  const state = createBattle();
  let nextOrder = 0;
  for (let frame = 0; frame < 30 * 600 && state.phase === "running"; frame += 1) {
    if (state.elapsed >= nextOrder && state.queues[0].length < 3 && deployUnit(state, "U12")) nextOrder = state.elapsed + 1.5;
    advanceBattle(state, 1 / 30);
  }

  assert.equal(state.phase, "victory");
  assert.ok(state.elapsed < 600);
});

test("completes the match as a defeat if the player does not deploy units", () => {
  const state = createBattle();
  for (let frame = 0; frame < 30 * 240 && state.phase === "running"; frame += 1) advanceBattle(state, 1 / 30);

  assert.equal(state.phase, "defeat");
  assert.equal(state.baseHp[0], 0);
});
