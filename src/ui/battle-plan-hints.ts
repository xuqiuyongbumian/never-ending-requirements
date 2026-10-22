import type { BattlePlan, BattleState, RequestKind } from "../core/game";

const KIND_NAME: Record<RequestKind, string> = { feature: "功能", bug: "缺陷", infra: "基础设施", launch: "GO-LIVE" };
const ROLE_HINT: Partial<Record<RequestKind, string>> = {
  feature: "前端工程师效率更高",
  bug: "测试工程师更擅长回归",
  infra: "后端工程师效率更高",
  launch: "优先调度全队"
};

export function getOpeningBattlePlanHint(plan: BattlePlan): string {
  const counts: Record<Exclude<RequestKind, "launch">, number> = { feature: 0, bug: 0, infra: 0 };
  for (const request of plan.requests) {
    if (!request.isFinal && request.kind !== "launch") counts[request.kind] += 1;
  }
  const max = Math.max(...Object.values(counts));
  const dominant = (Object.keys(counts) as Array<keyof typeof counts>).filter((kind) => counts[kind] === max);
  if (dominant.length !== 1) return "本局需求类型较均衡，留意场上积压再调整岗位。";
  const kind = dominant[0]!;
  const label = KIND_NAME[kind];
  return `本局${label}需求偏多，${ROLE_HINT[kind]}。`;
}

export function getUpcomingBattlePlanHint(state: BattleState): string {
  const index = state.requestScheduleIndex;
  const request = state.plan.requests[index];
  const spawnAt = state.plan.requestTimes[index];
  if (!request || spawnAt === undefined) return "";
  const seconds = spawnAt - state.elapsed;
  if (seconds < 0 || seconds > 15) return "";
  const kind = KIND_NAME[request.kind];
  return `下一波约 ${Math.ceil(seconds)} 秒后：${kind}需求 · ${ROLE_HINT[request.kind] ?? "按优先级调度"}。`;
}
