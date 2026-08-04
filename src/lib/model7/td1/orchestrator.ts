// TD1-RC orchestrator. Runs AFTER A2_Combined has been decided. Reads A2 as
// immutable input; writes a separate row to model7_td1_rc_shadow. Never mutates
// A2 rows. Fail-closed: any failure results in external_final_decision=SKIP.
//
// Policy revision: td1-rc-compressed-risk-v1 (decision policy only — the frozen
// TD1 fitted artifact and its SHA are untouched).

import type { SupabaseClient } from "@supabase/supabase-js";
import { buildTd1Features, hashFeatureVector, type PriorA2Signal } from "./features";
import { decideTd1Rc, type Side } from "./decision";
import { loadActiveTd1Fit } from "./fitStore";
import {
  TD1_COMPRESSED_RISK_THRESHOLD,
  TD1_GLOBAL_TURN_RISK_THRESHOLD,
  TD1_RC_POLICY_VERSION,
  TD1_RC_PROSPECTIVE_TEST_ID,
  classifyCompressedRiskCounterfactual,
  evaluateCompressedRisk,
  scoreDecision,
} from "./compressedRisk";
import type { Candle } from "../featurize";

const BASE_VARIANT = "A2_Combined";
const PROSPECTIVE_TEST_ID = TD1_RC_PROSPECTIVE_TEST_ID;
const VARIANT = "A2_Combined_TD1_RC";

export interface A2CombinedContext {
  predictionId: string;
  candleTs: string;
  targetBoundaryTs: string;
  finalDecision: "YES" | "NO" | "SKIP" | null;
  probabilityGreen: number | null;
  modelFitId: string | null;
  timingStatus: string | null;
  leakageCheckPassed: boolean | null;
  a2RowId?: string | null;
  /** Prediction-time market condition from the exact upstream prediction row. */
  marketCondition?: string | null;
  /** Row id of the upstream prediction row the market condition came from. */
  marketConditionSourceRowId?: string | null;
}

async function writeSkipRow(
  supabase: SupabaseClient,
  base: Record<string, unknown>,
  reason: string,
): Promise<Record<string, unknown>> {
  const row = {
    ...base,
    external_final_decision: "SKIP",
    would_trade: false,
    skip_reason: reason,
    all_veto_reasons_json: [reason],
  };
  await supabase.from("model7_td1_rc_shadow").insert(row as never);
  return row;
}

