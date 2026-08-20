// T45 Balanced — boundary orchestration, decisioning and resolution.
//
// Runs strictly at T+45s inside the target candle and must publish before
// T+60s. Fully isolated: it writes only to t45_* tables and cannot influence
// ES1, B4x4, A2, TD1/TD2 or V6. Publication is shadow-only until explicitly
// authorized: `webhook_eligible` is forced false on every row.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  T45_BASE_HEAD,
  T45_CONFIG_HASH,
  T45_CUTOFF_OFFSET_MS,
  T45_FEATURE_ORDER,
  T45_FEATURE_VERSION,
  T45_LOGISTIC_C,
  T45_MODEL_NAME,
  T45_MODEL_VARIANT,
  T45_MODEL_VERSION,
  T45_OUTCOME_SOURCE,
  T45_PUBLISH_DEADLINE_MS,
  T45_R2_PRIOR_KEY,
  T45_SOLVER,
  TF_MS,
  floorTarget,
  isExactBoundary,
  t45UtcDate,
} from "./config";
import { buildT45Features } from "./features";
import {
  fitT45Head,
  t45BlockIndex,
  t45BlockStart,
  t45Decide,
  t45Probability,
  t45Score,
  type T45Head,
} from "./head";
import { resolveT45R2Prior } from "./r2Prior.server";
import {
  auditT45,
  headFromFitRow,
  insertT45Fit,
  loadPriorConfidences,
  loadT45Bars,
  loadT45TrainingRows,
  readT45Fit,
  t45FitId,
  t45RowIndex,
  upsertT45Feature,
  upsertT45Label,
  upsertT45Prediction,
} from "./store.server";

type Row = Record<string, unknown>;

export interface T45RunResult {
  targetTs: string;
  decided: boolean;
  reason: string | null;
  probabilityGreen: number | null;
  confidenceRank: number | null;
  activePrediction: number | null;
  activeSleeve: string | null;
  secondsPresent: number;
  fitId: string | null;
  elapsedMs: number;
}

/** The target candle whose first 45 seconds are complete at time `nowMs`. */
export function t45TargetFor(nowMs: number): { targetTs: string; intoCandleMs: number } {
  const floor = floorTarget(nowMs);
  return { targetTs: new Date(floor).toISOString(), intoCandleMs: nowMs - floor };
}

async function writeInvalid(
  sb: SupabaseClient,
  targetTs: string,
  reason: string,
  extra: Row,
): Promise<void> {
  await upsertT45Prediction(sb, {
    target_ts: targetTs,
    model_name: T45_MODEL_NAME,
    model_version: T45_MODEL_VERSION,
    model_variant: T45_MODEL_VARIANT,
    base_head: T45_BASE_HEAD,
    run_mode: "LIVE",
    local_date: t45UtcDate(targetTs),
    decision_cutoff_ts: new Date(new Date(targetTs).getTime() + T45_CUTOFF_OFFSET_MS).toISOString(),
    decided_at: new Date().toISOString(),
    r2_prior_key: T45_R2_PRIOR_KEY,
    decision_valid: false,
    decision_invalid_reason: reason,
    active_sleeve: "NONE",
    active_would_trade: false,
    active_prediction: 0,
    config_hash: T45_CONFIG_HASH,
    ...extra,
  });
}

/**
 * Produce (or repair) the T45 row for one target candle.
 *
 * Everything is fail-closed: incomplete second bars, a missing certified R2
 * prior, an unavailable walk-forward fit or an insufficient rank history all
 * write an explicit non-decision row rather than a guessed direction.
 */
