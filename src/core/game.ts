export type EngineerId = "intern" | "frontend" | "backend" | "qa" | "agent";
export type RequestKind = "feature" | "bug" | "infra" | "launch";
export type GamePhase = "running" | "victory" | "defeat";

export interface EngineerDefinition {
  id: EngineerId;
  name: string;
  era: number;
  cost: number;
  workRate: number;
  moveSpeed: number;
  workRange: number;
  trainingTime: number;
  focus: RequestKind | "any";
  color: number;
  summary: string;
}

export const ENGINEER_DEFS: readonly EngineerDefinition[] = [
  { id: "intern", name: "实习生", era: 0, cost: 35, workRate: 8, moveSpeed: 58, workRange: 70, trainingTime: 2.2, focus: "any", color: 0xf5c46a, summary: "全领域基础支持" },
  { id: "frontend", name: "前端工程师", era: 0, cost: 55, workRate: 15, moveSpeed: 62, workRange: 82, trainingTime: 2.8, focus: "feature", color: 0x59c4bb, summary: "功能需求效率 +35%；跨领域效率 58%" },
  { id: "backend", name: "后端工程师", era: 1, cost: 70, workRate: 20, moveSpeed: 54, workRange: 75, trainingTime: 3.2, focus: "infra", color: 0x75a8e7, summary: "基础设施效率 +35%；跨领域效率 58%" },
  { id: "qa", name: "测试工程师", era: 1, cost: 62, workRate: 15, moveSpeed: 57, workRange: 90, trainingTime: 2.9, focus: "bug", color: 0xbc9be7, summary: "缺陷需求效率 +50%；跨领域效率 58%" },
  { id: "agent", name: "AI Agent", era: 2, cost: 95, workRate: 34, moveSpeed: 70, workRange: 108, trainingTime: 3.5, focus: "any", color: 0xf28d72, summary: "全领域高速交付，同时增加技术债" }
];

export interface EraDefinition {
  id: number;
  name: string;
  cost: number;
  productivity: number;
  description: string;
}

export const ERAS: readonly EraDefinition[] = [
  { id: 0, name: "手搓时代", cost: 0, productivity: 1, description: "先把需求做出来" },
  { id: 1, name: "工程化时代", cost: 80, productivity: 1.1, description: "后端与测试加入团队" },
  { id: 2, name: "Agent 时代", cost: 180, productivity: 1.2, description: "解锁 AI Agent，高效也要管好技术债" }
];

export interface Requirement {
  id: number;
  code: string;
  title: string;
  kind: RequestKind;
  x: number;
  speed: number;
  totalWork: number;
  remainingWork: number;
  budgetReward: number;
  experienceReward: number;
  severity: number;
  isFinal: boolean;
  isBoss?: boolean;
  agentWork: number;
}

export interface Engineer {
  id: number;
  role: EngineerId;
  lane: number;
  x: number;
  runDistance: number;
  targetRequestId: number | null;
  action: "idle" | "moving" | "working";
}

export interface HiringOrder {
  role: EngineerId;
  remaining: number;
  total: number;
}

export interface ChangeChoice {
  id: string;
  label: string;
  description: string;
}

export interface ChangeEvent {
  id: string;
  title: string;
  body: string;
  choices: readonly ChangeChoice[];
}

export interface BattlePlan {
  profile: string;
  requestTimes: readonly number[];
  requests: readonly Omit<Requirement, "id" | "x" | "remainingWork" | "agentWork">[];
  bossAt: number;
  boss: Omit<Requirement, "id" | "x" | "remainingWork" | "agentWork">;
  eventTimes: readonly number[];
  events: readonly ChangeEvent[];
  randomSeed: number;
}

export interface GameTelemetryEvent {
  type: string;
  at: number;
  detail: Record<string, string | number | boolean>;
}

export interface BattleState {
  phase: GamePhase;
  elapsed: number;
  budget: number;
  experience: number;
  techDebt: number;
  projectHealth: number;
  techEra: number;
  engineers: Engineer[];
  requests: Requirement[];
  queue: HiringOrder[];
  nextEngineerId: number;
  nextRequestId: number;
  requestScheduleIndex: number;
  plan: BattlePlan;
  bossSpawned: boolean;
  eventScheduleIndex: number;
  aiBanUntil: number;
  aiBanCooldownUntil: number;
  nextEventAt: number;
  randomSeed: number;
  pendingEvent: ChangeEvent | null;
  tutorialStep: number;
  rushUntil: number;
  shipItUntil: number;
  shipItCooldownUntil: number;
  prioritizedRequestId: number | null;
  priorityEngineerIds: number[];
  priorityCooldownUntil: number;
  incidentUntil: number;
  nextIncidentAt: number;
  accumulator: number;
  paused: boolean;
  speed: 1 | 2;
  notice: string;
  noticeUntil: number;
  telemetry: GameTelemetryEvent[];
}

export const WORLD_WIDTH = 1600;
export const ROUND_DURATION = 300;
export const MAX_PROJECT_HEALTH = 100;
export const MAX_POPULATION = 16;
export const MAX_TRAINING_QUEUE = 5;
export const REQUEST_ENTRY_X = 1510;
export const BASE_FRONT_EDGE = 365;
export const SHIP_IT_DURATION = 12;
export const SHIP_IT_COOLDOWN = 45;
export const SHIP_IT_DEBT_COST = 25;
export const SHIP_IT_WORK_BONUS = 0.4;
export const PRIORITY_COOLDOWN = 8;
export const REPEAT_ROLE_COST_STEP = 0.8;
const WORKING_REQUEST_SPEED_MULTIPLIER = 0.55;
export const PASSIVE_BUDGET_PER_SECOND = 0.35;
// 借来的速度都要付利息：债越高，现金流越紧。
export const DEBT_INTEREST_PER_DEBT_PER_SECOND = 0.02;
// Agent 在岗就是对银行打借条：持续吃技术债，断供就会被风控封停。
export const AGENT_DEBT_PER_SECOND = 0.5;
export const AI_BAN_THRESHOLD = 120;
export const AI_BAN_DURATION = 10;
export const AI_BAN_COOLDOWN = 12;
export const QA_REPAY_PER_SECOND = 1.2;
const SIMULATION_STEP = 1 / 30;
const ENGINEER_SPAWN_X = 440;
const MAX_FRONTLINE_X = 1120;
const MOVE_ARRIVAL_EPSILON = 3;
// A request card keeps drifting a fraction of a unit every tick. Without a
// wider resume threshold the engineer would flip moving/working several times
// per second and restart the run animation, which reads as twitching.
const MOVE_RESUME_EPSILON = 10;
const HOME_STATION_START_X = BASE_FRONT_EDGE + 54;
const HOME_STATION_SPACING = 64;
const HOME_STATION_COLUMNS = 8;
const WORK_STATION_OFFSETS = [-64, 64, -38, 38, 0] as const;
const WORK_STATION_SEPARATION = 52;
const TARGET_RETENTION_RATIO = 0.72;
const DEBT_INCIDENT_THRESHOLD = 155;
const COLLABORATION_RETURNS = [1, 0.66, 0.44, 0.3, 0.2, 0.14] as const;

