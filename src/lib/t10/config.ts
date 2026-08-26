// T10 Bridge R1 — frozen identity and constants.
//
// A new, fully isolated model. It predicts the direction of the OKX BTC-USDT
// 15-minute candle it is already inside from ONLY the first ten finalized
// Binance Global Spot one-second bars (offsets 0..9), plus completed-candle
// Spot/Futures technicals. It shares no storage, fit, rank state, decision or
// webhook with T30, T45, ES1, A2 or V6.

export const T10_MODEL_NAME = "T10 Bridge" as const;
export const T10_BRIDGE_VERSION = "t10-bridge-r1" as const;
export const T10_BRIDGE_VARIANT = "cross94-c0003-dual-rank" as const;
export const T10_FEATURE_SCHEMA = "t10-cross94-r1" as const;
export const T10_IMPLEMENTATION_REVISION = "t10-bridge-impl-r1" as const;
export const T10_COLLECTOR_VERSION = "t10-kline-collector-r1" as const;

/** Immutable indexing epoch. Block boundaries anchor here, never to a deploy. */
export const T10_SOURCE_EPOCH = "2025-12-01T00:00:00.000Z" as const;

export const T10_FIRST_FIT_INDEX = 2784;
export const T10_REFIT_BLOCK = 96;
export const T10_TRAINING_LOOKBACK = 8640;

export const T10_LONG_RANK_WINDOW = 768;
export const T10_FAST_RANK_WINDOW = 96;

export const T10_LONG_RANK_FLOOR = 0.75;
export const T10_FAST_RANK_FLOOR = 0.6;

export const T10_LOGISTIC_C = 0.0003;
export const T10_SCALER_QUANTILES = [10, 90] as const;
export const T10_SCALER_Q_LOW = 0.1;
export const T10_SCALER_Q_HIGH = 0.9;
export const T10_MAX_ITER = 2000;
export const T10_TOL = 1e-6;
export const T10_SCALER = "RobustScaler(10,90)" as const;
export const T10_SOLVER = "ts-lbfgs-certified" as const;

export const T10_FEATURE_ORDER_HASH =
  "be0a3e5de21d54a831c85ad9e53042fb5af8976c23147c197b2ac90deca1c21f";
export const T10_CONFIG_HASH =
  "82fda0f1a91d5d7dc17ffeff590e8bcb914305db27cd2b5c6f8116ed6abf045c";

export const T10_EXPECTED_OBSERVATIONS = 10;
export const T10_MIN_OFFSET = 0;
export const T10_MAX_OFFSET = 9;
export const T10_DECISION_OFFSET_SECONDS = 10;
export const T10_CUTOFF_OFFSET_MS = T10_DECISION_OFFSET_SECONDS * 1000;
/** Hard deadline for a boundary-triggered decision. */
export const T10_PUBLISH_DEADLINE_MS = 120_000;

export const T10_VENUE = "BINANCE_GLOBAL" as const;
export const T10_SYMBOL = "BTCUSDT" as const;
export const T10_STREAM_KEY = "binance-global-spot-btcusdt-kline-1s-t10" as const;
export const T10_WS_URL = "wss://stream.binance.com:9443/ws/btcusdt@kline_1s" as const;
export const T10_OUTCOME_SOURCE = "OKX:BTC-USDT:15m:confirmed" as const;

export const T10_SAMPLES_TABLE = "t10_bridge_samples";
export const T10_FITS_TABLE = "t10_bridge_fits";
export const T10_PREDICTIONS_TABLE = "t10_bridge_predictions";
export const T10_ACTIVATION_TABLE = "t10_bridge_activation";
export const T10_ACTIVATION_KEY = "T10_BRIDGE" as const;
export const T10_HEALTH_TABLE = "t10_collector_health";

export const TF_MS = 15 * 60 * 1000;

