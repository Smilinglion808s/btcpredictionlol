// B4x4 orchestrator — live prediction path, persistence, webhook and resolution.
//
// Runs AFTER A2_Combined has produced its canonical prediction-time
// probability. Reads A2 as immutable input, writes only to b4x4_predictions.
// Never blocks or mutates any other model.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  B4X4_CANONICAL_CANDLE_SOURCE,
  B4X4_IMPLEMENTATION_REVISION,
  B4X4_MODEL_NAME,
  B4X4_MODEL_VERSION,
  B4X4_MODEL_VERSIONS,
  CALIBRATION_PROMOTION_ACTIVATED_AT,
  B4X4_PROSPECTIVE_TEST_ID,
  B4X4_RESOLVER_VERSION,
  B4X4_REVISION_ACTIVATED_AT,
  B4X4_REVISION_PROSPECTIVE_TEST_ID,
  B4X4_SOURCE_EPOCH_TS,
  B4X4_SOURCE_INDEX_VERSION,
  B4X4_SOURCE_VARIANT,
  B4X4_VARIANT,
  GRID_TRAINING_LOOKBACK,
  b4x4ConfigHash,
  b4x4LocalDate,
} from "./config";
import { b4x4BuildIdentity } from "./build-identity";

import {
  brakeAttribution,
  saturationAttribution,
  evaluateB4x4,
  scoreAgainst,
  type ActualDirection,
  type B4x4Decision,
  type DailyState,
  type Direction,
  type HistoryEntry,
  type SourceRow,
} from "./engine";

/** First target boundary eligible for live webhooks. Rows before this never webhook. */
export const B4X4_LIVE_STARTED_AT = "2026-08-07T04:00:00.000Z";

/**
 * Immutable webhook activation boundary (approved go-live).
 * Only LIVE, published rows whose target candle opens at or after this exact
 * 15-minute boundary may emit a directional webhook. Never change this value.
 */
export const B4X4_WEBHOOK_ACTIVATION_TS = "2026-08-07T04:45:00.000Z";

const HISTORY_FETCH = GRID_TRAINING_LOOKBACK + 64;

export interface B4x4Context {
  predictionId: string;
  candleTs: string;               // target candle timestamp (canonical A2 key)
  a2RowId?: string | null;
  probabilityGreen: number | null;
  timingStatus: string | null;
  leakageCheckPassed: boolean | null;
  a2ModelFitId?: string | null;
  a2ProductionModelVersion?: string | null;
  featureCutoffTs?: string | null;
  latestSourceCandleTs?: string | null;
  runMode?: "LIVE" | "BACKFILL";
  /** Scheduler run identity, for gap/watchdog auditing. */
  schedulerInvocationId?: string | null;
  /** Set when this row is produced by a catch-up pass for a missed boundary. */
  catchupTargetTs?: string | null;
  operationalGapStatus?: string | null;
  operationalGapReason?: string | null;
  /**
   * When true the order-book shadow capture is NOT awaited inside the run, so
   * order-book polling can never delay the prediction row or its webhook. The
   * caller must invoke captureB4x4ShadowForRow() afterwards.
   */
  deferShadowCapture?: boolean;
}

type DbRow = Record<string, unknown>;

/**
 * Build the complete canonical B4x4 history since the frozen source epoch.
 *
 * The history MUST come from the canonical A2_Combined source stream (the same
 * stream the reference replay uses), not from previously persisted B4x4 rows —
 * a persisted-row loader silently truncates the absolute window and produces
 * short (445–448 row) grids. Every prior valid source row is replayed with the
 * frozen engine so ranks, quartiles and correctness are contemporaneous.
 */
