// AAS96 — Cleanup Veto V1 (post-model abstention overlay).
// Frozen rule: if Layer B H96=GREEN and either H64 or H192 is not GREEN,
// convert an otherwise actionable baseline prediction to ABSTAIN.
// Never reverses direction. Never re-labels an existing SKIP/ABSTAIN.

export const CLEANUP_VETO_V1_VERSION = "1.0.0";
export const CLEANUP_VETO_V1_REASON = "b96_green_horizon_conflict";

type Horizon = "GREEN" | "RED" | null | undefined;
type Baseline = "GREEN" | "RED" | "SKIP" | "ABSTAIN" | string | null | undefined;

export interface VetoEvaluation {
  version: string;
  evaluable: boolean;
  fired: boolean;
  reason: string | null;
  conflictSubtype: "recent_h64_conflict" | "long_h192_conflict" | "dual_h64_h192_conflict" | null;
  pattern: string | null; // H32/H64/H96/H192 e.g. "GGGR"
  publishedPrediction: string;      // GREEN | RED | SKIP | ABSTAIN
  publishedAbstainReason: string | null;
}

function letter(d: Horizon): string {
  return d === "GREEN" ? "G" : d === "RED" ? "R" : "?";
}

export function evaluateCleanupVetoV1(args: {
  baselinePrediction: Baseline;
  baselineAbstainReason: string | null;
  h32: Horizon; h64: Horizon; h96: Horizon; h192: Horizon;
}): VetoEvaluation {
  const { baselinePrediction, baselineAbstainReason, h32, h64, h96, h192 } = args;

  const pattern = `${letter(h32)}${letter(h64)}${letter(h96)}${letter(h192)}`;
  const evaluable = (h64 === "GREEN" || h64 === "RED")
    && (h96 === "GREEN" || h96 === "RED")
    && (h192 === "GREEN" || h192 === "RED");

  // Frozen conflict subtype classification (H64/H192 only; H32 tracked, not gating).
  let conflictSubtype: VetoEvaluation["conflictSubtype"] = null;
  if (evaluable) {
    if (h64 !== "GREEN" && h192 === "GREEN") conflictSubtype = "recent_h64_conflict";
    else if (h64 === "GREEN" && h192 !== "GREEN") conflictSubtype = "long_h192_conflict";
    else if (h64 !== "GREEN" && h192 !== "GREEN") conflictSubtype = "dual_h64_h192_conflict";
  }

  const fired = evaluable && h96 === "GREEN" && (h64 !== "GREEN" || h192 !== "GREEN");

  // Preserve any existing non-actionable baseline as-is.
  const isActionable = baselinePrediction === "GREEN" || baselinePrediction === "RED";
  let published: string = String(baselinePrediction ?? "SKIP");
  let publishedReason: string | null = baselineAbstainReason;

  if (fired && isActionable) {
    published = "ABSTAIN";
    publishedReason = CLEANUP_VETO_V1_REASON;
  }

  return {
    version: CLEANUP_VETO_V1_VERSION,
    evaluable,
    fired: !!fired,
    reason: fired ? CLEANUP_VETO_V1_REASON : null,
    conflictSubtype,
    pattern: pattern.includes("?") && !evaluable ? pattern : pattern,
    publishedPrediction: published,
    publishedAbstainReason: publishedReason,
  };
}
