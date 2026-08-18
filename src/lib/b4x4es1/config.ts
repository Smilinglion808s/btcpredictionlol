// B4x4-ES1 — frozen model identity and constants.
// Fully isolated from B4x4/A2/TD/V6. Nothing here is tunable at runtime.

import { createHash } from "crypto";

export const ES1_MODEL_NAME = "B4x4-ES1";
export const ES1_MODEL_VERSION = "b4x4-es1-aligned-r1";
export const ES1_VARIANT = "es1-r2-a2-agreement-rank20-b4-p045";

/**
 * Every model_version value a B4x4-ES1 prediction row may carry. Rows created
 * before the Dual-Venue Adaptive R1 activation keep the legacy ES1 value; rows
 * at/after activation carry the dual-adaptive value. Read paths must accept
 * both so history stays continuous.
 */
export const ES1_ROW_MODEL_VERSIONS = [
  "b4x4-es1-aligned-r1",
  "b4x4-es1-binance-dual-adaptive-r1",
] as const;
export const ES1_DIRECTIONAL_VERSION = "es1-r2-hybrid";
export const ES1_B4_GUARD_VERSION = "es1-b4-pooled-p045-r1";
export const ES1_PROSPECTIVE_TEST_ID = "B4X4_ES1_ALIGNED_P045_R1_ACTIVE";
export const ES1_IMPLEMENTATION_REVISION = "b4x4-es1-active-r2-frozen-parity";

export const ES1_PUBLICATION_ENABLED = true;
// Held OFF pending row-level parity reconciliation against the frozen replay.
export const ES1_WEBHOOKS_ENABLED = true;

// ---- canonical market ----
export const ES1_SYMBOL = "BTC-USDT";
export const ES1_TIMEFRAME = "15m";
export const ES1_EXCHANGE = "okx";
export const ES1_CANONICAL_CANDLE_SOURCE = "OKX:BTC-USDT:15m:confirmed";
export const ES1_TIMEZONE = "America/Boise";
export const TF_MS = 15 * 60 * 1000;

// ---- price head ----
export const ES1_PRICE_SPEC = "ridge_c0.01_minimal8";
export const ES1_MIN_TRAIN_ROWS = 768;
export const ES1_TRAIN_WINDOW = 1536;
export const ES1_RETRAIN_BLOCK = 96;
export const ES1_SCALER = "RobustScaler(10,90)";
export const ES1_SCALER_Q_LOW = 0.1;
export const ES1_SCALER_Q_HIGH = 0.9;
export const ES1_LOGISTIC_C = 0.01;
export const ES1_FIT_INTERCEPT = true;
export const ES1_CLASS_WEIGHT = "none";
export const ES1_SOLVER = "lbfgs";
export const ES1_MAX_ITER = 5000;
// Feature-stream eligibility (frozen-oracle reconciled): a target is eligible
// only when its source candle has 32 contiguous prior candles inside a segment
// of at least 40 candles.
export const ES1_SEGMENT_WARMUP = 32;
export const ES1_MIN_SEGMENT_LENGTH = 40;

export const ES1_FEATURES = [
  "return_1",
  "return_2",
  "return_4",
  "return_8",
  "return_16",
  "signed_efficiency_8",
  "close_location",
  "wick_balance",
] as const;
export type Es1FeatureName = (typeof ES1_FEATURES)[number];

// ---- order-book hybrid route ----
export const OB_HISTORY_WINDOW = 96;
export const OB_MIN_HISTORY = 32;
export const OB_ABS_IMBALANCE_PERCENTILE = 0.6;

// ---- A2 corroboration (read-only pin) ----
export const ES1_A2_SOURCE_VARIANT = "A2_Combined";
export const ES1_A2_MODEL_FIT_ID = "frozen_v1_1";
export const ES1_A2_PRODUCTION_MODEL_VERSION = "6.0";

// ---- causal confidence ranks ----
export const CONFIDENCE_RANK_WINDOW = 384;
export const COMBINED_CONFIDENCE_MIN = 0.2;

