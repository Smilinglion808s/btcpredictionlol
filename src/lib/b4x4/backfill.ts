// B4x4 historical backfill — chronological, webhook-free reproducibility run.
//
// Live operation queries the canonical A2 persistence path directly; this
// module replays that same canonical path (model7_shadow variant A2_Combined
// joined to its production prediction row for ground truth) from oldest to
// newest. Backfilled rows are written with run_mode=BACKFILL and
// webhook_eligible=false and can never emit a webhook.

import type { SupabaseClient } from "@supabase/supabase-js";
import { B4X4_MODEL_VERSION, B4X4_SOURCE_EPOCH_TS, B4X4_SOURCE_VARIANT, b4x4LocalDate } from "./config";
import { replayB4x4, brakeAttribution, type ActualDirection, type SourceRow } from "./engine";
import { decisionToRow } from "./orchestrator";

type DbRow = Record<string, unknown>;

export interface BackfillSourceRow extends SourceRow {
  sourceRowId: string | null;
  predictionId: string | null;
  a2ModelFitId: string | null;
  a2ProductionModelVersion: string | null;
  createdAt: string | null;
}

/** Load every canonical A2_Combined observation, deduplicated by target candle. */
export async function loadCanonicalSourceRows(
  supabase: SupabaseClient,
  opts: { from?: string; upTo?: string } = {},
): Promise<BackfillSourceRow[]> {
  const page = 1000;
  let from = 0;
  const collected: DbRow[] = [];
  for (;;) {
    let q = supabase
      .from("model7_shadow")
      .select(
        "id, prediction_id, candle_ts, probability_green, timing_status, leakage_check_passed, " +
        "model_fit_id, created_at",
      )
      .eq("variant", B4X4_SOURCE_VARIANT)
      .order("candle_ts", { ascending: true })
      .range(from, from + page - 1);
    q = q.gte("candle_ts", B4X4_SOURCE_EPOCH_TS);
    if (opts.from) q = q.gte("candle_ts", opts.from);
    if (opts.upTo) q = q.lte("candle_ts", opts.upTo);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as unknown as DbRow[];
    collected.push(...rows);
    if (rows.length < page) break;
    from += page;
  }

  // Do not join predictions through PostgREST here. The live path previously
  // made Postgres perform one indexed predictions lookup per shadow row; with
  // the full canonical stream that regularly crossed statement_timeout and
  // prevented B4x4 from publishing. Fetch the narrow source stream first, then
  // resolve its outcomes in bounded primary-key batches.
  const predictionIds = [
    ...new Set(
      collected
        .map((row) => String(row.prediction_id ?? ""))
        .filter((id) => id.length > 0),
    ),
  ];
  const predictionsById = new Map<
    string,
    { actual_direction?: string | null; model_version?: string | null }
  >();
  // Keep the generated PostgREST URL comfortably below proxy/request limits.
  const predictionBatchSize = 100;
  for (let i = 0; i < predictionIds.length; i += predictionBatchSize) {
    const ids = predictionIds.slice(i, i + predictionBatchSize);
    const { data, error } = await supabase
      .from("predictions")
      .select("id, actual_direction, model_version")
      .in("id", ids);
    if (error) throw new Error(error.message);
    for (const prediction of (data ?? []) as Array<Record<string, unknown>>) {
      predictionsById.set(String(prediction.id), {
        actual_direction: prediction.actual_direction as string | null,
        model_version: prediction.model_version as string | null,
      });
    }
  }

  // Deduplicate by target candle, keeping the most recently created row.
  const byTs = new Map<string, DbRow>();
  for (const r of collected) {
    const ts = new Date(String(r.candle_ts)).toISOString();
    const prev = byTs.get(ts);
    if (!prev || String(r.created_at ?? "") >= String(prev.created_at ?? "")) byTs.set(ts, r);
  }

  const out: BackfillSourceRow[] = [];
  for (const ts of [...byTs.keys()].sort()) {
    const r = byTs.get(ts);
    if (!r) continue;
    const pred = predictionsById.get(String(r.prediction_id ?? "")) ?? {};
    const p = r.probability_green == null ? null : Number(r.probability_green);
    // Only rows that passed timing and leakage checks are valid source rows.
    if (p == null || !Number.isFinite(p) || p < 0 || p > 1) continue;
    if (r.timing_status !== "ON_TIME") continue;
    if (r.leakage_check_passed !== true) continue;
    const actual = pred.actual_direction;
    out.push({
      candleTs: ts,
      probabilityGreen: p,
      timingStatus: "ON_TIME",
      leakageCheckPassed: true,
      actualDirection:
        actual === "GREEN" || actual === "RED" ? (actual as ActualDirection) : null,
      sourceRowId: (r.id as string | null) ?? null,
      predictionId: (r.prediction_id as string | null) ?? null,
      a2ModelFitId: (r.model_fit_id as string | null) ?? null,
      a2ProductionModelVersion: pred.model_version ?? null,
      createdAt: (r.created_at as string | null) ?? null,
    });
  }
  return out;
}

