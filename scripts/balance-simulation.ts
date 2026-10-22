import {
  activateShipIt,
  advanceBattle,
  BASE_FRONT_EDGE,
  chooseChange,
  createBattle,
  ERAS,
  hireEngineer,
  prioritizeRequirement,
  ROUND_DURATION,
  type BattleState,
  type EngineerId,
  upgradeEra
} from "../src/core/game.ts";

type Strategy = "hire-only" | "single-role" | "balanced" | "priority" | "priority-rush";
const STRATEGIES: Strategy[] = ["hire-only", "single-role", "balanced", "priority", "priority-rush"];
const SEEDS = [1, 7, 42, 1024, 2024, 4096, 8191, 9999, 0xabc, 0xdef] as const;
const CHECKPOINTS = [60, 150, 240, 300] as const;

interface Checkpoint {
  requests: number;
  remainingWork: number;
}

interface RunMetrics {
  result: string;
  elapsed: number;
  misses: number;
  completions: number;
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

function eventChoice(state: BattleState): string {
  const event = state.pendingEvent;
  if (!event) return "";
  const preferred = ["freeze-scope", "verify-release", state.budget >= 40 ? "fix-alert" : "hotfix-alert", "review-first"];
  return event.choices.find((choice) => preferred.includes(choice.id))?.id ?? event.choices[0]?.id ?? "";
}

function roster(state: BattleState): EngineerId[] {
  return [...state.engineers.map((engineer) => engineer.role), ...state.queue.map((order) => order.role)];
}

function nextHire(state: BattleState, strategy: Strategy): EngineerId | null {
  const roles = roster(state);
  if (strategy === "single-role") return "frontend";
  if (strategy === "hire-only") {
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

  for (let frame = 0; frame < 30 * ROUND_DURATION && state.phase === "running"; frame += 1) {
    if (state.pendingEvent) chooseChange(state, eventChoice(state));
    const era = ERAS[state.techEra + 1];
    if (strategy !== "hire-only" && strategy !== "single-role" && era && state.experience >= era.cost) upgradeEra(state);

    if (state.elapsed >= nextHireAt && state.queue.length < 2) {
      const role = nextHire(state, strategy);
      if (role && hireEngineer(state, role)) {
        hired[role] += 1;
        nextHireAt = state.elapsed + 2;
      }
    }

    if ((strategy === "priority" || strategy === "priority-rush") && state.elapsed >= state.priorityCooldownUntil && state.requests.length) {
      const target = [...state.requests].sort((a, b) => riskScore(state, b) - riskScore(state, a))[0];
      if (target) prioritizeRequirement(state, target.id);
    }
    if (strategy === "priority-rush" && state.elapsed >= 35 && state.shipItUntil <= state.elapsed && state.shipItCooldownUntil <= state.elapsed) {
      const totalWork = state.requests.reduce((sum, request) => sum + request.remainingWork, 0);
      const isFinal = state.requests.some((request) => request.isFinal);
      if ((totalWork >= 360 || isFinal || state.elapsed >= 270) && state.techDebt < 180) activateShipIt(state);
    }

    const previousRequests = state.requests.map((request) => ({ request, remaining: request.remainingWork, id: request.id }));
    const previousEventCount = state.telemetry.length;
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

const summary = STRATEGIES.map((strategy) => {
  const runs = SEEDS.map((seed) => run(seed, strategy));
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
  return {
    strategy,
    seeds: count,
    wins: winCount,
    winRate: `${Math.round(winCount / count * 100)}%`,
    avgMisses: +avg((metric) => metric.misses).toFixed(2),
    avgCompleted: +avg((metric) => metric.completions).toFixed(2),
    avgElapsedSeconds: +avg((metric) => metric.elapsed).toFixed(1),
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

console.log(JSON.stringify({ seeds: SEEDS, strategyResults: summary }, null, 2));
