// V6 CSV export shaping. Header order is byte-identical to
// `V6_live_tracking_template.csv` and must not be reordered.

export const V6_CSV_COLUMNS = [
  "prediction_id","target_candle_ts","prediction_created_at","input_candle_ts","input_cutoff_ts",
  "prediction_created_before_target","timing_valid","symbol","timeframe","provider","model_version",
  "fit_id","model_artifact_sha256","feature_schema_version","operational_status","operational_error",
  "continuity_valid","feature_valid","imputed_feature_count","imputed_features_json",
  "prior_candle_ids_json","input_open","input_high","input_low","input_close","input_volume",
  "ridge_features_json","gb_features_json","aligned_wick_pressure_4","lower_wick_pct","roc_4",
  "range_expansion_vs_avg20","rsi14","cum_vol_delta_to_avg","ema21_50_pct","dist_to_high20_pct",
  "ridge_p_green","ridge_percentile","gb_p_green","gb_percentile","broad_score","broad_percentile",
  "anchor_score","anchor_percentile","final_score","red_threshold","green_threshold",
  "base_v6_prediction","base_predictions_last8_json","base_green_count_last8",
  "saturation_veto_evaluable","saturation_veto_triggered","red_pickup_evaluable","red_pickup_triggered",
  "green_pickup_evaluable","green_pickup_triggered","pickup_conflict","pre_weak_red_veto_prediction",
  "prediction_source","weak_broad_red_veto_evaluable","weak_broad_red_veto_triggered","final_prediction",
  "abstain_status","abstain_reason","canonical_candle_row_id","canonical_open","canonical_high",
  "canonical_low","canonical_close","canonical_volume","canonical_actual_direction",
  "canonical_ground_truth_valid","resolution_timestamp","base_v6_raw_score","base_v6_adjusted_score",
  "pre_weak_red_veto_raw_score","pre_weak_red_veto_adjusted_score","final_raw_score",
  "final_adjusted_score","saturation_veto_raw_contribution","saturation_veto_adjusted_contribution",
  "red_pickup_raw_contribution","red_pickup_adjusted_contribution","green_pickup_raw_contribution",
  "green_pickup_adjusted_contribution","weak_broad_red_veto_raw_contribution",
  "weak_broad_red_veto_adjusted_contribution","cumulative_raw_net","cumulative_adjusted_net",
  "current_directional_loss_streak","max_directional_loss_streak","raw_peak_to_trough_drawdown",
  "adjusted_peak_to_trough_drawdown","rolling96_predictions","rolling96_coverage",
  "rolling96_raw_net","rolling96_adjusted_net",
  // --- V6-r1 Regime Inverter (documented order) ---
  "model_revision",
  "original_v6_base_prediction","original_v6_base_source",
  "pre_inverter_prediction","pre_inverter_prediction_source",
  "regime_inverter_evaluable","regime_inverter_ready","regime_inverter_active",
  "regime_inverter_triggered",
  "regime_inverter_history_count","regime_inverter_history_json",
  "regime_inverter_last20_wins","regime_inverter_last20_losses",
  "regime_inverter_last20_adjusted_net","regime_inverter_activation_threshold",
  "regime_inverter_original_prediction","regime_inverter_replacement_prediction",
  "regime_inverter_reason",
  "original_v6_shadow_raw_score","original_v6_shadow_adjusted_score",
  "pre_inverter_raw_score","pre_inverter_adjusted_score",
  "regime_inverter_raw_contribution","regime_inverter_adjusted_contribution",
  "final_prediction_source",
  // --- V6-r2 weak-RED coverage recovery ---
  "model_revision_activated_at",
  "prediction_before_weak_red_veto",
  "weak_red_veto_candidate","weak_red_veto_original_prediction","weak_red_veto_broad_percentile",
  "weak_red_recovery_evaluable","weak_red_recovery_triggered","weak_red_recovery_reason",
  "weak_red_rsi_recovery_evaluable","weak_red_rsi_recovery_triggered",
  "weak_red_rsi_threshold","weak_red_rsi_value",
  "weak_red_roc4_recovery_evaluable","weak_red_roc4_recovery_triggered",
  "weak_red_roc4_threshold","weak_red_roc4_value",
  "prediction_after_weak_red_recovery","prediction_source_after_weak_red_recovery",
  "weak_red_underlying_prediction","weak_red_underlying_raw_score","weak_red_underlying_adjusted_score",
  "weak_red_recovery_published_prediction","weak_red_recovery_raw_score","weak_red_recovery_adjusted_score",
  "weak_red_recovery_counterfactual_adjusted_score",
  "weak_red_recovery_raw_contribution","weak_red_recovery_adjusted_contribution",
  "actual_direction",
  "rolling96_directional_predictions","rolling96_valid_opportunities",
  // --- V6-r3 broad conflict + BROAD_RED reliability ---
  "selected_component","broad_distance_from_neutral","anchor_distance_from_neutral",
  "broad_conflict_veto_evaluable","broad_conflict_veto_triggered","broad_conflict_veto_reason",
  "broad_conflict_original_prediction","broad_conflict_original_source",
  "broad_conflict_anchor_percentile","broad_conflict_anchor_direction","broad_conflict_anchor_distance",
  "broad_conflict_min_distance","broad_conflict_max_distance",
  "prediction_after_broad_conflict_veto","prediction_source_after_broad_conflict_veto",
  "broad_conflict_underlying_prediction","broad_conflict_underlying_raw_score",
  "broad_conflict_underlying_adjusted_score",
  "broad_conflict_veto_raw_contribution","broad_conflict_veto_adjusted_contribution",
  "broad_red_reliability_evaluable","broad_red_reliability_ready","broad_red_reliability_veto_active",
  "broad_red_reliability_veto_triggered","broad_red_reliability_reason",
  "broad_red_history_count","broad_red_history_json",
  "broad_red_last12_wins","broad_red_last12_losses","broad_red_last12_adjusted_net",
  "broad_red_reliability_threshold",
  "prediction_after_broad_red_reliability","prediction_source_after_broad_red_reliability",
  "broad_red_underlying_prediction","broad_red_underlying_raw_score","broad_red_underlying_adjusted_score",
  "broad_red_reliability_raw_contribution","broad_red_reliability_adjusted_contribution",
  "broad_red_shadow_prediction","broad_red_shadow_adjusted_score",
  "regime_inverter_shadow_only","regime_inverter_publication_enabled",
  "regime_inverter_would_trigger","regime_inverter_would_publish",
  "regime_inverter_shadow_raw_score","regime_inverter_shadow_adjusted_score",
  "regime_inverter_counterfactual_raw_contribution","regime_inverter_counterfactual_adjusted_contribution",
  // --- V6-r4 Structure Confirmation Gate ---
  "path_efficiency_4",
  "pre_structure_prediction","pre_structure_source",
  "structure_confirmation_evaluable",
  "structure_rejection_evaluable","structure_rejection_pass",
  "structure_rejection_lower_wick_value","structure_rejection_lower_wick_threshold",
  "structure_rejection_aligned_wick_value","structure_rejection_aligned_wick_threshold",
  "structure_expansion_evaluable","structure_expansion_pass",
  "structure_expansion_range_value","structure_expansion_range_threshold",
  "structure_expansion_efficiency_value","structure_expansion_efficiency_threshold",
  "structure_confirmation_pass","structure_confirmation_triggered","structure_confirmation_reason",
  "prediction_after_structure_confirmation","prediction_source_after_structure_confirmation",
  "structure_underlying_prediction","structure_underlying_actual_direction",
  "structure_underlying_raw_score","structure_underlying_adjusted_score",
  "structure_confirmation_raw_contribution","structure_confirmation_adjusted_contribution",

  // --- V6-r5 Selective Core Router ---
  "r5_router_version","r5_router_decision","r5_router_source","r5_router_reason","final_reason",
  "r5_green_evaluable","r5_green_candidate",
  "r5_green_stoch_spread","r5_green_stoch_spread_threshold","r5_green_stoch_condition",
  "r5_green_d1_mean_body_to_range_2","r5_green_d1_mean_body_to_range_2_threshold","r5_green_body_condition",
  "r5_red_feeder_evaluable","r5_red_feeder_pass","r5_red_feeder_prediction","r5_red_feeder_source",
  "r5_red_anchor_evaluable","r5_red_anchor_candidate",
  "r5_red_anchor_d1_close_position","r5_red_anchor_d1_close_position_threshold","r5_red_anchor_condition",
  "r5_red_broad_evaluable","r5_red_broad_candidate",
  "r5_red_broad_close_slope_8","r5_red_broad_close_slope_threshold","r5_red_broad_slope_condition",
  "r5_red_broad_bb_width_pct","r5_red_broad_bb_width_threshold","r5_red_broad_bb_condition",
  "r5_red_candidate","r5_conflict","r5_conflict_green_result","r5_conflict_red_result",
  "r5_final_result","r5_final_raw_score","r5_final_adjusted_score",
  "r5_green_shadow_prediction","r5_green_shadow_result","r5_green_shadow_raw_score","r5_green_shadow_adjusted_score",
  "r5_red_anchor_shadow_prediction","r5_red_anchor_shadow_result","r5_red_anchor_shadow_raw_score","r5_red_anchor_shadow_adjusted_score",
  "r5_red_broad_shadow_prediction","r5_red_broad_shadow_result","r5_red_broad_shadow_raw_score","r5_red_broad_shadow_adjusted_score",
  "r5_aligned_wick_red_shadow_evaluable","r5_aligned_wick_red_shadow_candidate",
  "r5_aligned_wick_red_shadow_value","r5_aligned_wick_red_shadow_threshold",
  "r5_aligned_wick_red_shadow_result","r5_aligned_wick_red_shadow_raw_score","r5_aligned_wick_red_shadow_adjusted_score",
  "legacy_pickup_publication_enabled","broad_conflict_publication_enabled",
  "broad_red_reliability_publication_enabled","structure_confirmation_publication_enabled",
  "structure_confirmation_shadow_only",
  "legacy_r4_shadow_prediction","legacy_r4_shadow_source","legacy_r4_shadow_reason",
  "legacy_r4_shadow_result","legacy_r4_shadow_raw_score","legacy_r4_shadow_adjusted_score",
  "consensus_red_shadow_prediction","consensus_red_shadow_result",
  "consensus_red_shadow_raw_score","consensus_red_shadow_adjusted_score",
  "momentum_green_shadow_prediction","momentum_green_shadow_result",
  "momentum_green_shadow_raw_score","momentum_green_shadow_adjusted_score",
  "r5_cumulative_raw_net","r5_cumulative_adjusted_net","r5_trade_index",

  // --- V6-r5.1 Route Drawdown Brake ---
  "r5_route_brake_revision","r5_route_brake_activated_at","r5_route_brake_state_rebuilt",
  "r5_route_brake_pause_loss_threshold","r5_route_brake_resume_win_threshold",
  "r5_pre_brake_prediction","r5_pre_brake_source","r5_pre_brake_reason",
  "r5_green_route_brake_evaluable","r5_green_route_pause_active",
  "r5_green_route_consecutive_shadow_losses","r5_green_route_brake_triggered","r5_green_route_brake_reason",
  "r5_anchor_red_route_brake_evaluable","r5_anchor_red_route_pause_active",
  "r5_anchor_red_route_consecutive_shadow_losses","r5_anchor_red_route_brake_triggered",
  "r5_anchor_red_route_brake_reason",
  "r5_route_brake_triggered","r5_route_brake_route_key","r5_route_brake_reason",
  "r5_route_brake_underlying_prediction","r5_route_brake_underlying_actual",
  "r5_route_brake_underlying_result","r5_route_brake_underlying_raw_score",
  "r5_route_brake_underlying_adjusted_score",
  "r5_route_brake_raw_contribution","r5_route_brake_adjusted_contribution",
  "r5_green_route_shadow_eligible","r5_green_route_shadow_result",
  "r5_green_route_shadow_streak_before","r5_green_route_shadow_streak_after",
  "r5_green_route_pause_before_resolution","r5_green_route_pause_after_resolution",
  "r5_anchor_red_route_shadow_eligible","r5_anchor_red_route_shadow_result",
  "r5_anchor_red_route_shadow_streak_before","r5_anchor_red_route_shadow_streak_after",
  "r5_anchor_red_route_pause_before_resolution","r5_anchor_red_route_pause_after_resolution",
  "r5_route_brake_cumulative_raw_contribution","r5_route_brake_cumulative_adjusted_contribution",
  "r5_route_brake_trigger_index",

  // --- V6-r6 Promotion Router ---
  "r6_router_version","r6_base_prediction","r6_base_source","r6_base_reason",
  "r5_route_brake_shadow_only","r5_route_brake_publication_enabled",
  "r5_route_brake_shadow_prediction","r5_route_brake_shadow_reason",
  "r5_route_brake_shadow_result","r5_route_brake_shadow_raw_score","r5_route_brake_shadow_adjusted_score",
  "r6_p1_evaluable","r6_p1_green_candidate","r6_p1_path_efficiency_4","r6_p1_path_efficiency_threshold","r6_p1_condition_a","r6_p1_momentum_8_over_atr","r6_p1_momentum_threshold","r6_p1_condition_b","r6_p1_shadow_result","r6_p1_shadow_raw_score","r6_p1_shadow_adjusted_score",
  "r6_p2_evaluable","r6_p2_red_candidate","r6_p2_roc_8","r6_p2_roc_threshold","r6_p2_condition_a","r6_p2_volume_expansion","r6_p2_volume_expansion_threshold","r6_p2_condition_b","r6_p2_shadow_result","r6_p2_shadow_raw_score","r6_p2_shadow_adjusted_score",
  "r6_p3_evaluable","r6_p3_green_candidate","r6_p3_channel_position_0_1","r6_p3_channel_position_threshold","r6_p3_condition_a","r6_p3_change_pct","r6_p3_change_pct_threshold","r6_p3_condition_b","r6_p3_shadow_result","r6_p3_shadow_raw_score","r6_p3_shadow_adjusted_score",
  "r6_p4_evaluable","r6_p4_red_candidate","r6_p4_mean_body_to_range_2","r6_p4_mean_body_threshold","r6_p4_condition_a","r6_p4_macd_hist_over_atr14","r6_p4_macd_threshold","r6_p4_condition_b","r6_p4_shadow_result","r6_p4_shadow_raw_score","r6_p4_shadow_adjusted_score",
  "r6_p5_evaluable","r6_p5_green_candidate","r6_p5_dist_to_low20_pct","r6_p5_dist_low20_threshold","r6_p5_condition_a","r6_p5_change_pct","r6_p5_change_pct_threshold","r6_p5_condition_b","r6_p5_shadow_result","r6_p5_shadow_raw_score","r6_p5_shadow_adjusted_score",
  "r6_p6_evaluable","r6_p6_green_candidate","r6_p6_path_efficiency_4","r6_p6_path_efficiency_threshold","r6_p6_condition_a","r6_p6_mean_body_to_range_2","r6_p6_mean_body_threshold","r6_p6_condition_b","r6_p6_shadow_result","r6_p6_shadow_raw_score","r6_p6_shadow_adjusted_score",
  "r6_green_promotion_candidate","r6_red_promotion_candidate","r6_green_promotion_rule_count","r6_red_promotion_rule_count","r6_green_promotion_rules_triggered","r6_red_promotion_rules_triggered","r6_promotion_conflict","r6_promotion_primary_rule","r6_promotion_all_rules","r6_final_prediction","r6_final_source","r6_final_reason","r6_final_result","r6_final_raw_score","r6_final_adjusted_score","r6_green_promotion_shadow_result","r6_green_promotion_shadow_raw_score","r6_green_promotion_shadow_adjusted_score","r6_red_promotion_shadow_result","r6_red_promotion_shadow_raw_score","r6_red_promotion_shadow_adjusted_score","r6_conflict_green_result","r6_conflict_red_result","r6_base_r5_result","r6_base_r5_raw_score","r6_base_r5_adjusted_score","r6_promotion_underlying_r5_prediction","r6_promotion_final_prediction","r6_promotion_result","r6_promotion_raw_contribution","r6_promotion_adjusted_contribution","r6_valid_opportunities","r6_directional_predictions","r6_coverage","r6_wins","r6_losses","r6_win_rate","r6_cumulative_raw_net","r6_cumulative_adjusted_net","r6_running_raw_drawdown","r6_running_adjusted_drawdown","r6_max_raw_drawdown","r6_max_adjusted_drawdown","r6_current_directional_loss_streak","r6_max_directional_loss_streak","r6_rolling96_valid_opportunities","r6_rolling96_directional_predictions","r6_rolling96_coverage","r6_rolling96_raw_net","r6_rolling96_adjusted_net","r6_base_r5_trade_count","r6_base_r5_wins","r6_base_r5_losses","r6_base_r5_raw_net","r6_base_r5_adjusted_net","r6_promotion_trade_count","r6_promotion_wins","r6_promotion_losses","r6_promotion_raw_net","r6_promotion_adjusted_net","r6_promotion_green_count","r6_promotion_green_wins","r6_promotion_green_losses","r6_promotion_green_raw_net","r6_promotion_green_adjusted_net","r6_promotion_red_count","r6_promotion_red_wins","r6_promotion_red_losses","r6_promotion_red_raw_net","r6_promotion_red_adjusted_net","r6_promotion_conflict_count","r5_route_brake_shadow_trigger_count","r5_route_brake_shadow_avoided_losses","r5_route_brake_shadow_sacrificed_wins","r5_route_brake_shadow_raw_contribution","r5_route_brake_shadow_adjusted_contribution","r6_p1_count","r6_p1_wins","r6_p1_losses","r6_p1_raw_net","r6_p1_adjusted_net","r6_p2_count","r6_p2_wins","r6_p2_losses","r6_p2_raw_net","r6_p2_adjusted_net","r6_p3_count","r6_p3_wins","r6_p3_losses","r6_p3_raw_net","r6_p3_adjusted_net","r6_p4_count","r6_p4_wins","r6_p4_losses","r6_p4_raw_net","r6_p4_adjusted_net","r6_p5_count","r6_p5_wins","r6_p5_losses","r6_p5_raw_net","r6_p5_adjusted_net","r6_p6_count","r6_p6_wins","r6_p6_losses","r6_p6_raw_net","r6_p6_adjusted_net",
  // --- V6-r7 Adaptive Opportunity Selector (shadow) ---
  "r7_version","r7_model_revision","r7_activated_at","r7_shadow_enabled","r7_publication_enabled",
  "r7_history_window","r7_history_ready","r7_history_error","r7_prior_valid_opportunity_count",
  "r7_state_evaluable","r7_broad_bin","r7_anchor_bin","r7_state_id",
  "r7_state_sample_count","r7_state_green_count","r7_state_red_count",
  "r7_state_green_win_rate","r7_state_red_win_rate",
  "r7_e1_candidate","r7_e1_state_samples","r7_e1_state_wins","r7_e1_state_losses","r7_e1_state_raw_net","r7_e1_state_win_rate","r7_e1_state_edge_rate","r7_e1_qualified","r7_e1_shadow_result","r7_e1_shadow_raw_score",
  "r7_e2_candidate","r7_e2_state_samples","r7_e2_state_wins","r7_e2_state_losses","r7_e2_state_raw_net","r7_e2_state_win_rate","r7_e2_state_edge_rate","r7_e2_qualified","r7_e2_shadow_result","r7_e2_shadow_raw_score",
  "r7_e3_candidate","r7_e3_state_samples","r7_e3_state_wins","r7_e3_state_losses","r7_e3_state_raw_net","r7_e3_state_win_rate","r7_e3_state_edge_rate","r7_e3_qualified","r7_e3_shadow_result","r7_e3_shadow_raw_score",
  "r7_e4_candidate","r7_e4_state_samples","r7_e4_state_wins","r7_e4_state_losses","r7_e4_state_raw_net","r7_e4_state_win_rate","r7_e4_state_edge_rate","r7_e4_qualified","r7_e4_shadow_result","r7_e4_shadow_raw_score",
  "r7_best_green_expert","r7_best_green_edge_rate","r7_best_green_samples",
  "r7_best_red_expert","r7_best_red_edge_rate","r7_best_red_samples",
  "r7_selected_expert","r7_shadow_prediction","r7_shadow_reason",
  "r7_r6_reference_prediction","r7_action_vs_r6",
  "r7_shadow_result","r7_shadow_raw_score","r7_raw_contribution_vs_r6",
  "r7_valid_opportunities","r7_directional_predictions","r7_coverage","r7_wins","r7_losses","r7_win_rate",
  "r7_cumulative_raw_net","r7_max_raw_drawdown","r7_current_directional_loss_streak","r7_max_directional_loss_streak",
  "r7_rolling96_directional_predictions","r7_rolling96_raw_net",
  "r7_cumulative_raw_contribution_vs_r6",
  "r7_keep_r6_count","r7_reject_r6_count","r7_add_opportunity_count","r7_reroute_direction_count",
  "r7_e1_selected_count","r7_e2_selected_count","r7_e3_selected_count","r7_e4_selected_count",
] as const;



