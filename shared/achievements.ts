import { DECISION_CATALOG, getDecisionChoice } from "./catalog.ts";

export type AchievementTier = "bronze" | "silver" | "gold" | "legend";
export type AchievementCategory = "delivery" | "team" | "decision" | "risk" | "speed";

export interface AchievementDefinition {
  id: string;
  name: string;
  description: string;
  hint: string;
  icon: string;
  tier: AchievementTier;
  category: AchievementCategory;
  points: number;
}

export interface ChoiceRecord {
  event: string;
  choice: string;
}

export interface RunFacts {
  result: "win" | "loss";
  completedRequests: number;
  recruitCount: number;
  missedRequests: number;
  finalEra: number;
  finalTechDebt: number;
  finalProjectHealth: number;
  durationSeconds: number | null;
  choices: string[];
  choiceEvents: ChoiceRecord[];
  roles: string[];
  rushCount: number;
  priorityCount: number;
  maxTechDebt: number;
  incidents: number;
  completedCodes: string[];
  missedCodes: string[];
  eraUpgrades: number;
  abandoned: boolean;
}

export interface RunFactsInput {
  result: "win" | "loss";
  completedRequests: number;
  recruitCount: number;
  missedRequests: number;
  finalEra: number;
  finalTechDebt: number;
  finalProjectHealth: number;
  durationSeconds?: number | null;
  startedAt?: string | null;
  endedAt?: string | null;
  events: readonly AchievementSourceEvent[];
  abandoned?: boolean;
}

export interface AchievementSourceEvent {
  type: string;
  properties: Record<string, unknown>;
}

export interface AchievementMeasure {
  value: number;
  target: number;
  detail?: string;
}

export interface AchievementResult extends AchievementDefinition {
  unlocked: boolean;
  value: number;
  target: number;
  progress: number;
  detail: string;
}

export interface AchievementWallEntry extends AchievementResult {
  unlockedAt: string | null;
  runId: string | null;
  unlockedRuns: number;
}

export interface AchievementRule extends AchievementDefinition {
  measure: (facts: RunFacts) => AchievementMeasure;
}

const win = (facts: RunFacts) => facts.result === "win";
const binary = (unlocked: boolean, achieved: string, pending: string): AchievementMeasure => ({
  value: unlocked ? 1 : 0,
  target: 1,
  detail: unlocked ? achieved : pending
});

const qualityChoiceIds = new Set(
  DECISION_CATALOG.flatMap((event) => event.choices.filter((choice) => choice.tone === "quality").map((choice) => choice.id))
);
const speedChoiceIds = new Set(
  DECISION_CATALOG.flatMap((event) => event.choices.filter((choice) => choice.tone === "speed").map((choice) => choice.id))
);

function countChoices(facts: RunFacts, ids: Set<string>): number {
  return facts.choices.filter((id) => ids.has(id)).length;
}

function countChoice(facts: RunFacts, id: string): number {
  return facts.choices.filter((choice) => choice === id).length;
}

