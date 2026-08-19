/**
 * Pure attribution mapping for B4x4-ES1 precision legs.
 * Reporting/scoring only — never influences decisions, eligibility or webhooks.
 */
export type PrecisionResult = "WIN" | "LOSS" | "PUSH" | "ABSTAIN";
export type ActualOutcome = "GREEN" | "RED" | "PUSH" | null | undefined;

export interface PrecisionScore {
  result: PrecisionResult | null;
  score: number | null;
}

/**
 * States:
 * - would_trade null/undefined (pre-policy row) -> null / null
 * - would_trade false                           -> ABSTAIN / 0
 * - would_trade true + actual PUSH              -> PUSH / 0
 * - would_trade true + direction matches actual -> WIN / +1
 * - would_trade true + direction opposes actual -> LOSS / -1
 */
export function scorePrecisionLeg(
  wouldTrade: boolean | null | undefined,
  direction: unknown,
  actual: ActualOutcome,
): PrecisionScore {
  if (wouldTrade === null || wouldTrade === undefined) return { result: null, score: null };
  if (wouldTrade !== true) return { result: "ABSTAIN", score: 0 };
  if (direction !== "GREEN" && direction !== "RED") return { result: "ABSTAIN", score: 0 };
  if (actual === "PUSH") return { result: "PUSH", score: 0 };
  if (actual !== "GREEN" && actual !== "RED") return { result: null, score: null };
  return direction === actual ? { result: "WIN", score: 1 } : { result: "LOSS", score: -1 };
}