type Row = Record<string, unknown>;

function num(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Attach path-dependent metrics. Rows must arrive oldest → newest; only scored
 * (non-OP_FAIL, non-PUSH-excluded) rows move the running totals.
 */
export function withV6DerivedMetrics(rowsOldestFirst: Row[]): Row[] {
  let cumRaw = 0;
  let cumAdj = 0;
  let peakRaw = 0;
  let peakAdj = 0;
  let ddRaw = 0;
  let ddAdj = 0;
  let streak = 0;
  let maxStreak = 0;
  const window: Array<{ raw: number; adj: number; directional: boolean }> = [];
  // r5-only running totals: they advance only on rows published by the r5 router.
  let r5Raw = 0;
  let r5Adj = 0;
  let r5Trades = 0;
  let brakeTriggers = 0;
  let brakeRaw = 0;
  let brakeAdj = 0;

  // --- V6-r6 running aggregates (final publication = r6 publication) ------
  let r6Opps = 0, r6Dir = 0, r6Wins = 0, r6Losses = 0;
  let r6Raw = 0, r6Adj = 0, r6PeakRaw = 0, r6PeakAdj = 0, r6MaxDdRaw = 0, r6MaxDdAdj = 0;
  let r6Streak = 0, r6MaxStreak = 0;
  const r6Window: Array<{ raw: number; adj: number; directional: boolean }> = [];
  const agg = {
    base: { n: 0, w: 0, l: 0, raw: 0, adj: 0 },
    promo: { n: 0, w: 0, l: 0, raw: 0, adj: 0 },
    promoGreen: { n: 0, w: 0, l: 0, raw: 0, adj: 0 },
    promoRed: { n: 0, w: 0, l: 0, raw: 0, adj: 0 },
    p1: { n: 0, w: 0, l: 0, raw: 0, adj: 0 },
    p2: { n: 0, w: 0, l: 0, raw: 0, adj: 0 },
    p3: { n: 0, w: 0, l: 0, raw: 0, adj: 0 },
    p4: { n: 0, w: 0, l: 0, raw: 0, adj: 0 },
    p5: { n: 0, w: 0, l: 0, raw: 0, adj: 0 },
    p6: { n: 0, w: 0, l: 0, raw: 0, adj: 0 },
  };
  let conflictCount = 0;
  // --- V6-r7 shadow running aggregates (RAW only) ---
  let r7Opps = 0, r7Dir = 0, r7Wins = 0, r7Losses = 0, r7Raw = 0;
  let r7PeakRaw = 0, r7MaxDd = 0, r7Streak = 0, r7MaxStreak = 0, r7Contrib = 0;
  const r7Window: Array<{ raw: number; directional: boolean }> = [];
  const r7Actions = { KEEP_R6: 0, REJECT_R6: 0, ADD_OPPORTUNITY: 0, REROUTE_DIRECTION: 0 } as Record<string, number>;
  const r7Selected = { E1_R6: 0, E2_FROZEN_CORE: 0, E3_R4: 0, E4_STATE_MAP: 0 } as Record<string, number>;
  let brakeShadowTriggers = 0, brakeShadowAvoided = 0, brakeShadowSacrificed = 0;
  let brakeShadowRaw = 0, brakeShadowAdj = 0;

  const bump = (
    b: { n: number; w: number; l: number; raw: number; adj: number },
    result: unknown, raw: unknown, adj: unknown,
  ) => {
    if (result !== "WIN" && result !== "LOSS" && result !== "PUSH") return;
    b.n += 1;
    if (result === "WIN") b.w += 1;
    if (result === "LOSS") b.l += 1;
    b.raw += num(raw) ?? 0;
    b.adj += num(adj) ?? 0;
  };


  return rowsOldestFirst.map((r) => {
    // --- V6-r7 shadow accumulation (RAW only; op-fail rows never score) ---
    if (r.operational_status === "OK" && r.r7_shadow_result != null) {
      const r7res = String(r.r7_shadow_result);
      const r7raw = num(r.r7_shadow_raw_score) ?? 0;
      const r7dir = r.r7_shadow_prediction === "GREEN" || r.r7_shadow_prediction === "RED";
      if (r7res !== "PUSH") {
        r7Opps += 1;
        r7Raw += r7raw;
        r7PeakRaw = Math.max(r7PeakRaw, r7Raw);
        r7MaxDd = Math.max(r7MaxDd, r7PeakRaw - r7Raw);
        if (r7dir) {
          r7Dir += 1;
          if (r7res === "WIN") { r7Wins += 1; r7Streak = 0; }
          if (r7res === "LOSS") { r7Losses += 1; r7Streak += 1; r7MaxStreak = Math.max(r7MaxStreak, r7Streak); }
        }
        r7Window.push({ raw: r7raw, directional: r7dir });
        if (r7Window.length > 96) r7Window.shift();
        r7Contrib += num(r.r7_raw_contribution_vs_r6) ?? 0;
        const action = String(r.r7_action_vs_r6 ?? "");
        if (action in r7Actions) r7Actions[action] += 1;
        const sel = String(r.r7_selected_expert ?? "");
        if (sel in r7Selected) r7Selected[sel] += 1;
      }
    }

    const raw = num(r.final_raw_score);
    const adj = num(r.final_adjusted_score);
    const scored = raw !== null && adj !== null;

    if (scored) {
      cumRaw += raw;
      cumAdj += adj;
      peakRaw = Math.max(peakRaw, cumRaw);
      peakAdj = Math.max(peakAdj, cumAdj);
      ddRaw = Math.max(ddRaw, peakRaw - cumRaw);
      ddAdj = Math.max(ddAdj, peakAdj - cumAdj);

      const directional = r.final_prediction === "GREEN" || r.final_prediction === "RED";
      if (directional) {
        if (raw < 0) {
          streak += 1;
          maxStreak = Math.max(maxStreak, streak);
        } else {
          streak = 0;
        }
      }
      window.push({ raw, adj, directional });
      if (window.length > 96) window.shift();
    }

    const r5Raw1 = num(r.r5_final_raw_score);
    const r5Adj1 = num(r.r5_final_adjusted_score);
    const r5Published = r.r5_router_decision === "GREEN" || r.r5_router_decision === "RED";
    if (r5Published && r5Raw1 !== null && r5Adj1 !== null) {
      r5Raw += r5Raw1;
      r5Adj += r5Adj1;
      r5Trades += 1;
    }

    // r5.1 brake attribution totals: only rows the brake actually vetoed move them.
    const brakeTriggered = r.r5_route_brake_triggered === true;
    const brakeRaw1 = num(r.r5_route_brake_raw_contribution);
    const brakeAdj1 = num(r.r5_route_brake_adjusted_contribution);
    if (brakeTriggered) {
      brakeTriggers += 1;
      brakeRaw += brakeRaw1 ?? 0;
      brakeAdj += brakeAdj1 ?? 0;
    }

    // --- V6-r6 accounting. Each target contributes at most one published
    // trade regardless of how many promotion rules triggered.
    const r6RawScore = num(r.r6_final_raw_score);
    const r6AdjScore = num(r.r6_final_adjusted_score);
    const r6Scored = r6RawScore !== null && r6AdjScore !== null;
    const r6Directional = r.r6_final_prediction === "GREEN" || r.r6_final_prediction === "RED";
    if (r6Scored) {
      r6Opps += 1;
      r6Raw += r6RawScore;
      r6Adj += r6AdjScore;
      r6PeakRaw = Math.max(r6PeakRaw, r6Raw);
      r6PeakAdj = Math.max(r6PeakAdj, r6Adj);
      r6MaxDdRaw = Math.max(r6MaxDdRaw, r6PeakRaw - r6Raw);
      r6MaxDdAdj = Math.max(r6MaxDdAdj, r6PeakAdj - r6Adj);
      if (r6Directional) {
        r6Dir += 1;
        if (r.r6_final_result === "WIN") r6Wins += 1;
        if (r.r6_final_result === "LOSS") r6Losses += 1;
        if (r.r6_final_result === "LOSS") {
          r6Streak += 1;
          r6MaxStreak = Math.max(r6MaxStreak, r6Streak);
        } else if (r.r6_final_result === "WIN") {
          r6Streak = 0;
        }
      }
      r6Window.push({ raw: r6RawScore, adj: r6AdjScore, directional: r6Directional });
      if (r6Window.length > 96) r6Window.shift();
    }

    if (r.r6_base_prediction === "GREEN" || r.r6_base_prediction === "RED") {
      bump(agg.base, r.r6_base_r5_result, r.r6_base_r5_raw_score, r.r6_base_r5_adjusted_score);
    }
    const promoted = r.r6_promotion_final_prediction === "GREEN" || r.r6_promotion_final_prediction === "RED";
    if (promoted) {
      bump(agg.promo, r.r6_promotion_result, r.r6_promotion_raw_contribution, r.r6_promotion_adjusted_contribution);
      const side = r.r6_promotion_final_prediction === "GREEN" ? agg.promoGreen : agg.promoRed;
      bump(side, r.r6_promotion_result, r.r6_promotion_raw_contribution, r.r6_promotion_adjusted_contribution);
    }
    if (r.r6_promotion_conflict === true) conflictCount += 1;
    bump(agg.p1, r.r6_p1_shadow_result, r.r6_p1_shadow_raw_score, r.r6_p1_shadow_adjusted_score);
    bump(agg.p2, r.r6_p2_shadow_result, r.r6_p2_shadow_raw_score, r.r6_p2_shadow_adjusted_score);
    bump(agg.p3, r.r6_p3_shadow_result, r.r6_p3_shadow_raw_score, r.r6_p3_shadow_adjusted_score);
    bump(agg.p4, r.r6_p4_shadow_result, r.r6_p4_shadow_raw_score, r.r6_p4_shadow_adjusted_score);
    bump(agg.p5, r.r6_p5_shadow_result, r.r6_p5_shadow_raw_score, r.r6_p5_shadow_adjusted_score);
    bump(agg.p6, r.r6_p6_shadow_result, r.r6_p6_shadow_raw_score, r.r6_p6_shadow_adjusted_score);

    if (r.r5_route_brake_triggered === true) {
      brakeShadowTriggers += 1;
      const underlying = r.r5_route_brake_underlying_result;
      if (underlying === "LOSS") brakeShadowAvoided += 1;
      if (underlying === "WIN") brakeShadowSacrificed += 1;
      brakeShadowRaw += num(r.r5_route_brake_raw_contribution) ?? 0;
      brakeShadowAdj += num(r.r5_route_brake_adjusted_contribution) ?? 0;
    }

    const r6RollDir = r6Window.filter((w) => w.directional).length;

    const rollingDirectional = window.filter((w) => w.directional).length;
    return {
      ...r,
      cumulative_raw_net: scored ? cumRaw : null,
      cumulative_adjusted_net: scored ? cumAdj : null,
      current_directional_loss_streak: streak,
      max_directional_loss_streak: maxStreak,
      raw_peak_to_trough_drawdown: ddRaw,
      adjusted_peak_to_trough_drawdown: ddAdj,
      rolling96_predictions: window.length,
      // rolling96_predictions counts all valid opportunities; the directional
      // count and coverage are reported explicitly alongside it.
      rolling96_valid_opportunities: window.length,
      rolling96_directional_predictions: rollingDirectional,
      rolling96_coverage: window.length ? rollingDirectional / window.length : 0,
      prediction_before_weak_red_veto: r.pre_weak_red_veto_prediction ?? null,
      actual_direction: r.canonical_actual_direction ?? null,
      rolling96_raw_net: window.reduce((s, w) => s + w.raw, 0),
      rolling96_adjusted_net: window.reduce((s, w) => s + w.adj, 0),
      r5_cumulative_raw_net: r5Trades ? r5Raw : null,
      r5_cumulative_adjusted_net: r5Trades ? r5Adj : null,
      r5_trade_index: r5Published ? r5Trades : null,
      r5_route_brake_cumulative_raw_contribution: brakeTriggers ? brakeRaw : null,
      r5_route_brake_cumulative_adjusted_contribution: brakeTriggers ? brakeAdj : null,
      r5_route_brake_trigger_index: brakeTriggered ? brakeTriggers : null,

      // --- V6-r6 running metrics ---
      r6_valid_opportunities: r6Opps,
      r6_directional_predictions: r6Dir,
      r6_coverage: r6Opps ? r6Dir / r6Opps : 0,
      r6_wins: r6Wins,
      r6_losses: r6Losses,
      r6_win_rate: r6Wins + r6Losses ? r6Wins / (r6Wins + r6Losses) : 0,
      r6_cumulative_raw_net: r6Scored ? r6Raw : null,
      r6_cumulative_adjusted_net: r6Scored ? r6Adj : null,
      r6_running_raw_drawdown: r6PeakRaw - r6Raw,
      r6_running_adjusted_drawdown: r6PeakAdj - r6Adj,
      r6_max_raw_drawdown: r6MaxDdRaw,
      r6_max_adjusted_drawdown: r6MaxDdAdj,
      r6_current_directional_loss_streak: r6Streak,
      r6_max_directional_loss_streak: r6MaxStreak,
      r6_rolling96_valid_opportunities: r6Window.length,
      r6_rolling96_directional_predictions: r6RollDir,
      r6_rolling96_coverage: r6Window.length ? r6RollDir / r6Window.length : 0,
      r6_rolling96_raw_net: r6Window.reduce((s2, w) => s2 + w.raw, 0),
      r6_rolling96_adjusted_net: r6Window.reduce((s2, w) => s2 + w.adj, 0),

      r6_base_r5_trade_count: agg.base.n,
      r6_base_r5_wins: agg.base.w,
      r6_base_r5_losses: agg.base.l,
      r6_base_r5_raw_net: agg.base.raw,
      r6_base_r5_adjusted_net: agg.base.adj,
      r6_promotion_trade_count: agg.promo.n,
      r6_promotion_wins: agg.promo.w,
      r6_promotion_losses: agg.promo.l,
      r6_promotion_raw_net: agg.promo.raw,
      r6_promotion_adjusted_net: agg.promo.adj,
      r6_promotion_green_count: agg.promoGreen.n,
      r6_promotion_green_wins: agg.promoGreen.w,
      r6_promotion_green_losses: agg.promoGreen.l,
      r6_promotion_green_raw_net: agg.promoGreen.raw,
      r6_promotion_green_adjusted_net: agg.promoGreen.adj,
      r6_promotion_red_count: agg.promoRed.n,
      r6_promotion_red_wins: agg.promoRed.w,
      r6_promotion_red_losses: agg.promoRed.l,
      r6_promotion_red_raw_net: agg.promoRed.raw,
      r6_promotion_red_adjusted_net: agg.promoRed.adj,
      r6_promotion_conflict_count: conflictCount,
      r5_route_brake_shadow_trigger_count: brakeShadowTriggers,
      r5_route_brake_shadow_avoided_losses: brakeShadowAvoided,
      r5_route_brake_shadow_sacrificed_wins: brakeShadowSacrificed,
      r5_route_brake_shadow_raw_contribution: brakeShadowRaw,
      r5_route_brake_shadow_adjusted_contribution: brakeShadowAdj,
      r6_p1_count: agg.p1.n, r6_p1_wins: agg.p1.w, r6_p1_losses: agg.p1.l, r6_p1_raw_net: agg.p1.raw, r6_p1_adjusted_net: agg.p1.adj,
      r6_p2_count: agg.p2.n, r6_p2_wins: agg.p2.w, r6_p2_losses: agg.p2.l, r6_p2_raw_net: agg.p2.raw, r6_p2_adjusted_net: agg.p2.adj,
      r6_p3_count: agg.p3.n, r6_p3_wins: agg.p3.w, r6_p3_losses: agg.p3.l, r6_p3_raw_net: agg.p3.raw, r6_p3_adjusted_net: agg.p3.adj,
      r6_p4_count: agg.p4.n, r6_p4_wins: agg.p4.w, r6_p4_losses: agg.p4.l, r6_p4_raw_net: agg.p4.raw, r6_p4_adjusted_net: agg.p4.adj,
      r6_p5_count: agg.p5.n, r6_p5_wins: agg.p5.w, r6_p5_losses: agg.p5.l, r6_p5_raw_net: agg.p5.raw, r6_p5_adjusted_net: agg.p5.adj,
      r7_valid_opportunities: r7Opps,
      r7_directional_predictions: r7Dir,
      r7_coverage: r7Opps > 0 ? r7Dir / r7Opps : null,
      r7_wins: r7Wins,
      r7_losses: r7Losses,
      r7_win_rate: r7Wins + r7Losses > 0 ? r7Wins / (r7Wins + r7Losses) : null,
      r7_cumulative_raw_net: r7Raw,
      r7_max_raw_drawdown: r7MaxDd,
      r7_current_directional_loss_streak: r7Streak,
      r7_max_directional_loss_streak: r7MaxStreak,
      r7_rolling96_directional_predictions: r7Window.filter((w) => w.directional).length,
      r7_rolling96_raw_net: r7Window.reduce((a, w) => a + w.raw, 0),
      r7_cumulative_raw_contribution_vs_r6: r7Contrib,
      r7_keep_r6_count: r7Actions.KEEP_R6,
      r7_reject_r6_count: r7Actions.REJECT_R6,
      r7_add_opportunity_count: r7Actions.ADD_OPPORTUNITY,
      r7_reroute_direction_count: r7Actions.REROUTE_DIRECTION,
      r7_e1_selected_count: r7Selected.E1_R6,
      r7_e2_selected_count: r7Selected.E2_FROZEN_CORE,
      r7_e3_selected_count: r7Selected.E3_R4,
      r7_e4_selected_count: r7Selected.E4_STATE_MAP,
      r6_p6_count: agg.p6.n, r6_p6_wins: agg.p6.w, r6_p6_losses: agg.p6.l, r6_p6_raw_net: agg.p6.raw, r6_p6_adjusted_net: agg.p6.adj,
    };

  });
}

function cell(value: unknown): string {
  if (value === null || value === undefined) return "";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Full CSV text in the frozen template column order. */
export function v6RowsToCsv(rowsOldestFirst: Row[]): string {
  const rows = withV6DerivedMetrics(rowsOldestFirst);
  const header = V6_CSV_COLUMNS.join(",");
  const body = rows.map((r) => V6_CSV_COLUMNS.map((c) => cell(r[c])).join(",")).join("\n");
  return `${header}\n${body}\n`;
}