export async function runTd1RcForA2Combined(
  supabase: SupabaseClient,
  ctx: A2CombinedContext,
): Promise<Record<string, unknown> | null> {
  const baseRow: Record<string, unknown> = {
    prediction_id: ctx.predictionId,
    candle_ts: ctx.candleTs,
    variant: VARIANT,
    prospective_test_id: PROSPECTIVE_TEST_ID,
    a2_source_variant: BASE_VARIANT,
    a2_source_row_id: ctx.a2RowId ?? null,
    a2_original_decision: ctx.finalDecision,
    a2_probability_green: ctx.probabilityGreen,
    a2_model_fit_id: ctx.modelFitId,
    td1_threshold: TD1_GLOBAL_TURN_RISK_THRESHOLD,
    timing_status: ctx.timingStatus,
    leakage_check_passed: ctx.leakageCheckPassed,
    // --- td1-rc-compressed-risk-v1 audit (persisted on every write path) ---
    td1_policy_version: TD1_RC_POLICY_VERSION,
    td1_compressed_risk_threshold: TD1_COMPRESSED_RISK_THRESHOLD,
    td1_compressed_risk_market_condition: ctx.marketCondition ?? null,
    td1_compressed_risk_source_prediction_row_id: ctx.marketConditionSourceRowId ?? ctx.predictionId,
    td1_compressed_risk_evaluable: false,
    td1_compressed_risk_condition: false,
    td1_compressed_risk_veto_fired: false,
    td1_compressed_risk_reason: null,
    td1_compressed_risk_probability: null,
    td1_legacy_global_veto_condition: null,
  };

  try {
    // Eligibility gate.
    if (ctx.finalDecision !== "YES" && ctx.finalDecision !== "NO") {
      return await writeSkipRow(supabase, baseRow, "A2_INELIGIBLE");
    }
    if (ctx.timingStatus !== "ON_TIME" && ctx.timingStatus !== "LATE_WARNING") {
      return await writeSkipRow(supabase, baseRow, "A2_TIMING_FAILURE");
    }
    if (ctx.leakageCheckPassed !== true) {
      return await writeSkipRow(supabase, baseRow, "A2_LEAKAGE_FAILURE");
    }
    if (ctx.probabilityGreen == null || !Number.isFinite(ctx.probabilityGreen)) {
      return await writeSkipRow(supabase, baseRow, "A2_PROBABILITY_MISSING");
    }
    const side: Side = ctx.finalDecision;

    // Fetch prior canonical candles strictly before target_boundary_ts.
    const { data: candleRows } = await supabase
      .from("candles")
      .select("candle_ts, open, high, low, close, volume")
      .lt("candle_ts", ctx.targetBoundaryTs)
      .order("candle_ts", { ascending: false })
      .limit(30);
    const candles: Candle[] = (candleRows ?? []).map((r) => ({
      candle_ts: r.candle_ts as string,
      open: Number(r.open), high: Number(r.high), low: Number(r.low), close: Number(r.close),
      volume: r.volume as number | null,
    }));
    if (candles.length < 21) {
      return await writeSkipRow(supabase, baseRow, "MISSING_CANONICAL_OHLC_HISTORY");
    }

    // Fetch prior resolved eligible A2_Combined signals (newest first).
    const { data: paRows } = await supabase
      .from("model7_shadow")
      .select("candle_ts, decision, status")
      .eq("variant", BASE_VARIANT)
      .in("status", ["win", "loss"])
      .in("decision", ["YES", "NO"])
      .lt("candle_ts", ctx.candleTs)
      .order("candle_ts", { ascending: false })
      .limit(20);
    const priorSignals: PriorA2Signal[] = (paRows ?? []).map((r) => ({
      candle_ts: r.candle_ts as string,
      final_decision: r.decision as Side,
      counterfactual_result: r.status === "win" ? "WIN" : "LOSS",
    }));
    if (priorSignals.length < 8) {
      return await writeSkipRow(supabase, baseRow, "A2_HISTORY_WARMUP_INCOMPLETE");
    }

    // Build features.
    const built = buildTd1Features({
      currentSide: side,
      probabilityGreen: ctx.probabilityGreen,
      candlesNewestFirst: candles,
      priorA2SignalsNewestFirst: priorSignals,
    });
    const featureHash = await hashFeatureVector(built.features);

    baseRow.td1_feature_vector_sha256 = featureHash;
    baseRow.td1_latest_source_candle_ts = built.latestSourceCandleTs;
    baseRow.td1_feature_cutoff_ts = built.featureCutoffTs;
    baseRow.feature_values_json = built.features;

    // Load fit valid for this boundary.
    const artifact = await loadActiveTd1Fit(supabase, BASE_VARIANT, ctx.targetBoundaryTs);
    if (!artifact) {
      return await writeSkipRow(supabase, baseRow, "NO_ACTIVE_FIT");
    }
    baseRow.td1_fit_id = artifact.fitId;
    baseRow.td1_artifact_sha256 = artifact.artifactSha256;

    // Atomically consume containment slot on this side.
    const { data: consumeResp, error: consumeErr } = await supabase.rpc(
      "consume_td1_containment_slot",
      { p_base_variant: BASE_VARIANT, p_side: side },
    );
    if (consumeErr) {
      return await writeSkipRow(supabase, baseRow, `CONTAINMENT_RPC_ERROR:${consumeErr.message}`);
    }
    const consume = consumeResp as {
      veto_fired: boolean; slots_before: number; slots_after: number; episode_armed: boolean;
    };

    // Compressed-risk evaluation needs the TD1 loss probability, so score first
    // via decideTd1Rc, which returns the probability alongside the decision.
    // The probability is deterministic from the frozen artifact + features, so
    // pre-computing it for the gate is leakage-free.
    const preview = decideTd1Rc({
      a2FinalDecision: side,
      features: built.features,
      artifact,
      containment: {
        vetoFired: consume.veto_fired,
        slotsBefore: consume.slots_before,
        slotsAfter: consume.slots_after,
        episodeArmed: consume.episode_armed,
      },
    });

    const compressed = evaluateCompressedRisk({
      marketCondition: ctx.marketCondition,
      lossProbability: preview.td1LossProbability,
    });

    const decision = decideTd1Rc({
      a2FinalDecision: side,
      features: built.features,
      artifact,
      containment: {
        vetoFired: consume.veto_fired,
        slotsBefore: consume.slots_before,
        slotsAfter: consume.slots_after,
        episodeArmed: consume.episode_armed,
      },
      compressedRisk: compressed,
    });

    const finalRow = {
      ...baseRow,
      td1_predicted_loss_probability: decision.td1LossProbability,
      td1_veto_fired: decision.td1VetoFired,
      containment_veto_fired: decision.containmentVetoFired,
      containment_side: side,
      containment_slots_before: consume.slots_before,
      containment_slots_after: consume.slots_after,
      containment_episode_armed_before: consume.episode_armed,
      containment_episode_armed_after: consume.episode_armed && consume.slots_after === 0
        ? false
        : consume.episode_armed,
      all_veto_reasons_json: decision.allVetoReasons,
      external_final_decision: decision.externalFinalDecision,
      would_trade: decision.wouldTrade,
      skip_reason: decision.primarySkipReason,
      // --- td1-rc-compressed-risk-v1 ---
      td1_compressed_risk_market_condition: compressed.marketCondition,
      td1_compressed_risk_evaluable: decision.compressedRiskEvaluable,
      td1_compressed_risk_condition: decision.compressedRiskCondition,
      td1_compressed_risk_veto_fired: decision.compressedRiskVetoFired,
      td1_compressed_risk_reason: decision.compressedRiskReason,
      td1_compressed_risk_probability: decision.td1LossProbability,
      td1_legacy_global_veto_condition: decision.legacyGlobalVetoCondition,
      td1_compressed_risk_counterfactual_direction: decision.compressedRiskVetoFired ? side : null,
      // Audit-only policy counterfactuals (never published, never webhooked).
      td1_prev_policy_decision: decision.previousPolicy.decision,
      td1_prev_policy_would_trade: decision.previousPolicy.wouldTrade,
      td1_no_global_veto_decision: decision.noGlobalVetoPolicy.decision,
      td1_no_global_veto_would_trade: decision.noGlobalVetoPolicy.wouldTrade,
    };
    await supabase.from("model7_td1_rc_shadow").insert(finalRow as never);
    return finalRow;
  } catch (e) {
    try {
      return await writeSkipRow(supabase, baseRow, `TD1_RC_ERROR:${e instanceof Error ? e.message : String(e)}`);
    } catch { /* ignore */ }
    try {
      await supabase.from("api_runs").insert({
        run_type: "td1-rc-error",
        response_payload: {
          error: e instanceof Error ? e.message : String(e),
          prediction_id: ctx.predictionId,
        },
        success: false,
        error_message: e instanceof Error ? e.message : String(e),
      });
    } catch { /* ignore */ }
    return null;
  }
}

