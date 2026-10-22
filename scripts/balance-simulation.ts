import {
  activateShipIt,
  advanceBattle,
  BASE_FRONT_EDGE,
  chooseChange,
  createBattle,
  ERAS,
  getEngineerCost,
  getEngineerDefinition,
  hireEngineer,
  prioritizeRequirement,
  ROUND_DURATION,
  type BattleState,
  type EngineerId,
  upgradeEra
} from "../src/core/game.ts";

type Strategy = "fixed-order" | "single-role" | "balanced" | "dynamic" | "dynamic-rush";
const STRATEGIES: Strategy[] = ["fixed-order", "single-role", "balanced", "dynamic", "dynamic-rush"];
const BASE_SEEDS = [1, 7, 42, 1024, 2024, 4096, 8191, 9999, 0xabc, 0xdef];
const SEEDS = Array.from({ length: 100 }, (_, index) => BASE_SEEDS[index] ?? (Math.imul(index - BASE_SEEDS.length + 1, 0x9e3779b1) >>> 0));
if (new Set(SEEDS).size !== SEEDS.length) throw new Error("Balance simulation requires unique deterministic seeds");
const CHECKPOINTS = [60, 150, 240, 300] as const;
const DYNAMIC_ROSTER_TARGET = 12;

interface Checkpoint {
  requests: number;
  remainingWork: number;
}

interface RunMetrics {
  result: string;
  elapsed: number;
  misses: number;
  completions: number;
  projectHealth: number;
  techDebt: number;
  rushes: number;
  missedRequests: string[];
  budgetSpent: number;
  experienceSpent: number;
  profile: string;
  checkpoints: Record<number, Checkpoint>;
  completionDurations: number[];
  ordinaryCompletionDurations: number[];
  finalCompletionDurations: number[];
  idleEngineerSeconds: number;
  teamEngineerSeconds: number;
  movingEngineerSeconds: number;
  workUnits: number;
  collaborationWorkerSeconds: number;
  collaborationSamples: number;
  peakCollaborators: number;
  positions: number[];
  hired: Record<EngineerId, number>;
}

function eventChoice(state: BattleState, adaptive: boolean): string {
  const event = state.pendingEvent;
  if (!event) return "";
  const workload = state.requests.reduce((sum, request) => sum + request.remainingWork, 0);
  if (adaptive) {
    if (event.id === "scope-creep") return state.projectHealth < 75 || state.techDebt >= 100 || workload >= 650 ? "freeze-scope" : "accept-scope";
    if (event.id === "release-window") return workload >= 700 && state.techDebt < 90 ? "quick-release" : "verify-release";
    if (event.id === "production-alert") return state.budget >= 40 && (state.projectHealth < 88 || state.techDebt >= 80) ? "fix-alert" : "hotfix-alert";
    if (event.id === "ai-policy") return workload >= 700 && state.techDebt < 75 ? "auto-generate" : "review-first";
  }
  const preferred = ["freeze-scope", "verify-release", state.budget >= 40 ? "fix-alert" : "hotfix-alert", "review-first"];
  return event.choices.find((choice) => preferred.includes(choice.id))?.id ?? event.choices[0]?.id ?? "";
}

function roster(state: BattleState): EngineerId[] {
  return [...state.engineers.map((engineer) => engineer.role), ...state.queue.map((order) => order.role)];
}

function nextHire(state: BattleState, strategy: Strategy): EngineerId | null {
  const roles = roster(state);
  if (strategy === "single-role") return "frontend";
  if (strategy === "fixed-order") {
    const interns = roles.filter((role) => role === "intern").length;
    const frontends = roles.filter((role) => role === "frontend").length;
    return interns <= frontends ? "intern" : "frontend";
  }
  if (roles.filter((role) => role === "frontend").length < 2) return "frontend";
  if (state.techEra >= 1 && !roles.includes("qa")) return "qa";
  if (state.techEra >= 1 && !roles.includes("backend")) return "backend";
  if (state.techEra >= 2 && !roles.includes("agent")) return "agent";
  if (state.techEra >= 1 && roles.filter((role) => role === "backend").length < 2) return "backend";
  return null;
}

