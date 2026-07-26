// Model 3 FWD orchestrator. Runs after each 15m boundary alongside a96.
// STRICT SEPARATION: does not read from or write to any other model's tables.
//
// Contract:
//   - Canonical stream only: OKX BTC-USDT 15m, confirm=true.
//   - Prediction is persisted BEFORE the target candle opens.
//   - Feature/training rows all use candles with ts <= T-15m (never target).
//   - Idempotent per target_candle_ts (UNIQUE constraint).
//   - Resolution uses the target candle's actual OHLC via RPC.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  M8V3_MODEL_VERSION,
  M8V3_FEATURE_SCHEMA_VERSION,
  M8V3_STREAM,
  M8V3_TIMEFRAME_SEC,
  M8V3_HISTORY_CANDLES,
  M8V3_MIN_TRAINING_ROWS,
  M8V3_L2_LAMBDA,
  M8V3_MAX_ITER,
  M8V3_TOL,
  M8V3_HOLDOUT_ROWS,
  M8V3_ABSTAIN_MARGIN,
  M8V3_TARGET_OPEN_TOLERANCE_BPS,
  M8V3_PRIOR_POLL_ATTEMPTS,
  M8V3_PRIOR_POLL_INTERVAL_MS,
} from "./config";
import { buildTrainingMatrix, M8V3_FEATURE_NAMES, type Candle } from "./features";
import { trainLogistic, predictProb, fitPlatt, applyPlatt } from "./logistic";

const TF_MS = M8V3_TIMEFRAME_SEC * 1000;

function nextCandleBoundary(nowMs: number): Date {
  const rem = nowMs % TF_MS;
  return new Date(nowMs + (TF_MS - rem));
}

async function fetchRecentCandles(sb: SupabaseClient, beforeTs: Date, limit: number): Promise<Candle[]> {
  const { data, error } = await sb
    .from("candles")
    .select("candle_ts, open, high, low, close, volume")
    .eq("symbol", M8V3_STREAM.symbol)
    .eq("timeframe", M8V3_STREAM.timeframe)
    .eq("fetch_source", M8V3_STREAM.provider)
    .eq("confirm", true)
    .lt("candle_ts", beforeTs.toISOString())
    .order("candle_ts", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as Array<Record<string, unknown>>;
  return rows
    .map((r) => ({
      ts: new Date(String(r.candle_ts)).toISOString(),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume ?? 0),
    }))
    .reverse();
}

async function ingestRefresh(sb: SupabaseClient): Promise<void> {
  if (process.env.VITEST) return;
  try {
    const { fetchAndUpsertCandles } = await import("@/lib/okx.server");
    await fetchAndUpsertCandles(sb);
  } catch { /* best-effort */ }
}

/**
 * Poll until the exact T-15m prior candle for `targetTs` is present, or the
 * bounded window expires. Returns the full recent history including the newest
 * confirmed candle.
 */
async function waitForFinalizedHistory(
  sb: SupabaseClient,
  targetTs: Date,
): Promise<{ candles: Candle[]; ready: boolean; attempts: number }> {
  const requiredPriorIso = new Date(targetTs.getTime() - TF_MS).toISOString();
  let candles: Candle[] = [];
  let attempts = 0;
  for (let i = 0; i < M8V3_PRIOR_POLL_ATTEMPTS; i++) {
    attempts = i + 1;
    if (i > 0) await ingestRefresh(sb);
    candles = await fetchRecentCandles(sb, targetTs, M8V3_HISTORY_CANDLES);
    if (candles.length && candles[candles.length - 1].ts === requiredPriorIso) {
      return { candles, ready: true, attempts };
    }
    if (i < M8V3_PRIOR_POLL_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, M8V3_PRIOR_POLL_INTERVAL_MS));
    }
  }
  return { candles, ready: false, attempts };
}

function stableFitId(w: number[], b: number, nTrain: number): string {
  let acc = 0;
  for (const v of w) acc = (acc * 31 + Math.round(v * 1e6)) | 0;
  acc = (acc * 31 + Math.round(b * 1e6)) | 0;
  return `m8v3_${nTrain}_${Math.abs(acc).toString(36)}`;
}

/**
 * Run one prediction for the given (or next) target candle. Idempotent per
 * target_candle_ts. Never throws to the caller.
 */
