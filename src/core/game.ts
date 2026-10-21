export type Side = 0 | 1;
export type UnitId = "U11" | "U12" | "U13" | "U14";
export type BattlePhase = "running" | "victory" | "defeat";

export interface UnitDefinition {
  id: UnitId;
  name: string;
  role: string;
  hp: number;
  attack: number;
  armor: number;
  range: number;
  attackPeriod: number;
  speed: number;
  cost: number;
  trainingTime: number;
  heavy: boolean;
  damageType: "physical" | "pierce";
  color: number;
  shortName: string;
}

export const UNIT_DEFS: readonly UnitDefinition[] = [
  { id: "U11", name: "骨盾战士", shortName: "盾", role: "前排", hp: 165, attack: 14, armor: 16, range: 42, attackPeriod: 1.15, speed: 44, cost: 45, trainingTime: 1.7, heavy: false, damageType: "physical", color: 0xd8a65f },
  { id: "U12", name: "投石手", shortName: "石", role: "远程", hp: 75, attack: 17, armor: 0, range: 220, attackPeriod: 1.4, speed: 42, cost: 60, trainingTime: 2.1, heavy: false, damageType: "physical", color: 0x89b4cb },
  { id: "U13", name: "燧石矛手", shortName: "矛", role: "破甲", hp: 115, attack: 23, armor: 6, range: 90, attackPeriod: 1.35, speed: 46, cost: 70, trainingTime: 2.4, heavy: false, damageType: "pierce", color: 0xb1a6d8 },
  { id: "U14", name: "獠牙兽骑", shortName: "骑", role: "重型", hp: 245, attack: 30, armor: 12, range: 52, attackPeriod: 1.8, speed: 54, cost: 110, trainingTime: 3.8, heavy: true, damageType: "physical", color: 0xb9c28d }
];

export const WORLD_WIDTH = 1600;
export const BASE_MAX_HP = 2400;
export const STARTING_GOLD = 240;
export const MAX_POPULATION = 24;
export const MAX_TRAINING_QUEUE = 5;
const GOLD_PER_SECOND = 4;
const SIMULATION_STEP = 1 / 30;
const ALLY_GAP = 46;
export const BASE_FRONT_EDGES: readonly [number, number] = [368.75, 1231.25];
const BASE_SPAWN: readonly [number, number] = [245, WORLD_WIDTH - 245];

export interface TrainingOrder {
  unitId: UnitId;
  remaining: number;
  total: number;
}

export interface BattleUnit {
  id: number;
  unitId: UnitId;
  side: Side;
  x: number;
  hp: number;
  maxHp: number;
  attackCooldown: number;
  flashUntil: number;
  targetId: number | null;
}

export interface BattleState {
  phase: BattlePhase;
  elapsed: number;
  gold: [number, number];
  experience: [number, number];
  baseHp: [number, number];
  units: BattleUnit[];
  queues: [TrainingOrder[], TrainingOrder[]];
  nextUnitId: number;
  aiTimer: number;
  accumulator: number;
  paused: boolean;
  speed: 1 | 2;
  notice: string;
  noticeUntil: number;
}

const byId = new Map(UNIT_DEFS.map((unit) => [unit.id, unit]));

export function getUnitDefinition(id: UnitId): UnitDefinition {
  const definition = byId.get(id);
  if (!definition) throw new Error(`Unknown unit: ${id}`);
  return definition;
}

export function createBattle(): BattleState {
  return {
    phase: "running",
    elapsed: 0,
    gold: [STARTING_GOLD, STARTING_GOLD],
    experience: [0, 0],
    baseHp: [BASE_MAX_HP, BASE_MAX_HP],
    units: [],
    queues: [[], []],
    nextUnitId: 1,
    aiTimer: 3.5,
    accumulator: 0,
    paused: false,
    speed: 1,
    notice: "",
    noticeUntil: 0
  };
}

