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
  COMPRESSED_RISK_ATTRIBUTION_VERSION,
  attributeCompressedRisk,
  evaluateCompressedRisk,
  scoreDecision,
} from "./compressedRisk";
import {
  TD2_R2_ACTIVATION_TS,
  TD2_R2_POLICY_VERSION,
  TD2_R2_PROSPECTIVE_TEST_ID,
  TD2_RECOVERY_FEATURE_NAME,
  TD2_RECOVERY_THRESHOLD,
  attributeTd2R2,
  evaluateTd2R2,
} from "./td2r2";
import {
  TD3_POLICY_VERSION,
  TD3_VARIANT,
  TD3_VETO_REASON,
  evaluateTd3,
  scoreTd3Decision,
  td3PredictionColumns,
  td3VetoValue,
} from "./td3";
import type { Candle } from "../featurize";


const BASE_VARIANT = "A2_Combined";
const PROSPECTIVE_TEST_ID = TD1_RC_PROSPECTIVE_TEST_ID;
/** Original TD1-RC (no compressed-risk gate). Webhook / hero source. */
export const TD1_VARIANT = "A2_Combined_TD1_RC";
/** TD2-RC: identical pipeline plus the active compressed-risk gate. */
export const TD2_VARIANT = "A2_Combined_TD2_RC";
export const TD2_PROSPECTIVE_TEST_ID = "A2_COMBINED_TD2_RC_COMPRESSED_RISK_045_V1";
const VARIANT = TD1_VARIANT;
const TD1_POLICY_VERSION = "td1-rc-v1";

export interface Td1RcRunResult {
  td1Row: Record<string, unknown>;
  td2Row: Record<string, unknown>;
}

async function writeSkipRow(
  supabase: SupabaseClient,
  base: Record<string, unknown>,
  reason: string,
): Promise<Td1RcRunResult> {
  const row = {
    ...base,
    external_final_decision: "SKIP",
    would_trade: false,
    skip_reason: reason,
    all_veto_reasons_json: [reason],
  };
  // Mirror the skip to TD2-RC so both trackers stay row-aligned.
  const td2Row = {
    ...row,
    variant: TD2_VARIANT,
    prospective_test_id: TD2_R2_PROSPECTIVE_TEST_ID,
    td1_policy_version: TD1_RC_POLICY_VERSION,
    // td2-r2 prediction-time audit fields are persisted on every write path.
    td2_policy_version: TD2_R2_POLICY_VERSION,
    td2_prospective_test_id: TD2_R2_PROSPECTIVE_TEST_ID,
    td2_policy_activation_ts: TD2_R2_ACTIVATION_TS,
    td2_recovery_feature_name: TD2_RECOVERY_FEATURE_NAME,
    td2_recovery_feature_value: null,
    td2_recovery_threshold: TD2_RECOVERY_THRESHOLD,
    td2_recovery_evaluable: false,
    td2_recovery_condition: false,
    td2_recovery_fired: false,
    td2_recovery_reason: "COMPRESSED_RISK_NOT_FIRED",
    td2_recovery_direction: null,
    td2_recovery_source_feature_cutoff_ts: (base.td1_feature_cutoff_ts as string | null) ?? null,
    td2_r1_counterfactual_decision: "SKIP",
    td2_r1_counterfactual_would_trade: false,
    td2_r1_counterfactual_skip_reason: reason,
    td2_recovery_value_class: "NO_CHANGE",
  };
  const { data: inserted } = await supabase
    .from("model7_td1_rc_shadow")
    .insert([row, td2Row] as never)
    .select("id, variant");
  const td1RowId = ((inserted ?? []) as { id: string; variant: string }[])
    .find((r) => r.variant === VARIANT)?.id ?? null;
  await writeTd3Row(supabase, row, td1RowId);
  return { td1Row: row, td2Row };
}

