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

export interface Decision {
  prediction: Direction;
  selected_layer: Layer;
  reason: string;
  fit_selector_override_fired: boolean;
  agreement_veto_fired: boolean;
  // r2 margin-band audit
  margin_veto_fired: boolean;
  // r3 four-candle path-efficiency audit
  efficiency_veto_fired: boolean;
  layer_a_prob_mean: number | null;
  layer_a_prob_margin: number | null;
  layer_a_probability_valid: boolean;
  margin_band_eligible: boolean;
  feature_values: {
    distance_from_4_candle_low_bps: number | null;
    mean_2_candle_body_to_range: number | null;
    distance_veto_condition: boolean;
    body_ratio_veto_condition: boolean;
    four_candle_net_displacement: number | null;
    four_candle_total_body_path: number | null;
    four_candle_path_efficiency: number | null;
    efficiency_veto_condition: boolean;
  };
  fit_state_snapshot: FitState & { net_gap_a_minus_b: number };
}
