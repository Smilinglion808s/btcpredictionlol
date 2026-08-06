// TD2-r2 — Opposing Drift Recovery (policy version td2-r2-opposing-drift-4-recovery).
//
// Active TD2 shadow-policy update. Recovers trades that the existing TD2
// compressed-risk gate (>= 0.45, unchanged) would abstain on, ONLY when the
// abstention is incremental (the exact previous TD1 policy would have traded)
// AND the prediction-time opposing_drift_4 feature is >= 0.50 (inclusive,
// unrounded). Never reverses a direction, never creates a new direction.
//
// TD1, A2, containment, the 0.60 global gate, fit artifacts and feature
// calculations are untouched.

import type { ExternalDecision, Side, Td1PolicyOutcome } from "./decision";

export const TD2_R2_POLICY_VERSION = "td2-r2-opposing-drift-4-recovery";
export const TD2_R2_PROSPECTIVE_TEST_ID =
  "A2_COMBINED_TD2_R2_OPPOSING_DRIFT_4_RECOVERY_050";
/** Inclusive. Never rounded, clamped or rescaled. */
export const TD2_RECOVERY_THRESHOLD = 0.5;
export const TD2_RECOVERY_FEATURE_NAME = "opposing_drift_4";
export const TD2_RECOVERY_REASON = "TD2_OPPOSING_DRIFT_4_RECOVERY";

/** Deployment timestamp for the r2 policy; persisted on every r2 row. */
export const TD2_R2_ACTIVATION_TS = "2026-08-06T19:30:00.000Z";

export type Td2NoRecoveryReason =
  | "COMPRESSED_RISK_NOT_FIRED"
  | "PREVIOUS_POLICY_ABSTAINS"
  | "FEATURE_MISSING_OR_INVALID"
  | "FEATURE_BELOW_THRESHOLD";

export type Td2RecoveryValueClass =
  | "RECOVERED_WIN"
  | "RECOVERED_LOSS"
  | "PUSH"
  | "NO_CHANGE"
  | "UNRESOLVED";

export interface Td2R2Evaluation {
  /** Active TD2-r2 published decision. */
  decision: ExternalDecision;
  wouldTrade: boolean;
  skipReason: string | null;
  vetoReasons: string[];
  // audit
  featureName: string;
  featureValue: number | null;
  threshold: number;
  evaluable: boolean;
  condition: boolean;
  fired: boolean;
  reason: string;
  direction: Side | null;
  // frozen TD2-r1 counterfactual (never published, never webhooked)
  r1Decision: ExternalDecision;
  r1WouldTrade: boolean;
  r1SkipReason: string | null;
}

