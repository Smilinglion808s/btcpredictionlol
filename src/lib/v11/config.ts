// Version 1.1 — combined stream identity and frozen constants.
//
// Version 1.1 is a DISPLAY/decision COMBINATION of two legs:
//   leg "V1"     — the original lite-a-floor4-top10-r1 decision, unchanged.
//                  Its math, guard, rank, identity, state and send timing are
//                  never touched by anything in this directory.
//   leg "T45R2"  — the improved T45 R2 candidate CONTEXT69_NORM_38, evaluated
//                  at T+45 and only ever admitted as a FALLBACK when the V1 leg
//                  committed a valid CONFIDENCE_ABSTAIN with the ordinary daily
//                  floor recorded open and final_side 0.
//
// Everything here is shadow-only: no real-bet dispatch path exists in this
// module set. One model bet per interval, V1 has priority at T+5.

export const V11_MODEL_NAME = "Version 1.1" as const;
export const V11_MODEL_VERSION = "v11-original-confidence-rank80-4" as const;
export const V11_CANDIDATE_VERSION = "t45-r2-context69-norm-38-r1" as const;
export const V11_FEATURE_SCHEMA = "CONTEXT69_NORM_38" as const;
export const V11_SOLVER = "ts-lbfgs-certified" as const;
export const V11_SCALER = "RobustScaler(10,90)" as const;
export const V11_PUBLICATION_MODE = "SHADOW_ONLY" as const;
export const V11_POLICY_VERSION = "v11-shadow-r1" as const;

/** Original V1 identity that this stream reads (never writes). */
export const V1_MODEL_VERSION = "lite-a-floor4-top10-r1" as const;
export const V1_LOW_CONFIDENCE_REASON = "CONFIDENCE_ABSTAIN" as const;

/** Storage — isolated v11_* tables only. */
export const V11_CONTEXT_TABLE = "v11_context_rows";
export const V11_HEADS_TABLE = "v11_heads";
export const V11_SCORES_TABLE = "v11_scores";
export const V11_DECISIONS_TABLE = "v11_decisions";
export const V11_STATE_TABLE = "v11_state";
export const V11_STATE_KEY = "v11-shadow";

/** The 28 T45 PriceFlow inputs, in frozen order, prefixed `feature_`. */
export const V11_T45_BASE_ORDER = [
  "t45_ret_5s_bps",
  "t45_ret_15s_bps",
  "t45_ret_30s_bps",
  "t45_ret_45s_bps",
  "t45_last15_ret_bps",
  "t45_last30_ret_bps",
  "t45_return_accel_15_45_bps",
  "t45_range_15s_bps",
  "t45_range_30s_bps",
  "t45_range_45s_bps",
  "t45_body_range_45s",
  "t45_close_location_45s",
  "t45_path_efficiency_45s",
  "t45_realized_vol_45s_bps",
  "t45_log_price_slope_bps_per_s",
  "t45_return_sign_persistence",
  "t45_return_sign_changes",
  "t45_close_vwap_gap_bps",
  "t45_path_direction_consistency",
  "t45_quote_flow_5s",
  "t45_quote_flow_15s",
  "t45_quote_flow_30s",
  "t45_quote_flow_45s",
  "t45_quote_volume_last15_share",
  "t45_trade_count_last15_share",
  "t45_price_flow_alignment",
  "t45_log_quote_volume_45s",
  "t45_log_trade_count_45s",
] as const;

/**
 * The original, un-imputed V1 DIRECTION_FEATURES_CM_BOTH 60-field schema, in
 * its canonical order. Written by the V1 worker into
 * c85_targets.features.direction60 with these exact (unprefixed) names.
 */
