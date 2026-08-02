// Pure deterministic a96-r4 decision logic.
//
// r4 = r3 architecture with the Layer A margin-band gate REMOVED and three
// structural / momentum vetoes ADDED.
//
// Active first-match decision order:
//   1. Input / feature-history validity → ABSTAIN_R4_FEATURE_HISTORY_INVALID
//   2. Layer A probability validity     → ABSTAIN_LAYER_A_PROBABILITY_INVALID
//   3. Four-candle efficiency in [0.25, 0.40)
//                                       → ABSTAIN_FOUR_CANDLE_EFFICIENCY_TOXIC_BAND
//   4. r3 agreement veto (only when A == B, unchanged)
//   5. meanTwoBodyToRange > 0.65        → ABSTAIN_TWO_CANDLE_BODY_CONCENTRATION_HIGH
//   6. alignedWickPressure > 0.20       → ABSTAIN_FOUR_CANDLE_WICK_PRESSURE_HIGH
//   7. alignedMacdHistAtr > 0.17        → ABSTAIN_MACD_MOMENTUM_OVEREXTENDED
//   8. Publish Layer A
//
// The legacy margin band is still computed and recorded (legacy_margin_condition,
// legacy_margin_outside_band, margin_band_eligible) but never gates publication:
// margin_veto_fired is always false for r4.

import { A96_CONFIG } from "./config";
import {
  agreementFeatures,
  fourCandleEfficiency,
  meanTwoCandleBodyToRange,
  fourCandleAlignedWickPressure,
  alignedMacdHistAtr,
  CandleHistoryError,
} from "./features";
import type { A96FeatureValues, Candle, Decision, Direction, FitState, Layer, R3Counterfactual } from "./types";

function snapshot(s: FitState) {
  return { ...s, net_gap_a_minus_b: s.layer_a_net - s.layer_b_net };
}

function emptyFeatures(): A96FeatureValues {
  return {
    distance_from_4_candle_low_bps: null,
    mean_2_candle_body_to_range: null,
    distance_veto_condition: false,
    body_ratio_veto_condition: false,
    four_candle_net_displacement: null,
    four_candle_total_body_path: null,
    four_candle_path_efficiency: null,
    efficiency_veto_condition: false,
    body_to_range_t15: null,
    body_to_range_t30: null,
    body_concentration_condition: false,
    raw_wick_pressures: null,
    aligned_wick_pressures: null,
    direction_sign: null,
    four_candle_aligned_wick_pressure: null,
    wick_pressure_condition: false,
    prior_macd_hist: null,
    prior_atr14: null,
    aligned_macd_hist_atr: null,
    macd_veto_condition: false,
  };
}

export interface A96DecideArgs {
  layerADirection: "GREEN" | "RED";
  layerBDirection: "GREEN" | "RED";
  layerAProbMean: number | null | undefined;
  baseSelectedLayer: Layer;
  fitState: FitState;
  targetTimestamp: Date;
  targetOpen: number;
  priorCandles: Candle[];
  /** MACD histogram + ATR14 belonging to the confirmed T-15m candle. */
  technical?: { macd_hist: number | null; atr14: number | null; source_ts: Date | null } | null;
}

