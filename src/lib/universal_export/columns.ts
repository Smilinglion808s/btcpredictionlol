// Column registry + schema manifest.  Single source of truth for the
// btc15m Universal CSV v2 export.

export type Category =
  | "IDENTIFIER"
  | "TIMESTAMP"
  | "PREDICTION_TIME_FEATURE"
  | "MODEL_OUTPUT"
  | "MODEL_STATE"
  | "STRATEGIC_ABSTENTION"
  | "OPERATIONAL_AUDIT"
  | "CANONICAL_OUTCOME"
  | "LEGACY_OUTCOME"
  | "COUNTERFACTUAL"
  | "RESOLUTION_METADATA";

export interface ColumnDef {
  name: string;
  category: Category;
  source: string;
  derivation?: string;
  description: string;
  nullable?: boolean;
  model_or_schema_dep?: string;
}

function pt(def: ColumnDef): ColumnDef & { prediction_time_safe: boolean; resolution_time_only: boolean } {
  const notSafeCats: Category[] = ["CANONICAL_OUTCOME", "LEGACY_OUTCOME", "COUNTERFACTUAL", "RESOLUTION_METADATA"];
  return {
    ...def,
    prediction_time_safe: !notSafeCats.includes(def.category),
    resolution_time_only: notSafeCats.includes(def.category),
  };
}

// Canonical block --------------------------------------------------------
export const CANONICAL_COLUMNS: ColumnDef[] = [
  { name: "canonical_candle_row_id", category: "CANONICAL_OUTCOME", source: "candles.id", description: "PK of the exact BTC-USDT 15m OKX confirmed candle for this boundary." },
  { name: "canonical_symbol", category: "CANONICAL_OUTCOME", source: "candles.symbol", description: "Always 'BTC-USDT' when canonical row is valid." },
  { name: "canonical_timeframe", category: "CANONICAL_OUTCOME", source: "candles.timeframe", description: "Always '15m' when canonical row is valid." },
  { name: "canonical_provider", category: "CANONICAL_OUTCOME", source: "candles.fetch_source", description: "Always 'okx' when canonical row is valid." },
  { name: "canonical_confirmed", category: "CANONICAL_OUTCOME", source: "candles.confirm", description: "Always true when canonical row is valid." },
  { name: "canonical_candle_ts", category: "CANONICAL_OUTCOME", source: "candles.candle_ts", description: "Exact target boundary timestamp." },
  { name: "canonical_actual_open", category: "CANONICAL_OUTCOME", source: "candles.open", description: "Open price from canonical OKX candle." },
  { name: "canonical_actual_high", category: "CANONICAL_OUTCOME", source: "candles.high", description: "High price from canonical OKX candle." },
  { name: "canonical_actual_low", category: "CANONICAL_OUTCOME", source: "candles.low", description: "Low price from canonical OKX candle." },
  { name: "canonical_actual_close", category: "CANONICAL_OUTCOME", source: "candles.close", description: "Close price from canonical OKX candle." },
  { name: "canonical_actual_volume", category: "CANONICAL_OUTCOME", source: "candles.volume", description: "Volume from canonical OKX candle." },
  { name: "canonical_actual_direction", category: "CANONICAL_OUTCOME", source: "derived", derivation: "close>open GREEN, close<open RED, close=open PUSH", description: "Direction derived exclusively from canonical open and close." },
  { name: "canonical_ground_truth_valid", category: "CANONICAL_OUTCOME", source: "derived", description: "True only when every canonical requirement is satisfied." },
  { name: "canonical_ground_truth_invalid_reason", category: "CANONICAL_OUTCOME", source: "derived", description: "Explanation when canonical_ground_truth_valid is false." },
];

// Legacy preservation flags ----------------------------------------------
export const LEGACY_FLAG_COLUMNS: ColumnDef[] = [
  { name: "legacy_actual_direction", category: "LEGACY_OUTCOME", source: "predictions.actual_direction", description: "Historical stored direction; preserved verbatim for audit." },
  { name: "legacy_status", category: "LEGACY_OUTCOME", source: "predictions.status", description: "Historical stored status (win/loss/push/pending)." },
  { name: "legacy_settlement_source", category: "LEGACY_OUTCOME", source: "predictions.resolution_source", description: "Historical resolver source (kalshi/okx/coinbase/local)." },
  { name: "canonical_disagrees_with_legacy", category: "LEGACY_OUTCOME", source: "derived", description: "True when both directions are available and disagree." },
];