export const V1_DIRECTION60_ORDER = [
  "anchor_t0_basis_bps",
  "anchor_t5_basis_bps",
  "binance_spot_t5_w001_return_bps",
  "binance_spot_t5_w001_flow_imbalance",
  "log1p_binance_spot_t5_w001_quote_volume",
  "binance_spot_t5_w002_return_bps",
  "binance_spot_t5_w002_flow_imbalance",
  "log1p_binance_spot_t5_w002_quote_volume",
  "binance_spot_t5_w003_return_bps",
  "binance_spot_t5_w003_flow_imbalance",
  "log1p_binance_spot_t5_w003_quote_volume",
  "binance_spot_t5_w005_return_bps",
  "binance_spot_t5_w005_flow_imbalance",
  "log1p_binance_spot_t5_w005_quote_volume",
  "binance_spot_t5_w005_range_bps",
  "binance_spot_t5_w005_price_flow_alignment",
  "binance_spot_t0_w060_return_bps",
  "binance_spot_t0_w060_flow_imbalance",
  "binance_spot_t0_w900_return_bps",
  "binance_spot_t0_w900_flow_imbalance",
  "binance_um_t5_w001_return_bps",
  "binance_um_t5_w001_flow_imbalance",
  "log1p_binance_um_t5_w001_quote_volume",
  "binance_um_t5_w002_return_bps",
  "binance_um_t5_w002_flow_imbalance",
  "log1p_binance_um_t5_w002_quote_volume",
  "binance_um_t5_w003_return_bps",
  "binance_um_t5_w003_flow_imbalance",
  "log1p_binance_um_t5_w003_quote_volume",
  "binance_um_t5_w005_return_bps",
  "binance_um_t5_w005_flow_imbalance",
  "log1p_binance_um_t5_w005_quote_volume",
  "binance_um_t5_w005_range_bps",
  "binance_um_t5_w005_price_flow_alignment",
  "binance_um_t0_w060_return_bps",
  "binance_um_t0_w060_flow_imbalance",
  "binance_um_t0_w900_return_bps",
  "binance_um_t0_w900_flow_imbalance",
  "binance_cross_t5_flow_agreement_5s",
  "binance_cross_t5_flow_gap_5s",
  "binance_cross_t5_return_agreement_5s",
  "binance_cross_t5_return_gap_5s",
  "utc_time_sin",
  "utc_time_cos",
  "utc_dow_sin",
  "utc_dow_cos",
  "usdc_anchor_t0_basis_bps",
  "usdc_anchor_t5_basis_bps",
  "quote_premium_bps",
  "index_anchor_t0_basis_bps",
  "index_anchor_t5_basis_bps",
  "index_spot_basis_bps",
  "cm_ret1",
  "cm_ret15",
  "cm_flow1",
  "cm_flow15",
  "cm_basis",
  "cm_basis_change15",
  "cm_flow_excess15",
  "cm_log_volume15",
] as const;

/**
 * CONTEXT69 context block: the full 60 minus every name containing
 * `_w001_`, `_w002_`, `_w003_`, minus exactly `cm_flow1` (not `cm_flow15`).
 * 60 - 18 - 1 = 41.
 */
export const V11_CTX_BASE_ORDER: readonly string[] = V1_DIRECTION60_ORDER.filter(
  (n) =>
    !n.includes("_w001_") &&
    !n.includes("_w002_") &&
    !n.includes("_w003_") &&
    n !== "cm_flow1",
);

/** The 10 normalized base fields (prefixed names as they appear in the row). */
export const V11_NORM_BASE_FIELDS = [
  "feature_t45_ret_45s_bps",
  "feature_t45_ret_15s_bps",
  "feature_t45_last15_ret_bps",
  "feature_t45_range_45s_bps",
  "feature_t45_realized_vol_45s_bps",
  "ctx_index_anchor_t0_basis_bps",
  "ctx_index_anchor_t5_basis_bps",
  "ctx_binance_spot_t5_w005_return_bps",
  "ctx_binance_um_t0_w900_return_bps",
  "ctx_cm_ret15",
] as const;

export const V11_NORM_DISPLACEMENT = "norm_approx_index_displacement45" as const;

/** Frozen 80-input order: 28 feature_ + 41 ctx_ + 11 norm_. */
export const V11_FEATURE_ORDER: readonly string[] = [
  ...V11_T45_BASE_ORDER.map((n) => `feature_${n}`),
  ...V11_CTX_BASE_ORDER.map((n) => `ctx_${n}`),
  ...V11_NORM_BASE_FIELDS.map((n) => `norm_${n}`),
  V11_NORM_DISPLACEMENT,
];

/**
 * Volatility scaler for the normalized block. The field is read from the RAW
 * un-prefixed direction60 map; its prefixed model name is
 * `ctx_binance_spot_t0_w900_return_bps`.
 */
