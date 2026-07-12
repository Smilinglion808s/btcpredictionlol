// Model C — Dual Horizon live retraining loop.
//
// Fits Global Core (all clean labels) and Recent Full (last 144 clean labels)
// logistic regressions from resolved production rows. Mirrors the Model 7
// Variant B trainer pattern with strict cutoffs, artifact hashes, fit IDs,
// row counts, and fail-closed behavior.
//
// Never blocks the resolver: `maybeRetrainModelC` swallows all errors into
// api_runs and returns null. If a fit fails or produces an unusable result,
// the previous fit (or bootstrap) remains active — no "half-trained" writes.

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildGlobalCoreFeatures,
  buildRecentFullFeatures,
  type CandleRow,
  type PredictionRowForFeatures,
} from "./featurize";
import { fitLogisticRegression } from "../model7/logistic";
import type { ModelCComponentFit } from "./fit";
import {
  MODEL_C_C,
  MODEL_C_HISTORY_LOOKBACK_MS,
  MODEL_C_HISTORY_ROWS,
  MODEL_C_MAX_ITER,
  MODEL_C_MIN_CLEAN_ROWS,
  MODEL_C_RECENT_WINDOW,
  MODEL_C_RETRAIN_EVERY_N_RESOLVED,
  MODEL_C_TOL,
} from "./config";

type CleanPredRow = PredictionRowForFeatures & {
  actual_direction: "GREEN" | "RED" | "DOJI";
  candle_ts: string;
  model_version?: string | null;
};

export interface ModelCTrainerResult {
  fitted: boolean;
  reason?: string;
  fit_id?: string;
  training_model_version?: string;
  global_training_row_count?: number;
  recent_training_row_count?: number;
  global_artifact_sha256?: string;
  recent_artifact_sha256?: string;
  combined_fit_sha256?: string;
  training_cutoff_ts?: string;
}

// -------- helpers --------

function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

interface FitPipeline {
  fit: ModelCComponentFit;
  in_sample_prob_mean: number;
  in_sample_prob_std: number;
}

function fitComponent(
  maps: FeatureMap[],
  labels: number[],
  componentName: "global_core_lr" | "recent_full_lr",
): FitPipeline {
  // Build ordered feature-name universe (sorted for determinism).
  const names = new Set<string>();
  for (const m of maps) for (const k of Object.keys(m)) names.add(k);
  const feature_order = Array.from(names).sort();
  const d = feature_order.length;
  const n = maps.length;

  // Raw matrix.
  const raw: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(d);
    for (let j = 0; j < d; j++) {
      const v = maps[i][feature_order[j]];
      row[j] = typeof v === "number" && Number.isFinite(v) ? v : 0;
    }
    raw[i] = row;
  }

  // Means / scales (population std, sklearn StandardScaler default with_std=true).
  const mean = new Array<number>(d).fill(0);
  const scale = new Array<number>(d).fill(0);
  const varr = new Array<number>(d).fill(0);
  for (let j = 0; j < d; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += raw[i][j];
    mean[j] = s / n;
    let ss = 0;
    for (let i = 0; i < n; i++) {
      const v = raw[i][j] - mean[j];
      ss += v * v;
    }
    const v = ss / Math.max(1, n);
    varr[j] = v;
    const std = Math.sqrt(v);
    scale[j] = std > 1e-9 ? std : 1.0;
  }

  // Standardize.
  const X: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(d);
    for (let j = 0; j < d; j++) row[j] = (raw[i][j] - mean[j]) / scale[j];
    X[i] = row;
  }

  const fit = fitLogisticRegression({
    X, y: labels, C: MODEL_C_C, maxIter: MODEL_C_MAX_ITER, tol: MODEL_C_TOL,
  });

  // Derive vectorizer_vocabulary from ordered names.
  const vectorizer_vocabulary: Record<string, number> = {};
  for (let i = 0; i < feature_order.length; i++) {
    vectorizer_vocabulary[feature_order[i]] = i;
  }

  // In-sample P(green) for calibration monitoring.
  const probs = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    let z = fit.intercept;
    for (let j = 0; j < d; j++) z += X[i][j] * fit.coefficients[j];
    probs[i] = z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
  }
  const pMean = probs.reduce((a, b) => a + b, 0) / Math.max(1, n);
  let pss = 0;
  for (const p of probs) pss += (p - pMean) * (p - pMean);
  const pStd = Math.sqrt(pss / Math.max(1, n));

  const componentBody: Omit<ModelCComponentFit, "artifact_sha256"> = {
    pipeline_order: ["DictVectorizer(sparse=false)", "StandardScaler()", "LogisticRegression()"],
    feature_count: d,
    feature_order,
    vectorizer_vocabulary,
    scaler: { with_mean: true, with_std: true, mean, scale, var: varr },
    classifier: {
      penalty: "l2", C: MODEL_C_C, fit_intercept: true,
      coefficients: fit.coefficients, intercept: fit.intercept,
      solver: "ts-batch-gd", converged: fit.converged,
      iterations: fit.iterations, final_loss: fit.final_loss,
    },
    manual_scoring: { component: componentName },
  };
  const artifact_sha256 = sha256Hex(JSON.stringify(componentBody));

  return {
    fit: { ...componentBody, artifact_sha256 },
    in_sample_prob_mean: pMean,
    in_sample_prob_std: pStd,
  };
}