// Per-model canonical scoring --------------------------------------------
function modelCanonical(prefix: string, label: string): ColumnDef[] {
  return [
    { name: `${prefix}_canonical_prediction`, category: "MODEL_OUTPUT", source: `${label} prediction, normalized`, description: `${label} raw prediction normalized to GREEN/RED/ABSTAIN.` },
    { name: `${prefix}_canonical_result_score`, category: "COUNTERFACTUAL", source: "derived", description: `${label} canonical score vs canonical direction (+1/-1/0/null).` },
  ];
}
export const PER_MODEL_CANONICAL_COLUMNS: ColumnDef[] = [
  ...modelCanonical("base", "Base predictions"),
  ...modelCanonical("td1", "TD1-RC"),
  ...modelCanonical("aas96", "AAS96"),
  ...modelCanonical("a96", "a96"),
];

// Spine -------------------------------------------------------------------
export const SPINE_COLUMNS: ColumnDef[] = [
  { name: "expected_candle_boundary", category: "TIMESTAMP", source: "spine", description: "Exact 15-minute boundary this row represents (ISO UTC)." },
  { name: "prediction_row_present", category: "OPERATIONAL_AUDIT", source: "spine", description: "True when a base predictions row was found for this boundary." },
  { name: "missing_prediction_reason", category: "OPERATIONAL_AUDIT", source: "spine", description: "Populated when no base predictions row exists for this boundary." },
  { name: "previous_expected_candle_ts", category: "TIMESTAMP", source: "spine", description: "The boundary immediately before this one in the exported spine." },
  { name: "gap_from_previous_exported_row_seconds", category: "OPERATIONAL_AUDIT", source: "spine", description: "Seconds between this boundary and the previous exported row." },
  { name: "missing_boundaries_since_previous_row", category: "OPERATIONAL_AUDIT", source: "spine", description: "Count of skipped 15m boundaries between rows (0 for adjacent)." },
  { name: "prior_4_boundaries_contiguous", category: "OPERATIONAL_AUDIT", source: "spine", description: "True when the last 4 rows are uninterrupted 15m steps." },
  { name: "prior_21_boundaries_contiguous", category: "OPERATIONAL_AUDIT", source: "spine", description: "True when the last 21 rows are uninterrupted 15m steps." },
  { name: "prior_30_boundaries_contiguous", category: "OPERATIONAL_AUDIT", source: "spine", description: "True when the last 30 rows are uninterrupted 15m steps." },
];

// Timing ------------------------------------------------------------------
export const TIMING_COLUMNS: ColumnDef[] = [
  { name: "prediction_created_before_boundary", category: "OPERATIONAL_AUDIT", source: "predictions.created_at vs candle_ts", description: "True only when created_at < candle_ts." },
  { name: "prediction_lead_ms", category: "OPERATIONAL_AUDIT", source: "derived", description: "candle_ts - created_at in milliseconds." },
  { name: "input_candle_exactly_prior", category: "OPERATIONAL_AUDIT", source: "derived", description: "True when input_candle_ts is exactly 900s before target boundary." },
  { name: "input_to_target_delta_seconds", category: "OPERATIONAL_AUDIT", source: "derived", description: "Seconds between input_candle_ts and target boundary." },
  { name: "feature_cutoff_before_target", category: "OPERATIONAL_AUDIT", source: "derived", description: "True when the stored feature cutoff timestamp is strictly before the target boundary." },
  { name: "prediction_timing_valid", category: "OPERATIONAL_AUDIT", source: "derived", description: "All timing preconditions satisfied." },
  { name: "prediction_timing_invalid_reason", category: "OPERATIONAL_AUDIT", source: "derived", description: "Explanation when prediction_timing_valid is false." },
];

