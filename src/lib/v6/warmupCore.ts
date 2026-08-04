// V6 warmup — pure replay core.
//
// This module reconstructs historical state ONLY. It never changes V6 feature
// definitions, fitted parameters, thresholds, Armor rules, scoring, or inference:
// it replays the exact production feature builder and `inferV6` over confirmed
// history so the first live prediction starts with a complete 8-decision window.

import { buildTechnicalRows, type RawCandle } from "./technical";
import { inferV6, V6_MODEL, type Direction, type TechnicalRow } from "./inference";
import { V6_MIN_HISTORY_CANDLES } from "./config";

const TF_MS = 15 * 60 * 1000;

/** Minimum confirmed consecutive candles required before any live publication. */
export const V6_WARMUP_MIN_CANDLES = Math.max(200, V6_MIN_HISTORY_CANDLES);

/** Prior BASE decisions required by the 8-decision saturation window. */
export const V6_WARMUP_BASE_PREDICTIONS = 7;

export const V6_RIDGE_FEATURE_COUNT: number = (V6_MODEL.feature_schema.ridge_features as string[]).length;
export const V6_GB_FEATURE_COUNT: number = (V6_MODEL.feature_schema.gb_features as string[]).length;

export type V6WarmupStatus =
  | "NOT_STARTED"
  | "FETCHING_HISTORY"
  | "BUILDING_TECHNICALS"
  | "REPLAYING_BASE_PREDICTIONS"
  | "READY"
  | "FAILED";

export type V6WarmupFailure =
  | "V6_WARMUP_NOT_READY"
  | "V6_WARMUP_HISTORY_MISSING"
  | "V6_WARMUP_CONTINUITY_FAILURE"
  | "V6_WARMUP_FEATURE_FAILURE"
  | "V6_WARMUP_REPLAY_FAILURE";

export interface WarmupBaseDecision {
  target_candle_ts: string;
  input_candle_ts: string;
  base_v6_prediction: Direction;
}

export interface V6WarmupResult {
  status: V6WarmupStatus;
  failureStage: V6WarmupStatus | null;
  failureReason: V6WarmupFailure | null;
  error: string | null;
  candleCount: number;
  firstCandleTs: string | null;
  lastCandleTs: string | null;
  nextTargetTs: string;
  continuityValid: boolean;
  featureValid: boolean;
  priorBasePredictions: Direction[];
  baseDecisions: WarmupBaseDecision[];
}

function fail(
  targetTs: Date,
  stage: V6WarmupStatus,
  reason: V6WarmupFailure,
  error: string,
  partial: Partial<V6WarmupResult> = {},
): V6WarmupResult {
  return {
    status: "FAILED",
    failureStage: stage,
    failureReason: reason,
    error,
    candleCount: 0,
    firstCandleTs: null,
    lastCandleTs: null,
    nextTargetTs: targetTs.toISOString(),
    continuityValid: false,
    featureValid: false,
    priorBasePredictions: [],
    baseDecisions: [],
    ...partial,
  };
}

function allFinite(features: Record<string, number>): boolean {
  return Object.values(features).every((v) => Number.isFinite(v));
}

/**
 * Replay confirmed history for `targetTs` (the candle that has NOT opened yet).
 *
 * `candles` must be confirmed OKX BTC-USDT 15m candles, oldest → newest, ending
 * exactly at `targetTs - 15m`. The target candle itself must never be present.
 */