interface RenderPositionSnapshot {
  engineers: Map<number, number>;
  requests: Map<number, number>;
}

const renderPositionSnapshots = new WeakMap<BattleState, RenderPositionSnapshot>();
const MAX_INTERPOLATION_DISTANCE = WORLD_WIDTH / 4;

const REQUEST_SCHEDULE: readonly Omit<Requirement, "id" | "x" | "remainingWork" | "agentWork">[] = [
  { code: "R-001", title: "搭好开发环境", kind: "infra", speed: 20, totalWork: 44, budgetReward: 45, experienceReward: 28, severity: 7, isFinal: false },
  { code: "R-002", title: "产品首页原型", kind: "feature", speed: 22, totalWork: 135, budgetReward: 50, experienceReward: 30, severity: 8, isFinal: false },
  { code: "R-003", title: "修复登录回归", kind: "bug", speed: 24, totalWork: 145, budgetReward: 55, experienceReward: 34, severity: 10, isFinal: false },
  { code: "R-004", title: "消息中心改版", kind: "feature", speed: 25, totalWork: 175, budgetReward: 60, experienceReward: 36, severity: 9, isFinal: false },
  { code: "R-005", title: "接入鉴权接口", kind: "infra", speed: 26, totalWork: 190, budgetReward: 65, experienceReward: 40, severity: 11, isFinal: false },
  { code: "R-006", title: "补齐自动化测试", kind: "bug", speed: 27, totalWork: 205, budgetReward: 65, experienceReward: 42, severity: 12, isFinal: false },
  { code: "R-007", title: "AI 摘要助手", kind: "feature", speed: 28, totalWork: 230, budgetReward: 75, experienceReward: 46, severity: 12, isFinal: false },
  { code: "R-008", title: "支付边界校验", kind: "bug", speed: 29, totalWork: 245, budgetReward: 80, experienceReward: 48, severity: 13, isFinal: false },
  { code: "R-009", title: "上线数据看板", kind: "feature", speed: 30, totalWork: 265, budgetReward: 85, experienceReward: 52, severity: 14, isFinal: false },
  { code: "R-010", title: "压测核心链路", kind: "infra", speed: 32, totalWork: 320, budgetReward: 90, experienceReward: 56, severity: 18, isFinal: false },
  { code: "R-011", title: "发布前验收", kind: "bug", speed: 34, totalWork: 360, budgetReward: 95, experienceReward: 60, severity: 20, isFinal: false },
  { code: "GO-LIVE", title: "1024 极限上线", kind: "launch", speed: 34, totalWork: 1500, budgetReward: 180, experienceReward: 80, severity: 100, isFinal: true }
];
const REQUEST_SPAWN_TIMES = [5, 24, 43, 62, 81, 100, 119, 138, 157, 176, 206, 240] as const;
const EVENT_SPAWN_TIMES = [38, 82, 126, 170, 214, 258] as const;
type CoreRequestKind = Exclude<RequestKind, "launch">;
interface WaveProfile {
  id: string;
  kinds: readonly CoreRequestKind[];
  urgent?: boolean;
}

const WAVE_PROFILES: readonly WaveProfile[] = [
  { id: "feature-sprint", kinds: ["feature", "feature", "feature", "bug", "feature", "infra", "feature", "bug", "feature", "infra"] },
  { id: "bug-bash", kinds: ["bug", "bug", "feature", "bug", "bug", "infra", "bug", "feature", "bug", "infra"] },
  { id: "platform-migration", kinds: ["infra", "infra", "bug", "infra", "feature", "infra", "infra", "bug", "infra", "feature"] },
  { id: "mixed-release", kinds: ["feature", "infra", "bug", "feature", "bug", "infra", "feature", "infra", "bug", "feature"] },
  { id: "incident-response", kinds: ["bug", "feature", "infra", "bug", "feature", "infra", "bug", "feature", "infra", "bug"], urgent: true }
];
const REQUEST_TITLES: Record<CoreRequestKind, readonly string[]> = {
  feature: ["核心页面体验升级", "消息中心交互改版", "智能摘要助手", "经营数据看板", "结账流程优化"],
  bug: ["登录状态回归", "边界输入校验", "支付结果不一致", "验收阻塞问题", "断线重试异常"],
  infra: ["鉴权与服务接入", "任务队列扩容", "核心链路压测", "监控告警接入", "缓存策略升级"]
};

export const CHANGE_EVENTS: readonly ChangeEvent[] = [
  {
    id: "scope-creep",
    title: "产品经理：再加一个小需求？",
    body: "演示前想多看一张统计卡片。接下需求能拿到额外预算，但会挤占团队带宽。",
    choices: [
      { id: "accept-scope", label: "接下需求", description: "+45 预算、+18 经验，新增一张需求卡并增加技术债" },
      { id: "freeze-scope", label: "冻结范围", description: "减少少量预算，降低技术债并恢复项目健康" }
    ]
  },
  {
    id: "release-window",
    title: "发布窗口提前",
    body: "运营希望提前交付。可以临时提速，也可以保留验证时间，稳步推进。",
    choices: [
      { id: "quick-release", label: "快速交付", description: "团队提速 22 秒，技术债 +34" },
      { id: "verify-release", label: "坚持验证", description: "+30 经验，技术债 -12" }
    ]
  },
  {
    id: "production-alert",
    title: "线上告警：边界数据异常",
    body: "监控发现一处输入校验风险。现在修复会花预算，临时绕过则可能留下隐患。",
    choices: [
      { id: "fix-alert", label: "修复并回归", description: "消耗 40 预算，技术债 -36，项目健康 +12" },
      { id: "hotfix-alert", label: "快速绕过", description: "保留预算，技术债 +30，团队提速 12 秒" }
    ]
  },
  {
    id: "ai-policy",
    title: "Agent 自动补全策略",
    body: "Agent 可以批量生成代码，也可以先输出方案供工程师复核。",
    choices: [
      { id: "auto-generate", label: "批量生成", description: "团队提速 26 秒，技术债 +42" },
      { id: "review-first", label: "先审后用", description: "+24 经验，技术债 -18" }
    ]
  }
];

const definitionById = new Map(ENGINEER_DEFS.map((definition) => [definition.id, definition]));

