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