export async function loadHistory(
  supabase: SupabaseClient,
  beforeCandleTs: string,
): Promise<HistoryEntry[]> {
  const { loadCanonicalSourceRows } = await import("./backfill");
  const before = new Date(beforeCandleTs).getTime();
  const source = (await loadCanonicalSourceRows(supabase, { upTo: beforeCandleTs })).filter(
    (r) => new Date(r.candleTs).getTime() < before,
  );
  const { replayB4x4 } = await import("./engine");
  const replay = replayB4x4(source);
  const out: HistoryEntry[] = [];
  for (const r of replay) {
    if (r.decision.historyEntry) out.push(r.decision.historyEntry);
  }
  return out;
}


/** Resolved, published day net for the local (America/Boise) date. */
export async function loadDailyState(
  supabase: SupabaseClient,
  candleTs: string,
): Promise<DailyState> {
  const localDate = b4x4LocalDate(candleTs);
  const { data } = await supabase
    .from("b4x4_predictions")
    .select("result_score, result")
    .in("model_version", B4X4_MODEL_VERSIONS)
    .eq("local_date", localDate)
    .eq("would_trade", true)
    .not("resolved_at", "is", null)
    .lt("target_candle_ts", candleTs);
  let net = 0;
  let count = 0;
  for (const r of (data ?? []) as unknown as DbRow[]) {
    net += Number(r.result_score ?? 0);
    count++;
  }
  return { localDate, dailyNetBefore: net, dailyResolvedTradeCountBefore: count };
}

