import assert from "node:assert/strict";
import test from "node:test";
import { createBattle } from "../../src/core/game.ts";
import { getDeliveryProgress } from "../../src/ui/run-progress.ts";

test("separates scheduled delivery, bonus work, Boss, and GO-LIVE progress", () => {
  const plan = createBattle(1024).plan;
  const events = [
    { type: "request_complete", at: 1, detail: { request: plan.requests[0]!.code, final: false } },
    { type: "request_complete", at: 2, detail: { request: "EXTRA-01", final: false } },
    { type: "request_complete", at: 3, detail: { request: plan.boss.code, final: false, boss: true } },
    { type: "request_complete", at: 4, detail: { request: "GO-LIVE", final: true } }
  ] as const;

  assert.deepEqual(getDeliveryProgress(events, plan), {
    normalCompleted: 1,
    normalTotal: 11,
    extraCompleted: 1,
    bossCompleted: true,
    bossMissed: false,
    goLiveCompleted: true,
    goLiveMissed: false
  });
});

test("does not treat an extra task or a Boss completion as normal delivery progress", () => {
  const plan = createBattle(2026).plan;
  const events = [
    { type: "request_complete", at: 1, detail: { request: plan.boss.code, boss: true } },
    { type: "request_complete", at: 2, detail: { request: "EVENT-EXTRA-01" } },
    { type: "request_missed", at: 3, detail: { request: plan.boss.code, boss: true } }
  ] as const;

  assert.deepEqual(getDeliveryProgress(events, plan), {
    normalCompleted: 0,
    normalTotal: 11,
    extraCompleted: 1,
    bossCompleted: true,
    bossMissed: true,
    goLiveCompleted: false,
    goLiveMissed: false
  });
});

test("keeps GO-LIVE timeout distinct after the final request leaves the field", () => {
  const plan = createBattle(77).plan;
  const finalCode = plan.requests.find((request) => request.isFinal)!.code;
  const progress = getDeliveryProgress([
    { type: "request_complete", at: 1, detail: { request: plan.requests[0]!.code } },
    { type: "request_missed", at: 2, detail: { request: finalCode } }
  ], plan);
  assert.equal(progress.goLiveMissed, true);
  assert.equal(progress.goLiveCompleted, false);
  assert.equal(progress.normalCompleted, 1);
});
