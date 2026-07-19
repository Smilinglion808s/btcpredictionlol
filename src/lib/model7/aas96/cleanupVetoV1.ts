// AAS96 — Cleanup Veto V1.1.0 (post-model abstention overlay).
// Active rule (v1.1.0): fires only when the dual H64/H192 conflict pattern
// is present against Layer B H96=GREEN, i.e. H64=RED & H96=GREEN & H192=RED.
// The prior H64-only ("recent_h64_conflict") and H192-only ("long_h192_conflict")
// single-horizon branches are disabled in v1.1.0. Historical v1.0.0 rows are
// preserved unchanged in the database — this module only controls new rows.
// Never reverses direction. Never re-labels an existing SKIP/ABSTAIN.

export const CLEANUP_VETO_V1_VERSION = "1.1.0";
export const CLEANUP_VETO_V1_REASON = "dual_h64_h192_conflict";

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

  // Diagnostic classification (H64/H192 only; H32 tracked, not gating).
  // Retained for tracking parity with prior versions, but only the dual
  // pattern actually triggers a veto in v1.1.0.
  let conflictSubtype: VetoEvaluation["conflictSubtype"] = null;
  if (evaluable) {
    if (h64 !== "GREEN" && h192 === "GREEN") conflictSubtype = "recent_h64_conflict";
    else if (h64 === "GREEN" && h192 !== "GREEN") conflictSubtype = "long_h192_conflict";
    else if (h64 !== "GREEN" && h192 !== "GREEN") conflictSubtype = "dual_h64_h192_conflict";
  }

  // v1.1.0 active trigger: dual H64/H192 conflict against H96=GREEN only.
  const fired = evaluable && h96 === "GREEN" && h64 !== "GREEN" && h192 !== "GREEN";

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
    pattern,
    publishedPrediction: published,
    publishedAbstainReason: publishedReason,
  };
}