function createBattlePlan(seed: number): BattlePlan {
  let randomSeed = mixSeed(seed);
  const integer = (min: number, max: number) => {
    randomSeed = nextRandom(randomSeed);
    return min + Math.floor(randomSeed / 0x1_0000_0000 * (max - min + 1));
  };

  const profile = WAVE_PROFILES[integer(0, WAVE_PROFILES.length - 1)]!;
  const remaining: Record<CoreRequestKind, number> = { feature: 0, bug: 0, infra: 0 };
  for (const kind of profile.kinds) remaining[kind] += 1;
  const kinds: CoreRequestKind[] = [];
  while (kinds.length < profile.kinds.length) {
    const previous = kinds.at(-1);
    const repeatPrevious = Boolean(previous && remaining[previous] > 0 && integer(0, 99) < 48);
    const pool = (Object.keys(remaining) as CoreRequestKind[]).flatMap((kind) => Array(remaining[kind]).fill(kind));
    const kind = repeatPrevious ? previous! : pool[integer(0, pool.length - 1)] as CoreRequestKind;
    kinds.push(kind);
    remaining[kind] -= 1;
  }

  const requests = REQUEST_SCHEDULE.map((base, index) => {
    if (index === 0 || index === REQUEST_SCHEDULE.length - 1) return base;
    const kind = kinds[index - 1]!;
    const title = REQUEST_TITLES[kind][integer(0, REQUEST_TITLES[kind].length - 1)]!;
    const urgent = profile.urgent === true && index === 5;
    const workPercent = integer(94, 106) * (kind === "bug" ? 0.97 : kind === "infra" ? 1.04 : 1);
    const speedPercent = integer(96, 104) * (urgent ? 1.1 : 1);
    return {
      ...base,
      title: `${urgent ? "紧急：" : ""}${title}`,
      kind,
      totalWork: Math.round(base.totalWork * workPercent / 100 * (urgent ? 0.9 : 1)),
      speed: Math.round(base.speed * speedPercent / 100),
      severity: Math.min(28, base.severity + integer(-1, 1) + (urgent ? 8 : 0)),
      budgetReward: Math.round(base.budgetReward * integer(94, 106) / 100),
      experienceReward: Math.round(base.experienceReward * integer(94, 106) / 100)
    };
  });
  const counts: Record<CoreRequestKind, number> = {
    feature: kinds.filter((kind) => kind === "feature").length,
    bug: kinds.filter((kind) => kind === "bug").length,
    infra: kinds.filter((kind) => kind === "infra").length
  };
  const maxCount = Math.max(...Object.values(counts));
  const dominantKinds = (Object.keys(counts) as CoreRequestKind[]).filter((kind) => counts[kind] === maxCount);
  const bossKind = dominantKinds[integer(0, dominantKinds.length - 1)]!;
  const bossTitles: Record<CoreRequestKind, string> = {
    feature: "专项大需求：大促作战室",
    bug: "专项大需求：上线前全链路回归",
    infra: "专项大需求：核心链路扩容"
  };
  const boss = {
    code: "BOSS-01",
    title: bossTitles[bossKind],
    kind: bossKind,
    speed: integer(21, 24),
    totalWork: integer(850, 960),
    budgetReward: integer(140, 160),
    experienceReward: integer(82, 98),
    severity: integer(42, 49),
    isFinal: false,
    isBoss: true
  } satisfies Omit<Requirement, "id" | "x" | "remainingWork" | "agentWork">;

  const requestTimes = REQUEST_SPAWN_TIMES.map((time, index) => index === 0 || index === REQUEST_SPAWN_TIMES.length - 1 ? time : time + integer(-3, 3));
  const eventTimes = EVENT_SPAWN_TIMES.map((time) => time + integer(-4, 4));
  const events: ChangeEvent[] = [];
  while (events.length < EVENT_SPAWN_TIMES.length) {
    const recentIds = new Set(events.slice(-2).map((event) => event.id));
    const eligible = CHANGE_EVENTS.filter((event) => !recentIds.has(event.id));
    events.push(eligible[integer(0, eligible.length - 1)]!);
  }
  return {
    profile: profile.id,
    requestTimes,
    requests,
    bossAt: integer(145, 165),
    boss,
    eventTimes,
    events,
    randomSeed
  };
}

export function getEngineerDefinition(id: EngineerId): EngineerDefinition {
  const definition = definitionById.get(id);
  if (!definition) throw new Error(`Unknown engineer role: ${id}`);
  return definition;
}

export function getEngineerCost(state: BattleState, role: EngineerId): number {
  const definition = getEngineerDefinition(role);
  const roleCount = state.engineers.filter((engineer) => engineer.role === role).length + state.queue.filter((order) => order.role === role).length;
  const repeatedHires = Math.max(0, roleCount - (role === "intern" ? 1 : 0));
  return Math.ceil((definition.cost * (1 + repeatedHires * REPEAT_ROLE_COST_STEP)) / 5) * 5;
}

export function createBattle(seed = 1024): BattleState {
  const normalizedSeed = seed >>> 0 || 1;
  const plan = createBattlePlan(normalizedSeed);
  return {
    phase: "running",
    elapsed: 0,
    budget: 110,
    experience: 0,
    techDebt: 0,
    projectHealth: MAX_PROJECT_HEALTH,
    techEra: 0,
    engineers: [{ id: 1, role: "intern", lane: 0, x: HOME_STATION_START_X, runDistance: 0, targetRequestId: null, action: "idle" }],
    requests: [],
    queue: [],
    nextEngineerId: 2,
    nextRequestId: 1,
    requestScheduleIndex: 0,
    plan,
    bossSpawned: false,
    eventScheduleIndex: 0,
    aiBanUntil: 0,
    aiBanCooldownUntil: 0,
    nextEventAt: plan.eventTimes[0] ?? Number.POSITIVE_INFINITY,
    randomSeed: plan.randomSeed,
    pendingEvent: null,
    tutorialStep: 0,
    rushUntil: 0,
    shipItUntil: 0,
    shipItCooldownUntil: 0,
    prioritizedRequestId: null,
    priorityEngineerIds: [],
    priorityCooldownUntil: 0,
    incidentUntil: 0,
    nextIncidentAt: 115,
    accumulator: 0,
    paused: false,
    speed: 1,
    notice: "",
    noticeUntil: 0,
    telemetry: []
  };
}

export function hireEngineer(state: BattleState, role: EngineerId): boolean {
  if (state.phase !== "running") return false;
  const definition = getEngineerDefinition(role);
  if (definition.era > state.techEra) {
    setNotice(state, `需要先进入「${ERAS[definition.era].name}」`);
    return false;
  }
  if (state.queue.length >= MAX_TRAINING_QUEUE) {
    setNotice(state, "招聘队列已满");
    return false;
  }
  if (state.engineers.length + state.queue.length >= MAX_POPULATION) {
    setNotice(state, `团队人数已达上限（${MAX_POPULATION}）`);
    return false;
  }
  const hireCost = getEngineerCost(state, role);
  if (state.budget < hireCost) {
    setNotice(state, `预算不足，还差${Math.ceil(hireCost - state.budget)}`);
    return false;
  }
  state.budget -= hireCost;
  state.queue.push({ role, remaining: definition.trainingTime, total: definition.trainingTime });
  state.tutorialStep = Math.max(state.tutorialStep, 1);
  setNotice(state, `${definition.name}已加入招聘队列`);
  emitTelemetry(state, "recruit", { role, cost: hireCost, budget: Math.floor(state.budget) });
  return true;
}

