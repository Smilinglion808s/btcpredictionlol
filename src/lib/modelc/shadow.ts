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
import { computePrcDecision, rawCounterfactualResult, PRC_MODEL_VERSION } from "./prc";

const TF_MS = 15 * 60 * 1000;
const CORE_HISTORY_ROWS = 20;
const RECENT_HISTORY_ROWS = 40;

export const MODEL_C_MODEL_ID = "model_c_dual_horizon_v1";
export const MODEL_C_DECISION_POLICY_VERSION =
  "model-c-v1-global50-recent50-cutoff052-hardno3";
export const MODEL_C_PROSPECTIVE_TEST_ID = "MODEL_C_100_CANDLE_BINARY_FIX_V1";
export const MODEL_C_BLEND_WEIGHT_GLOBAL = 0.5;
export const MODEL_C_BLEND_WEIGHT_RECENT = 0.5;
export const MODEL_C_ENSEMBLE_THRESHOLD = 0.52;
export const MODEL_C_ENSEMBLE_EPSILON = 1e-9;

/**
 * Guard rails around the ensemble math. Returns null when inputs pass,
 * otherwise a fail-closed skip reason string.
 */
export function validateEnsemble(
  pGlobal: number,
  pRecent: number,
  pEnsemble: number,
): string | null {
  const inRange = (x: number) => typeof x === "number" && Number.isFinite(x) && x >= 0 && x <= 1;
  if (!inRange(pGlobal) || !inRange(pRecent) || !inRange(pEnsemble)) {
    return "INVALID_PROBABILITY";
  }
  const expected =
    MODEL_C_BLEND_WEIGHT_GLOBAL * pGlobal + MODEL_C_BLEND_WEIGHT_RECENT * pRecent;
  if (Math.abs(pEnsemble - expected) > MODEL_C_ENSEMBLE_EPSILON) {
    return "ENSEMBLE_ARITHMETIC_MISMATCH";
  }
  return null;
}

export function predictedDirectionFor(
  finalDecision: "YES" | "NO" | null | undefined,
): "GREEN" | "RED" | null {
  if (finalDecision === "YES") return "GREEN";
  if (finalDecision === "NO") return "RED";
  return null;
}


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
  variant = "dual_horizon",
): Promise<void> {
  const targetMs = new Date(row.candle_ts).getTime();
  const createdMs = row.created_at ? new Date(row.created_at).getTime() : NaN;
  await supabase.from("model_c_shadow").insert({
    prediction_id: row.id,
    variant,
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
    predicted_direction: null,
    skip_reason: reason,
    override_applied: false,
    override_reason: null,
    blend_weight_global: MODEL_C_BLEND_WEIGHT_GLOBAL,
    blend_weight_recent: MODEL_C_BLEND_WEIGHT_RECENT,
    ensemble_threshold: MODEL_C_ENSEMBLE_THRESHOLD,
    prospective_test_id: MODEL_C_PROSPECTIVE_TEST_ID,
    fit_id: "blocked",
    shadow_error: reason,
  } as never);
}


