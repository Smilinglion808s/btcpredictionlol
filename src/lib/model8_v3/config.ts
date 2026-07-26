// Model 3 FWD — v3.0.0 official forward-test configuration.
// Standalone shadow model. Independent of every other model.
// Canonical BTC-USDT 15m OKX candles only.

export const M8V3_MODEL_NAME = "model8_v3";
export const M8V3_MODEL_VERSION = "v3.0.2";
export const M8V3_FEATURE_SCHEMA_VERSION = "v1";
export const M8V3_CODE_VERSION = "v3.0.2-2026-07-26";

export const M8V3_STREAM = {
  symbol: "BTC-USDT",
  timeframe: "15m",
  provider: "okx",
} as const;

export const M8V3_TIMEFRAME_SEC = 900;
export const M8V3_FEATURE_LOOKBACK = 24;

// Training-window contract (v3.0.1 — faster launch, unchanged retrain cadence).
export const M8V3_MIN_TRAINING_ROWS = 1024;
export const M8V3_PREFERRED_TRAINING_ROWS = 4096;
export const M8V3_MAX_TRAINING_ROWS = 8192;
export const M8V3_CALIBRATION_ROWS = 256;
export const M8V3_RETRAIN_EVERY_RESOLVED_ROWS = 96;

// Regularization + optimizer.
export const M8V3_L2_LAMBDA = 1.0;
export const M8V3_MAX_ITER = 400;
export const M8V3_TOL = 1e-6;

// Dual-gate thresholds (frozen for v3.0.2 — unchanged from v3.0.1).
export const M8V3_MIN_DIRECTION_EDGE = 0.08;      // |p - 0.5|
export const M8V3_MIN_MOVEMENT_PROBABILITY = 0.55;

// Movement label threshold.
// Units are basis points of open price: body_bps = |close-open| / open * 10_000.
// So 1 unit == 1 bps == 0.0001 == 0.01% of price. The constant name is kept for
// continuity — it is unambiguous.
//
// v3.0.1 shipped 15 bps which produced a ~27% positive rate on 8k-candle OKX
// BTC-USDT 15m history, driving the movement head's calibrated probability
// well below the 0.55 gate and forcing the qualified track to permanently
// abstain. v3.0.2 audits the empirical distribution (last 8k candles):
//   >= 5 bps → 68%, >= 7 bps → 57%, >= 8 bps → ~52%, >= 10 bps → 43%, >= 15 bps → 27%.
// 8 bps lands the movement-positive rate inside the target 40–60% band, so
// the calibrated movement head can actually cross 0.55 on strong signals.
export const M8V3_MOVEMENT_THRESHOLD_BPS = 8;

// Preflight activation gates (v3.0.2). A fit is only accepted if:
//   - movement positive rate on training AND calibration in [30%, 70%]
//   - p95 calibrated movement probability on calibration set exceeds 0.55
//   - estimated qualified coverage on calibration set >= 5%
//   - every stored weight / mean / scale / probability is finite
export const M8V3_PREFLIGHT_MIN_POS_RATE = 0.30;
export const M8V3_PREFLIGHT_MAX_POS_RATE = 0.70;
export const M8V3_PREFLIGHT_MIN_P95_MOVEMENT = M8V3_MIN_MOVEMENT_PROBABILITY;
export const M8V3_PREFLIGHT_MIN_QUALIFIED_COVERAGE = 0.05;

// Consistency: target_open must equal previous candle close within tolerance.
export const M8V3_TARGET_OPEN_TOLERANCE_BPS = 30;

// Bounded retry-poll for the immediately-prior candle at prediction time.
export const M8V3_PRIOR_POLL_ATTEMPTS = 20;
export const M8V3_PRIOR_POLL_INTERVAL_MS = 3000;