export function a96Decide(args: A96DecideArgs): Decision {
  const {
    layerADirection: a, layerBDirection: b,
    layerAProbMean, fitState, targetTimestamp, targetOpen, priorCandles,
  } = args;
  const snap = snapshot(fitState);
  const fv = emptyFeatures();

  const p = layerAProbMean == null ? NaN : Number(layerAProbMean);
  const probValid = Number.isFinite(p) && p >= 0 && p <= 1;
  const margin = probValid ? Math.abs(p - 0.5) : null;
  const legacyCondition =
    margin != null &&
    margin >= A96_CONFIG.legacy_margin_min_inclusive &&
    margin < A96_CONFIG.legacy_margin_max_exclusive;

  const base = {
    fit_selector_override_fired: false,
    // r4 never uses the margin band as a gate.
    margin_veto_fired: false,
    layer_a_prob_mean: probValid ? p : null,
    layer_a_prob_margin: margin,
    layer_a_probability_valid: probValid,
    margin_band_eligible: legacyCondition,
    legacy_margin_condition: legacyCondition,
    legacy_margin_outside_band: !legacyCondition,
    fit_state_snapshot: snap,
  } as const;

  const abstain = (
    reason: string,
    flags: Partial<Pick<Decision,
      "agreement_veto_fired" | "efficiency_veto_fired" | "body_ratio_veto_fired" |
      "wick_pressure_veto_fired" | "macd_veto_fired" | "r4_feature_history_valid" |
      "r4_feature_history_error">> = {},
  ): Decision => ({
    prediction: "ABSTAIN",
    selected_layer: "NONE",
    reason,
    agreement_veto_fired: false,
    efficiency_veto_fired: false,
    body_ratio_veto_fired: false,
    wick_pressure_veto_fired: false,
    macd_veto_fired: false,
    r4_feature_history_valid: true,
    r4_feature_history_error: null,
    feature_values: fv,
    ...base,
    ...flags,
  });

  // ── Feature computation (always attempted so audit fields are populated) ──
  const historyErrors: string[] = [];

  if (a !== "GREEN" && a !== "RED") historyErrors.push("layer_a_direction_invalid");

  const eff = fourCandleEfficiency(priorCandles);
  if (eff) {
    fv.four_candle_net_displacement = eff.net_displacement;
    fv.four_candle_total_body_path = eff.total_body_path;
    fv.four_candle_path_efficiency = eff.path_efficiency;
    fv.efficiency_veto_condition =
      eff.path_efficiency >= A96_CONFIG.four_candle_efficiency_veto_min_inclusive &&
      eff.path_efficiency < A96_CONFIG.four_candle_efficiency_veto_max_exclusive;
  } else {
    historyErrors.push("four_candle_efficiency_unavailable");
  }

  let agreementHistoryUnusable = false;
  try {
    const f = agreementFeatures({ priorCandles, targetTimestamp, targetOpen });
    fv.distance_from_4_candle_low_bps = f.distance_from_4_candle_low_bps;
    fv.distance_veto_condition =
      f.distance_from_4_candle_low_bps >= A96_CONFIG.agreement_distance_from_4_low_bps;
  } catch (e) {
    if (e instanceof CandleHistoryError) {
      agreementHistoryUnusable = true;
      historyErrors.push(`agreement_history:${e.message}`);
    } else {
      throw e;
    }
  }

  const twoBody = meanTwoCandleBodyToRange(priorCandles);
  if (twoBody) {
    fv.body_to_range_t15 = twoBody.body_to_range_t15;
    fv.body_to_range_t30 = twoBody.body_to_range_t30;
    fv.mean_2_candle_body_to_range = twoBody.mean_two_body_to_range;
    // r3 agreement body-ratio condition (<= 0.30) — unchanged semantics.
    fv.body_ratio_veto_condition =
      twoBody.mean_two_body_to_range <= A96_CONFIG.agreement_mean_2_body_to_range_max;
    // r4 body-concentration condition (> 0.65).
    fv.body_concentration_condition =
      twoBody.mean_two_body_to_range > A96_CONFIG.mean_two_body_to_range_max;
  } else {
    historyErrors.push("mean_two_body_to_range_unavailable");
  }

  if (a === "GREEN" || a === "RED") {
    const wick = fourCandleAlignedWickPressure(priorCandles, a);
    if (wick) {
      fv.raw_wick_pressures = wick.raw;
      fv.aligned_wick_pressures = wick.aligned;
      fv.direction_sign = wick.direction_sign;
      fv.four_candle_aligned_wick_pressure = wick.four_candle_aligned_wick_pressure;
      fv.wick_pressure_condition =
        wick.four_candle_aligned_wick_pressure > A96_CONFIG.four_candle_aligned_wick_pressure_max;
    } else {
      historyErrors.push("aligned_wick_pressure_unavailable");
    }

    const tech = args.technical ?? null;
    const macdHist = tech?.macd_hist ?? null;
    const atr14 = tech?.atr14 ?? null;
    fv.prior_macd_hist = macdHist != null && Number.isFinite(Number(macdHist)) ? Number(macdHist) : null;
    fv.prior_atr14 = atr14 != null && Number.isFinite(Number(atr14)) && Number(atr14) > 0 ? Number(atr14) : null;
    const expectedTechTs = priorCandles.length === A96_CONFIG.required_prior_candles
      ? priorCandles[priorCandles.length - 1].timestamp.getTime()
      : null;
    const techTsOk =
      tech?.source_ts instanceof Date &&
      expectedTechTs != null &&
      tech.source_ts.getTime() === expectedTechTs;
    const macdAligned = techTsOk ? alignedMacdHistAtr(macdHist, atr14, a) : null;
    if (macdAligned == null) {
      historyErrors.push(techTsOk ? "macd_atr_unavailable" : "technical_source_timestamp_mismatch");
    } else {
      fv.aligned_macd_hist_atr = macdAligned;
      fv.macd_veto_condition = macdAligned > A96_CONFIG.aligned_macd_hist_atr_max;
    }
  }

  // ── Step 1: input / feature-history validity ──
  if (historyErrors.length > 0) {
    return abstain("ABSTAIN_R4_FEATURE_HISTORY_INVALID", {
      r4_feature_history_valid: false,
      r4_feature_history_error: historyErrors.join("|").slice(0, 500),
    });
  }

  // ── Step 2: Layer A probability validity (no margin gate) ──
  if (!probValid) {
    return abstain("ABSTAIN_LAYER_A_PROBABILITY_INVALID");
  }

  // ── Step 3: four-candle efficiency toxic band ──
  if (fv.efficiency_veto_condition) {
    return abstain("ABSTAIN_FOUR_CANDLE_EFFICIENCY_TOXIC_BAND", { efficiency_veto_fired: true });
  }

  // ── Step 4: r3 agreement veto (unchanged, only when A == B) ──
  if (a === b) {
    if (agreementHistoryUnusable && A96_CONFIG.abstain_on_unusable_agreement_history) {
      return abstain("ABSTAIN_AGREEMENT_HISTORY_UNUSABLE", { agreement_veto_fired: true });
    }
    if (fv.distance_veto_condition || fv.body_ratio_veto_condition) {
      const reasons: string[] = [];
      if (fv.distance_veto_condition) reasons.push("STRETCHED_FROM_4_CANDLE_LOW");
      if (fv.body_ratio_veto_condition) reasons.push("WICK_DOMINATED_PRIOR_2");
      return abstain("ABSTAIN_AGREEMENT_" + reasons.join("_AND_"), { agreement_veto_fired: true });
    }
  }

  // ── Step 5: two-candle body concentration ──
  if (fv.body_concentration_condition) {
    return abstain("ABSTAIN_TWO_CANDLE_BODY_CONCENTRATION_HIGH", { body_ratio_veto_fired: true });
  }

  // ── Step 6: four-candle aligned wick pressure ──
  if (fv.wick_pressure_condition) {
    return abstain("ABSTAIN_FOUR_CANDLE_WICK_PRESSURE_HIGH", { wick_pressure_veto_fired: true });
  }

  // ── Step 7: aligned MACD histogram / ATR ──
  if (fv.macd_veto_condition) {
    return abstain("ABSTAIN_MACD_MOMENTUM_OVEREXTENDED", { macd_veto_fired: true });
  }

  // ── Step 8: publish Layer A ──
  return {
    prediction: a,
    selected_layer: "A",
    reason: a === b ? "A_B_AGREEMENT_LAYER_A_PASS" : "A_B_DISAGREEMENT_LAYER_A_PRIMARY",
    agreement_veto_fired: false,
    efficiency_veto_fired: false,
    body_ratio_veto_fired: false,
    wick_pressure_veto_fired: false,
    macd_veto_fired: false,
    r4_feature_history_valid: true,
    r4_feature_history_error: null,
    feature_values: fv,
    ...base,
  };
}

