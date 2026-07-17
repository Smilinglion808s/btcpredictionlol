// AAS96 training: pull resolved directional rows, fit dual logistic
// regressions, initialize expert histories, save artifact.

import type { SupabaseClient } from "@supabase/supabase-js";
import { extractFeatures, extractExpertInputs, featureSchemaHash, type FeatureMap } from "./featurize";
import { fitScaler, batchApply, applyScaler } from "./preprocess";
import { trainLogistic } from "./logistic";
import { AAS96_LAMBDAS, AAS96_MIN_TRAINING_ROWS, AAS96_RETRAIN_EVERY } from "./config";
import { emptyExpertHistory, updateExpertHistory, type Dir } from "./layerB";
import { saveAas96Fit } from "./fitStore";

/** Infer GREEN/RED from a predictions row's actuals. Returns null for DOJI/unknown. */
export function inferActualDir(p: Record<string, unknown>): Dir | null {
  const a = p.actual_direction ? String(p.actual_direction).toUpperCase() : null;
  if (a === "GREEN" || a === "RED") return a;
  if (a === "DOJI") return null;
  const o = p.actual_next_candle_open, c = p.actual_next_candle_close;
  if (o == null || c == null) return null;
  const dn = Number(c) - Number(o);
  if (!Number.isFinite(dn) || dn === 0) return null;
  return dn > 0 ? "GREEN" : "RED";
}

/** Fetch all resolved directional rows (live + archive), oldest first. */
async function fetchTrainingRows(sb: SupabaseClient): Promise<Record<string, unknown>[]> {
  const PAGE = 1000;
  async function fetchAll(table: string) {
    const out: Record<string, unknown>[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from(table as never)
        .select("*")
        .in("status", ["win", "loss"])
        .order("candle_ts", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      const rows = (data ?? []) as Record<string, unknown>[];
      out.push(...rows);
      if (rows.length < PAGE) break;
      if (from > 200_000) break;
    }
    return out;
  }
  const [live, arch] = await Promise.all([fetchAll("predictions"), fetchAll("predictions_archive")]);
  const seen = new Set<string>();
  const merged: Record<string, unknown>[] = [];
  for (const r of [...arch, ...live]) {
    const id = String(r.id);
    if (seen.has(id)) continue;
    seen.add(id);
    merged.push(r);
  }
  merged.sort((a, b) => String(a.candle_ts).localeCompare(String(b.candle_ts)));
  return merged;
}

/** Run a full retrain if needed. Returns fit_id when trained, null otherwise. */
export async function maybeTrainAas96(sb: SupabaseClient): Promise<string | null> {
  const { data: state } = await sb.from("model7_aas96_state").select("*").eq("id", 1).maybeSingle();
  const s = state as { resolved_directional_count?: number; usable_training_rows?: number; next_retrain_at_count?: number } | null;
  // Prefer usable-training-rows counter (spec: retrain cadence driven by
  // usable labeled feature rows, not raw market resolutions).
  const count = Number(s?.usable_training_rows ?? s?.resolved_directional_count ?? 0);
  const nextAt = Number(s?.next_retrain_at_count ?? AAS96_MIN_TRAINING_ROWS);
  if (count < AAS96_MIN_TRAINING_ROWS) return null;
  if (count < nextAt) return null;

  const rows = await fetchTrainingRows(sb);
  const training: { features: FeatureMap; y: number; raw: Record<string, unknown> }[] = [];
  for (const r of rows) {
    const dir = inferActualDir(r);
    if (!dir) continue;
    training.push({ features: extractFeatures(r), y: dir === "GREEN" ? 1 : 0, raw: r });
  }
  if (training.length < AAS96_MIN_TRAINING_ROWS) return null;

  const scaler = fitScaler(training.map((t) => t.features));
  const { names, matrix } = batchApply(scaler, training.map((t) => t.features));
  const y = training.map((t) => t.y);

  // Spec-required convergence: max 5000 iters, tol 1e-9. Solver is deterministic
  // (zero-init, no random restarts, full-batch gradient) — objective is convex so
  // this yields the unique regularized MLE up to tol.
  const fitL003 = trainLogistic(matrix, y, AAS96_LAMBDAS[0], { maxIter: 5000, tol: 1e-9 });
  const fitL010 = trainLogistic(matrix, y, AAS96_LAMBDAS[1], { maxIter: 5000, tol: 1e-9 });

  // Initialize expert history by replaying training rows in order. Fallback
  // for each row uses that row's M6 bullish/bearish score direction (spec:
  // Layer B missing-signal fallback = m6_bullish_score >= m6_bearish_score).
  const history = emptyExpertHistory();
  for (const t of training) {
    const dir = t.y === 1 ? "GREEN" : "RED";
    const inputs = extractExpertInputs(t.raw);
    const bs = Number((t.raw as Record<string, unknown>).bullish_score ?? 0);
    const br = Number((t.raw as Record<string, unknown>).bearish_score ?? 0);
    const fallback: Dir = bs >= br ? "GREEN" : "RED";
    updateExpertHistory(history, inputs, dir as Dir, fallback);
  }

  const schemaHash = featureSchemaHash(names);
  const fitId = await saveAas96Fit(sb, {
    trainingRowCount: training.length,
    featureNames: names,
    featureSchemaHash: schemaHash,
    scaler,
    fitL003,
    fitL010,
    expertHistory: history,
  });

  await sb.from("model7_aas96_state").update({
    resolved_directional_count: count,
    usable_training_rows: count,
    last_training_at: new Date().toISOString(),
    next_retrain_at_count: count + AAS96_RETRAIN_EVERY,
    updated_at: new Date().toISOString(),
  } as never).eq("id", 1);

  try {
    await sb.from("api_runs").insert({
      run_type: "aas96-retrain",
      response_payload: { fit_id: fitId, training_rows: training.length, feature_count: names.length },
      success: true,
    });
  } catch { /* ignore */ }

  return fitId;
}

// Re-export so orchestrator can use single-row apply without pulling preprocess directly.
export { applyScaler };
