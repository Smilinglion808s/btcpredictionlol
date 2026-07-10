// Model 7 Shadow — orchestrator called after each production insert.
// Runs Variant A (frozen v1.1), Variant B (latest live-retrained fit), and
// Variant B2 (same fit as B with upstream_no_clear_edge override removed).
//
// STRICT BOUNDARY-TIMED SCORING (leakage-safe):
//   - Never scores before target_boundary_ts + 1500ms (score_not_before_ts).
//   - Any candle with open_ts >= target_boundary_ts is rejected.
//   - Post-wait clock is re-read; early-wake blocks scoring (fail-closed).
//   - The previous candle (target - 15m) must be present and unique; else block.
//   - History gaps or missing lineage → fail-closed, no prediction emitted.
//
// Never blocks production: every step is wrapped in try/catch and errors are
// logged to model7_shadow.shadow_error / api_runs.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { buildFeatureMap, type Candle, type PredictionRow } from "./featurize";
import { scoreFeatureMap, type ModelFit } from "./scorer";
import { loadFrozenModel, loadLatestVariantBFit } from "./fitStore";

const HISTORY_DEPTH_CANDLES = 24;
const TF_MS = 15 * 60 * 1000;
// Target: score AT or immediately AFTER the target-candle boundary.
export const SCORE_NOT_BEFORE_DELAY_MS = 1500;
// Bounded per-sleep cap so a worker never blocks longer than this at once.
const SLEEP_CAP_MS = 25_000;
// Hard ceiling on total wait; beyond this we refuse to score in this call.
const MAX_TOTAL_WAIT_MS = 90_000;

const RAW_NUMERIC_FIELDS = [
  "confidence", "input_candle_age_seconds", "current_partial_minutes_elapsed",
  "btc_price_at_prediction",
  "partial_completeness", "partial_close_position_pct", "partial_range_vs_atr",
  "partial_module_bull_pts", "partial_module_bear_pts",
] as const;

