// Orchestrator: runs Model 6 end-to-end and produces an insertPayload for `predictions`.
//
// INVARIANT — do not break: every row this function inserts into `predictions`
// with model_version='6.0' MUST carry a non-null `engine_version_hash`. That
// column is the canonical filter for "row produced by the deterministic
// engine" — analytics, stats queries, and the 7-day measurement window all
// key off it. Pre-engine LLM rows that were mislabeled 6.0 have been
// relabeled to '5.1-mislabeled' (see migration 20260708). Never introduce a
// 6.0 code path that skips setting engine_version_hash.
//
// MEASUREMENT CLOCK — the 7-day evaluation window starts at the earliest
// predictions row with model_version='6.0' AND engine_version_hash IS NOT NULL.
// Flat-stake discipline = flat *base* units, with the sizingEngine's 1/2-unit
// conviction rule applied mechanically. Track net units alongside net wins.
import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeIndicatorBundle, type Candle } from "../indicators";
import { fetchAndUpsertCandles, buildPartialCandleContext, type PartialCandle } from "../okx.server";
import { getBtc15mExchangeTiming } from "../timing.server";
import { computeFeatures } from "./featureEngine";
import { scoreCandle, type ModuleName, type ModulePoints } from "./scoringEngine";
import { makeDecision, type RecentPredictionCtx, type Prediction, type SetupType } from "./decisionEngine";
import { computeUnits } from "./sizingEngine";
import { narrateDecision } from "./narrator";
import { MODEL6_VERSION, ENGINE_LOGIC_VERSION } from "./config";

const TF_MS = 15 * 60 * 1000;
const MAX_FEATURE_AGE_MS = TF_MS;

type PredictionCandle = Candle & { confirm?: boolean };

async function loadCandles(supabase: SupabaseClient): Promise<PredictionCandle[]> {
  const { data, error } = await supabase
    .from("candles")
    .select("candle_ts, open, high, low, close, volume, confirm")
    .eq("symbol", "BTC-USDT").eq("timeframe", "15m")
    .order("candle_ts", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).slice().reverse() as PredictionCandle[];
}

function freshnessFor(candleTs: string, now: number) {
  const ms = new Date(candleTs).getTime();
  const age = now - ms;
  return {
    inputCandleTs: candleTs,
    inputCandleAgeSeconds: Number.isFinite(age) ? Math.max(0, Math.round(age / 1000)) : null,
    inputFeaturesFresh: Number.isFinite(age) && age >= 0 && age <= MAX_FEATURE_AGE_MS,
  };
}

function computeConfigHash(settings: Record<string, unknown>): string {
  const canon = JSON.stringify({
    model_version: settings.model_version ?? null,
    api_model_id: settings.api_model_id ?? null,
    engine_logic_version: ENGINE_LOGIC_VERSION,
  });
  return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}

function engineHash(): string {
  return createHash("sha256").update(`model6|${MODEL6_VERSION}|${ENGINE_LOGIC_VERSION}`).digest("hex").slice(0, 16);
}

async function loadRecentContext(supabase: SupabaseClient, modelVersion: string): Promise<RecentPredictionCtx> {
  const { data } = await supabase
    .from("predictions")
    .select("prediction, status, setup_type, resolved_at, candle_ts")
    .in("status", ["win", "loss", "push"])
    .eq("model_version", modelVersion)
    .order("candle_ts", { ascending: false })
    .limit(8);
  const arr = data ?? [];
  const wl = arr.filter((r) => r.status === "win" || r.status === "loss");
  const last = wl[0] ?? null;
  const last5 = wl.slice(0, 5);
  const last2 = wl.slice(0, 2);
  const last5_losses = last5.filter((r) => r.status === "loss").length;
  const last2_losses = last2.filter((r) => r.status === "loss").length;
  const lastDir = last?.prediction ?? null;
  let same_dir = 0;
  for (const r of wl) {
    if (r.prediction === lastDir && r.status === "loss") same_dir++;
    else break;
  }
  return {
    prev_prediction: (last?.prediction ?? null) as Prediction | null,
    prev_status: (last?.status ?? null) as "win" | "loss" | "push" | null,
    prev_setup_type: (last?.setup_type ?? null) as SetupType | null,
    prev_was_fallback: last?.setup_type === "low_confidence" || last?.setup_type === "no_clear_edge",
    last5_losses, last2_losses, same_direction_loss_streak: same_dir,
  };
}

function serializeModulePoints(mp: Record<ModuleName, ModulePoints>): Record<string, ModulePoints> {
  const out: Record<string, ModulePoints> = {};
  for (const [k, v] of Object.entries(mp)) {
    out[k] = { bull: Number(v.bull.toFixed(2)), bear: Number(v.bear.toFixed(2)) };
  }
  return out;
}