function nextDynamicHire(state: BattleState): EngineerId | null {
  const roles = roster(state);
  if (roles.length >= DYNAMIC_ROSTER_TARGET) return null;
  const active = state.requests.filter((request) => request.kind !== "launch");
  if (!active.length) return roles.filter((role) => role === "frontend").length < 2 ? "frontend" : "intern";
  const workload: Record<"feature" | "bug" | "infra", number> = { feature: 0, bug: 0, infra: 0 };
  for (const request of active) {
    const secondsToBase = Math.max(1, (request.x - BASE_FRONT_EDGE) / request.speed);
    workload[request.kind as keyof typeof workload] += request.remainingWork * (1 + request.severity / 30) * (secondsToBase < 40 ? 1.5 : 1);
  }
  const existingPower = { feature: 0, bug: 0, infra: 0 };
  for (const role of roles) {
    const definition = getEngineerDefinition(role);
    const focus = definition.focus;
    for (const kind of Object.keys(workload) as Array<keyof typeof workload>) {
      existingPower[kind] += definition.workRate * (focus === "any" ? 1 : focus === kind ? role === "qa" ? 1.5 : 1.35 : 0.58);
    }
  }

  const candidates: EngineerId[] = ["intern", "frontend", "backend", "qa", "agent"];
  const scores = candidates.filter((role) => getEngineerDefinition(role).era <= state.techEra).map((role) => {
    const definition = getEngineerDefinition(role);
    const debtPenalty = role === "agent" ? Math.max(0.4, 1 - Math.max(0, state.techDebt - 60) * 0.006) : 1;
    const efficiency = (Object.keys(workload) as Array<keyof typeof workload>).reduce((sum, kind) => {
      const focus = definition.focus === "any" ? 1 : definition.focus === kind ? role === "qa" ? 1.5 : 1.35 : 0.58;
      const contribution = definition.workRate * focus * debtPenalty;
      return sum + workload[kind] * contribution / Math.max(1, existingPower[kind] + contribution);
    }, 0);
    const price = getEngineerCost(state, role);
    return { role, score: efficiency / price };
  }).sort((a, b) => b.score - a.score);
  return scores[0]?.role ?? null;
}

function shouldUpgrade(state: BattleState, strategy: Strategy): boolean {
  const nextEra = ERAS[state.techEra + 1];
  if (!nextEra || state.experience < nextEra.cost) return false;
  if (strategy !== "dynamic" && strategy !== "dynamic-rush") return true;
  if (nextEra.id === 1) return state.elapsed >= 40 || state.requests.some((request) => request.kind === "bug" || request.kind === "infra");
  const currentLoad = state.requests.reduce((sum, request) => sum + request.remainingWork, 0);
  return state.techDebt < 145 && (state.elapsed >= 145 || currentLoad >= 650);
}

function riskScore(state: BattleState, request: BattleState["requests"][number]): number {
  const existingWorkers = state.engineers.filter((engineer) => engineer.targetRequestId === request.id && engineer.action === "working").length;
  const effectiveSpeed = request.speed * (existingWorkers > 0 ? 0.55 : 1);
  const secondsToBase = Math.max(0.1, (request.x - BASE_FRONT_EDGE) / Math.max(1, effectiveSpeed));
  const currentWorkRate = state.engineers.reduce((sum, engineer) => {
    if (engineer.targetRequestId !== request.id) return sum;
    return sum + (engineer.action === "working" ? 12 : 4);
  }, 0);
  const estimatedFinish = request.remainingWork / Math.max(1, currentWorkRate);
  return request.severity / Math.max(1, secondsToBase - estimatedFinish);
}

