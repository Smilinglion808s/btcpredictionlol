// a96-r1 frozen production configuration. Do not tune these values during
// the first 300–500 resolved prospective candles.
export const A96_MODEL_NAME = "a96";
export const A96_MODEL_VERSION = "a96-r1";
export const A96_VARIANT = "a96";

export const A96_CONFIG = {
  fit_selector_min_resolved: 8,
  fit_selector_min_net_gap: 4,
  agreement_distance_from_4_low_bps: 32.0,
  agreement_mean_2_body_to_range_max: 0.30,
  required_prior_candles: 4,
  expected_candle_seconds: 900,
  abstain_on_unusable_agreement_history: true,
} as const;

// Canonical candle stream. All a96-r1 operations must read from this single
// (symbol, timeframe, provider) tuple and require confirm=true.
export const A96_CANDLE_STREAM = {
  symbol: "BTC-USDT",
  timeframe: "15m",
  provider: "okx",
} as const;

// Consistency tolerances (basis points, target_open vs prior candle close /
// vs resolved actual_open). Anything beyond these is treated as a
// cross-stream / staleness fault, not a normal spot drift.
export const A96_TARGET_OPEN_TOLERANCE_BPS = 30;
export const A96_RESOLUTION_OPEN_TOLERANCE_BPS = 50;

// Retry-poll for the immediately-prior canonical candle. OKX + ingestion
// commonly lag ~30-60s after boundary, so this is bounded at 30 × 3000ms
// (~90s). Each retry (attempt > 0) first triggers a canonical OKX ingest
// refresh so the exact required T-15m row can appear in `public.candles`.
export const A96_PRIOR_CANDLE_POLL_ATTEMPTS = 30;
export const A96_PRIOR_CANDLE_POLL_INTERVAL_MS = 3000;
