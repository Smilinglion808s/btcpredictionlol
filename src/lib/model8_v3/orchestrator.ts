// Model 3 FWD orchestrator — v3.0.0 forward-test build.
// Runs after each 15m boundary. Fully independent of every other model.
//
// v3.0.0 contract:
//   - Two independent logistic heads: direction (GREEN vs RED) + movement
//     (|body|>=movement_threshold_bps).
//   - Chronological training / calibration split: last 384 rows are reserved
//     for Platt calibration and never enter the base fit.
//   - Total labeled rows required: min 1536 training + 384 calibration.
//     Prefers 4096 training when history allows (max 8192).
//   - Immutable fit stored in model8_v3_fits; every prediction records fit_id.
//   - Idempotent per (model_version, symbol, timeframe, target_candle_ts).
//   - Fully wrapped in try/catch so it cannot break sibling models.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import {
  M8V3_MODEL_VERSION,
  M8V3_FEATURE_SCHEMA_VERSION,
  M8V3_CODE_VERSION,
  M8V3_STREAM,
  M8V3_TIMEFRAME_SEC,
  M8V3_MIN_TRAINING_ROWS,
  M8V3_PREFERRED_TRAINING_ROWS,
  M8V3_MAX_TRAINING_ROWS,
  M8V3_CALIBRATION_ROWS,
  M8V3_RETRAIN_EVERY_RESOLVED_ROWS,
  M8V3_L2_LAMBDA,
  M8V3_MAX_ITER,
  M8V3_TOL,
  M8V3_MIN_DIRECTION_EDGE,
  M8V3_MIN_MOVEMENT_PROBABILITY,
  M8V3_MOVEMENT_THRESHOLD_BPS,
  M8V3_TARGET_OPEN_TOLERANCE_BPS,
  M8V3_PRIOR_POLL_ATTEMPTS,
  M8V3_PRIOR_POLL_INTERVAL_MS,
  M8V3_FEATURE_LOOKBACK,
} from "./config";
import { buildTrainingMatrix, M8V3_FEATURE_NAMES, type Candle } from "./features";
import { trainLogistic, predictProb, fitPlatt, applyPlatt } from "./logistic";
import { computeRegimeSnapshot } from "./regime";
import { buildCandidateReviewReport } from "./review";

const TF_MS = M8V3_TIMEFRAME_SEC * 1000;
// Total labeled rows to load. Add lookback + slack for the target row.
const HISTORY_LOAD =
  M8V3_MAX_TRAINING_ROWS + M8V3_CALIBRATION_ROWS + M8V3_FEATURE_LOOKBACK + 8;

function nextCandleBoundary(nowMs: number): Date {
  const rem = nowMs % TF_MS;
  return new Date(nowMs + (TF_MS - rem));
}

async function fetchRecentCandles(sb: SupabaseClient, beforeTs: Date, limit: number): Promise<Candle[]> {
  // Page through in 1000-row chunks (PostgREST cap) so we can load full
  // multi-thousand candle windows in strict chronological order.
  const PAGE = 1000;
  const collected: Array<Record<string, unknown>> = [];
  for (let offset = 0; offset < limit; offset += PAGE) {
    const take = Math.min(PAGE, limit - offset);
    const { data, error } = await sb
      .from("candles")
      .select("candle_ts, open, high, low, close, volume")
      .eq("symbol", M8V3_STREAM.symbol)
      .eq("timeframe", M8V3_STREAM.timeframe)
      .eq("fetch_source", M8V3_STREAM.provider)
      .eq("confirm", true)
      .lt("candle_ts", beforeTs.toISOString())
      .order("candle_ts", { ascending: false })
      .range(offset, offset + take - 1);
    if (error) throw error;
    const batch = (data ?? []) as Array<Record<string, unknown>>;
    collected.push(...batch);
    if (batch.length < take) break;
  }
  return collected
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
    candles = await fetchRecentCandles(sb, targetTs, HISTORY_LOAD);
    if (candles.length && candles[candles.length - 1].ts === requiredPriorIso) {
      return { candles, ready: true, attempts };
    }
    if (i < M8V3_PRIOR_POLL_ATTEMPTS - 1) {
      await new Promise((r) => setTimeout(r, M8V3_PRIOR_POLL_INTERVAL_MS));
    }
  }
  return { candles, ready: false, attempts };
}