export function decisionToRow(ctx: B4x4Context, d: B4x4Decision): DbRow {
  const runMode = ctx.runMode ?? "LIVE";
  const build = b4x4BuildIdentity();
  return {
    build_identifier: build.build_identifier,
    build_commit_sha: build.build_commit_sha,
    deploy_environment: build.deploy_environment,

    source_a2_row_id: ctx.a2RowId ?? null,
    source_prediction_id: ctx.predictionId ?? null,
    target_candle_ts: ctx.candleTs,
    model_name: B4X4_MODEL_NAME,
    model_version: B4X4_MODEL_VERSION,
    variant: B4X4_VARIANT,
    prospective_test_id: B4X4_PROSPECTIVE_TEST_ID,
    config_hash: b4x4ConfigHash(),
    run_mode: runMode,
    webhook_eligible:
      runMode === "LIVE" && d.wouldTrade &&
      new Date(ctx.candleTs).getTime() >= new Date(B4X4_LIVE_STARTED_AT).getTime(),

    a2_source_variant: B4X4_SOURCE_VARIANT,
    a2_model_fit_id: ctx.a2ModelFitId ?? null,
    a2_production_model_version: ctx.a2ProductionModelVersion ?? null,
    a2_probability_green: d.probabilityGreen,
    raw_direction: d.rawDirection,
    confidence: d.confidence,
    feature_cutoff_ts: ctx.featureCutoffTs ?? null,
    latest_source_candle_ts: ctx.latestSourceCandleTs ?? null,
    timing_status: ctx.timingStatus,
    leakage_check_passed: ctx.leakageCheckPassed,
    data_valid: d.dataValid,
    data_invalid_reason: d.dataInvalidReason,

    global_rank: d.globalRank,
    global_history_count: d.globalHistoryCount,
    global_history_start_ts: d.globalHistoryStartTs,
    global_history_end_ts: d.globalHistoryEndTs,
    global_history_start_index: d.globalHistoryStartIndex,
    global_history_end_index: d.globalHistoryEndIndex,
    same_side_rank: d.sameSideRank,
    same_side_history_count: d.sameSideHistoryCount,
    same_side_history_start_ts: d.sameSideHistoryStartTs,
    same_side_history_end_ts: d.sameSideHistoryEndTs,
    same_side_history_start_index: d.sameSideHistoryStartIndex,
    same_side_history_end_index: d.sameSideHistoryEndIndex,
    same_side_input_source_count: d.sameSideInputSourceCount,
    same_side_filtered_count: d.sameSideFilteredCount,
    same_side_raw_direction_filter: d.sameSideRawDirectionFilter,
    global_rank_quartile: d.globalRankQuartile,
    same_side_rank_quartile: d.sameSideRankQuartile,
    quality_mean: d.qualityMean,

    grid_training_lookback: GRID_TRAINING_LOOKBACK,
    grid_training_resolved_count: d.gridTrainingResolvedCount,
    grid_training_source_count: d.gridTrainingSourceCount,
    grid_training_start_ts: d.gridTrainingStartTs,
    grid_training_end_ts: d.gridTrainingEndTs,
    grid_training_start_index: d.gridTrainingStartIndex,
    grid_training_end_index: d.gridTrainingEndIndex,
    grid_window_integrity_passed: d.gridWindowIntegrityPassed,
    grid_window_integrity_reason: d.gridWindowIntegrityReason,
    grid_prior_alpha: 8,
    grid_prior_beta: 8,
    grid_cell: d.gridCell,
    grid_cell_resolved_count: d.gridCellResolvedCount,
    grid_cell_wins: d.gridCellWins,
    grid_cell_losses: d.gridCellLosses,
    p_correct: d.pCorrect,
    grid_reference_count: d.gridReferenceCount,
    grid_reference_source_count: d.gridReferenceSourceCount,
    grid_reference_start_index: d.gridReferenceStartIndex,
    grid_reference_end_index: d.gridReferenceEndIndex,
    grid_reference_start_ts: d.gridReferenceStartTs,
    grid_reference_end_ts: d.gridReferenceEndTs,
    grid_quality_percentile: d.gridQualityPercentile,
    grid_snapshot_json: d.gridSnapshot,

    core_eligible: d.coreEligible,
    expansion_eligible: d.expansionEligible,
    base_candidate: d.baseCandidate,
    selected_route: d.selectedRoute,

    // ---- calibration promotion audit ----
    calibration_promotion_version: d.calibration?.version ?? null,
    calibration_promotion_history_pool: d.calibration?.historyPool ?? null,
    calibration_promotion_history_window: d.calibration?.historyWindow ?? null,
    calibration_promotion_history_count: d.calibration?.historyCount ?? null,
    calibration_promotion_history_ready: d.calibration?.historyReady ?? null,
    calibration_promotion_raw_direction: d.calibration?.rawDirection ?? null,
    calibration_promotion_history_start_ts: d.calibration?.historyStartTs ?? null,
    calibration_promotion_history_end_ts: d.calibration?.historyEndTs ?? null,
    calibration_promotion_history_as_of_ts: d.calibration?.historyAsOfTs ?? null,
    calibration_promotion_history_wins: d.calibration?.historyWins ?? null,
    calibration_promotion_history_losses: d.calibration?.historyLosses ?? null,
    calibration_promotion_expected_wins: d.calibration?.expectedWins ?? null,
    calibration_promotion_observed_win_rate: d.calibration?.observedWinRate ?? null,
    calibration_promotion_expected_win_rate: d.calibration?.expectedWinRate ?? null,
    calibration_promotion_variance: d.calibration?.variance ?? null,
    calibration_promotion_standard_deviation: d.calibration?.standardDeviation ?? null,
    calibration_promotion_residual_wins: d.calibration?.residualWins ?? null,
    calibration_promotion_z_score: d.calibration?.zScore ?? null,
    calibration_promotion_min_p_correct: d.calibration?.minPCorrect ?? null,
    calibration_promotion_min_z_score: d.calibration?.minZScore ?? null,
    calibration_promotion_history_ids_hash: d.calibration?.historyIdsHash ?? null,
    calibration_promotion_eligibility_reason: d.calibration?.eligibilityReason ?? null,
    calibration_promotion_condition_met: d.calibration?.conditionMet ?? null,
    calibration_promotion_candidate_before_brake: d.calibration?.candidateBeforeBrake ?? null,
    calibration_promotion_brake_vetoed: d.calibration?.brakeVetoed ?? null,
    calibration_promotion_published: d.calibration?.published ?? null,
    post_calibration_candidate: d.calibration?.postCalibrationCandidate ?? null,

    // ---- balanced saturation calibration audit (prediction time only) ----
    saturation_calibration_version: d.saturation?.version ?? null,
    saturation_window: d.saturation?.window ?? null,
    saturation_history_count: d.saturation?.historyCount ?? null,
    saturation_history_start_ts: d.saturation?.historyStartTs ?? null,
    saturation_history_end_ts: d.saturation?.historyEndTs ?? null,
    saturation_ready: d.saturation?.ready ?? null,
    saturation_current_raw_direction: d.saturation?.currentRawDirection ?? null,
    saturation_same_side_count: d.saturation?.sameSideCount ?? null,
    saturation_same_side_share: d.saturation?.sameSideShare ?? null,
    saturation_mean_aligned_confidence: d.saturation?.meanAlignedConfidence ?? null,
    saturation_index: d.saturation?.index ?? null,
    saturation_trigger_threshold: d.saturation?.triggerThreshold ?? null,
    saturation_cap_slope: d.saturation?.capSlope ?? null,
    saturation_min_confidence_cap: d.saturation?.minConfidenceCap ?? null,
    saturation_current_aligned_confidence: d.saturation?.currentAlignedConfidence ?? null,
    saturation_dynamic_confidence_cap: d.saturation?.dynamicConfidenceCap ?? null,
    saturation_regime_active: d.saturation?.regimeActive ?? null,
    saturation_candidate_before: d.saturation?.candidateBefore ?? null,
    saturation_candidate_source_before: d.saturation?.candidateSourceBefore ?? null,
    saturation_condition_met: d.saturation?.conditionMet ?? null,
    saturation_veto_fired: d.saturation?.vetoFired ?? null,
    saturation_candidate_after: d.saturation?.candidateAfter ?? null,
    saturation_reason: d.saturation?.reason ?? null,
    without_saturation_decision: d.saturation?.withoutSaturationDecision ?? null,
    without_saturation_direction: d.saturation?.withoutSaturationDirection ?? null,
    without_saturation_skip_reason: d.saturation?.withoutSaturationSkipReason ?? null,

    local_date: d.localDate,
    daily_net_before: d.dailyNetBefore,
    daily_resolved_trade_count_before: d.dailyResolvedTradeCountBefore,
    intraday_brake_active: d.intradayBrakeActive,
    intraday_brake_veto_fired: d.intradayBrakeVetoFired,
    final_prediction: d.finalPrediction,
    would_trade: d.wouldTrade,
    decision_reason: d.decisionReason,

    // ---- runtime-integrity audit identity ----
    implementation_revision: B4X4_IMPLEMENTATION_REVISION,
    revision_prospective_test_id: B4X4_REVISION_PROSPECTIVE_TEST_ID,
    revision_activated_at: B4X4_REVISION_ACTIVATED_AT,
    source_index_absolute: d.sourceIndexAbsolute,
    source_index_version: B4X4_SOURCE_INDEX_VERSION,
    source_epoch_ts: B4X4_SOURCE_EPOCH_TS,
    source_target_ts: ctx.candleTs,
    resolver_version: B4X4_RESOLVER_VERSION,
    canonical_candle_source: B4X4_CANONICAL_CANDLE_SOURCE,
    legacy_resolution_counter_unreliable: false,
    scheduler_invocation_id: ctx.schedulerInvocationId ?? null,
    catchup_target_ts: ctx.catchupTargetTs ?? null,
    operational_gap_status: ctx.operationalGapStatus ?? "NONE",
    operational_gap_reason: ctx.operationalGapReason ?? null,
  };
}