// Per-model classification (5 cols each) ---------------------------------
function modelClassification(prefix: string, label: string): ColumnDef[] {
  return [
    { name: `${prefix}_output_class`, category: "MODEL_OUTPUT", source: `${label} normalized prediction`, description: `${label} output class: DIRECTIONAL, ABSTAIN, or UNAVAILABLE.` },
    { name: `${prefix}_abstain_class`, category: "STRATEGIC_ABSTENTION", source: "derived", description: `${label} abstain classification: STRATEGIC, OPERATIONAL, or NONE.` },
    { name: `${prefix}_normalized_abstain_reason`, category: "STRATEGIC_ABSTENTION", source: "derived", description: `${label} normalized abstain reason code.` },
    { name: `${prefix}_prospective_row_valid`, category: "OPERATIONAL_AUDIT", source: "derived", description: `${label} row is eligible for prospective performance tallying.` },
    { name: `${prefix}_prospective_invalid_reason`, category: "OPERATIONAL_AUDIT", source: "derived", description: `${label} explanation when prospective_row_valid is false.` },
  ];
}
export const CLASSIFICATION_COLUMNS: ColumnDef[] = [
  ...modelClassification("base", "Base"),
  ...modelClassification("td1", "TD1-RC"),
  ...modelClassification("aas96", "AAS96"),
  ...modelClassification("a96", "a96"),
];

