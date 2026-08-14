// V6-r6 — Promotion Router.
//
// This module NEVER touches the frozen V6 core or the V6-r5 Selective Core
// Router: no feature formula, ridge coefficient, GB stump, calibration
// distribution, broad/anchor calculation, base threshold, r5 threshold, RED
// feeder rule or r5 conflict rule is read or changed here.
//
// r6 is additive only. It may publish a direction ONLY when the unbraked r5
// router abstains. It can never flip, veto or downgrade an existing r5
// directional publication. There is NO time-of-day rule, session filter,
// daily stop, cooldown, emergency cap or dynamic tuning of any kind.

import type { Direction } from "./inference";

export const V6_R6_MODEL_REVISION = "V6-r6-promotion-router";
/** Actual deployment timestamp of V6-r6. Live results are never backdated. */
export const V6_R6_ACTIVATED_AT = "2026-08-14T03:30:00.000Z";
export const V6_R6_ROUTER_VERSION = "r6-promotion-router-v1";

/** The r5.1 route drawdown brake is demoted to shadow-only under r6. */
export const R5_ROUTE_BRAKE_SHADOW_ONLY = true;
export const R5_ROUTE_BRAKE_PUBLICATION_ENABLED = false;

/** Frozen r6 promotion thresholds. Never tuned at runtime. */
export const R6_P1_PATH_EFFICIENCY_MIN = 0.815;
export const R6_P1_MOMENTUM8_ATR_MAX = 0.867;
export const R6_P2_ROC8_MIN = 0.131;
export const R6_P2_VOLUME_EXPANSION_MAX = 0.359;
export const R6_P3_CHANNEL_POSITION_MAX = 0.109;
export const R6_P3_CHANGE_PCT_MIN = -0.038;
export const R6_P4_MEAN_BODY_RANGE_MAX = 0.383;
export const R6_P4_MACD_HIST_ATR_MIN = 0.197;
export const R6_P5_DIST_LOW20_MAX = 0.605;
export const R6_P5_CHANGE_PCT_MIN = 0.152;
export const R6_P6_PATH_EFFICIENCY_MIN = 0.815;
export const R6_P6_MEAN_BODY_RANGE_MAX = 0.319;

export const R6_RULE_P1 = "P1_GREEN_EFFICIENCY_MOMENTUM";
export const R6_RULE_P2 = "P2_RED_ROC_LOW_VOLUME";
export const R6_RULE_P3 = "P3_GREEN_CHANNEL_LOW";
export const R6_RULE_P4 = "P4_RED_MACD_BODY";
export const R6_RULE_P5 = "P5_GREEN_LOW20_RECOVERY";
export const R6_RULE_P6 = "P6_GREEN_EFFICIENCY_BODY";

export const R6_PROMOTION_SOURCE = "V6_R6_PROMOTION_ROUTER";
export const R6_REASON_KEEP_R5 = "R6_KEEP_R5_DIRECTION";
export const R6_REASON_GREEN = "R6_GREEN_PROMOTION";
export const R6_REASON_RED = "R6_RED_PROMOTION";
export const R6_REASON_CONFLICT = "R6_PROMOTION_CONFLICT";
export const R6_REASON_NO_PROMOTION = "R6_NO_PROMOTION";

