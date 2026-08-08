// V6 orchestrator — prediction lifecycle for the frozen V6 model.
//
// Contract:
//   * One row per BTC-USDT 15m target candle. Runs that land within
//     V6_LATE_GRACE_S after the target opens still publish their real prediction.
//   * Input is the confirmed OKX candle at T-15m. Target-candle data is never read
//     at prediction time.
//   * Continuity/feature failures, and runs past the grace window, publish OP_FAIL
//     (never ABSTAIN) and clear the GREEN-saturation rolling history.

//   * Resolution is idempotent and reads canonical OKX OHLC only.

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTechnicalRows, type RawCandle } from "./technical";
import {
  inferV6,
  V6_MODEL,
  V6_RED_THRESHOLD,
  V6_GREEN_THRESHOLD,
  abstentionContribution,
  adjustedScore,
  pickupContribution,
  rawScore,
  type Actual,
  type Direction,
  type TechnicalRow,
} from "./inference";
import {
  V6_ARTIFACT_SHA256,
  V6_CANDLE_STREAM,
  V6_FEATURE_SCHEMA_VERSION,
  V6_FIT_ID,
  V6_LATE_GRACE_S,
  V6_MIN_HISTORY_CANDLES,
  V6_MODEL_VERSION,
  V6_WARMUP_CANDLES,
} from "./config";
import {
  applyRegimeInverter,
  inverterContribution,
  V6_REGIME_INVERTER_THRESHOLD,

} from "./regimeInverter";
import { ensureInverterState, recordResolvedShadowSignal } from "./regimeInverterStore";
import {
  applyBroadConflictVeto,
  applyBroadRedReliabilityVeto,
  vetoContribution,
  BROAD_CONFLICT_MAX_DISTANCE,
  BROAD_CONFLICT_MIN_DISTANCE,
  BROAD_CONFLICT_VETO_REASON,
  BROAD_RED_RELIABILITY_REASON,
  BROAD_RED_RELIABILITY_THRESHOLD,
  REGIME_INVERTER_PUBLICATION_ENABLED,
  REGIME_INVERTER_SHADOW_ONLY,
} from "./r3";
import { ensureBroadRedState, recordResolvedBroadRedSignal } from "./broadRedStore";
import {
  applyStructureConfirmation,
  structureContribution,
  STRUCTURE_EXPANSION_EFFICIENCY_MIN,
  STRUCTURE_EXPANSION_RANGE_MIN,
  STRUCTURE_REJECTION_ALIGNED_WICK_MIN,
  STRUCTURE_REJECTION_LOWER_WICK_MIN,
  V6_R4_ACTIVATED_AT,
  V6_R4_MODEL_REVISION,
} from "./structure";


const TF_MS = 15 * 60 * 1000;

/**
 * Timing posture for a run against its target candle open. A run that lands
 * within the grace window is accepted (like a96 / TD1-RC) and publishes its
 * real prediction; strict truth flags still report it as late.
 */
function timingPosture(targetTs: Date) {
  const latenessS = (Date.now() - targetTs.getTime()) / 1000;
  return {
    latenessS,
    createdBefore: latenessS < 0,
    accepted: latenessS < V6_LATE_GRACE_S,
  };
}


async function logError(sb: SupabaseClient, runType: string, payload: Record<string, unknown>, err: unknown) {
  try {
    await sb.from("api_runs").insert({
      run_type: runType,
      response_payload: { ...payload, error: err instanceof Error ? err.message : String(err) },
      success: false,
      error_message: err instanceof Error ? err.message : String(err),
    });
  } catch { /* ignore */ }
}

interface HistoryRow extends RawCandle {
  id: string;
}

