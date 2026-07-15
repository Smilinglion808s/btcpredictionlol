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
import {
  computeB4_2Decision, applyB4_2Resolution, B4_2_POLICY_VERSION,
} from "./b4_2";
import { consumeWarmed } from "./warmCache";
import {
  evaluateA2, a2InputsUsable, probabilityBucket,
  type A2Policy, type A2PolicyOutput,
} from "./a2";

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
): Promise<{ id: string } | null> {
  const { data } = await supabase
    .from("model7_shadow")
    .insert(base as never)
    .select("id")
    .maybeSingle();
  return (data as { id: string } | null) ?? null;
}

async function runVariant(
  supabase: SupabaseClient,
  variant: "A" | "B" | "B2",
  fit: ModelFit | null,
  row: PredictionRow & { id: string; candle_ts: string; created_at?: string | null; model_version?: string | null },
  history: Candle[],
  plan: TimingPlan,
  leakage: LeakageReport,
  reasonIfNoFit?: string,
  scoreOptions?: { skipUpstreamNoClearEdge?: boolean },
): Promise<Record<string, unknown> | null> {

  // Guard: prediction row must have been created strictly before target boundary.
  // Otherwise its indicator/module snapshot could contain post-boundary data.
  const createdAtIso = row.created_at ?? null;
  const createdAtMs = createdAtIso ? new Date(createdAtIso).getTime() : NaN;
  const predictionRowLeadMs = Number.isFinite(createdAtMs)
    ? plan.target_boundary_ms - createdAtMs : null;
  const predictionRowPostBoundary = Number.isFinite(createdAtMs)
    ? createdAtMs >= plan.target_boundary_ms : true; // unknown → fail closed

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
    prediction_row_created_at: createdAtIso,
    prediction_row_lead_ms: predictionRowLeadMs,
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
    return null;
  }
  if (predictionRowPostBoundary) {
    await insertShadowRow(supabase, {
      ...baseRow, status: "skipped",
      model_fit_id: fit.model_fit_id,
      shadow_error: "PREDICTION_ROW_POST_BOUNDARY",
      timing_status: "PREDICTION_ROW_POST_BOUNDARY",
      leakage_check_passed: false,
      leakage_block_reason: "PREDICTION_ROW_POST_BOUNDARY",
      offending_features_json: [{
        feature: "prediction_row_created_at",
        ts: createdAtIso ?? "unknown",
      }],
    });
    return null;
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
    return null;
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
      return null;
    }

    const artifactHash = fitArtifactHash(fit);
    const featureVectorHash = sha256Hex(JSON.stringify(res.standardized_vector));
    const timingStatus =
      boundaryDeltaMs > 10_000 ? "LATE_WARNING" : "ON_TIME";

    const shadowRow = {
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
    };
    const inserted = await insertShadowRow(supabase, shadowRow);

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

    // Outbound webhook is emitted from A2_Conflict (see runA2Policies).
    return { ...shadowRow, id: inserted?.id ?? null };

  } catch (e) {
    await insertShadowRow(supabase, {
      ...baseRow, status: "error",
      model_fit_id: fit.model_fit_id,
      shadow_error: e instanceof Error ? e.message : String(e),
      timing_status: "SOURCE_TIMESTAMP_UNKNOWN",
      leakage_check_passed: false,
    });
    return null;
  }
}


/**
 * Fire-and-forget from the production engine. Always resolves; never throws.
 */
