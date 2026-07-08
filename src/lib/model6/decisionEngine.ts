// Pure decision engine. Applies the 16-step order.
import type { Features } from "./featureEngine";
import type { Scores } from "./scoringEngine";
import { neutralizeStandaloneRegime } from "./scoringEngine";
import {
  MARGIN_NCE, MARGIN_LOW, MARGIN_STANDARD, MARGIN_PREMIUM,
  TRADE_MIN_MARGIN, TRADE_MIN_CONFIDENCE,
  CONF_BASE, CONF_MARGIN_MULT, CONF_MARGIN_CAP, CONF_MAX,
  CAP_FALLBACK, CAP_TRUE_MID, CAP_NEAR_VWAP_NO_EVENT, CAP_COMPRESSED_NO_OVERRIDE,
  CAP_EDGE_NO_CONFIRM, CAP_VWAP_ATR_CONFLICT, CAP_SOFT_VETO, CAP_DEGRADED,
  CAP_CONTINUATION, CAP_STRUCTURE_CONFLICT, CAP_CHANNEL_EDGE_WEAK, HARD_OVERRIDE_FLOOR,
  EXPANSION_EXPANDING, CLOSE_UPPER_35, CLOSE_LOWER_35, WICK_35,
} from "./config";

export type Prediction = "YES" | "NO" | "NO CLEAR EDGE";
export type SetupType = "no_clear_edge" | "low_confidence" | "standard" | "strong" | "premium";
export type TradeStatus = "TRADE" | "AVOID";
export type Agreement = "agree" | "disagree" | "neutral" | "nce" | "missing";

export interface RecentPredictionCtx {
  prev_prediction: Prediction | null;
  prev_status: "win" | "loss" | "push" | null;
  prev_setup_type: SetupType | null;
  prev_was_fallback: boolean;
  last5_losses: number;
  last2_losses: number;
  same_direction_loss_streak: number;
}

export interface Decision {
  prediction: Prediction;
  base_prediction: Prediction;
  confidence: number;
  setup_type: SetupType;
  final_trade_status: TradeStatus;
  partial_agreement: Agreement;
  agreement_gate_applied: boolean;
  agreement_gate_reason: string;
  hard_override_fired: boolean;
  partial_hard_override_fired: boolean;
  partial_veto_active: boolean;
  partial_veto_tier: "hard" | "soft" | "none";
  partial_veto_direction: null | "blocked_yes" | "blocked_no";
  guards_applied: string[];
  caps_applied: string[];
  change_reason: string | null;
  changed_by_partial: boolean;
  original_prediction_before_partial: Prediction;
}

const bounded = (n: number, min: number, max: number) => Math.max(min, Math.min(max, n));

