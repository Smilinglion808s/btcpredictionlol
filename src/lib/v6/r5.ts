// V6-r5 — Selective Core Router.
//
// This module NEVER touches the frozen V6 core: no feature formula, ridge
// coefficient, GB stump, calibration distribution, broad/anchor calculation,
// base threshold, canonical source, timing rule or resolution rule is read or
// changed here.
//
// r5 is a publication-architecture change only. The router is the SOLE live
// publication authority. All legacy r1..r4 layers keep running but are shadow
// only and may never alter the r5 decision.

import type { Direction } from "./inference";

export const V6_R5_MODEL_REVISION = "V6-r5-selective-core-router";
/** Actual deployment timestamp of V6-r5. Live results are never backdated. */
export const V6_R5_ACTIVATED_AT = "2026-08-11T03:00:00.000Z";
export const V6_R5_ROUTER_VERSION = "r5-router-v1";

/** Frozen r5 thresholds. Never tuned at runtime. */
export const R5_GREEN_STOCH_SPREAD_MAX = -0.08;
export const R5_GREEN_D1_MEAN_BODY_RANGE_MAX = 0.23;
export const R5_RED_ANCHOR_D1_CLOSE_POSITION_MAX = 0.3;
export const R5_RED_BROAD_CLOSE_SLOPE_MIN = -0.08;
export const R5_RED_BROAD_BB_WIDTH_MAX = 0.9;
export const R5_ALIGNED_WICK_RED_SHADOW_MIN = 0.2;

export const R5_GREEN_SOURCE = "V6_R5_GREEN_STOCH_PULLBACK";
export const R5_RED_ANCHOR_SOURCE = "V6_R5_RED_ANCHOR_CLOSE_CONTROL";
export const R5_RED_BROAD_SOURCE = "V6_R5_RED_BROAD_CONTROLLED_RANGE";
export const R5_ALIGNED_WICK_SHADOW_BRANCH = "R5_ALIGNED_WICK_RED_SHADOW";

export const R5_REASON_GREEN = "R5_GREEN_ROUTE";
export const R5_REASON_RED_ANCHOR = "R5_RED_ANCHOR_ROUTE";
export const R5_REASON_RED_BROAD = "R5_RED_BROAD_ROUTE";
export const R5_REASON_CONFLICT = "R5_ROUTER_CONFLICT";
export const R5_REASON_NO_ROUTE = "R5_NO_QUALIFIED_ROUTE";

/** Publication authority of every legacy layer under r5. */
export const LEGACY_PICKUP_PUBLICATION_ENABLED = false;
export const BROAD_CONFLICT_PUBLICATION_ENABLED = false;
export const BROAD_RED_RELIABILITY_PUBLICATION_ENABLED = false;
export const STRUCTURE_CONFIRMATION_PUBLICATION_ENABLED = false;
export const STRUCTURE_CONFIRMATION_SHADOW_ONLY = true;

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface R5RouterInputs {
  stoch_spread?: number | null;
  d1_mean_body_to_range_2?: number | null;
  d1_close_position_in_range?: number | null;
  close_slope_8?: number | null;
  bb_width_pct?: number | null;
  aligned_wick_pressure_4?: number | null;
}

export interface R5RouterResult {
  routerVersion: string;

  greenEvaluable: boolean;
  greenCandidate: boolean;
  greenStochSpread: number | null;
  greenStochCondition: boolean;
  greenD1MeanBodyToRange2: number | null;
  greenBodyCondition: boolean;

  redFeederEvaluable: boolean;
  redFeederPass: boolean;
  redFeederPrediction: string | null;
  redFeederSource: string | null;

  redAnchorEvaluable: boolean;
  redAnchorCandidate: boolean;
  redAnchorD1ClosePosition: number | null;
  redAnchorCondition: boolean;

  redBroadEvaluable: boolean;
  redBroadCandidate: boolean;
  redBroadCloseSlope8: number | null;
  redBroadSlopeCondition: boolean;
  redBroadBbWidthPct: number | null;
  redBroadBbCondition: boolean;

  redCandidate: boolean;
  conflict: boolean;
  decision: Direction;
  source: string;
  reason: string | null;

  wickShadowEvaluable: boolean;
  wickShadowCandidate: boolean;
  wickShadowValue: number | null;
}

/**
 * Evaluate the r5 Selective Core Router.
 *
 * `feederPrediction` / `feederSource` must be the existing frozen-core values
 * `prediction_after_weak_red_recovery` / `prediction_source_after_weak_red_recovery`.
 * Individual routes fail CLOSED on a missing or non-finite input; a route that
 * cannot be evaluated produces a strategic ABSTAIN, never an OP_FAIL.
 */