/**
 * r3 counterfactual (audit-only). Replays the frozen a96-r3 rules against the
 * same prediction-time inputs. Never influences the active r4 decision and
 * never emits a webhook.
 */
export function a96DecideR3Counterfactual(args: {
  layerADirection: "GREEN" | "RED";
  layerBDirection: "GREEN" | "RED";
  layerAProbMean: number | null | undefined;
  targetTimestamp: Date;
  targetOpen: number;
  priorCandles: Candle[];
}): R3Counterfactual {
  const { layerADirection: a, layerBDirection: b, layerAProbMean, targetTimestamp, targetOpen, priorCandles } = args;
  const none = (reason: string, marginCondition: boolean): R3Counterfactual => ({
    decision: "ABSTAIN", direction: null, reason, margin_condition: marginCondition,
  });

  const p = layerAProbMean == null ? NaN : Number(layerAProbMean);
  const probValid = Number.isFinite(p) && p >= 0 && p <= 1;
  if (!probValid) return none("ABSTAIN_LAYER_A_PROBABILITY_INVALID", false);

  const margin = Math.abs(p - 0.5);
  const eligible =
    margin >= A96_CONFIG.legacy_margin_min_inclusive &&
    margin < A96_CONFIG.legacy_margin_max_exclusive;
  if (!eligible) return none("ABSTAIN_LAYER_A_MARGIN_OUTSIDE_BAND", false);

  const eff = fourCandleEfficiency(priorCandles);
  if (eff &&
    eff.path_efficiency >= A96_CONFIG.four_candle_efficiency_veto_min_inclusive &&
    eff.path_efficiency < A96_CONFIG.four_candle_efficiency_veto_max_exclusive) {
    return none("ABSTAIN_FOUR_CANDLE_EFFICIENCY_TOXIC_BAND", true);
  }

  if (a === b) {
    try {
      const f = agreementFeatures({ priorCandles, targetTimestamp, targetOpen });
      const distanceVeto = f.distance_from_4_candle_low_bps >= A96_CONFIG.agreement_distance_from_4_low_bps;
      const bodyVeto = f.mean_2_candle_body_to_range <= A96_CONFIG.agreement_mean_2_body_to_range_max;
      if (distanceVeto || bodyVeto) {
        const reasons: string[] = [];
        if (distanceVeto) reasons.push("STRETCHED_FROM_4_CANDLE_LOW");
        if (bodyVeto) reasons.push("WICK_DOMINATED_PRIOR_2");
        return none("ABSTAIN_AGREEMENT_" + reasons.join("_AND_"), true);
      }
    } catch (e) {
      if (e instanceof CandleHistoryError) return none("ABSTAIN_AGREEMENT_HISTORY_UNUSABLE", true);
      throw e;
    }
    return { decision: a, direction: a, reason: "A_B_AGREEMENT_LAYER_A_PASS", margin_condition: true };
  }

  return { decision: a, direction: a, reason: "A_B_DISAGREEMENT_LAYER_A_PRIMARY", margin_condition: true };
}

export function authoritativeDirection(actualOpen: number, actualClose: number): "GREEN" | "RED" | "PUSH" {
  if (actualClose > actualOpen) return "GREEN";
  if (actualClose < actualOpen) return "RED";
  return "PUSH";
}

export function scoreDirection(prediction: Direction, actual: Direction): number {
  if (prediction !== "GREEN" && prediction !== "RED") return 0;
  if (actual !== "GREEN" && actual !== "RED") return 0;
  return prediction === actual ? 1 : -1;
}