export async function runT45Boundary(
  sb: SupabaseClient,
  targetTsInput: string,
  opts: { allowLate?: boolean } = {},
): Promise<T45RunResult> {
  const started = Date.now();
  const targetTs = new Date(targetTsInput).toISOString();
  const base: Omit<T45RunResult, "elapsedMs"> = {
    targetTs,
    decided: false,
    reason: null,
    probabilityGreen: null,
    confidenceRank: null,
    activePrediction: null,
    activeSleeve: null,
    secondsPresent: 0,
    fitId: null,
  };
  const done = (r: Partial<T45RunResult>): T45RunResult => ({
    ...base,
    ...r,
    elapsedMs: Date.now() - started,
  });

  if (!isExactBoundary(targetTs)) {
    return done({ reason: "TARGET_NOT_BOUNDARY" });
  }
  const targetMs = new Date(targetTs).getTime();
  const intoCandle = Date.now() - targetMs;
  if (intoCandle < T45_CUTOFF_OFFSET_MS) {
    return done({ reason: "BEFORE_CUTOFF" });
  }
  if (intoCandle >= T45_PUBLISH_DEADLINE_MS && !opts.allowLate) {
    await writeInvalid(sb, targetTs, "PUBLISH_DEADLINE_MISSED", {});
    return done({ reason: "PUBLISH_DEADLINE_MISSED" });
  }

  const bars = await loadT45Bars(sb, targetTs);
  const prior = await resolveT45R2Prior(sb, targetTs);
  const built = buildT45Features(bars, prior.value);

  const featureRow: Row = {
    target_ts: targetTs,
    feature_version: T45_FEATURE_VERSION,
    row_source: "LIVE",
    feature_cutoff_ts: new Date(targetMs + T45_CUTOFF_OFFSET_MS).toISOString(),
    seconds_present: built.secondsPresent,
    spot_complete: built.spotComplete,
    feature_complete: built.featureComplete,
    feature_invalid_reason: built.invalidReason ?? (prior.available ? null : prior.reason),
    r2_prior_key: T45_R2_PRIOR_KEY,
    r2_prior_source: prior.source,
    config_hash: T45_CONFIG_HASH,
    feature_values_json: built.values,
  };
  for (const [k, v] of Object.entries(built.values)) featureRow[k] = v;
  await upsertT45Feature(sb, featureRow);

  if (!built.spotComplete) {
    await writeInvalid(sb, targetTs, built.invalidReason ?? "INCOMPLETE_SECOND_BARS", {
      feature_complete: false,
    });
    return done({ reason: "INCOMPLETE_SECOND_BARS", secondsPresent: built.secondsPresent });
  }
  if (!prior.available) {
    await writeInvalid(sb, targetTs, prior.reason ?? "R2_PRIOR_MISSING", {
      feature_complete: false,
      r2_prior_available: false,
    });
    return done({ reason: prior.reason, secondsPresent: built.secondsPresent });
  }
  if (!built.featureComplete || !built.vector) {
    await writeInvalid(sb, targetTs, built.invalidReason ?? "NON_FINITE_FEATURE", {
      feature_complete: false,
      r2_prior_available: true,
      r2_prior_prediction: prior.value,
      r2_prior_source: prior.source,
    });
    return done({ reason: built.invalidReason, secondsPresent: built.secondsPresent });
  }

  const index = await t45RowIndex(sb, targetTs);
  const blockStart = t45BlockStart(index);
  if (blockStart == null) {
    await writeInvalid(sb, targetTs, "WARMUP_INSUFFICIENT_HISTORY", {
      feature_complete: true,
      r2_prior_available: true,
      r2_prior_prediction: prior.value,
      r2_prior_source: prior.source,
    });
    return done({ reason: "WARMUP_INSUFFICIENT_HISTORY", secondsPresent: built.secondsPresent });
  }

  const fitId = t45FitId(blockStart);
  const storedFit = await readT45Fit(sb, fitId);
  let head: T45Head | null = storedFit ? headFromFitRow(storedFit) : null;
  if (!head) {
    const history = await loadT45TrainingRows(sb, blockStart);
    head = fitT45Head(blockStart, history);
    if (!head) {
      await writeInvalid(sb, targetTs, "FIT_TRAINING_ROWS_INSUFFICIENT", {
        feature_complete: true,
        r2_prior_available: true,
        r2_prior_prediction: prior.value,
        r2_prior_source: prior.source,
        fit_block_index: t45BlockIndex(blockStart),
      });
      return done({ reason: "FIT_TRAINING_ROWS_INSUFFICIENT" });
    }
    await insertT45Fit(sb, {
      fit_id: fitId,
      model_version: T45_MODEL_VERSION,
      block_index: head.blockIndex,
      block_start_index: head.blockStartIndex,
      training_start_ts: head.trainingStartTs,
      training_end_ts: head.trainingEndTs,
      training_row_count: head.trainingRowCount,
      feature_order: T45_FEATURE_ORDER,
      scaler_center: head.scaler.center,
      scaler_scale: head.scaler.scale,
      coefficients: head.coefficients,
      intercept: head.intercept,
      logistic_c: T45_LOGISTIC_C,
      solver: T45_SOLVER,
      converged: head.converged,
      iterations: head.iterations,
      gradient_norm: head.gradientNorm,
      artifact_sha256: null,
    });
  }

  const probability = t45Probability(head, built.vector);
  const priorConfidences = await loadPriorConfidences(sb, targetTs);
  const decision = t45Decide(probability, priorConfidences);

  await upsertT45Prediction(sb, {
    target_ts: targetTs,
    model_name: T45_MODEL_NAME,
    model_version: T45_MODEL_VERSION,
    model_variant: T45_MODEL_VARIANT,
    base_head: T45_BASE_HEAD,
    run_mode: "LIVE",
    local_date: t45UtcDate(targetTs),
    decision_cutoff_ts: new Date(targetMs + T45_CUTOFF_OFFSET_MS).toISOString(),
    decided_at: new Date().toISOString(),
    r2_prior_key: T45_R2_PRIOR_KEY,
    r2_prior_prediction: prior.value,
    r2_prior_source: prior.source,
    r2_prior_available: true,
    probability_green: decision.probabilityGreen,
    confidence: decision.confidence,
    confidence_rank: decision.confidenceRank,
    rank_history_count: decision.rankHistoryCount,
    base_direction: decision.baseDirection,
    active_prediction: decision.activePrediction,
    active_sleeve: decision.activeSleeve,
    active_would_trade: decision.activeWouldTrade,
    precision_core: decision.activeWouldTrade,
    fit_id: fitId,
    fit_block_index: head.blockIndex,
    fit_training_row_count: head.trainingRowCount,
    feature_complete: true,
    decision_valid: true,
    decision_invalid_reason:
      decision.confidenceRank == null ? "RANK_HISTORY_INSUFFICIENT" : null,
    config_hash: T45_CONFIG_HASH,
  });

  await auditT45(sb, "boundary", {
    target_ts: targetTs,
    probability: decision.probabilityGreen,
    rank: decision.confidenceRank,
    prediction: decision.activePrediction,
    fit_id: fitId,
    elapsed_ms: Date.now() - started,
  });

  return done({
    decided: true,
    probabilityGreen: decision.probabilityGreen,
    confidenceRank: decision.confidenceRank,
    activePrediction: decision.activePrediction,
    activeSleeve: decision.activeSleeve,
    secondsPresent: built.secondsPresent,
    fitId,
  });
}

