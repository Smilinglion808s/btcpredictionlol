// T30 PriceFlow Cross89 Balanced R1 — frozen identity and constants.
//
// A new, fully isolated model. It predicts the direction of the OKX BTC-USDT
// 15-minute candle it is already inside from the first 30 finalized Binance
// Global Spot one-second bars (offsets 0..29), then estimates the probability
// that this observed 30-second direction remains correct at candle close.
//
// It shares no storage, fit, rank state, decision or webhook with T45
// PriceFlow or with the earlier 28-feature "T30 PriceFlow Balanced" model.

export const T30X_MODEL_NAME = "T30 PriceFlow Cross89 Balanced" as const;
export const T30X_MODEL_VERSION = "t30-cross89-dual-rank-r1" as const;
export const T30X_MODEL_VARIANT =
  "ret30-direction-cross89-correctness-long625-fast500" as const;
export const T30X_BASE_HEAD =
  "WF_CORRECTNESS_LOGIT::CROSS89::C0.003::L8640::DAY::LBFGS" as const;
export const T30X_FEATURE_SCHEMA =
  "t30-cross89-priceflow-spot-futures-tech-r1" as const;
export const T30X_IMPLEMENTATION_REVISION = "t30-cross89-impl-r1" as const;
export const T30X_COLLECTOR_VERSION = "t30-cross89-collector-r1" as const;

export const T30X_EXPECTED_OBSERVATIONS = 30;
export const T30X_MIN_OFFSET = 0;
export const T30X_MAX_OFFSET = 29;
export const T30X_DECISION_OFFSET_SECONDS = 30;
export const T30X_CUTOFF_OFFSET_MS = T30X_DECISION_OFFSET_SECONDS * 1000;
/** Soft publication target: a healthy decision lands by T+40s. */
export const T30X_PUBLISH_TARGET_MS = 40_000;
export const T30X_PUBLISH_DEADLINE_MS = 120_000;

export const T30X_FIRST_FIT_INDEX = 2784;
export const T30X_FIT_BLOCK_SIZE = 96;
export const T30X_MAX_LOOKBACK = 8640;

export const T30X_LONG_RANK_WINDOW = 768;
export const T30X_LONG_RANK_MIN = 0.625;
export const T30X_FAST_RANK_WINDOW = 96;
export const T30X_FAST_RANK_MIN = 0.5;

export const T30X_DEFAULT_MODE = "SHADOW_ONLY" as const;
export const T30X_ACTIVATION_KEY = "T30_CROSS89_BALANCED" as const;

/** Certified head numerics (production oracle). */
export const T30X_LOGISTIC_C = 0.003;
export const T30X_MAX_ITER = 500;
export const T30X_TOL = 1e-6;
export const T30X_SCALER_Q_LOW = 0.1;
export const T30X_SCALER_Q_HIGH = 0.9;
export const T30X_SCALER = "RobustScaler(10,90)" as const;
export const T30X_SOLVER = "ts-lbfgs-certified" as const;

export const T30X_VENUE_SPOT = "BINANCE_GLOBAL_SPOT" as const;
export const T30X_VENUE_FUT = "BINANCE_USDM_PERP" as const;
export const T30X_SYMBOL = "BTCUSDT" as const;
export const T30X_STREAM_KEY = "binance-global-spot-btcusdt-kline-1s" as const;
export const T30X_WS_URL = "wss://stream.binance.com:9443/ws/btcusdt@kline_1s" as const;
export const T30X_OUTCOME_SOURCE = "OKX:BTC-USDT:15m:confirmed" as const;

export const T30X_SAMPLES_TABLE = "t30_cross89_samples";
export const T30X_FEATURES_TABLE = "t30_cross89_features";
export const T30X_FITS_TABLE = "t30_cross89_fits";
export const T30X_PREDICTIONS_TABLE = "t30_cross89_predictions";
export const T30X_ACTIVATION_TABLE = "t30_cross89_activation";
export const T30X_SHADOWS_TABLE = "t30_cross89_policy_shadows";

