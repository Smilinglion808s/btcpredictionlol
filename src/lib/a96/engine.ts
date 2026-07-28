// Pure deterministic a96-r2 decision logic.
//
// r2 patch (replaces r1 selector/fit-leader logic):
//   1. Validate layer_a_prob_mean (finite, [0,1]) → else ABSTAIN.
//   2. Compute margin = |layer_a_prob_mean - 0.5|.
//      Eligible iff margin in [0.01, 0.04). Otherwise ABSTAIN.
//   3. If Layer A == Layer B, apply the existing agreement veto
//      (distance-from-4-low OR body-ratio thresholds) → else Layer A pass.
//   4. If Layer A != Layer B, always publish Layer A (no selector, no leader).
//
// baseSelectedLayer and fitState are audit inputs only. They cannot change
// the r2 direction. Every directional r2 decision returns selected_layer='A'
// and fit_selector_override_fired=false.

import { A96_CONFIG } from "./config";
import { agreementFeatures, CandleHistoryError } from "./features";
import type { Candle, Decision, Direction, FitState, Layer } from "./types";

function snapshot(s: FitState) {
  return { ...s, net_gap_a_minus_b: s.layer_a_net - s.layer_b_net };
}

function emptyFeatures(): Decision["feature_values"] {
  return {
    distance_from_4_candle_low_bps: null,
    mean_2_candle_body_to_range: null,
    distance_veto_condition: false,
    body_ratio_veto_condition: false,
  };
}

export function a96Decide(args: {
  layerADirection: "GREEN" | "RED";
  layerBDirection: "GREEN" | "RED";
  layerAProbMean: number | null | undefined;
  baseSelectedLayer: Layer;
  fitState: FitState;
  targetTimestamp: Date;
  targetOpen: number;
  priorCandles: Candle[];
}): Decision {
  const {
    layerADirection: a, layerBDirection: b,
    layerAProbMean, fitState, targetTimestamp, targetOpen, priorCandles,
  } = args;
  const snap = snapshot(fitState);

  // Step 3-4: probability validation.
  const p = typeof layerAProbMean === "number" ? layerAProbMean : Number(layerAProbMean);
  const probValid =
    layerAProbMean != null &&
    typeof p === "number" &&
    Number.isFinite(p) &&
    p >= 0 && p <= 1;
  if (!probValid) {
    return {
      prediction: "ABSTAIN",
      selected_layer: "NONE",
      reason: "ABSTAIN_LAYER_A_PROBABILITY_INVALID",
      fit_selector_override_fired: false,
      agreement_veto_fired: false,
      margin_veto_fired: false,
      layer_a_prob_mean: null,
      layer_a_prob_margin: null,
      layer_a_probability_valid: false,
      margin_band_eligible: false,
      feature_values: emptyFeatures(),
      fit_state_snapshot: snap,
    };
  }

  // Step 5-6: margin band.
  const margin = Math.abs(p - 0.5);
  const eligible =
    margin >= A96_CONFIG.layer_a_margin_min_inclusive &&
    margin < A96_CONFIG.layer_a_margin_max_exclusive;
  if (!eligible) {
    return {
      prediction: "ABSTAIN",
      selected_layer: "NONE",
      reason: "ABSTAIN_LAYER_A_MARGIN_OUTSIDE_BAND",
      fit_selector_override_fired: false,
      agreement_veto_fired: false,
      margin_veto_fired: true,
      layer_a_prob_mean: p,
      layer_a_prob_margin: margin,
      layer_a_probability_valid: true,
      margin_band_eligible: false,
      feature_values: emptyFeatures(),
      fit_state_snapshot: snap,
    };
  }

  // Step 7-9: agreement branch — existing veto applies only when A == B.
  const feature_values = emptyFeatures();
  if (a === b) {
    let features: { distance_from_4_candle_low_bps: number; mean_2_candle_body_to_range: number } | null = null;
    try {
      features = agreementFeatures({ priorCandles, targetTimestamp, targetOpen });
    } catch (e) {
      if (e instanceof CandleHistoryError) {
        if (A96_CONFIG.abstain_on_unusable_agreement_history) {
          return {
            prediction: "ABSTAIN",
            selected_layer: "NONE",
            reason: "ABSTAIN_AGREEMENT_HISTORY_UNUSABLE",
            fit_selector_override_fired: false,
            agreement_veto_fired: true,
            margin_veto_fired: false,
            layer_a_prob_mean: p,
            layer_a_prob_margin: margin,
            layer_a_probability_valid: true,
            margin_band_eligible: true,
            feature_values,
            fit_state_snapshot: snap,
          };
        }
      } else {
        throw e;
      }
    }
    if (features) {
      feature_values.distance_from_4_candle_low_bps = features.distance_from_4_candle_low_bps;
      feature_values.mean_2_candle_body_to_range = features.mean_2_candle_body_to_range;
      feature_values.distance_veto_condition =
        features.distance_from_4_candle_low_bps >= A96_CONFIG.agreement_distance_from_4_low_bps;
      feature_values.body_ratio_veto_condition =
        features.mean_2_candle_body_to_range <= A96_CONFIG.agreement_mean_2_body_to_range_max;
    }
    if (feature_values.distance_veto_condition || feature_values.body_ratio_veto_condition) {
      const reasons: string[] = [];
      if (feature_values.distance_veto_condition) reasons.push("STRETCHED_FROM_4_CANDLE_LOW");
      if (feature_values.body_ratio_veto_condition) reasons.push("WICK_DOMINATED_PRIOR_2");
      return {
        prediction: "ABSTAIN",
        selected_layer: "NONE",
        reason: "ABSTAIN_AGREEMENT_" + reasons.join("_AND_"),
        fit_selector_override_fired: false,
        agreement_veto_fired: true,
        margin_veto_fired: false,
        layer_a_prob_mean: p,
        layer_a_prob_margin: margin,
        layer_a_probability_valid: true,
        margin_band_eligible: true,
        feature_values,
        fit_state_snapshot: snap,
      };
    }
    return {
      prediction: a,
      selected_layer: "A",
      reason: "A_B_AGREEMENT_LAYER_A_PASS",
      fit_selector_override_fired: false,
      agreement_veto_fired: false,
      margin_veto_fired: false,
      layer_a_prob_mean: p,
      layer_a_prob_margin: margin,
      layer_a_probability_valid: true,
      margin_band_eligible: true,
      feature_values,
      fit_state_snapshot: snap,
    };
  }

  // Step 10 (disagreement): always publish Layer A. No selector, no leader.
  return {
    prediction: a,
    selected_layer: "A",
    reason: "A_B_DISAGREEMENT_LAYER_A_PRIMARY",
    fit_selector_override_fired: false,
    agreement_veto_fired: false,
    margin_veto_fired: false,
    layer_a_prob_mean: p,
    layer_a_prob_margin: margin,
    layer_a_probability_valid: true,
    margin_band_eligible: true,
    feature_values,
    fit_state_snapshot: snap,
  };
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
