// T45 PriceFlow Q37.5 — frozen identity and constants.
//
// A NEW, self-contained model. It is not a repair of "T45 Balanced"
// (t45-balanced-q375-r1) and shares no identity, fit, prediction, activation
// or statistics storage with it. The unreproducible frozen R2 prior is
// physically absent from this feature vector and from its feature-order hash.
//
// Timing contract is unchanged: exactly 45 finalized Binance Global Spot
// BTCUSDT one-second bars at offsets 0..44 of the target candle, decided at
// T+45s, published before T+60s. Canonical outcome remains confirmed
// OKX BTC-USDT 15m OHLC.

export const MODEL_NAME = "T45 PriceFlow Q37.5" as const;
export const MODEL_VERSION = "t45-price-flow-q375-r1" as const;
export const MODEL_VARIANT = "spot-1s-price-flow-rank625" as const;
export const FEATURE_SCHEMA = "t45-spot-1s-offsets-0-44-price-flow-no-r2-r1" as const;
export const PUBLICATION_MODE = "SHADOW_ONLY" as const;

export const T45PF_BASE_HEAD = "WF_LOGIT::PRICE_FLOW_NO_R2::C0.003::L8640::DAY" as const;
export const T45PF_IMPL_REVISION = "t45pf-impl-r1" as const;
export const T45PF_ACTIVATION_KEY = "T45_PRICE_FLOW" as const;
export const T45PF_SOLVER = "ts-lbfgs-certified" as const;
export const T45PF_SCALER = "RobustScaler(10,90)" as const;

/** Storage. Old-model tables are never written by this model. */
export const T45PF_PREDICTIONS_TABLE = "t45_pf_predictions";
export const T45PF_FITS_TABLE = "t45_pf_fits";
export const T45PF_ACTIVATION_TABLE = "t45_pf_activation";

/**
 * Frozen feature order. Price/path block first, then trade-flow/activity.
 * Every r2_* field is physically excluded — not zeroed.
 */
export const T45PF_PRICE_FEATURES = [
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
] as const;

