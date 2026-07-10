// Model 7 Shadow — orchestrator called after each production insert.
// Runs Variant A (frozen v1.1) and Variant B (latest live-retrained fit),
// inserts one shadow row per variant into public.model7_shadow.
// Never blocks production: every step is wrapped in try/catch and errors are
// logged to model7_shadow.shadow_error / api_runs.

import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { buildFeatureMap, type Candle, type PredictionRow } from "./featurize";
import { scoreFeatureMap, type ModelFit } from "./scorer";
import { loadFrozenModel, loadLatestVariantBFit } from "./fitStore";

const HISTORY_DEPTH_CANDLES = 24;
// Target: score AT or immediately AFTER the target-candle boundary.
// Shadow has no betting deadline; it should read the freshest data.
const BOUNDARY_TARGET_DELAY_MS = 1500;
// Never wait more than this from "now" to the boundary — bounds worker time.
const MAX_BOUNDARY_WAIT_MS = 25_000;

// Fields we treat as "raw numeric inputs" for the missing-fields ledger.
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
  // Canonical: coefficients + intercept + scaler + feature_order.
  return sha256Hex(JSON.stringify({
    fo: fit.feature_order,
    mu: fit.feature_means,
    sc: fit.feature_scales,
    co: fit.coefficients,
    b: fit.intercept,
  }));
}

function detectHistoryGap(history: Candle[]): boolean {
  if (history.length < 2) return history.length < HISTORY_DEPTH_CANDLES;
  // History is desc by candle_ts. Adjacent rows should be 15m apart.
  for (let i = 0; i < history.length - 1; i++) {
    const a = new Date(history[i].candle_ts).getTime();
    const b = new Date(history[i + 1].candle_ts).getTime();
    if (a - b !== 15 * 60 * 1000) return true;
  }
  return false;
}

function missingRawNumericFields(row: PredictionRow): string[] {
  const missing: string[] = [];
  for (const k of RAW_NUMERIC_FIELDS) {
    const v = (row as Record<string, unknown>)[k];
    if (v === null || v === undefined) missing.push(k);
  }
  return missing;
}

async function waitUntilBoundary(candleTsIso: string): Promise<void> {
  const boundaryMs = new Date(candleTsIso).getTime();
  const targetMs = boundaryMs + BOUNDARY_TARGET_DELAY_MS;
  const delay = targetMs - Date.now();
  if (delay <= 0) return;
  const capped = Math.min(delay, MAX_BOUNDARY_WAIT_MS);
  await new Promise((r) => setTimeout(r, capped));
}


async function loadHistoricalCandles(
  supabase: SupabaseClient,
  beforeTs: string,
): Promise<Candle[]> {
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
  reasonIfNoFit?: string,
  scoreOptions?: { skipUpstreamNoClearEdge?: boolean },
) {

  const baseRow: Record<string, unknown> = {
    prediction_id: row.id,
    candle_ts: row.candle_ts,
    variant,
    production_model_version: row.model_version ?? null,
    status: "pending",
  };
  if (!fit) {
    await insertShadowRow(supabase, {
      ...baseRow, status: "skipped",
      model_fit_id: reasonIfNoFit ?? "no_fit",
      shadow_error: reasonIfNoFit ?? "no_fit",
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
    });
    // Leak-check stamp: record the earliest candle this fit was ever used to
    // score. The nightly audit asserts training_window_end < first_scored_candle_ts.
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
    });
  }
}

/**
 * Fire-and-forget from the production engine. Loads both variant fits, scores,
 * inserts both rows. Always resolves; never throws.
 */
export async function runShadowForPrediction(
  supabase: SupabaseClient,
  predictionRow: PredictionRow & { id: string; candle_ts: string; model_version?: string | null },
): Promise<void> {
  try {
    const history = await loadHistoricalCandles(supabase, predictionRow.candle_ts);

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
    if (frozen) await runVariant(supabase, "A", frozen, predictionRow, history);

    // Variant B — latest live-retrained fit for the current production version.
    const tmv = predictionRow.model_version ?? "6.0";
    const variantB = await loadLatestVariantBFit(supabase, tmv);
    await runVariant(
      supabase, "B", variantB, predictionRow, history,
      variantB ? undefined : "warming_up",
    );

    // Variant B2 — identical to B (same fit / recipe) with the
    // upstream_no_clear_edge hard-NO override REMOVED. Retired override
    // registry: shadow_update_1 item 4.
    await runVariant(
      supabase, "B2", variantB, predictionRow, history,
      variantB ? undefined : "warming_up",
      { skipUpstreamNoClearEdge: true },
    );

  } catch (e) {
    // Absolute last-resort logging so the model7 shadow never breaks the tick.
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
 * Called from the production resolver. GREEN/RED only (doji excluded per spec).
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