function finite(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

export interface R6PromotionInputs {
  path_efficiency_4?: number | null;
  momentum_8_over_atr?: number | null;
  roc_8?: number | null;
  volume_expansion?: number | null;
  channel_position_0_1?: number | null;
  change_pct?: number | null;
  mean_body_to_range_2?: number | null;
  macd_hist_over_atr14?: number | null;
  dist_to_low20_pct?: number | null;
}

export interface R6RuleEval {
  code: string;
  direction: "GREEN" | "RED";
  evaluable: boolean;
  candidate: boolean;
  /** [value, threshold, condition] triples in declaration order. */
  a: { value: number | null; threshold: number; pass: boolean };
  b: { value: number | null; threshold: number; pass: boolean };
}

export interface R6RouterResult {
  routerVersion: string;
  baseDirectional: boolean;
  p1: R6RuleEval;
  p2: R6RuleEval;
  p3: R6RuleEval;
  p4: R6RuleEval;
  p5: R6RuleEval;
  p6: R6RuleEval;
  greenCandidate: boolean;
  redCandidate: boolean;
  greenRuleCount: number;
  redRuleCount: number;
  greenRulesTriggered: string[];
  redRulesTriggered: string[];
  conflict: boolean;
  primaryRule: string | null;
  allRules: string[];
  promoted: boolean;
  prediction: Direction;
  source: string;
  reason: string;
}

function rule(
  code: string,
  direction: "GREEN" | "RED",
  aValue: number | null,
  aThreshold: number,
  aPass: boolean,
  bValue: number | null,
  bThreshold: number,
  bPass: boolean,
): R6RuleEval {
  const evaluable = aValue !== null && bValue !== null;
  return {
    code,
    direction,
    evaluable,
    candidate: evaluable && aPass && bPass,
    a: { value: aValue, threshold: aThreshold, pass: aPass },
    b: { value: bValue, threshold: bThreshold, pass: bPass },
  };
}

/** Evaluate the six frozen promotion rules. Each fails CLOSED independently. */
export function evaluatePromotionRules(inputs: R6PromotionInputs) {
  const pathEff = finite(inputs.path_efficiency_4);
  const mom8 = finite(inputs.momentum_8_over_atr);
  const roc8 = finite(inputs.roc_8);
  const volExp = finite(inputs.volume_expansion);
  const chanPos = finite(inputs.channel_position_0_1);
  const changePct = finite(inputs.change_pct);
  const body2 = finite(inputs.mean_body_to_range_2);
  const macd = finite(inputs.macd_hist_over_atr14);
  const distLow20 = finite(inputs.dist_to_low20_pct);

  const p1 = rule(
    R6_RULE_P1, "GREEN",
    pathEff, R6_P1_PATH_EFFICIENCY_MIN, pathEff !== null && pathEff >= R6_P1_PATH_EFFICIENCY_MIN,
    mom8, R6_P1_MOMENTUM8_ATR_MAX, mom8 !== null && mom8 <= R6_P1_MOMENTUM8_ATR_MAX,
  );
  const p2 = rule(
    R6_RULE_P2, "RED",
    roc8, R6_P2_ROC8_MIN, roc8 !== null && roc8 >= R6_P2_ROC8_MIN,
    volExp, R6_P2_VOLUME_EXPANSION_MAX, volExp !== null && volExp <= R6_P2_VOLUME_EXPANSION_MAX,
  );
  const p3 = rule(
    R6_RULE_P3, "GREEN",
    chanPos, R6_P3_CHANNEL_POSITION_MAX, chanPos !== null && chanPos <= R6_P3_CHANNEL_POSITION_MAX,
    changePct, R6_P3_CHANGE_PCT_MIN, changePct !== null && changePct >= R6_P3_CHANGE_PCT_MIN,
  );
  const p4 = rule(
    R6_RULE_P4, "RED",
    body2, R6_P4_MEAN_BODY_RANGE_MAX, body2 !== null && body2 <= R6_P4_MEAN_BODY_RANGE_MAX,
    macd, R6_P4_MACD_HIST_ATR_MIN, macd !== null && macd >= R6_P4_MACD_HIST_ATR_MIN,
  );
  const p5 = rule(
    R6_RULE_P5, "GREEN",
    distLow20, R6_P5_DIST_LOW20_MAX, distLow20 !== null && distLow20 <= R6_P5_DIST_LOW20_MAX,
    changePct, R6_P5_CHANGE_PCT_MIN, changePct !== null && changePct >= R6_P5_CHANGE_PCT_MIN,
  );
  const p6 = rule(
    R6_RULE_P6, "GREEN",
    pathEff, R6_P6_PATH_EFFICIENCY_MIN, pathEff !== null && pathEff >= R6_P6_PATH_EFFICIENCY_MIN,
    body2, R6_P6_MEAN_BODY_RANGE_MAX, body2 !== null && body2 <= R6_P6_MEAN_BODY_RANGE_MAX,
  );

  return { p1, p2, p3, p4, p5, p6 };
}

/**
 * Apply the r6 promotion router on top of the UNBRAKED r5 router result.
 *
 * `baseDecision` / `baseSource` / `baseReason` must be the original r5 router
 * publication, before any r5.1 route brake (which is shadow-only under r6).
 */
export function applyPromotionRouter(
  baseDecision: Direction,
  baseSource: string,
  baseReason: string | null,
  inputs: R6PromotionInputs,
): R6RouterResult {
  const { p1, p2, p3, p4, p5, p6 } = evaluatePromotionRules(inputs);

  const greenRules = [p1, p3, p5, p6].filter((r) => r.candidate).map((r) => r.code);
  const redRules = [p2, p4].filter((r) => r.candidate).map((r) => r.code);
  const greenCandidate = greenRules.length > 0;
  const redCandidate = redRules.length > 0;
  const conflictCandidates = greenCandidate && redCandidate;

  const baseDirectional = baseDecision === "GREEN" || baseDecision === "RED";

  let prediction: Direction = "ABSTAIN";
  let source = "ABSTAIN";
  let reason = R6_REASON_NO_PROMOTION;
  let promoted = false;
  let conflict = false;

  if (baseDirectional) {
    prediction = baseDecision;
    source = baseSource;
    reason = R6_REASON_KEEP_R5;
  } else if (greenCandidate && !redCandidate) {
    prediction = "GREEN";
    source = R6_PROMOTION_SOURCE;
    reason = R6_REASON_GREEN;
    promoted = true;
  } else if (redCandidate && !greenCandidate) {
    prediction = "RED";
    source = R6_PROMOTION_SOURCE;
    reason = R6_REASON_RED;
    promoted = true;
  } else if (conflictCandidates) {
    reason = R6_REASON_CONFLICT;
    conflict = true;
  }

  // Reporting-only attribution priority. It never affects publication.
  const primaryRule = promoted
    ? (prediction === "GREEN" ? greenRules[0] ?? null : redRules[0] ?? null)
    : null;

  return {
    routerVersion: V6_R6_ROUTER_VERSION,
    baseDirectional,
    p1, p2, p3, p4, p5, p6,
    greenCandidate,
    redCandidate,
    greenRuleCount: greenRules.length,
    redRuleCount: redRules.length,
    greenRulesTriggered: greenRules,
    redRulesTriggered: redRules,
    conflict,
    primaryRule,
    allRules: [...greenRules, ...redRules],
    promoted,
    prediction,
    source,
    reason,
    baseReasonEcho: baseReason,
  } as R6RouterResult;
}

/**
 * Incremental contribution of a promotion versus the original r5 ABSTAIN.
 * A conflict remains ABSTAIN and contributes exactly zero.
 */
export function promotionContribution(
  promoted: boolean,
  published: Direction,
  actual: "GREEN" | "RED" | "PUSH" | null,
): { result: string | null; raw: number; adjusted: number } {
  if (!promoted || !actual || (published !== "GREEN" && published !== "RED")) {
    return { result: null, raw: 0, adjusted: 0 };
  }
  if (actual === "PUSH") return { result: "PUSH", raw: 0, adjusted: 0 };
  const win = published === actual;
  return { result: win ? "WIN" : "LOSS", raw: win ? 1 : -1, adjusted: win ? 0.8 : -1 };
}
