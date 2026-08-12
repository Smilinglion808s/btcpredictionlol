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


  return rowsOldestFirst.map((r) => {
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
