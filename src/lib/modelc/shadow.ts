// Model C — Dual Horizon Net-Win Ensemble (SHADOW).
//
// Fire-and-forget from the production engine. NEVER blocks the production
// insert or resolver loop — every call is wrapped in try/catch and always
// resolves. Writes a single row into `public.model_c_shadow` per prediction:
//   1. computes global_core (221) + recent_full (678) feature maps,
//   2. scores each component via DictVectorizer + StandardScaler + LogisticRegression,
//   3. blends 50/50, evaluates the two remaining hard-NO overrides,
//   4. persists probabilities, decision, and lineage hashes.
//
// Timing: this shadow runs synchronously at prediction-emit time (before the
// target candle closes). `boundary_delta_ms` is therefore negative for now,
// indicating "scored N ms before boundary". The bounded-wait / retrain loop
// will move to the resolver pass in a follow-up.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildGlobalCoreFeatures,
  buildRecentFullFeatures,
  type CandleRow,
  type PredictionRowForFeatures,
} from "./featurize";
import { loadActiveModelCFit, verifyBootstrapFit } from "./fit";
import { decideModelC } from "./decision";
import { featureVectorHash, scoreComponent } from "./score";

const TF_MS = 15 * 60 * 1000;
const CORE_HISTORY_ROWS = 20;
const RECENT_HISTORY_ROWS = 40;

export const MODEL_C_MODEL_ID = "model_c_dual_horizon_v1";
export const MODEL_C_DECISION_POLICY_VERSION =
  "model-c-v1-global50-recent50-cutoff052-hardno3";

export interface ModelCPredictionRow extends PredictionRowForFeatures {
  model_version?: string | null;
}

async function fetchPriorCandles(
  supabase: SupabaseClient,
  targetCandleTs: string,
  limit: number,
): Promise<CandleRow[]> {
  const { data, error } = await supabase
    .from("candles")
    .select("candle_ts, open, high, low, close, volume")
    .eq("symbol", "BTC-USDT")
    .eq("timeframe", "15m")
    .lt("candle_ts", targetCandleTs)
    .order("candle_ts", { ascending: false })
    .limit(limit);
  if (error) throw error;
  return (data ?? []) as unknown as CandleRow[];
}

async function insertBlockedRow(
  supabase: SupabaseClient,
  row: ModelCPredictionRow,
  reason: string,
): Promise<void> {
  const targetMs = new Date(row.candle_ts).getTime();
  const createdMs = row.created_at ? new Date(row.created_at).getTime() : NaN;
  await supabase.from("model_c_shadow").insert({
    prediction_id: row.id,
    candle_ts: row.candle_ts,
    target_boundary_ts: new Date(targetMs).toISOString(),
    feature_cutoff_ts: new Date(targetMs - 1).toISOString(),
    prediction_row_created_at: row.created_at ?? null,
    prediction_row_lead_ms: Number.isFinite(createdMs) ? targetMs - createdMs : null,
    production_model_version: row.model_version ?? null,
    status: "blocked",
    timing_status: "blocked",
    leakage_check_passed: false,
    trade: false,
    fit_id: "blocked",
    shadow_error: reason,
  } as never);
}