export async function runModel6Prediction(
  supabase: SupabaseClient,
  opts?: { timing?: Awaited<ReturnType<typeof getBtc15mExchangeTiming>> },
) {
  const started = Date.now();
  try {
    // Prefer the timing the scheduler already locked in before the boundary
    // wait. Recomputing here costs two network round trips and, when they were
    // slow, could cross the boundary and retarget the run one candle ahead.
    const exchangeTiming = opts?.timing ?? (await getBtc15mExchangeTiming());
    let ordered = await loadCandles(supabase);
    if (ordered.length < 30) throw new Error("Not enough candle history.");
    let latest = ordered[ordered.length - 1];
    let freshness = freshnessFor(latest.candle_ts, exchangeTiming.serverNowMs);
    let fetchSource: "okx" | "coinbase" | null = null;
    let freshnessAction: string = freshness.inputFeaturesFresh ? "fresh" : "stale_refetch_attempted";
    if (!freshness.inputFeaturesFresh) {
      try {
        const refresh = await fetchAndUpsertCandles(supabase);
        fetchSource = refresh.primary_source;
        ordered = await loadCandles(supabase);
        latest = ordered[ordered.length - 1];
        freshness = freshnessFor(latest.candle_ts, exchangeTiming.serverNowMs);
        freshnessAction = freshness.inputFeaturesFresh ? "refetched_fresh" : "forced_no_clear_edge_stale_after_refetch";
      } catch (e) {
        freshnessAction = `forced_no_clear_edge_refetch_failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    const { data: settings } = await supabase.from("model_settings").select("*").eq("is_active", true).maybeSingle();
    if (!settings) throw new Error("No active model settings");
    const configHash = computeConfigHash(settings as Record<string, unknown>);
    const engineVersionHash = engineHash();

    // No-advance check
    const { data: prevPred } = await supabase
      .from("predictions")
      .select("input_candle_ts")
      .eq("symbol", "BTC-USDT").eq("timeframe", "15m")
      .eq("model_version", settings.model_version)
      .not("input_candle_ts", "is", null)
      .order("candle_ts", { ascending: false }).limit(1).maybeSingle();
    const prevInputMs = prevPred?.input_candle_ts ? new Date(prevPred.input_candle_ts as string).getTime() : 0;
    const currentInputMs = new Date(freshness.inputCandleTs).getTime();
    const advanceCheckPassed = !prevInputMs || currentInputMs > prevInputMs;

    const targetCandleTs = new Date(exchangeTiming.nextCloseMs).toISOString();

    // Idempotency
    const { data: existing } = await supabase
      .from("predictions")
      .select("*")
      .eq("symbol", "BTC-USDT").eq("timeframe", "15m")
      .eq("model_version", settings.model_version)
      .eq("candle_ts", targetCandleTs).maybeSingle();
    if (existing) return existing;

    // Partial candle
    let partial: PartialCandle | null = null;
    let partialPath: string = "unavailable";
    let partialAttempts: Array<{ source: string; ok: boolean; status?: number; reason?: string }> = [];
    let partialSynthesized = false;
    let partialRootCause: string | null = null;
    try {
      const ctx = await buildPartialCandleContext(supabase);
      partial = ctx.snapshot; partialPath = ctx.path; partialAttempts = ctx.attempts;
      partialSynthesized = ctx.synthesized;
      partialRootCause = ctx.root_cause ?? null;
    } catch (e) {
      partialAttempts = [{ source: "build_partial", ok: false, reason: e instanceof Error ? e.message : String(e) }];
      partialRootCause = "build_partial_threw";
    }
    // Fire-and-forget diagnostic log so every fetch attempt is inspectable via api_runs.
    if (!partial || partialSynthesized || partialRootCause) {
      try {
        await supabase.from("api_runs").insert({
          run_type: "partial-candle-fetch",
          request_payload: { target_ts: targetCandleTs, input_ts: freshness.inputCandleTs },
          response_payload: { path: partialPath, synthesized: partialSynthesized, root_cause: partialRootCause, attempts: partialAttempts },
          success: !!partial && !partialSynthesized,
        });
      } catch { /* never block */ }
    }


    const indicators = computeIndicatorBundle(ordered);
    if (!indicators) throw new Error("Failed to compute indicators");

    // Stale/no-advance -> forced NCE row (keep parity with existing pipeline for observability)
    if (!freshness.inputFeaturesFresh || !advanceCheckPassed) {
      const staleReason = !advanceCheckPassed ? "no_advance_since_last_prediction" : "stale_input_features";
      const forcedPayload: Record<string, unknown> = {
        symbol: "BTC-USDT", timeframe: "15m",
        model_version: settings.model_version,
        api_model_id: (settings as Record<string, unknown>).api_model_id ?? null,
        candle_ts: targetCandleTs,
        prediction: "NO CLEAR EDGE", confidence: 0,
        btc_price_at_prediction: Number(latest.close),
        setup_type: !advanceCheckPassed ? "NO_ADVANCE_FORCED_SKIP" : "STALE_INPUT_FORCED_SKIP",
        market_condition: null,
        reasoning_summary: `Model 6 forced NCE: ${staleReason}.`,
        full_ai_response: { forced_no_clear_edge: true, reason: staleReason, engine: "model6", engine_version_hash: engineVersionHash },
        indicators: indicators as unknown as Record<string, unknown>,
        orderbook: null, status: "pending",
        input_candle_ts: freshness.inputCandleTs,
        input_candle_age_seconds: freshness.inputCandleAgeSeconds,
        input_features_fresh: freshness.inputFeaturesFresh,
        freshness_action: freshnessAction, fetch_source: fetchSource,
        advance_check_passed: advanceCheckPassed,
        current_partial_minutes_elapsed: partial?.minutes_elapsed ?? null,
        current_partial_snapshot: partial as unknown as Record<string, unknown> | null,
        partial_agreement: "nce", final_trade_status: "AVOID",
        config_hash: configHash, agreement_gate_applied: false, agreement_gate_reason: "n/a_nce",
        engine_version_hash: engineVersionHash,
        units: 1, conviction_active: false, conviction_reasons: [], conviction_direction: null, conviction_aligned: false,
      };
      const { data, error } = await supabase.from("predictions").insert(forcedPayload as never).select().single();
      if (error) throw error;
      await supabase.from("api_runs").insert({
        run_type: "run-ai-prediction",
        request_payload: { engine: "model6", skipped: true, reason: staleReason },
        response_payload: { prediction_id: data.id, duration_ms: Date.now() - started },
        success: true,
      });
      return data;
    }

    // === Deterministic pipeline ===
    const features = computeFeatures(ordered as Candle[], { partial, partialSynthesized });
    const scores = scoreCandle(features);
    const recentCtx = await loadRecentContext(supabase, settings.model_version);
    const decision = makeDecision(features, scores, recentCtx);
    const sizing = computeUnits(features, decision.prediction);

    const narrator = await narrateDecision({
      features, scores, decision, sizing,
      apiKey: process.env.OPENAI_API_KEY ?? null,
    });

    // Setup type persisted as spec label (server-authoritative).
    const setupTypeLabel = decision.setup_type;

    const insertPayload: Record<string, unknown> = {
      symbol: "BTC-USDT", timeframe: "15m",
      model_version: settings.model_version,
      api_model_id: (settings as Record<string, unknown>).api_model_id ?? null,
      candle_ts: targetCandleTs,
      prediction: decision.prediction,
      confidence: decision.confidence,
      btc_price_at_prediction: features.last.close,
      setup_type: setupTypeLabel,
      market_condition:
        features.atr_state === "strong_expansion" ? "trending_expansion"
        : features.atr_state === "compressed" ? "compressed"
        : features.fib_zone === "true_mid" ? "chop_mid"
        : features.above_vwap ? "above_vwap" : "below_vwap",
      reasoning_summary: narrator,
      full_ai_response: {
        engine: "model6",
        engine_version_hash: engineVersionHash,
        engine_logic_version: ENGINE_LOGIC_VERSION,
        bull: scores.bull, bear: scores.bear, margin: scores.margin,
        dominant: scores.dominant,
        module_points: serializeModulePoints(scores.module_points),
        base_prediction: decision.base_prediction,
        guards_applied: decision.guards_applied,
        caps_applied: decision.caps_applied,
        fib_zone: features.fib_zone,
        atr_state: features.atr_state,
        vwap_reclaim: features.vwap_reclaim, vwap_loss: features.vwap_loss,
        partial_present: features.partial.present,
        partial_completeness: features.partial.completeness,
        partial_direction: features.partial.direction,
        partial_close_pos: features.partial.close_position_pct,
        partial_range_vs_atr: features.partial.range_vs_atr,
        partial_vwap_event: features.partial.vwap_event,
        recent_ctx: recentCtx,
      },
      indicators: indicators as unknown as Record<string, unknown>,
      orderbook: null,
      status: "pending",
      input_candle_ts: freshness.inputCandleTs,
      input_candle_age_seconds: freshness.inputCandleAgeSeconds,
      input_features_fresh: freshness.inputFeaturesFresh,
      freshness_action: freshnessAction,
      fetch_source: fetchSource,
      advance_check_passed: advanceCheckPassed,
      current_partial_minutes_elapsed: partial?.minutes_elapsed ?? null,
      current_partial_snapshot: partial as unknown as Record<string, unknown> | null,
      partial_snapshot_present: features.partial.present,
      partial_snapshot_failure_reason: features.partial.present ? null : (partial ? "invalid_payload" : "not_attempted"),
      partial_completeness: Number(features.partial.completeness.toFixed(3)),
      partial_direction: features.partial.direction,
      partial_close_position_pct: features.partial.close_position_pct != null ? Number(features.partial.close_position_pct.toFixed(3)) : null,
      partial_range_vs_atr: features.partial.range_vs_atr != null ? Number(features.partial.range_vs_atr.toFixed(3)) : null,
      partial_vwap_event: features.partial.vwap_event,
      partial_fetch_source: partialPath ?? null,
      feed_mismatch: features.partial.feed_mismatch,
      degraded_mode: features.partial.degraded_mode,
      partial_agreement: decision.partial_agreement,
      partial_module_bull_pts: Number(scores.module_points.partial_candle_confirmation.bull.toFixed(2)),
      partial_module_bear_pts: Number(scores.module_points.partial_candle_confirmation.bear.toFixed(2)),
      partial_veto_active: decision.partial_veto_active,
      partial_veto_tier: decision.partial_veto_tier,
      partial_veto_direction: decision.partial_veto_direction,
      partial_hard_override_fired: decision.partial_hard_override_fired,
      conflict_downgrade_applied: false,
      config_hash: configHash,
      agreement_gate_applied: decision.agreement_gate_applied,
      agreement_gate_reason: decision.agreement_gate_reason,
      final_trade_status: decision.final_trade_status,
      base_bullish_score: scores.bull,
      base_bearish_score: scores.bear,
      bullish_score: scores.bull,
      bearish_score: scores.bear,
      score_margin: scores.margin,
      score_sum_mismatch: false, // invariant by construction
      original_prediction_before_partial: decision.original_prediction_before_partial,
      changed_by_partial: decision.changed_by_partial,
      change_reason: decision.change_reason,
      module_points: serializeModulePoints(scores.module_points),
      engine_version_hash: engineVersionHash,
      units: sizing.units,
      conviction_active: sizing.conviction_active,
      conviction_reasons: sizing.conviction_reasons,
      conviction_direction: sizing.conviction_direction,
      conviction_aligned: sizing.conviction_aligned,
    };

    const { data: inserted, error: insErr } = await supabase
      .from("predictions").insert(insertPayload as never).select().single();
    if (insErr) throw insErr;

    // NOTE: Model 6 no longer emits `prediction.created`. Variant B2 owns the
    // outbound webhook to the autobetter — see `src/lib/model7/shadow.ts`.
    // Model 6 still runs (feature snapshot + stats + shadow input); it just
    // stops calling out. Do not re-add a deliverWebhook call here.


    // ------------------------------------------------------------------
    // Model 7 SHADOW — never blocks production. Runs both variants and
    // inserts into public.model7_shadow. All errors are swallowed and
    // logged in-shadow / to api_runs.
    // ------------------------------------------------------------------
    try {
      const { runShadowForPrediction } = await import("../model7/shadow");
      await runShadowForPrediction(supabase, inserted as never);
    } catch (shErr) {
      await supabase.from("api_runs").insert({
        run_type: "model7-shadow-error",
        response_payload: { error: shErr instanceof Error ? shErr.message : String(shErr), prediction_id: inserted.id },
        success: false,
        error_message: shErr instanceof Error ? shErr.message : String(shErr),
      });
    }


    await supabase.from("api_runs").insert({
      run_type: "run-ai-prediction",
      request_payload: {
        engine: "model6", model_version: settings.model_version,
        engine_version_hash: engineVersionHash,
        input_candle_ts: freshness.inputCandleTs,
      },
      response_payload: {
        prediction_id: inserted.id, prediction: inserted.prediction,
        confidence: inserted.confidence, setup: setupTypeLabel,
        margin: scores.margin, units: sizing.units,
        duration_ms: Date.now() - started,
      },
      success: true,
    });
    return inserted;
  } catch (e) {
    await supabase.from("api_runs").insert({
      run_type: "run-ai-prediction",
      request_payload: { engine: "model6" },
      response_payload: { error: e instanceof Error ? { message: e.message, stack: e.stack } : String(e) },
      success: false,
      error_message: e instanceof Error ? e.message : String(e),
    });
    throw e;
  }
}

export function isModel6(v: unknown): boolean {
  return /^6(\.|$)/.test(String(v ?? "").trim());
}