// Local alias to avoid re-importing from score.ts (identical shape).
type FeatureMap = Record<string, number>;

// -------- main trainer --------

export async function trainModelC(
  supabase: SupabaseClient,
  trainingModelVersion: string,
): Promise<ModelCTrainerResult> {
  // 1. Pull all resolved clean-labeled predictions for this model version,
  //    ordered by candle_ts ASC. Same query shape as Variant B.
  const { data: rowsData, error } = await supabase
    .from("predictions")
    .select("*")
    .eq("symbol", "BTC-USDT")
    .eq("timeframe", "15m")
    .eq("model_version", trainingModelVersion)
    .in("actual_direction", ["GREEN", "RED"])
    .not("actual_next_candle_close", "is", null)
    .order("candle_ts", { ascending: true });
  if (error) throw error;
  const cleanRaw = (rowsData ?? []) as unknown as CleanPredRow[];

  // Dedup by candle_ts (keep the first resolved row per candle). Guards against
  // reconciliation double-writes and preserves chronological ordering.
  const seen = new Set<string>();
  const clean: CleanPredRow[] = [];
  for (const r of cleanRaw) {
    if (!r.candle_ts) continue;
    if (r.actual_direction !== "GREEN" && r.actual_direction !== "RED") continue;
    if (seen.has(r.candle_ts)) continue;
    seen.add(r.candle_ts);
    clean.push(r);
  }

  if (clean.length < MODEL_C_MIN_CLEAN_ROWS) {
    return { fitted: false, reason: `warming_up (${clean.length}/${MODEL_C_MIN_CLEAN_ROWS})` };
  }

  // Compute deterministic cutoff before any expensive work so we can
  // short-circuit if a READY fit already exists for this cutoff.
  const training_cutoff_ts = clean[clean.length - 1].candle_ts;
  const { data: existingReady } = await supabase
    .from("model_c_training_fits")
    .select("fit_id")
    .eq("training_model_version", trainingModelVersion)
    .eq("training_cutoff_ts", training_cutoff_ts)
    .eq("status", "ready")
    .maybeSingle();
  if (existingReady) {
    return { fitted: false, reason: `already_ready_for_cutoff:${training_cutoff_ts}` };
  }

  // 2. Preload enough candle history to cover every training row's lookback.
  const earliest = clean[0].candle_ts;
  const latest = clean[clean.length - 1].candle_ts;
  const historyStart = new Date(new Date(earliest).getTime() - MODEL_C_HISTORY_LOOKBACK_MS).toISOString();
  const { data: candlesData, error: cErr } = await supabase
    .from("candles")
    .select("candle_ts, open, high, low, close, volume")
    .eq("symbol", "BTC-USDT")
    .eq("timeframe", "15m")
    .lt("candle_ts", latest)
    .gt("candle_ts", historyStart)
    .order("candle_ts", { ascending: true });
  if (cErr) throw cErr;
  const asc: CandleRow[] = (candlesData ?? []).map((c) => ({
    candle_ts: c.candle_ts as string,
    open: Number(c.open), high: Number(c.high),
    low: Number(c.low), close: Number(c.close),
    volume: c.volume == null ? null : Number(c.volume),
  }));

  // History strictly BEFORE target — leakage guard identical to live path.
  function histBefore(ts: string): CandleRow[] {
    const tms = new Date(ts).getTime();
    const out: CandleRow[] = [];
    for (let i = asc.length - 1; i >= 0 && out.length < MODEL_C_HISTORY_ROWS; i--) {
      if (new Date(asc[i].candle_ts).getTime() < tms) out.push(asc[i]);
    }
    return out; // most-recent-first per featurize contract
  }

  // 3. Featurize every clean row for BOTH components (single history walk).
  const globalMaps: FeatureMap[] = [];
  const recentAllMaps: FeatureMap[] = [];
  const labels: number[] = [];
  const candleTsList: string[] = [];
  for (const row of clean) {
    const hist = histBefore(row.candle_ts);
    globalMaps.push(buildGlobalCoreFeatures({ row, history: hist }));
    recentAllMaps.push(buildRecentFullFeatures({ row, history: hist }));
    labels.push(row.actual_direction === "GREEN" ? 1 : 0);
    candleTsList.push(row.candle_ts);
  }

  // 4. Split for Recent Full — last MODEL_C_RECENT_WINDOW ELIGIBLE clean rows
  //    ordered by candle timestamp. `clean` is already chronological + deduped.
  const recentSize = Math.min(MODEL_C_RECENT_WINDOW, clean.length);
  const recentStartIdx = clean.length - recentSize;
  const recentMaps = recentAllMaps.slice(recentStartIdx);
  const recentLabels = labels.slice(recentStartIdx);
  const recentStartTs = candleTsList[recentStartIdx];
  const recentEndTs = candleTsList[candleTsList.length - 1];
  // Integrity invariant per spec §6: recent max must not exceed training cutoff.
  if (new Date(recentEndTs).getTime() > new Date(training_cutoff_ts).getTime()) {
    return { fitted: false, reason: "recent_window_exceeds_cutoff" };
  }

  // Guard: both components need at least one YES and one NO class.
  const classCount = (arr: number[]) => arr.reduce((a, b) => a + b, 0);
  if (classCount(labels) === 0 || classCount(labels) === labels.length) {
    return { fitted: false, reason: "global_single_class" };
  }
  if (classCount(recentLabels) === 0 || classCount(recentLabels) === recentLabels.length) {
    return { fitted: false, reason: "recent_single_class" };
  }

  // 5. Fit both components.
  const global = fitComponent(globalMaps, labels, "global_core_lr");
  const recent = fitComponent(recentMaps, recentLabels, "recent_full_lr");

  // 6. Persist. fit_id = "live_" + sha256(inputs) prefix.
  const hashInput = JSON.stringify({
    v: "C_dual_horizon_v1",
    tmv: trainingModelVersion,
    gN: labels.length, rN: recentLabels.length,
    gFirst: candleTsList[0], gLast: candleTsList[candleTsList.length - 1],
    rFirst: recentStartTs, rLast: recentEndTs,
    gSha: global.fit.artifact_sha256,
    rSha: recent.fit.artifact_sha256,
  });
  const combined_fit_sha256 = sha256Hex(hashInput);
  const fit_id = "live_" + combined_fit_sha256.slice(0, 16);

  // First candle strictly AFTER the training cutoff = cutoff + 1 timeframe.
  const cutoffMs = new Date(training_cutoff_ts).getTime();
  const first_eligible_target_ts = new Date(cutoffMs + 15 * 60 * 1000).toISOString();

  // === Atomic publication ===
  // Step 1: write the fit with status='pending'. Component blobs, hashes,
  // and window bounds are all present, but loadActiveModelCFit ignores it.
  const { error: insErr } = await supabase.from("model_c_training_fits").insert({
    fit_id,
    training_model_version: trainingModelVersion,
    training_cutoff_ts,
    global_training_row_count: labels.length,
    recent_training_row_count: recentLabels.length,
    global_artifact_sha256: global.fit.artifact_sha256,
    recent_artifact_sha256: recent.fit.artifact_sha256,
    combined_fit_sha256,
    global_component_fit: global.fit,
    recent_component_fit: recent.fit,
    global_training_window_start_ts: candleTsList[0],
    global_training_window_end_ts: candleTsList[candleTsList.length - 1],
    recent_training_window_start_ts: recentStartTs,
    recent_training_window_end_ts: recentEndTs,
    in_sample_global_prob_mean: Number(global.in_sample_prob_mean.toFixed(4)),
    in_sample_global_prob_std: Number(global.in_sample_prob_std.toFixed(4)),
    in_sample_recent_prob_mean: Number(recent.in_sample_prob_mean.toFixed(4)),
    in_sample_recent_prob_std: Number(recent.in_sample_prob_std.toFixed(4)),
    first_eligible_target_ts,
    fit_source: "live",
    status: "pending",
    fit_meta: {
      C: MODEL_C_C, max_iter: MODEL_C_MAX_ITER, tol: MODEL_C_TOL,
      recent_window: MODEL_C_RECENT_WINDOW,
      recent_rows: recentLabels.length,
      recent_min_ts: recentStartTs,
      recent_max_ts: recentEndTs,
      global_converged: (global.fit.classifier as { converged?: boolean }).converged ?? null,
      recent_converged: (recent.fit.classifier as { converged?: boolean }).converged ?? null,
    },
  } as never);
  if (insErr) throw insErr;

  // Step 2: promote to ready. The unique index on
  //   (training_model_version, training_cutoff_ts) WHERE status='ready'
  // ensures only ONE fit ever wins the race for a given cutoff.
  const { error: promoteErr } = await supabase
    .from("model_c_training_fits")
    .update({
      status: "ready",
      promoted_at: new Date().toISOString(),
    } as never)
    .eq("fit_id", fit_id)
    .eq("status", "pending");
  if (promoteErr) {
    // Someone else won the race — mark ours failed, they own the cutoff.
    await supabase
      .from("model_c_training_fits")
      .update({ status: "failed" } as never)
      .eq("fit_id", fit_id);
    return { fitted: false, reason: `promotion_lost:${promoteErr.message}` };
  }

  return {
    fitted: true,
    fit_id,
    training_model_version: trainingModelVersion,
    training_cutoff_ts,
    global_training_row_count: labels.length,
    recent_training_row_count: recentLabels.length,
    global_artifact_sha256: global.fit.artifact_sha256,
    recent_artifact_sha256: recent.fit.artifact_sha256,
    combined_fit_sha256,
  };
}