function run(seed: number, strategy: Strategy): RunMetrics {
  const state = createBattle(seed);
  let nextHireAt = 0;
  const checkpoints: Record<number, Checkpoint> = {};
  const completionDurations: number[] = [];
  const ordinaryCompletionDurations: number[] = [];
  const finalCompletionDurations: number[] = [];
  const spawnTimesByCode = new Map<string, number[]>();
  const seenRequestIds = new Set<number>();
  const positions: number[] = [];
  const hired: Record<EngineerId, number> = { intern: 1, frontend: 0, backend: 0, qa: 0, agent: 0 };
  let idleEngineerSeconds = 0;
  let teamEngineerSeconds = 0;
  let movingEngineerSeconds = 0;
  let workUnits = 0;
  let collaborationWorkerSeconds = 0;
  let collaborationSamples = 0;
  let peakCollaborators = 0;
  let budgetSpent = 0;
  let experienceSpent = 0;
  let rushes = 0;

  for (let frame = 0; frame < 30 * ROUND_DURATION && state.phase === "running"; frame += 1) {
    const previousEventCount = state.telemetry.length;
    const adaptive = strategy === "dynamic" || strategy === "dynamic-rush";
    if (state.pendingEvent) chooseChange(state, eventChoice(state, adaptive));
    if (shouldUpgrade(state, strategy)) upgradeEra(state);

    if (state.elapsed >= nextHireAt && state.queue.length < 2) {
      const role = adaptive ? nextDynamicHire(state) : nextHire(state, strategy);
      if (role && hireEngineer(state, role)) {
        hired[role] += 1;
        nextHireAt = state.elapsed + 2;
      }
    }

    if (adaptive && state.elapsed >= state.priorityCooldownUntil && state.requests.length) {
      const target = [...state.requests].sort((a, b) => riskScore(state, b) - riskScore(state, a))[0];
      if (target) prioritizeRequirement(state, target.id);
    }
    if (strategy === "dynamic-rush" && state.elapsed >= 35 && state.shipItUntil <= state.elapsed && state.shipItCooldownUntil <= state.elapsed) {
      const finalRequest = state.requests.find((request) => request.isFinal);
      const finalWindow = rushes === 0 && finalRequest !== undefined && state.elapsed >= 265 && state.techDebt < 180;
      if (finalWindow && activateShipIt(state)) rushes += 1;
    }

    const previousRequests = state.requests.map((request) => ({ request, remaining: request.remainingWork, id: request.id }));
    advanceBattle(state, 1 / 30);
    for (const request of state.requests) {
      if (seenRequestIds.has(request.id)) continue;
      seenRequestIds.add(request.id);
      const queue = spawnTimesByCode.get(request.code) ?? [];
      queue.push(state.elapsed);
      spawnTimesByCode.set(request.code, queue);
    }
    for (const { request, remaining } of previousRequests) workUnits += Math.max(0, remaining - request.remainingWork);
    for (const event of state.telemetry.slice(previousEventCount)) {
      if (event.type === "recruit" && typeof event.detail.cost === "number") budgetSpent += event.detail.cost;
      if (event.type === "era_upgrade" && typeof event.detail.experienceCost === "number") experienceSpent += event.detail.experienceCost;
      if (event.type === "event_choice" && (event.detail.choice === "fix-alert" || event.detail.choice === "freeze-scope")) budgetSpent += event.detail.choice === "fix-alert" ? 40 : 12;
      if (event.type !== "request_complete" || typeof event.detail.request !== "string") continue;
      const times = spawnTimesByCode.get(event.detail.request);
      const startedAt = times?.shift();
      if (startedAt !== undefined) {
        const duration = Math.max(0, state.elapsed - startedAt);
        completionDurations.push(duration);
        if (event.detail.request === "GO-LIVE") finalCompletionDurations.push(duration);
        else ordinaryCompletionDurations.push(duration);
      }
    }

    const engineerCount = state.engineers.length;
    teamEngineerSeconds += engineerCount / 30;
    idleEngineerSeconds += state.engineers.filter((engineer) => engineer.action === "idle").length / 30;
    movingEngineerSeconds += state.engineers.filter((engineer) => engineer.action === "moving").length / 30;
    if (frame % 30 === 0) {
      for (const engineer of state.engineers) positions.push(engineer.x);
    }
    const workersPerRequest = new Map<number, number>();
    for (const engineer of state.engineers) {
      if (engineer.action === "working" && engineer.targetRequestId !== null) {
        workersPerRequest.set(engineer.targetRequestId, (workersPerRequest.get(engineer.targetRequestId) ?? 0) + 1);
      }
    }
    for (const count of workersPerRequest.values()) {
      collaborationWorkerSeconds += count / 30;
      collaborationSamples += 1 / 30;
      peakCollaborators = Math.max(peakCollaborators, count);
    }

    for (const checkpoint of CHECKPOINTS) {
      if (state.elapsed >= checkpoint && checkpoints[checkpoint] === undefined) {
        checkpoints[checkpoint] = {
          requests: state.requests.length,
          remainingWork: Math.round(state.requests.reduce((sum, request) => sum + request.remainingWork, 0))
        };
      }
    }
  }

  for (const checkpoint of CHECKPOINTS) {
    checkpoints[checkpoint] ??= {
      requests: state.requests.length,
      remainingWork: Math.round(state.requests.reduce((sum, request) => sum + request.remainingWork, 0))
    };
  }
  return {
    result: state.phase,
    elapsed: state.elapsed,
    misses: state.telemetry.filter((event) => event.type === "request_missed").length,
    completions: state.telemetry.filter((event) => event.type === "request_complete").length,
    projectHealth: state.projectHealth,
    techDebt: state.techDebt,
    rushes,
    missedRequests: state.telemetry.filter((event) => event.type === "request_missed").map((event) => String(event.detail.request ?? "unknown")),
    budgetSpent,
    experienceSpent,
    profile: state.plan.profile,
    checkpoints,
    completionDurations,
    ordinaryCompletionDurations,
    finalCompletionDurations,
    idleEngineerSeconds,
    teamEngineerSeconds,
    movingEngineerSeconds,
    workUnits,
    collaborationWorkerSeconds,
    collaborationSamples,
    peakCollaborators,
    positions,
    hired
  };
}