export async function runModelCShadowForPrediction(
  supabase: SupabaseClient,
  predictionRow: ModelCPredictionRow,
): Promise<void> {
  const targetMs = new Date(predictionRow.candle_ts).getTime();
  const boundaryIso = new Date(targetMs).toISOString();
  const featureCutoffIso = new Date(targetMs - 1).toISOString();
  const createdIso = predictionRow.created_at ?? null;
  const createdMs = createdIso ? new Date(createdIso).getTime() : NaN;
  const predictionRowLeadMs = Number.isFinite(createdMs) ? targetMs - createdMs : null;

  try {
    // Load the active fit — live retrained fit if one exists for the current
    // production model_version, otherwise the pinned bootstrap. Bootstrap-hash
    // verification only gates when we're actually using the bootstrap.
    const modelVersion = predictionRow.model_version ?? "6";
    const active = await loadActiveModelCFit(supabase, modelVersion);
    if (active.source === "bootstrap") {
      const verification = verifyBootstrapFit();
      if (!verification.ok) {
        await insertBlockedRow(supabase, predictionRow, `fit_hash_mismatch: ${JSON.stringify(verification)}`);
        return;
      }
    }
    const fit = active.fit;

    // Pull enough prior completed candles to satisfy both builders.
    const history = await fetchPriorCandles(
      supabase,
      predictionRow.candle_ts,
      Math.max(CORE_HISTORY_ROWS, RECENT_HISTORY_ROWS),
    );

    // Leakage guard: any history candle at/after target_boundary is a bug.
    for (const h of history) {
      if (new Date(h.candle_ts).getTime() >= targetMs) {
        await insertBlockedRow(supabase, predictionRow, `leakage_history_ts_${h.candle_ts}`);
        return;
      }
    }
    const latestSourceCandleTs = history[0]?.candle_ts ?? null;

    const globalFeatures = buildGlobalCoreFeatures({ row: predictionRow, history });
    const recentFeatures = buildRecentFullFeatures({ row: predictionRow, history });

    const pGlobal = scoreComponent(fit.global_core_lr, globalFeatures);
    const pRecent = scoreComponent(fit.recent_full_lr, recentFeatures);

    const decision = decideModelC({
      p_global: pGlobal.probability_green,
      p_recent: pRecent.probability_green,
      market_condition: predictionRow.market_condition ?? null,
      failed_breakout_down:
        (predictionRow.indicators as Record<string, unknown> | undefined)?.failed_breakout_down as
          | string
          | boolean
          | null
          | undefined ?? null,
      upstream_prediction: predictionRow.prediction ?? null,
    });

    const scoredAtMs = Date.now();
    const boundaryDeltaMs = scoredAtMs - targetMs;

    await supabase.from("model_c_shadow").insert({
      prediction_id: predictionRow.id,
      candle_ts: predictionRow.candle_ts,
      target_boundary_ts: boundaryIso,
      scored_at: new Date(scoredAtMs).toISOString(),
      boundary_delta_ms: boundaryDeltaMs,
      prediction_row_created_at: createdIso,
      prediction_row_lead_ms: predictionRowLeadMs,
      feature_cutoff_ts: featureCutoffIso,
      latest_source_candle_ts: latestSourceCandleTs,
      leakage_check_passed: true,
      timing_status: boundaryDeltaMs >= 0 ? "scored_after_boundary" : "scored_before_boundary",
      global_probability_green: pGlobal.probability_green,
      recent_probability_green: pRecent.probability_green,
      ensemble_probability_green: decision.p_ensemble,
      base_decision: decision.base_decision,
      override_reasons_json: decision.override_reasons_json,
      final_decision: decision.final_decision,
      trade: decision.trade,
      global_artifact_sha256: fit.global_core_lr.artifact_sha256,
      recent_artifact_sha256: fit.recent_full_lr.artifact_sha256,
      global_feature_vector_sha256: featureVectorHash(fit.global_core_lr, globalFeatures),
      recent_feature_vector_sha256: featureVectorHash(fit.recent_full_lr, recentFeatures),
      status: "scored",
      fit_id: active.source === "live"
        ? active.fit_id
        : `bootstrap:${fit.combined_fit_sha256.slice(0, 12)}`,
      production_model_version: predictionRow.model_version ?? null,
      shadow_error: null,
    } as never);
    void TF_MS;
  } catch (e) {
    try {
      await supabase.from("api_runs").insert({
        run_type: "model_c_shadow_error",
        response_payload: {
          error: e instanceof Error ? e.message : String(e),
          prediction_id: predictionRow.id,
        },
        success: false,
        error_message: e instanceof Error ? e.message : String(e),
      });
    } catch {
      /* ignore */
    }
    try {
      await insertBlockedRow(supabase, predictionRow, e instanceof Error ? e.message : String(e));
    } catch {
      /* ignore */
    }
  }
}

/**
 * Resolve Model C shadow rows for a prediction once actual_direction is known.
 * Also fills `won` per decision so audits can compute win rates directly.
 */
export async function resolveModelCShadowRowsFor(
  supabase: SupabaseClient,
  predictionId: string,
  actualDirection: "GREEN" | "RED" | "DOJI" | null,
): Promise<void> {
  if (!actualDirection || (actualDirection !== "GREEN" && actualDirection !== "RED")) return;
  try {
    const { data: rows } = await supabase
      .from("model_c_shadow")
      .select("id, final_decision, trade")
      .eq("prediction_id", predictionId)
      .is("actual_direction", null);
    if (!rows || rows.length === 0) return;
    const nowIso = new Date().toISOString();
    for (const r of rows as Array<{ id: string; final_decision: string | null; trade: boolean | null }>) {
      let won: boolean | null = null;
      let status = "skip";
      if (r.trade && r.final_decision) {
        won = (r.final_decision === "YES" && actualDirection === "GREEN") ||
          (r.final_decision === "NO" && actualDirection === "RED");
        status = won ? "win" : "loss";
      }
      await supabase
        .from("model_c_shadow")
        .update({ actual_direction: actualDirection, won, resolved_at: nowIso, status } as never)
        .eq("id", r.id);
    }

    // Retrain trigger — fires only when delta since last live fit crosses the
    // cadence threshold. Fail-closed inside `maybeRetrainModelC`, never blocks.
    try {
      const { maybeRetrainModelC } = await import("./trainer");
      // Read active production model version so retraining tracks whatever the
      // resolved predictions were emitted under.
      const { data: settings } = await supabase
        .from("model_settings")
        .select("model_version")
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const modelVersion = (settings as { model_version?: string } | null)?.model_version ?? "6";
      await maybeRetrainModelC(supabase, modelVersion);
    } catch {
      /* never block resolver on retraining */
    }
  } catch {
    /* never block resolver */
  }
}
