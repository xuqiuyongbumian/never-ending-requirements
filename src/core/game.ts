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
  { id: "intern", name: "实习生", era: 0, cost: 35, workRate: 8, moveSpeed: 58, workRange: 70, trainingTime: 2.2, focus: "any", color: 0xf5c46a, summary: "稳定处理基础事项" },
  { id: "frontend", name: "前端工程师", era: 0, cost: 55, workRate: 15, moveSpeed: 62, workRange: 82, trainingTime: 2.8, focus: "feature", color: 0x59c4bb, summary: "功能需求效率 +35%" },
  { id: "backend", name: "后端工程师", era: 1, cost: 70, workRate: 20, moveSpeed: 54, workRange: 75, trainingTime: 3.2, focus: "infra", color: 0x75a8e7, summary: "基础设施效率 +35%" },
  { id: "qa", name: "测试工程师", era: 1, cost: 62, workRate: 15, moveSpeed: 57, workRange: 90, trainingTime: 2.9, focus: "bug", color: 0xbc9be7, summary: "缺陷需求效率 +50%" },
  { id: "agent", name: "AI Agent", era: 2, cost: 95, workRate: 34, moveSpeed: 70, workRange: 108, trainingTime: 3.5, focus: "any", color: 0xf28d72, summary: "高速交付，同时增加技术债" }
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
  agentWork: number;
}

