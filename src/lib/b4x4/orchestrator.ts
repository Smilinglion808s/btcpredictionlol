// B4x4 orchestrator — live prediction path, persistence, webhook and resolution.
//
// Runs AFTER A2_Combined has produced its canonical prediction-time
// probability. Reads A2 as immutable input, writes only to b4x4_predictions.
// Never blocks or mutates any other model.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  B4X4_MODEL_NAME,
  B4X4_MODEL_VERSION,
  B4X4_PROSPECTIVE_TEST_ID,
  B4X4_SOURCE_VARIANT,
  B4X4_VARIANT,
  GRID_TRAINING_LOOKBACK,
  b4x4ConfigHash,
  b4x4LocalDate,
} from "./config";
import {
  brakeAttribution,
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
}

type DbRow = Record<string, unknown>;

/** Load prior ranked B4x4 rows (own persisted rank/grid audit) as history. */
export async function loadHistory(
  supabase: SupabaseClient,
  beforeCandleTs: string,
): Promise<HistoryEntry[]> {
  const { data } = await supabase
    .from("b4x4_predictions")
    .select(
      "target_candle_ts, confidence, raw_direction, global_rank, same_side_rank, " +
      "global_rank_quartile, same_side_rank_quartile, quality_mean, actual_direction, data_valid",
    )
    .eq("model_version", B4X4_MODEL_VERSION)
    .eq("data_valid", true)
    .lt("target_candle_ts", beforeCandleTs)
    .order("target_candle_ts", { ascending: false })
    .limit(HISTORY_FETCH);
  const rows = ((data ?? []) as unknown as DbRow[]).slice().reverse();
  const out: HistoryEntry[] = [];
  for (const r of rows) {
    const dir = r.raw_direction as Direction | null;
    const conf = r.confidence == null ? null : Number(r.confidence);
    if (dir !== "GREEN" && dir !== "RED") continue;
    if (conf == null || !Number.isFinite(conf)) continue;
    const actual = (r.actual_direction as ActualDirection | null) ?? null;
    out.push({
      candleTs: String(r.target_candle_ts),
      confidence: conf,
      direction: dir,
      globalRank: r.global_rank == null ? null : Number(r.global_rank),
      sameSideRank: r.same_side_rank == null ? null : Number(r.same_side_rank),
      globalQuartile: r.global_rank_quartile == null ? null : Number(r.global_rank_quartile),
      sameSideQuartile: r.same_side_rank_quartile == null ? null : Number(r.same_side_rank_quartile),
      qualityMean: r.quality_mean == null ? null : Number(r.quality_mean),
      actualDirection: actual,
      correct: actual === "GREEN" || actual === "RED" ? dir === actual : null,
    });
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
    .eq("model_version", B4X4_MODEL_VERSION)
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
  return {
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
    same_side_rank: d.sameSideRank,
    same_side_history_count: d.sameSideHistoryCount,
    same_side_history_start_ts: d.sameSideHistoryStartTs,
    same_side_history_end_ts: d.sameSideHistoryEndTs,
    global_rank_quartile: d.globalRankQuartile,
    same_side_rank_quartile: d.sameSideRankQuartile,
    quality_mean: d.qualityMean,

    grid_training_lookback: GRID_TRAINING_LOOKBACK,
    grid_training_resolved_count: d.gridTrainingResolvedCount,
    grid_training_start_ts: d.gridTrainingStartTs,
    grid_training_end_ts: d.gridTrainingEndTs,
    grid_prior_alpha: 8,
    grid_prior_beta: 8,
    grid_cell: d.gridCell,
    grid_cell_resolved_count: d.gridCellResolvedCount,
    grid_cell_wins: d.gridCellWins,
    grid_cell_losses: d.gridCellLosses,
    p_correct: d.pCorrect,
    grid_reference_count: d.gridReferenceCount,
    grid_quality_percentile: d.gridQualityPercentile,
    grid_snapshot_json: d.gridSnapshot,

    core_eligible: d.coreEligible,
    expansion_eligible: d.expansionEligible,
    base_candidate: d.baseCandidate,
    selected_route: d.selectedRoute,
    local_date: d.localDate,
    daily_net_before: d.dailyNetBefore,
    daily_resolved_trade_count_before: d.dailyResolvedTradeCountBefore,
    intraday_brake_active: d.intradayBrakeActive,
    intraday_brake_veto_fired: d.intradayBrakeVetoFired,
    final_prediction: d.finalPrediction,
    would_trade: d.wouldTrade,
    decision_reason: d.decisionReason,
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
  try {
    const history = await loadHistory(supabase, ctx.candleTs);
    const daily = await loadDailyState(supabase, ctx.candleTs);
    const source: SourceRow = {
      candleTs: ctx.candleTs,
      probabilityGreen: ctx.probabilityGreen,
      timingStatus: ctx.timingStatus,
      leakageCheckPassed: ctx.leakageCheckPassed,
      actualDirection: null,
    };
    const decision = evaluateB4x4(source, history, daily);
    const row = decisionToRow(ctx, decision);
    const { data, error } = await supabase
      .from("b4x4_predictions")
      .upsert(row as never, { onConflict: "target_candle_ts,model_version", ignoreDuplicates: true })
      .select("*")
      .maybeSingle();
    if (error) return null;
    const saved = (data as unknown as DbRow | null) ?? null;
    // ---- Order-book shadow capture (shadow only, never blocks B4x4). ----
    if (saved && saved.run_mode === "LIVE") {
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

/** Idempotent resolution of the B4x4 row for a target candle. */
export async function resolveB4x4Row(
  supabase: SupabaseClient,
  targetCandleTs: string,
  actualDirection: ActualDirection,
  ohlc?: { open?: number | null; high?: number | null; low?: number | null; close?: number | null },
): Promise<void> {
  try {
    const { data } = await supabase
      .from("b4x4_predictions")
      .select(
        "id, raw_direction, final_prediction, would_trade, base_candidate, core_eligible, " +
        "expansion_eligible, intraday_brake_veto_fired, resolved_at",
      )
      .eq("model_version", B4X4_MODEL_VERSION)
      .eq("target_candle_ts", targetCandleTs)
      .maybeSingle();
    const row = data as unknown as DbRow | null;
    if (!row) return;
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
        last_resolution_attempt_at: new Date().toISOString(),
        last_resolution_error: null,
        raw_a2_counterfactual_result: rawCf.result,
        core_only_counterfactual_trade: row.core_eligible === true,
        core_only_counterfactual_score: coreOnly.score,
        expansion_only_counterfactual_trade: row.expansion_eligible === true,
        expansion_only_counterfactual_score: expansionOnly.score,
        base_no_brake_counterfactual_trade: row.base_candidate === true,
        base_no_brake_counterfactual_score: baseNoBrake.score,
        brake_attribution_class: attribution.klass,
        brake_incremental_value: attribution.value,
      } as never)
      .eq("id", row.id as string)
      .is("resolved_at", null);

    // ---- Shadow attribution (never blocks resolution). ----
    try {
      const { resolveB4x4ShadowRow } = await import("./shadow/persist.server");
      await resolveB4x4ShadowRow(supabase, targetCandleTs, actualDirection, {
        result: row.would_trade === true ? (final.result ?? "PUSH") : "PUSH",
        result_score: row.would_trade === true ? final.score : 0,
        raw_direction: rawDir,
        would_trade: row.would_trade === true,
      });
    } catch { /* shadow only */ }
  } catch { /* never block the resolver */ }
}
