// Model 3 FWD — standalone shadow model. Independent of every other model.
// Canonical BTC-USDT 15m OKX candles only.

export const M8V3_MODEL_NAME = "model8_v3";
export const M8V3_MODEL_VERSION = "model8_v3-r1";
export const M8V3_FEATURE_SCHEMA_VERSION = "v1";

export const M8V3_STREAM = {
  symbol: "BTC-USDT",
  timeframe: "15m",
  provider: "okx",
} as const;

export const M8V3_TIMEFRAME_SEC = 900;

// History window used to build training set + features.
// We need enough contiguous confirmed candles to (a) compute lag features
// (max lag = 24) and (b) train a stable regularized logistic regression.
export const M8V3_HISTORY_CANDLES = 300;
export const M8V3_MIN_TRAINING_ROWS = 120;
export const M8V3_FEATURE_LOOKBACK = 24; // biggest lag used
export const M8V3_HOLDOUT_ROWS = 40; // last N rows used for Platt calibration

// Regularization + optimizer for the internal binary logistic regression.
export const M8V3_L2_LAMBDA = 1.0;
export const M8V3_MAX_ITER = 200;
export const M8V3_TOL = 1e-6;

// Abstain zone around 0.50 on the calibrated probability. |p-0.5| < margin -> ABSTAIN.
export const M8V3_ABSTAIN_MARGIN = 0.03;

// Consistency: target_open must equal previous candle close within this tolerance (bps).
export const M8V3_TARGET_OPEN_TOLERANCE_BPS = 30;

// Bounded retry-poll for the immediately-prior candle at prediction time.
export const M8V3_PRIOR_POLL_ATTEMPTS = 20;
export const M8V3_PRIOR_POLL_INTERVAL_MS = 3000;