export const ACHIEVEMENTS: readonly AchievementRule[] = [
  {
    id: "first-run",
    name: "初次交锋",
    description: "完成第一局项目，无论上线与否。",
    hint: "完整打完一局。",
    icon: "◆",
    tier: "bronze",
    category: "delivery",
    points: 5,
    measure: () => ({ value: 1, target: 1, detail: "已完成一局" })
  },
  {
    id: "first-launch",
    name: "首战告捷",
    description: "在截止时间前完成 GO-LIVE。",
    hint: "赢得一局。",
    icon: "▲",
    tier: "bronze",
    category: "delivery",
    points: 10,
    measure: (facts) => binary(win(facts), "成功上线", "尚未上线")
  },
  {
    id: "flawless-launch",
    name: "零失误上线",
    description: "上线成功，且没有任何需求超时。",
    hint: "胜利时漏单数为 0。",
    icon: "◎",
    tier: "gold",
    category: "delivery",
    points: 35,
    measure: (facts) => binary(
      win(facts) && facts.missedRequests === 0,
      "0 漏单",
      `漏单 ${facts.missedRequests} 项`
    )
  },
  {
    id: "all-hands",
    name: "满编团队",
    description: "单局招募 8 名或更多工程师。",
    hint: "把团队规模堆起来。",
    icon: "▦",
    tier: "silver",
    category: "team",
    points: 20,
    measure: (facts) => ({ value: facts.recruitCount, target: 8, detail: `${facts.recruitCount} / 8 人` })
  },
  {
    id: "agent-era",
    name: "Agent 时代",
    description: "把技术时代推进到 Agent 时代。",
    hint: "攒够经验升到第三时代。",
    icon: "◇",
    tier: "silver",
    category: "team",
    points: 20,
    measure: (facts) => ({
      value: facts.finalEra,
      target: 2,
      detail: `${["手搓时代", "工程化时代", "Agent 时代"][facts.finalEra] ?? "未知时代"}`
    })
  },
  {
    id: "debt-free",
    name: "轻装上阵",
    description: "上线成功，且最终技术债为 0。",
    hint: "胜利时把技术债压到 0。",
    icon: "◌",
    tier: "gold",
    category: "risk",
    points: 35,
    measure: (facts) => binary(
      win(facts) && facts.finalTechDebt <= 0,
      "0 技术债",
      `技术债 ${Math.round(facts.finalTechDebt)}`
    )
  },
  {
    id: "iron-health",
    name: "满血上线",
    description: "上线成功，且最终项目健康度保持 100%。",
    hint: "胜利时健康度不受伤。",
    icon: "✚",
    tier: "silver",
    category: "delivery",
    points: 20,
    measure: (facts) => binary(
      win(facts) && facts.finalProjectHealth >= 100,
      "健康度 100%",
      `健康度 ${Math.round(facts.finalProjectHealth)}%`
    )
  },
  {
    id: "speed-run",
    name: "极速交付",
    description: "在 4 分钟内完成上线。",
    hint: "胜利并压缩整局用时。",
    icon: "≫",
    tier: "gold",
    category: "speed",
    points: 35,
    measure: (facts) => binary(
      win(facts) && facts.durationSeconds !== null && facts.durationSeconds <= 240,
      "4 分钟内上线",
      facts.durationSeconds === null ? "暂无用时" : `用时 ${Math.round(facts.durationSeconds)} 秒`
    )
  },
  {
    id: "decision-maker",
    name: "决策大师",
    description: "一局内应对全部 6 次需求变更。",
    hint: "活到所有变更事件出现并做出选择。",
    icon: "✦",
    tier: "silver",
    category: "decision",
    points: 20,
    measure: (facts) => ({ value: facts.choices.length, target: 6, detail: `${facts.choices.length} / 6 次` })
  },
  {
    id: "scope-guard",
    name: "范围守门人",
    description: "单局至少 2 次冻结需求范围。",
    hint: "对「再加一个小需求」坚持说不。",
    icon: "▣",
    tier: "bronze",
    category: "decision",
    points: 10,
    measure: (facts) => ({ value: countChoice(facts, "freeze-scope"), target: 2, detail: `冻结 ${countChoice(facts, "freeze-scope")} / 2 次` })
  },
  {
    id: "scope-creep",
    name: "范围接纳者",
    description: "单局至少 2 次接下临时需求。",
    hint: "对产品经理说「可以，再加一个」。",
    icon: "▤",
    tier: "bronze",
    category: "decision",
    points: 10,
    measure: (facts) => ({ value: countChoice(facts, "accept-scope"), target: 2, detail: `接下 ${countChoice(facts, "accept-scope")} / 2 次` })
  },
  {
    id: "quality-first",
    name: "质量优先",
    description: "单局至少 3 次选择偏稳健的应对。",
    hint: "冻结范围、坚持验证、修复告警或先审后用。",
    icon: "◈",
    tier: "silver",
    category: "decision",
    points: 20,
    measure: (facts) => ({
      value: countChoices(facts, qualityChoiceIds),
      target: 3,
      detail: `${countChoices(facts, qualityChoiceIds)} / 3 次稳健选择`
    })
  },
  {
    id: "move-fast",
    name: "极限速度",
    description: "单局至少 3 次选择偏激进的应对。",
    hint: "接下需求、快速交付、快速绕过或批量生成。",
    icon: "⚡",
    tier: "silver",
    category: "decision",
    points: 20,
    measure: (facts) => ({
      value: countChoices(facts, speedChoiceIds),
      target: 3,
      detail: `${countChoices(facts, speedChoiceIds)} / 3 次激进选择`
    })
  },
  {
    id: "rush-addict",
    name: "冲刺上瘾",
    description: "单局使用 3 次极限冲刺。",
    hint: "按 R 把节奏拉满。",
    icon: "➤",
    tier: "bronze",
    category: "speed",
    points: 10,
    measure: (facts) => ({ value: facts.rushCount, target: 3, detail: `${facts.rushCount} / 3 次` })
  },
  {
    id: "priority-master",
    name: "调度大师",
    description: "单局手动调整 5 次需求优先级。",
    hint: "点击需求卡，把团队调到关键任务上。",
    icon: "⌖",
    tier: "silver",
    category: "decision",
    points: 20,
    measure: (facts) => ({ value: facts.priorityCount, target: 5, detail: `${facts.priorityCount} / 5 次` })
  },
  {
    id: "firefighter",
    name: "救火队员",
    description: "经历过线上故障，仍然完成上线。",
    hint: "在事故之后把项目救回来。",
    icon: "▨",
    tier: "gold",
    category: "risk",
    points: 35,
    measure: (facts) => binary(
      win(facts) && facts.incidents > 0,
      `扛过 ${facts.incidents} 次故障`,
      facts.incidents > 0 ? "已发生故障，等待上线" : "尚未触发线上故障"
    )
  },
  {
    id: "debt-survivor",
    name: "债台高筑",
    description: "技术债达到 100 以上，仍然完成上线。",
    hint: "高债务不等于必输。",
    icon: "▥",
    tier: "gold",
    category: "risk",
    points: 35,
    measure: (facts) => ({
      value: win(facts) ? Math.min(100, Math.round(facts.maxTechDebt)) : 0,
      target: 100,
      detail: win(facts) ? `峰值 ${Math.round(facts.maxTechDebt)} / 100` : "需要先上线"
    })
  },
  {
    id: "solo-carry",
    name: "孤胆英雄",
    description: "只招募 1 名工程师就完成上线。",
    hint: "拒绝扩编，靠初始团队交付。",
    icon: "◉",
    tier: "legend",
    category: "team",
    points: 60,
    measure: (facts) => binary(
      win(facts) && facts.recruitCount <= 1,
      `仅招募 ${facts.recruitCount} 人`,
      `已招募 ${facts.recruitCount} 人`
    )
  },
  {
    id: "comeback",
    name: "绝境翻盘",
    description: "项目健康度跌到 30% 以下后仍然上线。",
    hint: "带着残血项目冲过终点。",
    icon: "✧",
    tier: "legend",
    category: "delivery",
    points: 60,
    measure: (facts) => binary(
      win(facts) && facts.finalProjectHealth > 0 && facts.finalProjectHealth <= 30,
      `残血 ${Math.round(facts.finalProjectHealth)}% 上线`,
      `当前健康度 ${Math.round(facts.finalProjectHealth)}%`
    )
  },
  {
    id: "completionist",
    name: "需求清道夫",
    description: "单局验收 14 项或更多需求。",
    hint: "极限冲刺与专长角色一起用。",
    icon: "▩",
    tier: "gold",
    category: "delivery",
    points: 35,
    measure: (facts) => ({ value: facts.completedRequests, target: 14, detail: `${facts.completedRequests} / 14 项` })
  }
] as const;