// Lineage -----------------------------------------------------------------
export const LINEAGE_COLUMNS: ColumnDef[] = [
  { name: "universal_schema_version", category: "IDENTIFIER", source: "constant", description: "Version tag of the Universal CSV schema itself." },
  { name: "base_model_version", category: "IDENTIFIER", source: "predictions.model_version", description: "Base engine model version identifier." },
  { name: "base_config_hash", category: "IDENTIFIER", source: "predictions.config_hash", description: "Base engine config hash." },
  { name: "base_engine_version_hash", category: "IDENTIFIER", source: "predictions.engine_version_hash", description: "Base engine version hash." },
  { name: "td1_fit_id", category: "IDENTIFIER", source: "model7_td1_rc_shadow.td1_fit_id", description: "Active TD1-RC fit identifier." },
  { name: "td1_artifact_sha256", category: "IDENTIFIER", source: "model7_td1_rc_shadow.td1_artifact_sha256", description: "SHA256 of the TD1-RC artifact used." },
  { name: "aas96_fit_id", category: "IDENTIFIER", source: "model7_aas96_shadow.fit_id", description: "Active AAS96 fit identifier." },
  { name: "aas96_feature_schema_hash", category: "IDENTIFIER", source: "model7_aas96_shadow.feature_schema_hash", description: "AAS96 feature-schema hash." },
  { name: "aas96_cleanup_veto_version", category: "IDENTIFIER", source: "model7_aas96_shadow.cleanup_veto_v1_version", description: "AAS96 cleanup veto rule version." },
  { name: "aas96_selector_override_version", category: "IDENTIFIER", source: "model7_aas96_shadow.selector_b_confirmation_v1_version", description: "AAS96 selector override rule version." },
  { name: "a96_model_version", category: "IDENTIFIER", source: "a96_predictions.model_version", description: "a96 model version identifier." },
  { name: "a96_artifact_fit_id", category: "IDENTIFIER", source: "a96_predictions.artifact_fit_id", description: "a96 artifact fit identifier." },
  { name: "a96_fit_episode_id", category: "IDENTIFIER", source: "a96_predictions.fit_episode_id", description: "a96 fit episode UUID." },
  { name: "a96_fit_episode_lineage_valid", category: "OPERATIONAL_AUDIT", source: "derived", description: "False when episode ID changes under same artifact ID within the export range." },
  { name: "a96_fit_episode_lineage_error", category: "OPERATIONAL_AUDIT", source: "derived", description: "Explanation when episode lineage is invalid." },
  // a96-r2 margin-band audit
  { name: "a96_layer_a_prob_mean", category: "MODEL_STATE", source: "a96_predictions.layer_a_prob_mean", description: "AAS96 Layer A ensembled probability of GREEN, as consumed by a96-r2." },
  { name: "a96_layer_a_prob_margin", category: "MODEL_STATE", source: "a96_predictions.layer_a_prob_margin", description: "Absolute margin |layer_a_prob_mean - 0.5|." },
  { name: "a96_layer_a_probability_valid", category: "MODEL_STATE", source: "a96_predictions.layer_a_probability_valid", description: "False when the Layer A probability was missing or out of [0,1]." },
  { name: "a96_margin_band_min", category: "MODEL_STATE", source: "a96_predictions.margin_band_min", description: "Lower inclusive bound of the r2 margin band (frozen 0.01)." },
  { name: "a96_margin_band_max", category: "MODEL_STATE", source: "a96_predictions.margin_band_max", description: "Upper exclusive bound of the r2 margin band (frozen 0.04)." },
  { name: "a96_margin_band_eligible", category: "MODEL_STATE", source: "a96_predictions.margin_band_eligible", description: "True when margin fell in [min, max)." },
  { name: "a96_margin_veto_fired", category: "MODEL_STATE", source: "a96_predictions.margin_veto_fired", description: "True when the r2 margin-band gate produced an ABSTAIN." },
  // a96-r3 four-candle path-efficiency audit
  { name: "a96_four_candle_net_displacement", category: "MODEL_STATE", source: "a96_predictions.four_candle_net_displacement", description: "|close(T-15m) - open(T-60m)| over the four prior canonical candles." },
  { name: "a96_four_candle_total_body_path", category: "MODEL_STATE", source: "a96_predictions.four_candle_total_body_path", description: "Sum of |close - open| across the four prior canonical candles." },
  { name: "a96_four_candle_path_efficiency", category: "MODEL_STATE", source: "a96_predictions.four_candle_path_efficiency", description: "Net displacement divided by total body path (0.0 when denominator is 0)." },
  { name: "a96_efficiency_veto_min", category: "MODEL_STATE", source: "a96_predictions.efficiency_veto_min", description: "Lower inclusive bound of the r3 toxic efficiency band (frozen 0.25)." },
  { name: "a96_efficiency_veto_max", category: "MODEL_STATE", source: "a96_predictions.efficiency_veto_max", description: "Upper exclusive bound of the r3 toxic efficiency band (frozen 0.40)." },
  { name: "a96_efficiency_veto_condition", category: "MODEL_STATE", source: "a96_predictions.efficiency_veto_condition", description: "True when path efficiency fell in [0.25, 0.40), regardless of which veto fired." },
  { name: "a96_efficiency_veto_fired", category: "MODEL_STATE", source: "a96_predictions.efficiency_veto_fired", description: "True when the efficiency band was the active ABSTAIN reason." },
  // a96-r4 identity, structure, momentum, lineage, counterfactual and webhook audit
  { name: "a96_variant", category: "IDENTIFIER", source: "a96_predictions.variant", description: "a96 variant label (r4: layer-a-structure-macd)." },
  { name: "a96_legacy_margin_condition", category: "MODEL_STATE", source: "a96_predictions.legacy_margin_condition", description: "True when margin fell in the legacy r3 band; recorded only, never gates r4." },
  { name: "a96_legacy_margin_outside_band", category: "MODEL_STATE", source: "a96_predictions.legacy_margin_outside_band", description: "True when margin fell outside the legacy r3 band." },
  { name: "a96_body_to_range_t30", category: "MODEL_STATE", source: "a96_predictions.r4_feature_snapshot", description: "Body-to-range of the confirmed T-30m candle." },
  { name: "a96_body_to_range_t15", category: "MODEL_STATE", source: "a96_predictions.r4_feature_snapshot", description: "Body-to-range of the confirmed T-15m candle." },
  { name: "a96_mean_two_body_to_range", category: "MODEL_STATE", source: "a96_predictions.mean_2_candle_body_to_range", description: "Mean body-to-range of the two prior confirmed candles." },
  { name: "a96_body_ratio_max", category: "MODEL_STATE", source: "a96_predictions.body_ratio_max", description: "Frozen r4 body-concentration maximum (0.65)." },
  { name: "a96_body_ratio_condition", category: "MODEL_STATE", source: "a96_predictions.body_ratio_condition", description: "True when mean two-candle body-to-range exceeded 0.65." },
  { name: "a96_body_ratio_veto_fired", category: "MODEL_STATE", source: "a96_predictions.body_ratio_veto_fired", description: "True when body concentration was the active ABSTAIN reason." },
  { name: "a96_four_candle_aligned_wick_pressure", category: "MODEL_STATE", source: "a96_predictions.four_candle_aligned_wick_pressure", description: "Mean direction-aligned wick pressure over the four prior confirmed candles." },
  { name: "a96_wick_pressure_max", category: "MODEL_STATE", source: "a96_predictions.wick_pressure_max", description: "Frozen r4 aligned wick-pressure maximum (0.20)." },
  { name: "a96_wick_pressure_condition", category: "MODEL_STATE", source: "a96_predictions.wick_pressure_condition", description: "True when aligned wick pressure exceeded 0.20." },
  { name: "a96_wick_pressure_veto_fired", category: "MODEL_STATE", source: "a96_predictions.wick_pressure_veto_fired", description: "True when wick pressure was the active ABSTAIN reason." },
  { name: "a96_prior_macd_hist", category: "MODEL_STATE", source: "a96_predictions.prior_macd_hist", description: "MACD histogram of the confirmed T-15m candle." },
  { name: "a96_prior_atr14", category: "MODEL_STATE", source: "a96_predictions.prior_atr14", description: "ATR14 (SMA of true range) at the confirmed T-15m candle." },
  { name: "a96_aligned_macd_hist_atr", category: "MODEL_STATE", source: "a96_predictions.aligned_macd_hist_atr", description: "(MACD histogram / ATR14) aligned with the Layer A direction." },
  { name: "a96_macd_veto_max", category: "MODEL_STATE", source: "a96_predictions.macd_veto_max", description: "Frozen r4 aligned MACD/ATR maximum (0.17)." },
  { name: "a96_macd_veto_condition", category: "MODEL_STATE", source: "a96_predictions.macd_veto_condition", description: "True when aligned MACD/ATR exceeded 0.17." },
  { name: "a96_macd_veto_fired", category: "MODEL_STATE", source: "a96_predictions.macd_veto_fired", description: "True when MACD momentum was the active ABSTAIN reason." },
  { name: "a96_technical_source_candle_time", category: "OPERATIONAL_AUDIT", source: "a96_predictions.technical_source_candle_time", description: "Timestamp of the confirmed candle that supplied MACD/ATR (must equal T-15m)." },
  { name: "a96_technical_source_candle_row_id", category: "OPERATIONAL_AUDIT", source: "a96_predictions.technical_source_candle_row_id", description: "Canonical candle row id behind the MACD/ATR snapshot." },
  { name: "a96_r4_input_candle_times", category: "OPERATIONAL_AUDIT", source: "a96_predictions.r4_input_candle_times", description: "The four prediction-time input candle timestamps (T-60..T-15)." },
  { name: "a96_r4_input_candle_row_ids", category: "OPERATIONAL_AUDIT", source: "a96_predictions.r4_input_candle_row_ids", description: "Canonical row ids of the four input candles." },
  { name: "a96_r4_feature_history_valid", category: "OPERATIONAL_AUDIT", source: "a96_predictions.r4_feature_history_valid", description: "False when required prediction-time feature history was unusable." },
  { name: "a96_r4_feature_history_error", category: "OPERATIONAL_AUDIT", source: "a96_predictions.r4_feature_history_error", description: "Reason the r4 feature history was unusable." },
  { name: "a96_r3_counterfactual_decision", category: "MODEL_STATE", source: "a96_predictions.r3_counterfactual_decision", description: "What frozen a96-r3 would have decided on the same inputs (audit only)." },
  { name: "a96_r3_counterfactual_direction", category: "MODEL_STATE", source: "a96_predictions.r3_counterfactual_direction", description: "Direction r3 would have published, or null when it would have abstained." },
  { name: "a96_r3_counterfactual_reason", category: "MODEL_STATE", source: "a96_predictions.r3_counterfactual_reason", description: "r3 counterfactual decision reason." },
  { name: "a96_r3_counterfactual_result", category: "RESOLUTION", source: "a96_predictions.r3_counterfactual_result", description: "WIN / LOSS / PUSH / ABSTAIN for the r3 counterfactual against canonical OHLC." },
  { name: "a96_r3_counterfactual_result_score", category: "RESOLUTION", source: "a96_predictions.r3_counterfactual_result_score", description: "+1 / -1 / 0 score for the r3 counterfactual." },
  { name: "a96_webhook_status", category: "OPERATIONAL_AUDIT", source: "a96_predictions.webhook_status", description: "NOT_APPLICABLE / PENDING / SENT / FAILED for the active a96 webhook." },
  { name: "a96_webhook_idempotency_key", category: "OPERATIONAL_AUDIT", source: "a96_predictions.webhook_idempotency_key", description: "prediction_id + model_version key that prevents duplicate sends." },
  { name: "a96_webhook_attempt_count", category: "OPERATIONAL_AUDIT", source: "a96_predictions.webhook_attempt_count", description: "Number of delivery attempts." },
  { name: "a96_webhook_sent_at", category: "OPERATIONAL_AUDIT", source: "a96_predictions.webhook_sent_at", description: "When the webhook was successfully delivered." },
  { name: "a96_webhook_last_error", category: "OPERATIONAL_AUDIT", source: "a96_predictions.webhook_last_error", description: "Last delivery error, when the webhook failed." },



];