function finite(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/**
 * Apply the frozen recovery rule on top of a completed TD2-r1 (compressed-risk)
 * decision. `r1` is the exact TD2-r1 result on the same prediction-time inputs.
 */
export function evaluateTd2R2(args: {
  /** TD2-r1 published decision on the same inputs. */
  r1Decision: ExternalDecision;
  r1WouldTrade: boolean;
  r1SkipReason: string | null;
  /** Whether the compressed-risk gate actually fired on this row. */
  compressedRiskVetoFired: boolean;
  /** Exact previous TD1 policy (compressed-risk removed). */
  previousPolicy: Pick<Td1PolicyOutcome, "decision" | "wouldTrade">;
  /** Prediction-time opposing_drift_4 value, unmodified. */
  opposingDrift4: number | null | undefined;
  /** False when prediction-time timing/leakage validation failed. */
  timingValid?: boolean;
}): Td2R2Evaluation {
  const value = finite(args.opposingDrift4);
  const timingValid = args.timingValid !== false;
  const prevDir =
    args.previousPolicy.decision === "YES" || args.previousPolicy.decision === "NO"
      ? (args.previousPolicy.decision as Side)
      : null;
  const prevTrades = args.previousPolicy.wouldTrade === true && prevDir !== null;

  const base = {
    featureName: TD2_RECOVERY_FEATURE_NAME,
    featureValue: value,
    threshold: TD2_RECOVERY_THRESHOLD,
    r1Decision: args.r1Decision,
    r1WouldTrade: args.r1WouldTrade,
    r1SkipReason: args.r1SkipReason,
  };
  const retain = (reason: Td2NoRecoveryReason, evaluable: boolean, condition: boolean): Td2R2Evaluation => ({
    ...base,
    decision: args.r1Decision,
    wouldTrade: args.r1WouldTrade,
    skipReason: args.r1SkipReason,
    vetoReasons: args.r1SkipReason ? [args.r1SkipReason] : [],
    evaluable,
    condition,
    fired: false,
    reason,
    direction: null,
  });

  if (!args.compressedRiskVetoFired) return retain("COMPRESSED_RISK_NOT_FIRED", false, false);
  if (!prevTrades) return retain("PREVIOUS_POLICY_ABSTAINS", false, false);
  if (value === null || !timingValid) return retain("FEATURE_MISSING_OR_INVALID", false, false);
  const condition = value >= TD2_RECOVERY_THRESHOLD;
  if (!condition) return retain("FEATURE_BELOW_THRESHOLD", true, false);

  return {
    ...base,
    decision: prevDir as Side,
    wouldTrade: true,
    skipReason: null,
    vetoReasons: [],
    evaluable: true,
    condition: true,
    fired: true,
    reason: TD2_RECOVERY_REASON,
    direction: prevDir,
  };
}

/** WIN=+1, LOSS=-1, PUSH/abstain=0, unresolved=null. */
export function scoreTd2(
  decision: ExternalDecision | null,
  actualDirection: "GREEN" | "RED" | "PUSH" | null,
): { result: "WIN" | "LOSS" | "PUSH" | null; score: number | null } {
  if (decision !== "YES" && decision !== "NO") return { result: "PUSH", score: 0 };
  if (actualDirection == null) return { result: null, score: null };
  if (actualDirection === "PUSH") return { result: "PUSH", score: 0 };
  const win =
    (decision === "YES" && actualDirection === "GREEN") ||
    (decision === "NO" && actualDirection === "RED");
  return win ? { result: "WIN", score: 1 } : { result: "LOSS", score: -1 };
}

export interface Td2R2Attribution {
  activeResult: "WIN" | "LOSS" | "PUSH" | null;
  activeScore: number | null;
  r1Result: "WIN" | "LOSS" | "PUSH" | null;
  r1Score: number | null;
  recoveryResult: "WIN" | "LOSS" | "PUSH" | null;
  recoveryScore: number | null;
  incrementalValue: number | null;
  valueClass: Td2RecoveryValueClass;
}

/** Deterministic, idempotent resolution attribution for one TD2-r2 row. */
export function attributeTd2R2(args: {
  activeDecision: ExternalDecision | null;
  r1Decision: ExternalDecision | null;
  recoveryFired: boolean;
  actualDirection: "GREEN" | "RED" | "PUSH" | null;
}): Td2R2Attribution {
  const active = scoreTd2(args.activeDecision, args.actualDirection);
  const r1 = scoreTd2(args.r1Decision, args.actualDirection);
  const unresolved = active.score === null || r1.score === null;
  const incrementalValue = unresolved ? null : (active.score as number) - (r1.score as number);

  let valueClass: Td2RecoveryValueClass;
  if (!args.recoveryFired) valueClass = "NO_CHANGE";
  else if (unresolved) valueClass = "UNRESOLVED";
  else if (active.result === "WIN") valueClass = "RECOVERED_WIN";
  else if (active.result === "LOSS") valueClass = "RECOVERED_LOSS";
  else valueClass = "PUSH";

  return {
    activeResult: active.result,
    activeScore: active.score,
    r1Result: r1.result,
    r1Score: r1.score,
    recoveryResult: args.recoveryFired ? active.result : null,
    recoveryScore: args.recoveryFired ? active.score : null,
    incrementalValue,
    valueClass,
  };
}
