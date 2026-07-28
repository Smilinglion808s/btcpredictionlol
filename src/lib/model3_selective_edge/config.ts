// Model 3 — Selective Edge R2 (m3-se-r2) configuration.
// R2 is an in-place upgrade of R1: same table, new version tag, new fits.
// R1 rows already in the DB stay tagged "m3-se-r1" and are preserved.

export const M3SE_MODEL_VERSION = "m3-se-r2";
export const M3SE_FEATURE_SCHEMA_VERSION = "m3-se-features-v2";
export const M3SE_CODE_VERSION = "m3-se-r2-2026-07-28-rank-selector";

export const M3SE_STREAM = {
  symbol: "BTC-USDT",
  timeframe: "15m",
  provider: "okx",
} as const;

export const M3SE_TIMEFRAME_SEC = 900;

// Fixed training windows (§2 — do not silently shrink).
export const M3SE_SLOW_ROWS = 1024;
export const M3SE_FAST_ROWS = 384;
export const M3SE_CAL_ROWS = 256;
export const M3SE_OOF_WARMUP_ROWS = 384;
export const M3SE_OOF_BLOCK_SIZE = 32;
export const M3SE_FAST_HALF_LIFE = 96;

// Class-balance weight caps (§3).
export const M3SE_CLASS_WEIGHT_MIN = 0.85;
export const M3SE_CLASS_WEIGHT_MAX = 1.15;

// Minimum labeled rows before we can produce a fit at all: slow window +
// calibration + small buffer. If we're below this we retain the prior fit.
export const M3SE_MIN_LABELED_ROWS = M3SE_SLOW_ROWS + M3SE_CAL_ROWS + M3SE_OOF_BLOCK_SIZE * 2;

// Feature hydration.
export const M3SE_FEATURE_LOOKBACK = 256;
export const M3SE_MAX_HISTORY_ROWS = 12_000;

// Fixed direction-expert regularization.
export const M3SE_SLOW_LAMBDA = 0.1;
export const M3SE_FAST_LAMBDA = 0.1;
export const M3SE_STACKER_LAMBDA = 0.3;

// Selector penalty grid (§6).
export const M3SE_SELECTOR_LAMBDA_GRID = [0.03, 0.10, 0.30, 1.00] as const;

export const M3SE_MAX_ITER = 400;
export const M3SE_TOL = 1e-6;

// Publication: publish top ~60% by selector rank on calibration (§5, §7).
export const M3SE_TARGET_COVERAGE = 0.60;
// Do NOT apply a 0.50 floor to selector_score_raw (spec §5).
export const M3SE_MIN_SELECTION_THRESHOLD = -Infinity;

// Coverage sanity gate on calibration.
export const M3SE_MIN_ESTIMATED_COVERAGE = 0.35;
export const M3SE_MAX_ESTIMATED_COVERAGE = 0.85;

// Retrain cadence (unchanged).
export const M3SE_RETRAIN_EVERY_RESOLVED_ROWS = 96;

// Rolling summary block size.
export const M3SE_BLOCK_SIZE = 96;

// Bounded retry-poll for the immediately-prior candle at prediction time.
export const M3SE_PRIOR_POLL_ATTEMPTS = 20;
export const M3SE_PRIOR_POLL_INTERVAL_MS = 3000;
