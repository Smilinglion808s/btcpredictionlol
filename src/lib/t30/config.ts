// T30 PriceFlow Balanced R1 — frozen identity and constants.
//
// A new, fully isolated model. It predicts the direction of the OKX BTC-USDT
// 15-minute candle it is already inside, using only the first 30 finalized
// Binance Global Spot one-second bars (offsets 0..29) of that candle. It shares
// no storage, fit, rank state, decision or webhook with T45.

export const T30_MODEL_NAME = "T30 PriceFlow Balanced" as const;
export const T30_MODEL_VERSION = "t30-price-flow-balanced-r1" as const;
export const T30_MODEL_VARIANT = "spot-1s-price-flow-long625-fast500" as const;
export const T30_BASE_HEAD = "WF_LOGIT::PRICE_FLOW_T30::C0.003::L8640::DAY" as const;
export const T30_FEATURE_SCHEMA = "t30-spot-1s-offsets-0-29-price-flow-r1" as const;
export const T30_IMPLEMENTATION_REVISION = "t30pf-impl-r1" as const;
export const T30_COLLECTOR_VERSION = "t30-kline-collector-r1" as const;

export const T30_EXPECTED_OBSERVATIONS = 30;
export const T30_MIN_OFFSET = 0;
export const T30_MAX_OFFSET = 29;
export const T30_DECISION_OFFSET_SECONDS = 30;
export const T30_CUTOFF_OFFSET_MS = T30_DECISION_OFFSET_SECONDS * 1000;
/** Soft publication target: a healthy decision lands by T+40s. */
export const T30_PUBLISH_TARGET_MS = 40_000;
/** Hard deadline for an IMMEDIATE_BOUNDARY decision. */
export const T30_PUBLISH_DEADLINE_MS = 120_000;

export const T30_FIT_BLOCK_SIZE = 96;
export const T30_MIN_TRAINING_ROWS = 2784;
export const T30_MAX_TRAINING_LOOKBACK = 8640;
/** First block boundary at/after the minimum training requirement. */
export const T30_FIRST_BLOCK_START = 2784;

export const T30_LONG_RANK_WINDOW = 768;
export const T30_LONG_RANK_MIN = 0.625;
export const T30_FAST_RANK_WINDOW = 96;
export const T30_FAST_RANK_MIN = 0.5;

export const T30_DEFAULT_MODE = "SHADOW_ONLY" as const;
export const T30_ACTIVATION_KEY = "T30_PRICE_FLOW_BALANCED" as const;

export const T30_LOGISTIC_C = 0.003;
export const T30_MAX_ITER = 5000;
export const T30_TOL = 1e-4;
export const T30_SCALER_Q_LOW = 0.1;
export const T30_SCALER_Q_HIGH = 0.9;
export const T30_SCALER = "RobustScaler(10,90)" as const;
export const T30_SOLVER = "ts-lbfgs-certified" as const;

export const T30_VENUE = "BINANCE_GLOBAL" as const;
export const T30_SYMBOL = "BTCUSDT" as const;
export const T30_STREAM_KEY = "binance-global-spot-btcusdt-kline-1s" as const;
export const T30_WS_URL = "wss://stream.binance.com:9443/ws/btcusdt@kline_1s" as const;
export const T30_OUTCOME_SOURCE = "OKX:BTC-USDT:15m:confirmed" as const;

export const T30_SAMPLES_TABLE = "t30_samples";
export const T30_FEATURES_TABLE = "t30_features";
export const T30_FITS_TABLE = "t30_pf_fits";
export const T30_PREDICTIONS_TABLE = "t30_pf_predictions";
export const T30_ACTIVATION_TABLE = "t30_pf_activation";
export const T30_SHADOWS_TABLE = "t30_pf_policy_shadows";

export const TF_MS = 15 * 60 * 1000;

/** Frozen ordered 28-feature vector. Order is part of the model identity. */
export const T30_FEATURE_ORDER: readonly string[] = [
  "t30_ret_5s_bps",
  "t30_ret_10s_bps",
  "t30_ret_20s_bps",
  "t30_ret_30s_bps",
  "t30_quote_flow_5s",
  "t30_range_10s_bps",
  "t30_range_20s_bps",
  "t30_range_30s_bps",
  "t30_body_range_30s",
  "t30_last10_ret_bps",
  "t30_last20_ret_bps",
  "t30_quote_flow_10s",
  "t30_quote_flow_20s",
  "t30_quote_flow_30s",
  "t30_close_location_30s",
  "t30_close_vwap_gap_bps",
  "t30_log_trade_count_30s",
  "t30_path_efficiency_30s",
  "t30_return_sign_changes",
  "t30_log_quote_volume_30s",
  "t30_price_flow_alignment",
  "t30_realized_vol_30s_bps",
  "t30_return_accel_10_30_bps",
  "t30_return_sign_persistence",
  "t30_trade_count_last10_share",
  "t30_log_price_slope_bps_per_s",
  "t30_quote_volume_last10_share",
  "t30_path_direction_consistency",
];