function stableFitId(dirW: number[], dirB: number, moveW: number[], moveB: number, nTrain: number): string {
  const h = createHash("sha256");
  h.update(M8V3_MODEL_VERSION);
  h.update("|");
  h.update(String(nTrain));
  h.update("|");
  for (const v of dirW) h.update(v.toFixed(8));
  h.update("|d=" + dirB.toFixed(8));
  for (const v of moveW) h.update(v.toFixed(8));
  h.update("|m=" + moveB.toFixed(8));
  return `v3_${nTrain}_${h.digest("hex").slice(0, 12)}`;
}

/** Count resolved forward-test rows since the currently active fit was activated. */
async function resolvedRowsSinceFit(sb: SupabaseClient, fitId: string | null): Promise<number> {
  if (!fitId) return Number.POSITIVE_INFINITY;
  const { data } = await sb
    .from("model8_v3_fits")
    .select("activated_at")
    .eq("fit_id", fitId)
    .maybeSingle();
  const activatedAt = (data as { activated_at?: string } | null)?.activated_at;
  if (!activatedAt) return Number.POSITIVE_INFINITY;
  const { count } = await sb
    .from("model8_v3_predictions")
    .select("prediction_id", { count: "exact", head: true })
    .eq("model_version", M8V3_MODEL_VERSION)
    .eq("fit_id", fitId)
    .not("resolved_at", "is", null)
    .gte("resolved_at", activatedAt);
  return count ?? 0;
}

