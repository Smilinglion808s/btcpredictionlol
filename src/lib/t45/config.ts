// T45 Balanced — frozen identity and constants.
//
// Standalone active-candidate model. It is NOT a patch to ES1, B4x4, A2,
// TD1/TD2 or V6, shares no state with them, and cannot alter their decisions.
//
// Decision cutoff is exactly T+45s inside the target 15-minute candle: the
// model observes the first 45 one-second Binance Spot bars of the candle it
// predicts, then publishes before T+60s.

export const T45_MODEL_NAME = "T45 Balanced" as const;
export const T45_MODEL_VERSION = "t45-balanced-q375-r1" as const;
export const T45_MODEL_VARIANT = "frozen-r2-price-flow-rank625" as const;
export const T45_BASE_HEAD = "WF_LOGIT::R2_PRICE_FLOW::C0.003::L8640::DAY" as const;
export const T45_FEATURE_VERSION = "t45-features-r1" as const;
export const T45_COLLECTOR_VERSION = "t45-kline-collector-r1" as const;
export const T45_FREEZE_SHA256 =
  "6b4cd71a91d06f2b1b232cb4bb54e5c4c067399bf0f008c5f3b541b348c6f68c" as const;
export const T45_R2_PRIOR_HASH =
  "215d21c829c90c99f0e622cd1294fab90aa601db3860b48ce8c75ccfc8256342" as const;

/** The exact frozen R2 prior stream this head was fitted against. */
export const T45_R2_PRIOR_KEY =
  "THREE::P0.35::TECH0.18::STUMP_MIXED_FAST::Q0.08::INDEPENDENT" as const;

export const T45_VENUE = "BINANCE_GLOBAL" as const;
export const T45_SYMBOL = "BTCUSDT" as const;
export const T45_STREAM_KEY = "binance-global-spot-btcusdt-kline-1s" as const;
export const T45_WS_URL = "wss://stream.binance.com:9443/ws/btcusdt@kline_1s" as const;

/** Outcome truth stays the canonical OKX 15m confirmed close, like ES1. */
export const T45_OUTCOME_SOURCE = "OKX:BTC-USDT:15m:confirmed" as const;

export const TF_MS = 15 * 60 * 1000;

/** Observation window: offsets 0..44 inside the target candle. */
export const T45_FIRST_OFFSET_S = 0;
export const T45_LAST_OFFSET_S = 44;
export const T45_EXPECTED_SECONDS = 45;
export const T45_CUTOFF_OFFSET_MS = 45_000;
/** Hard publication deadline: never publish at or after T+60s. */
export const T45_PUBLISH_DEADLINE_MS = 60_000;

/** Walk-forward head. */
export const T45_LOGISTIC_C = 0.003;
export const T45_MAX_ITER = 5000;
export const T45_TOL = 1e-4;
export const T45_TRAIN_WINDOW = 8_640;
export const T45_MIN_TRAIN_ROWS = 2_688;
export const T45_BLOCK_SIZE = 96;
export const T45_FIRST_BLOCK_START = 2_688;
export const T45_SCALER_Q_LOW = 0.1;
export const T45_SCALER_Q_HIGH = 0.9;
export const T45_SCALER = "RobustScaler(10,90)" as const;
export const T45_SOLVER = "ts-lbfgs-certified" as const;

/** Confidence rank: midrank against the previous 768 finite confidences. */
export const T45_RANK_WINDOW = 768;
export const T45_RANK_MIN_HISTORY = 192;
/** Frozen Q37.5 gate: trade only when rank >= 0.625. */
export const T45_RANK_THRESHOLD = 0.625;

export const T45_PRICE_FEATURES = [
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

export const T45_FLOW_FEATURES = [
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

export const T45_R2_FEATURES = [
  "t45_r2_prediction",
  "t45_r2_would_trade",
  "t45_r2_partial_agreement",
  "t45_r2_ret45_interaction",
] as const;

/** Frozen feature order. Order is part of the model identity — never reorder. */
export const T45_FEATURE_ORDER: readonly string[] = [
  ...T45_PRICE_FEATURES,
  ...T45_FLOW_FEATURES,
  ...T45_R2_FEATURES,
];

export const T45_SLEEVE_TRADE = "Q375" as const;
export const T45_SLEEVE_NONE = "NONE" as const;

export type T45Direction = 1 | -1 | 0;

/** Exact 15-minute UTC boundary at/preceding `ms`. */
export function floorTarget(ms: number): number {
  return Math.floor(ms / TF_MS) * TF_MS;
}

export function isExactBoundary(iso: string): boolean {
  const ms = new Date(iso).getTime();
  return Number.isFinite(ms) && ms % TF_MS === 0;
}

/** UTC calendar date — the frozen fit uses UTC days for sample balancing. */
export function t45UtcDate(iso: string): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export const T45_CONFIG_HASH = [
  T45_MODEL_VERSION,
  T45_MODEL_VARIANT,
  T45_BASE_HEAD,
  `C=${T45_LOGISTIC_C}`,
  `L=${T45_TRAIN_WINDOW}`,
  `B=${T45_BLOCK_SIZE}`,
  `RANK=${T45_RANK_WINDOW}/${T45_RANK_MIN_HISTORY}@${T45_RANK_THRESHOLD}`,
  `F=${T45_FEATURE_ORDER.length}`,
  T45_FREEZE_SHA256.slice(0, 16),
].join("|");