// -------- retrain trigger --------

/**
 * Called from the resolver after Model C shadow rows are graded. Fits if
 * either (a) no live fit exists yet and we're past MIN_CLEAN_ROWS, or
 * (b) at least RETRAIN_EVERY_N_RESOLVED new clean rows have been resolved
 * since the last live fit.
 *
 * Fail-closed: any error is swallowed to api_runs and returns null. Live
 * scoring falls back to the previous fit (or the pinned bootstrap).
 */
export async function maybeRetrainModelC(
  supabase: SupabaseClient,
  trainingModelVersion: string,
): Promise<ModelCTrainerResult | null> {
  try {
    // Only READY fits count as "the active fit". Pending/failed rows are ignored.
    const { data: last } = await supabase
      .from("model_c_training_fits")
      .select("global_training_row_count, training_cutoff_ts, promoted_at")
      .eq("training_model_version", trainingModelVersion)
      .eq("status", "ready")
      .order("promoted_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Count distinct, chronologically-newer, cleanly-labeled candles since the
    // active cutoff. Excludes DOJI, pending, malformed, and any duplicate
    // resolutions for the same candle_ts.
    let cleanNow: number;
    let delta: number;
    if (last?.training_cutoff_ts) {
      const { data: newRows } = await supabase
        .from("predictions")
        .select("candle_ts")
        .eq("model_version", trainingModelVersion)
        .in("actual_direction", ["GREEN", "RED"])
        .gt("candle_ts", last.training_cutoff_ts);
      const distinct = new Set<string>();
      for (const r of (newRows ?? []) as Array<{ candle_ts: string }>) {
        if (r.candle_ts) distinct.add(r.candle_ts);
      }
      delta = distinct.size;
      cleanNow = (last.global_training_row_count ?? 0) + delta;
    } else {
      const { data: allRows } = await supabase
        .from("predictions")
        .select("candle_ts")
        .eq("model_version", trainingModelVersion)
        .in("actual_direction", ["GREEN", "RED"]);
      const distinct = new Set<string>();
      for (const r of (allRows ?? []) as Array<{ candle_ts: string }>) {
        if (r.candle_ts) distinct.add(r.candle_ts);
      }
      cleanNow = distinct.size;
      delta = cleanNow;
    }

    const needsFirstFit = !last && cleanNow >= MODEL_C_MIN_CLEAN_ROWS;
    const needsRefit = !!last && delta >= MODEL_C_RETRAIN_EVERY_N_RESOLVED;
    if (!needsFirstFit && !needsRefit) return null;

    const result = await trainModelC(supabase, trainingModelVersion);
    await supabase.from("api_runs").insert({
      run_type: "model_c_retrain",
      request_payload: {
        training_model_version: trainingModelVersion,
        clean_now: cleanNow,
        delta_since_active_cutoff: delta,
        active_cutoff_ts: last?.training_cutoff_ts ?? null,
      },
      response_payload: result as unknown as Record<string, unknown>,
      success: result.fitted,
      error_message: result.fitted ? null : (result.reason ?? "not_fitted"),
    });
    return result;
  } catch (e) {

    try {
      await supabase.from("api_runs").insert({
        run_type: "model_c_retrain_error",
        request_payload: { training_model_version: trainingModelVersion },
        response_payload: { error: e instanceof Error ? e.message : String(e) },
        success: false,
        error_message: e instanceof Error ? e.message : String(e),
      });
    } catch { /* ignore */ }
    return null;
  }
}