export async function runModel8V3(
  sb: SupabaseClient,
  opts: { targetCandleTs?: Date } = {},
): Promise<{ ok: boolean; skipped?: string; prediction_id?: string; target_candle_ts?: string; qualified_prediction?: string }> {
  const startMs = Date.now();
  const targetTs = opts.targetCandleTs ?? nextCandleBoundary(startMs);
  const createdBeforeTarget = Date.now() < targetTs.getTime();

  try {
    const existing = await sb
      .from("model8_v3_predictions")
      .select("prediction_id, qualified_prediction, target_candle_ts")
      .eq("target_candle_ts", targetTs.toISOString())
      .maybeSingle();
    if (existing.data) {
      return {
        ok: true,
        skipped: "already_predicted",
        prediction_id: (existing.data as { prediction_id: string }).prediction_id,
        target_candle_ts: targetTs.toISOString(),
        qualified_prediction: (existing.data as { qualified_prediction: string }).qualified_prediction,
      };
    }
  } catch { /* fall through */ }

  const insertBase: Record<string, unknown> = {
    model_version: M8V3_MODEL_VERSION,
    feature_schema_version: M8V3_FEATURE_SCHEMA_VERSION,
    target_candle_ts: targetTs.toISOString(),
    feature_cutoff_ts: new Date(targetTs.getTime() - TF_MS).toISOString(),
    prediction_created_before_target: createdBeforeTarget,
  };

  // Fetch canonical history with bounded retry for the T-15m boundary row.
  const { candles, ready } = await waitForFinalizedHistory(sb, targetTs);
  const priorIso = new Date(targetTs.getTime() - TF_MS).toISOString();
  const featureHistoryValid = ready && candles.length >= M8V3_MIN_TRAINING_ROWS + 25;

  if (!featureHistoryValid) {
    const reason = !ready ? "prior_candle_not_finalized" : `insufficient_history:${candles.length}`;
    const { data: ins, error } = await sb.from("model8_v3_predictions").insert({
      ...insertBase,
      feature_history_valid: false,
      data_quality_valid: false,
      abstain_reason: reason,
      qualified_prediction: "ABSTAIN",
      prediction_latency_ms: Date.now() - startMs,
    }).select("prediction_id").maybeSingle();
    if (error) return { ok: false, skipped: `insert_failed:${error.message}` };
    return { ok: true, skipped: reason, prediction_id: ins?.prediction_id, target_candle_ts: targetTs.toISOString(), qualified_prediction: "ABSTAIN" };
  }

  // Sanity: reject non-contiguous history.
  let contiguous = true;
  for (let i = 1; i < candles.length; i++) {
    const dt = new Date(candles[i].ts).getTime() - new Date(candles[i - 1].ts).getTime();
    if (dt !== TF_MS) { contiguous = false; break; }
  }
  const lastCandle = candles[candles.length - 1];
  const lastIsPrior = lastCandle && lastCandle.ts === priorIso;

  // Try to fetch the target candle's actual open if it already exists (rare
  // fast-path when scheduler runs slightly after boundary) for consistency check.
  let targetOpenAtPrediction: number | null = null;
  try {
    const { data: tgt } = await sb
      .from("candles")
      .select("open")
      .eq("symbol", M8V3_STREAM.symbol)
      .eq("timeframe", M8V3_STREAM.timeframe)
      .eq("fetch_source", M8V3_STREAM.provider)
      .eq("candle_ts", targetTs.toISOString())
      .maybeSingle();
    if (tgt) targetOpenAtPrediction = Number((tgt as { open: number }).open);
  } catch { /* ignore */ }

  let dataQualityValid = contiguous && lastIsPrior;
  let abstainReason: string | null = null;
  if (!contiguous) abstainReason = "history_non_contiguous";
  else if (!lastIsPrior) abstainReason = "last_history_not_prior_boundary";
  if (dataQualityValid && targetOpenAtPrediction != null) {
    const diffBps = Math.abs(targetOpenAtPrediction - lastCandle.close) / lastCandle.close * 10_000;
    if (diffBps > M8V3_TARGET_OPEN_TOLERANCE_BPS) {
      dataQualityValid = false;
      abstainReason = `target_open_vs_prev_close_${diffBps.toFixed(2)}bps`;
    }
  }

  if (!dataQualityValid) {
    const { data: ins, error } = await sb.from("model8_v3_predictions").insert({
      ...insertBase,
      feature_history_valid: true,
      data_quality_valid: false,
      abstain_reason: abstainReason ?? "unknown_data_quality_failure",
      qualified_prediction: "ABSTAIN",
      target_open_at_prediction: targetOpenAtPrediction,
      prediction_latency_ms: Date.now() - startMs,
    }).select("prediction_id").maybeSingle();
    if (error) return { ok: false, skipped: `insert_failed:${error.message}` };
    return { ok: true, skipped: abstainReason ?? "data_quality", prediction_id: ins?.prediction_id, target_candle_ts: targetTs.toISOString(), qualified_prediction: "ABSTAIN" };
  }

  // Build training set + target feature row.
  const { X, y, targetFeatureRow } = buildTrainingMatrix(candles);
  if (X.length < M8V3_MIN_TRAINING_ROWS) {
    const { data: ins } = await sb.from("model8_v3_predictions").insert({
      ...insertBase,
      feature_history_valid: true,
      data_quality_valid: true,
      abstain_reason: `too_few_training_rows:${X.length}`,
      qualified_prediction: "ABSTAIN",
      target_open_at_prediction: targetOpenAtPrediction,
      prediction_latency_ms: Date.now() - startMs,
    }).select("prediction_id").maybeSingle();
    return { ok: true, skipped: "too_few_training_rows", prediction_id: ins?.prediction_id, target_candle_ts: targetTs.toISOString(), qualified_prediction: "ABSTAIN" };
  }

  // Split: hold out last N rows for Platt.
  const holdoutN = Math.min(M8V3_HOLDOUT_ROWS, Math.max(20, Math.floor(X.length * 0.15)));
  const trainX = X.slice(0, X.length - holdoutN);
  const trainY = y.slice(0, y.length - holdoutN);
  const valX = X.slice(X.length - holdoutN);
  const valY = y.slice(y.length - holdoutN);

  const fit = trainLogistic(trainX, trainY, {
    lambda: M8V3_L2_LAMBDA,
    maxIter: M8V3_MAX_ITER,
    tol: M8V3_TOL,
  });
  const rawVal = valX.map((row) => predictProb(row, fit.w, fit.b, fit.means, fit.scales));
  const platt = fitPlatt(rawVal, valY);

  const rawTarget = predictProb(targetFeatureRow, fit.w, fit.b, fit.means, fit.scales);
  const calibrated = applyPlatt(rawTarget, platt.a, platt.b);
  const rawPrediction: "GREEN" | "RED" = rawTarget >= 0.5 ? "GREEN" : "RED";
  const qualified: "GREEN" | "RED" | "ABSTAIN" =
    Math.abs(calibrated - 0.5) < M8V3_ABSTAIN_MARGIN
      ? "ABSTAIN"
      : calibrated >= 0.5 ? "GREEN" : "RED";

  const fit_id = stableFitId(fit.w, fit.b, trainX.length);
  const feature_values: Record<string, number> = {};
  M8V3_FEATURE_NAMES.forEach((name, i) => { feature_values[name] = targetFeatureRow[i]; });

  const { data: ins, error } = await sb.from("model8_v3_predictions").insert({
    ...insertBase,
    feature_history_valid: true,
    data_quality_valid: true,
    abstain_reason: qualified === "ABSTAIN" ? "low_margin" : null,
    feature_values,
    fit_id,
    fit_snapshot: {
      feature_names: M8V3_FEATURE_NAMES,
      weights: fit.w,
      intercept: fit.b,
      means: fit.means,
      scales: fit.scales,
      platt_a: platt.a,
      platt_b: platt.b,
      n_train: trainX.length,
      n_holdout: valX.length,
    },
    raw_probability_green: rawTarget,
    calibrated_probability_green: calibrated,
    raw_prediction: rawPrediction,
    qualified_prediction: qualified,
    target_open_at_prediction: targetOpenAtPrediction,
    prediction_latency_ms: Date.now() - startMs,
  }).select("prediction_id").maybeSingle();

  if (error) return { ok: false, skipped: `insert_failed:${error.message}` };
  return {
    ok: true,
    prediction_id: ins?.prediction_id,
    target_candle_ts: targetTs.toISOString(),
    qualified_prediction: qualified,
  };
}

