// Model 3 — Selective Edge R1 (m3-se-r1) configuration.
// Independent of every other model.

export const M3SE_MODEL_VERSION = "m3-se-r1";
export const M3SE_FEATURE_SCHEMA_VERSION = "m3-se-features-v1";
export const M3SE_CODE_VERSION = "m3-se-r1-2026-07-27-coverage-threshold";

export const M3SE_STREAM = {
  symbol: "BTC-USDT",
  timeframe: "15m",
  provider: "okx",
} as const;

export const M3SE_TIMEFRAME_SEC = 900;

// Windows.
export const M3SE_SLOW_ROWS = 768;
export const M3SE_FAST_ROWS = 320;
export const M3SE_CAL_ROWS = 192;
export const M3SE_OOF_WARMUP_ROWS = 384;
export const M3SE_OOF_BLOCK_SIZE = 32;

// Minimum labeled rows in the historical pool before we're allowed to fit.
// SLOW + OOF pool + CAL, with a small buffer.
export const M3SE_MIN_LABELED_ROWS =
  M3SE_SLOW_ROWS + M3SE_OOF_WARMUP_ROWS + M3SE_OOF_BLOCK_SIZE * 3 + M3SE_CAL_ROWS;

// Max candle history to hydrate (features need ~32 lookback + 256 percentile window).
export const M3SE_FEATURE_LOOKBACK = 256;
export const M3SE_MAX_HISTORY_ROWS = 12_000;

// Regularization.
export const M3SE_SLOW_LAMBDA = 0.1;
export const M3SE_FAST_LAMBDA = 0.1;
export const M3SE_STACKER_LAMBDA = 0.3;
export const M3SE_SELECTOR_LAMBDA = 0.3;
export const M3SE_MAX_ITER = 400;
export const M3SE_TOL = 1e-6;

// Selection: publish ~50 of every 96 valid candles.
export const M3SE_TARGET_COVERAGE = 50 / 96;
// The selector is a ranker for prospective coverage. Do not hard-floor at 0.50;
// that can collapse coverage when calibration is conservative.
export const M3SE_MIN_SELECTION_THRESHOLD = 0;

// Coverage sanity gate on calibration set.
export const M3SE_MIN_ESTIMATED_COVERAGE = 0.2;
export const M3SE_MAX_ESTIMATED_COVERAGE = 0.75;

// Retrain cadence.
export const M3SE_RETRAIN_EVERY_RESOLVED_ROWS = 96;

// Rolling summary block size.
export const M3SE_BLOCK_SIZE = 96;

// Bounded retry-poll for the immediately-prior candle at prediction time.
export const M3SE_PRIOR_POLL_ATTEMPTS = 20;
export const M3SE_PRIOR_POLL_INTERVAL_MS = 3000;