async function insertGlobalOnlyRow(
  supabase: SupabaseClient,
  args: {
    predictionRow: ModelCPredictionRow;
    fit: Awaited<ReturnType<typeof loadActiveModelCFit>>["fit"];
    active: Awaited<ReturnType<typeof loadActiveModelCFit>>;
    globalScore: ReturnType<typeof scoreComponent>;
    globalFeatures: ReturnType<typeof buildGlobalCoreFeatures>;
    boundaryIso: string;
    featureCutoffIso: string;
    latestSourceCandleTs: string | null;
    createdIso: string | null;
    predictionRowLeadMs: number | null;
  },
): Promise<void> {
  const scoredAtMs = Date.now();
  const targetMs = new Date(args.predictionRow.candle_ts).getTime();
  const pGlobal = args.globalScore.probability_green;
  // Global-only uses global as the "ensemble" input. Cutoff & override logic
  // are shared so results are directly comparable with dual_horizon.
  const decision = decideModelC({
    p_global: pGlobal,
    p_recent: pGlobal,
    market_condition: args.predictionRow.market_condition ?? null,
    failed_breakout_down:
      (args.predictionRow.indicators as Record<string, unknown> | undefined)?.failed_breakout_down as
        | string
        | boolean
        | null
        | undefined ?? null,
    upstream_prediction: args.predictionRow.prediction ?? null,
  });

  const skipReason = validateEnsemble(pGlobal, pGlobal, pGlobal);
  const finalDecision = skipReason ? null : decision.final_decision;
  const trade = skipReason ? false : true;
  const status = skipReason ? "blocked" : "scored";
  const overrideApplied = decision.override_reasons_json.some((o) => o.applied);
  const overrideReason = decision.override_reasons_json.find((o) => o.applied)?.id ?? null;
  const ensembleDelta = 0;

  // PRC-36/4 controller — reports alongside base decision. Never modifies
  // trained models, features, weights, or the 0.52 cutoff.
  const prc = await computePrcDecision(supabase, {
    variant: "global_only",
    ensemble_probability_green: pGlobal,
    target_boundary_ts: args.boundaryIso,
  });

  await supabase.from("model_c_shadow").insert({
    prediction_id: args.predictionRow.id,
    variant: "global_only",
    candle_ts: args.predictionRow.candle_ts,
    target_boundary_ts: args.boundaryIso,
    scored_at: new Date(scoredAtMs).toISOString(),
    boundary_delta_ms: scoredAtMs - targetMs,
    prediction_row_created_at: args.createdIso,
    prediction_row_lead_ms: args.predictionRowLeadMs,
    feature_cutoff_ts: args.featureCutoffIso,
    latest_source_candle_ts: args.latestSourceCandleTs,
    leakage_check_passed: true,
    timing_status: scoredAtMs >= targetMs ? "scored_after_boundary" : "scored_before_boundary",
    global_probability_green: pGlobal,
    recent_probability_green: null,
    ensemble_probability_green: pGlobal,
    blend_weight_global: 1,
    blend_weight_recent: 0,
    ensemble_threshold: MODEL_C_ENSEMBLE_THRESHOLD,
    ensemble_delta: ensembleDelta,
    base_decision: decision.base_decision,
    override_reasons_json: decision.override_reasons_json,
    override_applied: overrideApplied,
    override_reason: overrideReason,
    final_decision: finalDecision,
    predicted_direction: predictedDirectionFor(finalDecision as "YES" | "NO" | null),
    trade,
    skip_reason: skipReason,
    prospective_test_id: MODEL_C_PROSPECTIVE_TEST_ID,
    global_artifact_sha256: args.fit.global_core_lr.artifact_sha256,
    recent_artifact_sha256: null,
    global_feature_vector_sha256: featureVectorHash(args.fit.global_core_lr, args.globalFeatures),
    recent_feature_vector_sha256: null,
    status,
    fit_id: args.active.source === "live"
      ? args.active.fit_id
      : `bootstrap:${args.fit.combined_fit_sha256.slice(0, 12)}`,
    production_model_version: args.predictionRow.model_version ?? null,
    shadow_error: skipReason,
    raw_direction: prc.raw_direction,
    rolling_window_size: prc.rolling_window_size,
    rolling_raw_wins: prc.rolling_raw_wins,
    rolling_raw_losses: prc.rolling_raw_losses,
    rolling_raw_edge: prc.rolling_raw_edge,
    polarity_state: prc.polarity_state,
    controller_decision: prc.controller_decision,
    controller_skip_reason: prc.controller_skip_reason,
    history_cutoff_ts: prc.history_cutoff_ts,
    latest_resolution_ts_used: prc.latest_resolution_ts_used,
    timing_guard_passed: prc.timing_guard_passed,
    controller_error: prc.controller_error,
    controller_model_version: prc.controller_model_version,
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
    // Load the active fit — latest READY live fit if one exists for the current
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
    // Fit activation boundary: a live fit MUST NOT score a target candle
    // whose boundary is at/before its training cutoff. Enforce
    // target_boundary_ts >= first_eligible_target_ts.
    if (active.source === "live" && active.first_eligible_target_ts) {
      const firstEligibleMs = new Date(active.first_eligible_target_ts).getTime();
      if (targetMs < firstEligibleMs) {
        await insertBlockedRow(
          supabase,
          predictionRow,
          `fit_not_eligible_for_target:${active.fit_id}:first_eligible=${active.first_eligible_target_ts}`,
        );
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

    const skipReason = validateEnsemble(
      pGlobal.probability_green,
      pRecent.probability_green,
      decision.p_ensemble,
    );
    const expectedEnsemble =
      MODEL_C_BLEND_WEIGHT_GLOBAL * pGlobal.probability_green +
      MODEL_C_BLEND_WEIGHT_RECENT * pRecent.probability_green;
    const ensembleDelta = decision.p_ensemble - expectedEnsemble;
    const finalDecision = skipReason ? null : decision.final_decision;
    const trade = skipReason ? false : true;
    const status = skipReason ? "blocked" : "scored";
    const overrideApplied = decision.override_reasons_json.some((o) => o.applied);
    const overrideReason =
      decision.override_reasons_json.find((o) => o.applied)?.id ?? null;

    // PRC-36/4 controller for dual_horizon variant.
    const prc = await computePrcDecision(supabase, {
      variant: "dual_horizon",
      ensemble_probability_green: decision.p_ensemble,
      target_boundary_ts: boundaryIso,
    });

    await supabase.from("model_c_shadow").insert({
      prediction_id: predictionRow.id,
      variant: "dual_horizon",
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
      blend_weight_global: MODEL_C_BLEND_WEIGHT_GLOBAL,
      blend_weight_recent: MODEL_C_BLEND_WEIGHT_RECENT,
      ensemble_threshold: MODEL_C_ENSEMBLE_THRESHOLD,
      ensemble_delta: ensembleDelta,
      base_decision: decision.base_decision,
      override_reasons_json: decision.override_reasons_json,
      override_applied: overrideApplied,
      override_reason: overrideReason,
      final_decision: finalDecision,
      predicted_direction: predictedDirectionFor(finalDecision as "YES" | "NO" | null),
      trade,
      skip_reason: skipReason,
      prospective_test_id: MODEL_C_PROSPECTIVE_TEST_ID,
      global_artifact_sha256: fit.global_core_lr.artifact_sha256,
      recent_artifact_sha256: fit.recent_full_lr.artifact_sha256,
      global_feature_vector_sha256: featureVectorHash(fit.global_core_lr, globalFeatures),
      recent_feature_vector_sha256: featureVectorHash(fit.recent_full_lr, recentFeatures),
      status,
      fit_id: active.source === "live"
        ? active.fit_id
        : `bootstrap:${fit.combined_fit_sha256.slice(0, 12)}`,
      production_model_version: predictionRow.model_version ?? null,
      shadow_error: skipReason,
      raw_direction: prc.raw_direction,
      rolling_window_size: prc.rolling_window_size,
      rolling_raw_wins: prc.rolling_raw_wins,
      rolling_raw_losses: prc.rolling_raw_losses,
      rolling_raw_edge: prc.rolling_raw_edge,
      polarity_state: prc.polarity_state,
      controller_decision: prc.controller_decision,
      controller_skip_reason: prc.controller_skip_reason,
      history_cutoff_ts: prc.history_cutoff_ts,
      latest_resolution_ts_used: prc.latest_resolution_ts_used,
      timing_guard_passed: prc.timing_guard_passed,
      controller_error: prc.controller_error,
      controller_model_version: prc.controller_model_version,
    } as never);

    try {
      await insertGlobalOnlyRow(supabase, {
        predictionRow,
        fit,
        active,
        globalScore: pGlobal,
        globalFeatures,
        boundaryIso,
        featureCutoffIso,
        latestSourceCandleTs,
        createdIso,
        predictionRowLeadMs,
      });
    } catch (e) {
      try {
        await supabase.from("api_runs").insert({
          run_type: "model_c_global_only_shadow_error",
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
    }
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
      .select("id, final_decision, trade, production_model_version")
      .eq("prediction_id", predictionId)
      .is("actual_direction", null);
    if (!rows || rows.length === 0) return;
    const nowIso = new Date().toISOString();
    let resolvedModelVersion: string | null = null;
    for (const r of rows as Array<{ id: string; final_decision: string | null; trade: boolean | null; production_model_version: string | null }>) {
      let won: boolean | null = null;
      let status = "skip";
      if (r.trade && r.final_decision) {
        won = (r.final_decision === "YES" && actualDirection === "GREEN") ||
          (r.final_decision === "NO" && actualDirection === "RED");
        status = won ? "win" : "loss";
      }
      if (!resolvedModelVersion && r.production_model_version) {
        resolvedModelVersion = r.production_model_version;
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
      // Derive training model version from the prediction we just resolved
      // (NOT from `model_settings`, which stores unrelated legacy labels
      // like "Model 1.9" and made the trainer filter to 0 rows every cycle).
      let modelVersion = resolvedModelVersion;
      if (!modelVersion) {
        const { data: pred } = await supabase
          .from("predictions")
          .select("model_version")
          .eq("id", predictionId)
          .maybeSingle();
        modelVersion = (pred as { model_version?: string | null } | null)?.model_version ?? null;
      }
      if (modelVersion) {
        await maybeRetrainModelC(supabase, modelVersion);
      }
    } catch {
      /* never block resolver on retraining */
    }
  } catch {
    /* never block resolver */
  }
}