/**
 * Resolve every model8_v3 prediction whose target candle is at least 15
 * minutes old and unresolved. Never throws.
 */
export async function resolveDueModel8V3(sb: SupabaseClient): Promise<{ attempted: number; resolved: number; failed: number }> {
  const cutoff = new Date(Date.now() - TF_MS).toISOString();
  const { data } = await sb
    .from("model8_v3_predictions")
    .select("prediction_id, target_candle_ts")
    .is("resolved_at", null)
    .lte("target_candle_ts", cutoff)
    .order("target_candle_ts", { ascending: true })
    .limit(50);
  const rows = (data ?? []) as Array<{ prediction_id: string; target_candle_ts: string }>;
  let resolved = 0, failed = 0;
  for (const r of rows) {
    try {
      const { data: candle } = await sb
        .from("candles")
        .select("open, high, low, close, volume")
        .eq("symbol", M8V3_STREAM.symbol)
        .eq("timeframe", M8V3_STREAM.timeframe)
        .eq("fetch_source", M8V3_STREAM.provider)
        .eq("candle_ts", r.target_candle_ts)
        .eq("confirm", true)
        .maybeSingle();
      if (!candle) { failed++; continue; }
      const c = candle as Record<string, unknown>;
      const { error } = await sb.rpc("resolve_model8_v3_prediction", {
        p_prediction_id: r.prediction_id,
        p_actual_open: Number(c.open),
        p_actual_high: Number(c.high),
        p_actual_low: Number(c.low),
        p_actual_close: Number(c.close),
        p_actual_volume: c.volume != null ? Number(c.volume) : null,
      });
      if (error) failed++; else resolved++;
    } catch {
      failed++;
    }
  }
  return { attempted: rows.length, resolved, failed };
}