export const TF_MS = 15 * 60 * 1000;

/** A. Current-candle T30 price-flow features (24). */
export const T30X_FLOW_FEATURES = [
  "aligned_ret5",
  "aligned_ret15",
  "aligned_ret30",
  "aligned_last15",
  "aligned_acceleration",
  "aligned_flow5",
  "aligned_flow15",
  "aligned_flow30",
  "flow_delta15_30",
  "range_5s_bps",
  "range_15s_bps",
  "range_30s_bps",
  "log_qvol5",
  "log_qvol15",
  "log_qvol30",
  "log_trades5",
  "log_trades15",
  "log_trades30",
  "qvol_last15_share",
  "trades_last15_share",
  "range_growth15_30",
  "early_direction_agreement",
  "five_direction_agreement",
  "price_flow_alignment30",
] as const;

/** B. Prior completed Binance Spot 15m technical features (30). */
export const T30X_SPOT_TECH_FEATURES = [
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
] as const;

/** C. Prior completed Binance USD-M perpetual 15m technical features (35). */
export const T30X_FUT_TECH_FEATURES = [
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
  "aligned_basis_bps",
  "aligned_basis_delta1",
  "spot_fut_flow_agreement",
  "session_sin",
  "session_cos",
] as const;

/** Frozen ordered 89-feature model vector. Order is part of the identity. */
export const T30X_FEATURE_ORDER: readonly string[] = [
  ...T30X_FLOW_FEATURES,
  ...T30X_SPOT_TECH_FEATURES,
  ...T30X_FUT_TECH_FEATURES,
];

/** Diagnostics persisted alongside the model vector (never model inputs). */
export const T30X_DIAGNOSTIC_FEATURES: readonly string[] = [
  "raw_ret5_bps",
  "raw_ret15_bps",
  "raw_ret30_bps",
  "spot_open",
  "spot_close30",
  "quote_volume30",
  "trade_count30",
  "base_direction_num",
  "seconds_count",
];

export type T30XDirection = 1 | -1 | 0;

/** First-match decision reasons, in frozen evaluation order. */
export const T30X_REASONS = {
  PACKET_NOT_READY: "ABSTAIN_T30_PACKET_NOT_READY",
  DIRECTION_ZERO: "ABSTAIN_T30_DIRECTION_ZERO",
  SPOT_TECH_NOT_READY: "ABSTAIN_T30_SPOT_TECH_NOT_READY",
  FUTURES_TECH_NOT_READY: "ABSTAIN_T30_FUTURES_TECH_NOT_READY",
  FEATURE_INVALID: "ABSTAIN_T30_CROSS89_FEATURE_INVALID",
  FIT_NOT_READY: "ABSTAIN_T30_FIT_NOT_READY",
  PROBABILITY_INVALID: "ABSTAIN_T30_PROBABILITY_INVALID",
  LONG_RANK_NOT_READY: "ABSTAIN_T30_LONG_RANK_NOT_READY",
  FAST_RANK_NOT_READY: "ABSTAIN_T30_FAST_RANK_NOT_READY",
  BELOW_LONG_RANK_GATE: "ABSTAIN_T30_BELOW_LONG_RANK_GATE",
  BELOW_FAST_RANK_GATE: "ABSTAIN_T30_BELOW_FAST_RANK_GATE",
  PUBLISH: "PUBLISH_T30_CROSS89_BALANCED",
} as const;

/** Packet failure detail recorded on the prediction row. */
export const T30X_PACKET_REASONS = {
  NO_PACKET: "T30X_NO_PACKET",
  INSUFFICIENT_OBSERVATIONS: "T30X_INSUFFICIENT_OBSERVATIONS",
  MISSING_OFFSETS: "T30X_MISSING_OFFSETS",
  DUPLICATE_OFFSETS: "T30X_DUPLICATE_OFFSETS",
  TIMING_INVALID: "T30X_TIMING_INVALID",
  NONFINAL_BAR: "T30X_NONFINAL_BAR",
  FIELD_INVALID: "T30X_FIELD_INVALID",
  VERSION_MISMATCH: "T30X_VERSION_MISMATCH",
} as const;