export function upgradeEra(state: BattleState): boolean {
  if (state.phase !== "running" || state.techEra >= ERAS.length - 1) return false;
  const nextEra = ERAS[state.techEra + 1];
  if (state.experience < nextEra.cost) {
    setNotice(state, `技术经验不足，还差${Math.ceil(nextEra.cost - state.experience)}`);
    return false;
  }
  state.experience -= nextEra.cost;
  state.techEra += 1;
  state.tutorialStep = Math.max(state.tutorialStep, 3);
  setNotice(state, `进入${nextEra.name}，团队效率提升`);
  emitTelemetry(state, "era_upgrade", { era: nextEra.name, experienceCost: nextEra.cost, productivity: nextEra.productivity });
  return true;
}

export function chooseChange(state: BattleState, choiceId: string): boolean {
  const event = state.pendingEvent;
  if (!event || state.phase !== "running" || !event.choices.some((choice) => choice.id === choiceId)) return false;
  if (choiceId === "fix-alert" && state.budget < 40) {
    setNotice(state, "修复线上告警需要 40 预算");
    return false;
  }
  const eventId = event.id;
  state.pendingEvent = null;
  switch (choiceId) {
    case "accept-scope":
      state.budget += 45;
      state.experience += 18;
      addTechDebt(state, 24, "接下临时需求");
      {
        const acceptedChanges = state.telemetry.filter((item) => item.type === "event_choice" && item.detail.choice === "accept-scope").length;
        addRequirement(state, { code: acceptedChanges === 0 ? "R-CHANGE" : `R-CHANGE-${String(acceptedChanges + 1).padStart(2, "0")}`, title: "临时统计卡片", kind: "feature", speed: 30, totalWork: 110, budgetReward: 40, experienceReward: 22, severity: 8, isFinal: false });
      }
      break;
    case "freeze-scope":
      state.budget = Math.max(0, state.budget - 12);
      addTechDebt(state, -20, "冻结需求范围");
      state.projectHealth = Math.min(MAX_PROJECT_HEALTH, state.projectHealth + 5);
      break;
    case "quick-release":
      state.rushUntil = state.elapsed + 22;
      addTechDebt(state, 34, "快速交付");
      break;
    case "verify-release":
      state.experience += 30;
      addTechDebt(state, -12, "保留验证时间");
      break;
    case "fix-alert":
      state.budget = Math.max(0, state.budget - 40);
      addTechDebt(state, -36, "修复线上告警");
      state.projectHealth = Math.min(MAX_PROJECT_HEALTH, state.projectHealth + 12);
      break;
    case "hotfix-alert":
      state.rushUntil = state.elapsed + 12;
      addTechDebt(state, 30, "快速绕过线上告警");
      break;
    case "auto-generate":
      state.rushUntil = state.elapsed + 26;
      addTechDebt(state, 42, "Agent 批量生成");
      break;
    case "review-first":
      state.experience += 24;
      addTechDebt(state, -18, "人工复核 Agent 输出");
      break;
  }
  const chosen = event.choices.find((choice) => choice.id === choiceId);
  if (chosen) setNotice(state, `${chosen.label}：${chosen.description}`);
  state.tutorialStep = Math.max(state.tutorialStep, 2);
  emitTelemetry(state, "event_choice", { event: eventId, choice: choiceId, budget: Math.floor(state.budget), experience: Math.floor(state.experience), techDebt: Math.floor(state.techDebt) });
  return true;
}

export function prioritizeRequirement(state: BattleState, requirementId: number): boolean {
  if (state.phase !== "running") return false;
  if (state.pendingEvent) {
    setNotice(state, "请先处理当前需求变更，再调整优先级");
    return false;
  }
  const request = state.requests.find((candidate) => candidate.id === requirementId);
  if (!request) {
    setNotice(state, "这项需求已不在待办中");
    return false;
  }
  if (state.elapsed < state.priorityCooldownUntil) {
    setNotice(state, `调度冷却中，还需 ${Math.ceil(state.priorityCooldownUntil - state.elapsed)} 秒`);
    return false;
  }

  const workingCounts = new Map<number, number>();
  for (const engineer of state.engineers) {
    if (engineer.action === "working" && engineer.targetRequestId !== null) {
      workingCounts.set(engineer.targetRequestId, (workingCounts.get(engineer.targetRequestId) ?? 0) + 1);
    }
  }
  const availableCandidates = state.engineers.filter((engineer) =>
    engineer.action !== "working" || engineer.targetRequestId === requirementId ||
    (engineer.targetRequestId !== null && (workingCounts.get(engineer.targetRequestId) ?? 0) > 1) ||
    state.engineers.length > 1
  );
  const candidates = availableCandidates.filter((engineer) => canReachRequest(engineer, request));
  if (candidates.length === 0) {
    setNotice(state, availableCandidates.length === 0 ? "团队正在处理其他需求，暂时没有可调度工程师" : "需求尚未进入研发防线，暂时无法调度工程师");
    return false;
  }

  const previousPriorityId = state.prioritizedRequestId;
  if (previousPriorityId !== null) {
    for (const engineerId of state.priorityEngineerIds) {
      const engineer = state.engineers.find((candidate) => candidate.id === engineerId);
      if (engineer?.targetRequestId === previousPriorityId) engineer.targetRequestId = null;
    }
  }

  const ranked = candidates
    .map((engineer) => {
      const definition = getEngineerDefinition(engineer.role);
      const focusBonus = definition.focus === "any"
        ? 1
        : definition.focus === request.kind
          ? (definition.id === "qa" ? 1.5 : 1.35)
          : 0.58;
      const arrival = Math.max(0, Math.abs(request.x - engineer.x) - definition.workRange) / definition.moveSpeed;
      const estimate = arrival + request.remainingWork / Math.max(1, definition.workRate * focusBonus * ERAS[state.techEra].productivity);
      return { engineer, score: estimate };
    })
    .sort((a, b) => a.score - b.score);
  const secondsToBase = Math.max(0, request.x - BASE_FRONT_EDGE) / Math.max(1, request.speed);
  const needsRapidResponse = request.isFinal || secondsToBase <= 18;
  const assignmentRatio = needsRapidResponse ? 0.4 : 0.25;
  const assignmentCount = Math.min(candidates.length, 3, Math.max(1, Math.ceil(state.engineers.length * assignmentRatio)));
  const assigned = ranked.slice(0, assignmentCount).map(({ engineer }) => engineer);
  const interruptedRequests = [...new Set(assigned
    .map((engineer) => state.requests.find((candidate) => candidate.id === engineer.targetRequestId))
    .filter((candidate): candidate is Requirement => Boolean(candidate && candidate.id !== request.id))
    .map((candidate) => candidate.code))];

  state.prioritizedRequestId = request.id;
  state.priorityEngineerIds = assigned.map((engineer) => engineer.id);
  state.priorityCooldownUntil = state.elapsed + PRIORITY_COOLDOWN;
  for (const engineer of assigned) engineer.targetRequestId = request.id;

  const names = assigned.map((engineer) => getEngineerDefinition(engineer.role).name).join("、");
  setNotice(state, `${request.code} 已设为优先需求　调度：${names}${interruptedRequests.length ? `　暂缓：${interruptedRequests.join("、")}` : ""}`);
  emitTelemetry(state, "requirement_prioritized", {
    requirement: request.code,
    requirementId: request.id,
    kind: request.kind,
    engineers: assigned.length,
    roles: assigned.map((engineer) => engineer.role).join(","),
    deferred: interruptedRequests.join(",")
  });
  return true;
}

