/**
 * Shared, dependency-free catalog for analytics, the admin dashboard and the
 * game client. Keep IDs aligned with the game simulation; labels here are the
 * canonical names used by reports.
 */

export type DecisionTone = "speed" | "quality";

export interface DecisionChoiceInfo {
  id: string;
  label: string;
  tone: DecisionTone;
}

export interface DecisionEventInfo {
  id: string;
  title: string;
  category: "scope" | "release" | "incident" | "ai";
  choices: readonly DecisionChoiceInfo[];
}

export const DECISION_CATALOG: readonly DecisionEventInfo[] = [
  {
    id: "scope-creep",
    title: "产品经理：再加一个小需求？",
    category: "scope",
    choices: [
      { id: "accept-scope", label: "接下需求", tone: "speed" },
      { id: "freeze-scope", label: "冻结范围", tone: "quality" }
    ]
  },
  {
    id: "release-window",
    title: "发布窗口提前",
    category: "release",
    choices: [
      { id: "quick-release", label: "快速交付", tone: "speed" },
      { id: "verify-release", label: "坚持验证", tone: "quality" }
    ]
  },
  {
    id: "production-alert",
    title: "线上告警：边界数据异常",
    category: "incident",
    choices: [
      { id: "fix-alert", label: "修复并回归", tone: "quality" },
      { id: "hotfix-alert", label: "快速绕过", tone: "speed" }
    ]
  },
  {
    id: "ai-policy",
    title: "Agent 自动补全策略",
    category: "ai",
    choices: [
      { id: "auto-generate", label: "批量生成", tone: "speed" },
      { id: "review-first", label: "先审后用", tone: "quality" }
    ]
  }
] as const;

export const ROLE_CATALOG = [
  { id: "intern", name: "实习生", color: "#f5c46a" },
  { id: "frontend", name: "前端工程师", color: "#59c4bb" },
  { id: "backend", name: "后端工程师", color: "#75a8e7" },
  { id: "qa", name: "测试工程师", color: "#bc9be7" },
  { id: "agent", name: "AI Agent", color: "#f28d72" }
] as const;

export const ERA_CATALOG = [
  { id: 0, name: "手搓时代" },
  { id: 1, name: "工程化时代" },
  { id: 2, name: "Agent 时代" }
] as const;

const decisionById = new Map(DECISION_CATALOG.map((event) => [event.id, event]));
const choiceById = new Map(
  DECISION_CATALOG.flatMap((event) => event.choices.map((choice) => [choice.id, { event, choice }] as const))
);

export function getDecisionEvent(id: string): DecisionEventInfo | undefined {
  return decisionById.get(id);
}

export function getDecisionChoice(id: string): { event: DecisionEventInfo; choice: DecisionChoiceInfo } | undefined {
  return choiceById.get(id);
}

export function getRoleName(id: string): string {
  return ROLE_CATALOG.find((role) => role.id === id)?.name ?? id;
}

export function getEraName(id: number): string {
  return ERA_CATALOG.find((era) => era.id === id)?.name ?? `时代 ${id}`;
}

export function getChoiceLabel(choiceId: string): string {
  return getDecisionChoice(choiceId)?.choice.label ?? choiceId;
}