export interface Engineer {
  id: number;
  role: EngineerId;
  lane: number;
  x: number;
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
  eventScheduleIndex: number;
  nextEventAt: number;
  randomSeed: number;
  pendingEvent: ChangeEvent | null;
  tutorialStep: number;
  rushUntil: number;
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
const GOLD_PER_SECOND = 1.5;
const SIMULATION_STEP = 1 / 30;
const ENGINEER_SPAWN_X = 440;
const DEBT_INCIDENT_THRESHOLD = 155;

const REQUEST_SCHEDULE: readonly Omit<Requirement, "id" | "x" | "remainingWork" | "agentWork">[] = [
  { code: "R-001", title: "搭好开发环境", kind: "infra", speed: 20, totalWork: 95, budgetReward: 65, experienceReward: 28, severity: 7, isFinal: false },
  { code: "R-002", title: "产品首页原型", kind: "feature", speed: 22, totalWork: 135, budgetReward: 72, experienceReward: 30, severity: 8, isFinal: false },
  { code: "R-003", title: "修复登录回归", kind: "bug", speed: 24, totalWork: 145, budgetReward: 78, experienceReward: 34, severity: 10, isFinal: false },
  { code: "R-004", title: "消息中心改版", kind: "feature", speed: 25, totalWork: 175, budgetReward: 84, experienceReward: 36, severity: 9, isFinal: false },
  { code: "R-005", title: "接入鉴权接口", kind: "infra", speed: 26, totalWork: 190, budgetReward: 92, experienceReward: 40, severity: 11, isFinal: false },
  { code: "R-006", title: "补齐自动化测试", kind: "bug", speed: 27, totalWork: 205, budgetReward: 96, experienceReward: 42, severity: 12, isFinal: false },
  { code: "R-007", title: "AI 摘要助手", kind: "feature", speed: 28, totalWork: 230, budgetReward: 105, experienceReward: 46, severity: 12, isFinal: false },
  { code: "R-008", title: "支付边界校验", kind: "bug", speed: 29, totalWork: 245, budgetReward: 112, experienceReward: 48, severity: 13, isFinal: false },
  { code: "R-009", title: "上线数据看板", kind: "feature", speed: 30, totalWork: 265, budgetReward: 120, experienceReward: 52, severity: 14, isFinal: false },
  { code: "R-010", title: "压测核心链路", kind: "infra", speed: 31, totalWork: 290, budgetReward: 128, experienceReward: 56, severity: 15, isFinal: false },
  { code: "R-011", title: "发布前验收", kind: "bug", speed: 32, totalWork: 310, budgetReward: 138, experienceReward: 60, severity: 17, isFinal: false },
  { code: "GO-LIVE", title: "1024 极限上线", kind: "launch", speed: 34, totalWork: 880, budgetReward: 260, experienceReward: 80, severity: 100, isFinal: true }
];
const REQUEST_SPAWN_TIMES = [5, 24, 43, 62, 81, 100, 119, 138, 157, 176, 195, 240] as const;
const EVENT_SPAWN_TIMES = [38, 82, 126, 170, 214, 258] as const;

export const CHANGE_EVENTS: readonly ChangeEvent[] = [
  {
    id: "scope-creep",
    title: "产品经理：再加一个小需求？",
    body: "演示前想多看一张统计卡片。接下需求能拿到额外预算，但会挤占团队带宽。",
    choices: [
      { id: "accept-scope", label: "接下需求", description: "+70 预算、+18 经验，新增一张需求卡并增加技术债" },
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

export function getEngineerDefinition(id: EngineerId): EngineerDefinition {
  const definition = definitionById.get(id);
  if (!definition) throw new Error(`Unknown engineer role: ${id}`);
  return definition;
}

export function createBattle(seed = 1024): BattleState {
  return {
    phase: "running",
    elapsed: 0,
    budget: 145,
    experience: 0,
    techDebt: 0,
    projectHealth: MAX_PROJECT_HEALTH,
    techEra: 0,
    engineers: [{ id: 1, role: "intern", lane: 0, x: ENGINEER_SPAWN_X, targetRequestId: null, action: "idle" }],
    requests: [],
    queue: [],
    nextEngineerId: 2,
    nextRequestId: 1,
    requestScheduleIndex: 0,
    eventScheduleIndex: 0,
    nextEventAt: EVENT_SPAWN_TIMES[0],
    randomSeed: seed >>> 0 || 1,
    pendingEvent: null,
    tutorialStep: 0,
    rushUntil: 0,
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
  if (state.budget < definition.cost) {
    setNotice(state, `预算不足，还差${Math.ceil(definition.cost - state.budget)}`);
    return false;
  }
  state.budget -= definition.cost;
  state.queue.push({ role, remaining: definition.trainingTime, total: definition.trainingTime });
  state.tutorialStep = Math.max(state.tutorialStep, 1);
  setNotice(state, `${definition.name}已加入招聘队列`);
  emitTelemetry(state, "recruit", { role, cost: definition.cost, budget: Math.floor(state.budget) });
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
      state.budget += 70;
      state.experience += 18;
      addTechDebt(state, 24, "接下临时需求");
      addRequirement(state, { code: "R-CHANGE", title: "临时统计卡片", kind: "feature", speed: 30, totalWork: 110, budgetReward: 55, experienceReward: 22, severity: 8, isFinal: false });
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
  state.tutorialStep = Math.max(state.tutorialStep, 2);
  emitTelemetry(state, "event_choice", { event: eventId, choice: choiceId, budget: Math.floor(state.budget), experience: Math.floor(state.experience), techDebt: Math.floor(state.techDebt) });
  return true;
}

export function advanceBattle(state: BattleState, frameDelta: number): void {
  if (state.paused || state.phase !== "running" || state.pendingEvent) return;
  state.accumulator += Math.min(frameDelta, 0.1) * state.speed;
  while (state.accumulator >= SIMULATION_STEP && state.phase === "running" && !state.pendingEvent) {
    stepBattle(state, SIMULATION_STEP);
    state.accumulator -= SIMULATION_STEP;
  }
}

function stepBattle(state: BattleState, delta: number): void {
  state.elapsed += delta;
  state.budget = Math.min(9999, state.budget + GOLD_PER_SECOND * delta);
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

function advanceHiring(state: BattleState, delta: number): void {
  const order = state.queue[0];
  if (!order) return;
  order.remaining -= delta;
  if (order.remaining > 0) return;

  const definition = getEngineerDefinition(order.role);
  const lane = state.nextEngineerId % 5;
  state.queue.shift();
  state.engineers.push({ id: state.nextEngineerId++, role: definition.id, lane, x: ENGINEER_SPAWN_X, targetRequestId: null, action: "idle" });
  setNotice(state, `${definition.name}到岗`);
}

function spawnScheduledRequests(state: BattleState): void {
  while (state.requestScheduleIndex < REQUEST_SPAWN_TIMES.length && REQUEST_SPAWN_TIMES[state.requestScheduleIndex] <= state.elapsed) {
    const definition = REQUEST_SCHEDULE[state.requestScheduleIndex];
    state.requestScheduleIndex += 1;
    addRequirement(state, definition);
  }
}

function triggerChangeEvent(state: BattleState): void {
  if (state.eventScheduleIndex >= EVENT_SPAWN_TIMES.length || state.elapsed < state.nextEventAt) return;
  state.randomSeed = nextRandom(state.randomSeed);
  const event = CHANGE_EVENTS[state.randomSeed % CHANGE_EVENTS.length];
  state.pendingEvent = event;
  state.eventScheduleIndex += 1;
  state.nextEventAt = EVENT_SPAWN_TIMES[state.eventScheduleIndex] ?? Number.POSITIVE_INFINITY;
  emitTelemetry(state, "change_event", { event: event.id });
}

function updateRequests(state: BattleState, delta: number): void {
  for (const request of [...state.requests]) {
    const beingWorked = state.engineers.some((engineer) => engineer.targetRequestId === request.id && engineer.action === "working");
    if (!beingWorked) request.x -= request.speed * delta;
    if (request.x <= BASE_FRONT_EDGE) {
      state.requests = state.requests.filter((candidate) => candidate.id !== request.id);
      state.projectHealth = Math.max(0, state.projectHealth - request.severity);
      setNotice(state, `${request.code} 超过响应时限，项目健康 -${request.severity}`);
      emitTelemetry(state, "request_missed", { request: request.code, severity: request.severity, projectHealth: state.projectHealth });
      if (request.isFinal) endBattle(state, "defeat", "最终需求未能在截止前完成");
    }
  }
}

function updateEngineers(state: BattleState, delta: number): void {
  for (const engineer of state.engineers) {
    let request = state.requests.find((candidate) => candidate.id === engineer.targetRequestId);
    if (!request) {
      request = [...state.requests].sort((a, b) => Math.abs(a.x - engineer.x) - Math.abs(b.x - engineer.x))[0];
      engineer.targetRequestId = request?.id ?? null;
    }
    if (!request) {
      engineer.action = "idle";
      continue;
    }

    const definition = getEngineerDefinition(engineer.role);
    const distance = request.x - engineer.x;
    if (Math.abs(distance) > definition.workRange) {
      const direction = Math.sign(distance);
      engineer.x += direction * Math.min(definition.moveSpeed * delta, Math.abs(distance) - definition.workRange);
      engineer.action = "moving";
      continue;
    }

    engineer.action = "working";
    const focusBonus = definition.focus === request.kind ? (definition.id === "qa" ? 1.5 : 1.35) : 1;
    const debtPenalty = state.techDebt <= 60 ? 1 : 1 - Math.min(0.42, (state.techDebt - 60) * 0.0035);
    const eraBonus = ERAS[state.techEra].productivity;
    const rushBonus = state.elapsed < state.rushUntil ? 1.55 : 1;
    const incidentPenalty = state.elapsed < state.incidentUntil ? 0.55 : 1;
    const work = definition.workRate * focusBonus * debtPenalty * eraBonus * rushBonus * incidentPenalty * delta;
    request.remainingWork = Math.max(0, request.remainingWork - work);
    if (engineer.role === "agent") request.agentWork += work;
    if (request.remainingWork <= 0) completeRequirement(state, request);
  }
}

function completeRequirement(state: BattleState, request: Requirement): void {
  if (!state.requests.some((candidate) => candidate.id === request.id)) return;
  state.requests = state.requests.filter((candidate) => candidate.id !== request.id);
  state.budget = Math.min(9999, state.budget + request.budgetReward);
  state.experience = Math.min(9999, state.experience + request.experienceReward);
  state.tutorialStep = Math.max(state.tutorialStep, 2);
  for (const engineer of state.engineers) if (engineer.targetRequestId === request.id) engineer.targetRequestId = null;
  if (request.agentWork > 0) addTechDebt(state, Math.max(1, Math.round(request.agentWork * 0.08)), "AI Agent 交付");
  if (request.kind === "bug" && state.engineers.some((engineer) => engineer.role === "qa" && engineer.action === "working")) {
    addTechDebt(state, -6, "测试工程师完成回归");
  }
  setNotice(state, `${request.code} 已验收　+${request.budgetReward} 预算 · +${request.experienceReward} 经验`);
  emitTelemetry(state, "request_complete", { request: request.code, budget: request.budgetReward, experience: request.experienceReward, final: request.isFinal });
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
  setNotice(state, reason);
  emitTelemetry(state, "result", { result: phase, reason, elapsed: Math.floor(state.elapsed), era: ERAS[state.techEra].name, projectHealth: state.projectHealth, techDebt: state.techDebt });
}

function emitTelemetry(state: BattleState, type: string, detail: GameTelemetryEvent["detail"]): void {
  state.telemetry.push({ type, at: Math.floor(state.elapsed * 10) / 10, detail });
  if (state.telemetry.length > 500) state.telemetry.shift();
}

function nextRandom(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0;
}

function setNotice(state: BattleState, message: string): void {
  state.notice = message;
  state.noticeUntil = state.elapsed + 3;
}

export function getNextEra(state: BattleState): EraDefinition | null {
  return ERAS[state.techEra + 1] ?? null;
}

export function tutorialText(state: BattleState): string {
  if (state.tutorialStep === 0) return "先招聘一名前端工程师：需求会从右侧进入，团队会自动接单。";
  if (state.tutorialStep === 1) return "工程师正在处理需求。验收后获得预算和技术经验，按 E 可升级时代。";
  if (state.tutorialStep === 2) return "需求变更会暂停交付等待选择；快速方案更快，但会增加技术债。";
  if (state.tutorialStep === 3) return "留意项目健康与技术债，在 5:00 截止前完成最终上线需求。";
  return "按时交付 GO-LIVE，平衡团队效率、预算和技术债。";
}
