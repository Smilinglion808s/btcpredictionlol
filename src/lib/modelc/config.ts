// Model C — Dual Horizon retraining configuration.
// Mirrors the Model 7 Variant B trainer pattern.

// Minimum clean labeled rows before the first live refit will run.
// Below this we stay on the bootstrap fit.
export const MODEL_C_MIN_CLEAN_ROWS = 72;

// Refit cadence: every N newly-resolved clean rows (per spec §retraining).
export const MODEL_C_RETRAIN_EVERY_N_RESOLVED = 12;

// Recent Full window size — matches bootstrap (last 144 clean rows).
export const MODEL_C_RECENT_WINDOW = 144;

// sklearn LogisticRegression(penalty='l2', C=1.0), intercept UN-penalized.
export const MODEL_C_C = 1.0;
export const MODEL_C_MAX_ITER = 400;
export const MODEL_C_TOL = 1e-6;

// How much prior candle history the featurizer needs per row.
// Recent Full uses lag windows up to 32 + patterns up to 6, so 40 is plenty.
export const MODEL_C_HISTORY_ROWS = 40;

// Buffer window pulled once per training pass (covers oldest row).
export const MODEL_C_HISTORY_LOOKBACK_MS = 7 * 24 * 3600 * 1000;
