export type Direction = "GREEN" | "RED" | "PUSH" | "ABSTAIN";
export type Layer = "A" | "B" | "NONE";

export interface Candle {
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
}

export interface FitState {
  fit_episode_id: string;
  artifact_fit_id: string;
  comparable_resolved_count: number;
  layer_a_wins: number;
  layer_a_losses: number;
  layer_a_net: number;
  layer_b_wins: number;
  layer_b_losses: number;
  layer_b_net: number;
}

export interface A96FeatureValues {
  distance_from_4_candle_low_bps: number | null;
  mean_2_candle_body_to_range: number | null;
  distance_veto_condition: boolean;
  body_ratio_veto_condition: boolean;
  four_candle_net_displacement: number | null;
  four_candle_total_body_path: number | null;
  four_candle_path_efficiency: number | null;
  efficiency_veto_condition: boolean;
  // r4
  body_to_range_t15: number | null;
  body_to_range_t30: number | null;
  body_concentration_condition: boolean;
  raw_wick_pressures: number[] | null;
  aligned_wick_pressures: number[] | null;
  direction_sign: 1 | -1 | null;
  four_candle_aligned_wick_pressure: number | null;
  wick_pressure_condition: boolean;
  prior_macd_hist: number | null;
  prior_atr14: number | null;
  aligned_macd_hist_atr: number | null;
  macd_veto_condition: boolean;
}

/** r3 counterfactual outcome, audit-only. Never affects the active decision. */
export interface R3Counterfactual {
  decision: Direction;
  direction: "GREEN" | "RED" | null;
  reason: string;
  margin_condition: boolean;
}

export interface Decision {
  prediction: Direction;
  selected_layer: Layer;
  reason: string;
  fit_selector_override_fired: boolean;
  agreement_veto_fired: boolean;
  // r2 margin band — legacy, never fires in r4.
  margin_veto_fired: boolean;
  // r3 four-candle path-efficiency audit
  efficiency_veto_fired: boolean;
  // r4 vetoes
  body_ratio_veto_fired: boolean;
  wick_pressure_veto_fired: boolean;
  macd_veto_fired: boolean;
  // r4 feature-history validity
  r4_feature_history_valid: boolean;
  r4_feature_history_error: string | null;
  layer_a_prob_mean: number | null;
  layer_a_prob_margin: number | null;
  layer_a_probability_valid: boolean;
  /** Legacy r3 band membership — recorded only. */
  margin_band_eligible: boolean;
  legacy_margin_condition: boolean;
  legacy_margin_outside_band: boolean;
  feature_values: A96FeatureValues;
  fit_state_snapshot: FitState & { net_gap_a_minus_b: number };
}
