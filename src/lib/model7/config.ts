// Model 7 Shadow — config & constants
// Source: user-uploads model_7_shadow_spec.json + btc15_boundary_hybrid_backend_v1_1.json

export const MODEL7_YES_THRESHOLD = 0.58;
export const MODEL7_NO_THRESHOLD = 0.26;

// Variant B — live retraining recipe
export const VARIANT_B_MIN_CLEAN_ROWS = 72;
export const VARIANT_B_RETRAIN_EVERY_N_RESOLVED = 12;
// Cleaned feature set drops these raw absolute-level columns from Variant B.
export const VARIANT_B_DROPPED_FEATURES = new Set<string>([
  "btc_price_at_prediction",
  "ema9",
  "ema21",
  "ema50",
  "range20_high",
  "range20_low",
]);

// L2 regularization matches sklearn LogisticRegression(penalty='l2', C=1.0).
// sklearn's loss = -sum log_lik + (1/(2*C)) * ||w||^2  (intercept unpenalized).
// We use C=1.0 -> lambda_l2 = 1.0.
export const VARIANT_B_C = 1.0;
export const VARIANT_B_MAX_ITER = 400;
export const VARIANT_B_TOL = 1e-6;

export const FROZEN_MODEL_FIT_ID = "frozen_v1_1";

export const LAG_WINDOWS = [2, 3, 4, 6, 8, 12, 16] as const;