export function deployUnit(state: BattleState, unitId: UnitId, side: Side = 0): boolean {
  if (state.phase !== "running") return false;
  const definition = getUnitDefinition(unitId);
  const queue = state.queues[side];
  if (queue.length >= MAX_TRAINING_QUEUE) {
    if (side === 0) setNotice(state, "训练队列已满");
    return false;
  }
  if (state.units.filter((unit) => unit.side === side).length + queue.length >= MAX_POPULATION) {
    if (side === 0) setNotice(state, `部队已达上限（${MAX_POPULATION}）`);
    return false;
  }
  if (state.gold[side] < definition.cost) {
    if (side === 0) setNotice(state, `金币不足，还差${Math.ceil(definition.cost - state.gold[side])}金`);
    return false;
  }
  state.gold[side] -= definition.cost;
  queue.push({ unitId, remaining: definition.trainingTime, total: definition.trainingTime });
  if (side === 0) setNotice(state, `${definition.name}开始训练`);
  return true;
}

export function advanceBattle(state: BattleState, frameDelta: number): void {
  if (state.paused || state.phase !== "running") return;
  state.accumulator += Math.min(frameDelta, 0.1) * state.speed;
  while (state.accumulator >= SIMULATION_STEP && state.phase === "running") {
    stepBattle(state, SIMULATION_STEP);
    state.accumulator -= SIMULATION_STEP;
  }
}

function stepBattle(state: BattleState, delta: number): void {
  state.elapsed += delta;
  for (const side of [0, 1] as const) {
    state.gold[side] = Math.min(9999, state.gold[side] + GOLD_PER_SECOND * delta);
    advanceTraining(state, side, delta);
  }

  state.aiTimer -= delta;
  if (state.aiTimer <= 0) {
    decideEnemy(state);
    state.aiTimer = 4.4;
  }

  for (const unit of state.units) {
    updateUnit(state, unit, delta);
    if (state.phase !== "running") break;
  }
  state.units = state.units.filter((unit) => unit.hp > 0);
  if (state.baseHp[1] <= 0) state.phase = "victory";
  else if (state.baseHp[0] <= 0) state.phase = "defeat";
}

function advanceTraining(state: BattleState, side: Side, delta: number): void {
  const queue = state.queues[side];
  let timeRemaining = delta;
  while (queue.length > 0 && timeRemaining > 0) {
    queue[0].remaining -= timeRemaining;
    if (queue[0].remaining > 0) break;
    const order = queue.shift()!;
    timeRemaining = -order.remaining;
    const unit = getUnitDefinition(order.unitId);
    const direction = side === 0 ? -1 : 1;
    let spawnX: number | undefined;
    for (let slot = 0; slot < MAX_POPULATION; slot += 1) {
      const candidate = BASE_SPAWN[side] + direction * ALLY_GAP * slot;
      if (candidate < 32 || candidate > WORLD_WIDTH - 32) break;
      if (state.units.every((other) => other.hp <= 0 || Math.abs(other.x - candidate) >= ALLY_GAP)) {
        spawnX = candidate;
        break;
      }
    }
    if (spawnX === undefined) {
      order.remaining = 0;
      queue.unshift(order);
      return;
    }
    state.units.push({
      id: state.nextUnitId++,
      unitId: unit.id,
      side,
      x: spawnX,
      hp: unit.hp,
      maxHp: unit.hp,
      attackCooldown: 0.25,
      flashUntil: 0,
      targetId: null
    });
  }
}

function decideEnemy(state: BattleState): void {
  if (state.queues[1].length >= 3) return;
  const army = [
    ...state.units.filter((unit) => unit.side === 1).map((unit) => unit.unitId),
    ...state.queues[1].map((order) => order.unitId)
  ];
  const enemyHeavies = state.units.filter((unit) => unit.side === 0 && getUnitDefinition(unit.unitId).heavy).length;
  const frontline = army.filter((id) => id === "U11" || id === "U14").length;
  const ranged = army.filter((id) => id === "U12").length;
  const antiArmor = army.filter((id) => id === "U13").length;
  const desired = frontline === 0
    ? "U11"
    : enemyHeavies > antiArmor
      ? "U13"
      : ranged < Math.max(1, Math.ceil(army.length * 0.25))
        ? "U12"
        : army.filter((id) => id === "U14").length === 0
          ? "U14"
          : frontline < Math.ceil(army.length * 0.4) ? "U11" : "U12";
  const choice = [desired, "U11", "U12", "U13", "U14"].find((id) => state.gold[1] >= getUnitDefinition(id as UnitId).cost);
  if (choice) deployUnit(state, choice as UnitId, 1);
}