/**
 * Live B4x4 run. Never throws — any failure is persisted as an operational
 * abstention and returns null so the caller is never blocked.
 */
export async function runB4x4ForA2Combined(
  supabase: SupabaseClient,
  ctx: B4x4Context,
): Promise<DbRow | null> {
  const runStartedAt = new Date().toISOString();
  try {
    // Target-row protection across the whole version lineage: a target that
    // already has a B4x4 row (under any historical model_version) is never
    // re-predicted, so the version bump cannot duplicate a target.
    const { data: priorRow } = await supabase
      .from("b4x4_predictions")
      .select("*")
      .in("model_version", B4X4_MODEL_VERSIONS)
      .eq("target_candle_ts", ctx.candleTs)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (priorRow) {
      const existing = priorRow as unknown as DbRow;
      if (!ctx.deferShadowCapture) await captureB4x4ShadowForRow(supabase, existing);
      return existing;
    }

    const history = await loadHistory(supabase, ctx.candleTs);
    const daily = await loadDailyState(supabase, ctx.candleTs);
    const source: SourceRow = {
      candleTs: ctx.candleTs,
      probabilityGreen: ctx.probabilityGreen,
      timingStatus: ctx.timingStatus,
      leakageCheckPassed: ctx.leakageCheckPassed,
      actualDirection: null,
      runMode: ctx.runMode ?? "LIVE",
      operationalGapStatus: ctx.operationalGapStatus ?? "NONE",
    };
    const decision = evaluateB4x4(source, history, daily, {
      promotionEnabled:
        (ctx.runMode ?? "LIVE") === "LIVE" &&
        new Date(ctx.candleTs).getTime() >=
          new Date(CALIBRATION_PROMOTION_ACTIVATED_AT).getTime(),
    });
    const row = {
      ...decisionToRow(ctx, decision),
      run_started_at: runStartedAt,
      run_finished_at: new Date().toISOString(),
    };
    const { data, error } = await supabase
      .from("b4x4_predictions")
      .upsert(row as never, { onConflict: "target_candle_ts,model_version", ignoreDuplicates: true })
      .select("*")
      .maybeSingle();
    if (error) return null;
    let saved = (data as unknown as DbRow | null) ?? null;
    if (!saved) {
      // Target-row protection: an existing row for this target is never
      // overwritten, but it must still be returned so downstream shadow
      // capture and auditing run exactly once per target.
      const { data: existing } = await supabase
        .from("b4x4_predictions")
        .select("*")
        .in("model_version", B4X4_MODEL_VERSIONS)
        .eq("target_candle_ts", ctx.candleTs)
        .maybeSingle();
      saved = (existing as unknown as DbRow | null) ?? null;
    }
    // ---- Reporting-only policy shadows (never influence the active model). ----
    if (saved) {
      try {
        const { persistB4x4PolicyShadows } = await import("./shadow/policy-shadows.server");
        await persistB4x4PolicyShadows(supabase, saved, decision, history);
      } catch { /* reporting only */ }
    }

    // ---- Order-book shadow capture (shadow only, never blocks B4x4). ----
    if (!ctx.deferShadowCapture) await captureB4x4ShadowForRow(supabase, saved);
    return saved;

  } catch (e) {
    try {
      await supabase.from("api_runs").insert({
        run_type: "b4x4-error",
        response_payload: {
          error: e instanceof Error ? e.message : String(e),
          target_candle_ts: ctx.candleTs,
        },
        success: false,
        error_message: e instanceof Error ? e.message : String(e),
      });
    } catch { /* ignore */ }
    return null;
  }
}