const achievementById = new Map(ACHIEVEMENTS.map((achievement) => [achievement.id, achievement]));

export function getAchievement(id: string): AchievementRule | undefined {
  return achievementById.get(id);
}

export function achievementMetadata(): AchievementDefinition[] {
  return ACHIEVEMENTS.map(({ measure: _measure, ...definition }) => definition);
}

export function evaluateAchievements(facts: RunFacts): AchievementResult[] {
  return ACHIEVEMENTS.map((achievement) => {
    const measure = achievement.measure(facts);
    const target = Math.max(1, Math.round(measure.target));
    const value = Math.max(0, Number.isFinite(measure.value) ? measure.value : 0);
    return {
      id: achievement.id,
      name: achievement.name,
      description: achievement.description,
      hint: achievement.hint,
      icon: achievement.icon,
      tier: achievement.tier,
      category: achievement.category,
      points: achievement.points,
      unlocked: value >= target,
      value,
      target,
      progress: Math.max(0, Math.min(1, value / target)),
      detail: measure.detail ?? `${Math.round(value)} / ${target}`
    };
  });
}

export function achievementPoints(results: readonly Pick<AchievementResult, "unlocked" | "points">[]): number {
  return results.reduce((total, result) => total + (result.unlocked ? result.points : 0), 0);
}

export function countUnlocked(results: readonly Pick<AchievementResult, "unlocked">[]): number {
  return results.filter((result) => result.unlocked).length;
}