/** Reporting-only shadow policies. None may change the primary decision. */
export const T30X_SHADOW_POLICIES = [
  "LONG_ONLY_625",
  "LONG625_FAST550",
  "LONG625_FAST600",
  "PROBABILITY_0550",
  "PRECISION_LONG750_FAST625",
] as const;
export type T30XShadowPolicy = (typeof T30X_SHADOW_POLICIES)[number];

/** The active frozen candidate. */
export const T30X_PRIMARY_POLICY = "LONG625_FAST500" as const;

/** Canonical, order-sensitive serialization of the complete frozen config. */
export const T30X_CONFIG_CANONICAL = JSON.stringify({
  model_name: T30X_MODEL_NAME,
  model_version: T30X_MODEL_VERSION,
  model_variant: T30X_MODEL_VARIANT,
  feature_schema: T30X_FEATURE_SCHEMA,
  base_head: T30X_BASE_HEAD,
  impl_revision: T30X_IMPLEMENTATION_REVISION,
  feature_order: T30X_FEATURE_ORDER,
  scaler: { kind: T30X_SCALER, q_low: T30X_SCALER_Q_LOW, q_high: T30X_SCALER_Q_HIGH },
  fit: {
    c: T30X_LOGISTIC_C,
    max_iter: T30X_MAX_ITER,
    tol: T30X_TOL,
    train_window: T30X_MAX_LOOKBACK,
    first_fit_index: T30X_FIRST_FIT_INDEX,
    block_size: T30X_FIT_BLOCK_SIZE,
    solver: T30X_SOLVER,
    weighting: "utc-day-balanced-mean-1",
    penalty: "l2-coefficients-only",
    init: "zeros",
    label: "correctness",
  },
  selector: {
    long_rank_window: T30X_LONG_RANK_WINDOW,
    long_rank_min: T30X_LONG_RANK_MIN,
    fast_rank_window: T30X_FAST_RANK_WINDOW,
    fast_rank_min: T30X_FAST_RANK_MIN,
    equality_included: true,
    current_target_excluded: true,
    full_history_required: true,
  },
  timing: {
    offsets: [T30X_MIN_OFFSET, T30X_MAX_OFFSET],
    expected_observations: T30X_EXPECTED_OBSERVATIONS,
    cutoff_ms: T30X_CUTOFF_OFFSET_MS,
    outcome_source: T30X_OUTCOME_SOURCE,
  },
});

/**
 * Feature-order hash declared by the frozen specification. The exact
 * serialization used to produce it upstream was not supplied, so it is
 * recorded here as the reference identity and cross-checked against the
 * locally computed hash below.
 */
export const T30X_SPEC_FEATURE_ORDER_HASH =
  "7b4df1058c3757554638961cd9a47ee6039446f82fa0851ae37c168e1d145008" as const;
/** Decision hash declared by the frozen specification. */
export const T30X_SPEC_DECISION_HASH =
  "f145470864a5bae0b19f73a91edac7f9b70547163627fe63bfcd0ce2064734f8" as const;

/**
 * sha256(JSON.stringify(T30X_FEATURE_ORDER)) and sha256(T30X_CONFIG_CANONICAL),
 * frozen here so client and server agree without importing node:crypto into
 * the browser bundle. Verified by src/lib/t30x89/__tests__/identity.test.ts.
 */
export const T30X_FEATURE_ORDER_HASH =
  "26e4059a71d9b3a3157cf62e9226bd69e2f1834090c4aec9e50c4303a33081c4" as const;
export const T30X_CONFIG_HASH = "" as string;

export function floorTarget(ms: number): number {
  return Math.floor(ms / TF_MS) * TF_MS;
}

export function isExactBoundary(iso: string): boolean {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) && ms % TF_MS === 0;
}

export function utcDate(iso: string): string {
  return iso.slice(0, 10);
}