export function activateShipIt(state: BattleState): boolean {
  if (state.phase !== "running" || state.paused) return false;
  if (state.pendingEvent) {
    setNotice(state, "请先处理当前需求变更，再使用极限冲刺");
    return false;
  }
  if (state.elapsed < state.shipItCooldownUntil) {
    setNotice(state, `极限冲刺冷却中，还需 ${Math.ceil(state.shipItCooldownUntil - state.elapsed)} 秒`);
    return false;
  }

  state.shipItUntil = state.elapsed + SHIP_IT_DURATION;
  state.shipItCooldownUntil = state.elapsed + SHIP_IT_COOLDOWN;
  addTechDebt(state, SHIP_IT_DEBT_COST, "使用极限冲刺");
  setNotice(state, `极限冲刺启动：${SHIP_IT_DURATION} 秒内处理效率 +${Math.round(SHIP_IT_WORK_BONUS * 100)}%`);
  emitTelemetry(state, "rush_activated", {
    duration: SHIP_IT_DURATION,
    workBonus: SHIP_IT_WORK_BONUS,
    techDebt: SHIP_IT_DEBT_COST,
    cooldown: SHIP_IT_COOLDOWN
  });
  return true;
}

/** Authoritative world-space post for an engineer when no request is assigned. */
export function getEngineerHomeX(engineer: Engineer): number {
  const column = engineer.lane % HOME_STATION_COLUMNS;
  return HOME_STATION_START_X + column * HOME_STATION_SPACING;
}

/**
 * Returns the actual world-space position used both for movement and rendering.
 * Assigned engineers receive stable, separated slots around their request.
 */
export function getEngineerWorkstationX(state: BattleState, engineer: Engineer): number | null {
  const request = state.requests.find((candidate) => candidate.id === engineer.targetRequestId);
  if (!request) return null;
  const assigned = state.engineers
    .filter((candidate) => candidate.targetRequestId === request.id)
    .sort((a, b) => a.id - b.id);
  const slot = Math.max(0, assigned.findIndex((candidate) => candidate.id === engineer.id));
  return getWorkstationXForSlot(state, engineer, request, slot);
}

export function advanceBattle(state: BattleState, frameDelta: number): void {
  if (state.paused || state.phase !== "running" || state.pendingEvent) return;
  state.accumulator += Math.min(frameDelta, 0.1) * state.speed;
  while (state.accumulator >= SIMULATION_STEP && state.phase === "running" && !state.pendingEvent) {
    stepBattle(state, SIMULATION_STEP);
    state.accumulator -= SIMULATION_STEP;
  }
}

export function getInterpolatedWorldX(
  state: BattleState,
  entity: "engineer" | "request",
  id: number
): number | null {
  const current = entity === "engineer"
    ? state.engineers.find((candidate) => candidate.id === id)?.x
    : state.requests.find((candidate) => candidate.id === id)?.x;
  if (current === undefined) return null;

  const snapshot = renderPositionSnapshots.get(state);
  const previous = entity === "engineer"
    ? snapshot?.engineers.get(id)
    : snapshot?.requests.get(id);
  if (previous === undefined || Math.abs(current - previous) > MAX_INTERPOLATION_DISTANCE) return current;

  const alpha = Math.max(0, Math.min(1, state.accumulator / SIMULATION_STEP));
  return previous + (current - previous) * alpha;
}

function stepBattle(state: BattleState, delta: number): void {
  captureRenderPositions(state);
  state.elapsed += delta;
  if (state.shipItUntil > 0 && state.elapsed >= state.shipItUntil) {
    state.shipItUntil = 0;
    setNotice(state, "极限冲刺结束，团队恢复常规节奏");
    emitTelemetry(state, "rush_completed", { duration: SHIP_IT_DURATION });
  }
  state.budget = Math.min(9999, state.budget + PASSIVE_BUDGET_PER_SECOND * delta);
  state.budget -= state.techDebt * DEBT_INTEREST_PER_DEBT_PER_SECOND * delta;
  updateAgentLoan(state, delta);
  advanceHiring(state, delta);
  spawnScheduledRequests(state);
  triggerChangeEvent(state);
  updateRequests(state, delta);
  if (state.phase !== "running") return;
  if (state.projectHealth <= 0) {
    endBattle(state, "defeat", "项目健康度归零，团队无法继续交付");
    return;
  }
  updateEngineers(state, delta);
  triggerOnlineIncident(state);
  if (state.phase !== "running") return;

  if (state.elapsed >= ROUND_DURATION) {
    endBattle(state, "defeat", "最终上线窗口已关闭");
  } else if (state.projectHealth <= 0) {
    endBattle(state, "defeat", "项目健康度归零，团队无法继续交付");
  }
}

function captureRenderPositions(state: BattleState): void {
  let snapshot = renderPositionSnapshots.get(state);
  if (!snapshot) {
    snapshot = { engineers: new Map(), requests: new Map() };
    renderPositionSnapshots.set(state, snapshot);
  }
  snapshot.engineers.clear();
  snapshot.requests.clear();
  for (const engineer of state.engineers) snapshot.engineers.set(engineer.id, engineer.x);
  for (const request of state.requests) snapshot.requests.set(request.id, request.x);
}

function advanceHiring(state: BattleState, delta: number): void {
  const order = state.queue[0];
  if (!order) return;
  order.remaining -= delta;
  if (order.remaining > 0) return;

  const definition = getEngineerDefinition(order.role);
  const lane = state.nextEngineerId - 1;
  state.queue.shift();
  state.engineers.push({ id: state.nextEngineerId++, role: definition.id, lane, x: ENGINEER_SPAWN_X, runDistance: 0, targetRequestId: null, action: "idle" });
  setNotice(state, `${definition.name}到岗`);
}