export async function runShadowForPrediction(
  supabase: SupabaseClient,
  predictionRow: PredictionRow & { id: string; candle_ts: string; created_at?: string | null; model_version?: string | null },
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

    // Consume pre-warmed inputs if the /prewarm-b4_2 hook filled them for this
    // target boundary. Falls back to live fetches (existing behaviour) on miss.
    const warmed = consumeWarmed(plan.target_boundary_ms);
    const warmHit = warmed != null;
    const history = warmed?.history ?? await loadHistoricalCandles(supabase, predictionRow.candle_ts);
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
    // Priority path: Variant A runs FIRST so A2_Conflict (webhook source) can
    // emit ASAP. Variant A uses the frozen v1.1 fit (local file, no DB fetch)
    // and shares the already-loaded / warmed history. B2, B4.2, and B are
    // deferred until after the webhook fires so they never delay the outbound
    // signal.
    const aRow = frozen
      ? await runVariant(supabase, "A", frozen, predictionRow, history, plan, leakage)
      : null;

    // Fire the A2_Conflict webhook immediately from A's in-memory result.
    // Also inserts the three A2 policy rows (Conflict/MidBand/Combined).
    await runA2Policies(supabase, predictionRow, aRow);

    // ---- Deferred shadow tracking (post-webhook). ----
    const tmv = predictionRow.model_version ?? "6.0";
    const variantB = warmed?.variantBFit ?? await loadLatestVariantBFit(supabase, tmv);
    const b2Row = await runVariant(supabase, "B2", variantB, predictionRow, history, plan, leakage,
      variantB ? undefined : "warming_up", { skipUpstreamNoClearEdge: true });

    // ---- Variant B4.2 — Daily Edge Guard layered on top of B2 (tracking-only). ----
    try {
      if (b2Row) {
        const b2 = b2Row as Record<string, unknown>;
        const guard = await computeB4_2Decision(supabase, {
          b2_decision: (b2.decision as "YES" | "NO" | "SKIP" | null) ?? null,
          b2_base_decision: (b2.base_decision as "YES" | "NO" | "SKIP" | null) ?? null,
          probability_green: (b2.probability_green as number | null) ?? null,
          candle_ts: predictionRow.candle_ts,
        });
        // Inherit all timing/leakage/audit columns from B2, override decision fields.
        const inherit = [
          "target_boundary_ts","score_not_before_ts","feature_cutoff_ts","previous_candle_ts",
          "history_candles_available","history_gap_encountered","latest_source_candle_ts",
          "latest_source_event_ts","missing_raw_numeric_fields_json","prediction_row_created_at",
          "prediction_row_lead_ms","probability_green","logit","hard_no_override_fired",
          "model_fit_id","feature_vector_nonzero_count","unknown_categories","scored_at",
          "snapshot_ts","boundary_delta_ms","model_artifact_sha256","feature_vector_sha256",
          "override_reasons_json","timing_status","leakage_check_passed","leakage_block_reason",
          "offending_features_json","production_model_version",
        ] as const;
        const inherited: Record<string, unknown> = {};
        for (const k of inherit) inherited[k] = (b2 as Record<string, unknown>)[k] ?? null;

        const b2Status = String(b2.status ?? "pending");
        const rowStatus = b2Status === "skipped" || b2Status === "error"
          ? b2Status : "pending";

        const b4Row = {
          ...inherited,
          prediction_id: predictionRow.id,
          candle_ts: predictionRow.candle_ts,
          variant: "B4_2",
          status: rowStatus,
          base_decision: (b2.decision as string | null) ?? null,
          decision: guard.decision,
          would_trade: guard.decision !== "SKIP",
          shadow_error: b2Status === "error" ? (b2.shadow_error as string | null) : null,
          b4_2_guard_fired: guard.guard_fired,
          b4_2_guard_reason: guard.guard_reason,
          b4_2_edge_score_before: guard.edge_score_before,
          b4_2_cooldown_before: guard.cooldown_before,
          b4_2_date_mt: guard.date_mt,
          b4_2_policy_version: guard.policy_version,
          b4_2_last_two_no_results_json: guard.last_two_no_results,
          warm_cache_hit: warmHit,
        };
        await insertShadowRow(supabase, b4Row);
      }
    } catch (b4err) {
      try {
        await supabase.from("api_runs").insert({
          run_type: "model7-b4_2-error",
          response_payload: {
            error: b4err instanceof Error ? b4err.message : String(b4err),
            prediction_id: predictionRow.id,
          },
          success: false,
          error_message: b4err instanceof Error ? b4err.message : String(b4err),
        });
      } catch { /* ignore */ }
    }

    // Variant B — deferred tracking only.
    await runVariant(supabase, "B", variantB, predictionRow, history, plan, leakage,
      variantB ? undefined : "warming_up");




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
 * Layer three Variant A2 filter policies on top of Variant A's already-inserted
 * shadow row. Pure post-decision filter: only converts YES/NO -> SKIP. Never
 * reverses direction. Always inserts three rows (one per policy) — even on
 * fail-closed — so tracking is uniform.
 */
async function runA2Policies(
  supabase: SupabaseClient,
  predictionRow: { id: string; candle_ts: string; model_version?: string | null },
  aRowInline?: Record<string, unknown> | null,
): Promise<void> {
  try {
    // Prefer in-memory A row (saves a ~50-100ms DB round-trip on the critical
    // path to the A2_Conflict webhook). Fall back to DB read.
    let aRow: Record<string, unknown> | null = aRowInline ?? null;
    if (!aRow) {
      const { data } = await supabase
        .from("model7_shadow")
        .select("*")
        .eq("prediction_id", predictionRow.id).eq("variant", "A")
        .maybeSingle();
      aRow = (data as Record<string, unknown> | null) ?? null;
    }
    if (!aRow) return; // Variant A row absent; skip A2 (fail-closed, no rows).

    const a = aRow;
    const baseDecision = (a.base_decision as "YES" | "NO" | "SKIP" | null) ?? null;
    const finalDecision = (a.decision as "YES" | "NO" | "SKIP" | null) ?? null;
    const probability = (a.probability_green as number | null) ?? null;
    const appliedOverride = (a.hard_no_override_fired as string | null) ?? "none";
    const overrideApplied = appliedOverride !== "none";
    const aStatus = String(a.status ?? "pending");
    const inheritKeys = [
      "target_boundary_ts","score_not_before_ts","feature_cutoff_ts","previous_candle_ts",
      "history_candles_available","history_gap_encountered","latest_source_candle_ts",
      "latest_source_event_ts","missing_raw_numeric_fields_json","prediction_row_created_at",
      "prediction_row_lead_ms","probability_green","logit","hard_no_override_fired",
      "model_fit_id","feature_vector_nonzero_count","unknown_categories","scored_at",
      "snapshot_ts","boundary_delta_ms","model_artifact_sha256","feature_vector_sha256",
      "override_reasons_json","timing_status","leakage_check_passed","leakage_block_reason",
      "offending_features_json","production_model_version",
    ] as const;
    const inherited: Record<string, unknown> = {};
    for (const k of inheritKeys) inherited[k] = a[k] ?? null;

    const inputs = {
      base_decision: baseDecision,
      final_decision: finalDecision,
      probability_green: probability,
      applied_override_reason: appliedOverride,
    };
    const usable = a2InputsUsable(inputs) && aStatus !== "error";
    const evals = usable ? evaluateA2(inputs) : null;
    const bucket = probabilityBucket(probability);

    const auditBase: Record<string, unknown> = {
      ...inherited,
      prediction_id: predictionRow.id,
      candle_ts: predictionRow.candle_ts,
      a2_probability_bucket: bucket,
      a2_variant_a_base_decision: baseDecision,
      a2_variant_a_override_applied: overrideApplied,
      a2_variant_a_applied_override_reason: appliedOverride,
      a2_variant_a_final_decision: finalDecision,
      // Counterfactual = what Variant A's trade actually did. Set at resolve time.
      a2_counterfactual_result: null,
    };

    // Build all three policy rows in memory first.
    const policies: Array<A2Policy> = ["A2_Conflict", "A2_MidBand", "A2_Combined"];
    const built: Array<{ policy: A2Policy; row: Record<string, unknown>; out: A2PolicyOutput | null }> = [];
    for (const policy of policies) {
      let out: A2PolicyOutput | null = null;
      if (evals) {
        out = policy === "A2_Conflict" ? evals.conflict
          : policy === "A2_MidBand" ? evals.midband
          : evals.combined;
      }
      let status: string;
      if (!out || out.decision == null) status = "skipped";
      else if (out.decision === "SKIP") status = "skipped";
      else status = aStatus === "skipped" || aStatus === "error" ? aStatus : "pending";

      const row: Record<string, unknown> = {
        ...auditBase,
        variant: policy,
        status,
        base_decision: finalDecision,
        decision: out?.decision ?? null,
        would_trade: out?.decision != null && out.decision !== "SKIP",
        shadow_error: usable ? null : "A2_INPUTS_UNUSABLE",
        a2_filter_fired: out?.filter_fired ?? false,
        a2_filter_reason: out?.filter_reason ?? "NONE",
      };
      built.push({ policy, row, out });
    }

    // ---- Priority: fire the A2_Conflict webhook BEFORE any DB insert. ----
    // The payload doesn't require the shadow row's DB id (nullable), so we can
    // emit immediately and let the inserts happen in parallel afterwards.
    const conflict = built.find((b) => b.policy === "A2_Conflict")!;
    const aTimingStatus = String((inherited.timing_status as string | null) ?? "");
    const eligible =
      conflict.out?.decision != null &&
      probability != null &&
      (aTimingStatus === "ON_TIME" || aTimingStatus === "LATE_WARNING");
    const webhookPromise: Promise<unknown> = eligible
      ? (async () => {
          try {
            const { deliverWebhook, buildA2ConflictWebhookPayload } = await import("../webhooks.server");
            const payload = buildA2ConflictWebhookPayload({
              shadow: { ...conflict.row, id: null },
              prediction: predictionRow as unknown as Record<string, unknown>,
            });
            await deliverWebhook(supabase, "prediction.created", payload);
          } catch (whErr) {
            try {
              await supabase.from("api_runs").insert({
                run_type: "webhook-created-error",
                response_payload: {
                  error: whErr instanceof Error ? whErr.message : String(whErr),
                  prediction_id: predictionRow.id, variant: "A2_Conflict",
                },
                success: false,
                error_message: whErr instanceof Error ? whErr.message : String(whErr),
              });
            } catch { /* ignore */ }
          }
        })()
      : Promise.resolve();

    // Insert all three A2 rows in parallel with the webhook.
    const insertPromise = Promise.all(built.map(async ({ row }) => {
      try {
        await supabase.from("model7_shadow").insert(row as never);
      } catch { /* never block */ }
    }));

    // TD1-RC runs AFTER A2_Combined is decided; reads A2 as immutable input.
    // Runs in parallel with inserts/webhook; failures never affect A2.
    const combined = built.find((b) => b.policy === "A2_Combined")!;
    const td1Promise = (async () => {
      try {
        const { runTd1RcForA2Combined } = await import("./td1/orchestrator");
        await runTd1RcForA2Combined(supabase, {
          predictionId: predictionRow.id,
          candleTs: predictionRow.candle_ts,
          targetBoundaryTs: String(inherited.target_boundary_ts ?? predictionRow.candle_ts),
          finalDecision: (combined.row.decision as "YES" | "NO" | "SKIP" | null) ?? null,
          probabilityGreen: probability,
          modelFitId: (inherited.model_fit_id as string | null) ?? null,
          timingStatus: (inherited.timing_status as string | null) ?? null,
          leakageCheckPassed: (inherited.leakage_check_passed as boolean | null) ?? null,
          a2RowId: null,
        });
      } catch { /* never block */ }
    })();

    await Promise.all([webhookPromise, insertPromise, td1Promise]);
  } catch (e) {
    try {
      await supabase.from("api_runs").insert({
        run_type: "model7-a2-error",
        response_payload: {
          error: e instanceof Error ? e.message : String(e),
          prediction_id: predictionRow.id,
        },
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
    .select("id, variant, decision, would_trade, candle_ts, b4_2_counterfactual_b2_result, a2_variant_a_final_decision")
    .eq("prediction_id", predictionId)
    .eq("status", "pending");
  let b2Decision: "YES" | "NO" | "SKIP" | null = null;
  let b2Result: "WIN" | "LOSS" | null = null;
  let b2CandleTs: string | null = null;
  for (const r of rows ?? []) {
    let status: "win" | "loss" | "skipped" = "skipped";
    if (r.decision === "SKIP") status = "skipped";
    else if (r.decision === "YES") status = actualDirection === "GREEN" ? "win" : "loss";
    else if (r.decision === "NO") status = actualDirection === "RED" ? "win" : "loss";

    // Compute B2 counterfactual (what B2 WOULD score, regardless of its actual decision).
    // For B4.2 rows this is what really matters, but we capture on both.
    const cf = r.decision === "YES"
      ? (actualDirection === "GREEN" ? "WIN" : "LOSS")
      : r.decision === "NO"
        ? (actualDirection === "RED" ? "WIN" : "LOSS")
        : null;

    const update: Record<string, unknown> = {
      status, actual_direction: actualDirection, resolved_at: new Date().toISOString(),
    };
    if (r.variant === "B4_2") {
      update.b4_2_counterfactual_b2_result = null; // filled below via b2 lookup
      update.b4_2_b2_would_have_won = null;
    }
    await supabase.from("model7_shadow").update(update as never).eq("id", r.id);

    if (r.variant === "B2") {
      b2Decision = (r.decision as "YES" | "NO" | "SKIP" | null) ?? null;
      b2Result = cf;
      b2CandleTs = (r as { candle_ts: string | null }).candle_ts ?? null;
    }
  }

  // Backfill B4.2's counterfactual columns and apply state mutation.
  if (b2Decision && (b2Decision === "YES" || b2Decision === "NO") && b2Result) {
    try {
      await supabase.from("model7_shadow").update({
        b4_2_counterfactual_b2_result: b2Result,
        b4_2_b2_would_have_won: b2Result === "WIN",
      } as never).eq("prediction_id", predictionId).eq("variant", "B4_2");
    } catch { /* ignore */ }
    try {
      await applyB4_2Resolution(supabase, {
        resolution_id: `${predictionId}:${B4_2_POLICY_VERSION}`,
        candle_ts: b2CandleTs ?? new Date().toISOString(),
        b2_final_decision: b2Decision,
        b2_result: b2Result,
      });
    } catch { /* never block resolver */ }
  }

  // Backfill A2 counterfactual_result on every A2 row (both graded and skipped)
  // = what Variant A's trade actually did against actual_direction.
  try {
    const { data: a2Rows } = await supabase
      .from("model7_shadow")
      .select("id, a2_variant_a_final_decision")
      .eq("prediction_id", predictionId)
      .in("variant", ["A2_Conflict", "A2_MidBand", "A2_Combined"]);
    for (const r of a2Rows ?? []) {
      const aFinal = (r as { a2_variant_a_final_decision: string | null }).a2_variant_a_final_decision;
      let cf: "WIN" | "LOSS" | null = null;
      if (aFinal === "YES") cf = actualDirection === "GREEN" ? "WIN" : "LOSS";
      else if (aFinal === "NO") cf = actualDirection === "RED" ? "WIN" : "LOSS";
      await supabase.from("model7_shadow")
        .update({ a2_counterfactual_result: cf } as never)
        .eq("id", (r as { id: string }).id);
    }
  } catch { /* never block resolver */ }

  // TD1-RC resolution (Model 8 layer). Never blocks the resolver.
  try {
    const { resolveTd1RcRow } = await import("./td1/orchestrator");
    await resolveTd1RcRow(supabase, predictionId, actualDirection);
  } catch { /* never block */ }

  // Opportunistic TD1-RC retrain (cadence-gated). Never blocks the resolver.
  try {
    const { maybeRetrainTd1 } = await import("./td1/retrain");
    await maybeRetrainTd1(supabase);
  } catch { /* never block */ }
}