/** TD3 = exact TD1 row + one final Toxic Opposing Drift Veto. Never mutates TD1. */
async function writeTd3Row(
  supabase: SupabaseClient,
  td1Row: Record<string, unknown>,
  td1RowId: string | null,
): Promise<void> {
  const features = (td1Row.feature_values_json as Record<string, unknown> | null) ?? null;
  const preVetoDecision = (td1Row.external_final_decision as "YES" | "NO" | "SKIP" | null) ?? null;
  const evaluation = evaluateTd3({
    preVetoDecision,
    preVetoWouldTrade: td1Row.would_trade === true,
    preVetoSkipReason: (td1Row.skip_reason as string | null) ?? null,
    currentDirectionalConfidence: features?.current_directional_confidence as number | undefined,
    opposingDrift4: features?.opposing_drift_4 as number | undefined,
    sameDirectionRunLength: features?.same_direction_run_length as number | undefined,
  });
  const td3Row = {
    ...td1Row,
    variant: TD3_VARIANT,
    prospective_test_id: TD3_POLICY_VERSION,
    external_final_decision: evaluation.finalDecision,
    would_trade: evaluation.wouldTrade,
    skip_reason: evaluation.skipReason,
    all_veto_reasons_json: evaluation.vetoFired
      ? [...((td1Row.all_veto_reasons_json as string[] | null) ?? []), TD3_VETO_REASON]
      : ((td1Row.all_veto_reasons_json as string[] | null) ?? []),
    ...td3PredictionColumns({
      evaluation,
      runMode: "LIVE",
      preVetoDecision,
      preVetoWouldTrade: td1Row.would_trade === true,
      preVetoSkipReason: (td1Row.skip_reason as string | null) ?? null,
      sourceTd1RowId: td1RowId,
      sourceTd1PolicyVersion: (td1Row.td1_policy_version as string | null) ?? null,
      sourceTd1FitId: (td1Row.td1_fit_id as string | null) ?? null,
      sourceTd1ArtifactSha256: (td1Row.td1_artifact_sha256 as string | null) ?? null,
      featureCutoffTs: (td1Row.td1_feature_cutoff_ts as string | null) ?? null,
      latestSourceCandleTs: (td1Row.td1_latest_source_candle_ts as string | null) ?? null,
      timingStatus: (td1Row.timing_status as string | null) ?? null,
      leakageCheckPassed: (td1Row.leakage_check_passed as boolean | null) ?? null,
    }),
  };
  await supabase.from("model7_td1_rc_shadow").insert(td3Row as never);
}


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