/** Confirmed canonical candles ending exactly at T-15m, contiguous tail only. */
async function loadHistory(
  sb: SupabaseClient,
  targetTs: Date,
): Promise<{ rows: HistoryRow[]; contiguous: boolean; error: string | null }> {
  const lastTs = new Date(targetTs.getTime() - TF_MS);
  const firstTs = new Date(lastTs.getTime() - V6_WARMUP_CANDLES * TF_MS);
  // NOTE: the `confirm` flag can lag several seconds behind the boundary run.
  // A candle whose full 15m window has elapsed is closed by definition, so
  // elapsed-time is the authoritative confirmation here (same rule as warmup).
  const { data, error } = await sb
    .from("candles")
    .select("id, candle_ts, open, high, low, close, volume")
    .eq("symbol", V6_CANDLE_STREAM.symbol)
    .eq("timeframe", V6_CANDLE_STREAM.timeframe)
    .eq("fetch_source", V6_CANDLE_STREAM.provider)
    .gte("candle_ts", firstTs.toISOString())
    .lte("candle_ts", lastTs.toISOString())
    .order("candle_ts", { ascending: true });
  if (error) return { rows: [], contiguous: false, error: `candle_query_failed:${error.message}` };

  const seen = new Set<string>();
  const all: HistoryRow[] = [];
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const iso = new Date(String(r.candle_ts)).toISOString();
    if (seen.has(iso)) continue;
    // Only fully-elapsed (closed) candles may enter the feature window.
    if (new Date(iso).getTime() + TF_MS > Date.now()) continue;
    seen.add(iso);
    const open = Number(r.open), high = Number(r.high), low = Number(r.low), close = Number(r.close);
    if (![open, high, low, close].every((n) => Number.isFinite(n) && n > 0)) continue;
    all.push({
      id: String(r.id),
      candle_ts: iso,
      open, high, low, close,
      volume: Number(r.volume ?? 0),
    });
  }

  // Ingest can lag the boundary run; top the tail up straight from OKX so the
  // window always ends exactly at T-15m (closed candles only).
  if (all.length > 0 && all[all.length - 1].candle_ts !== lastTs.toISOString()) {
    try {
      const { fetchOkxConfirmedRange } = await import("../okx.server");
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const lastMs = new Date(all[all.length - 1].candle_ts).getTime();
        if (lastMs >= lastTs.getTime()) break;
        if (attempt > 0) await new Promise((r) => setTimeout(r, 2000));
        const missing = await fetchOkxConfirmedRange(lastMs + TF_MS, lastTs.getTime());
        let expect = lastMs + TF_MS;
        for (const c of missing) {
          const ms = new Date(c.candle_ts).getTime();
          if (ms !== expect) break;
          all.push({ id: `okx:${c.candle_ts}`, ...c });
          expect += TF_MS;
        }
      }
    } catch { /* fall through to the missing-input error below */ }
  }

  if (all.length === 0 || all[all.length - 1].candle_ts !== lastTs.toISOString()) {
    return { rows: [], contiguous: false, error: `missing_input_candle:${lastTs.toISOString()}` };
  }


  // Longest contiguous tail ending at T-15m.
  let start = all.length - 1;
  while (
    start > 0 &&
    new Date(all[start].candle_ts).getTime() - new Date(all[start - 1].candle_ts).getTime() === TF_MS
  ) start -= 1;
  const tail = all.slice(start);
  const contiguous = tail.length === all.length;
  if (tail.length < V6_MIN_HISTORY_CANDLES) {
    return { rows: tail, contiguous: false, error: `insufficient_contiguous_history:${tail.length}/${V6_MIN_HISTORY_CANDLES}` };
  }
  return { rows: tail, contiguous, error: null };
}

/**
 * Seven prior eligible BASE predictions, newest last. History is cleared by a
 * continuity break: any OP_FAIL row, or a missing boundary, truncates the window.
 */
async function loadPriorBaseState(sb: SupabaseClient, targetTs: Date): Promise<Direction[]> {
  const { data } = await sb
    .from("v6_predictions")
    .select("target_candle_ts, operational_status, base_v6_prediction")
    .eq("model_version", V6_MODEL_VERSION)
    .lt("target_candle_ts", targetTs.toISOString())
    .order("target_candle_ts", { ascending: false })
    .limit(12);
  const rows = (data ?? []) as Array<{ target_candle_ts: string; operational_status: string; base_v6_prediction: string | null }>;
  const out: Direction[] = [];
  let expected = targetTs.getTime() - TF_MS;
  for (const r of rows) {
    if (new Date(r.target_candle_ts).getTime() !== expected) break; // boundary gap clears history
    if (r.operational_status !== "OK" || !r.base_v6_prediction) break; // OP_FAIL clears history
    out.push(r.base_v6_prediction as Direction);
    expected -= TF_MS;
    if (out.length === 7) break;
  }
  return out.reverse();
}

function opFailRow(targetTs: Date, reason: string, extra: Record<string, unknown> = {}) {
  const t = timingPosture(targetTs);
  return {
    target_candle_ts: targetTs.toISOString(),
    prediction_created_at: new Date().toISOString(),
    input_candle_ts: new Date(targetTs.getTime() - TF_MS).toISOString(),
    input_cutoff_ts: targetTs.toISOString(),
    prediction_created_before_target: t.createdBefore,
    timing_valid: t.createdBefore,

    symbol: V6_CANDLE_STREAM.symbol,
    timeframe: V6_CANDLE_STREAM.timeframe,
    provider: V6_CANDLE_STREAM.provider,
    model_version: V6_MODEL_VERSION,
    fit_id: V6_FIT_ID,
    model_artifact_sha256: V6_ARTIFACT_SHA256,
    feature_schema_version: V6_FEATURE_SCHEMA_VERSION,
    operational_status: "OP_FAIL",
    operational_error: reason,
    continuity_valid: false,
    feature_valid: false,
    final_prediction: "OP_FAIL",
    final_prediction_source: "OP_FAIL",
    model_revision: V6_R4_MODEL_REVISION,
    model_revision_activated_at: V6_R4_ACTIVATED_AT,
    regime_inverter_evaluable: false,
    regime_inverter_triggered: false,
    regime_inverter_activation_threshold: V6_REGIME_INVERTER_THRESHOLD,
    abstain_status: null,
    red_threshold: V6_RED_THRESHOLD,
    green_threshold: V6_GREEN_THRESHOLD,
    // V6-r4: the structure gate never evaluates an operational failure.
    structure_confirmation_evaluable: false,
    structure_confirmation_triggered: false,
    structure_confirmation_pass: false,
    structure_rejection_lower_wick_threshold: STRUCTURE_REJECTION_LOWER_WICK_MIN,
    structure_rejection_aligned_wick_threshold: STRUCTURE_REJECTION_ALIGNED_WICK_MIN,
    structure_expansion_range_threshold: STRUCTURE_EXPANSION_RANGE_MIN,
    structure_expansion_efficiency_threshold: STRUCTURE_EXPANSION_EFFICIENCY_MIN,
    ...extra,
  };
}

