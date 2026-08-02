// a96-r4 frozen production configuration.
//
// r4 keeps the r3 architecture (Layer A is the sole directional source,
// r3 efficiency + agreement vetoes preserved) but:
//   - REMOVES the Layer A probability margin-band eligibility gate
//   - ADDS three structural/momentum vetoes:
//       * two-candle body concentration      (mean body/range > 0.65)
//       * four-candle aligned wick pressure  (> 0.20)
//       * aligned MACD histogram / ATR14     (> 0.17)
export const A96_MODEL_NAME = "a96";
export const A96_MODEL_VERSION = "a96-r4";
export const A96_VARIANT = "layer-a-structure-macd";

// Retained for audit / rollback comparison only.
export const A96_PRIOR_MODEL_VERSION = "a96-r3";
export const A96_PRIOR_VARIANT = "layer-a-margin-agreement-efficiency";

export const A96_CONFIG = {
  // Legacy r3 margin band — RECORDED ONLY. It no longer gates publication.
  legacy_margin_min_inclusive: 0.01,
  legacy_margin_max_exclusive: 0.04,
  // Back-compat aliases (audit columns margin_band_min / margin_band_max).
  layer_a_margin_min_inclusive: 0.01,
  layer_a_margin_max_exclusive: 0.04,

  // Agreement-veto thresholds (unchanged from r1/r3).
  agreement_distance_from_4_low_bps: 32.0,
  agreement_mean_2_body_to_range_max: 0.30,
  required_prior_candles: 4,
  expected_candle_seconds: 900,
  abstain_on_unusable_agreement_history: true,

  // r3 four-candle path-efficiency toxic band (frozen, preserved in r4).
  four_candle_efficiency_veto_min_inclusive: 0.25,
  four_candle_efficiency_veto_max_exclusive: 0.40,

  // r4 active thresholds (frozen).
  mean_two_body_to_range_max: 0.65,
  four_candle_aligned_wick_pressure_max: 0.20,
  aligned_macd_hist_atr_max: 0.17,

  // MACD / ATR computation window (candles ending at T-15m).
  macd_fast_period: 12,
  macd_slow_period: 26,
  macd_signal_period: 9,
  atr_period: 14,
  technical_min_history_candles: 200,

  // r1 fit-selector thresholds retained ONLY as audit constants.
  fit_selector_min_resolved: 8,
  fit_selector_min_net_gap: 4,
} as const;

// Canonical candle stream. All a96 operations must read from this single
// (symbol, timeframe, provider) tuple and require confirm=true.
export const A96_CANDLE_STREAM = {
  symbol: "BTC-USDT",
  timeframe: "15m",
  provider: "okx",
} as const;

// Consistency tolerances (basis points, target_open vs prior candle close /
// vs resolved actual_open).
export const A96_TARGET_OPEN_TOLERANCE_BPS = 30;
export const A96_RESOLUTION_OPEN_TOLERANCE_BPS = 50;

// Retry-poll for the immediately-prior canonical candle.
export const A96_PRIOR_CANDLE_POLL_ATTEMPTS = 30;
export const A96_PRIOR_CANDLE_POLL_INTERVAL_MS = 3000;
