// Model 7 Variant A2 — three separately-logged filter policies layered on
// Variant A (frozen v1.1). A2 is SHADOW ONLY and can ONLY convert an A trade
// to SKIP. Never reverses direction. Never modifies A's coefficients,
// thresholds, retraining, feature engineering, or overrides.
//
// Three policies:
//   A2_Conflict — SKIP when A's logistic wanted YES but an override forced NO,
//                 scoped to `upstream_no_clear_edge` only in this first version.
//   A2_MidBand  — SKIP when A's final decision is YES with 0.65 <= p < 0.75.
//   A2_Combined — Union of the two, with attribution preserved
//                 (OVERRIDE_LOGISTIC_CONFLICT | MID_CONFIDENCE_YES | BOTH).
//
// Fully stateless — pure function of the current Variant A row.

export type FilterReason =
  | "NONE"
  | "OVERRIDE_LOGISTIC_CONFLICT"
  | "MID_CONFIDENCE_YES"
  | "BOTH";

export type A2Policy = "A2_Conflict" | "A2_MidBand" | "A2_Combined";

export type A2Decision = "YES" | "NO" | "SKIP";

export interface A2Input {
  base_decision: "YES" | "NO" | "SKIP" | null;
  final_decision: "YES" | "NO" | "SKIP" | null;
  probability_green: number | null;
  applied_override_reason: string; // "none" | "upstream_no_clear_edge" | ...
}

export interface A2PolicyOutput {
  policy: A2Policy;
  decision: A2Decision | null;   // null = fail-closed / missing inputs
  filter_fired: boolean;
  filter_reason: FilterReason;
}

const CONFLICT_SCOPE = new Set(["upstream_no_clear_edge"]);

export function probabilityBucket(p: number | null): string | null {
  if (p == null || !Number.isFinite(p)) return null;
  if (p < 0.26) return "below_0.26";
  if (p < 0.58) return "0.26-0.58";
  if (p < 0.65) return "0.58-0.65";
  if (p < 0.75) return "0.65-0.75";
  if (p < 0.85) return "0.75-0.85";
  return "0.85+";
}

function conflictFires(input: A2Input): boolean {
  const overrideApplied = input.applied_override_reason !== "none";
  return (
    input.base_decision === "YES" &&
    overrideApplied &&
    input.final_decision === "NO" &&
    CONFLICT_SCOPE.has(input.applied_override_reason)
  );
}

function midBandFires(input: A2Input): boolean {
  const p = input.probability_green;
  if (p == null || !Number.isFinite(p)) return false;
  return input.final_decision === "YES" && p >= 0.65 && p < 0.75;
}

export function evaluateA2(input: A2Input): {
  conflict: A2PolicyOutput;
  midband: A2PolicyOutput;
  combined: A2PolicyOutput;
} {
  // Base passthrough: if A skipped, all A2 policies remain SKIP.
  if (input.final_decision === "SKIP" || input.final_decision == null) {
    const passthrough = (policy: A2Policy): A2PolicyOutput => ({
      policy, decision: "SKIP", filter_fired: false, filter_reason: "NONE",
    });
    return {
      conflict: passthrough("A2_Conflict"),
      midband: passthrough("A2_MidBand"),
      combined: passthrough("A2_Combined"),
    };
  }

  const cFires = conflictFires(input);
  const mFires = midBandFires(input);

  const conflict: A2PolicyOutput = {
    policy: "A2_Conflict",
    decision: cFires ? "SKIP" : input.final_decision,
    filter_fired: cFires,
    filter_reason: cFires ? "OVERRIDE_LOGISTIC_CONFLICT" : "NONE",
  };

  const midband: A2PolicyOutput = {
    policy: "A2_MidBand",
    decision: mFires ? "SKIP" : input.final_decision,
    filter_fired: mFires,
    filter_reason: mFires ? "MID_CONFIDENCE_YES" : "NONE",
  };

  let combinedReason: FilterReason = "NONE";
  if (cFires && mFires) combinedReason = "BOTH";
  else if (cFires) combinedReason = "OVERRIDE_LOGISTIC_CONFLICT";
  else if (mFires) combinedReason = "MID_CONFIDENCE_YES";
  const combinedFired = cFires || mFires;
  const combined: A2PolicyOutput = {
    policy: "A2_Combined",
    decision: combinedFired ? "SKIP" : input.final_decision,
    filter_fired: combinedFired,
    filter_reason: combinedReason,
  };

  return { conflict, midband, combined };
}

/** True if we have enough inputs to evaluate A2 (fail-closed otherwise). */
export function a2InputsUsable(input: A2Input): boolean {
  return (
    input.base_decision != null &&
    input.final_decision != null &&
    input.probability_green != null &&
    typeof input.applied_override_reason === "string"
  );
}

export const A2_POLICIES: A2Policy[] = ["A2_Conflict", "A2_MidBand", "A2_Combined"];
