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
  V6_MODEL_REVISION,
  V6_REGIME_INVERTER_THRESHOLD,
} from "./regimeInverter";
import { ensureInverterState, recordResolvedShadowSignal } from "./regimeInverterStore";

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
  const { data, error } = await sb
    .from("candles")
    .select("id, candle_ts, open, high, low, close, volume")
    .eq("symbol", V6_CANDLE_STREAM.symbol)
    .eq("timeframe", V6_CANDLE_STREAM.timeframe)
    .eq("fetch_source", V6_CANDLE_STREAM.provider)
    .eq("confirm", true)
    .gte("candle_ts", firstTs.toISOString())
    .lte("candle_ts", lastTs.toISOString())
    .order("candle_ts", { ascending: true });
  if (error) return { rows: [], contiguous: false, error: `candle_query_failed:${error.message}` };

  const seen = new Set<string>();
  const all: HistoryRow[] = [];
  for (const r of (data ?? []) as Array<Record<string, unknown>>) {
    const iso = new Date(String(r.candle_ts)).toISOString();
    if (seen.has(iso)) continue;
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
    model_revision: V6_MODEL_REVISION,
    regime_inverter_evaluable: false,
    regime_inverter_triggered: false,
    regime_inverter_activation_threshold: V6_REGIME_INVERTER_THRESHOLD,
    abstain_status: null,
    red_threshold: V6_RED_THRESHOLD,
    green_threshold: V6_GREEN_THRESHOLD,
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

    // Step 10-11: rolling shadow state, then the Regime Inverter applied AFTER
    // every existing Armor rule. The unresolved target never enters the history.
    const inverterState = await ensureInverterState(sb, targetTs);
    const inverter = applyRegimeInverter(
      inf.finalPrediction,
      inf.predictionSource,
      inverterState.summary,
    );

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
      final_prediction: accepted ? inverter.finalPrediction : "OP_FAIL",
      // Strategic ABSTAIN is never an operational failure and vice versa.
      abstain_status:
        accepted && inverter.finalPrediction === "ABSTAIN" ? "STRATEGIC_ABSTAIN" : null,
      abstain_reason: accepted ? inf.abstainReason : null,

      // --- V6-r1 Regime Inverter (prediction-time, immutable after resolution) ---
      model_revision: V6_MODEL_REVISION,
      original_v6_base_prediction: inf.basePrediction,
      original_v6_base_source: inf.predictionSource,
      pre_inverter_prediction: inf.finalPrediction,
      pre_inverter_prediction_source: inf.predictionSource,
      regime_inverter_evaluable: inverter.evaluable,
      regime_inverter_ready: inverterState.summary.ready,
      regime_inverter_active: inverterState.summary.active,
      regime_inverter_triggered: accepted ? inverter.triggered : false,
      regime_inverter_history_count: inverterState.summary.count,
      regime_inverter_history_json: inverterState.history,
      regime_inverter_last20_wins: inverterState.summary.wins,
      regime_inverter_last20_losses: inverterState.summary.losses,
      regime_inverter_last20_adjusted_net: inverterState.summary.adjustedNet,
      regime_inverter_activation_threshold: V6_REGIME_INVERTER_THRESHOLD,
      regime_inverter_original_prediction: accepted ? inverter.originalPrediction : null,
      regime_inverter_replacement_prediction: accepted ? inverter.replacementPrediction : null,
      regime_inverter_reason: accepted ? inverter.reason : null,
      final_prediction_source: accepted ? inverter.finalPredictionSource : "OP_FAIL",
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
        "prediction_id, target_candle_ts, base_v6_prediction, pre_weak_red_veto_prediction, final_prediction, operational_status, saturation_veto_triggered, red_pickup_triggered, green_pickup_triggered, weak_broad_red_veto_triggered, prediction_source, original_v6_base_prediction, pre_inverter_prediction, regime_inverter_triggered",
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
        } as never)
        .eq("prediction_id", String(r.prediction_id))
        .is("resolution_timestamp", null); // idempotent: never rewrite a resolved row
    }
  } catch (e) {
    await logError(sb, "v6-resolution-error", {}, e);
  }
}

export { V6_MODEL };