function percentile(values: number[], percent: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * percent))];
}

const runsByStrategy = new Map(STRATEGIES.map((strategy) => [strategy, new Map(SEEDS.map((seed) => [seed, run(seed, strategy)]))]));
const summary = STRATEGIES.map((strategy) => {
  const runs = SEEDS.map((seed) => runsByStrategy.get(strategy)!.get(seed)!);
  const count = runs.length;
  const avg = (selector: (metric: RunMetrics) => number) => runs.reduce((sum, metric) => sum + selector(metric), 0) / count;
  const winCount = runs.filter((metric) => metric.result === "victory").length;
  const checkpoints = Object.fromEntries(CHECKPOINTS.map((time) => [time, {
    avgRequests: +avg((metric) => metric.checkpoints[time]?.requests ?? 0).toFixed(2),
    avgWork: +avg((metric) => metric.checkpoints[time]?.remainingWork ?? 0).toFixed(0)
  }]));
  const completions = runs.flatMap((metric) => metric.completionDurations);
  const positions = runs.flatMap((metric) => metric.positions);
  const engineerCount = runs.reduce((sum, metric) => sum + Object.values(metric.hired).reduce((roleSum, amount) => roleSum + amount, 0), 0);
  const totalBudgetSpent = runs.reduce((sum, metric) => sum + metric.budgetSpent, 0);
  return {
    strategy,
    seeds: count,
    wins: winCount,
    winRate: `${Math.round(winCount / count * 100)}%`,
    avgMisses: +avg((metric) => metric.misses).toFixed(2),
    avgCompleted: +avg((metric) => metric.completions).toFixed(2),
    avgProjectHealth: +avg((metric) => metric.projectHealth).toFixed(1),
    projectHealthP10: +percentile(runs.map((metric) => metric.projectHealth), 0.1).toFixed(0),
    avgElapsedSeconds: +avg((metric) => metric.elapsed).toFixed(1),
    avgBudgetSpent: +avg((metric) => metric.budgetSpent).toFixed(1),
    avgExperienceSpent: +avg((metric) => metric.experienceSpent).toFixed(1),
    completedPer100Budget: +avg((metric) => metric.completions * 100 / Math.max(1, metric.budgetSpent)).toFixed(2),
    winsPer100Budget: +(winCount * 100 / Math.max(1, totalBudgetSpent)).toFixed(3),
    backlog: checkpoints,
    completionSeconds: {
      p50: +percentile(completions, 0.5).toFixed(1),
      p90: +percentile(completions, 0.9).toFixed(1),
      samples: completions.length,
      ordinaryP50: +percentile(runs.flatMap((metric) => metric.ordinaryCompletionDurations), 0.5).toFixed(1),
      ordinaryP90: +percentile(runs.flatMap((metric) => metric.ordinaryCompletionDurations), 0.9).toFixed(1),
      finalP50: +percentile(runs.flatMap((metric) => metric.finalCompletionDurations), 0.5).toFixed(1),
      finalSamples: runs.flatMap((metric) => metric.finalCompletionDurations).length
    },
    workPerTeamSecond: +avg((metric) => metric.workUnits / Math.max(1, metric.teamEngineerSeconds)).toFixed(2),
    idleEngineerPercent: `${Math.round(avg((metric) => metric.idleEngineerSeconds / Math.max(1, metric.teamEngineerSeconds)) * 100)}%`,
    avgIdleSecondsPerEngineer: +(runs.reduce((sum, metric) => sum + metric.idleEngineerSeconds, 0) / Math.max(1, engineerCount)).toFixed(1),
    movingEngineerPercent: `${Math.round(avg((metric) => metric.movingEngineerSeconds / Math.max(1, metric.teamEngineerSeconds)) * 100)}%`,
    avgWorkersPerActiveRequest: +avg((metric) => metric.collaborationWorkerSeconds / Math.max(1, metric.collaborationSamples)).toFixed(2),
    peakCollaborators: Math.max(...runs.map((metric) => metric.peakCollaborators)),
    frontlineX: { p50: +percentile(positions, 0.5).toFixed(0), p95: +percentile(positions, 0.95).toFixed(0), max: +positions.reduce((max, value) => Math.max(max, value), 0).toFixed(0) },
    avgHires: Object.fromEntries((Object.keys(runs[0]!.hired) as EngineerId[]).map((role) => [role, +avg((metric) => metric.hired[role]).toFixed(1)]))
  };
});