// ---- ES1-specific B4 correctness guard ----
export const ES1_TRAINING_SOURCE_EPOCH_TS = "2026-07-04T17:45:00.000Z";
export const ES1_RAW_PREDICTION_EPOCH_TS = "2026-08-01T06:15:00.000Z";
export const GLOBAL_RANK_WINDOW = 384;
export const SAME_SIDE_SOURCE_WINDOW = 768;
export const GRID_TRAINING_WINDOW = 768;
export const GRID_REFERENCE_WINDOW = 384;
export const GRID_PRIOR_ALPHA = 8;
export const GRID_PRIOR_BETA = 8;
export const GRID_OUTCOME_DELAY_MS = 16 * 60_000 + 15_000;
export const B4_GUARD_MIN_P_CORRECT = 0.45;
export const B4_READY_MIN_SOURCE_INDEX = 768;

export const ES1_CONFIG = {
  model_name: ES1_MODEL_NAME,
  model_version: ES1_MODEL_VERSION,
  variant: ES1_VARIANT,
  directional_version: ES1_DIRECTIONAL_VERSION,
  b4_guard_version: ES1_B4_GUARD_VERSION,
  prospective_test_id: ES1_PROSPECTIVE_TEST_ID,
  implementation_revision: ES1_IMPLEMENTATION_REVISION,
  symbol: ES1_SYMBOL,
  timeframe: ES1_TIMEFRAME,
  exchange: ES1_EXCHANGE,
  canonical_candle_source: ES1_CANONICAL_CANDLE_SOURCE,
  timezone: ES1_TIMEZONE,
  price_spec: ES1_PRICE_SPEC,
  min_train_rows: ES1_MIN_TRAIN_ROWS,
  train_window: ES1_TRAIN_WINDOW,
  retrain_block: ES1_RETRAIN_BLOCK,
  scaler: ES1_SCALER,
  logistic_C: ES1_LOGISTIC_C,
  fit_intercept: ES1_FIT_INTERCEPT,
  class_weight: ES1_CLASS_WEIGHT,
  solver: ES1_SOLVER,
  max_iter: ES1_MAX_ITER,
  features: ES1_FEATURES,
  segment_warmup: ES1_SEGMENT_WARMUP,
  min_segment_length: ES1_MIN_SEGMENT_LENGTH,
  exclude_push_targets: true,
  ob_history_window: OB_HISTORY_WINDOW,
  ob_min_history: OB_MIN_HISTORY,
  ob_abs_imbalance_percentile: OB_ABS_IMBALANCE_PERCENTILE,
  a2_source_variant: ES1_A2_SOURCE_VARIANT,
  a2_model_fit_id: ES1_A2_MODEL_FIT_ID,
  a2_production_model_version: ES1_A2_PRODUCTION_MODEL_VERSION,
  confidence_rank_window: CONFIDENCE_RANK_WINDOW,
  combined_confidence_min: COMBINED_CONFIDENCE_MIN,
  training_source_epoch_ts: ES1_TRAINING_SOURCE_EPOCH_TS,
  raw_prediction_epoch_ts: ES1_RAW_PREDICTION_EPOCH_TS,
  global_rank_window: GLOBAL_RANK_WINDOW,
  same_side_source_window: SAME_SIDE_SOURCE_WINDOW,
  grid_training_window: GRID_TRAINING_WINDOW,
  grid_reference_window: GRID_REFERENCE_WINDOW,
  grid_prior_alpha: GRID_PRIOR_ALPHA,
  grid_prior_beta: GRID_PRIOR_BETA,
  grid_outcome_delay_ms: GRID_OUTCOME_DELAY_MS,
  b4_guard_min_p_correct: B4_GUARD_MIN_P_CORRECT,
  b4_ready_min_source_index: B4_READY_MIN_SOURCE_INDEX,
} as const;

let _hash: string | null = null;
/** Immutable hash over every source, window, threshold, epoch and rule. */
export function es1ConfigHash(): string {
  if (!_hash) _hash = createHash("sha256").update(JSON.stringify(ES1_CONFIG)).digest("hex");
  return _hash;
}

export function es1FeatureSchemaHash(): string {
  return createHash("sha256").update(JSON.stringify(ES1_FEATURES)).digest("hex");
}

export function sha256(value: unknown): string {
  return createHash("sha256")
    .update(typeof value === "string" ? value : JSON.stringify(value))
    .digest("hex");
}

/** Local calendar date (America/Boise) for an ISO timestamp. */
export function es1LocalDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: ES1_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