function spawnScheduledRequests(state: BattleState): void {
  while (state.requestScheduleIndex < state.plan.requestTimes.length && state.plan.requestTimes[state.requestScheduleIndex]! <= state.elapsed) {
    const definition = state.plan.requests[state.requestScheduleIndex];
    state.requestScheduleIndex += 1;
    if (definition) addRequirement(state, definition);
  }
  if (!state.bossSpawned && state.elapsed >= state.plan.bossAt) {
    state.bossSpawned = true;
    addRequirement(state, state.plan.boss);
    setNotice(state, `${state.plan.boss.title}进入待办（工期 ${state.plan.boss.totalWork} 工时）`);
    emitTelemetry(state, "boss_spawn", { request: state.plan.boss.code, work: state.plan.boss.totalWork });
  }
}

function triggerChangeEvent(state: BattleState): void {
  if (state.eventScheduleIndex >= state.plan.eventTimes.length || state.elapsed < state.nextEventAt) return;
  const event = state.plan.events[state.eventScheduleIndex];
  if (!event) return;
  state.pendingEvent = event;
  state.eventScheduleIndex += 1;
  state.nextEventAt = state.plan.eventTimes[state.eventScheduleIndex] ?? Number.POSITIVE_INFINITY;
  emitTelemetry(state, "change_event", { event: event.id });
}

function updateRequests(state: BattleState, delta: number): void {
  for (const request of [...state.requests]) {
    const beingWorked = state.engineers.some((engineer) => engineer.targetRequestId === request.id && engineer.action === "working");
    request.x -= request.speed * (beingWorked ? WORKING_REQUEST_SPEED_MULTIPLIER : 1) * delta;
    if (request.x <= BASE_FRONT_EDGE) {
      state.requests = state.requests.filter((candidate) => candidate.id !== request.id);
      clearPriorityTarget(state, request.id);
      state.projectHealth = Math.max(0, state.projectHealth - request.severity);
      setNotice(state, `${request.code} 超过响应时限，项目健康 -${request.severity}`);
      emitTelemetry(state, "request_missed", { request: request.code, severity: request.severity, projectHealth: state.projectHealth, boss: request.isBoss === true });
      if (request.isFinal) endBattle(state, "defeat", "最终需求未能在截止前完成");
    }
  }
}

function updateAgentLoan(state: BattleState, delta: number): void {
  const agents = state.engineers.filter((engineer) => engineer.role === "agent");
  if (state.aiBanUntil !== 0 && state.elapsed >= state.aiBanUntil) {
    state.aiBanUntil = 0;
    state.aiBanCooldownUntil = state.elapsed + AI_BAN_COOLDOWN;
    if (agents.length > 0) setNotice(state, "风控解除，Agent 恢复工作");
  }
  const banned = state.aiBanUntil > state.elapsed;
  if (agents.length > 0 && !banned) {
    // 月供只在 Agent 正常在岗时计提；停摆期间不再计息，给玩家留出还债窗口。
    state.techDebt = Math.min(300, state.techDebt + agents.length * AGENT_DEBT_PER_SECOND * delta);
    const rearmReady = state.elapsed >= state.aiBanCooldownUntil;
    if (rearmReady && state.techDebt >= AI_BAN_THRESHOLD) {
      state.aiBanUntil = state.elapsed + AI_BAN_DURATION;
      setNotice(state, `AI 被风控封禁 ${AI_BAN_DURATION} 秒：技术债是 AI 的月供`);
      emitTelemetry(state, "ai_banned", { debt: Math.floor(state.techDebt), agents: agents.length });
    }
  }
}

export function isAgentBanned(state: BattleState): boolean {
  return state.aiBanUntil > state.elapsed;
}

function updateEngineers(state: BattleState, delta: number): void {
  assignEngineerTargets(state);
  const contributorsByRequest = new Map<number, number>();
  for (const engineer of state.engineers) {
    if (state.phase !== "running") return;
    const request = state.requests.find((candidate) => candidate.id === engineer.targetRequestId);
    if (!request) {
      setEngineerTarget(engineer, null);
      const homeX = getEngineerHomeX(engineer);
      if (Math.abs(engineer.x - homeX) > MOVE_ARRIVAL_EPSILON) {
        const distance = Math.min(getEngineerDefinition(engineer.role).moveSpeed * delta, Math.abs(homeX - engineer.x));
        engineer.x += Math.sign(homeX - engineer.x) * distance;
        engineer.runDistance += distance;
        engineer.action = "moving";
      } else {
        engineer.x = homeX;
        engineer.action = "idle";
        // QA 待命就是还款：把「回头招测试救场」变成明确的收益。
        if (engineer.role === "qa") {
          state.techDebt = Math.max(0, state.techDebt - QA_REPAY_PER_SECOND * delta);
        }
      }
      continue;
    }

    const definition = getEngineerDefinition(engineer.role);
    const assigned = state.engineers
      .filter((candidate) => candidate.targetRequestId === request.id)
      .sort((a, b) => a.id - b.id);
    const slot = Math.max(0, assigned.findIndex((candidate) => candidate.id === engineer.id));
    const workstationX = getWorkstationXForSlot(state, engineer, request, slot);
    if (getDispatchWaitSeconds(engineer, request, workstationX) > SIMULATION_STEP * 2) {
      const homeX = getEngineerHomeX(engineer);
      const homeGap = Math.abs(engineer.x - homeX);
      const shouldReturn = engineer.action === "moving"
        ? homeGap > MOVE_ARRIVAL_EPSILON
        : homeGap > MOVE_RESUME_EPSILON;
      if (shouldReturn) {
        const distance = Math.min(definition.moveSpeed * delta, Math.abs(homeX - engineer.x));
        engineer.x += Math.sign(homeX - engineer.x) * distance;
        engineer.runDistance += distance;
        engineer.action = "moving";
      } else {
        engineer.x = homeX;
        engineer.action = "idle";
      }
      continue;
    }

    const destinationX = workstationX;
    const destinationGap = Math.abs(destinationX - engineer.x);
    const shouldMove = engineer.action === "moving"
      ? destinationGap > MOVE_ARRIVAL_EPSILON
      : destinationGap > MOVE_RESUME_EPSILON;
    if (shouldMove) {
      const distanceToDestination = destinationX - engineer.x;
      const distance = Math.min(definition.moveSpeed * delta, Math.abs(distanceToDestination));
      engineer.x += Math.sign(distanceToDestination) * distance;
      engineer.runDistance += distance;
      engineer.action = "moving";
      continue;
    }
    engineer.x = destinationX;
    if (destinationX !== workstationX || Math.abs(request.x - workstationX) > definition.workRange) {
      engineer.action = "idle";
      continue;
    }

    engineer.action = "working";
    const focusBonus = definition.focus === "any"
      ? 1
      : definition.focus === request.kind
        ? (definition.id === "qa" ? 1.5 : 1.35)
        : 0.58;
    const debtPenalty = state.techDebt <= 60 ? 1 : 1 - Math.min(0.42, (state.techDebt - 60) * 0.0035);
    const eraBonus = ERAS[state.techEra].productivity;
    const eventRushBonus = state.elapsed < state.rushUntil ? 1.55 : 1;
    const shipItBonus = state.elapsed < state.shipItUntil ? 1 + SHIP_IT_WORK_BONUS : 1;
    const rushBonus = Math.max(eventRushBonus, shipItBonus);
    const incidentPenalty = state.elapsed < state.incidentUntil ? 0.55 : 1;
    // 封禁期间 Agent 的产能断供：钱借来的一面是停摆。
    const agentBanPenalty = engineer.role === "agent" && isAgentBanned(state) ? 0 : 1;
    const contributors = contributorsByRequest.get(request.id) ?? 0;
    const cooperation = COLLABORATION_RETURNS[contributors] ?? COLLABORATION_RETURNS.at(-1)!;
    const work = definition.workRate * agentBanPenalty * focusBonus * debtPenalty * eraBonus * rushBonus * incidentPenalty * cooperation * delta;
    contributorsByRequest.set(request.id, contributors + 1);
    request.remainingWork = Math.max(0, request.remainingWork - work);
    if (engineer.role === "agent") request.agentWork += work;
    if (request.remainingWork <= 0) completeRequirement(state, request);
  }
}