export function evaluateR5Router(
  feederPrediction: string | null | undefined,
  feederSource: string | null | undefined,
  selectedComponent: string | null | undefined,
  inputs: R5RouterInputs,
): R5RouterResult {
  // --- GREEN route: controlled stochastic pullback ---
  const stoch = finite(inputs.stoch_spread);
  const d1Body = finite(inputs.d1_mean_body_to_range_2);
  const greenEvaluable = stoch !== null && d1Body !== null;
  const greenStochCondition = stoch !== null && stoch <= R5_GREEN_STOCH_SPREAD_MAX;
  const greenBodyCondition = d1Body !== null && d1Body <= R5_GREEN_D1_MEAN_BODY_RANGE_MAX;
  const greenCandidate = greenEvaluable && greenStochCondition && greenBodyCondition;

  // --- RED feeder: only the existing V6_BASE weak-RED path may feed r5 ---
  const redFeederEvaluable =
    feederPrediction !== null && feederPrediction !== undefined &&
    feederSource !== null && feederSource !== undefined;
  const redFeederPass =
    redFeederEvaluable && feederPrediction === "RED" && feederSource === "V6_BASE";

  // --- Anchor RED route ---
  const d1Close = finite(inputs.d1_close_position_in_range);
  const redAnchorEvaluable = redFeederPass && selectedComponent === "ANCHOR" && d1Close !== null;
  const redAnchorCondition = d1Close !== null && d1Close <= R5_RED_ANCHOR_D1_CLOSE_POSITION_MAX;
  const redAnchorCandidate = redAnchorEvaluable && redAnchorCondition;

  // --- Broad RED route ---
  const slope = finite(inputs.close_slope_8);
  const bbWidth = finite(inputs.bb_width_pct);
  const redBroadEvaluable =
    redFeederPass && selectedComponent === "BROAD" && slope !== null && bbWidth !== null;
  const redBroadSlopeCondition = slope !== null && slope >= R5_RED_BROAD_CLOSE_SLOPE_MIN;
  const redBroadBbCondition = bbWidth !== null && bbWidth <= R5_RED_BROAD_BB_WIDTH_MAX;
  const redBroadCandidate = redBroadEvaluable && redBroadSlopeCondition && redBroadBbCondition;

  const redCandidate = redAnchorCandidate || redBroadCandidate;
  const conflict = greenCandidate && redCandidate;

  let decision: Direction = "ABSTAIN";
  let source = "ABSTAIN";
  let reason: string | null = R5_REASON_NO_ROUTE;

  if (greenCandidate && !redCandidate) {
    decision = "GREEN";
    source = R5_GREEN_SOURCE;
    reason = R5_REASON_GREEN;
  } else if (redCandidate && !greenCandidate) {
    decision = "RED";
    source = redAnchorCandidate ? R5_RED_ANCHOR_SOURCE : R5_RED_BROAD_SOURCE;
    reason = redAnchorCandidate ? R5_REASON_RED_ANCHOR : R5_REASON_RED_BROAD;
  } else if (conflict) {
    reason = R5_REASON_CONFLICT;
  }

  // --- Optional aligned-wick RED branch: SHADOW ONLY, never publishes ---
  const wick = finite(inputs.aligned_wick_pressure_4);
  const wickShadowEvaluable = wick !== null;
  const wickShadowCandidate = wick !== null && wick >= R5_ALIGNED_WICK_RED_SHADOW_MIN;

  return {
    routerVersion: V6_R5_ROUTER_VERSION,
    greenEvaluable,
    greenCandidate,
    greenStochSpread: stoch,
    greenStochCondition,
    greenD1MeanBodyToRange2: d1Body,
    greenBodyCondition,
    redFeederEvaluable,
    redFeederPass,
    redFeederPrediction: feederPrediction ?? null,
    redFeederSource: feederSource ?? null,
    redAnchorEvaluable,
    redAnchorCandidate,
    redAnchorD1ClosePosition: d1Close,
    redAnchorCondition,
    redBroadEvaluable,
    redBroadCandidate,
    redBroadCloseSlope8: slope,
    redBroadSlopeCondition,
    redBroadBbWidthPct: bbWidth,
    redBroadBbCondition,
    redCandidate,
    conflict,
    decision,
    source,
    reason,
    wickShadowEvaluable,
    wickShadowCandidate,
    wickShadowValue: wick,
  };
}

/** WIN / LOSS grading for a shadow branch against canonical ground truth. */
export function gradeBranch(
  candidate: boolean,
  direction: "GREEN" | "RED",
  actual: "GREEN" | "RED" | "PUSH" | null,
): { prediction: string | null; result: string | null; raw: number | null; adjusted: number | null } {
  if (!candidate || !actual) return { prediction: null, result: null, raw: null, adjusted: null };
  if (actual === "PUSH") return { prediction: direction, result: "PUSH", raw: null, adjusted: null };
  const win = direction === actual;
  return {
    prediction: direction,
    result: win ? "WIN" : "LOSS",
    raw: win ? 1 : -1,
    adjusted: win ? 0.8 : -1,
  };
}
