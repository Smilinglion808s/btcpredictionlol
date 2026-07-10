// Variant B trainer — refits a fresh logistic regression on all resolved
// clean-labeled predictions from the current production model_version.
// Feature set is the CLEANED set (spec §variant_B): all v1.1 features except
// absolute price/EMA/range level columns and their __missing indicators.

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildFeatureMap, type Candle, type PredictionRow } from "./featurize";
import { fitLogisticRegression } from "./logistic";
import {
  VARIANT_B_C, VARIANT_B_MAX_ITER, VARIANT_B_TOL,
  VARIANT_B_MIN_CLEAN_ROWS, VARIANT_B_DROPPED_FEATURES,
} from "./config";

const HISTORY_DEPTH_CANDLES = 24; // ≥ max(LAG_WINDOWS)+buffer

export interface TrainerResult {
  fitted: boolean;
  reason?: string;
  model_fit_id?: string;
  training_row_count?: number;
  feature_count?: number;
  final_loss?: number;
  converged?: boolean;
}

function isDroppedFeatureName(name: string): boolean {
  if (VARIANT_B_DROPPED_FEATURES.has(name)) return true;
  // Also drop the __missing sibling.
  if (name.endsWith("__missing")) {
    const base = name.slice(0, -"__missing".length);
    if (VARIANT_B_DROPPED_FEATURES.has(base)) return true;
  }
  return false;
}

