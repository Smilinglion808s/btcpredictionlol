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
      rolling96_coverage: window.length ? rollingDirectional / window.length : 0,
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