function updateUnit(state: BattleState, unit: BattleUnit, delta: number): void {
  if (unit.hp <= 0) return;
  const definition = getUnitDefinition(unit.unitId);
  unit.attackCooldown = Math.max(0, unit.attackCooldown - delta);

  const direction = unit.side === 0 ? 1 : -1;
  const target = closestEnemyAhead(state, unit);
  const targetDistance = target ? Math.max(0, (target.x - unit.x) * direction) : Number.POSITIVE_INFINITY;
  const baseDistance = (basePosition(1 - unit.side) - unit.x) * direction;

  if (target && targetDistance <= definition.range) {
    attack(state, unit, target, definition);
    return;
  }
  if (!target && baseDistance <= definition.range) {
    attackBase(state, unit, definition);
    return;
  }

  const distanceToStop = target ? targetDistance - definition.range : baseDistance - definition.range;
  const allyAhead = state.units
    .filter((candidate) => candidate.hp > 0 && candidate.side === unit.side && candidate.id !== unit.id)
    .map((candidate) => (candidate.x - unit.x) * direction)
    .filter((distance) => distance > 0)
    .sort((a, b) => a - b)[0];
  const distanceToAlly = allyAhead === undefined ? Number.POSITIVE_INFINITY : Math.max(0, allyAhead - ALLY_GAP);
  const movement = Math.min(definition.speed * delta, Math.max(0, distanceToStop), distanceToAlly);
  if (movement > 0) unit.x += direction * movement;
}

interface TargetRef {
  id: number;
  x: number;
  hp: number;
  armor: number;
  heavy: boolean;
  unit?: BattleUnit;
}

function closestEnemyAhead(state: BattleState, source: BattleUnit): TargetRef | null {
  const direction = source.side === 0 ? 1 : -1;
  let closest: BattleUnit | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const candidate of state.units) {
    if (candidate.side === source.side || candidate.hp <= 0) continue;
    const distance = (candidate.x - source.x) * direction;
    if (distance >= -12 && distance < bestDistance) {
      closest = candidate;
      bestDistance = distance;
    }
  }
  if (!closest) return null;
  const definition = getUnitDefinition(closest.unitId);
  return { id: closest.id, x: closest.x, hp: closest.hp, armor: definition.armor, heavy: definition.heavy, unit: closest };
}

function attack(state: BattleState, source: BattleUnit, target: TargetRef, definition: UnitDefinition): void {
  if (source.attackCooldown > 0) return;
  const wasAlive = target.unit!.hp > 0;
  target.unit!.hp = Math.max(0, target.unit!.hp - calculateDamage(definition, target.armor, target.heavy));
  if (wasAlive && target.unit!.hp === 0) {
    const bounty = getUnitDefinition(target.unit!.unitId).cost;
    state.experience[source.side] = Math.min(9999, state.experience[source.side] + Math.max(10, Math.round(bounty * 0.25)));
    state.gold[source.side] = Math.min(9999, state.gold[source.side] + Math.floor(bounty * 0.35));
  }
  source.attackCooldown = definition.attackPeriod;
  source.flashUntil = state.elapsed + 0.18;
  source.targetId = target.id;
}

function attackBase(state: BattleState, source: BattleUnit, definition: UnitDefinition): void {
  if (source.attackCooldown > 0) return;
  state.baseHp[1 - source.side] = Math.max(0, state.baseHp[1 - source.side] - calculateDamage(definition, 20, true));
  source.attackCooldown = definition.attackPeriod;
  source.flashUntil = state.elapsed + 0.18;
  source.targetId = null;
}

function calculateDamage(definition: UnitDefinition, armor: number, heavy: boolean): number {
  const counter = definition.damageType === "pierce" ? (heavy ? 1.35 : 0.85) : (heavy ? 0.9 : 1);
  return Math.max(1, Math.floor((definition.attack * 100 / (100 + armor)) * counter));
}

function basePosition(side: Side | number): number {
  return side === 0 ? BASE_FRONT_EDGES[0] : BASE_FRONT_EDGES[1];
}

function setNotice(state: BattleState, message: string): void {
  state.notice = message;
  state.noticeUntil = state.elapsed + 1.8;
}