export function replayWarmup(candles: readonly RawCandle[], targetTs: Date): V6WarmupResult {
  const targetIso = targetTs.toISOString();
  const lastRequiredIso = new Date(targetTs.getTime() - TF_MS).toISOString();

  // --- FETCHING_HISTORY: shape, continuity, and leakage checks ---
  if (candles.length === 0) {
    return fail(targetTs, "FETCHING_HISTORY", "V6_WARMUP_HISTORY_MISSING", "no_confirmed_candles");
  }

  const seen = new Set<string>();
  let previousMs: number | null = null;
  for (const c of candles) {
    const ms = new Date(c.candle_ts).getTime();
    if (!Number.isFinite(ms)) {
      return fail(targetTs, "FETCHING_HISTORY", "V6_WARMUP_CONTINUITY_FAILURE", `invalid_timestamp:${c.candle_ts}`);
    }
    const iso = new Date(ms).toISOString();
    if (seen.has(iso)) {
      return fail(targetTs, "FETCHING_HISTORY", "V6_WARMUP_CONTINUITY_FAILURE", `duplicate_candle:${iso}`);
    }
    seen.add(iso);
    if (ms % TF_MS !== 0) {
      return fail(targetTs, "FETCHING_HISTORY", "V6_WARMUP_CONTINUITY_FAILURE", `unaligned_candle:${iso}`);
    }
    if (ms >= targetTs.getTime()) {
      return fail(targetTs, "FETCHING_HISTORY", "V6_WARMUP_CONTINUITY_FAILURE", `target_candle_leakage:${iso}`);
    }
    if (previousMs !== null && ms - previousMs !== TF_MS) {
      return fail(
        targetTs,
        "FETCHING_HISTORY",
        "V6_WARMUP_CONTINUITY_FAILURE",
        ms <= previousMs ? `unsorted_candles:${iso}` : `missing_candle_before:${iso}`,
      );
    }
    if (![c.open, c.high, c.low, c.close].every((n) => Number.isFinite(n) && n > 0)) {
      return fail(targetTs, "FETCHING_HISTORY", "V6_WARMUP_CONTINUITY_FAILURE", `invalid_ohlc:${iso}`);
    }
    previousMs = ms;
  }

  const lastIso = new Date(candles[candles.length - 1].candle_ts).toISOString();
  if (lastIso !== lastRequiredIso) {
    return fail(
      targetTs,
      "FETCHING_HISTORY",
      "V6_WARMUP_HISTORY_MISSING",
      `last_candle_mismatch:${lastIso}!=${lastRequiredIso}`,
    );
  }
  if (candles.length < V6_WARMUP_MIN_CANDLES) {
    return fail(
      targetTs,
      "FETCHING_HISTORY",
      "V6_WARMUP_HISTORY_MISSING",
      `insufficient_history:${candles.length}/${V6_WARMUP_MIN_CANDLES}`,
    );
  }

  const firstIso = new Date(candles[0].candle_ts).toISOString();
  const shape = {
    candleCount: candles.length,
    firstCandleTs: firstIso,
    lastCandleTs: lastIso,
    continuityValid: true,
  };

  // --- BUILDING_TECHNICALS: full chronological replay through the production builder ---
  let technical: TechnicalRow[];
  try {
    technical = buildTechnicalRows(candles) as unknown as TechnicalRow[];
  } catch (e) {
    return fail(
      targetTs,
      "BUILDING_TECHNICALS",
      "V6_WARMUP_FEATURE_FAILURE",
      `feature_build_failed:${e instanceof Error ? e.message : String(e)}`,
      shape,
    );
  }

  const n = technical.length;
  if (n !== candles.length) {
    return fail(targetTs, "BUILDING_TECHNICALS", "V6_WARMUP_FEATURE_FAILURE", `row_count_mismatch:${n}`, shape);
  }
  if (n < V6_WARMUP_BASE_PREDICTIONS + 5) {
    return fail(targetTs, "BUILDING_TECHNICALS", "V6_WARMUP_FEATURE_FAILURE", `insufficient_rows:${n}`, shape);
  }

  // Latest technical row must belong to exactly T-15m and be fully valid.
  let latest;
  try {
    latest = inferV6(technical[n - 1], technical[n - 2], technical[n - 5], { priorBasePredictions: [] });
  } catch (e) {
    return fail(
      targetTs,
      "BUILDING_TECHNICALS",
      "V6_WARMUP_FEATURE_FAILURE",
      `inference_failed:${e instanceof Error ? e.message : String(e)}`,
      shape,
    );
  }
  if (Object.keys(latest.ridgeFeatures).length !== V6_RIDGE_FEATURE_COUNT) {
    return fail(targetTs, "BUILDING_TECHNICALS", "V6_WARMUP_FEATURE_FAILURE", "ridge_feature_count_mismatch", shape);
  }
  if (Object.keys(latest.gbFeatures).length !== V6_GB_FEATURE_COUNT) {
    return fail(targetTs, "BUILDING_TECHNICALS", "V6_WARMUP_FEATURE_FAILURE", "gb_feature_count_mismatch", shape);
  }
  if (!Number.isFinite(latest.finalScore)) {
    return fail(targetTs, "BUILDING_TECHNICALS", "V6_WARMUP_FEATURE_FAILURE", "non_finite_final_score", shape);
  }
  if (!allFinite(latest.ridgeFeatures) && latest.imputedFeatures.length === 0) {
    return fail(targetTs, "BUILDING_TECHNICALS", "V6_WARMUP_FEATURE_FAILURE", "non_finite_ridge_features", shape);
  }

  // --- REPLAYING_BASE_PREDICTIONS: BASE decisions only, no overlays, no scoring ---
  const baseDecisions: WarmupBaseDecision[] = [];
  try {
    for (let k = V6_WARMUP_BASE_PREDICTIONS; k >= 1; k -= 1) {
      const currentIdx = n - 1 - k;
      const current = technical[currentIdx];
      const previous1 = technical[currentIdx - 1];
      const previous4 = technical[currentIdx - 4];
      if (!current || !previous1 || !previous4) {
        return fail(
          targetTs,
          "REPLAYING_BASE_PREDICTIONS",
          "V6_WARMUP_REPLAY_FAILURE",
          `missing_replay_rows_at:${currentIdx}`,
          { ...shape, featureValid: true },
        );
      }
      const inputTs = new Date(candles[currentIdx].candle_ts).toISOString();
      const inf = inferV6(current, previous1, previous4, { priorBasePredictions: [] });
      baseDecisions.push({
        target_candle_ts: new Date(new Date(inputTs).getTime() + TF_MS).toISOString(),
        input_candle_ts: inputTs,
        base_v6_prediction: inf.basePrediction,
      });
    }
  } catch (e) {
    return fail(
      targetTs,
      "REPLAYING_BASE_PREDICTIONS",
      "V6_WARMUP_REPLAY_FAILURE",
      `replay_failed:${e instanceof Error ? e.message : String(e)}`,
      { ...shape, featureValid: true },
    );
  }

  if (baseDecisions.length !== V6_WARMUP_BASE_PREDICTIONS) {
    return fail(
      targetTs,
      "REPLAYING_BASE_PREDICTIONS",
      "V6_WARMUP_REPLAY_FAILURE",
      `base_prediction_count:${baseDecisions.length}`,
      { ...shape, featureValid: true },
    );
  }

  return {
    status: "READY",
    failureStage: null,
    failureReason: null,
    error: null,
    ...shape,
    nextTargetTs: targetIso,
    featureValid: true,
    priorBasePredictions: baseDecisions.map((d) => d.base_v6_prediction),
    baseDecisions,
  };
}