/**
 * Merge per-run achievement results into a player-level wall. The earliest run
 * that unlocked an achievement wins its `unlockedAt`; progress uses the best
 * result across runs.
 */
export function mergeAchievementWall(
  runs: readonly { runId: string; endedAt: string; achievements: readonly AchievementResult[] }[]
): AchievementWallEntry[] {
  const merged = new Map<string, AchievementWallEntry>();
  for (const run of [...runs].sort((a, b) => a.endedAt.localeCompare(b.endedAt))) {
    for (const result of run.achievements) {
      const existing = merged.get(result.id);
      const unlockedRuns = (existing?.unlockedRuns ?? 0) + (result.unlocked ? 1 : 0);
      if (!existing) {
        merged.set(result.id, {
          ...result,
          unlockedAt: result.unlocked ? run.endedAt : null,
          runId: result.unlocked ? run.runId : null,
          unlockedRuns
        });
        continue;
      }
      const best = result.progress > existing.progress ? result : existing;
      merged.set(result.id, {
        ...existing,
        value: best.value,
        target: best.target,
        progress: best.progress,
        detail: best.detail,
        unlocked: existing.unlocked || result.unlocked,
        unlockedAt: existing.unlockedAt ?? (result.unlocked ? run.endedAt : null),
        runId: existing.runId ?? (result.unlocked ? run.runId : null),
        unlockedRuns
      });
    }
  }
  return achievementMetadata().map((definition) => merged.get(definition.id) ?? {
    ...definition,
    unlocked: false,
    value: 0,
    target: 1,
    progress: 0,
    detail: "未开始",
    unlockedAt: null,
    runId: null,
    unlockedRuns: 0
  });
}

export function buildRunFacts(input: RunFactsInput): RunFacts {
  const choices: string[] = [];
  const choiceEvents: ChoiceRecord[] = [];
  const roles: string[] = [];
  const completedCodes: string[] = [];
  const missedCodes: string[] = [];
  let rushCount = 0;
  let priorityCount = 0;
  let incidents = 0;
  let eraUpgrades = 0;
  let incidentDebt = 0;

  for (const event of input.events) {
    const properties = event.properties ?? {};
    switch (event.type) {
      case "event_choice": {
        const choice = asString(properties.choice);
        if (!choice) break;
        choices.push(choice);
        const record: ChoiceRecord = { event: asString(properties.event), choice };
        choiceEvents.push(record);
        break;
      }
      case "recruit": {
        const role = asString(properties.role);
        if (role) roles.push(role);
        break;
      }
      case "rush_activated":
        rushCount += 1;
        break;
      case "requirement_prioritized":
        priorityCount += 1;
        break;
      case "online_incident":
        incidents += 1;
        break;
      case "era_upgrade":
        eraUpgrades += 1;
        break;
      case "request_complete": {
        const code = asString(properties.request);
        if (code) completedCodes.push(code);
        break;
      }
      case "request_missed": {
        const code = asString(properties.request);
        if (code) missedCodes.push(code);
        break;
      }
      case "debt_change": {
        const to = asNumber(properties.to);
        if (to > incidentDebt) incidentDebt = to;
        break;
      }
    }
  }

  return {
    result: input.result,
    completedRequests: Math.max(0, input.completedRequests),
    recruitCount: Math.max(0, input.recruitCount),
    missedRequests: Math.max(0, input.missedRequests),
    finalEra: Math.max(0, input.finalEra),
    finalTechDebt: Math.max(0, input.finalTechDebt),
    finalProjectHealth: Math.max(0, Math.min(100, input.finalProjectHealth)),
    durationSeconds: resolveDuration(input),
    choices,
    choiceEvents,
    roles,
    rushCount,
    priorityCount,
    maxTechDebt: Math.max(input.finalTechDebt, incidentDebt),
    incidents,
    completedCodes,
    missedCodes,
    eraUpgrades,
    abandoned: Boolean(input.abandoned)
  };
}

function resolveDuration(input: RunFactsInput): number | null {
  if (typeof input.durationSeconds === "number" && Number.isFinite(input.durationSeconds)) {
    return Math.max(0, input.durationSeconds);
  }
  if (!input.startedAt || !input.endedAt) return null;
  const start = Date.parse(input.startedAt);
  const end = Date.parse(input.endedAt);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
  return (end - start) / 1000;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asNumber(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

export function describeChoice(choiceId: string): string {
  const found = getDecisionChoice(choiceId);
  return found ? `${found.event.title} · ${found.choice.label}` : choiceId;
}
