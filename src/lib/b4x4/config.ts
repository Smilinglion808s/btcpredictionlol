// B4x4 — frozen model identity and constants. Do not optimize or refit.
import { createHash } from "crypto";

export const B4X4_MODEL_NAME = "B4x4";
export const B4X4_MODEL_VERSION = "b4x4-v1";
export const B4X4_VARIANT = "a2-core-grid40-brake80";
export const B4X4_PROSPECTIVE_TEST_ID = "B4X4_CORE_GRID40_BRAKE80_V1";
export const B4X4_SOURCE_VARIANT = "A2_Combined";
export const B4X4_TIMEFRAME = "15m";
export const B4X4_TIMEZONE = "America/Boise";

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
} as const;

let _hash: string | null = null;
export function b4x4ConfigHash(): string {
  if (!_hash) _hash = createHash("sha256").update(JSON.stringify(B4X4_CONFIG)).digest("hex");
  return _hash;
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