export interface BackfillSummary {
  validSourceRows: number;
  evaluableRows: number;
  trades: number;
  wins: number;
  losses: number;
  pushes: number;
  net: number;
  coveragePct: number;
  winRatePct: number;
  maxDrawdown: number;
  negativeLocalDays: number;
  worstLocalDay: number;
  dailyNets: Record<string, number>;
  firstPublishedTs: string | null;
}

export function summarize(
  results: ReturnType<typeof replayB4x4>,
): BackfillSummary {
  let trades = 0, wins = 0, losses = 0, pushes = 0, net = 0, evaluable = 0;
  let peak = 0, running = 0, maxDd = 0;
  let firstPublishedTs: string | null = null;
  const dailyNets: Record<string, number> = {};
  for (const r of results) {
    const operational =
      r.decision.decisionReason.startsWith("ABSTAIN_WARMUP") ||
      r.decision.decisionReason === "ABSTAIN_GRID_REFERENCE_INVALID" ||
      r.decision.decisionReason === "ABSTAIN_SOURCE_HISTORY_INVALID" ||
      r.decision.decisionReason === "ABSTAIN_A2_PROBABILITY_INVALID" ||
      r.decision.decisionReason === "ABSTAIN_A2_TIMING_INVALID" ||
      r.decision.decisionReason === "ABSTAIN_A2_LEAKAGE_INVALID" ||
      r.decision.decisionReason === "ABSTAIN_INTERNAL_ERROR";
    // Evaluable = warm-ready AND resolved (unresolved outcomes are excluded).
    if (!operational && r.row.actualDirection != null) evaluable++;
    if (!r.decision.wouldTrade) continue;

    trades++;
    if (firstPublishedTs == null) firstPublishedTs = r.row.candleTs;
    if (r.result === "WIN") wins++;
    else if (r.result === "LOSS") losses++;
    else pushes++;
    net += r.resultScore;
    running += r.resultScore;
    peak = Math.max(peak, running);
    maxDd = Math.max(maxDd, peak - running);
    const d = b4x4LocalDate(r.row.candleTs);
    dailyNets[d] = (dailyNets[d] ?? 0) + r.resultScore;
  }
  const days = Object.values(dailyNets);
  return {
    validSourceRows: results.length,
    evaluableRows: evaluable,
    trades, wins, losses, pushes, net,
    coveragePct: evaluable ? (trades / evaluable) * 100 : 0,
    winRatePct: wins + losses ? (wins / (wins + losses)) * 100 : 0,
    maxDrawdown: maxDd,
    negativeLocalDays: days.filter((v) => v < 0).length,
    worstLocalDay: days.length ? Math.min(...days) : 0,
    dailyNets,
    firstPublishedTs,
  };
}

/**
 * Replay and persist the full B4x4 history. Existing rows for a target candle
 * are left untouched (unique on target_candle_ts + model_version), so live rows
 * are never overwritten by a backfill.
 */
export async function runB4x4Backfill(
  supabase: SupabaseClient,
  opts: { from?: string; upTo?: string; persist?: boolean } = {},
): Promise<{ summary: BackfillSummary; persisted: number }> {
  const source = await loadCanonicalSourceRows(supabase, opts);
  const results = replayB4x4(source);
  const summary = summarize(results);
  if (opts.persist === false) return { summary, persisted: 0 };

  const rows: DbRow[] = results.map((r) => {
    const src = r.row as BackfillSourceRow;
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
        runMode: "BACKFILL",
      },
      r.decision,
    );
    row.webhook_eligible = false;
    if (src.actualDirection) {
      const attribution = brakeAttribution(
        r.decision.wouldTrade,
        r.decision.intradayBrakeVetoFired,
        r.decision.baseCandidate ? r.decision.rawDirection : null,
        src.actualDirection,
      );
      row.actual_direction = src.actualDirection;
      row.result = r.decision.wouldTrade ? (r.result ?? "PUSH") : "PUSH";
      row.result_score = r.decision.wouldTrade ? r.resultScore : 0;
      row.resolved_at = new Date().toISOString();
      row.raw_a2_counterfactual_result =
        r.decision.rawDirection === src.actualDirection ? "WIN" : "LOSS";
      row.core_only_counterfactual_trade = r.decision.coreEligible;
      row.core_only_counterfactual_score = r.coreOnlyScore;
      row.expansion_only_counterfactual_trade = r.decision.expansionEligible;
      row.expansion_only_counterfactual_score = r.expansionOnlyScore;
      row.base_no_brake_counterfactual_trade = r.decision.baseCandidate;
      row.base_no_brake_counterfactual_score = r.baseNoBrakeScore;
      row.brake_attribution_class = attribution.klass;
      row.brake_incremental_value = attribution.value;
    }
    return row;
  });

  let persisted = 0;
  const chunk = 200;
  for (let i = 0; i < rows.length; i += chunk) {
    const slice = rows.slice(i, i + chunk);
    const { error } = await supabase
      .from("b4x4_predictions")
      .upsert(slice as never, {
        onConflict: "target_candle_ts,model_version",
        ignoreDuplicates: true,
      });
    if (error) throw new Error(error.message);
    persisted += slice.length;
  }
  void B4X4_MODEL_VERSION;
  return { summary, persisted };
}