/** Extra diagnostic columns persisted alongside the model vector. */
export const T30_DIAGNOSTIC_FEATURES: readonly string[] = [
  "t30_spot_open",
  "t30_close_30s",
  "t30_quote_volume_30s",
  "t30_trade_count_30s",
  "t30_partial_direction",
  "t30_seconds_count",
];

export type T30Direction = 1 | -1 | 0;

/** First-match decision reasons. */
export const T30_REASONS = {
  INACTIVE: "ABSTAIN_T30_INACTIVE",
  PACKET_NOT_READY: "ABSTAIN_T30_PACKET_NOT_READY",
  FEATURE_INVALID: "ABSTAIN_T30_FEATURE_INVALID",
  FIT_NOT_READY: "ABSTAIN_T30_PRICEFLOW_FIT_NOT_READY",
  PROBABILITY_INVALID: "ABSTAIN_T30_PROBABILITY_INVALID",
  LONG_RANK_NOT_READY: "ABSTAIN_T30_LONG_RANK_NOT_READY",
  FAST_RANK_NOT_READY: "ABSTAIN_T30_FAST_RANK_NOT_READY",
  BELOW_LONG_RANK_GATE: "ABSTAIN_T30_BELOW_LONG_RANK_GATE",
  BELOW_FAST_RANK_GATE: "ABSTAIN_T30_BELOW_FAST_RANK_GATE",
  PUBLISH: "PUBLISH_T30_PRICEFLOW_BALANCED",
} as const;

/** Packet failure reasons recorded on the prediction row. */
export const T30_PACKET_REASONS = {
  NO_PACKET: "T30_NO_PACKET",
  INSUFFICIENT_OBSERVATIONS: "T30_INSUFFICIENT_OBSERVATIONS",
  MISSING_OFFSETS: "T30_MISSING_OFFSETS",
  DUPLICATE_OFFSETS: "T30_DUPLICATE_OFFSETS",
  TIMING_INVALID: "T30_TIMING_INVALID",
  NONFINAL_BAR: "T30_NONFINAL_BAR",
  FEATURE_INVALID: "T30_FEATURE_INVALID",
  COLLECTOR_ERROR: "T30_COLLECTOR_ERROR",
} as const;

/** Reporting-only shadow policies. None may change the primary decision. */
export const T30_SHADOW_POLICIES = [
  "LONG_ONLY_Q375",
  "DUAL_RANK_BALANCED",
  "DUAL_RANK_PRECISION",
  "FLOW_CONFIRMED",
  "VOLATILITY_WITHOUT_FLOW",
] as const;
export type T30ShadowPolicy = (typeof T30_SHADOW_POLICIES)[number];

/** Canonical, order-sensitive serialization of the complete frozen config. */
export const T30_CONFIG_CANONICAL = JSON.stringify({
  model_name: T30_MODEL_NAME,
  model_version: T30_MODEL_VERSION,
  model_variant: T30_MODEL_VARIANT,
  feature_schema: T30_FEATURE_SCHEMA,
  base_head: T30_BASE_HEAD,
  impl_revision: T30_IMPLEMENTATION_REVISION,
  feature_order: T30_FEATURE_ORDER,
  scaler: { kind: T30_SCALER, q_low: T30_SCALER_Q_LOW, q_high: T30_SCALER_Q_HIGH },
  fit: {
    c: T30_LOGISTIC_C,
    max_iter: T30_MAX_ITER,
    tol: T30_TOL,
    train_window: T30_MAX_TRAINING_LOOKBACK,
    min_train_rows: T30_MIN_TRAINING_ROWS,
    block_size: T30_FIT_BLOCK_SIZE,
    first_block_start: T30_FIRST_BLOCK_START,
    solver: T30_SOLVER,
    weighting: "utc-day-balanced-mean-1",
    penalty: "l2-coefficients-only",
    init: "zeros",
  },
  selector: {
    long_rank_window: T30_LONG_RANK_WINDOW,
    long_rank_min: T30_LONG_RANK_MIN,
    fast_rank_window: T30_FAST_RANK_WINDOW,
    fast_rank_min: T30_FAST_RANK_MIN,
    equality_included: true,
    current_target_excluded: true,
    full_history_required: true,
  },
  timing: {
    offsets: [T30_MIN_OFFSET, T30_MAX_OFFSET],
    expected_observations: T30_EXPECTED_OBSERVATIONS,
    cutoff_ms: T30_CUTOFF_OFFSET_MS,
    outcome_source: T30_OUTCOME_SOURCE,
  },
});

/**
 * sha256 of the canonical config / of the feature order alone. Frozen here so
 * client and server agree without pulling node:crypto into the browser bundle.
 * Verified by src/lib/t30/__tests__/identity.test.ts.
 */
export const T30_CONFIG_HASH = "9cffa47d20199d8f66b728b8d20ff49281d86be6c6c41880c8034672e2db9be4";
export const T30_FEATURE_ORDER_HASH = "5d25a446e95d92d4bfb9fc71df4274c16097572b8c2b3006b4766785e7cff1ed";

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

/** Boise-local calendar date (America/Boise) for daily reporting. */
export function boiseDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-CA", { timeZone: "America/Boise" });
}