export const T45PF_FLOW_FEATURES = [
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

export const T45PF_FEATURE_ORDER: readonly string[] = [
  ...T45PF_PRICE_FEATURES,
  ...T45PF_FLOW_FEATURES,
];

/** Fields that must never appear in the model matrix. */
export const T45PF_FORBIDDEN_FEATURE_PREFIX = "t45_r2_";

/** Head mechanics — identical to the previous head except R2 removal. */
export const T45PF_LOGISTIC_C = 0.003;
export const T45PF_MAX_ITER = 5000;
export const T45PF_TOL = 1e-4;
export const T45PF_TRAIN_WINDOW = 8_640;
export const T45PF_MIN_TRAIN_ROWS = 2_688;
export const T45PF_BLOCK_SIZE = 96;
export const T45PF_FIRST_BLOCK_START = 2_688;
export const T45PF_SCALER_Q_LOW = 0.1;
export const T45PF_SCALER_Q_HIGH = 0.9;

/** Frozen Q37.5 publication selector. */
export const T45PF_RANK_WINDOW = 768;
export const T45PF_RANK_MIN_HISTORY = 192;
export const T45PF_RANK_THRESHOLD = 0.625;

/** Timing contract (shared numbers, independently declared). */
export const TF_MS = 15 * 60 * 1000;
export const T45PF_FIRST_OFFSET_S = 0;
export const T45PF_LAST_OFFSET_S = 44;
export const T45PF_EXPECTED_SECONDS = 45;
export const T45PF_CUTOFF_OFFSET_MS = 45_000;
export const T45PF_PUBLISH_DEADLINE_MS = 60_000;
export const T45PF_OUTCOME_SOURCE = "OKX:BTC-USDT:15m:confirmed" as const;
export const T45PF_STREAM_KEY = "binance-global-spot-btcusdt-kline-1s" as const;

export const T45PF_SLEEVE_TRADE = "Q375" as const;
export const T45PF_SLEEVE_NONE = "NONE" as const;

export type T45PFDirection = 1 | -1 | 0;

/** First-match decision reasons. R2 reasons can never occur here. */
export const T45PF_REASONS = {
  INACTIVE: "ABSTAIN_T45_PRICEFLOW_INACTIVE",
  PACKET_NOT_READY: "ABSTAIN_T45_PRICEFLOW_PACKET_NOT_READY",
  TIMING_INVALID: "ABSTAIN_T45_PRICEFLOW_TIMING_INVALID",
  FEATURE_INVALID: "ABSTAIN_T45_PRICEFLOW_FEATURE_INVALID",
  FIT_NOT_READY: "ABSTAIN_T45_PRICEFLOW_FIT_NOT_READY",
  FIT_UNCERTIFIED: "ABSTAIN_T45_PRICEFLOW_FIT_UNCERTIFIED",
  RANK_NOT_READY: "ABSTAIN_T45_PRICEFLOW_RANK_NOT_READY",
  BELOW_RANK_GATE: "ABSTAIN_T45_PRICEFLOW_BELOW_RANK_GATE",
  PUBLISH: "PUBLISH_T45_PRICEFLOW_Q375",
} as const;

/** Canonical, order-sensitive serialization of the complete frozen config. */
export const T45PF_CONFIG_CANONICAL = JSON.stringify({
  model_name: MODEL_NAME,
  model_version: MODEL_VERSION,
  model_variant: MODEL_VARIANT,
  feature_schema: FEATURE_SCHEMA,
  base_head: T45PF_BASE_HEAD,
  publication_mode: PUBLICATION_MODE,
  feature_order: T45PF_FEATURE_ORDER,
  scaler: { kind: T45PF_SCALER, q_low: T45PF_SCALER_Q_LOW, q_high: T45PF_SCALER_Q_HIGH },
  fit: {
    c: T45PF_LOGISTIC_C,
    max_iter: T45PF_MAX_ITER,
    tol: T45PF_TOL,
    train_window: T45PF_TRAIN_WINDOW,
    min_train_rows: T45PF_MIN_TRAIN_ROWS,
    block_size: T45PF_BLOCK_SIZE,
    first_block_start: T45PF_FIRST_BLOCK_START,
    solver: T45PF_SOLVER,
    weighting: "utc-day-balanced-mean-1",
    penalty: "l2-coefficients-only",
    init: "zeros",
  },
  selector: {
    rank_window: T45PF_RANK_WINDOW,
    rank_min_history: T45PF_RANK_MIN_HISTORY,
    rank_threshold: T45PF_RANK_THRESHOLD,
    equality_included: true,
    current_target_excluded: true,
  },
  timing: {
    offsets: [T45PF_FIRST_OFFSET_S, T45PF_LAST_OFFSET_S],
    expected_seconds: T45PF_EXPECTED_SECONDS,
    cutoff_ms: T45PF_CUTOFF_OFFSET_MS,
    deadline_ms: T45PF_PUBLISH_DEADLINE_MS,
    outcome_source: T45PF_OUTCOME_SOURCE,
  },
});

/**
 * sha256(T45PF_CONFIG_CANONICAL), computed once and frozen here so client and
 * server agree without importing node:crypto into the browser bundle.
 * Verified by src/lib/t45pf/__tests__/identity.test.ts.
 */
export const T45PF_CONFIG_HASH =
  "9b20f6a3c54c11b594aa659574780a6562831268e360c771b7ba1b3c21c238db" as const;

/** sha256 of the feature order alone — proves R2 is absent from the matrix. */
export const T45PF_FEATURE_ORDER_HASH =
  "3e487b3f291810e484e0b42033cbe98c378a0c218c25e6140691f117341820a5" as const;

/** Exact 15-minute UTC boundary at/preceding `ms`. */
export function floorTarget(ms: number): number {
  return Math.floor(ms / TF_MS) * TF_MS;
}

export function isExactBoundary(iso: string): boolean {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) && ms % TF_MS === 0;
}

export function utcDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

/** Boise-local calendar date (America/Denver) for daily reporting. */
export function boiseDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Boise" });
}