/** The 29 current-packet features, in frozen order. */
export const T10_PACKET_FEATURE_ORDER: readonly string[] = [
  "aligned_ret5",
  "aligned_ret10",
  "aligned_last5",
  "aligned_last3",
  "aligned_acceleration5_10",
  "aligned_flow5",
  "aligned_flow10",
  "aligned_flow_last5",
  "aligned_flow_delta5_10",
  "t10_range_5s_bps",
  "t10_range_10s_bps",
  "log_qvol5",
  "log_qvol10",
  "log_trades5",
  "log_trades10",
  "t10_quote_volume_last5_share",
  "t10_trade_count_last5_share",
  "range_growth5_10",
  "five_direction_agreement",
  "price_flow_alignment10",
  "body_range10",
  "directional_close_location10",
  "t10_path_efficiency_10s",
  "t10_realized_vol_10s_bps",
  "aligned_price_slope10",
  "t10_return_sign_persistence",
  "t10_return_sign_changes",
  "aligned_vwap_gap10",
  "t10_path_direction_consistency",
];

/** Completed-candle Spot technical block, in frozen order. */
export const T10_SPOT_TECHNICAL_ORDER: readonly string[] = [
  "aligned_ret1",
  "aligned_ret4",
  "aligned_ret8",
  "aligned_ret16",
  "aligned_body_atr",
  "aligned_wick_balance",
  "aligned_ema9_21_atr",
  "aligned_macd_hist_atr",
  "aligned_rsi_centered",
  "aligned_stoch_centered",
  "aligned_di_spread",
  "aligned_bb_position",
  "aligned_taker_flow1",
  "aligned_taker_flow4",
  "aligned_taker_flow8",
  "aligned_taker_flow_delta",
  "aligned_trend_signed_age",
  "directional_wick_threat",
  "directional_wick_support",
  "aligned_failed_breakout",
  "efficiency8",
  "adx14",
  "range_atr",
  "atr_ratio4_14",
  "vol_ratio4_16",
  "bb_width",
  "volume_z20",
  "trade_count_z20",
  "sign_persistence8",
  "sign_changes8",
];

/** Completed-candle USD-M Perpetual block, in frozen order. */
export const T10_FUT_TECHNICAL_ORDER: readonly string[] = [
  "aligned_fut_ret1",
  "aligned_fut_ret4",
  "aligned_fut_ret8",
  "aligned_fut_ret16",
  "aligned_fut_body_atr",
  "aligned_fut_wick_balance",
  "aligned_fut_ema9_21_atr",
  "aligned_fut_macd_hist_atr",
  "aligned_fut_rsi_centered",
  "aligned_fut_stoch_centered",
  "aligned_fut_di_spread",
  "aligned_fut_bb_position",
  "aligned_fut_taker_flow1",
  "aligned_fut_taker_flow4",
  "aligned_fut_taker_flow8",
  "aligned_fut_taker_flow_delta",
  "aligned_fut_trend_signed_age",
  "fut_directional_wick_threat",
  "fut_directional_wick_support",
  "aligned_fut_failed_breakout",
  "fut_efficiency8",
  "fut_adx14",
  "fut_range_atr",
  "fut_atr_ratio4_14",
  "fut_vol_ratio4_16",
  "fut_bb_width",
  "fut_volume_z20",
  "fut_trade_count_z20",
  "fut_sign_persistence8",
  "fut_sign_changes8",
];

/** Cross-venue and session terms closing the vector. */
export const T10_CROSS_ORDER: readonly string[] = [
  "aligned_basis_bps",
  "aligned_basis_delta1",
  "spot_fut_flow_agreement",
  "session_sin",
  "session_cos",
];

/** The frozen 94-feature model input order. Order is part of the identity. */
export const T10_FEATURE_ORDER: readonly string[] = [
  ...T10_PACKET_FEATURE_ORDER,
  ...T10_SPOT_TECHNICAL_ORDER,
  ...T10_FUT_TECHNICAL_ORDER,
  ...T10_CROSS_ORDER,
];

export type T10Direction = 1 | -1 | 0;