/**
 * Resolve every unresolved LIVE T45 row whose canonical target candle exists.
 * Outcome truth is the canonical OKX 15m confirmed candle, exactly as ES1.
 */
export async function resolveT45Backlog(
  sb: SupabaseClient,
  opts: { limit?: number } = {},
): Promise<{ resolved: number }> {
  const { data } = await sb
    .from("t45_predictions")
    .select("target_ts, active_prediction, active_would_trade")
    .eq("model_version", T45_MODEL_VERSION)
    .eq("run_mode", "LIVE")
    .is("resolved_at", null)
    .order("target_ts", { ascending: true })
    .limit(opts.limit ?? 500);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return { resolved: 0 };

  const oldest = new Date(String(rows[0].target_ts)).toISOString();
  const { data: candleData } = await sb
    .from("candles")
    .select("candle_ts, open, close")
    .gte("candle_ts", oldest)
    .lte("candle_ts", new Date(Date.now() - TF_MS).toISOString())
    .order("candle_ts", { ascending: true });
  const byTs = new Map(
    ((candleData ?? []) as Row[]).map((c) => [new Date(String(c.candle_ts)).toISOString(), c]),
  );

  let resolved = 0;
  for (const r of rows) {
    const ts = new Date(String(r.target_ts)).toISOString();
    const c = byTs.get(ts);
    if (!c) continue;
    const open = Number(c.open);
    const close = Number(c.close);
    if (!Number.isFinite(open) || !Number.isFinite(close)) continue;
    const actual = close > open ? 1 : close < open ? -1 : 0;
    const wouldTrade = r.active_would_trade as boolean | null;
    const prediction = (r.active_prediction ?? null) as 1 | -1 | 0 | null;
    const { result, score } = t45Score(wouldTrade, prediction, actual);

    await sb
      .from("t45_predictions")
      .update({
        actual_open: open,
        actual_close: close,
        actual_direction: actual,
        outcome_source: T45_OUTCOME_SOURCE,
        resolved_at: new Date().toISOString(),
        active_result: result,
        active_score: score,
      } as never)
      .eq("target_ts", ts)
      .eq("model_version", T45_MODEL_VERSION)
      .eq("run_mode", "LIVE");

    // Feed the realized outcome back as the next block's training label.
    await upsertT45Label(sb, ts, actual, actual, T45_OUTCOME_SOURCE);
    resolved++;
  }
  return { resolved };
}
