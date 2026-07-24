// Pure deterministic a96-r1 decision logic. See docs/handoff.
import { A96_CONFIG } from "./config";
import { agreementFeatures, CandleHistoryError } from "./features";
import type { Candle, Decision, Direction, FitState, Layer } from "./types";

function snapshot(s: FitState) {
  return { ...s, net_gap_a_minus_b: s.layer_a_net - s.layer_b_net };
}

export function a96Decide(args: {
  layerADirection: "GREEN" | "RED";
  layerBDirection: "GREEN" | "RED";
  baseSelectedLayer: Layer;
  fitState: FitState;
  targetTimestamp: Date;
  targetOpen: number;
  priorCandles: Candle[];
}): Decision {
  const {
    layerADirection: a, layerBDirection: b, baseSelectedLayer: base,
    fitState, targetTimestamp, targetOpen, priorCandles,
  } = args;
  const snap = snapshot(fitState);
  const feature_values: Decision["feature_values"] = {
    distance_from_4_candle_low_bps: null,
    mean_2_candle_body_to_range: null,
    distance_veto_condition: false,
    body_ratio_veto_condition: false,
  };

  // Agreement branch.
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
            feature_values,
            fit_state_snapshot: snap,
          };
        }
      } else { throw e; }
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
        feature_values,
        fit_state_snapshot: snap,
      };
    }
    const selected: Layer = base === "A" || base === "B" ? base : "A";
    return {
      prediction: a,
      selected_layer: selected,
      reason: "A_B_AGREEMENT_PASS",
      fit_selector_override_fired: false,
      agreement_veto_fired: false,
      feature_values,
      fit_state_snapshot: snap,
    };
  }

  // Disagreement branch.
  const netGap = fitState.layer_a_net - fitState.layer_b_net;
  const overrideReady =
    fitState.comparable_resolved_count >= A96_CONFIG.fit_selector_min_resolved &&
    Math.abs(netGap) >= A96_CONFIG.fit_selector_min_net_gap;
  if (overrideReady) {
    const selected: Layer = netGap > 0 ? "A" : "B";
    const prediction = selected === "A" ? a : b;
    const changed = selected !== base;
    return {
      prediction,
      selected_layer: selected,
      reason: changed ? "CURRENT_FIT_LAYER_LEADER_OVERRIDE" : "CURRENT_FIT_LAYER_LEADER_CONFIRMED",
      fit_selector_override_fired: changed,
      agreement_veto_fired: false,
      feature_values,
      fit_state_snapshot: snap,
    };
  }

  if (base !== "A" && base !== "B") {
    return {
      prediction: "ABSTAIN",
      selected_layer: "NONE",
      reason: "ABSTAIN_MISSING_BASE_LAYER_ON_DISAGREEMENT",
      fit_selector_override_fired: false,
      agreement_veto_fired: false,
      feature_values,
      fit_state_snapshot: snap,
    };
  }
  const prediction = base === "A" ? a : b;
  const reason = fitState.comparable_resolved_count < A96_CONFIG.fit_selector_min_resolved
    ? "BASE_SELECTOR_FIT_WARMUP"
    : "BASE_SELECTOR_NET_GAP_BELOW_THRESHOLD";
  return {
    prediction,
    selected_layer: base,
    reason,
    fit_selector_override_fired: false,
    agreement_veto_fired: false,
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