/**
 * Master kill switch for B4x4 outbound directional webhooks.
 * Held OFF pending activation; engine, persistence, resolution, dashboard and
 * CSV logging are unaffected. Does not touch TD1/TD2 webhooks.
 */
// Held OFF for the b4x4-v1-runtime-integrity-r1 repair rollout.
export const B4X4_WEBHOOKS_ENABLED = true;

/** Emit the B4x4 directional webhook exactly once for a live published row. */
export async function maybeSendB4x4Webhook(
  supabase: SupabaseClient,
  row: DbRow | null,
): Promise<boolean> {
  try {
    if (!B4X4_WEBHOOKS_ENABLED) return false;
    if (!row) return false;
    if (row.run_mode !== "LIVE") return false;
    // final publish flag: the row must be an actually-published directional trade
    if (row.would_trade !== true) return false;
    if (row.final_prediction !== "GREEN" && row.final_prediction !== "RED") return false;
    if (row.webhook_eligible !== true) return false;
    if (row.webhook_sent_at) return false;
    // Hard activation-boundary gate: nothing before the approved boundary ships,
    // which also blocks BACKFILL / replay / catch-up / historical rows.
    const candleMs = new Date(String(row.target_candle_ts)).getTime();
    if (!Number.isFinite(candleMs)) return false;
    if (candleMs < new Date(B4X4_WEBHOOK_ACTIVATION_TS).getTime()) return false;


    // Claim the send atomically: only the first writer flips webhook_sent_at.
    const { data: claimed } = await supabase
      .from("b4x4_predictions")
      .update({ webhook_sent_at: new Date().toISOString() } as never)
      .eq("id", row.id as string)
      .is("webhook_sent_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) return false;
    const { deliverWebhook, buildB4x4WebhookPayload } = await import("../webhooks.server");
    await deliverWebhook(supabase, "prediction.created", buildB4x4WebhookPayload({ row }));
    return true;
  } catch {
    return false;
  }
}

/**
 * Order-book shadow capture for a persisted row. Shadow only: it runs strictly
 * after the prediction row (and its webhook) so its polling can never make a
 * prediction late, and every failure is swallowed.
 */
export async function captureB4x4ShadowForRow(
  supabase: SupabaseClient,
  saved: DbRow | null,
): Promise<void> {
  if (!saved || saved.run_mode !== "LIVE") return;
  try {
    const { persistB4x4Shadow } = await import("./shadow/persist.server");
    await persistB4x4Shadow(supabase, {
      id: String(saved.id),
      target_candle_ts: String(saved.target_candle_ts),
      run_mode: "LIVE",
      raw_direction: (saved.raw_direction as string | null) ?? null,
      final_prediction: (saved.final_prediction as string | null) ?? null,
      would_trade: saved.would_trade === true,
    });
  } catch { /* shadow only */ }
}

/** Idempotent resolution of the B4x4 row for a target candle. */
export async function resolveB4x4Row(
  supabase: SupabaseClient,
  targetCandleTs: string,
  actualDirection: ActualDirection,
  ohlc?: { open?: number | null; high?: number | null; low?: number | null; close?: number | null },
): Promise<void> {
  let rowId: string | null = null;
  try {
    // Atomically claim and count this genuine resolution attempt BEFORE any
    // scoring work. The DB function locks the row, skips already-resolved
    // rows, and increments resolution_attempt_count exactly once per attempt.
    const { data: begin, error: beginError } = await supabase.rpc(
      "b4x4_begin_resolution_attempt" as never,
      { p_target_candle_ts: targetCandleTs, p_model_version: B4X4_MODEL_VERSION } as never,
    );
    if (beginError) throw beginError;
    let claim = (begin ?? {}) as { found?: boolean; already_resolved?: boolean; id?: string; attempt_count?: number };
    if (!claim.found) {
      // legacy rows still carry an earlier model_version
      for (const mv of B4X4_MODEL_VERSIONS) {
        if (mv === B4X4_MODEL_VERSION) continue;
        const { data: legacy } = await supabase.rpc(
          "b4x4_begin_resolution_attempt" as never,
          { p_target_candle_ts: targetCandleTs, p_model_version: mv } as never,
        );
        const legacyClaim = (legacy ?? {}) as typeof claim;
        if (legacyClaim.found) { claim = legacyClaim; break; }
      }
    }
    if (!claim.found) return;
    if (claim.already_resolved) return; // idempotent
    rowId = claim.id ? String(claim.id) : null;
    const attempts = Number(claim.attempt_count ?? 1);

    const { data } = await supabase
      .from("b4x4_predictions")
      .select(
        "id, raw_direction, final_prediction, would_trade, base_candidate, core_eligible, " +
        "expansion_eligible, intraday_brake_veto_fired, resolved_at, resolution_attempt_count, " +
        "saturation_veto_fired, without_saturation_decision, without_saturation_direction",
      )
      .in("model_version", B4X4_MODEL_VERSIONS)
      .eq("target_candle_ts", targetCandleTs)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    const row = data as unknown as DbRow | null;
    if (!row) return;
    rowId = String(row.id);
    if (row.resolved_at) return; // idempotent


    const rawDir = (row.raw_direction as Direction | null) ?? null;
    const final = scoreAgainst((row.final_prediction as Direction | null) ?? null, actualDirection);
    const baseNoBrake = scoreAgainst(row.base_candidate === true ? rawDir : null, actualDirection);
    const coreOnly = scoreAgainst(row.core_eligible === true ? rawDir : null, actualDirection);
    const expansionOnly = scoreAgainst(row.expansion_eligible === true ? rawDir : null, actualDirection);
    const rawCf = scoreAgainst(rawDir, actualDirection);
    const attribution = brakeAttribution(
      row.would_trade === true,
      row.intraday_brake_veto_fired === true,
      row.base_candidate === true ? rawDir : null,
      actualDirection,
    );

    // ---- balanced saturation attribution (direct current-state, idempotent) ----
    const withoutSaturationWouldPublish = row.without_saturation_decision === "PUBLISH";
    const withoutSaturationScore = withoutSaturationWouldPublish
      ? scoreAgainst(
          (row.without_saturation_direction as Direction | null) ?? null,
          actualDirection,
        ).score
      : null;
    const saturationAttr = saturationAttribution(
      row.saturation_veto_fired === true,
      withoutSaturationWouldPublish,
      withoutSaturationScore,
    );


    await supabase
      .from("b4x4_predictions")
      .update({
        actual_open: ohlc?.open ?? null,
        actual_high: ohlc?.high ?? null,
        actual_low: ohlc?.low ?? null,
        actual_close: ohlc?.close ?? null,
        actual_direction: actualDirection,
        result: row.would_trade === true ? (final.result ?? "PUSH") : "PUSH",
        result_score: row.would_trade === true ? final.score : 0,
        resolved_at: new Date().toISOString(),
        resolution_attempt_count: attempts,
        last_resolution_attempt_at: new Date().toISOString(),
        last_resolution_error: null,
        resolver_version: B4X4_RESOLVER_VERSION,
        legacy_resolution_counter_unreliable: false,
        raw_a2_counterfactual_result: rawCf.result,
        core_only_counterfactual_trade: row.core_eligible === true,
        core_only_counterfactual_score: coreOnly.score,
        expansion_only_counterfactual_trade: row.expansion_eligible === true,
        expansion_only_counterfactual_score: expansionOnly.score,
        base_no_brake_counterfactual_trade: row.base_candidate === true,
        base_no_brake_counterfactual_score: baseNoBrake.score,
        brake_attribution_class: attribution.klass,
        brake_incremental_value: attribution.value,
        without_saturation_score: withoutSaturationScore,
        saturation_attribution_class: saturationAttr.klass,
        saturation_incremental_value: saturationAttr.value,
        saturation_incremental_change: saturationAttr.incrementalChange,
      } as never)
      .eq("id", row.id as string)
      .is("resolved_at", null);

    // ---- Order-book shadow attribution (never blocks resolution). ----
    try {
      const { resolveB4x4ShadowRow } = await import("./shadow/persist.server");
      await resolveB4x4ShadowRow(supabase, targetCandleTs, actualDirection, {
        result: row.would_trade === true ? (final.result ?? "PUSH") : "PUSH",
        result_score: row.would_trade === true ? final.score : 0,
        raw_direction: rawDir,
        would_trade: row.would_trade === true,
      });
    } catch { /* shadow only */ }

    // ---- Reporting-only policy shadows (independent scoring). ----
    try {
      const { resolveB4x4PolicyShadows } = await import("./shadow/policy-shadows.server");
      await resolveB4x4PolicyShadows(supabase, targetCandleTs, actualDirection);
    } catch { /* reporting only */ }
  } catch (e) {
    // Record the failed attempt so resolution health is auditable.
    try {
      if (rowId) {
        await supabase
          .from("b4x4_predictions")
          .update({
            last_resolution_attempt_at: new Date().toISOString(),
            last_resolution_error: e instanceof Error ? e.message : String(e),
            resolver_version: B4X4_RESOLVER_VERSION,
          } as never)
          .eq("id", rowId)
          .is("resolved_at", null);
      }
    } catch { /* never block the resolver */ }
  }
}


/**
 * Catch-up pass: create the missing B4x4 row for any canonical source target
 * that was never evaluated (missed scheduler run, deploy, outage).
 *
 * Catch-up rows are audit rows: they are marked with the gap status, are never
 * webhook-eligible, and are written with `ignoreDuplicates` so no existing
 * historical row is ever mutated.
 */
export async function catchUpMissingB4x4Rows(
  supabase: SupabaseClient,
  opts: { lookbackTargets?: number; schedulerInvocationId?: string | null } = {},
): Promise<{ checked: number; created: number; targets: string[] }> {
  const lookback = opts.lookbackTargets ?? 96;
  try {
    const { loadCanonicalSourceRows } = await import("./backfill");
    const { replayB4x4 } = await import("./engine");
    const all = await loadCanonicalSourceRows(supabase);
    if (!all.length) return { checked: 0, created: 0, targets: [] };

    const recent = all.slice(-lookback);
    const { data: existingRows, error: existingError } = await supabase
      .from("b4x4_predictions")
      .select("target_candle_ts")
      .in("model_version", B4X4_MODEL_VERSIONS)
      .gte("target_candle_ts", recent[0]!.candleTs);
    if (existingError) throw new Error(`b4x4_catchup_existing:${existingError.message}`);
    const have = new Set(
      ((existingRows ?? []) as unknown as DbRow[]).map((r) =>
        new Date(String(r.target_candle_ts)).toISOString(),
      ),
    );
    const missing = recent.filter((r) => !have.has(r.candleTs));
    if (!missing.length) return { checked: recent.length, created: 0, targets: [] };

    // Replay the full stream so every catch-up row keeps the absolute window.
    const results = replayB4x4(all);
    const byTs = new Map(results.map((r) => [r.row.candleTs, r]));
    const rows: DbRow[] = [];
    for (const src of missing) {
      const r = byTs.get(src.candleTs);
      if (!r) continue;
      const row = decisionToRow(
        {
          predictionId: src.predictionId ?? "",
          candleTs: src.candleTs,
          a2RowId: src.sourceRowId,
          probabilityGreen: src.probabilityGreen,
          timingStatus: src.timingStatus,
          leakageCheckPassed: src.leakageCheckPassed,
          a2ModelFitId: src.a2ModelFitId,
          a2ProductionModelVersion: src.a2ProductionModelVersion,
          runMode: "LIVE",
          schedulerInvocationId: opts.schedulerInvocationId ?? null,
          catchupTargetTs: src.candleTs,
          operationalGapStatus: "CATCHUP",
          operationalGapReason: "MISSING_SCHEDULED_RUN",
        },
        r.decision,
      );
      row.webhook_eligible = false;
      row.catchup_resolution_status = "CATCHUP_CREATED";
      row.catchup_completed_at = new Date().toISOString();
      row.watchdog_detected_at = new Date().toISOString();
      rows.push(row);
    }
    if (!rows.length) return { checked: recent.length, created: 0, targets: [] };

    const { error } = await supabase
      .from("b4x4_predictions")
      .upsert(rows as never, {
        onConflict: "target_candle_ts,model_version",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(`b4x4_catchup_upsert:${error.message}`);
    return {
      checked: recent.length,
      created: rows.length,
      targets: rows.map((r) => String(r.target_candle_ts)),
    };
  } catch (error) {
    console.error("b4x4 catch-up failed", error);
    return { checked: 0, created: 0, targets: [] };
  }
}