/** Look up the newest activated fit for the current model version, if any. */
async function loadActiveFit(sb: SupabaseClient): Promise<null | {
  fit_id: string;
  weights_dir: number[]; intercept_dir: number;
  weights_move: number[]; intercept_move: number;
  means: number[]; scales: number[];
  platt_dir: { a: number; b: number };
  platt_move: { a: number; b: number };
  n_train: number;
}> {
  const { data } = await sb
    .from("model8_v3_fits")
    .select("*")
    .eq("model_version", M8V3_MODEL_VERSION)
    .eq("status", "active")
    .order("activated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const d = data as Record<string, unknown>;
  const pre = d.preprocess as { means: number[]; scales: number[] };
  return {
    fit_id: String(d.fit_id),
    weights_dir: d.direction_coefficients as number[],
    intercept_dir: Number(d.direction_intercept),
    weights_move: d.movement_coefficients as number[],
    intercept_move: Number(d.movement_intercept),
    means: pre.means,
    scales: pre.scales,
    platt_dir: d.platt_direction as { a: number; b: number },
    platt_move: d.platt_movement as { a: number; b: number },
    n_train: Number((d.training_metrics as { n_train?: number })?.n_train ?? 0),
  };
}

interface DualFit {
  fit_id: string;
  weights_dir: number[]; intercept_dir: number;
  weights_move: number[]; intercept_move: number;
  means: number[]; scales: number[];
  platt_dir: { a: number; b: number };
  platt_move: { a: number; b: number };
  n_train: number;
}

async function trainNewFit(
  sb: SupabaseClient,
  candles: Candle[],
  opts: { intent: "bootstrap" | "candidate"; priorActiveFitId?: string | null } = { intent: "bootstrap" },
): Promise<
  | { ok: true; fit: DualFit; status: "active" | "pending_review" }
  | { ok: false; reason: string }
> {
  const { X, yDir, yMove } = buildTrainingMatrix(candles, M8V3_MOVEMENT_THRESHOLD_BPS);
  const totalRows = X.length;
  const needed = M8V3_MIN_TRAINING_ROWS + M8V3_CALIBRATION_ROWS;
  if (totalRows < needed) {
    return { ok: false, reason: `insufficient_labeled_rows:${totalRows}<${needed}` };
  }

  // Chronological hold-out for Platt calibration; then optionally trim training.
  const calStart = totalRows - M8V3_CALIBRATION_ROWS;
  const rawTrainX = X.slice(0, calStart);
  const rawTrainYDir = yDir.slice(0, calStart);
  const rawTrainYMove = yMove.slice(0, calStart);
  const calX = X.slice(calStart);
  const calYDir = yDir.slice(calStart);
  const calYMove = yMove.slice(calStart);

  // Prefer M8V3_PREFERRED_TRAINING_ROWS, cap at MAX, keep >= MIN.
  const targetTrain = Math.min(
    M8V3_MAX_TRAINING_ROWS,
    Math.max(M8V3_MIN_TRAINING_ROWS, Math.min(rawTrainX.length, M8V3_PREFERRED_TRAINING_ROWS)),
  );
  const trimFrom = rawTrainX.length - targetTrain;
  const trainX = rawTrainX.slice(trimFrom);
  const trainYDir = rawTrainYDir.slice(trimFrom);
  const trainYMove = rawTrainYMove.slice(trimFrom);

  const dir = trainLogistic(trainX, trainYDir, { lambda: M8V3_L2_LAMBDA, maxIter: M8V3_MAX_ITER, tol: M8V3_TOL });
  const mov = trainLogistic(trainX, trainYMove, { lambda: M8V3_L2_LAMBDA, maxIter: M8V3_MAX_ITER, tol: M8V3_TOL });

  const rawCalDir = calX.map((row) => predictProb(row, dir.w, dir.b, dir.means, dir.scales));
  const rawCalMove = calX.map((row) => predictProb(row, mov.w, mov.b, mov.means, mov.scales));
  const platt_dir = fitPlatt(rawCalDir, calYDir);
  const platt_move = fitPlatt(rawCalMove, calYMove);

  const fit_id = stableFitId(dir.w, dir.b, mov.w, mov.b, trainX.length);

  // Persist immutable fit. Timestamps derived from candle window.
  const trainingCandleStartIdx = M8V3_FEATURE_LOOKBACK + trimFrom;
  const trainingCandleEndIdx = M8V3_FEATURE_LOOKBACK + trimFrom + trainX.length - 1;
  const calStartCandleIdx = M8V3_FEATURE_LOOKBACK + calStart;
  const calEndCandleIdx = M8V3_FEATURE_LOOKBACK + calStart + calX.length - 1;

  // Simple calibration metrics
  const brier = (probs: number[], y: number[]) => probs.reduce((s, p, i) => s + (p - y[i]) ** 2, 0) / Math.max(1, probs.length);
  const acc = (probs: number[], y: number[]) => probs.reduce((s, p, i) => s + ((p >= 0.5 ? 1 : 0) === y[i] ? 1 : 0), 0) / Math.max(1, probs.length);
  const calibratedDir = rawCalDir.map((p) => applyPlatt(p, platt_dir.a, platt_dir.b));
  const calibratedMove = rawCalMove.map((p) => applyPlatt(p, platt_move.a, platt_move.b));

  const isCandidate = opts.intent === "candidate";
  const status = isCandidate ? "pending_review" : "active";
  const fitRow: Record<string, unknown> = {
    fit_id,
    model_version: M8V3_MODEL_VERSION,
    feature_schema_version: M8V3_FEATURE_SCHEMA_VERSION,
    code_version: M8V3_CODE_VERSION,
    symbol: M8V3_STREAM.symbol,
    timeframe: M8V3_STREAM.timeframe,
    training_start_ts: candles[trainingCandleStartIdx]?.ts ?? candles[0].ts,
    training_end_ts: candles[trainingCandleEndIdx]?.ts ?? candles[candles.length - 1].ts,
    calibration_start_ts: candles[calStartCandleIdx]?.ts ?? candles[calStart].ts,
    calibration_end_ts: candles[calEndCandleIdx]?.ts ?? candles[candles.length - 1].ts,
    feature_order: M8V3_FEATURE_NAMES as unknown as string[],
    preprocess: { means: dir.means, scales: dir.scales },
    direction_coefficients: dir.w,
    direction_intercept: dir.b,
    movement_coefficients: mov.w,
    movement_intercept: mov.b,
    l2_penalty: M8V3_L2_LAMBDA,
    platt_direction: platt_dir,
    platt_movement: platt_move,
    config_snapshot: {
      minimum_direction_edge: M8V3_MIN_DIRECTION_EDGE,
      minimum_movement_probability: M8V3_MIN_MOVEMENT_PROBABILITY,
      movement_threshold_bps: M8V3_MOVEMENT_THRESHOLD_BPS,
      min_training_rows: M8V3_MIN_TRAINING_ROWS,
      preferred_training_rows: M8V3_PREFERRED_TRAINING_ROWS,
      max_training_rows: M8V3_MAX_TRAINING_ROWS,
      calibration_rows: M8V3_CALIBRATION_ROWS,
      retrain_every_resolved_rows: M8V3_RETRAIN_EVERY_RESOLVED_ROWS,
      l2_lambda: M8V3_L2_LAMBDA,
    },
    training_metrics: { n_train: trainX.length, n_calibration: calX.length },
    calibration_metrics: {
      brier_direction: brier(calibratedDir, calYDir),
      acc_direction: acc(calibratedDir, calYDir),
      brier_movement: brier(calibratedMove, calYMove),
      acc_movement: acc(calibratedMove, calYMove),
    },
    fitted_at: new Date().toISOString(),
    activated_at: new Date().toISOString(),
    status,
    review_requested_at: isCandidate ? new Date().toISOString() : null,
    prior_active_fit_id: opts.priorActiveFitId ?? null,
  };
  const { error } = await sb.from("model8_v3_fits").insert(fitRow);
  if (error && !String(error.message).includes("duplicate")) {
    return { ok: false, reason: `fit_insert_failed:${error.message}` };
  }

  return {
    ok: true,
    status,
    fit: {
      fit_id,
      weights_dir: dir.w, intercept_dir: dir.b,
      weights_move: mov.w, intercept_move: mov.b,
      means: dir.means, scales: dir.scales,
      platt_dir, platt_move,
      n_train: trainX.length,
    },
  };
}

/** Run one prediction for the given (or next) target candle. Idempotent. */
export async function runModel8V3(
  sb: SupabaseClient,
  opts: { targetCandleTs?: Date } = {},
): Promise<{ ok: boolean; skipped?: string; prediction_id?: string; target_candle_ts?: string; qualified_prediction?: string; raw_prediction?: string }> {
  const startMs = Date.now();
  const targetTs = opts.targetCandleTs ?? nextCandleBoundary(startMs);
  const createdBeforeTarget = Date.now() < targetTs.getTime();

  try {
    const existing = await sb
      .from("model8_v3_predictions")
      .select("prediction_id, qualified_prediction, raw_prediction, target_candle_ts")
      .eq("model_version", M8V3_MODEL_VERSION)
      .eq("symbol", M8V3_STREAM.symbol)
      .eq("timeframe", M8V3_STREAM.timeframe)
      .eq("target_candle_ts", targetTs.toISOString())
      .maybeSingle();
    if (existing.data) {
      const e = existing.data as Record<string, unknown>;
      return {
        ok: true,
        skipped: "already_predicted",
        prediction_id: String(e.prediction_id),
        target_candle_ts: targetTs.toISOString(),
        qualified_prediction: e.qualified_prediction as string,
        raw_prediction: e.raw_prediction as string | undefined,
      };
    }
  } catch { /* fall through */ }

  const insertBase: Record<string, unknown> = {
    model_version: M8V3_MODEL_VERSION,
    feature_schema_version: M8V3_FEATURE_SCHEMA_VERSION,
    code_version: M8V3_CODE_VERSION,
    symbol: M8V3_STREAM.symbol,
    timeframe: M8V3_STREAM.timeframe,
    episode_type: "official_v3_forward_test",
    target_candle_ts: targetTs.toISOString(),
    feature_cutoff_ts: new Date(targetTs.getTime() - TF_MS).toISOString(),
    prediction_created_before_target: createdBeforeTarget,
    movement_threshold_bps: M8V3_MOVEMENT_THRESHOLD_BPS,
    minimum_direction_edge: M8V3_MIN_DIRECTION_EDGE,
    minimum_movement_probability: M8V3_MIN_MOVEMENT_PROBABILITY,
  };

  const abstainInsert = async (reason: string, extra: Record<string, unknown> = {}) => {
    const row = {
      ...insertBase,
      feature_history_valid: false,
      data_quality_valid: false,
      data_quality_invalid_reason: reason,
      abstain_reason: reason,
      qualified_prediction: "ABSTAIN",
      official_forward_test_row: false,
      prediction_latency_ms: Date.now() - startMs,
      ...extra,
    };
    const { data: ins, error } = await sb.from("model8_v3_predictions")
      .insert(row).select("prediction_id").maybeSingle();
    if (error) return { ok: false, skipped: `insert_failed:${error.message}` } as const;
    return {
      ok: true,
      skipped: reason,
      prediction_id: (ins as { prediction_id?: string } | null)?.prediction_id,
      target_candle_ts: targetTs.toISOString(),
      qualified_prediction: "ABSTAIN",
    } as const;
  };

  const { candles, ready } = await waitForFinalizedHistory(sb, targetTs);
  const priorIso = new Date(targetTs.getTime() - TF_MS).toISOString();
  if (!ready) return abstainInsert("prior_candle_not_finalized");

  // Data-quality checks: contiguous history + prior boundary.
  let contiguous = true;
  for (let i = 1; i < candles.length; i++) {
    const dt = new Date(candles[i].ts).getTime() - new Date(candles[i - 1].ts).getTime();
    if (dt !== TF_MS) { contiguous = false; break; }
  }
  const lastCandle = candles[candles.length - 1];
  const lastIsPrior = !!lastCandle && lastCandle.ts === priorIso;
  if (!contiguous) return abstainInsert("history_non_contiguous", { feature_history_valid: true });
  if (!lastIsPrior) return abstainInsert("last_history_not_prior_boundary", { feature_history_valid: true });

  // Optional consistency check with target candle open if already present.
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
  if (targetOpenAtPrediction != null) {
    const diffBps = Math.abs(targetOpenAtPrediction - lastCandle.close) / lastCandle.close * 10_000;
    if (diffBps > M8V3_TARGET_OPEN_TOLERANCE_BPS) {
      return abstainInsert(`target_open_vs_prev_close_${diffBps.toFixed(2)}bps`, {
        feature_history_valid: true,
        target_open_at_prediction: targetOpenAtPrediction,
      });
    }
  }

  // Fit selection — v3.0.1 manual-approval flow.
  // Bootstrap only trains an ACTIVE fit when no active fit exists yet.
  // Every 96 resolved non-PUSH rows we train a CANDIDATE fit with status
  // 'pending_review' and persist a candidate-vs-active review report.
  // The candidate NEVER auto-activates; the active fit keeps serving.
  let fit: DualFit | null = null;
  const active = await loadActiveFit(sb);
  if (active) {
    fit = active;
    try {
      const sinceCount = await resolvedRowsSinceFit(sb, active.fit_id);
      if (sinceCount >= M8V3_RETRAIN_EVERY_RESOLVED_ROWS) {
        // Only train a new candidate when none is currently awaiting review.
        const { data: pending } = await sb
          .from("model8_v3_fits")
          .select("fit_id")
          .eq("model_version", M8V3_MODEL_VERSION)
          .eq("status", "pending_review")
          .limit(1)
          .maybeSingle();
        if (!pending) {
          const trained = await trainNewFit(sb, candles, { intent: "candidate", priorActiveFitId: active.fit_id });
          if (trained.ok) {
            try {
              const report = await buildCandidateReviewReportFromDb(sb, trained.fit, active);
              await sb.from("model8_v3_fits")
                .update({ review_report: report })
                .eq("fit_id", trained.fit.fit_id);
              await sb.from("model8_v3_fit_reviews").insert({
                model_version: M8V3_MODEL_VERSION,
                candidate_fit_id: trained.fit.fit_id,
                active_fit_id: active.fit_id,
                report,
              });
            } catch { /* best-effort audit */ }
          }
        }
      }
    } catch { /* candidate training never blocks live prediction */ }
  } else {
    const trained = await trainNewFit(sb, candles, { intent: "bootstrap" });
    if (!trained.ok) {
      return abstainInsert(trained.reason, {
        feature_history_valid: true,
        data_quality_valid: true,
        target_open_at_prediction: targetOpenAtPrediction,
      });
    }
    fit = trained.fit;
  }
  if (!fit) {
    return abstainInsert("no_active_fit", {
      feature_history_valid: true,
      data_quality_valid: true,
      target_open_at_prediction: targetOpenAtPrediction,
    });
  }

  // Build target feature row from same candle window (last-index features).
  const { targetFeatureRow } = buildTrainingMatrix(candles, M8V3_MOVEMENT_THRESHOLD_BPS);

  // Regime snapshot — MONITORING ONLY. Not used to select fit, alter
  // thresholds, feed the model, or trigger retraining.
  const regime = computeRegimeSnapshot(candles);

  const rawDirGreen = predictProb(targetFeatureRow, fit.weights_dir, fit.intercept_dir, fit.means, fit.scales);
  const rawMove = predictProb(targetFeatureRow, fit.weights_move, fit.intercept_move, fit.means, fit.scales);
  const calDirGreen = applyPlatt(rawDirGreen, fit.platt_dir.a, fit.platt_dir.b);
  const calMove = applyPlatt(rawMove, fit.platt_move.a, fit.platt_move.b);

  const rawPrediction: "GREEN" | "RED" = rawDirGreen >= 0.5 ? "GREEN" : "RED";
  const dirEdge = calDirGreen - 0.5;
  let qualified: "GREEN" | "RED" | "ABSTAIN" = "ABSTAIN";
  let abstainReason: string | null = null;
  if (calMove < M8V3_MIN_MOVEMENT_PROBABILITY) {
    abstainReason = `movement_probability_${calMove.toFixed(3)}<${M8V3_MIN_MOVEMENT_PROBABILITY}`;
  } else if (Math.abs(dirEdge) < M8V3_MIN_DIRECTION_EDGE) {
    abstainReason = `direction_edge_${Math.abs(dirEdge).toFixed(3)}<${M8V3_MIN_DIRECTION_EDGE}`;
  } else {
    qualified = dirEdge > 0 ? "GREEN" : "RED";
  }

  const feature_values: Record<string, number> = {};
  M8V3_FEATURE_NAMES.forEach((name, i) => { feature_values[name] = targetFeatureRow[i]; });

  const { data: ins, error } = await sb.from("model8_v3_predictions").insert({
    ...insertBase,
    feature_history_valid: true,
    data_quality_valid: true,
    abstain_reason: abstainReason,
    feature_values,
    fit_id: fit.fit_id,
    fit_snapshot: {
      feature_names: M8V3_FEATURE_NAMES,
      weights_direction: fit.weights_dir, intercept_direction: fit.intercept_dir,
      weights_movement: fit.weights_move, intercept_movement: fit.intercept_move,
      means: fit.means, scales: fit.scales,
      platt_direction: fit.platt_dir, platt_movement: fit.platt_move,
      n_train: fit.n_train,
    },
    raw_probability_green: rawDirGreen,
    calibrated_probability_green: calDirGreen,
    raw_probability_movement: rawMove,
    calibrated_probability_movement: calMove,
    raw_prediction: rawPrediction,
    qualified_prediction: qualified,
    target_open_at_prediction: targetOpenAtPrediction,
    official_forward_test_row: createdBeforeTarget,
    prediction_latency_ms: Date.now() - startMs,
    // Regime monitoring — persisted alongside every prediction. Not used
    // to alter the prediction itself in v3.0.1.
    atr_14_to_price: regime.atr_14_to_price,
    realized_volatility_8: regime.realized_volatility_8,
    realized_volatility_32: regime.realized_volatility_32,
    volatility_ratio_8_32: regime.volatility_ratio_8_32,
    trend_efficiency_8: regime.trend_efficiency_8,
    trend_efficiency_32: regime.trend_efficiency_32,
    ema9_minus_ema21_to_atr: regime.ema9_minus_ema21_to_atr,
    volume_zscore_32: regime.volume_zscore_32,
    volatility_percentile_256: regime.volatility_percentile_256,
    trend_percentile_256: regime.trend_percentile_256,
    volume_percentile_256: regime.volume_percentile_256,
    regime_label: regime.regime_label,
    regime_transition_score: regime.regime_transition_score,
    regime_alerts: regime.regime_alerts,
  }).select("prediction_id").maybeSingle();

  if (error) return { ok: false, skipped: `insert_failed:${error.message}` };
  return {
    ok: true,
    prediction_id: (ins as { prediction_id?: string } | null)?.prediction_id,
    target_candle_ts: targetTs.toISOString(),
    qualified_prediction: qualified,
    raw_prediction: rawPrediction,
  };
}

/** Resolve every unresolved prediction whose target candle is at least 15m old. */
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
