import type { BattlePlan, GameTelemetryEvent } from "../core/game";

export interface DeliveryProgress {
  normalCompleted: number;
  normalTotal: number;
  extraCompleted: number;
  bossCompleted: boolean;
  bossMissed: boolean;
  goLiveCompleted: boolean;
  goLiveMissed: boolean;
}

export function getDeliveryProgress(events: readonly GameTelemetryEvent[], plan: BattlePlan): DeliveryProgress {
  const normalCodes = new Set(plan.requests.filter((request) => !request.isFinal && !request.isBoss).map((request) => request.code));
  const finalCode = plan.requests.find((request) => request.isFinal)?.code ?? "GO-LIVE";
  const completed = events.filter((event) => event.type === "request_complete");
  const missed = events.filter((event) => event.type === "request_missed");
  const requestCode = (event: GameTelemetryEvent) => typeof event.detail.request === "string" ? event.detail.request : "";

  return {
    normalCompleted: completed.filter((event) => normalCodes.has(requestCode(event))).length,
    normalTotal: normalCodes.size,
    extraCompleted: completed.filter((event) => {
      const code = requestCode(event);
      return code.length > 0 && !normalCodes.has(code) && code !== plan.boss.code && code !== finalCode;
    }).length,
    bossCompleted: completed.some((event) => event.detail.boss === true || requestCode(event) === plan.boss.code),
    bossMissed: missed.some((event) => event.detail.boss === true || requestCode(event) === plan.boss.code),
    goLiveCompleted: completed.some((event) => event.detail.final === true || requestCode(event) === finalCode),
    goLiveMissed: missed.some((event) => requestCode(event) === finalCode)
  };
}