// Availability flags -----------------------------------------------------
export const AVAILABILITY_COLUMNS: ColumnDef[] = [
  { name: "base_feature_tracking_available", category: "OPERATIONAL_AUDIT", source: "derived", description: "True when base predictions row contains stored feature snapshot." },
  { name: "partial_tracking_available", category: "OPERATIONAL_AUDIT", source: "derived", description: "True when partial-candle snapshot fields are populated." },
  { name: "orderbook_tracking_available", category: "OPERATIONAL_AUDIT", source: "derived", description: "True when orderbook telemetry is populated on the base row." },
  { name: "td1_tracking_available", category: "OPERATIONAL_AUDIT", source: "derived", description: "True when a TD1-RC shadow row exists for this boundary." },
  { name: "aas96_tracking_available", category: "OPERATIONAL_AUDIT", source: "derived", description: "True when an AAS96 shadow row exists for this boundary." },
  { name: "a96_tracking_available", category: "OPERATIONAL_AUDIT", source: "derived", description: "True when an a96 prediction row exists for this boundary." },
];

export const NEW_COLUMNS: ColumnDef[] = [
  ...CANONICAL_COLUMNS,
  ...LEGACY_FLAG_COLUMNS,
  ...PER_MODEL_CANONICAL_COLUMNS,
  ...SPINE_COLUMNS,
  ...TIMING_COLUMNS,
  ...CLASSIFICATION_COLUMNS,
  ...LINEAGE_COLUMNS,
  ...AVAILABILITY_COLUMNS,
];