/**
 * Produce and persist the V6 prediction for `targetTs` (the candle that has not
 * opened yet). Idempotent per target candle.
 */
export async function runV6(sb: SupabaseClient, targetTs: Date): Promise<void> {
  try {
    const targetIso = targetTs.toISOString();
    const { data: existing } = await sb
      .from("v6_predictions")
      .select("prediction_id")
      .eq("model_version", V6_MODEL_VERSION)
      .eq("target_candle_ts", targetIso)
      .maybeSingle();
    if (existing) return;

    // Warmup gate: no directional publication until historical technical state
    // and the 7 prior BASE decisions are rebuilt and verified.
    const { ensureV6Warm, markV6NotReady } = await import("./warmup");
    const warm = await ensureV6Warm(sb, targetTs);
    if (!warm.ready) {
      await sb
        .from("v6_predictions")
        .insert(opFailRow(targetTs, `${warm.failureReason ?? "V6_WARMUP_NOT_READY"}:${warm.error ?? ""}`) as never);
      return;
    }

    const history = await loadHistory(sb, targetTs);
    if (history.error) {
      await markV6NotReady(sb, history.error);
      await sb
        .from("v6_predictions")
        .insert(opFailRow(targetTs, `V6_WARMUP_HISTORY_MISSING:${history.error}`) as never);
      return;
    }
    if (!history.contiguous) {
      // Continuity break — saturation history may not cross it.
      await markV6NotReady(sb, "continuity_break_detected");
    }

    let technical: TechnicalRow[];
    try {
      technical = buildTechnicalRows(history.rows) as unknown as TechnicalRow[];
    } catch (e) {
      const reason = `feature_build_failed:${e instanceof Error ? e.message : String(e)}`;
      await markV6NotReady(sb, reason);
      await sb
        .from("v6_predictions")
        .insert(opFailRow(targetTs, `V6_WARMUP_FEATURE_FAILURE:${reason}`) as never);
      return;
    }

    const n = technical.length;
    const current = technical[n - 1];
    const previous1 = technical[n - 2];
    const previous4 = technical[n - 5];
    const input = history.rows[history.rows.length - 1];

    if (!current || !previous1 || !previous4) {
      await markV6NotReady(sb, "missing_lag_rows");
      await sb
        .from("v6_predictions")
        .insert(opFailRow(targetTs, "V6_WARMUP_FEATURE_FAILURE:missing_lag_rows") as never);
      return;
    }

    // Live rows are authoritative when a complete window exists; otherwise the
    // warmup replay supplies the seven prior BASE decisions.
    const livePrior = await loadPriorBaseState(sb, targetTs);
    const priorBasePredictions = livePrior.length === 7 ? livePrior : warm.priorBasePredictions;
    const inf = inferV6(current, previous1, previous4, { priorBasePredictions });

    // --- V6-r3 steps 14-18 -------------------------------------------------
    // 14/15. Broad mild-anchor-conflict veto.
    const conflict = applyBroadConflictVeto(
      inf.predictionAfterWeakRedRecovery,
      inf.predictionSourceAfterWeakRedRecovery,
      inf.selectedComponent,
      inf.anchorPercentile,
    );
    // 16/17/18. BROAD_RED reliability governor. The unresolved target never
    // enters the shadow history before publication.
    const broadRedState = await ensureBroadRedState(sb, targetTs);
    const reliability = applyBroadRedReliabilityVeto(
      conflict.prediction,
      conflict.predictionSource,
      inf.selectedComponent,
      broadRedState.summary,
    );
    const r3Prediction = reliability.prediction;
    const r3Source = reliability.predictionSource;

    // --- V6-r4 steps 13-17: Structure Confirmation Gate --------------------
    // Applies to EVERY surviving directional r3 publication regardless of the
    // source. It may only convert a direction to ABSTAIN.
    const structure = applyStructureConfirmation(r3Prediction, r3Source, {
      lower_wick_pct: inf.ridgeFeatures.lower_wick_pct,
      aligned_wick_pressure_4: inf.ridgeFeatures.aligned_wick_pressure_4,
      range_expansion_vs_avg20: inf.ridgeFeatures.range_expansion_vs_avg20,
      path_efficiency_4: inf.ridgeFeatures.path_efficiency_4,
    });
    const r4Prediction = structure.prediction;
    const r4Source = structure.predictionSource;

    // 18. Regime Inverter — SHADOW ONLY. It reads the published r4 decision but
    // can never modify it.
    const inverterState = await ensureInverterState(sb, targetTs);
    const inverter = applyRegimeInverter(r4Prediction, r4Source, inverterState.summary);

    const r3AbstainReason = conflict.triggered
      ? BROAD_CONFLICT_VETO_REASON
      : reliability.triggered
        ? BROAD_RED_RELIABILITY_REASON
        : inf.abstainReason;
    const r4AbstainReason = structure.triggered
      ? structure.reason
      : r3AbstainReason;


    const timing = timingPosture(targetTs);
    const createdBefore = timing.createdBefore;
    const accepted = timing.accepted;
    const latenessNote =
      createdBefore ? null : `late_publish:${Math.round(timing.latenessS)}s`;
    const priorIds = history.rows.slice(-5).map((r) => ({ candle_ts: r.candle_ts, id: r.id }));

    const row = {
      target_candle_ts: targetIso,
      prediction_created_at: new Date().toISOString(),
      input_candle_ts: input.candle_ts,
      input_cutoff_ts: targetIso,
      prediction_created_before_target: createdBefore,
      timing_valid: createdBefore,
      symbol: V6_CANDLE_STREAM.symbol,
      timeframe: V6_CANDLE_STREAM.timeframe,
      provider: V6_CANDLE_STREAM.provider,
      model_version: V6_MODEL_VERSION,
      fit_id: V6_FIT_ID,
      model_artifact_sha256: V6_ARTIFACT_SHA256,
      feature_schema_version: V6_FEATURE_SCHEMA_VERSION,
      operational_status: accepted ? "OK" : "OP_FAIL",
      operational_error: accepted ? latenessNote : "prediction_after_target_open",

      continuity_valid: history.contiguous,
      feature_valid: true,
      imputed_feature_count: inf.imputedFeatures.length,
      imputed_features_json: inf.imputedFeatures,
      prior_candle_ids_json: priorIds,
      input_open: input.open,
      input_high: input.high,
      input_low: input.low,
      input_close: input.close,
      input_volume: input.volume,
      ridge_features_json: inf.ridgeFeatures,
      gb_features_json: inf.gbFeatures,
      aligned_wick_pressure_4: inf.ridgeFeatures.aligned_wick_pressure_4 ?? null,
      lower_wick_pct: inf.ridgeFeatures.lower_wick_pct ?? null,
      roc_4: inf.ridgeFeatures.roc_4 ?? null,
      range_expansion_vs_avg20: inf.ridgeFeatures.range_expansion_vs_avg20 ?? null,
      rsi14: inf.ridgeFeatures.rsi14 ?? null,
      cum_vol_delta_to_avg: inf.ridgeFeatures.cum_vol_delta_to_avg ?? null,
      ema21_50_pct: inf.ridgeFeatures.ema21_50_pct ?? null,
      dist_to_high20_pct: inf.ridgeFeatures.dist_to_high20_pct ?? null,
      ridge_p_green: inf.ridgePGreen,
      ridge_percentile: inf.ridgePercentile,
      gb_p_green: inf.gbPGreen,
      gb_percentile: inf.gbPercentile,
      broad_score: inf.broadScore,
      broad_percentile: inf.broadPercentile,
      anchor_score: inf.anchorScore,
      anchor_percentile: inf.anchorPercentile,
      final_score: inf.finalScore,
      red_threshold: V6_RED_THRESHOLD,
      green_threshold: V6_GREEN_THRESHOLD,
      base_v6_prediction: inf.basePrediction,
      base_predictions_last8_json: inf.basePredictionsLast8,
      base_green_count_last8: inf.baseGreenCountLast8,
      saturation_veto_evaluable: inf.saturationVetoEvaluable,
      saturation_veto_triggered: inf.saturationVetoTriggered,
      red_pickup_evaluable: inf.redPickupEvaluable,
      red_pickup_triggered: inf.redPickupTriggered,
      green_pickup_evaluable: inf.greenPickupEvaluable,
      green_pickup_triggered: inf.greenPickupTriggered,
      pickup_conflict: inf.pickupConflict,
      pre_weak_red_veto_prediction: inf.preWeakRedVetoPrediction,
      prediction_source: inf.predictionSource,
      weak_broad_red_veto_evaluable: inf.weakBroadRedVetoEvaluable,
      weak_broad_red_veto_triggered: inf.weakBroadRedVetoTriggered,

      // --- V6-r2 weak-RED coverage recovery (prediction-time, immutable) ---
      model_revision_activated_at: V6_R4_ACTIVATED_AT,
      weak_red_veto_candidate: inf.weakRedVetoCandidate,
      weak_red_veto_original_prediction: inf.weakRedVetoOriginalPrediction,
      weak_red_veto_broad_percentile: inf.weakRedVetoBroadPercentile,
      weak_red_recovery_evaluable: inf.weakRedRecoveryEvaluable,
      weak_red_recovery_triggered: inf.weakRedRecoveryTriggered,
      weak_red_recovery_reason: inf.weakRedRecoveryReason,
      weak_red_rsi_recovery_evaluable: inf.weakRedRsiRecoveryEvaluable,
      weak_red_rsi_recovery_triggered: inf.weakRedRsiRecoveryTriggered,
      weak_red_rsi_threshold: inf.weakRedRsiThreshold,
      weak_red_rsi_value: inf.weakRedRsiValue,
      weak_red_roc4_recovery_evaluable: inf.weakRedRoc4RecoveryEvaluable,
      weak_red_roc4_recovery_triggered: inf.weakRedRoc4RecoveryTriggered,
      weak_red_roc4_threshold: inf.weakRedRoc4Threshold,
      weak_red_roc4_value: inf.weakRedRoc4Value,
      prediction_after_weak_red_recovery: inf.predictionAfterWeakRedRecovery,
      prediction_source_after_weak_red_recovery: inf.predictionSourceAfterWeakRedRecovery,

      // --- V6-r3 component selection + broad mild-anchor-conflict veto ---
      selected_component: inf.selectedComponent,
      broad_distance_from_neutral: inf.broadDistanceFromNeutral,
      anchor_distance_from_neutral: inf.anchorDistanceFromNeutral,
      broad_conflict_veto_evaluable: conflict.evaluable,
      broad_conflict_veto_triggered: accepted && conflict.triggered,
      broad_conflict_veto_reason: accepted ? conflict.reason : null,
      broad_conflict_original_prediction: conflict.originalPrediction,
      broad_conflict_original_source: conflict.originalSource,
      broad_conflict_anchor_percentile: conflict.anchorPercentile,
      broad_conflict_anchor_direction: conflict.anchorDirection,
      broad_conflict_anchor_distance: conflict.anchorDistance,
      broad_conflict_min_distance: BROAD_CONFLICT_MIN_DISTANCE,
      broad_conflict_max_distance: BROAD_CONFLICT_MAX_DISTANCE,
      prediction_after_broad_conflict_veto: conflict.prediction,
      prediction_source_after_broad_conflict_veto: conflict.predictionSource,

      // --- V6-r3 BROAD_RED reliability governor ---
      broad_red_reliability_evaluable: reliability.evaluable,
      broad_red_reliability_ready: broadRedState.summary.ready,
      broad_red_reliability_veto_active: broadRedState.summary.active,
      broad_red_reliability_veto_triggered: accepted && reliability.triggered,
      broad_red_reliability_reason: accepted ? reliability.reason : null,
      broad_red_history_count: broadRedState.summary.count,
      broad_red_history_json: broadRedState.history,
      broad_red_last12_wins: broadRedState.summary.wins,
      broad_red_last12_losses: broadRedState.summary.losses,
      broad_red_last12_adjusted_net: broadRedState.summary.adjustedNet,
      broad_red_reliability_threshold: BROAD_RED_RELIABILITY_THRESHOLD,
      prediction_after_broad_red_reliability: r3Prediction,
      prediction_source_after_broad_red_reliability: r3Source,

      // --- V6-r4 Structure Confirmation Gate (prediction-time, immutable) ---
      path_efficiency_4: inf.ridgeFeatures.path_efficiency_4 ?? null,
      pre_structure_prediction: structure.preStructurePrediction,
      pre_structure_source: structure.preStructureSource,
      structure_confirmation_evaluable: accepted && structure.evaluable,
      structure_rejection_evaluable: structure.rejection.evaluable,
      structure_rejection_pass: structure.rejection.pass,
      structure_rejection_lower_wick_value: structure.values.lower_wick,
      structure_rejection_lower_wick_threshold: STRUCTURE_REJECTION_LOWER_WICK_MIN,
      structure_rejection_aligned_wick_value: structure.values.aligned_wick,
      structure_rejection_aligned_wick_threshold: STRUCTURE_REJECTION_ALIGNED_WICK_MIN,
      structure_expansion_evaluable: structure.expansion.evaluable,
      structure_expansion_pass: structure.expansion.pass,
      structure_expansion_range_value: structure.values.range_expansion,
      structure_expansion_range_threshold: STRUCTURE_EXPANSION_RANGE_MIN,
      structure_expansion_efficiency_value: structure.values.path_efficiency,
      structure_expansion_efficiency_threshold: STRUCTURE_EXPANSION_EFFICIENCY_MIN,
      structure_confirmation_pass: accepted ? structure.pass : false,
      structure_confirmation_triggered: accepted && structure.triggered,
      structure_confirmation_reason: accepted ? structure.reason : null,
      prediction_after_structure_confirmation: accepted ? r4Prediction : "OP_FAIL",
      prediction_source_after_structure_confirmation: accepted ? r4Source : "OP_FAIL",
      structure_underlying_prediction: accepted ? structure.underlyingPrediction : null,

      final_prediction: accepted ? r4Prediction : "OP_FAIL",
      // Strategic ABSTAIN is never an operational failure and vice versa.
      abstain_status: accepted && r4Prediction === "ABSTAIN" ? "STRATEGIC_ABSTAIN" : null,
      abstain_reason: accepted ? r4AbstainReason : null,

      // --- Regime Inverter — SHADOW ONLY (V6-r3 / r4) ---
      model_revision: V6_R4_MODEL_REVISION,
      original_v6_base_prediction: inf.basePrediction,
      original_v6_base_source: inf.predictionSource,
      pre_inverter_prediction: r4Prediction,
      pre_inverter_prediction_source: r4Source,
      regime_inverter_shadow_only: REGIME_INVERTER_SHADOW_ONLY,
      regime_inverter_publication_enabled: REGIME_INVERTER_PUBLICATION_ENABLED,
      regime_inverter_evaluable: inverter.evaluable,
      regime_inverter_ready: inverterState.summary.ready,
      regime_inverter_active: inverterState.summary.active,
      // Publication authority removed: the inverter can no longer trigger.
      regime_inverter_triggered: false,
      regime_inverter_would_trigger: accepted ? inverter.triggered : false,
      regime_inverter_would_publish: accepted && inverter.triggered ? inverter.finalPrediction : null,
      regime_inverter_history_count: inverterState.summary.count,
      regime_inverter_history_json: inverterState.history,
      regime_inverter_last20_wins: inverterState.summary.wins,
      regime_inverter_last20_losses: inverterState.summary.losses,
      regime_inverter_last20_adjusted_net: inverterState.summary.adjustedNet,
      regime_inverter_activation_threshold: V6_REGIME_INVERTER_THRESHOLD,
      regime_inverter_original_prediction: accepted ? inverter.originalPrediction : null,
      regime_inverter_replacement_prediction: accepted ? inverter.replacementPrediction : null,
      regime_inverter_reason: accepted && inverter.triggered ? inverter.reason : null,
      final_prediction_source: accepted ? r4Source : "OP_FAIL",

    };

    const { error } = await sb.from("v6_predictions").insert(row as never);
    if (error && !String(error.message).includes("duplicate key")) throw error;
  } catch (e) {
    await logError(sb, "v6-prediction-error", { target_candle_ts: targetTs.toISOString() }, e);
  }
}

