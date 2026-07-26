// Model 3 FWD — v3.0.0 official forward-test configuration.
// Standalone shadow model. Independent of every other model.
// Canonical BTC-USDT 15m OKX candles only.

export const M8V3_MODEL_NAME = "model8_v3";
export const M8V3_MODEL_VERSION = "v3.0.0";
export const M8V3_FEATURE_SCHEMA_VERSION = "v1";
export const M8V3_CODE_VERSION = "v3.0.0-2026-07-26";

export const M8V3_STREAM = {
  symbol: "BTC-USDT",
  timeframe: "15m",
  provider: "okx",
} as const;

export const M8V3_TIMEFRAME_SEC = 900;
export const M8V3_FEATURE_LOOKBACK = 24;

// Training-window contract (per v3.0.0 spec).
export const M8V3_MIN_TRAINING_ROWS = 1536;
export const M8V3_PREFERRED_TRAINING_ROWS = 4096;
export const M8V3_MAX_TRAINING_ROWS = 8192;
export const M8V3_CALIBRATION_ROWS = 384;
export const M8V3_RETRAIN_EVERY_RESOLVED_ROWS = 96;

// Regularization + optimizer.
export const M8V3_L2_LAMBDA = 1.0;
export const M8V3_MAX_ITER = 400;
export const M8V3_TOL = 1e-6;

// Dual-gate thresholds (frozen for v3.0.0).
export const M8V3_MIN_DIRECTION_EDGE = 0.08;      // |p - 0.5|
export const M8V3_MIN_MOVEMENT_PROBABILITY = 0.55;

// "Meaningful body" threshold in basis points of open. Body = |close-open|.
// Chosen so ~50% of confirmed candles historically qualify (spec is agnostic
// on the exact bps — v3.0.0 freezes 15 bps).
export const M8V3_MOVEMENT_THRESHOLD_BPS = 15;

// Consistency: target_open must equal previous candle close within tolerance.
export const M8V3_TARGET_OPEN_TOLERANCE_BPS = 30;

// Bounded retry-poll for the immediately-prior candle at prediction time.
export const M8V3_PRIOR_POLL_ATTEMPTS = 20;
export const M8V3_PRIOR_POLL_INTERVAL_MS = 3000;