export const UNIVERSAL_SCHEMA_VERSION = "btc15m-universal-v2";

export interface ManifestEntry {
  column_name: string;
  source_table: string;
  source_column_or_derivation: string;
  category: Category;
  prediction_time_safe: boolean;
  resolution_time_only: boolean;
  nullable: boolean;
  first_available_timestamp: string | null;
  model_or_schema_version_dependency: string | null;
  description: string;
}

export function toManifestEntry(def: ColumnDef, firstAvailable: string | null = null): ManifestEntry {
  const enriched = pt(def);
  return {
    column_name: def.name,
    source_table: def.source.split(".")[0] || def.source,
    source_column_or_derivation: def.derivation ?? def.source,
    category: def.category,
    prediction_time_safe: enriched.prediction_time_safe,
    resolution_time_only: enriched.resolution_time_only,
    nullable: def.nullable ?? true,
    first_available_timestamp: firstAvailable,
    model_or_schema_version_dependency: def.model_or_schema_dep ?? null,
    description: def.description,
  };
}

/**
 * Build manifest entries for every emitted column.  Legacy pass-through
 * columns get an OPERATIONAL_AUDIT stub with `prediction_time_safe=false`
 * when their name is in `legacyOutcomeNames`.
 */
export function buildManifest(
  emittedColumns: readonly string[],
  legacyOutcomeNames: ReadonlySet<string>,
  legacyResolutionNames: ReadonlySet<string>,
): ManifestEntry[] {
  const registry = new Map<string, ColumnDef>(NEW_COLUMNS.map((c) => [c.name, c]));
  const out: ManifestEntry[] = [];
  for (const col of emittedColumns) {
    const def = registry.get(col);
    if (def) { out.push(toManifestEntry(def)); continue; }
    // Legacy pass-through column.
    let cat: Category;
    if (legacyOutcomeNames.has(col)) cat = "LEGACY_OUTCOME";
    else if (legacyResolutionNames.has(col)) cat = "RESOLUTION_METADATA";
    else cat = "PREDICTION_TIME_FEATURE";
    out.push(
      toManifestEntry({
        name: col,
        category: cat,
        source: `legacy:${col}`,
        description: "Legacy pass-through column preserved verbatim from prior Universal CSV exporter.",
        nullable: true,
      }),
    );
  }
  return out;
}
