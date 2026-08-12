// B4x4 — frozen model identity and constants. Do not optimize or refit.
import { createHash } from "crypto";

export const B4X4_MODEL_NAME = "B4x4";
export const B4X4_MODEL_VERSION = "b4x4-calibration-promotion-r1";
/**
 * Every model_version this model has ever written rows under, newest last.
 * History, daily-ledger and resolver lookups span all of them so the
 * calibration-promotion patch does not orphan earlier rows.
 */
export const B4X4_MODEL_VERSION_LINEAGE = ["b4x4-v1", "b4x4-calibration-promotion-r1"] as const;
export const B4X4_VARIANT = "balanced-4x4-calibration-promotion";
export const B4X4_PROSPECTIVE_TEST_ID = "B4X4_CORE_GRID40_BRAKE80_V1";
export const B4X4_SOURCE_VARIANT = "A2_Combined";
export const B4X4_TIMEFRAME = "15m";
export const B4X4_TIMEZONE = "America/Boise";

/**
 * Runtime-integrity repair identity. The predictive policy is unchanged
 * (still B4x4-v1); only the implementation was corrected.
 */
export const B4X4_IMPLEMENTATION_REVISION = "b4x4-calibration-promotion-r1";
export const B4X4_REVISION_PROSPECTIVE_TEST_ID = "B4X4_CALIBRATION_PROMOTION_R1_ACTIVE";
/**
 * Immutable activation instant of the runtime-integrity revision. Every row
 * produced by this build carries it so the prospective test window is
 * reconstructable from the data alone. Never change this value.
 */
export const B4X4_REVISION_ACTIVATED_AT = "2026-08-11T00:00:00.000Z";
/** Reporting label for rows produced before the repair. */
export const B4X4_PRE_REPAIR_SEGMENT = "B4X4_V1_PRE_RUNTIME_REPAIR";
/** Absolute source index scheme version. */
export const B4X4_SOURCE_INDEX_VERSION = "abs-epoch-v1";
/** Resolver accounting version. */
export const B4X4_RESOLVER_VERSION = "b4x4-resolver-r1";
export const B4X4_CANONICAL_CANDLE_SOURCE = "OKX:BTC-USDT:15m:confirmed";

// ---- calibration promotion (active route, frozen) ----
export const CALIBRATION_PROMOTION_VERSION = "calibration-promotion-r1";
export const CALIBRATION_PROMOTION_HISTORY_WINDOW = 96;
export const CALIBRATION_PROMOTION_MIN_P_CORRECT = 0.50;
export const CALIBRATION_PROMOTION_MIN_Z_SCORE = 1.00;
export const CALIBRATION_PROMOTION_HISTORY_POOL =
  "same-direction-resolved-no-active-route-v1";
/**
 * Production resolver delay simulated at prediction time: an outcome for a
 * target candle is only knowable this long after that candle opens. Keeps the
 * live decision and the frozen replay bit-identical.
 */
export const CALIBRATION_PROMOTION_OUTCOME_DELAY_MS = 16 * 60_000 + 15_000;
/**
 * Immutable activation boundary for the promotion route. Only LIVE targets at
 * or after this exact 15-minute UTC boundary may be promoted.
 */
export const CALIBRATION_PROMOTION_ACTIVATED_AT = "2026-08-13T00:00:00.000Z";



export const GLOBAL_CONFIDENCE_LOOKBACK = 384;
export const SAME_SIDE_CONFIDENCE_LOOKBACK = 768;

export const GRID_TRAINING_LOOKBACK = 768;
export const GRID_REFERENCE_LOOKBACK = 384;
export const MIN_SOURCE_HISTORY = 768;
export const MIN_GRID_RESOLVED_ROWS = 384;

export const GRID_QUARTILES = 4;
export const BETA_PRIOR_ALPHA = 8;
export const BETA_PRIOR_BETA = 8;

export const CORE_GLOBAL_RANK_MIN = 0.65;
export const CORE_SAME_SIDE_RANK_MIN = 0.60;

export const EXPANSION_GRID_PERCENTILE_MIN = 0.60;
export const EXPANSION_P_CORRECT_MIN_EXCLUSIVE = 0.50;

export const INTRADAY_BRAKE_TRIGGER_NET = -2;
export const INTRADAY_BRAKE_GRID_PERCENTILE_MIN = 0.80;
export const INTRADAY_BRAKE_P_CORRECT_MIN_EXCLUSIVE = 0.50;

export const B4X4_CONFIG = {
  model_name: B4X4_MODEL_NAME,
  model_version: B4X4_MODEL_VERSION,
  variant: B4X4_VARIANT,
  prospective_test_id: B4X4_PROSPECTIVE_TEST_ID,
  source_variant: B4X4_SOURCE_VARIANT,
  timeframe: B4X4_TIMEFRAME,
  timezone: B4X4_TIMEZONE,
  GLOBAL_CONFIDENCE_LOOKBACK,
  SAME_SIDE_CONFIDENCE_LOOKBACK,
  GRID_TRAINING_LOOKBACK,
  GRID_REFERENCE_LOOKBACK,
  MIN_SOURCE_HISTORY,
  MIN_GRID_RESOLVED_ROWS,
  GRID_QUARTILES,
  BETA_PRIOR_ALPHA,
  BETA_PRIOR_BETA,
  CORE_GLOBAL_RANK_MIN,
  CORE_SAME_SIDE_RANK_MIN,
  EXPANSION_GRID_PERCENTILE_MIN,
  EXPANSION_P_CORRECT_MIN_EXCLUSIVE,
  INTRADAY_BRAKE_TRIGGER_NET,
  INTRADAY_BRAKE_GRID_PERCENTILE_MIN,
  INTRADAY_BRAKE_P_CORRECT_MIN_EXCLUSIVE,
  implementation_revision: B4X4_IMPLEMENTATION_REVISION,
  revision_prospective_test_id: B4X4_REVISION_PROSPECTIVE_TEST_ID,
  source_index_version: B4X4_SOURCE_INDEX_VERSION,
} as const;

let _hash: string | null = null;
export function b4x4ConfigHash(): string {
  if (!_hash) _hash = createHash("sha256").update(JSON.stringify(B4X4_CONFIG)).digest("hex");
  return _hash;
}

/** Deterministic hash for a shadow policy identity + its frozen parameters. */
export function b4x4ShadowConfigHash(variant: string, params: Record<string, unknown>): string {
  return createHash("sha256")
    .update(JSON.stringify({ base: B4X4_CONFIG, shadow_variant: variant, params }))
    .digest("hex");
}


/** Local calendar date (America/Boise) for an ISO timestamp. */
export function b4x4LocalDate(iso: string | Date): string {
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: B4X4_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Frozen source epoch. The B4x4 reference replay defines the valid source
 * universe as beginning at this candle; earlier A2_Combined rows are excluded
 * so zero-based source index i (and every window derived from it) matches the
 * frozen oracle exactly.
 */
export const B4X4_SOURCE_EPOCH_TS = "2026-07-15T22:00:00.000Z";