/** First-match decision reasons. */
export const T10_REASONS = {
  PACKET_NOT_READY: "ABSTAIN_T10_PACKET_NOT_READY",
  PRIOR_TECHNICALS_NOT_READY: "ABSTAIN_T10_PRIOR_TECHNICALS_NOT_READY",
  FEATURES_INVALID: "ABSTAIN_T10_FEATURES_INVALID",
  FIT_NOT_CERTIFIED: "ABSTAIN_T10_FIT_NOT_CERTIFIED",
  RANK_STATE_NOT_READY: "ABSTAIN_T10_RANK_STATE_NOT_READY",
  BASE_DIRECTION_FLAT: "ABSTAIN_T10_BASE_DIRECTION_FLAT",
  LONG_RANK_BELOW: "ABSTAIN_T10_LONG_RANK_BELOW_075",
  FAST_RANK_BELOW: "ABSTAIN_T10_FAST_RANK_BELOW_060",
  ACTIVATION_NOT_REACHED: "ABSTAIN_T10_ACTIVATION_NOT_REACHED",
  PUBLISH: "PUBLISH_T10_BRIDGE",
} as const;

/** Packet failure reasons recorded on the prediction row. */
export const T10_PACKET_REASONS = {
  NO_PACKET: "T10_NO_PACKET",
  INSUFFICIENT_OBSERVATIONS: "T10_INSUFFICIENT_OBSERVATIONS",
  MISSING_OFFSETS: "T10_MISSING_OFFSETS",
  DUPLICATE_OFFSETS: "T10_DUPLICATE_OFFSETS",
  OFFSET_OUT_OF_RANGE: "T10_OFFSET_OUT_OF_RANGE",
  TIMING_INVALID: "T10_TIMING_INVALID",
  NONFINAL_BAR: "T10_NONFINAL_BAR",
  NON_FINITE_VALUE: "T10_NON_FINITE_VALUE",
  COLLECTOR_ERROR: "T10_COLLECTOR_ERROR",
} as const;

/** Canonical, order-sensitive serialization of the complete frozen config. */
export const T10_CONFIG_CANONICAL = JSON.stringify({
  model_name: T10_MODEL_NAME,
  model_version: T10_BRIDGE_VERSION,
  model_variant: T10_BRIDGE_VARIANT,
  feature_schema: T10_FEATURE_SCHEMA,
  impl_revision: T10_IMPLEMENTATION_REVISION,
  source_epoch: T10_SOURCE_EPOCH,
  feature_order: T10_FEATURE_ORDER,
  scaler: { kind: T10_SCALER, quantiles: T10_SCALER_QUANTILES },
  fit: {
    c: T10_LOGISTIC_C,
    max_iter: T10_MAX_ITER,
    tol: T10_TOL,
    train_window: T10_TRAINING_LOOKBACK,
    first_fit_index: T10_FIRST_FIT_INDEX,
    refit_block: T10_REFIT_BLOCK,
    solver: T10_SOLVER,
    weighting: "utc-day-balanced-mean-1",
    penalty: "l2-coefficients-only",
    head: "correctness",
  },
  selector: {
    long_rank_window: T10_LONG_RANK_WINDOW,
    long_rank_floor: T10_LONG_RANK_FLOOR,
    fast_rank_window: T10_FAST_RANK_WINDOW,
    fast_rank_floor: T10_FAST_RANK_FLOOR,
    equality_included: true,
    current_target_excluded: true,
    full_history_required: true,
  },
  timing: {
    offsets: [T10_MIN_OFFSET, T10_MAX_OFFSET],
    expected_observations: T10_EXPECTED_OBSERVATIONS,
    cutoff_ms: T10_CUTOFF_OFFSET_MS,
    outcome_source: T10_OUTCOME_SOURCE,
  },
});

export const T10_SOURCE_EPOCH_MS = Date.parse(T10_SOURCE_EPOCH);

/** Absolute source index of a target, anchored to the immutable epoch. */
export function t10SourceIndex(targetTs: string | number): number {
  const ms = typeof targetTs === "number" ? targetTs : Date.parse(targetTs);
  return Math.floor((ms - T10_SOURCE_EPOCH_MS) / TF_MS);
}

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