function getWorkstationXForSlot(state: BattleState, engineer: Engineer, request: Requirement, slot: number): number {
  const definition = getEngineerDefinition(engineer.role);
  if (Math.abs(request.x - engineer.x) <= definition.workRange) {
    const previousWorkers = state.engineers
      .filter((candidate) => candidate.targetRequestId === request.id && candidate.id < engineer.id)
      .sort((a, b) => a.id - b.id);
    const spacedFromPreviousWorkers = previousWorkers.every((candidate) => Math.abs(candidate.x - engineer.x) >= WORK_STATION_SEPARATION);
    // Workers who already have a clear, in-range station keep it as the task
    // moves. This removes the repeated stop/run animation caused by chasing a
    // station that shifted a fraction of a world unit on every simulation tick.
    if ((slot === 0 || engineer.action === "working") && spacedFromPreviousWorkers) return engineer.x;
  }
  const plannedOffset = WORK_STATION_OFFSETS[slot % WORK_STATION_OFFSETS.length];
  const offset = Math.max(-(definition.workRange - 6), Math.min(definition.workRange - 6, plannedOffset));
  return Math.max(BASE_FRONT_EDGE + 12, Math.min(MAX_FRONTLINE_X, request.x + offset));
}

function getDispatchWaitSeconds(engineer: Engineer, request: Requirement, workstationX: number): number {
  const definition = getEngineerDefinition(engineer.role);
  if (request.x <= MAX_FRONTLINE_X + definition.workRange || request.speed <= 0 || workstationX < MAX_FRONTLINE_X) return 0;
  const requestContactTime = (request.x - MAX_FRONTLINE_X - definition.workRange) / request.speed;
  const travelToFrontTime = Math.max(0, MAX_FRONTLINE_X - getEngineerHomeX(engineer)) / definition.moveSpeed;
  return requestContactTime - travelToFrontTime;
}

function canReachRequest(engineer: Engineer, request: Requirement): boolean {
  const definition = getEngineerDefinition(engineer.role);
  if (request.x > MAX_FRONTLINE_X + definition.workRange && request.speed <= 0) return false;
  return !(request.x + definition.workRange < engineer.x && request.speed >= definition.moveSpeed);
}

function assignmentScore(state: BattleState, engineer: Engineer, request: Requirement, assigned: number): number {
  // 封禁中的 Agent 不参与调度，避免把需求分给停摆的劳动力。
  if (engineer.role === "agent" && isAgentBanned(state)) return 0;
  const definition = getEngineerDefinition(engineer.role);
  if (!canReachRequest(engineer, request)) return 0;
  const focusBonus = definition.focus === "any"
    ? 1
    : definition.focus === request.kind
      ? (definition.id === "qa" ? 1.5 : 1.35)
      : 0.58;
  const destinationX = getWorkstationXForSlot(state, engineer, request, assigned);
  const travelSeconds = Math.max(0, Math.abs(destinationX - engineer.x)) / definition.moveSpeed;
  const secondsToBase = Math.max(1, (request.x - BASE_FRONT_EDGE) / Math.max(1, request.speed));
  const bossLike = request.isFinal || request.isBoss === true;
  const urgency = 1 + Math.min(0.8, request.severity / 45) + Math.min(1.3, 30 / Math.max(10, secondsToBase)) + (bossLike ? 0.75 : 0);
  const debtPenalty = state.techDebt <= 60 ? 1 : 1 - Math.min(0.42, (state.techDebt - 60) * 0.0035);
  const expectedSoloWork = definition.workRate * focusBonus * debtPenalty * ERAS[state.techEra].productivity;
  const predictedWorkSeconds = request.remainingWork / Math.max(1, expectedSoloWork);
  const closingBonus = request.remainingWork <= expectedSoloWork * 2 ? 1.75 : request.remainingWork <= expectedSoloWork * 5 ? 1.25 : 1;
  const groupLimit = bossLike ? 5 : secondsToBase < predictedWorkSeconds * 1.2 ? 4 : secondsToBase < predictedWorkSeconds * 2 ? 3 : 2;
  if (assigned >= groupLimit) return 0;
  const workload = 0.55 + 0.45 * Math.min(1, request.remainingWork / Math.max(1, expectedSoloWork * 5));
  const dispatchLoad = 1 / (1 + assigned * 1);
  const travel = 1 / (1 + travelSeconds * 0.045);
  const priority = state.prioritizedRequestId === request.id ? 1.35 : 1;
  return focusBonus * urgency * workload * dispatchLoad * travel * priority * closingBonus;
}

function assignEngineerTargets(state: BattleState): void {
  const requestsById = new Map(state.requests.map((request) => [request.id, request]));
  const assignedByRequest = new Map<number, number>();
  const activePriorityIds = new Set<number>();
  if (state.prioritizedRequestId !== null && requestsById.has(state.prioritizedRequestId)) {
    for (const id of state.priorityEngineerIds) {
      const engineer = state.engineers.find((candidate) => candidate.id === id);
      const request = requestsById.get(state.prioritizedRequestId);
      if (!engineer || !request || !canReachRequest(engineer, request)) continue;
      setEngineerTarget(engineer, request);
      activePriorityIds.add(id);
      assignedByRequest.set(state.prioritizedRequestId, (assignedByRequest.get(state.prioritizedRequestId) ?? 0) + 1);
    }
  }

  const dispatchOrder = [...state.engineers]
    .filter((engineer) => !activePriorityIds.has(engineer.id))
    .sort((a, b) => Number(b.action === "working") - Number(a.action === "working") || a.id - b.id);
  for (const engineer of dispatchOrder) {
    const current = requestsById.get(engineer.targetRequestId ?? -1);
    let best: Requirement | undefined;
    let bestScore = 0;
    for (const request of state.requests) {
      const count = assignedByRequest.get(request.id) ?? 0;
      const score = assignmentScore(state, engineer, request, count) * (request.id === current?.id ? 1.18 : 1);
      if (score > bestScore) {
        best = request;
        bestScore = score;
      }
    }
    const currentScore = current ? assignmentScore(state, engineer, current, assignedByRequest.get(current.id) ?? 0) : 0;
    if (current && currentScore > 0 && currentScore >= bestScore * TARGET_RETENTION_RATIO) best = current;
    setEngineerTarget(engineer, best ?? null);
    if (best) assignedByRequest.set(best.id, (assignedByRequest.get(best.id) ?? 0) + 1);
  }
}