export async function runTd1RcForA2Combined(
  supabase: SupabaseClient,
  ctx: A2CombinedContext,
): Promise<Td1RcRunResult | null> {
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
    // --- compressed-risk audit (persisted on every write path; TD1 records only) ---
    td1_policy_version: TD1_POLICY_VERSION,
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

    const containment = {
      vetoFired: consume.veto_fired,
      slotsBefore: consume.slots_before,
      slotsAfter: consume.slots_after,
      episodeArmed: consume.episode_armed,
    };

    // TD1-RC: original form — compressed risk recorded for audit, never applied.
    const decision = decideTd1Rc({
      a2FinalDecision: side,
      features: built.features,
      artifact,
      containment,
      compressedRisk: compressed,
      applyCompressedRisk: false,
    });

    // TD2-RC: identical inputs, compressed-risk gate active.
    const td2Decision = decideTd1Rc({
      a2FinalDecision: side,
      features: built.features,
      artifact,
      containment,
      compressedRisk: compressed,
      applyCompressedRisk: true,
    });

    const shapeRow = (d: typeof decision) => ({
      ...baseRow,
      td1_predicted_loss_probability: d.td1LossProbability,
      td1_veto_fired: d.td1VetoFired,
      containment_veto_fired: d.containmentVetoFired,
      containment_side: side,
      containment_slots_before: consume.slots_before,
      containment_slots_after: consume.slots_after,
      containment_episode_armed_before: consume.episode_armed,
      containment_episode_armed_after: consume.episode_armed && consume.slots_after === 0
        ? false
        : consume.episode_armed,
      all_veto_reasons_json: d.allVetoReasons,
      external_final_decision: d.externalFinalDecision,
      would_trade: d.wouldTrade,
      skip_reason: d.primarySkipReason,
      td1_compressed_risk_market_condition: compressed.marketCondition,
      td1_compressed_risk_evaluable: d.compressedRiskEvaluable,
      td1_compressed_risk_condition: d.compressedRiskCondition,
      td1_compressed_risk_veto_fired: d.compressedRiskVetoFired,
      td1_compressed_risk_reason: d.compressedRiskReason,
      td1_compressed_risk_probability: d.td1LossProbability,
      td1_legacy_global_veto_condition: d.legacyGlobalVetoCondition,
      td1_compressed_risk_counterfactual_direction: d.compressedRiskVetoFired ? side : null,
      // Audit-only policy counterfactuals (never published, never webhooked).
      td1_prev_policy_decision: d.previousPolicy.decision,
      td1_prev_policy_would_trade: d.previousPolicy.wouldTrade,
      td1_prev_policy_skip_reason: d.previousPolicy.primaryReason,
      td1_compressed_risk_attribution_version: COMPRESSED_RISK_ATTRIBUTION_VERSION,
      td1_compressed_risk_incremental_change: null,
      td1_no_global_veto_decision: d.noGlobalVetoPolicy.decision,
      td1_no_global_veto_would_trade: d.noGlobalVetoPolicy.wouldTrade,
    });

    const finalRow = shapeRow(decision);

    // --- TD2-r2: Opposing Drift Recovery (active TD2 shadow policy) ---
    // Recovery only ever converts an incremental compressed-risk abstention back
    // into the exact previous-policy direction. Never reverses.
    const r2 = evaluateTd2R2({
      r1Decision: td2Decision.externalFinalDecision,
      r1WouldTrade: td2Decision.wouldTrade,
      r1SkipReason: td2Decision.primarySkipReason,
      compressedRiskVetoFired: td2Decision.compressedRiskVetoFired,
      previousPolicy: td2Decision.previousPolicy,
      opposingDrift4: built.features.opposing_drift_4,
      timingValid: ctx.leakageCheckPassed === true,
    });
    const td2Base = shapeRow(td2Decision);
    const td2Row = {
      ...td2Base,
      variant: TD2_VARIANT,
      prospective_test_id: TD2_R2_PROSPECTIVE_TEST_ID,
      td1_policy_version: TD1_RC_POLICY_VERSION,
      external_final_decision: r2.decision,
      would_trade: r2.wouldTrade,
      skip_reason: r2.skipReason,
      all_veto_reasons_json: r2.vetoReasons,
      td2_policy_version: TD2_R2_POLICY_VERSION,
      td2_prospective_test_id: TD2_R2_PROSPECTIVE_TEST_ID,
      td2_policy_activation_ts: TD2_R2_ACTIVATION_TS,
      td2_recovery_feature_name: TD2_RECOVERY_FEATURE_NAME,
      td2_recovery_feature_value: r2.featureValue,
      td2_recovery_threshold: TD2_RECOVERY_THRESHOLD,
      td2_recovery_evaluable: r2.evaluable,
      td2_recovery_condition: r2.condition,
      td2_recovery_fired: r2.fired,
      td2_recovery_reason: r2.reason,
      td2_recovery_direction: r2.direction,
      td2_recovery_source_feature_cutoff_ts: built.featureCutoffTs,
      td2_r1_counterfactual_decision: r2.r1Decision,
      td2_r1_counterfactual_would_trade: r2.r1WouldTrade,
      td2_r1_counterfactual_skip_reason: r2.r1SkipReason,
      td2_recovery_value_class: r2.fired ? "UNRESOLVED" : "NO_CHANGE",
    };

    const { data: inserted } = await supabase
      .from("model7_td1_rc_shadow")
      .insert([finalRow, td2Row] as never)
      .select("id, variant");
    const td1RowId = ((inserted ?? []) as { id: string; variant: string }[])
      .find((r) => r.variant === VARIANT)?.id ?? null;
    await writeTd3Row(supabase, finalRow, td1RowId);
    return { td1Row: finalRow, td2Row };
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

/** Resolve TD1-RC + TD2-RC rows after actual_direction is known. Never blocks caller. */
export async function resolveTd1RcRow(
  supabase: SupabaseClient,
  predictionId: string,
  actualDirection: "GREEN" | "RED",
): Promise<void> {
  try {
    const { data: rowData } = await supabase
      .from("model7_td1_rc_shadow")
      .select(
        "id, variant, a2_original_decision, external_final_decision, candle_ts, resolved_at, " +
        "td1_compressed_risk_veto_fired, td1_prev_policy_decision, td1_prev_policy_would_trade, " +
        "td1_prev_policy_skip_reason, td1_no_global_veto_decision, " +
        "td2_policy_version, td2_recovery_fired, td2_r1_counterfactual_decision, " +
        "td3_policy_version, td3_pre_veto_decision, td3_toxic_drift_veto_fired, td3_final_decision",
      )

      .eq("prediction_id", predictionId)
      .in("variant", [VARIANT, TD2_VARIANT, TD3_VARIANT]);
    const rows = ((rowData ?? []) as unknown) as Record<string, unknown>[];
    if (rows.length === 0) return;

    let containmentInput: { candleTs: string; side: "YES" | "NO"; cfResult: "WIN" | "LOSS" } | null = null;

    for (const row of rows) {
      // Idempotent: already-resolved rows are never re-scored.
      if (row.resolved_at) continue;
      const a2 = row.a2_original_decision as "YES" | "NO" | null;
      if (a2 !== "YES" && a2 !== "NO") continue;
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

      // --- compressed-risk counterfactual accounting ---
      const compressedVeto = row.td1_compressed_risk_veto_fired === true;
      const cf = attributeCompressedRisk({
        vetoFired: compressedVeto,
        previousPolicyDecision: (row.td1_prev_policy_decision as "YES" | "NO" | "SKIP" | null) ?? null,
        previousPolicyWouldTrade: (row.td1_prev_policy_would_trade as boolean | null) ?? null,
        previousPolicySkipReason: (row.td1_prev_policy_skip_reason as string | null) ?? null,
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

      // --- TD2-r2 recovery attribution (TD2 rows only) ---
      let td2Patch: Record<string, unknown> = {};
      if (row.variant === TD2_VARIANT && row.td2_policy_version) {
        const att = attributeTd2R2({
          activeDecision: (ext as "YES" | "NO" | "SKIP" | null) ?? null,
          r1Decision: (row.td2_r1_counterfactual_decision as "YES" | "NO" | "SKIP" | null) ?? null,
          recoveryFired: row.td2_recovery_fired === true,
          actualDirection,
        });
        td2Patch = {
          td2_r1_counterfactual_result: att.r1Result,
          td2_r1_counterfactual_score: att.r1Score,
          td2_recovery_result: att.recoveryResult,
          td2_recovery_score: att.recoveryScore,
          td2_recovery_incremental_value: att.incrementalValue,
          td2_recovery_value_class: att.valueClass,
        };
      }

      // --- TD3 toxic-drift attribution (TD3 rows only) ---
      let td3Patch: Record<string, unknown> = {};
      if (row.variant === TD3_VARIANT && row.td3_policy_version) {
        const td3Final = scoreTd3Decision(
          (row.td3_final_decision as "YES" | "NO" | "SKIP" | null) ?? null,
          actualDirection,
        );
        const underlyingDecision = (row.td3_pre_veto_decision as "YES" | "NO" | "SKIP" | null) ?? null;
        const underlying = scoreTd3Decision(underlyingDecision, actualDirection);
        const vetoFired = row.td3_toxic_drift_veto_fired === true;
        td3Patch = {
          td3_result: td3Final.result,
          td3_raw_score: td3Final.score,
          td3_underlying_td1_decision: underlyingDecision,
          td3_underlying_td1_result: underlying.result,
          td3_underlying_td1_score: underlying.score,
          td3_toxic_drift_veto_value: td3VetoValue(vetoFired, underlying.result),
        };
      }

      await supabase.from("model7_td1_rc_shadow").update({
        a2_counterfactual_result: cfResult,
        actual_direction: actualDirection,
        result,
        resolved_at: new Date().toISOString(),
        td1_compressed_risk_counterfactual_direction: compressedVeto ? a2 : null,
        td1_compressed_risk_counterfactual_result: cf.classification,
        td1_compressed_risk_counterfactual_score: cf.counterfactualScore,
        td1_compressed_risk_veto_value: cf.vetoValue,
        td1_compressed_risk_incremental_change: cf.incrementalChange,
        td1_compressed_risk_attribution_version: cf.attributionVersion,
        td1_prev_policy_result: prev.result,
        td1_prev_policy_score: prev.score,
        td1_no_global_veto_result: noGlobal.result,
        td1_no_global_veto_score: noGlobal.score,
        ...td2Patch,
      } as never).eq("id", row.id as string).is("resolved_at", null);


      if (row.variant === VARIANT) {
        containmentInput = { candleTs: row.candle_ts as string, side: a2, cfResult };
      }
    }

    // Apply idempotent containment state update (once, from the TD1 row).
    if (containmentInput) {
      const resolutionId = `${predictionId}:TD1_RC_V1`;
      await supabase.rpc("apply_td1_rc_resolution", {
        p_resolution_id: resolutionId,
        p_prediction_id: predictionId,
        p_candle_ts: containmentInput.candleTs,
        p_base_variant: "A2_Combined",
        p_side: containmentInput.side,
        p_result: containmentInput.cfResult,
      });
    }
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
