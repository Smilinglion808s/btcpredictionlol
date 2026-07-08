// Model 6 — Deterministic Engine config (mirrors model_6_deterministic_spec.json).
// All thresholds live here as named constants. Change here => bump ENGINE_VERSION.

export const MODEL6_VERSION = "6.0" as const;
export const MODEL6_ENGINE_ID = "btc15m_model_6" as const;

// Module weights (sum = 100). Each module caps bull/bear at its weight.
export const MODULE_WEIGHTS = {
  failed_breakout_rejection_zones: 13,
  last_8_candle_momentum: 11,
  completed_candle_structure: 10,
  partial_candle_confirmation: 10,
  vwap_state: 9,
  fib_channel_position: 8,
  atr_range_expansion: 7,
  support_resistance_proximity: 6,
  liquidity_sweep_reclaim: 6,
  reclaim_breakdown_behavior: 5,
  wick_rejection_defense: 5,
  candle_close_location: 3,
  market_structure_regime_filter: 3,
  bearish_exhaustion_downside_failure: 2,
  volume: 2,
} as const;

// Decision thresholds
export const MARGIN_NCE = 7;
export const MARGIN_LOW = 10;
export const MARGIN_STANDARD = 16;
export const MARGIN_PREMIUM = 22;
export const TRADE_MIN_MARGIN = 10;
export const TRADE_MIN_CONFIDENCE = 60;

// Confidence
export const CONF_BASE = 45;
export const CONF_MARGIN_MULT = 1.4;
export const CONF_MARGIN_CAP = 30;
export const CONF_MAX = 75;

// Caps
export const CAP_FALLBACK = 55;
export const CAP_TRUE_MID = 60;
export const CAP_NEAR_VWAP_NO_EVENT = 55;
export const CAP_COMPRESSED_NO_OVERRIDE = 55;
export const CAP_EDGE_NO_CONFIRM = 60;
export const CAP_VWAP_ATR_CONFLICT = 65;
export const CAP_SOFT_VETO = 62;
export const CAP_DEGRADED = 60;
export const CAP_CONTINUATION = 55;
export const CAP_STRUCTURE_CONFLICT = 60;
export const CAP_CHANNEL_EDGE_WEAK = 55;
export const HARD_OVERRIDE_FLOOR = 60;

// Partial trust multipliers
export const PARTIAL_COMPLETENESS_FULL = 0.80;
export const PARTIAL_COMPLETENESS_MID = 0.53;

// Sizing: conviction rule (all direction-agnostic).
export const CONVICTION_STREAK_LEN = 4;
export const CONVICTION_BODY_MOVE_PCT = 0.003;
export const CONVICTION_MARUBOZU_BODY_PCT = 0.90;
export const CONVICTION_VOLUME_MULT = 2.0;

// ATR / range
export const NEAR_LEVEL_ATR_MULT = 0.25;
export const EXTENDED_ATR_MULT = 1.25;
export const EXPANSION_NORMAL = 0.75;
export const EXPANSION_EXPANDING = 1.15;
export const EXPANSION_STRONG = 1.5;
export const EXPANSION_EXHAUSTION = 1.75;
export const FLAT_ATR_FRACTION = 0.02;

// Volume tiers
export const VOL_HIGH = 1.25;
export const VOL_LOW = 0.75;
export const VOL_CONVICTION = 2.0;

// Fib channel zones
export const FIB_SUPPORT_EDGE_MAX = 0.236;
export const FIB_LOWER_MID_MAX = 0.382;
export const FIB_TRUE_MID_MAX = 0.618;
export const FIB_UPPER_MID_MAX = 0.786;
export const FIB_RESISTANCE_EDGE_MAX = 1.0;

// Structural
export const CLOSE_UPPER_35 = 0.65;
export const CLOSE_LOWER_35 = 0.35;
export const STRONG_BODY = 0.5;
export const WEAK_BODY = 0.35;
export const MARUBOZU_BODY = 0.90;
export const WICK_35 = 0.35;
export const WICK_50 = 0.5;

// Feed sanity
export const PARTIAL_OPEN_DRIFT_MAX = 0.003;

// Bump this whenever ANY constant above or engine logic changes, so
// engine_version_hash on the row identifies the exact code that produced it.
export const ENGINE_LOGIC_VERSION = "m6-v1.0.0" as const;
