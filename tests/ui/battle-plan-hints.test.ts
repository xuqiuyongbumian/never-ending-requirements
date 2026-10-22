import assert from "node:assert/strict";
import test from "node:test";
import { createBattle } from "../../src/core/game.ts";
import { getOpeningBattlePlanHint, getUpcomingBattlePlanHint } from "../../src/ui/battle-plan-hints.ts";

test("derives the opening strategy tip from the actual request mix", () => {
  const plan = createBattle(3).plan;
  const requests = plan.requests.map((request, index) => ({
    ...request,
    kind: index < 6 ? "bug" as const : request.isFinal ? "launch" as const : "feature" as const
  }));
  assert.equal(getOpeningBattlePlanHint({ ...plan, requests }), "本局缺陷需求偏多，测试工程师更擅长回归。");

  const balanced = plan.requests.map((request, index) => ({
    ...request,
    kind: request.isFinal ? "launch" as const : (["feature", "bug", "infra"] as const)[index % 3]!
  }));
  assert.equal(getOpeningBattlePlanHint({ ...plan, requests: balanced }), "本局需求类型较均衡，留意场上积压再调整岗位。");
});

test("shows only the next scheduled request when it is close", () => {
  const state = createBattle(8);
  const hint = getUpcomingBattlePlanHint(state);
  assert.match(hint, /下一波约 5 秒后：基础设施需求/);
  assert.doesNotMatch(hint, new RegExp(state.plan.requests[1]!.title));

  state.elapsed = state.plan.requestTimes[0]! + 16;
  assert.equal(getUpcomingBattlePlanHint(state), "");
});