const representativeSeeds = new Map<string, number>();
for (const seed of SEEDS) {
  const profile = createBattle(seed).plan.profile;
  if (!representativeSeeds.has(profile)) representativeSeeds.set(profile, seed);
}
const sampleBattles = [...representativeSeeds].map(([profile, seed]) => {
  const plan = createBattle(seed).plan;
  return {
    seed,
    profile,
    requests: plan.requests.slice(1, -1).map((request, index) => ({ code: request.code, kind: request.kind, at: plan.requestTimes[index + 1], work: request.totalWork, speed: request.speed, urgent: request.title.startsWith("紧急：") })),
    boss: { kind: plan.boss.kind, at: plan.bossAt, work: plan.boss.totalWork, severity: plan.boss.severity },
    events: plan.events.map((event, index) => ({ id: event.id, at: plan.eventTimes[index] })),
    strategyResults: STRATEGIES.map((strategy) => {
      const metric = runsByStrategy.get(strategy)!.get(seed)!;
      return { strategy, result: metric.result, misses: metric.misses, missedRequests: metric.missedRequests, completed: metric.completions, projectHealth: metric.projectHealth, techDebt: metric.techDebt, rushes: metric.rushes };
    })
  };
});

const failures = Object.fromEntries(STRATEGIES.map((strategy) => [strategy, SEEDS.flatMap((seed) => {
  const metric = runsByStrategy.get(strategy)!.get(seed)!;
  return metric.result === "victory" ? [] : [{ seed, profile: metric.profile, misses: metric.misses, missedRequests: metric.missedRequests, completed: metric.completions, projectHealth: metric.projectHealth, techDebt: metric.techDebt, rushes: metric.rushes }];
})]));

console.log(JSON.stringify({ seedCount: SEEDS.length, seeds: SEEDS, strategyResults: summary, sampleBattles, failures }, null, 2));