/**
 * Roll the seven-decision saturation window forward after a live prediction for
 * `targetTs`. Returns null when the stored window does not connect to `targetTs`
 * (in which case the caller must not advance state — a replay is required).
 */
export function rollWarmupWindow(
  decisions: readonly WarmupBaseDecision[],
  targetTs: Date,
  inputCandleTs: string,
  basePrediction: Direction,
): WarmupBaseDecision[] | null {
  if (decisions.length !== V6_WARMUP_BASE_PREDICTIONS) return null;
  for (let i = 0; i < decisions.length; i += 1) {
    const expected = new Date(
      targetTs.getTime() - (V6_WARMUP_BASE_PREDICTIONS - i) * TF_MS,
    ).toISOString();
    const d = decisions[i];
    if (!d || new Date(d.target_candle_ts).toISOString() !== expected) return null;
  }
  const inputIso = new Date(inputCandleTs).toISOString();
  if (inputIso !== new Date(targetTs.getTime() - TF_MS).toISOString()) return null;
  return [
    ...decisions.slice(1),
    {
      target_candle_ts: targetTs.toISOString(),
      input_candle_ts: inputIso,
      base_v6_prediction: basePrediction,
    },
  ];
}

export interface PersistedWarmupState {
  v6_warmup_status?: string | null;
  fit_id?: string | null;
  model_artifact_sha256?: string | null;
  feature_schema_version?: string | null;
  warmup_last_candle_ts?: string | null;
  warmup_next_target_ts?: string | null;
  warmup_continuity_valid?: boolean | null;
  warmup_feature_valid?: boolean | null;
  warmup_base_predictions_count?: number | null;
  warmup_base_predictions_json?: unknown;
}

export interface PersistedStateExpectation {
  targetTs: Date;
  fitId: string;
  artifactSha256: string;
  featureSchemaVersion: string;
}

/**
 * Persisted state may be resumed only when it is READY, was produced by the same
 * frozen artifact/schema, and its stored decisions connect exactly to the
 * candles immediately preceding `targetTs`. Anything else forces a full replay.
 */
export function canResumePersistedState(
  state: PersistedWarmupState | null | undefined,
  expect: PersistedStateExpectation,
): boolean {
  if (!state) return false;
  if (state.v6_warmup_status !== "READY") return false;
  if (state.fit_id !== expect.fitId) return false;
  if (state.model_artifact_sha256 !== expect.artifactSha256) return false;
  if (state.feature_schema_version !== expect.featureSchemaVersion) return false;
  if (!state.warmup_continuity_valid || !state.warmup_feature_valid) return false;
  if ((state.warmup_base_predictions_count ?? 0) !== V6_WARMUP_BASE_PREDICTIONS) return false;

  const decisions = Array.isArray(state.warmup_base_predictions_json)
    ? (state.warmup_base_predictions_json as WarmupBaseDecision[])
    : [];
  if (decisions.length !== V6_WARMUP_BASE_PREDICTIONS) return false;

  // Stored input candle must be the immediately completed candle before target.
  const lastIso = state.warmup_last_candle_ts ? new Date(state.warmup_last_candle_ts).toISOString() : null;
  if (lastIso !== new Date(expect.targetTs.getTime() - TF_MS).toISOString()) return false;

  // The seven decisions must be the exact consecutive targets preceding `targetTs`.
  for (let i = 0; i < decisions.length; i += 1) {
    const d = decisions[i];
    const expectedTarget = new Date(
      expect.targetTs.getTime() - (V6_WARMUP_BASE_PREDICTIONS - i) * TF_MS,
    ).toISOString();
    if (!d || new Date(d.target_candle_ts).toISOString() !== expectedTarget) return false;
    if (d.base_v6_prediction !== "GREEN" && d.base_v6_prediction !== "RED" && d.base_v6_prediction !== "ABSTAIN") {
      return false;
    }
  }
  return true;
}