function sha256Hex(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function fitArtifactHash(fit: ModelFit): string {
  return sha256Hex(JSON.stringify({
    fo: fit.feature_order, mu: fit.feature_means, sc: fit.feature_scales,
    co: fit.coefficients, b: fit.intercept,
  }));
}

// ---------- Timing plan (pure, testable) ----------
export interface TimingPlan {
  target_boundary_ms: number;
  score_not_before_ms: number;
  feature_cutoff_ms: number;   // target_boundary_ms - 1
  previous_candle_ms: number;  // target_boundary_ms - 15m
}
export function computeTimingPlan(candleTsIso: string): TimingPlan {
  const target = new Date(candleTsIso).getTime();
  return {
    target_boundary_ms: target,
    score_not_before_ms: target + SCORE_NOT_BEFORE_DELAY_MS,
    feature_cutoff_ms: target - 1,
    previous_candle_ms: target - TF_MS,
  };
}

// ---------- Bounded-wait timing enforcement ----------
// Loops with capped sleeps until score_not_before or max total wait elapses.
// Never returns "early" — always re-reads the wall clock after each sleep.
// Returns whether we actually reached the safe-score window.
export async function waitUntilScoreable(plan: TimingPlan, opts?: {
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  maxTotalMs?: number;
}): Promise<{ reached: boolean; waited_ms: number }> {
  const now = opts?.now ?? (() => Date.now());
  const sleep = opts?.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const maxTotal = opts?.maxTotalMs ?? MAX_TOTAL_WAIT_MS;
  const start = now();
  while (true) {
    const t = now();
    const remaining = plan.score_not_before_ms - t;
    if (remaining <= 0) return { reached: true, waited_ms: t - start };
    if (t - start >= maxTotal) return { reached: false, waited_ms: t - start };
    const step = Math.min(remaining, SLEEP_CAP_MS, maxTotal - (t - start));
    if (step <= 0) return { reached: false, waited_ms: t - start };
    await sleep(step);
  }
}

// ---------- Leakage inspection (pure, testable) ----------
export interface LeakageReport {
  passed: boolean;
  reason?: string;                       // e.g. TARGET_CANDLE_LEAKAGE_BLOCKED
  offending_features: Array<{ feature: string; ts: string }>;
  latest_source_candle_ms: number | null;
  latest_source_event_ms: number | null;
  previous_candle_present: boolean;
  history_gap_encountered: boolean;
}

// Runtime integrity check for the previous candle's OHLC. Cheap invariants
// that a malformed / partial / stale row cannot satisfy:
//   - all four values finite and > 0
//   - high >= max(open, close)
//   - low  <= min(open, close)
//   - high >= low
export function checkCandleIntegrity(c: Candle): { ok: boolean; reason?: string } {
  const { open, high, low, close } = c;
  for (const [n, v] of [["open", open], ["high", high], ["low", low], ["close", close]] as const) {
    if (!Number.isFinite(v) || (v as number) <= 0) return { ok: false, reason: `${n}_invalid` };
  }
  if (high < Math.max(open, close)) return { ok: false, reason: "high_lt_max_open_close" };
  if (low > Math.min(open, close)) return { ok: false, reason: "low_gt_min_open_close" };
  if (high < low) return { ok: false, reason: "high_lt_low" };
  return { ok: true };
}

export function inspectHistoryLeakage(
  plan: TimingPlan,
  history: Candle[],
): LeakageReport {
  const offending: Array<{ feature: string; ts: string }> = [];
  let latestCandle: number | null = null;
  let previousPresent = false;
  let previousCandle: Candle | null = null;
  let gap = false;

  for (const c of history) {
    const ms = new Date(c.candle_ts).getTime();
    if (!Number.isFinite(ms)) {
      offending.push({ feature: "history_candle_ts_invalid", ts: String(c.candle_ts) });
      continue;
    }
    if (ms >= plan.target_boundary_ms) {
      offending.push({ feature: `history_candle_open_ts:${c.candle_ts}`, ts: c.candle_ts });
      continue;
    }
    if (ms === plan.previous_candle_ms) { previousPresent = true; previousCandle = c; }
    if (latestCandle === null || ms > latestCandle) latestCandle = ms;
  }
  for (let i = 0; i < history.length - 1; i++) {
    const a = new Date(history[i].candle_ts).getTime();
    const b = new Date(history[i + 1].candle_ts).getTime();
    if (a - b !== TF_MS) { gap = true; break; }
  }

  if (offending.length > 0) {
    return {
      passed: false, reason: "TARGET_CANDLE_LEAKAGE_BLOCKED",
      offending_features: offending, latest_source_candle_ms: latestCandle,
      latest_source_event_ms: latestCandle, previous_candle_present: previousPresent,
      history_gap_encountered: gap,
    };
  }
  if (!previousPresent || !previousCandle) {
    return {
      passed: false, reason: "PREVIOUS_CANDLE_NOT_FINALIZED",
      offending_features: [{ feature: "previous_candle_missing", ts: new Date(plan.previous_candle_ms).toISOString() }],
      latest_source_candle_ms: latestCandle, latest_source_event_ms: latestCandle,
      previous_candle_present: false, history_gap_encountered: gap,
    };
  }
  const integrity = checkCandleIntegrity(previousCandle);
  if (!integrity.ok) {
    return {
      passed: false, reason: "PREVIOUS_CANDLE_NOT_FINALIZED",
      offending_features: [{ feature: `previous_candle_ohlc:${integrity.reason}`, ts: previousCandle.candle_ts }],
      latest_source_candle_ms: latestCandle, latest_source_event_ms: latestCandle,
      previous_candle_present: true, history_gap_encountered: gap,
    };
  }
  return {
    passed: true, offending_features: [],
    latest_source_candle_ms: latestCandle, latest_source_event_ms: latestCandle,
    previous_candle_present: true, history_gap_encountered: gap,
  };
}

function missingRawNumericFields(row: PredictionRow): string[] {
  const missing: string[] = [];
  for (const k of RAW_NUMERIC_FIELDS) {
    const v = (row as unknown as Record<string, unknown>)[k];
    if (v === null || v === undefined) missing.push(k);
  }
  return missing;
}

async function loadHistoricalCandles(
  supabase: SupabaseClient,
  beforeTs: string,
): Promise<Candle[]> {
  // Strict inequality — never returns a candle at or after the target boundary.
  const { data } = await supabase
    .from("candles")
    .select("candle_ts,open,high,low,close,volume")
    .eq("symbol", "BTC-USDT").eq("timeframe", "15m")
    .lt("candle_ts", beforeTs)
    .order("candle_ts", { ascending: false })
    .limit(HISTORY_DEPTH_CANDLES);
  return (data ?? []).map((c) => ({
    candle_ts: c.candle_ts as string,
    open: Number(c.open), high: Number(c.high),
    low: Number(c.low), close: Number(c.close),
    volume: c.volume === null ? null : Number(c.volume),
  }));
}

async function insertShadowRow(
  supabase: SupabaseClient,
  base: Record<string, unknown>,
) {
  await supabase.from("model7_shadow").insert(base as never);
}

async function runVariant(
  supabase: SupabaseClient,
  variant: "A" | "B" | "B2",
  fit: ModelFit | null,
  row: PredictionRow & { id: string; candle_ts: string; model_version?: string | null },
  history: Candle[],
  plan: TimingPlan,
  leakage: LeakageReport,
  reasonIfNoFit?: string,
  scoreOptions?: { skipUpstreamNoClearEdge?: boolean },
) {
  const baseRow: Record<string, unknown> = {
    prediction_id: row.id,
    candle_ts: row.candle_ts,
    variant,
    production_model_version: row.model_version ?? null,
    status: "pending",
    target_boundary_ts: new Date(plan.target_boundary_ms).toISOString(),
    score_not_before_ts: new Date(plan.score_not_before_ms).toISOString(),
    feature_cutoff_ts: new Date(plan.feature_cutoff_ms).toISOString(),
    previous_candle_ts: new Date(plan.previous_candle_ms).toISOString(),
    history_candles_available: history.length,
    history_gap_encountered: leakage.history_gap_encountered,
    latest_source_candle_ts: leakage.latest_source_candle_ms
      ? new Date(leakage.latest_source_candle_ms).toISOString() : null,
    latest_source_event_ts: leakage.latest_source_event_ms
      ? new Date(leakage.latest_source_event_ms).toISOString() : null,
    missing_raw_numeric_fields_json: missingRawNumericFields(row),
  };

  if (!fit) {
    await insertShadowRow(supabase, {
      ...baseRow, status: "skipped",
      model_fit_id: reasonIfNoFit ?? "no_fit",
      shadow_error: reasonIfNoFit ?? "no_fit",
      timing_status: "SOURCE_TIMESTAMP_UNKNOWN",
      leakage_check_passed: false,
      leakage_block_reason: reasonIfNoFit ?? "no_fit",
    });
    return;
  }
  if (!leakage.passed) {
    await insertShadowRow(supabase, {
      ...baseRow, status: "skipped",
      model_fit_id: fit.model_fit_id,
      shadow_error: leakage.reason,
      timing_status: leakage.reason ?? "TARGET_CANDLE_LEAKAGE_BLOCKED",
      leakage_check_passed: false,
      leakage_block_reason: leakage.reason,
      offending_features_json: leakage.offending_features,
    });
    return;
  }
  try {
    const { feature_map, categoricals } = buildFeatureMap(row, history);
    const res = scoreFeatureMap(feature_map, categoricals, fit, {
      prediction: row.prediction,
      market_condition: row.market_condition,
      failed_breakout_down: row.failed_breakout_down ?? (row.indicators as Record<string, unknown> | null | undefined)?.failedBreakoutDown,
    }, scoreOptions);

    const scoredAt = new Date();
    const scoredMs = scoredAt.getTime();
    const boundaryDeltaMs = scoredMs - plan.target_boundary_ms;
    // Fail-closed: post-wait clock must be at or after score_not_before.
    if (scoredMs < plan.score_not_before_ms) {
      await insertShadowRow(supabase, {
        ...baseRow, status: "skipped",
        model_fit_id: fit.model_fit_id,
        shadow_error: "EARLY_SCORING_BLOCKED",
        timing_status: "EARLY_SCORING_BLOCKED",
        leakage_check_passed: false,
        leakage_block_reason: "EARLY_SCORING_BLOCKED",
        scored_at: scoredAt.toISOString(),
        boundary_delta_ms: boundaryDeltaMs,
      });
      return;
    }

    const artifactHash = fitArtifactHash(fit);
    const featureVectorHash = sha256Hex(JSON.stringify(res.standardized_vector));
    const timingStatus =
      boundaryDeltaMs > 10_000 ? "LATE_WARNING" : "ON_TIME";

    await insertShadowRow(supabase, {
      ...baseRow,
      probability_green: res.probability_green,
      logit: res.logit,
      base_decision: res.base_decision,
      decision: res.decision,
      hard_no_override_fired: res.hard_no_override_fired,
      would_trade: res.would_trade,
      model_fit_id: fit.model_fit_id,
      feature_vector_nonzero_count: res.feature_vector_nonzero_count,
      unknown_categories: res.unknown_categories,
      scored_at: scoredAt.toISOString(),
      snapshot_ts: new Date(plan.feature_cutoff_ms).toISOString(),
      boundary_delta_ms: boundaryDeltaMs,
      model_artifact_sha256: artifactHash,
      feature_vector_sha256: featureVectorHash,
      override_reasons_json: res.override_reasons,
      timing_status: timingStatus,
      leakage_check_passed: true,
      leakage_block_reason: null,
      offending_features_json: null,
    });
    if (variant === "B") {
      try {
        const { data: fitRow } = await supabase
          .from("model7_training_fits")
          .select("first_scored_candle_ts")
          .eq("model_fit_id", fit.model_fit_id)
          .maybeSingle();
        const existing = fitRow?.first_scored_candle_ts as string | null | undefined;
        if (!existing || new Date(row.candle_ts).getTime() < new Date(existing).getTime()) {
          await supabase
            .from("model7_training_fits")
            .update({ first_scored_candle_ts: row.candle_ts } as never)
            .eq("model_fit_id", fit.model_fit_id);
        }
      } catch { /* never block shadow */ }
    }
  } catch (e) {
    await insertShadowRow(supabase, {
      ...baseRow, status: "error",
      model_fit_id: fit.model_fit_id,
      shadow_error: e instanceof Error ? e.message : String(e),
      timing_status: "SOURCE_TIMESTAMP_UNKNOWN",
      leakage_check_passed: false,
    });
  }
}

/**
 * Fire-and-forget from the production engine. Always resolves; never throws.
 */
export async function runShadowForPrediction(
  supabase: SupabaseClient,
  predictionRow: PredictionRow & { id: string; candle_ts: string; model_version?: string | null },
): Promise<void> {
  try {
    const plan = computeTimingPlan(predictionRow.candle_ts);
    // Bounded-loop wait — never returns before score_not_before.
    const wait = await waitUntilScoreable(plan);
    if (!wait.reached) {
      // Fail-closed: log a single skipped row and exit.
      await insertShadowRow(supabase, {
        prediction_id: predictionRow.id, candle_ts: predictionRow.candle_ts,
        variant: "A", status: "skipped",
        production_model_version: predictionRow.model_version ?? null,
        model_fit_id: "timing_wait_exceeded",
        shadow_error: "TIMING_WAIT_EXCEEDED",
        timing_status: "EARLY_SCORING_BLOCKED",
        leakage_check_passed: false,
        leakage_block_reason: "TIMING_WAIT_EXCEEDED",
        target_boundary_ts: new Date(plan.target_boundary_ms).toISOString(),
        score_not_before_ts: new Date(plan.score_not_before_ms).toISOString(),
        feature_cutoff_ts: new Date(plan.feature_cutoff_ms).toISOString(),
        previous_candle_ts: new Date(plan.previous_candle_ms).toISOString(),
      });
      return;
    }

    const history = await loadHistoricalCandles(supabase, predictionRow.candle_ts);
    const leakage = inspectHistoryLeakage(plan, history);

    // Variant A — frozen v1.1.
    let frozen: ModelFit | null = null;
    try { frozen = loadFrozenModel(); } catch (e) {
      await insertShadowRow(supabase, {
        prediction_id: predictionRow.id, candle_ts: predictionRow.candle_ts,
        variant: "A", status: "error",
        production_model_version: predictionRow.model_version ?? null,
        model_fit_id: "frozen_v1_1",
        shadow_error: `frozen_load_failed: ${e instanceof Error ? e.message : String(e)}`,
      });
    }
    if (frozen) await runVariant(supabase, "A", frozen, predictionRow, history, plan, leakage);

    const tmv = predictionRow.model_version ?? "6.0";
    const variantB = await loadLatestVariantBFit(supabase, tmv);
    await runVariant(supabase, "B", variantB, predictionRow, history, plan, leakage,
      variantB ? undefined : "warming_up");
    await runVariant(supabase, "B2", variantB, predictionRow, history, plan, leakage,
      variantB ? undefined : "warming_up", { skipUpstreamNoClearEdge: true });

  } catch (e) {
    try {
      await supabase.from("api_runs").insert({
        run_type: "model7-shadow-error",
        response_payload: { error: e instanceof Error ? e.message : String(e), prediction_id: predictionRow.id },
        success: false,
        error_message: e instanceof Error ? e.message : String(e),
      });
    } catch { /* ignore */ }
  }
}

/**
 * Resolve shadow rows for a prediction once actual_direction is known.
 */
export async function resolveShadowRowsFor(
  supabase: SupabaseClient,
  predictionId: string,
  actualDirection: "GREEN" | "RED" | "DOJI" | null,
): Promise<void> {
  if (!actualDirection || (actualDirection !== "GREEN" && actualDirection !== "RED")) return;
  const { data: rows } = await supabase
    .from("model7_shadow")
    .select("id, variant, decision, would_trade")
    .eq("prediction_id", predictionId)
    .eq("status", "pending");
  for (const r of rows ?? []) {
    let status: "win" | "loss" | "skipped" = "skipped";
    if (r.decision === "SKIP") status = "skipped";
    else if (r.decision === "YES") status = actualDirection === "GREEN" ? "win" : "loss";
    else if (r.decision === "NO") status = actualDirection === "RED" ? "win" : "loss";
    await supabase.from("model7_shadow").update({
      status, actual_direction: actualDirection, resolved_at: new Date().toISOString(),
    } as never).eq("id", r.id);
  }
}