/** Resolve every unresolved V6 row whose target candle has closed. Idempotent. */
export async function resolveDueV6(sb: SupabaseClient): Promise<void> {
  try {
    const cutoff = new Date(Date.now() - TF_MS).toISOString();
    const { data } = await sb
      .from("v6_predictions")
      .select(
        "prediction_id, target_candle_ts, base_v6_prediction, pre_weak_red_veto_prediction, final_prediction, operational_status, saturation_veto_triggered, red_pickup_triggered, green_pickup_triggered, weak_broad_red_veto_triggered, prediction_source, original_v6_base_prediction, original_v6_base_source, pre_inverter_prediction, regime_inverter_triggered, regime_inverter_would_trigger, regime_inverter_would_publish, weak_red_veto_candidate, weak_red_recovery_triggered, prediction_after_weak_red_recovery, selected_component, broad_percentile, anchor_percentile, broad_conflict_veto_triggered, broad_conflict_original_prediction, broad_red_reliability_veto_triggered, prediction_after_broad_conflict_veto, structure_confirmation_triggered, structure_underlying_prediction, pre_structure_prediction",
      )
      .eq("model_version", V6_MODEL_VERSION)
      .is("resolution_timestamp", null)
      .lte("target_candle_ts", cutoff)
      .order("target_candle_ts", { ascending: true })
      .limit(200);

    for (const r of (data ?? []) as Array<Record<string, unknown>>) {
      const targetTs = new Date(String(r.target_candle_ts));
      const { data: candle } = await sb
        .from("candles")
        .select("id, open, high, low, close, volume, confirm")
        .eq("symbol", V6_CANDLE_STREAM.symbol)
        .eq("timeframe", V6_CANDLE_STREAM.timeframe)
        .eq("fetch_source", V6_CANDLE_STREAM.provider)
        .eq("candle_ts", targetTs.toISOString())
        .maybeSingle();
      if (!candle) continue;
      const c = candle as Record<string, unknown>;
      if (c.confirm === false) continue;
      const open = Number(c.open), high = Number(c.high), low = Number(c.low), close = Number(c.close);
      const valid = [open, high, low, close].every((v) => Number.isFinite(v) && v > 0);
      if (!valid) continue;

      const actual: Actual = close > open ? "GREEN" : close < open ? "RED" : "PUSH";
      const opFail = String(r.operational_status) !== "OK";
      const base = (r.base_v6_prediction as Direction | null) ?? "ABSTAIN";
      const pre = (r.pre_weak_red_veto_prediction as Direction | null) ?? "ABSTAIN";
      const final = opFail ? "ABSTAIN" : ((r.final_prediction as Direction) ?? "ABSTAIN");

      const sat = abstentionContribution(Boolean(r.saturation_veto_triggered) && !opFail, base, actual);
      const weak = abstentionContribution(Boolean(r.weak_broad_red_veto_triggered) && !opFail, pre, actual);

      // --- V6-r2 weak-RED recovery counterfactuals (kept separate from the inverter) ---
      const weakRedCandidate = Boolean(r.weak_red_veto_candidate) && !opFail;
      const weakRedRestored = weakRedCandidate && Boolean(r.weak_red_recovery_triggered);
      const weakRedUnderlying: Direction | null = weakRedCandidate ? "RED" : null;
      const weakRedPublished =
        (r.prediction_after_weak_red_recovery as Direction | null) ??
        (weakRedRestored ? "RED" : "ABSTAIN");
      const weakRedUnderlyingRaw = weakRedCandidate ? rawScore("RED", actual) : null;
      const weakRedUnderlyingAdj = weakRedCandidate ? adjustedScore("RED", actual) : null;
      const weakRedRecoveryContribution =
        weakRedRestored && actual !== "PUSH"
          ? { raw: rawScore("RED", actual) ?? 0, adjusted: adjustedScore("RED", actual) ?? 0 }
          : { raw: 0, adjusted: 0 };
      const redPick = pickupContribution(Boolean(r.red_pickup_triggered) && !opFail, "RED", actual);
      const greenPick = pickupContribution(Boolean(r.green_pickup_triggered) && !opFail, "GREEN", actual);

      // --- Regime Inverter grading ---
      // The shadow always follows the ORIGINAL uninverted V6_BASE direction,
      // independent of what was published after inversion.
      const originalBase =
        ((r.original_v6_base_prediction as Direction | null) ?? base) ?? "ABSTAIN";
      const preInverter =
        ((r.pre_inverter_prediction as Direction | null) ?? final) ?? "ABSTAIN";
      const inverterTriggered = Boolean(r.regime_inverter_triggered) && !opFail;
      const inverterContrib = inverterContribution(inverterTriggered, preInverter, final, actual);
      const shadowEligible =
        !opFail && r.prediction_source === "V6_BASE" &&
        (originalBase === "GREEN" || originalBase === "RED") &&
        (actual === "GREEN" || actual === "RED");
      // --- V6-r3 shadow inverter accounting ---
      // Under r3 the inverter never publishes; its would-be result is graded
      // separately and excluded from the published V6-r3 net.
      const wouldTrigger = Boolean(r.regime_inverter_would_trigger) && !opFail;
      const wouldPublish = (r.regime_inverter_would_publish as Direction | null) ?? null;
      const inverterShadowRaw =
        wouldTrigger && wouldPublish ? rawScore(wouldPublish, actual) : null;
      const inverterShadowAdj =
        wouldTrigger && wouldPublish ? adjustedScore(wouldPublish, actual) : null;
      const inverterCounterfactual = inverterContribution(
        wouldTrigger,
        preInverter,
        wouldPublish ?? preInverter,
        actual,
      );

      // --- V6-r3 broad mild-anchor-conflict veto counterfactual ---
      const conflictTriggered = Boolean(r.broad_conflict_veto_triggered) && !opFail;
      const conflictUnderlying =
        (r.broad_conflict_original_prediction as Direction | null) ?? null;
      const conflictContrib = vetoContribution(conflictTriggered, conflictUnderlying, actual);

      // --- V6-r3 BROAD_RED reliability veto counterfactual ---
      const reliabilityTriggered = Boolean(r.broad_red_reliability_veto_triggered) && !opFail;
      const reliabilityUnderlying: Direction | null = reliabilityTriggered ? "RED" : null;
      const reliabilityContrib = vetoContribution(
        reliabilityTriggered,
        reliabilityUnderlying,
        actual,
      );

      // --- V6-r4 Structure Confirmation counterfactual (independent layer) ---
      const structureTriggered = Boolean(r.structure_confirmation_triggered) && !opFail;
      const structureUnderlying =
        (r.structure_underlying_prediction as Direction | null) ??
        (structureTriggered ? ((r.pre_structure_prediction as Direction | null) ?? null) : null);
      const structureContrib = structureContribution(
        structureTriggered,
        structureUnderlying,
        actual,
      );

      // --- V6-r3 BROAD_RED shadow membership (original frozen signal only) ---
      const selectedComponent =
        (r.selected_component as string | null) ??
        (Number.isFinite(Number(r.broad_percentile)) && Number.isFinite(Number(r.anchor_percentile))
          ? Math.abs(Number(r.broad_percentile) - 0.5) >=
            Math.abs(Number(r.anchor_percentile) - 0.5)
            ? "BROAD"
            : "ANCHOR"
          : "NONE");
      const baseSource =
        (r.original_v6_base_source as string | null) ?? (r.prediction_source as string | null);
      const broadRedEligible =
        !opFail &&
        selectedComponent === "BROAD" &&
        originalBase === "RED" &&
        baseSource === "V6_BASE" &&
        (actual === "GREEN" || actual === "RED");


      await sb
        .from("v6_predictions")
        .update({
          canonical_candle_row_id: String(c.id),
          canonical_open: open,
          canonical_high: high,
          canonical_low: low,
          canonical_close: close,
          canonical_volume: c.volume == null ? null : Number(c.volume),
          canonical_actual_direction: actual,
          canonical_ground_truth_valid: true,
          resolution_timestamp: new Date().toISOString(),
          // Operational failures are excluded from model scoring entirely.
          base_v6_raw_score: opFail ? null : rawScore(base, actual),
          base_v6_adjusted_score: opFail ? null : adjustedScore(base, actual),
          pre_weak_red_veto_raw_score: opFail ? null : rawScore(pre, actual),
          pre_weak_red_veto_adjusted_score: opFail ? null : adjustedScore(pre, actual),
          final_raw_score: opFail ? null : rawScore(final, actual),
          final_adjusted_score: opFail ? null : adjustedScore(final, actual),
          saturation_veto_raw_contribution: sat.raw,
          saturation_veto_adjusted_contribution: sat.adjusted,
          saturation_veto_avoided_loss: sat.avoidedLoss,
          saturation_veto_sacrificed_win: sat.sacrificedWin,
          red_pickup_raw_contribution: redPick.raw,
          red_pickup_adjusted_contribution: redPick.adjusted,
          green_pickup_raw_contribution: greenPick.raw,
          green_pickup_adjusted_contribution: greenPick.adjusted,
          weak_broad_red_veto_raw_contribution: weak.raw,
          weak_broad_red_veto_adjusted_contribution: weak.adjusted,
          weak_broad_red_veto_avoided_loss: weak.avoidedLoss,
          weak_broad_red_veto_sacrificed_win: weak.sacrificedWin,
          original_v6_shadow_raw_score:
            shadowEligible ? rawScore(originalBase, actual) : null,
          original_v6_shadow_adjusted_score:
            shadowEligible ? adjustedScore(originalBase, actual) : null,
          pre_inverter_raw_score: opFail ? null : rawScore(preInverter, actual),
          pre_inverter_adjusted_score: opFail ? null : adjustedScore(preInverter, actual),
          regime_inverter_raw_contribution: inverterContrib.raw,
          regime_inverter_adjusted_contribution: inverterContrib.adjusted,
          weak_red_underlying_prediction: weakRedUnderlying,
          weak_red_underlying_raw_score: weakRedUnderlyingRaw,
          weak_red_underlying_adjusted_score: weakRedUnderlyingAdj,
          weak_red_recovery_published_prediction: weakRedCandidate ? weakRedPublished : null,
          weak_red_recovery_raw_score: weakRedCandidate ? rawScore(weakRedPublished, actual) : null,
          weak_red_recovery_adjusted_score: weakRedCandidate ? adjustedScore(weakRedPublished, actual) : null,
          weak_red_recovery_counterfactual_adjusted_score: weakRedRestored ? weakRedUnderlyingAdj : null,
          weak_red_recovery_raw_contribution: weakRedRecoveryContribution.raw,
          weak_red_recovery_adjusted_contribution: weakRedRecoveryContribution.adjusted,

          // --- V6-r3 counterfactual accounting ---
          broad_conflict_underlying_prediction: conflictUnderlying,
          broad_conflict_underlying_raw_score:
            conflictUnderlying ? rawScore(conflictUnderlying, actual) : null,
          broad_conflict_underlying_adjusted_score:
            conflictUnderlying ? adjustedScore(conflictUnderlying, actual) : null,
          broad_conflict_veto_raw_contribution: conflictContrib.raw,
          broad_conflict_veto_adjusted_contribution: conflictContrib.adjusted,

          broad_red_underlying_prediction: reliabilityUnderlying,
          broad_red_underlying_raw_score:
            reliabilityUnderlying ? rawScore(reliabilityUnderlying, actual) : null,
          broad_red_underlying_adjusted_score:
            reliabilityUnderlying ? adjustedScore(reliabilityUnderlying, actual) : null,
          broad_red_reliability_raw_contribution: reliabilityContrib.raw,
          broad_red_reliability_adjusted_contribution: reliabilityContrib.adjusted,

          structure_underlying_prediction: structureUnderlying,
          structure_underlying_actual_direction: structureTriggered ? actual : null,
          structure_underlying_raw_score:
            structureUnderlying ? rawScore(structureUnderlying, actual) : null,
          structure_underlying_adjusted_score:
            structureUnderlying ? adjustedScore(structureUnderlying, actual) : null,
          structure_confirmation_raw_contribution: structureContrib.raw,
          structure_confirmation_adjusted_contribution: structureContrib.adjusted,

          broad_red_shadow_prediction: broadRedEligible ? "RED" : null,
          broad_red_shadow_adjusted_score: broadRedEligible ? adjustedScore("RED", actual) : null,

          regime_inverter_shadow_raw_score: inverterShadowRaw,
          regime_inverter_shadow_adjusted_score: inverterShadowAdj,
          regime_inverter_counterfactual_raw_contribution: inverterCounterfactual.raw,
          regime_inverter_counterfactual_adjusted_contribution: inverterCounterfactual.adjusted,
        } as never)
        .eq("prediction_id", String(r.prediction_id))
        .is("resolution_timestamp", null); // idempotent: never rewrite a resolved row

      // Feed the rolling shadow window (idempotent per target timestamp).
      if (shadowEligible) {
        await recordResolvedShadowSignal(sb, {
          target_candle_ts: targetTs.toISOString(),
          prediction_source: "V6_BASE",
          original_v6_base_prediction: originalBase,
          operational_status: "OK",
          canonical_ground_truth_valid: true,
          actual_direction: actual,
        });
      }

      // Feed the BROAD_RED reliability governor (idempotent per target ts).
      if (broadRedEligible) {
        await recordResolvedBroadRedSignal(sb, {
          target_candle_ts: targetTs.toISOString(),
          selected_component: "BROAD",
          base_v6_prediction: "RED",
          base_v6_prediction_source: "V6_BASE",
          operational_status: "OK",
          canonical_ground_truth_valid: true,
          actual_direction: actual,
        });
      }

    }
  } catch (e) {
    await logError(sb, "v6-resolution-error", {}, e);
  }
}

export { V6_MODEL };
