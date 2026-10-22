export interface ScoreInput {
  result: "win" | "loss";
  completedRequests: number;
  missedRequests: number;
  finalProjectHealth: number;
  finalTechDebt: number;
}

/**
 * Canonical score formula. The server always recalculates it; the client uses
 * the same function for local result previews and offline personal bests.
 */
export function calculateRunScore(run: ScoreInput): number {
  const launchBonus = run.result === "win" ? 1000 : 0;
  const subtotal = launchBonus + run.completedRequests * 100 + Math.round(run.finalProjectHealth * 10) -
    Math.round(run.finalTechDebt * 5) - run.missedRequests * 100;
  return Math.max(0, subtotal);
}