function setEngineerTarget(engineer: Engineer, request: Requirement | null): void {
  const nextTargetId = request?.id ?? null;
  if (engineer.targetRequestId === nextTargetId) return;
  engineer.targetRequestId = nextTargetId;
}

function completeRequirement(state: BattleState, request: Requirement): void {
  if (!state.requests.some((candidate) => candidate.id === request.id)) return;
  state.requests = state.requests.filter((candidate) => candidate.id !== request.id);
  state.budget = Math.min(9999, state.budget + request.budgetReward);
  state.experience = Math.min(9999, state.experience + request.experienceReward);
  state.tutorialStep = Math.max(state.tutorialStep, 2);
  clearPriorityTarget(state, request.id);
  for (const engineer of state.engineers) if (engineer.targetRequestId === request.id) engineer.targetRequestId = null;
  if (request.agentWork > 0) addTechDebt(state, Math.max(1, Math.round(request.agentWork * 0.08)), "AI Agent 交付");
  if (request.kind === "bug" && state.engineers.some((engineer) => engineer.role === "qa" && engineer.action === "working")) {
    addTechDebt(state, -6, "测试工程师完成回归");
  }
  setNotice(state, `${request.code} 已验收　+${request.budgetReward} 预算 · +${request.experienceReward} 经验`);
  emitTelemetry(state, "request_complete", { request: request.code, budget: request.budgetReward, experience: request.experienceReward, final: request.isFinal, boss: request.isBoss === true });
  if (request.isFinal) endBattle(state, "victory", "最终需求按时交付，项目成功上线");
}

function triggerOnlineIncident(state: BattleState): void {
  if (state.techDebt < DEBT_INCIDENT_THRESHOLD || state.elapsed < state.nextIncidentAt || state.phase !== "running") return;
  state.projectHealth = Math.max(0, state.projectHealth - 18);
  state.incidentUntil = state.elapsed + 10;
  state.nextIncidentAt = state.elapsed + 70;
  addTechDebt(state, -48, "线上故障复盘");
  setNotice(state, "线上故障：团队效率下降，项目健康 -18");
  emitTelemetry(state, "online_incident", { projectHealth: state.projectHealth, techDebt: state.techDebt, duration: 10 });
}

function addRequirement(state: BattleState, template: Omit<Requirement, "id" | "x" | "remainingWork" | "agentWork">): void {
  const request: Requirement = {
    ...template,
    id: state.nextRequestId++,
    x: REQUEST_ENTRY_X,
    remainingWork: template.totalWork,
    agentWork: 0
  };
  state.requests.push(request);
  setNotice(state, `${request.code} 新需求进入待办：${request.title}`);
}

function addTechDebt(state: BattleState, amount: number, reason: string): void {
  const previous = state.techDebt;
  state.techDebt = Math.max(0, Math.min(300, state.techDebt + amount));
  if (state.techDebt === previous) return;
  emitTelemetry(state, "debt_change", { from: previous, to: state.techDebt, delta: state.techDebt - previous, reason });
}

function endBattle(state: BattleState, phase: Exclude<GamePhase, "running">, reason: string): void {
  if (state.phase !== "running") return;
  state.phase = phase;
  state.paused = true;
  if (state.shipItUntil > state.elapsed) {
    const startedAt = state.shipItCooldownUntil - SHIP_IT_COOLDOWN;
    emitTelemetry(state, "rush_completed", { duration: Math.max(0, state.elapsed - startedAt), interrupted: true });
    state.shipItUntil = 0;
  }
  state.prioritizedRequestId = null;
  state.priorityEngineerIds = [];
  setNotice(state, reason);
  emitTelemetry(state, "result", { result: phase, reason, elapsed: Math.floor(state.elapsed), era: ERAS[state.techEra].name, projectHealth: state.projectHealth, techDebt: state.techDebt });
}

function clearPriorityTarget(state: BattleState, requestId: number): void {
  if (state.prioritizedRequestId !== requestId) return;
  state.prioritizedRequestId = null;
  state.priorityEngineerIds = [];
}

function emitTelemetry(state: BattleState, type: string, detail: GameTelemetryEvent["detail"]): void {
  state.telemetry.push({ type, at: Math.floor(state.elapsed * 10) / 10, detail });
  if (state.telemetry.length > 500) state.telemetry.shift();
}

function nextRandom(seed: number): number {
  let value = seed >>> 0 || 1;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return value >>> 0;
}

function mixSeed(seed: number): number {
  let value = seed >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x21f0aaad);
  value = Math.imul(value ^ (value >>> 15), 0x735a2d97);
  return (value ^ (value >>> 15)) >>> 0 || 1;
}

function setNotice(state: BattleState, message: string): void {
  state.notice = message;
  state.noticeUntil = state.elapsed + 3;
}

export function getNextEra(state: BattleState): EraDefinition | null {
  return ERAS[state.techEra + 1] ?? null;
}

export function tutorialText(state: BattleState): string {
  if (state.prioritizedRequestId !== null) {
    const request = state.requests.find((candidate) => candidate.id === state.prioritizedRequestId);
    if (request) return `${request.code} 已列为优先需求，专长工程师会优先处理。需要冲一波时按 R（效率 +40%，技术债 +25）。`;
  }
  if (state.tutorialStep === 0) return "先招聘一名前端工程师。需求处理时仍会缓慢逼近；点重要任务卡调度专人。按 R 冲刺 12 秒（效率 +40%，技术债 +25）。";
  if (state.tutorialStep === 1) return "专长角色效率更高；同岗位重复招聘会涨价。点击需求卡可调整优先级，验收得预算和经验，按 E 升级时代。";
  if (state.tutorialStep === 2) return "需求变更会暂停交付等待选择；快速方案更快但增加技术债，冲刺也要承担债务。";
  if (state.tutorialStep === 3) return "留意项目健康与技术债，在 5:00 截止前完成最终上线需求。";
  return "按时交付 GO-LIVE，平衡团队效率、预算和技术债。";
}
