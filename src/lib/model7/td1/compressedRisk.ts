// TD1-RC compressed-market risk gate (policy revision td1-rc-compressed-risk-v1).
//
// One active change only: abstain when the PREDICTION-TIME market condition on
// the exact upstream prediction row is "compressed" AND the TD1 predicted loss
// probability is >= 0.45 (inclusive, unrounded). This is a decision-policy
// revision — the frozen TD1 fitted artifact and its SHA are untouched.

/** Frozen threshold. Inclusive comparison, no rounding. */
export const TD1_COMPRESSED_RISK_THRESHOLD = 0.45;

/** Legacy global turn-risk threshold. Unchanged by this revision. */
export const TD1_GLOBAL_TURN_RISK_THRESHOLD = 0.6;

export const TD1_RC_POLICY_VERSION = "td1-rc-compressed-risk-v1";
export const TD1_RC_PROSPECTIVE_TEST_ID = "A2_COMBINED_TD1_RC_COMPRESSED_RISK_045_V1";

export const ABSTAIN_TD1_COMPRESSED_RISK = "ABSTAIN_TD1_COMPRESSED_RISK";
export const COMPRESSED_MARKET_CONDITION = "compressed";

export interface CompressedRiskEvaluation {
  /** True only when both a usable market condition and a finite probability exist. */
  evaluable: boolean;
  /** The exact inclusive condition. False whenever not evaluable. */
  condition: boolean;
  marketCondition: string | null;
  probability: number | null;
  threshold: number;
  reason: string | null;
}

/**
 * Evaluate the compressed-risk condition. Missing / unknown market condition is
 * never treated as "compressed": the rule is recorded as not evaluable and does
 * not fire.
 */
export function evaluateCompressedRisk(args: {
  marketCondition: string | null | undefined;
  lossProbability: number | null | undefined;
}): CompressedRiskEvaluation {
  const raw = args.marketCondition;
  const mc =
    typeof raw === "string" && raw.trim() !== "" && raw.trim().toLowerCase() !== "unknown"
      ? raw.trim().toLowerCase()
      : null;
  const p =
    typeof args.lossProbability === "number" && Number.isFinite(args.lossProbability)
      ? args.lossProbability
      : null;

  const evaluable = mc !== null && p !== null;
  const condition =
    mc === COMPRESSED_MARKET_CONDITION && p !== null && Number.isFinite(p) && p >= TD1_COMPRESSED_RISK_THRESHOLD;

  return {
    evaluable,
    condition,
    marketCondition: mc,
    probability: p,
    threshold: TD1_COMPRESSED_RISK_THRESHOLD,
    reason: condition ? ABSTAIN_TD1_COMPRESSED_RISK : null,
  };
}

export type CounterfactualClass =
  | "AVOIDED_LOSS"
  | "SACRIFICED_WIN"
  | "PUSH"
  | "UNRESOLVED"
  | "NOT_APPLICABLE";

/**
 * Classify what the compressed-risk abstention gave up / avoided once the
 * candle resolves. `underlyingDirection` is the direction that would have been
 * published had the rule not fired.
 */
export function classifyCompressedRiskCounterfactual(args: {
  vetoFired: boolean;
  underlyingDirection: "YES" | "NO" | null;
  actualDirection: "GREEN" | "RED" | "PUSH" | null;
}): { classification: CounterfactualClass; vetoValue: number; abstentionScore: number } {
  if (!args.vetoFired || args.underlyingDirection == null) {
    return { classification: "NOT_APPLICABLE", vetoValue: 0, abstentionScore: 0 };
  }
  if (args.actualDirection == null) {
    return { classification: "UNRESOLVED", vetoValue: 0, abstentionScore: 0 };
  }
  if (args.actualDirection === "PUSH") {
    return { classification: "PUSH", vetoValue: 0, abstentionScore: 0 };
  }
  const wouldHaveWon =
    (args.underlyingDirection === "YES" && args.actualDirection === "GREEN") ||
    (args.underlyingDirection === "NO" && args.actualDirection === "RED");
  return wouldHaveWon
    ? { classification: "SACRIFICED_WIN", vetoValue: -1, abstentionScore: 0 }
    : { classification: "AVOIDED_LOSS", vetoValue: 1, abstentionScore: 0 };
}

/** WIN=+1, LOSS=-1, PUSH=0, ABSTAIN/SKIP=0. */
export function scoreDecision(
  decision: "YES" | "NO" | "SKIP" | null,
  actualDirection: "GREEN" | "RED" | "PUSH" | null,
): { result: "WIN" | "LOSS" | "PUSH" | null; score: number } {
  if (decision !== "YES" && decision !== "NO") return { result: "PUSH", score: 0 };
  if (actualDirection == null) return { result: null, score: 0 };
  if (actualDirection === "PUSH") return { result: "PUSH", score: 0 };
  const win =
    (decision === "YES" && actualDirection === "GREEN") ||
    (decision === "NO" && actualDirection === "RED");
  return win ? { result: "WIN", score: 1 } : { result: "LOSS", score: -1 };
}