export const V11_VOL_SOURCE = "binance_spot_t0_w900_return_bps" as const;
export const V11_VOL_SOURCE_MODEL_NAME = `ctx_${V11_VOL_SOURCE}` as const;
export const V11_VOL_WINDOW = 96;
export const V11_VOL_MIN_FINITE = 24;
export const V11_VOL_CLIP = 200;
export const V11_VOL_FLOOR_BPS = 5;
export const V11_NORM_CLIP = 10;

/** Daily UTC fit. */
export const V11_TRAIN_DAYS = 90;
export const V11_MIN_TRAIN_ROWS = 2_688;
export const V11_LOGISTIC_C = 0.003;
export const V11_MAX_ITER = 5_000;
export const V11_TOL = 1e-4;
export const V11_SCALER_Q_LOW = 0.1;
export const V11_SCALER_Q_HIGH = 0.9;

/** Rank / availability / admission. */
export const V11_RANK_WINDOW = 768;
export const V11_RANK_MIN_HISTORY = 192;
export const V11_AVAILABILITY_WINDOW = 768;
export const V11_AVAILABILITY_MIN = 192;
export const V11_AVAILABILITY_NUMERATOR = 0.38;

/** Outer Version 1.1 fallback selector (NOT a probability). */
export const V11_FALLBACK_MIN_RANK = 0.8;

/** Strategy metadata only — the external betting bot sizes and executes. */
export const V11_STAKE_FRACTION_OF_BOISE_OPEN = 0.04;

/**
 * Event-time feature cutoff for the T45 leg: exactly T+45s. This is a clock
 * boundary in the feature definition, NOT a claim that inputs are in hand at
 * 45000ms. Real last-bar receipts land at ~45134-45224ms and are persisted at
 * ~45262-45378ms; those measured instants are recorded separately.
 */
export const V11_EVENT_CUTOFF_OFFSET_MS = 45_000;

/** A decision produced later than this after the open is not publishable. */
export const V11_PUBLICATION_CEILING_MS = 60_000;

export const TF_MS = 15 * 60 * 1000;
export const V11_T5_OFFSET_MS = 5_000;
export const V11_T45_OFFSET_MS = 45_000;

export type V11Direction = 1 | -1 | 0;
export type V11Leg = "V1" | "T45R2";

export const V11_REASONS = {
  V1_CALL: "V11_V1_CALL",
  MISSING_CONTEXT: "V11_ABSTAIN_MISSING_CONTEXT",
  MISSING_T45: "V11_ABSTAIN_MISSING_T45",
  NON_FINITE_INPUT: "V11_ABSTAIN_NON_FINITE_INPUT",
  VOL_NOT_READY: "V11_ABSTAIN_VOL_NOT_READY",
  HEAD_NOT_READY: "V11_ABSTAIN_HEAD_NOT_READY",
  HEAD_EXPIRED: "V11_ABSTAIN_HEAD_EXPIRED",
  HEAD_UNCERTIFIED: "V11_ABSTAIN_HEAD_UNCERTIFIED",
  RANK_NOT_READY: "V11_ABSTAIN_RANK_NOT_READY",
  AVAILABILITY_NOT_READY: "V11_ABSTAIN_AVAILABILITY_NOT_READY",
  BELOW_ADMISSION_GATE: "V11_ABSTAIN_BELOW_ADMISSION_GATE",
  BELOW_FALLBACK_RANK: "V11_ABSTAIN_BELOW_FALLBACK_RANK",
  V1_NOT_RESOLVED: "V11_ABSTAIN_V1_NOT_RESOLVED",
  V1_NOT_ELIGIBLE: "V11_ABSTAIN_V1_NOT_ELIGIBLE",
  V1_FLOOR_CLOSED: "V11_ABSTAIN_V1_FLOOR_CLOSED",
  V1_LEG_OCCUPIES_INTERVAL: "V11_ABSTAIN_V1_LEG_OCCUPIES_INTERVAL",
  V1_DELIVERY_AMBIGUOUS: "V11_ABSTAIN_V1_DELIVERY_AMBIGUOUS",
  FALLBACK_CALL: "V11_T45R2_FALLBACK_CALL",
  HEAD_QUARANTINED: "V11_ABSTAIN_HEAD_QUARANTINED",
  HEAD_CONFIG_MISMATCH: "V11_ABSTAIN_HEAD_CONFIG_MISMATCH",
  AVAILABILITY_ZERO: "V11_ABSTAIN_AVAILABILITY_ZERO",
  V1_READ_FAILED: "V11_ABSTAIN_V1_READ_FAILED",
  LATE_PUBLICATION: "V11_ABSTAIN_LATE_PUBLICATION",
} as const;