export function makeDecision(f: Features, sc: Scores, ctx: RecentPredictionCtx): Decision {
  neutralizeStandaloneRegime(sc.module_points);
  const bull = Object.values(sc.module_points).reduce((s, x) => s + x.bull, 0);
  const bear = Object.values(sc.module_points).reduce((s, x) => s + x.bear, 0);
  const margin = Math.abs(bull - bear);
  const dominant: "YES" | "NO" | "NONE" = bull > bear ? "YES" : bear > bull ? "NO" : "NONE";

  const guards: string[] = [];
  const caps: string[] = [];
  const l = f.last, pc = f.partial;

  // Step 1 — base
  let prediction: Prediction = margin < MARGIN_NCE ? "NO CLEAR EDGE" : dominant === "NONE" ? "NO CLEAR EDGE" : (dominant as Prediction);
  const base_prediction: Prediction = prediction;
  const original_before_partial: Prediction = prediction;

  // Step 2 — hard overrides (completed candle)
  const expansionOk = f.atr_range_expansion_ratio >= EXPANSION_EXPANDING;
  const hardYes =
    (f.channel_breakout_confirmed && f.vwap != null && l.close > f.vwap && expansionOk)
    || (f.vwap_reclaim && l.close_position_pct >= CLOSE_UPPER_35 && expansionOk)
    || (f.failed_breakout_down && l.lower_wick_pct >= WICK_35 && l.close_position_pct >= CLOSE_UPPER_35)
    || (f.acceptance_break_up && expansionOk);
  const hardNo =
    (f.channel_breakdown_confirmed && f.vwap != null && l.close < f.vwap && expansionOk)
    || (f.vwap_loss && l.close_position_pct <= CLOSE_LOWER_35 && expansionOk)
    || (f.failed_breakout_up && l.upper_wick_pct >= WICK_35 && l.close_position_pct <= CLOSE_LOWER_35)
    || (f.acceptance_break_down && expansionOk);
  let hardOverride = false;
  if (hardYes && !hardNo) { prediction = "YES"; hardOverride = true; guards.push("hard_override_yes"); }
  else if (hardNo && !hardYes) { prediction = "NO"; hardOverride = true; guards.push("hard_override_no"); }

  // Step 3 — partial hard overrides (need completeness>=0.80)
  let partialHardOverride = false;
  if (pc.present && pc.completeness >= 0.80) {
    if (pc.vwap_event === "reclaim" && (pc.close_position_pct ?? 0) >= 0.65) {
      prediction = "YES"; partialHardOverride = true; guards.push("partial_hard_yes");
    } else if (pc.vwap_event === "loss" && (pc.close_position_pct ?? 1) <= 0.35) {
      prediction = "NO"; partialHardOverride = true; guards.push("partial_hard_no");
    }
  }

  // Step 4 — partial veto
  let vetoTier: "hard" | "soft" | "none" = "none";
  let vetoDir: null | "blocked_yes" | "blocked_no" = null;
  let vetoActive = false;
  let softVetoCap = false;
  if (pc.present && prediction !== "NO CLEAR EDGE") {
    const cp = pc.close_position_pct ?? 0.5;
    const rva = pc.range_vs_atr ?? 0;
    const oppYes = prediction === "YES" && pc.direction === "red";
    const oppNo = prediction === "NO" && pc.direction === "green";
    const vwapConfirmsOpp =
      (prediction === "YES" && (pc.vwap_event === "loss" || f.below_vwap))
      || (prediction === "NO" && (pc.vwap_event === "reclaim" || f.above_vwap));
    if ((oppYes || oppNo) && rva >= 1.0 && vwapConfirmsOpp
      && ((prediction === "YES" && cp <= 0.20) || (prediction === "NO" && cp >= 0.80))) {
      vetoTier = "hard";
      vetoDir = prediction === "YES" ? "blocked_yes" : "blocked_no";
      vetoActive = true;
      prediction = "NO CLEAR EDGE";
      guards.push("partial_hard_veto");
    } else if ((oppYes || oppNo) && rva >= 0.6
      && ((prediction === "YES" && cp <= 0.30) || (prediction === "NO" && cp >= 0.70))) {
      vetoTier = "soft";
      vetoDir = prediction === "YES" ? "blocked_yes" : "blocked_no";
      vetoActive = true;
      softVetoCap = true;
      guards.push("partial_soft_veto");
    }
  }

  // Step 5 — Fresh YES requirement
  let downgraded = false;
  if (prediction === "YES" && !hardOverride && !partialHardOverride) {
    const conds = [
      l.upper_35_close,
      f.last_3_positive,
      f.last_8_positive,
      f.vwap_reclaim && l.close > (f.vwap ?? -Infinity),
      f.bullish_liquidity_sweep || f.channel_support_bounce,
      f.failed_breakout_down,
      f.room_to_resistance_pct > 0.35,
      f.channel_support_bounce || f.near_support,
      l.lower_wick_pct >= WICK_35,
    ];
    const count = conds.filter(Boolean).length;
    if (count < 2) {
      guards.push("fresh_yes_downgrade");
      if (margin < MARGIN_LOW) { prediction = "NO CLEAR EDGE"; }
      else { downgraded = true; }
    }
  }

  // Step 6 — NO-in-bullish-structure
  if (prediction === "NO" && f.bullish_structure && !hardOverride && !partialHardOverride) {
    const conds = [
      l.lower_35_close,
      f.last_3_negative,
      f.failed_breakout_up,
      f.channel_resistance_rejection,
      l.close < f.range20_low,
      f.near_resistance && l.red,
      l.upper_wick_pct >= WICK_35,
      f.channel_breakdown_confirmed,
    ];
    if (!conds.some(Boolean)) {
      guards.push("no_in_bullish_structure_downgrade");
      prediction = "NO CLEAR EDGE";
    }
  }

  // Step 7 — Channel edge blocks
  let edgeBlockWeakYes = false;
  let edgeBlockWeakNo = false;
  let trueMidCap = false;
  if (f.fib_zone === "support_edge" && prediction === "NO" && !f.channel_breakdown_confirmed && !hardOverride) {
    edgeBlockWeakNo = true; caps.push("channel_edge_block_no");
  }
  if (f.fib_zone === "resistance_edge" && prediction === "YES" && !f.channel_breakout_confirmed && !hardOverride) {
    edgeBlockWeakYes = true; caps.push("channel_edge_block_yes");
  }
  if (f.fib_zone === "true_mid") {
    trueMidCap = true; caps.push("true_mid_cap");
    if (prediction !== "NO CLEAR EDGE") {
      const agree = prediction === "YES"
        ? (l.close_position_pct >= 0.5 && f.last_3_positive)
        : (l.close_position_pct <= 0.5 && f.last_3_negative);
      if (!agree) { prediction = "NO CLEAR EDGE"; guards.push("true_mid_no_agreement"); }
    }
  }

  // Step 8 — Continuation guard
  let continuationCap = false;
  if (ctx.prev_prediction && ctx.prev_status === "loss" && prediction === ctx.prev_prediction) {
    const freshEvidence = prediction === "YES"
      ? (l.close_position_pct >= CLOSE_UPPER_35 || f.last_3_positive || f.channel_support_bounce
        || f.failed_breakout_down || f.vwap_reclaim || f.repeated_support_defense)
      : (l.close_position_pct <= CLOSE_LOWER_35 || f.last_3_negative || f.channel_resistance_rejection
        || f.failed_breakout_up || f.vwap_loss || f.repeated_resistance_rejection);
    if (!freshEvidence) { continuationCap = true; caps.push("continuation_guard_cap"); }
  }

  // Step 9 — Whipsaw guard
  if (ctx.prev_was_fallback && ctx.prev_status === "loss" && ctx.prev_prediction
    && prediction !== "NO CLEAR EDGE" && prediction !== ctx.prev_prediction && !hardOverride) {
    const partialAllows = pc.present && pc.completeness >= 0.8 && (pc.range_vs_atr ?? 0) >= 0.75
      && ((prediction === "YES" && pc.direction === "green")
        || (prediction === "NO" && pc.direction === "red"));
    if (!partialAllows) { prediction = "NO CLEAR EDGE"; guards.push("whipsaw_guard"); }
  }

  // Step 10 — Loss streak control
  let lossStreakCap = false;
  if (ctx.last2_losses >= 2 && prediction !== "NO CLEAR EDGE") {
    const confirming = f.vwap_reclaim || f.vwap_loss || f.atr_range_expansion_ratio >= EXPANSION_EXPANDING
      || f.failed_breakout_up || f.failed_breakout_down
      || f.channel_breakout_confirmed || f.channel_breakdown_confirmed;
    if (margin < MARGIN_LOW || !confirming) {
      lossStreakCap = true; caps.push("loss_streak_cap");
    }
    if (ctx.same_direction_loss_streak >= 2 && prediction === ctx.prev_prediction) {
      const structural = confirming || hardOverride;
      if (!structural) { prediction = "NO CLEAR EDGE"; guards.push("same_dir_loss_block"); }
    }
  }
  if (ctx.last5_losses >= 3 && !hardOverride && prediction !== "NO CLEAR EDGE") {
    prediction = "NO CLEAR EDGE"; guards.push("three_in_five_only_hard");
  }

  // Step 11 — Directional fallback
  let fallback = false;
  if (prediction === "NO CLEAR EDGE" && margin >= 5 && dominant !== "NONE"
    && !(f.fib_zone === "support_edge" && dominant === "NO")
    && !(f.fib_zone === "resistance_edge" && dominant === "YES")) {
    const closeContradicts =
      (dominant === "YES" && l.close_position_pct <= CLOSE_LOWER_35)
      || (dominant === "NO" && l.close_position_pct >= CLOSE_UPPER_35);
    if (!closeContradicts) {
      prediction = dominant as Prediction;
      fallback = true;
      guards.push("directional_fallback");
    }
  }

  // Step 12 — Confidence
  let confidence = CONF_BASE + Math.min(CONF_MARGIN_CAP, margin * CONF_MARGIN_MULT);
  confidence = Math.min(CONF_MAX, confidence);

  const applyCap = (cap: number, tag: string) => {
    if (confidence > cap) { confidence = cap; caps.push(tag); }
  };
  if (fallback || downgraded) applyCap(CAP_FALLBACK, "fallback_cap");
  if (trueMidCap) applyCap(CAP_TRUE_MID, "true_mid_conf_cap");
  if (f.near_vwap && !f.vwap_reclaim && !f.vwap_loss) applyCap(CAP_NEAR_VWAP_NO_EVENT, "near_vwap_no_event");
  if (f.atr_state === "compressed" && !hardOverride) applyCap(CAP_COMPRESSED_NO_OVERRIDE, "compressed_no_override");
  if (edgeBlockWeakYes) applyCap(CAP_EDGE_NO_CONFIRM, "yes_at_resistance_edge");
  if (edgeBlockWeakNo) applyCap(CAP_EDGE_NO_CONFIRM, "no_at_support_edge");
  if (softVetoCap) applyCap(CAP_SOFT_VETO, "partial_soft_veto");
  if (pc.degraded_mode) applyCap(CAP_DEGRADED, "partial_degraded");
  if (continuationCap) applyCap(CAP_CONTINUATION, "continuation_guard");
  if (lossStreakCap) applyCap(CAP_CHANNEL_EDGE_WEAK, "loss_streak_cap");
  // vwap/ATR conflict: prediction disagrees with vwap side while ATR is expanding
  if (prediction === "YES" && f.below_vwap && f.atr_state !== "compressed") applyCap(CAP_VWAP_ATR_CONFLICT, "vwap_atr_conflict");
  if (prediction === "NO" && f.above_vwap && f.atr_state !== "compressed") applyCap(CAP_VWAP_ATR_CONFLICT, "vwap_atr_conflict");
  // Structure conflict
  if (prediction === "YES" && f.bearish_structure && !f.bullish_structure) applyCap(CAP_STRUCTURE_CONFLICT, "structure_conflict");
  if (prediction === "NO" && f.bullish_structure && !f.bearish_structure) applyCap(CAP_STRUCTURE_CONFLICT, "structure_conflict");
  if (hardOverride && confidence < HARD_OVERRIDE_FLOOR) confidence = HARD_OVERRIDE_FLOOR;

  // 70+ requires margin>=18 AND hard override AND vwap confirms AND expansion>=1.15 AND close location confirms
  const vwapConfirmsPred =
    prediction === "YES" ? (f.above_vwap || f.vwap_reclaim)
    : prediction === "NO" ? (f.below_vwap || f.vwap_loss)
    : false;
  const closeConfirmsPred =
    prediction === "YES" ? l.close_position_pct >= CLOSE_UPPER_35
    : prediction === "NO" ? l.close_position_pct <= CLOSE_LOWER_35
    : false;
  const highConfEligible = margin >= 18 && hardOverride && vwapConfirmsPred && expansionOk && closeConfirmsPred;
  if (confidence >= 70 && !highConfEligible) { confidence = 69; caps.push("high_conf_gate"); }

  confidence = Math.round(bounded(confidence, 0, CONF_MAX));
  if (prediction === "NO CLEAR EDGE") confidence = Math.min(confidence, 45);

  // Step 13 — Agreement gate
  let partial_agreement: Agreement =
    prediction === "NO CLEAR EDGE" ? "nce"
    : !pc.present ? "missing"
    : pc.direction === "flat" ? "neutral"
    : (pc.direction === "green" && prediction === "YES") || (pc.direction === "red" && prediction === "NO") ? "agree"
    : "disagree";

  // Step 14 — setup type from FINAL margin
  const setup_type: SetupType =
    margin < MARGIN_NCE || prediction === "NO CLEAR EDGE" ? "no_clear_edge"
    : margin < MARGIN_LOW ? "low_confidence"
    : margin < MARGIN_STANDARD ? "standard"
    : margin < MARGIN_PREMIUM ? "strong"
    : "premium";

  let trade_status: TradeStatus = "AVOID";
  let gate_applied = false;
  let gate_reason = "n/a_nce";
  if (prediction === "NO CLEAR EDGE") {
    gate_reason = "n/a_nce";
  } else if (partial_agreement === "disagree") {
    gate_applied = true; gate_reason = "disagree";
  } else if (setup_type === "strong" || setup_type === "premium") {
    if (partial_agreement !== "agree") {
      gate_applied = true;
      gate_reason = setup_type === "premium" ? "premium_requires_agree" : "strong_requires_agree";
    } else {
      gate_reason = "pass";
    }
  } else {
    gate_reason = "pass";
  }
  const meetsTradeCriteria =
    prediction !== "NO CLEAR EDGE"
    && confidence >= TRADE_MIN_CONFIDENCE
    && margin >= TRADE_MIN_MARGIN
    && partial_agreement !== "disagree"
    && !(setup_type === "strong" || setup_type === "premium" ? partial_agreement !== "agree" : false)
    && !fallback;
  if (meetsTradeCriteria) trade_status = "TRADE";

  const changed_by_partial =
    partialHardOverride || vetoActive
    || (original_before_partial !== prediction && (vetoActive || partialHardOverride));
  const change_reason = partialHardOverride
    ? (guards.includes("partial_hard_yes") ? "partial_hard_yes" : "partial_hard_no")
    : vetoTier !== "none" ? `partial_${vetoTier}_veto`
    : null;

  return {
    prediction, base_prediction, confidence, setup_type,
    final_trade_status: trade_status,
    partial_agreement,
    agreement_gate_applied: gate_applied,
    agreement_gate_reason: gate_reason,
    hard_override_fired: hardOverride,
    partial_hard_override_fired: partialHardOverride,
    partial_veto_active: vetoActive,
    partial_veto_tier: vetoTier,
    partial_veto_direction: vetoDir,
    guards_applied: guards,
    caps_applied: caps,
    change_reason,
    changed_by_partial,
    original_prediction_before_partial: original_before_partial,
  };
}