/** Resolve TD1-RC row after actual_direction is known. Never blocks caller. */
export async function resolveTd1RcRow(
  supabase: SupabaseClient,
  predictionId: string,
  actualDirection: "GREEN" | "RED",
): Promise<void> {
  try {
    const { data: row } = await supabase
      .from("model7_td1_rc_shadow")
      .select(
        "id, a2_original_decision, external_final_decision, candle_ts, resolved_at, " +
        "td1_compressed_risk_veto_fired, td1_prev_policy_decision, td1_no_global_veto_decision",
      )
      .eq("prediction_id", predictionId)
      .eq("variant", VARIANT)
      .maybeSingle();
    if (!row) return;
    // Idempotent: already-resolved rows are never re-scored.
    if (row.resolved_at) return;
    const a2 = row.a2_original_decision as "YES" | "NO" | null;
    if (a2 !== "YES" && a2 !== "NO") return;
    const cfResult = (a2 === "YES" && actualDirection === "GREEN") ||
                     (a2 === "NO" && actualDirection === "RED") ? "WIN" : "LOSS";
    const ext = row.external_final_decision as string | null;
    // Row-level status/result mirrors the external decision:
    //   SKIP → result=PUSH (not traded), YES/NO → grade against actual
    let result: "WIN" | "LOSS" | "PUSH" = "PUSH";
    if (ext === "YES" || ext === "NO") {
      result = (ext === "YES" && actualDirection === "GREEN") ||
               (ext === "NO" && actualDirection === "RED") ? "WIN" : "LOSS";
    }

    // --- td1-rc-compressed-risk-v1 counterfactual accounting ---
    const compressedVeto = row.td1_compressed_risk_veto_fired === true;
    const cf = classifyCompressedRiskCounterfactual({
      vetoFired: compressedVeto,
      underlyingDirection: a2,
      actualDirection,
    });
    const prev = scoreDecision(
      (row.td1_prev_policy_decision as "YES" | "NO" | "SKIP" | null) ?? null,
      actualDirection,
    );
    const noGlobal = scoreDecision(
      (row.td1_no_global_veto_decision as "YES" | "NO" | "SKIP" | null) ?? null,
      actualDirection,
    );

    await supabase.from("model7_td1_rc_shadow").update({
      a2_counterfactual_result: cfResult,
      actual_direction: actualDirection,
      result,
      resolved_at: new Date().toISOString(),
      td1_compressed_risk_counterfactual_direction: compressedVeto ? a2 : null,
      td1_compressed_risk_counterfactual_result: cf.classification,
      td1_compressed_risk_counterfactual_score: cf.abstentionScore,
      td1_compressed_risk_veto_value: cf.vetoValue,
      td1_prev_policy_result: prev.result,
      td1_prev_policy_score: prev.score,
      td1_no_global_veto_result: noGlobal.result,
      td1_no_global_veto_score: noGlobal.score,
    } as never).eq("id", row.id as string).is("resolved_at", null);

    // Apply idempotent containment state update.
    const resolutionId = `${predictionId}:TD1_RC_V1`;
    await supabase.rpc("apply_td1_rc_resolution", {
      p_resolution_id: resolutionId,
      p_prediction_id: predictionId,
      p_candle_ts: row.candle_ts as string,
      p_base_variant: "A2_Combined",
      p_side: a2,
      p_result: cfResult,
    });
  } catch (e) {
    try {
      await supabase.from("api_runs").insert({
        run_type: "td1-rc-resolve-error",
        response_payload: {
          error: e instanceof Error ? e.message : String(e),
          prediction_id: predictionId,
        },
        success: false,
        error_message: e instanceof Error ? e.message : String(e),
      });
    } catch { /* ignore */ }
  }
}