export function utcDate(ts: string | Date): string {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  return d.toISOString().slice(0, 10);
}

/** UTC midnight strictly after `ts` — the expiry instant of a daily head. */
export function nextUtcMidnight(ts: string | Date): string {
  const d = typeof ts === "string" ? new Date(ts) : ts;
  const next = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1, 0, 0, 0, 0),
  );
  return next.toISOString();
}

/** Canonical event identity for a Version 1.1 interval decision. */
export function v11EventKey(ticker: string, targetTs: string): string {
  return `${V11_MODEL_VERSION}:${ticker}:${new Date(targetTs).toISOString()}`;
}

export const V11_CONFIG_CANONICAL = JSON.stringify({
  model_version: V11_MODEL_VERSION,
  candidate_version: V11_CANDIDATE_VERSION,
  feature_schema: V11_FEATURE_SCHEMA,
  feature_order: V11_FEATURE_ORDER,
  scaler: { kind: V11_SCALER, q_low: V11_SCALER_Q_LOW, q_high: V11_SCALER_Q_HIGH },
  fit: {
    c: V11_LOGISTIC_C,
    tol: V11_TOL,
    max_iter: V11_MAX_ITER,
    train_days: V11_TRAIN_DAYS,
    min_train_rows: V11_MIN_TRAIN_ROWS,
    solver: V11_SOLVER,
    weighting: "utc-day-balanced-mean-1",
    cadence: "daily-utc-midnight",
  },
  vol: {
    source: V11_VOL_SOURCE_MODEL_NAME,
    window: V11_VOL_WINDOW,
    min_finite: V11_VOL_MIN_FINITE,
    clip: V11_VOL_CLIP,
    floor_bps: V11_VOL_FLOOR_BPS,
    includes_current_row: true,
  },
  rank: {
    window: V11_RANK_WINDOW,
    min_history: V11_RANK_MIN_HISTORY,
    ties: "midpoint",
    availability_window: V11_AVAILABILITY_WINDOW,
    availability_min: V11_AVAILABILITY_MIN,
    gate: "clip(1 - 0.38/availability, 0, 1)",
    fallback_min_rank: V11_FALLBACK_MIN_RANK,
  },
  strategy: {
    stake_fraction_of_boise_day_opening_principal: V11_STAKE_FRACTION_OF_BOISE_OPEN,
    one_bet_per_interval: true,
    v1_priority_at_t5: true,
    fallback_at_t45: true,
  },
  publication_mode: V11_PUBLICATION_MODE,
  policy_version: V11_POLICY_VERSION,
});

/**
 * How an observation was produced. Only LIVE_SHADOW rows may be presented as
 * live evidence; they require the signed T+45 hook, a receipt that actually
 * arrived, and a decision inside the publication ceiling.
 */
export type V11RunMode = "LIVE_SHADOW" | "RESEARCH" | "RECOVERY";

export const V11_RUN_MODES = {
  LIVE: "LIVE_SHADOW",
  RESEARCH: "RESEARCH",
  RECOVERY: "RECOVERY",
} as const;

/** Stable 64-bit FNV-style digest used to bind heads to their configuration. */
export function v11Digest(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + s.charCodeAt(i) + 1, 2246822519) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export const V11_FEATURE_ORDER_HASH = v11Digest(V11_FEATURE_ORDER.join(","));
export const V11_CONFIG_FINGERPRINT = v11Digest(V11_CONFIG_CANONICAL);

export const V11_EXTRA_REASONS = {
  HEAD_QUARANTINED: "V11_ABSTAIN_HEAD_QUARANTINED",
  HEAD_CONFIG_MISMATCH: "V11_ABSTAIN_HEAD_CONFIG_MISMATCH",
  AVAILABILITY_ZERO: "V11_ABSTAIN_AVAILABILITY_ZERO",
  V1_READ_FAILED: "V11_ABSTAIN_V1_READ_FAILED",
  LATE_PUBLICATION: "V11_ABSTAIN_LATE_PUBLICATION",
  PREDECESSOR_MISSING: "V11_PREDECESSOR_MISSING",
} as const;