export async function trainVariantB(
  supabase: SupabaseClient,
  trainingModelVersion: string,
): Promise<TrainerResult> {
  // Pull all resolved clean-labeled rows for the current model.
  const { data: rows, error } = await supabase
    .from("predictions")
    .select("*")
    .eq("symbol", "BTC-USDT")
    .eq("timeframe", "15m")
    .eq("model_version", trainingModelVersion)
    .in("actual_direction", ["GREEN", "RED"])
    .not("actual_next_candle_close", "is", null)
    .order("candle_ts", { ascending: true });
  if (error) throw error;
  const clean = (rows ?? []) as unknown as PredictionRow[] & { actual_direction: string; candle_ts: string }[];

  if (clean.length < VARIANT_B_MIN_CLEAN_ROWS) {
    return { fitted: false, reason: `warming_up (${clean.length}/${VARIANT_B_MIN_CLEAN_ROWS})` };
  }

  // Preload sufficient candle history for lag features.
  const earliest = clean[0].candle_ts;
  const { data: candlesData } = await supabase
    .from("candles")
    .select("candle_ts,open,high,low,close,volume")
    .eq("symbol", "BTC-USDT").eq("timeframe", "15m")
    .lt("candle_ts", clean[clean.length - 1].candle_ts)
    .gt("candle_ts", new Date(new Date(earliest).getTime() - 7 * 24 * 3600_000).toISOString())
    .order("candle_ts", { ascending: true });
  const asc: Candle[] = (candlesData ?? []).map((c) => ({
    candle_ts: c.candle_ts as string,
    open: Number(c.open), high: Number(c.high),
    low: Number(c.low), close: Number(c.close),
    volume: c.volume === null ? null : Number(c.volume),
  }));

  function histBefore(ts: string): Candle[] {
    const tms = new Date(ts).getTime();
    const out: Candle[] = [];
    for (let i = asc.length - 1; i >= 0 && out.length < HISTORY_DEPTH_CANDLES; i--) {
      if (new Date(asc[i].candle_ts).getTime() < tms) out.push(asc[i]);
    }
    return out;
  }

  // Pass 1: featurize all training rows, collect feature-name universe.
  const maps: Array<{ f: Record<string, number>; y: number }> = [];
  const featureNames = new Set<string>();
  for (const row of clean) {
    const { feature_map } = buildFeatureMap(row, histBefore(row.candle_ts));
    for (const k of Object.keys(feature_map)) {
      if (isDroppedFeatureName(k)) continue;
      featureNames.add(k);
    }
    const y = (row as unknown as { actual_direction: string }).actual_direction === "GREEN" ? 1 : 0;
    maps.push({ f: feature_map, y });
  }
  const feature_order = Array.from(featureNames).sort();

  // Pass 2: build X matrix and compute means/stds (for feature_scales).
  const d = feature_order.length;
  const n = maps.length;
  const raw: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(d);
    for (let j = 0; j < d; j++) row[j] = maps[i].f[feature_order[j]] ?? 0;
    raw[i] = row;
  }
  const means = new Array<number>(d).fill(0);
  const scales = new Array<number>(d).fill(0);
  for (let j = 0; j < d; j++) {
    let s = 0;
    for (let i = 0; i < n; i++) s += raw[i][j];
    means[j] = s / n;
    let ss = 0;
    for (let i = 0; i < n; i++) { const v = raw[i][j] - means[j]; ss += v * v; }
    const std = Math.sqrt(ss / Math.max(1, n));
    scales[j] = std > 1e-9 ? std : 1.0; // guard zero-variance columns
  }
  // Standardize.
  const X: number[][] = new Array(n);
  for (let i = 0; i < n; i++) {
    const row = new Array<number>(d);
    for (let j = 0; j < d; j++) row[j] = (raw[i][j] - means[j]) / scales[j];
    X[i] = row;
  }
  const y = maps.map((m) => m.y);

  const fit = fitLogisticRegression({
    X, y, C: VARIANT_B_C, maxIter: VARIANT_B_MAX_ITER, tol: VARIANT_B_TOL,
  });

  // Derive categorical vocab from observed feature names.
  const vocab: Record<string, string[]> = {};
  for (const name of feature_order) {
    const idx = name.indexOf("=");
    if (idx < 0) continue;
    (vocab[name.slice(0, idx)] ||= []).push(name.slice(idx + 1));
  }

  const hashInput = JSON.stringify({
    v: "B", tmv: trainingModelVersion, n, d,
    first_ts: clean[0].candle_ts, last_ts: clean[clean.length - 1].candle_ts,
  });
  const model_fit_id = "B_" + createHash("sha256").update(hashInput).digest("hex").slice(0, 16);

  await supabase.from("model7_training_fits").insert({
    variant: "B",
    model_fit_id,
    training_model_version: trainingModelVersion,
    training_row_count: n,
    training_window_start: clean[0].candle_ts,
    training_window_end: clean[clean.length - 1].candle_ts,
    feature_order,
    feature_means: means,
    feature_scales: scales,
    coefficients: fit.coefficients,
    intercept: fit.intercept,
    categorical_vocab: vocab,
    fit_meta: {
      iterations: fit.iterations,
      final_loss: fit.final_loss,
      converged: fit.converged,
      C: VARIANT_B_C,
    },
  } as never);

  return {
    fitted: true, model_fit_id, training_row_count: n, feature_count: d,
    final_loss: fit.final_loss, converged: fit.converged,
  };
}

/**
 * Retrain trigger: fits Variant B every N newly-resolved candles.
 * Called after production resolution ticks.
 */
export async function maybeRetrainVariantB(
  supabase: SupabaseClient,
  trainingModelVersion: string,
): Promise<TrainerResult | null> {
  // Count resolved clean rows since last fit.
  const { data: last } = await supabase
    .from("model7_training_fits")
    .select("training_row_count")
    .eq("variant", "B")
    .eq("training_model_version", trainingModelVersion)
    .order("created_at", { ascending: false })
    .limit(1).maybeSingle();
  const { count } = await supabase
    .from("predictions")
    .select("*", { count: "exact", head: true })
    .eq("model_version", trainingModelVersion)
    .in("actual_direction", ["GREEN", "RED"]);
  const cleanNow = count ?? 0;
  const lastN = last?.training_row_count ?? 0;
  const delta = cleanNow - lastN;
  const needsFirstFit = !last && cleanNow >= VARIANT_B_MIN_CLEAN_ROWS;
  const needsRefit = last && delta >= 12;
  if (!needsFirstFit && !needsRefit) return null;
  return trainVariantB(supabase, trainingModelVersion);
}
