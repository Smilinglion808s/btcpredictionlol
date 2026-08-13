// Server-only AI prediction + resolution logic. Imported by server fns and the cron route.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHash } from "crypto";
import { computeIndicatorBundle, type Candle } from "./indicators";
import { buildTelemetryV1 } from "./model6/telemetry";
import {
  fetchAndUpsertCandles,
  fetchOkxClosedCandle,
  buildPartialCandleContext,
  type PartialCandle,
} from "./okx.server";
import { fetchKalshiResolution } from "./kalshi.server";
import { getBtc15mExchangeTiming } from "./timing.server";

function computeConfigHash(settings: Record<string, unknown>): string {
  const canon = JSON.stringify({
    model_version: settings.model_version ?? null,
    api_model_id: (settings as any).api_model_id ?? null,
    confidence_threshold: settings.confidence_threshold ?? null,
    indicator_weights: settings.indicator_weights ?? null,
    prompt_template: settings.prompt_template ?? null,
    require_manual_approval: settings.require_manual_approval ?? null,
  });
  return createHash("sha256").update(canon).digest("hex").slice(0, 16);
}

function isModel5(modelVersion: unknown): boolean {
  const v = String(modelVersion ?? "").trim();
  return /^5(\.|$)/.test(v);
}


const DEFAULT_INSTRUCTIONS = `You are running BTC 15m Model 2.1 (spec id btc15m_m2_1) on BTCUSDT 15m candles.
Default run_type = "Run Next" → predict whether the NEXT 15m candle closes above (YES) or below (NO) its own open. Use "NO CLEAR EDGE" when no clean directional edge exists.
Confidence is on a 1/5 to 5/5 scale and represents the likelihood the call is correct (not signal strength). Only 3/5 or higher counts as a tradable edge.
Apply the supplied indicator_weights and the confidence_rules: cap confidence at 2/5 when price is directly under resistance / above support / at a major round number, when the signal candle already made a large extended move, when there is a large wick against the prediction, when price is flipping around the candle open, when volume looks like absorption, or when Run Next would require chasing an extended candle. Allow 3/5+ only when the documented YES or NO conditions are clearly met.
Use only the supplied closed candles and computed indicators.

Respond with JSON only in this exact shape:
{
  "model": "BTC 15m Model 2.1",
  "run_type": "Run Next",
  "target_candle": "<15m UTC window e.g. 2026-06-30T20:00:00Z -> 20:15:00Z>",
  "call": "YES" | "NO" | "NO CLEAR EDGE",
  "confidence": "1/5" | "2/5" | "3/5" | "4/5" | "5/5",
  "trade_status": "TRADE" | "SKIP",
  "flip_level": "<price level invalidating the call>",
  "confirmation_level": "<price level strengthening the call>",
  "final_interpretation": "<short label summarizing the setup>",
  "notes": "<short reason>"
}`;


interface AiOutput {
  // legacy fields kept for backward-compat parsing
  prediction?: "YES" | "NO" | "NO CLEAR EDGE";
  call?: "YES" | "NO" | "NO CLEAR EDGE";
  confidence: number | string;
  final_interpretation?: string;
  setup_type?: string;
  market_condition?: string;
  reasoning_summary?: string;
  notes?: string;
  trade_status?: string;
  flip_level?: string | number;
  confirmation_level?: string | number;
  target_candle?: string;
  indicators?: Record<string, string>;
}

type ResolutionCandle = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  confirm?: boolean;
};

type PredictionCandle = Candle & { confirm?: boolean };

const TF_MS = 15 * 60 * 1000;
const MAX_FEATURE_AGE_MS = TF_MS;

function actualDirection(candle: Pick<ResolutionCandle, "open" | "close">) {
  return candle.close > candle.open ? "GREEN" : candle.close < candle.open ? "RED" : "DOJI";
}

function candleResult(candle: Pick<ResolutionCandle, "open" | "close">) {
  return candle.close > candle.open ? "YES" : candle.close < candle.open ? "NO" : "DOJI";
}

function freshnessFor(candleTs: string, now = Date.now()) {
  const inputMs = new Date(candleTs).getTime();
  const ageMs = now - inputMs;
  return {
    inputCandleTs: candleTs,
    inputCandleAgeSeconds: Number.isFinite(ageMs) ? Math.max(0, Math.round(ageMs / 1000)) : null,
    inputFeaturesFresh: Number.isFinite(ageMs) && ageMs >= 0 && ageMs <= MAX_FEATURE_AGE_MS,
  };
}

async function loadPredictionCandles(supabase: SupabaseClient) {
  const { data, error } = await supabase
    .from("candles")
    .select("candle_ts, open, high, low, close, volume, confirm")
    .eq("symbol", "BTC-USDT")
    .eq("timeframe", "15m")
    .order("candle_ts", { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []).slice().reverse() as PredictionCandle[];
}

async function fetchActualResolutionCandle(candleTs: string, timeframeMs: number): Promise<(ResolutionCandle & { source: string }) | null> {
  const okx = await fetchOkxClosedCandle(candleTs);
  if (okx) return { ...okx, source: "okx" };

  const coinbase = await fetchCoinbaseClosedCandle(candleTs, timeframeMs);
  if (coinbase) return { ...coinbase, source: "coinbase" };

  return null;
}

async function fetchCoinbaseClosedCandle(candleTs: string, timeframeMs: number): Promise<ResolutionCandle | null> {
  const targetMs = new Date(candleTs).getTime();
  const targetSec = Math.floor(targetMs / 1000);
  const start = new Date(targetMs - timeframeMs).toISOString();
  const end = new Date(targetMs + timeframeMs * 2).toISOString();
  const url = new URL("https://api.exchange.coinbase.com/products/BTC-USD/candles");
  url.searchParams.set("granularity", "900");
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);

  const fetchWithRetry = async (): Promise<Response | null> => {
    for (let i = 0; i < 3; i++) {
      try {
        const r = await fetch(url, {
          headers: {
            accept: "application/json",
            "user-agent":
              "Mozilla/5.0 (compatible; BTC15mBot/1.0; +https://btcpredictionlol.lovable.app)",
          },
        });
        if (r.ok) return r;
      } catch {
        // network blip — retry
      }
      await new Promise((res) => setTimeout(res, 400 * (i + 1)));
    }
    return null;
  };
  const response = await fetchWithRetry();
  if (!response) return null;

  const rows = (await response.json()) as Array<[number, number, number, number, number, number]>;
  const hit = rows.find((row) => Number(row[0]) === targetSec);
  if (!hit) return null;

  return {
    low: Number(hit[1]),
    high: Number(hit[2]),
    open: Number(hit[3]),
    close: Number(hit[4]),
    volume: Number(hit[5] ?? 0),
    confirm: true,
  };
}

export async function runAiPredictionServer(
  supabase: SupabaseClient,
  opts?: { timing?: Awaited<ReturnType<typeof getBtc15mExchangeTiming>> },
) {
  // Model 6+ routes through the deterministic engine (no LLM in decision path).
  {
    const { data: activeSettings } = await supabase
      .from("model_settings")
      .select("model_version")
      .eq("is_active", true)
      .maybeSingle();
    const mv = String(activeSettings?.model_version ?? "").trim();
    if (/^6(\.|$)/.test(mv)) {
      const { runModel6Prediction } = await import("./model6/engine");
      return runModel6Prediction(supabase, { timing: opts?.timing });
    }
  }

  const started = Date.now();
  let aiPayload: unknown = null;
  let aiResponse: unknown = null;
  let success = true;
  let errorMessage: string | null = null;

  try {
    const exchangeTiming = await getBtc15mExchangeTiming();
    let ordered = await loadPredictionCandles(supabase);
    if (ordered.length < 30)
      throw new Error("Not enough candle history. Click Refresh Candles first.");

    let latestInput = ordered[ordered.length - 1];
    let freshness = freshnessFor(latestInput.candle_ts, exchangeTiming.serverNowMs);
    let freshnessAction = freshness.inputFeaturesFresh ? "fresh" : "stale_refetch_attempted";
    let fetchSource: "okx" | "coinbase" | null = null;

    if (!freshness.inputFeaturesFresh) {
      try {
        const refresh = await fetchAndUpsertCandles(supabase);
        fetchSource = refresh.primary_source;
        ordered = await loadPredictionCandles(supabase);
        if (ordered.length < 30) throw new Error("Not enough candle history after refresh.");
        latestInput = ordered[ordered.length - 1];
        freshness = freshnessFor(latestInput.candle_ts, exchangeTiming.serverNowMs);
        freshnessAction = freshness.inputFeaturesFresh ? "refetched_fresh" : "forced_no_clear_edge_stale_after_refetch";
      } catch (e) {
        freshnessAction = `forced_no_clear_edge_refetch_failed: ${e instanceof Error ? e.message : String(e)}`;
      }
    }

    const { data: settings } = await supabase
      .from("model_settings")
      .select("*")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (!settings) throw new Error("No active model settings");

    // "Advanced since last run" assertion — catches the case where the fetch
    // returned 200 but no NEW candle rows landed (feed frozen, upstream lag,
    // etc.). If max(candle_ts) hasn't moved past the previous prediction's
    // input_candle_ts for this model, force NO CLEAR EDGE.
    const { data: prevPredForModel } = await supabase
      .from("predictions")
      .select("input_candle_ts, candle_ts")
      .eq("symbol", "BTC-USDT")
      .eq("timeframe", "15m")
      .eq("model_version", settings.model_version)
      .not("input_candle_ts", "is", null)
      .order("candle_ts", { ascending: false })
      .limit(1)
      .maybeSingle();
    const prevInputMs = prevPredForModel?.input_candle_ts
      ? new Date(prevPredForModel.input_candle_ts as string).getTime()
      : 0;
    const currentInputMs = new Date(freshness.inputCandleTs as string).getTime();
    const advanceCheckPassed = !prevInputMs || currentInputMs > prevInputMs;
    if (!advanceCheckPassed) {
      freshnessAction = "no_advance_since_last_prediction";
    }

    const indicatorsBase = computeIndicatorBundle(ordered);
    if (!indicatorsBase) throw new Error("Failed to compute indicators");
    const telemetryV1 = buildTelemetryV1(ordered);
    const indicators = { ...(indicatorsBase as Record<string, unknown>), telemetry_v1: telemetryV1 } as typeof indicatorsBase & { telemetry_v1: ReturnType<typeof buildTelemetryV1> };

    const last = indicators.last;
    // Target candle = the UPCOMING candle (next 15m boundary), aligned to
    // Coinbase time and Kalshi's market close_time when available.
    const targetCandleTs = new Date(exchangeTiming.nextCloseMs).toISOString();

    // Idempotency: if a prediction already exists for this candle + model, return it.
    const { data: existing } = await supabase
      .from("predictions")
      .select("*")
      .eq("symbol", "BTC-USDT")
      .eq("timeframe", "15m")
      .eq("model_version", settings.model_version)
      .eq("candle_ts", targetCandleTs)
      .maybeSingle();
    if (existing) return existing;

    // Fetch the currently-forming candle. buildPartialCandleContext tries DB
    // (populated by the fetch phase seconds earlier) then OKX/Binance/Coinbase
    // live, and finally synthesizes from spot ticker so the snapshot is
    // effectively always available. Every attempt is recorded for auditing.
    let partial: PartialCandle | null = null;
    let partialPath = "unavailable" as
      | "db_unconfirmed" | "okx_live" | "binance_live" | "coinbase_live"
      | "synthesized_from_spot" | "unavailable";
    let partialAttempts: Array<{ source: string; ok: boolean; status?: number; reason?: string }> = [];
    let partialSynthesized = false;
    try {
      const ctx = await buildPartialCandleContext(supabase);
      partial = ctx.snapshot;
      partialPath = ctx.path;
      partialAttempts = ctx.attempts;
      partialSynthesized = ctx.synthesized;
    } catch (e) {
      partialAttempts = [{ source: "build_partial", ok: false, reason: e instanceof Error ? e.message : String(e) }];
    }

    if (!partial || partialSynthesized) {
      await supabase.from("api_runs").insert({
        run_type: "partial-candle-fetch",
        request_payload: { target_candle_ts_hint: null },
        response_payload: { path: partialPath, synthesized: partialSynthesized, attempts: partialAttempts },
        success: !!partial,
        error_message: !partial ? `No partial candle: ${partialAttempts.map((a) => `${a.source}:${a.reason ?? "ok"}`).join(" | ")}` : null,
      });
    }

    // fetch_source: always populate. Prefer the source that produced the
    // latest candle row in the DB (works on the fresh-path too, not just refetch).
    if (!fetchSource) {
      try {
        const { data: latestCandleRow } = await supabase
          .from("candles")
          .select("fetch_source")
          .eq("symbol", "BTC-USDT").eq("timeframe", "15m")
          .order("candle_ts", { ascending: false })
          .limit(1)
          .maybeSingle();
        const fs = (latestCandleRow as { fetch_source?: string } | null)?.fetch_source;
        if (fs === "okx" || fs === "coinbase") fetchSource = fs;
      } catch {
        // non-fatal
      }
    }


    // -------- Partial-candle derived metrics (computed ONCE; used for prompt + persisted columns) --------
    const last20 = ordered.slice(-20);
    const last14 = ordered.slice(-14);
    const atr14 =
      last14.length > 0
        ? last14.reduce((s, c) => s + (Number(c.high) - Number(c.low)), 0) / last14.length
        : 0;
    const vwap20 = (() => {
      if (!last20.length) return null;
      let pv = 0, vv = 0;
      for (const c of last20) {
        const typ = (Number(c.high) + Number(c.low) + Number(c.close)) / 3;
        const v = Math.max(Number(c.volume) || 0, 0);
        pv += typ * v; vv += v;
      }
      return vv > 0 ? pv / vv : null;
    })();
    const lastCompletedClose = Number(last.close);

    const partialFailureReason: string | null = (() => {
      if (partial && !partialSynthesized) return null;
      if (!partial) {
        const a = partialAttempts?.[0];
        const r = (a?.reason ?? "").toLowerCase();
        if (r.includes("timeout")) return "fetch_timeout";
        if (r.includes("invalid") || r.includes("parse")) return "invalid_payload";
        if (partialAttempts && partialAttempts.length > 0) return "fetch_error";
        return "not_attempted";
      }
      return "invalid_payload";
    })();

    let partialDerived: {
      completeness: number | null;
      direction: "green" | "red" | "flat" | null;
      closePositionPct: number | null;
      rangeVsAtr: number | null;
      vwapEvent: "reclaim" | "loss" | "none";
      feedMismatch: boolean;
      bodyStrength: number | null;
      upperWickPct: number | null;
      lowerWickPct: number | null;
    } = {
      completeness: null,
      direction: null,
      closePositionPct: null,
      rangeVsAtr: null,
      vwapEvent: "none",
      feedMismatch: false,
      bodyStrength: null,
      upperWickPct: null,
      lowerWickPct: null,
    };
    if (partial) {
      const range = Math.max(partial.high - partial.low, 1e-9);
      const denom = Math.max(range, 0.05 * (atr14 || range));
      const completeness = Math.min(1, partial.minutes_elapsed / 15);
      const flatEps = 0.02 * (atr14 || Math.abs(partial.close - partial.open) || 1);
      const direction =
        Math.abs(partial.close - partial.open) < flatEps
          ? "flat"
          : partial.close > partial.open ? "green" : "red";
      const closePositionPct = (partial.close - partial.low) / denom;
      const rangeVsAtr = atr14 > 0 ? range / atr14 : null;
      const bodyStrength = Math.abs(partial.close - partial.open) / Math.max(range, 1e-9);
      const upperWickPct = (partial.high - Math.max(partial.open, partial.close)) / Math.max(range, 1e-9);
      const lowerWickPct = (Math.min(partial.open, partial.close) - partial.low) / Math.max(range, 1e-9);
      let vwapEvent: "reclaim" | "loss" | "none" = "none";
      if (vwap20 != null) {
        if (lastCompletedClose < vwap20 && partial.close > vwap20) vwapEvent = "reclaim";
        else if (lastCompletedClose > vwap20 && partial.close < vwap20) vwapEvent = "loss";
      }
      const openDrift = lastCompletedClose > 0 ? Math.abs(partial.open - lastCompletedClose) / lastCompletedClose : 0;
      partialDerived = {
        completeness,
        direction,
        closePositionPct,
        rangeVsAtr,
        vwapEvent,
        feedMismatch: openDrift > 0.003,
        bodyStrength,
        upperWickPct,
        lowerWickPct,
      };
    }

    const partialFetchSource: string | null = (() => {
      const s = (partial?.source ?? "").toString().toLowerCase();
      if (s.includes("okx")) return "okx";
      if (s.includes("coinbase")) return "coinbase";
      if (s.includes("binance")) return "binance";
      if (partialPath === "okx_live") return "okx";
      if (partialPath === "coinbase_live") return "coinbase";
      if (partialPath === "binance_live") return "binance";
      if (partialPath === "db_unconfirmed") return "db_fallback";
      return null;
    })();

    const partialCols = {
      partial_snapshot_present: !!partial && !partialSynthesized,
      partial_snapshot_failure_reason: partialFailureReason,
      partial_completeness: partialDerived.completeness != null ? Number(partialDerived.completeness.toFixed(3)) : null,
      partial_direction: partialDerived.direction,
      partial_close_position_pct: partialDerived.closePositionPct != null ? Number(partialDerived.closePositionPct.toFixed(3)) : null,
      partial_range_vs_atr: partialDerived.rangeVsAtr != null ? Number(partialDerived.rangeVsAtr.toFixed(3)) : null,
      partial_vwap_event: partialDerived.vwapEvent,
      partial_fetch_source: partialPath ?? null,
      feed_mismatch: partialDerived.feedMismatch,
      degraded_mode: !partial || partialSynthesized || partialDerived.feedMismatch,
      partial_agreement: "missing" as "agree" | "disagree" | "neutral" | "nce" | "missing",
      partial_module_bull_pts: 0 as number,
      partial_module_bear_pts: 0 as number,
      partial_veto_active: false,
      partial_veto_tier: "none" as "hard" | "soft" | "none",
      partial_veto_direction: null as null | "blocked_yes" | "blocked_no",
      partial_hard_override_fired: false,
      conflict_downgrade_applied: false,
    };




    if (!freshness.inputFeaturesFresh || !advanceCheckPassed) {
      const staleMessage = !advanceCheckPassed
        ? `Forced NO CLEAR EDGE: input candle ${freshness.inputCandleTs} did not advance past previous prediction's input (${prevPredForModel?.input_candle_ts}).`
        : `Forced NO CLEAR EDGE: latest input candle ${freshness.inputCandleTs} is ${freshness.inputCandleAgeSeconds}s old.`;
      const forcedPayload = {
        symbol: "BTC-USDT",
        timeframe: "15m",
        model_version: settings.model_version,
        api_model_id: (settings as any).api_model_id || null,
        candle_ts: targetCandleTs,
        prediction: "NO CLEAR EDGE",
        confidence: 0,
        btc_price_at_prediction: Number(last.close),
        setup_type: !advanceCheckPassed ? "NO_ADVANCE_FORCED_SKIP" : "STALE_INPUT_FORCED_SKIP",
        market_condition: null,
        reasoning_summary: staleMessage,
        full_ai_response: {
          forced_no_clear_edge: true,
          reason: !advanceCheckPassed ? "no_advance_since_last_prediction" : "stale_input_features",
          input_candle_ts: freshness.inputCandleTs,
          input_candle_age_seconds: freshness.inputCandleAgeSeconds,
          previous_input_candle_ts: prevPredForModel?.input_candle_ts ?? null,
          freshness_action: freshnessAction,
          current_candle_partial: partial,
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
        ...partialCols,
        partial_agreement: "nce" as const,
        config_hash: computeConfigHash(settings as Record<string, unknown>),
        agreement_gate_applied: false,
        agreement_gate_reason: "n/a_nce",
        final_trade_status: "AVOID",
      };



      const { data: forced, error: forcedErr } = await supabase
        .from("predictions")
        .insert(forcedPayload as any)
        .select()
        .single();
      if (forcedErr) throw forcedErr;

      await supabase.from("api_runs").insert({
        run_type: "run-ai-prediction",
        request_payload: { skipped_openai: true, reason: forcedPayload.full_ai_response.reason, freshness: forcedPayload.full_ai_response },
        response_payload: { prediction_id: forced.id, prediction: forced.prediction, duration_ms: Date.now() - started },
        success: true,
      });

      return forced;
    }

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set. Add it in project settings.");
    }



    // Most recent 80 candles, including the live in-progress candle when present.
    const candlesForPrompt = ordered
      .slice(-80)
      .map((c) => ({
        t: c.candle_ts,
        o: Number(c.open),
        h: Number(c.high),
        l: Number(c.low),
        c: Number(c.close),
        v: Number(c.volume),
        confirm: (c as PredictionCandle).confirm ?? true,
      }));

    const instructions =
      (settings.prompt_template as string)?.trim() || DEFAULT_INSTRUCTIONS;
    const rawModelId = ((settings as any).api_model_id as string)?.trim() || "gpt-4o";
    // If the configured api_model_id is a spec id (not a real OpenAI model), use gpt-4o and pass the spec id in the prompt.
    const isLikelyOpenAiModel = /^(gpt|o\d|chatgpt|text-)/i.test(rawModelId);
    const modelId = isLikelyOpenAiModel ? rawModelId : "gpt-4o";
    const specModelId = isLikelyOpenAiModel ? null : rawModelId;

    const inputPayload = {
      symbol: "BTCUSDT",
      interval: "15m",
      run_type: "Run Next",
      spec_model_id: specModelId,
      model_version: settings.model_version,
      candles: candlesForPrompt,
      computed_indicators: {
        input_candle_ts: freshness.inputCandleTs,
        input_candle_age_seconds: freshness.inputCandleAgeSeconds,
        input_features_fresh: freshness.inputFeaturesFresh,
        trend: indicators.trend,
        ema9: indicators.ema9,
        ema21: indicators.ema21,
        ema50: indicators.ema50,
        body_pct: indicators.bodyPct,
        upper_wick_pct: indicators.upperWickPct,
        lower_wick_pct: indicators.lowerWickPct,
        range_20_high: indicators.range20High,
        range_20_low: indicators.range20Low,
        volume_expansion: indicators.volumeExpansion,
        failed_breakout_up: indicators.failedBreakoutUp,
        failed_breakout_down: indicators.failedBreakoutDown,
        choppy: indicators.choppy,
      },
      model_settings: {
        confidence_threshold: settings.confidence_threshold,
        indicator_weights: settings.indicator_weights,
      },
      orderbook_aggregate: null as unknown,
      recent_prediction_context: null as unknown,
      current_candle_partial: partial
        ? {
            start_ts: partial.start_ts,
            minutes_elapsed: partial.minutes_elapsed,
            o: partial.open,
            h: partial.high,
            l: partial.low,
            c: partial.close,
            v: partial.volume,
            source: partial.source,
            note: "This is the CURRENTLY-FORMING (unconfirmed) candle, sampled in real time. Use it for momentum/level-reclaim reads on the candle just before the target. It is NOT lookahead — the target candle has not opened yet.",
          }
        : null,
    };

    // Recent prediction context for 2.3.2 continuation guard
    try {
      const { data: recent } = await supabase
        .from("predictions")
        .select("prediction, status, setup_type, candle_ts, resolved_at, input_features_fresh")
        .in("status", ["win", "loss", "push"])
        .order("candle_ts", { ascending: false })
        .limit(8);
      const arr = (recent ?? []).filter((r) => r.input_features_fresh === true);
      const lastResolved = arr.find((r) => r.status === "win" || r.status === "loss") ?? null;
      // Count same-direction losses in last 4 resolved (win/loss only)
      const last4 = arr.filter((r) => r.status === "win" || r.status === "loss").slice(0, 4);
      const lastDir = lastResolved?.prediction ?? null;
      const sameDirLossStreak = lastDir
        ? last4.filter((r) => r.prediction === lastDir && r.status === "loss").length
        : 0;
      (inputPayload as Record<string, unknown>).recent_prediction_context = {
        previous_directional_call: lastResolved?.prediction ?? null,
        previous_directional_result: lastResolved?.status ?? null,
        previous_setup_type: lastResolved?.setup_type ?? null,
        same_direction_loss_streak_count: sameDirLossStreak,
        recent_calls: arr.map((r) => ({
          candle_ts: r.candle_ts,
          prediction: r.prediction,
          result: r.status,
          setup_type: r.setup_type,
        })),
      };
    } catch {
      (inputPayload as Record<string, unknown>).recent_prediction_context = { enabled: false };
    }

    let orderbookAggregate: Record<string, unknown> | null = null;
    try {
      const { fetchBinanceOrderbookAggregate } = await import("./orderbook.server");
      orderbookAggregate = (await fetchBinanceOrderbookAggregate()) as unknown as Record<string, unknown>;
    } catch (e) {
      orderbookAggregate = { enabled: false, fetch_error: e instanceof Error ? e.message : String(e) };
    }
    (inputPayload as Record<string, unknown>).orderbook_aggregate = orderbookAggregate;

    // -------- Partial-candle module context for the prompt (uses pre-computed derived values) --------
    let partialModule: Record<string, unknown> = {
      partial_snapshot_present: false,
      degraded_mode: true,
      note: "current_partial_snapshot missing after DB + OKX + Binance + Coinbase + spot ticker attempts",
    };
    if (partial) {
      const completeness = partialDerived.completeness ?? 0;
      partialModule = {
        partial_snapshot_present: true,
        source_path: partialPath,
        synthesized: partialSynthesized,
        completeness,
        minutes_elapsed: partial.minutes_elapsed,
        partial_direction: partialDerived.direction,
        partial_close_position_pct: partialDerived.closePositionPct != null ? Number(partialDerived.closePositionPct.toFixed(3)) : null,
        partial_range_vs_atr: partialDerived.rangeVsAtr != null ? Number(partialDerived.rangeVsAtr.toFixed(3)) : null,
        partial_body_strength: partialDerived.bodyStrength != null ? Number(partialDerived.bodyStrength.toFixed(3)) : null,
        upper_wick_pct: partialDerived.upperWickPct != null ? Number(partialDerived.upperWickPct.toFixed(3)) : null,
        lower_wick_pct: partialDerived.lowerWickPct != null ? Number(partialDerived.lowerWickPct.toFixed(3)) : null,
        partial_vwap_event: partialDerived.vwapEvent,
        vwap_at_snapshot: vwap20,
        atr_14: atr14,
        last_completed_close: lastCompletedClose,
        feed_mismatch: partialDerived.feedMismatch,
        degraded_mode: partialSynthesized || partialDerived.feedMismatch,
        trust_tier:
          completeness >= 0.8 ? "full_trust" : completeness >= 0.53 ? "partial_trust" : "low_trust",
        completeness_weight_multiplier:
          completeness >= 0.8 ? 1.0 : completeness >= 0.53 ? 0.6 : 0.3,
      };
    }
    (inputPayload as Record<string, unknown>).partial_candle_module = partialModule;


    const partialModuleAddendum = `

PARTIAL CANDLE MODULE (Pass 2 — bounded adjustment only): current_partial_snapshot_json describes the candle currently forming. It is ONE input among fifteen weighted modules, worth at most 12 of 100 points after the completeness multiplier. Your base directional read (Pass 1) must be derived entirely from completed candles. The forming candle confirms, cautions, or in rare cases vetoes — it does not replace the base read. Do not default to predicting the forming candle's direction. Completeness tiers: >=0.80 full trust multiplier 1.0 with override power; 0.53–0.79 multiplier 0.6 no override; <0.53 multiplier 0.3 no override. Missing/invalid/feed_mismatch = degraded_mode, 0 points, confidence cap 60. Scoring (take highest matching rule, apply multiplier, cap 12): Bullish: 12 if green+close_pct>=0.65+range_vs_atr>=0.5; 9 if vwap_reclaim+close_pct>=0.55; 7 if green+close_pct>=0.5; 5 if red+lower_wick>=0.5+close_pct>=0.5. Bearish: 12 if red+close_pct<=0.35+range_vs_atr>=0.5; 9 if vwap_loss+close_pct<=0.45; 7 if red+close_pct<=0.5; 5 if green+upper_wick>=0.5+close_pct<=0.5. Halve extension points if range_vs_atr>=1.5 AND |close-vwap|>=1.25atr. Hard veto->NCE: opposing+close_pct<=0.20/>=0.80+range_vs_atr>=1.0+vwap confirms. Soft veto: opposing+close_pct<=0.30/>=0.70+range_vs_atr>=0.6->cap 62+margin>=12. Conflict downgrade: disagree+range_vs_atr>=0.75+completeness>=0.80->subtract 5, AVOID if <60.`;

    const model5Addendum = isModel5(settings.model_version)
      ? `

MODEL 5 AGREEMENT MONEY GATE (v5.0 — MUST enforce before finalizing trade_status).

You are running Model 5. All Model 4 logic above stays intact. Two additional trade-gating rules apply AFTER scoring, overrides, and vetoes:

  RULE A — Universal agreement gate:
    - If partial_agreement = "disagree" → trade_status MUST be "AVOID" (or "SKIP"). Never flip the prediction to the opposite side; keep the directional call, only withhold the bet.
    - If partial_agreement IN ("agree", "neutral") → gate passes for RULE A.

  RULE B — Strong/premium demotion (stricter than Rule A):
    - If final_interpretation / setup_type is "strong_directional" or "premium_directional", trade_status = "TRADE" REQUIRES partial_agreement = "agree". "neutral" is NOT sufficient for these two tiers. If neutral or disagree → trade_status = "AVOID".
    - All other setup tiers use RULE A only.

  RULE C — Always log:
    - Still produce the full prediction (call, confidence, all tracking fields) even when the gate withholds the bet. Shadow data is free.
    - Include top-level "agreement_gate_applied" (boolean) and "agreement_gate_reason" (short string: "disagree", "strong_requires_agree", "premium_requires_agree", "pass", or "n/a_nce") in your JSON output.

Server enforces these rules regardless of your output — but you must reason about them and set trade_status consistently.`
      : "";




    aiPayload = {
      model: modelId,
      instructions: `${instructions}\n${partialModuleAddendum}${model5Addendum}\n\nRespond with JSON only.`,
      input: `Return your prediction as JSON. Input data:\n${JSON.stringify(inputPayload)}`,
      text: { format: { type: "json_object" } },
      max_output_tokens: 4096,
    };


    const res = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(aiPayload),
    });
    const json = await res.json();
    aiResponse = json;
    if (!res.ok) {
      throw new Error(
        `OpenAI ${res.status}: ${json.error?.message ?? JSON.stringify(json)}`,
      );
    }

    // Robustly extract text from Responses API across output item shapes
    const extractText = (j: Record<string, unknown>): string => {
      if (typeof j.output_text === "string" && j.output_text) return j.output_text;
      const out = j.output as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(out)) {
        const parts: string[] = [];
        for (const item of out) {
          const content = item.content as Array<Record<string, unknown>> | undefined;
          if (Array.isArray(content)) {
            for (const c of content) {
              if (typeof c.text === "string") parts.push(c.text);
              else if (c.text && typeof (c.text as Record<string, unknown>).value === "string") {
                parts.push((c.text as { value: string }).value);
              }
            }
          }
        }
        if (parts.length) return parts.join("");
      }
      const choices = j.choices as Array<Record<string, unknown>> | undefined;
      const msg = choices?.[0]?.message as Record<string, unknown> | undefined;
      if (msg && typeof msg.content === "string") return msg.content;
      return "";
    };
    const text: string = extractText(json);
    if (!text) {
      const status = (json as { status?: string }).status;
      const incomplete = (json as { incomplete_details?: { reason?: string } }).incomplete_details?.reason;
      throw new Error(
        `OpenAI returned empty output (status=${status ?? "unknown"}${incomplete ? `, reason=${incomplete}` : ""}). Model "${modelId}" may not exist or hit token limits.`,
      );
    }


    let parsed: AiOutput;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("AI returned non-JSON content");
      parsed = JSON.parse(m[0]);
    }

    const rawCall = (parsed.call ?? parsed.prediction ?? "").toString().toUpperCase().trim();
    if (rawCall !== "YES" && rawCall !== "NO" && rawCall !== "NO CLEAR EDGE") {
      throw new Error("AI call must be YES, NO, or NO CLEAR EDGE");
    }

    // Confidence may arrive as "3/5", "3", or 60. Normalize to 0-100.
    const parseConfidence = (v: unknown): number => {
      if (typeof v === "number") return v <= 5 ? v * 20 : v;
      if (typeof v === "string") {
        const frac = v.match(/(\d+(?:\.\d+)?)\s*\/\s*5/);
        if (frac) return Math.round(parseFloat(frac[1]) * 20);
        const n = parseFloat(v);
        if (!isNaN(n)) return n <= 5 ? n * 20 : n;
      }
      return 0;
    };
    const confidence100 = parseConfidence(parsed.confidence);

    // NO CLEAR EDGE still stays pending until the candle closes so actual OHLC/direction is logged.
    const isSkip = rawCall === "NO CLEAR EDGE";
    const status = isSkip
      ? "pending"
      : settings.require_manual_approval
        ? "manual_review"
        : "pending";

    const notesParts = [
      parsed.notes ?? parsed.reasoning_summary ?? null,
      parsed.flip_level ? `flip: ${parsed.flip_level}` : null,
      parsed.confirmation_level ? `confirm: ${parsed.confirmation_level}` : null,
      parsed.trade_status ? `trade: ${parsed.trade_status}` : null,
    ].filter(Boolean);

    // Compute agreement server-side (cross-check vs model-emitted value).
    const serverAgreement: "agree" | "disagree" | "neutral" | "nce" | "missing" = (() => {
      if (rawCall === "NO CLEAR EDGE") return "nce";
      if (!partialCols.partial_snapshot_present) return "missing";
      const d = partialCols.partial_direction;
      if (d === "flat") return "neutral";
      if ((d === "green" && rawCall === "YES") || (d === "red" && rawCall === "NO")) return "agree";
      if ((d === "green" && rawCall === "NO") || (d === "red" && rawCall === "YES")) return "disagree";
      return "missing";
    })();
    const parsedRec = parsed as unknown as Record<string, unknown>;
    const modelAgreementRaw = String(parsedRec.partial_agreement ?? "").toLowerCase();
    const allowedAgreement = new Set(["agree", "disagree", "neutral", "nce", "missing"]);
    if (allowedAgreement.has(modelAgreementRaw) && modelAgreementRaw !== serverAgreement) {
      await supabase.from("api_runs").insert({
        run_type: "partial-agreement-mismatch",
        request_payload: { model_agreement: modelAgreementRaw, server_agreement: serverAgreement, partial_direction: partialCols.partial_direction, prediction: rawCall },
        response_payload: null,
        success: false,
        error_message: `Model-reported partial_agreement '${modelAgreementRaw}' != server-computed '${serverAgreement}'`,
      });
    }

    const asBool = (v: unknown): boolean => v === true || v === "true" || v === 1;
    const asNum = (v: unknown): number => {
      const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
      return Number.isFinite(n) ? n : 0;
    };
    const vetoTierRaw = String(parsedRec.partial_veto_tier ?? "none").toLowerCase();
    const vetoTier: "hard" | "soft" | "none" = vetoTierRaw === "hard" || vetoTierRaw === "soft" ? vetoTierRaw : "none";
    const vetoDirRaw = String(parsedRec.partial_veto_direction ?? "").toLowerCase();
    const vetoDirection: "blocked_yes" | "blocked_no" | null =
      vetoDirRaw === "blocked_yes" || vetoDirRaw === "blocked_no" ? vetoDirRaw : null;

    // ---- Model 5 agreement money gate (server-enforced) ----
    const modelReportedTradeStatusRaw = String(parsed.trade_status ?? "").toUpperCase().trim();
    const rawSetupLabel = String(parsed.final_interpretation ?? parsed.setup_type ?? "").toLowerCase();
    const isStrong = /strong_directional/.test(rawSetupLabel);
    const isPremium = /premium_directional/.test(rawSetupLabel);
    const model5Active = isModel5(settings.model_version);
    let agreementGateApplied = false;
    let agreementGateReason: string | null = null;
    let finalTradeStatus: string | null = modelReportedTradeStatusRaw || null;

    if (model5Active) {
      if (rawCall === "NO CLEAR EDGE") {
        agreementGateReason = "n/a_nce";
        finalTradeStatus = "SKIP";
      } else if (serverAgreement === "disagree") {
        agreementGateApplied = true;
        agreementGateReason = "disagree";
        finalTradeStatus = "AVOID";
      } else if ((isStrong || isPremium) && serverAgreement !== "agree") {
        agreementGateApplied = true;
        agreementGateReason = isPremium ? "premium_requires_agree" : "strong_requires_agree";
        finalTradeStatus = "AVOID";
      } else {
        agreementGateReason = "pass";
        if (!finalTradeStatus) finalTradeStatus = "TRADE";
      }

    }

    const gateNote = agreementGateApplied
      ? `Model5 gate: AVOID (${agreementGateReason})`
      : null;
    if (gateNote) notesParts.push(gateNote);

    const configHash = computeConfigHash(settings as Record<string, unknown>);

    // ---- Score-detail extraction (from parsed AI response) ----
    const asOptNum = (v: unknown): number | null => {
      if (v === null || v === undefined || v === "") return null;
      const n = typeof v === "number" ? v : parseFloat(String(v));
      return Number.isFinite(n) ? n : null;
    };
    const baseBullishScore = asOptNum(parsedRec.base_bullish_score);
    const baseBearishScore = asOptNum(parsedRec.base_bearish_score);
    const bullishScore = asOptNum(parsedRec.bullish_score);
    const bearishScore = asOptNum(parsedRec.bearish_score);
    let scoreMargin = asOptNum(parsedRec.score_margin);
    let bullishScoreFinal = bullishScore;
    let bearishScoreFinal = bearishScore;
    let scoreSumMismatch = false;

    // ---- Server-enforce scores from module_points sum ----
    if (parsedRec.module_points && typeof parsedRec.module_points === "object") {
      const mp = parsedRec.module_points as Record<string, { bull?: number; bear?: number }>;
      const serverBull = Object.values(mp).reduce((s, m) => s + (Number(m?.bull) || 0), 0);
      const serverBear = Object.values(mp).reduce((s, m) => s + (Number(m?.bear) || 0), 0);
      const serverMargin = Math.abs(serverBull - serverBear);

      const modelBull = bullishScore ?? 0;
      const modelBear = bearishScore ?? 0;
      if (Math.abs(serverBull - modelBull) > 1 || Math.abs(serverBear - modelBear) > 1) {
        scoreSumMismatch = true;
        console.warn("Score mismatch:", {
          modelBull, serverBull,
          modelBear, serverBear,
        });
      }

      bullishScoreFinal = serverBull;
      bearishScoreFinal = serverBear;
      scoreMargin = serverMargin;
    }
    const originalPredictionBeforePartial = parsedRec.original_prediction_before_partial != null
      ? String(parsedRec.original_prediction_before_partial)
      : null;
    const changedByPartial = parsedRec.changed_by_partial === undefined || parsedRec.changed_by_partial === null
      ? null
      : asBool(parsedRec.changed_by_partial);
    const changeReason = parsedRec.change_reason != null ? String(parsedRec.change_reason) : null;
    const modulePoints = (parsedRec.module_points && typeof parsedRec.module_points === "object")
      ? (parsedRec.module_points as Record<string, unknown>)
      : null;

    // ---- Server-enforced setup_type derived from final score_margin ----
    const finalMargin = scoreMargin ?? 0;
    const finalPrediction = rawCall;

    let serverSetupType: string;
    if (finalPrediction === 'NO CLEAR EDGE') {
      serverSetupType = 'no_clear_edge';
    } else if (finalMargin >= 22) {
      serverSetupType = 'premium_directional';
    } else if (finalMargin >= 16) {
      serverSetupType = 'strong_directional';
    } else if (finalMargin >= 10) {
      serverSetupType = 'standard_directional';
    } else if (finalMargin >= 7) {
      serverSetupType = 'low_confidence_directional';
    } else {
      serverSetupType = 'no_clear_edge';
    }

    // Re-run Model 5 agreement gate against server-computed setup_type
    // (setup_type is now authoritative; the gate must operate on it, not the model narrative).
    if (model5Active && rawCall !== "NO CLEAR EDGE" && serverAgreement !== "disagree") {
      const serverIsStrong = serverSetupType === "strong_directional";
      const serverIsPremium = serverSetupType === "premium_directional";
      if ((serverIsStrong || serverIsPremium) && serverAgreement !== "agree") {
        agreementGateApplied = true;
        agreementGateReason = serverIsPremium ? "premium_requires_agree" : "strong_requires_agree";
        finalTradeStatus = "AVOID";
        notesParts.push(`Model5 gate: AVOID (${agreementGateReason})`);
      }
    }

    const insertPayload = {
      symbol: "BTC-USDT",
      timeframe: "15m",
      model_version: settings.model_version,
      api_model_id: (settings as any).api_model_id || null,
      candle_ts: targetCandleTs,
      prediction: rawCall,
      confidence: confidence100,
      btc_price_at_prediction: last.close,
      setup_type: serverSetupType,
      market_condition: parsed.market_condition ?? null,
      reasoning_summary: notesParts.join(" • ") || null,
      full_ai_response: {
        ...(json as Record<string, unknown>),
        partial_candle_module_context: partialModule,
        partial_candle_source_path: partialPath,
        partial_candle_attempts: partialAttempts,
        partial_candle_synthesized: partialSynthesized,
        model_reported_partial_agreement: modelAgreementRaw || null,
        server_computed_partial_agreement: serverAgreement,
        model_reported_trade_status: modelReportedTradeStatusRaw || null,
        model_reported_agreement_gate_applied: asBool(parsedRec.agreement_gate_applied),
        model_reported_agreement_gate_reason: String(parsedRec.agreement_gate_reason ?? "") || null,
        model_reported_setup_type: parsed.final_interpretation ?? parsed.setup_type ?? null,
        server_computed_setup_type: serverSetupType,
      },
      indicators: indicators as unknown as Record<string, unknown>,
      orderbook: orderbookAggregate,
      status,
      input_candle_ts: freshness.inputCandleTs,
      input_candle_age_seconds: freshness.inputCandleAgeSeconds,
      input_features_fresh: freshness.inputFeaturesFresh,
      freshness_action: freshnessAction,
      fetch_source: fetchSource,
      advance_check_passed: advanceCheckPassed,
      current_partial_minutes_elapsed: partial?.minutes_elapsed ?? null,
      current_partial_snapshot: partial as unknown as Record<string, unknown> | null,
      ...partialCols,
      partial_agreement: serverAgreement,
      partial_module_bull_pts: asNum(parsedRec.partial_module_bull_pts),
      partial_module_bear_pts: asNum(parsedRec.partial_module_bear_pts),
      partial_veto_active: asBool(parsedRec.partial_veto_active),
      partial_veto_tier: vetoTier,
      partial_veto_direction: vetoDirection,
      partial_hard_override_fired: asBool(parsedRec.partial_hard_override_fired),
      conflict_downgrade_applied: asBool(parsedRec.conflict_downgrade_applied),
      config_hash: configHash,
      agreement_gate_applied: agreementGateApplied,
      agreement_gate_reason: agreementGateReason,
      final_trade_status: finalTradeStatus,
      base_bullish_score: baseBullishScore,
      base_bearish_score: baseBearishScore,
      bullish_score: bullishScoreFinal,
      bearish_score: bearishScoreFinal,
      score_margin: scoreMargin,
      score_sum_mismatch: scoreSumMismatch,
      original_prediction_before_partial: originalPredictionBeforePartial,
      changed_by_partial: changedByPartial,
      change_reason: changeReason,
      module_points: modulePoints,
    };



    const { data: inserted, error: insErr } = await supabase
      .from("predictions")
      .insert(insertPayload as any)
      .select()
      .single();
    if (insErr) throw insErr;

    // NOTE: Do NOT emit prediction.created here. Variant B2 (the live model)
    // owns the single outbound prediction.created webhook — see
    // src/lib/model7/shadow.ts. Emitting a second one from the Model 6
    // insert path caused the trading bot to double-bet.


    await supabase.from("api_runs").insert({
      run_type: "run-ai-prediction",
      request_payload: { model: modelId, candle_count: candlesForPrompt.length, input_candle_ts: freshness.inputCandleTs, input_candle_age_seconds: freshness.inputCandleAgeSeconds, freshness_action: freshnessAction },
      response_payload: { prediction_id: inserted.id, confidence: inserted.confidence, prediction: inserted.prediction, duration_ms: Date.now() - started },
      success: true,
    });

    return inserted;
  } catch (e) {
    success = false;
    const errDetail =
      e instanceof Error
        ? { message: e.message, stack: e.stack }
        : typeof e === "object" && e !== null
          ? (e as Record<string, unknown>)
          : { message: String(e) };
    errorMessage =
      (errDetail as { message?: string }).message ?? JSON.stringify(errDetail);
    await supabase.from("api_runs").insert({
      run_type: "run-ai-prediction",
      request_payload: aiPayload as Record<string, unknown> | null,
      response_payload: {
        ai: aiResponse as Record<string, unknown> | null,
        error: errDetail,
      },
      success: false,
      error_message: errorMessage,
    });
    throw new Error(errorMessage);
  }
}

export async function resolvePredictionsServer(
  supabase: SupabaseClient,
  options: { watchMs?: number; pollMs?: number } = {},
) {
  const watchMs = Math.max(0, options.watchMs ?? 0);
  const pollMs = Math.max(1_000, options.pollMs ?? 3_000);
  const startedAt = Date.now();
  const deadline = startedAt + watchMs;
  let resolved = 0;
  let pendingCount = 0;
  let attempts = 0;
  const checked: Array<{ id: string; candle_ts: string; source: string; resolved: boolean; ticker?: string; error?: string }> = [];

  do {
    attempts++;
    const { data: pending, error } = await supabase
      .from("predictions")
      .select("id, prediction, candle_ts, symbol, timeframe")
      .eq("status", "pending")
      .order("candle_ts", { ascending: true })
      .limit(200);
    if (error) throw error;
    pendingCount = pending?.length ?? 0;

    let unresolvedClosed = 0;

    for (const p of pending ?? []) {
      const candleEndsAt = new Date(p.candle_ts).getTime() + TF_MS;
      // Check as soon as the target candle has closed. The boundary watcher
      // keeps polling for under a minute so Kalshi can finalize within seconds.
      if (Date.now() < candleEndsAt) continue;

      unresolvedClosed++;
      let resolution:
        | {
            result: "YES" | "NO" | "DOJI";
            candle: ResolutionCandle;
            source: string;
            ticker?: string;
            settlement_value?: number;
          }
        | null = null;

      // 1) Kalshi is the settlement source of truth (KXBTC15M — CF Benchmarks BRTI).
      const kalshi = await fetchKalshiResolution(p.candle_ts);

      // 2) Always try to fetch OHLC audit candle from OKX/Coinbase (used for
      //    audit columns even when Kalshi decides the outcome).
      const actual = await fetchActualResolutionCandle(p.candle_ts, TF_MS);
      const validOhlc =
        !!actual &&
        Number.isFinite(actual.open) && Number.isFinite(actual.close) &&
        Number.isFinite(actual.high) && Number.isFinite(actual.low) &&
        actual.open > 0 && actual.close > 0;

      if (kalshi) {
        // Fall back to a zeroed candle only if OHLC is unavailable — Kalshi
        // decides the outcome; OHLC is descriptive.
        const candle: ResolutionCandle = validOhlc
          ? (actual as ResolutionCandle)
          : { open: 0, high: 0, low: 0, close: 0, confirm: true };
        resolution = {
          result: kalshi.result,
          candle,
          source: `kalshi${validOhlc ? `+${(actual as any).source}` : ""}`,
          ticker: kalshi.ticker,
          settlement_value: kalshi.settlement_value,
        };
      } else if (actual) {
        if (!validOhlc) {
          await supabase.from("api_runs").insert({
            run_type: "resolve-predictions",
            request_payload: { prediction_id: p.id, candle_ts: p.candle_ts, source: actual.source },
            response_payload: { rejected: true, reason: "invalid_ohlc", actual },
            success: false,
            error_message: `Invalid OHLC from ${actual.source} for ${p.candle_ts}`,
          });
          if (checked.length < 30) {
            checked.push({ id: p.id, candle_ts: p.candle_ts, source: actual.source, resolved: false, error: "invalid_ohlc" });
          }
          continue;
        }
        // Kalshi not finalized yet — use OHLC-based fallback so we don't
        // block indefinitely if Kalshi is unreachable.
        resolution = { result: candleResult(actual), candle: actual, source: actual.source };
      }

      if (!resolution) {
        if (checked.length < 30) {
          checked.push({ id: p.id, candle_ts: p.candle_ts, source: "kalshi/okx/coinbase", resolved: false });
        }
        continue;
      }

      let status: "win" | "loss" | "push";
      if (resolution.result === "DOJI") status = "push";
      else if (p.prediction === "YES") status = resolution.result === "YES" ? "win" : "loss";
      else if (p.prediction === "NO") status = resolution.result === "NO" ? "win" : "loss";
      else status = "push";

      const hasOhlc = resolution.candle.open > 0;
      // Kalshi (KXBTC15M / CF Benchmarks BRTI) is authoritative for direction
      // when finalized; OHLC is descriptive only. On near-flat candles OKX/Coinbase
      // close-vs-open can disagree with Kalshi's BRTI settlement.
      const kalshiDir: "GREEN" | "RED" | null =
        kalshi ? (kalshi.result === "YES" ? "GREEN" : "RED") : null;
      const finalDirection: "GREEN" | "RED" | "DOJI" | null =
        kalshiDir ?? (hasOhlc ? (actualDirection(resolution.candle) as "GREEN" | "RED" | "DOJI") : null);
      const { error: updateError } = await supabase
        .from("predictions")
        .update({
          status,
          actual_next_candle_open: hasOhlc ? resolution.candle.open : null,
          actual_next_candle_high: hasOhlc ? resolution.candle.high : null,
          actual_next_candle_low: hasOhlc ? resolution.candle.low : null,
          actual_next_candle_close: hasOhlc ? resolution.candle.close : null,
          actual_direction: finalDirection,
          settlement_source: resolution.source,
          settlement_ticker: resolution.ticker ?? null,
          settlement_value: resolution.settlement_value ?? null,
          resolved_at: new Date().toISOString(),
        })

        .eq("id", p.id)
        .eq("status", "pending");
      if (updateError) {
        if (checked.length < 30) {
          checked.push({ id: p.id, candle_ts: p.candle_ts, source: resolution.source, resolved: false, ticker: resolution.ticker, error: updateError.message });
        }
        continue;
      }
      resolved++;
      if (checked.length < 30) {
        checked.push({ id: p.id, candle_ts: p.candle_ts, source: resolution.source, resolved: true, ticker: resolution.ticker });
      }
      // Fire prediction.resolved webhook (best-effort) — neutral B2-paired shape.
      try {
        const { data: full } = await supabase
          .from("predictions")
          .select("*")
          .eq("id", p.id)
          .maybeSingle();
        if (full) {
          const { data: b2 } = await supabase
            .from("model7_shadow")
            .select("id,decision,would_trade,probability_green")
            .eq("prediction_id", p.id)
            .eq("variant", "B2")
            .maybeSingle();
          const dirForPayload: "GREEN" | "RED" | "DOJI" | null = finalDirection;
          let b2Result: "win" | "loss" | "push" | null = null;
          if (b2 && dirForPayload) {
            if (dirForPayload === "DOJI") b2Result = "push";
            else if (b2.decision === "YES") b2Result = dirForPayload === "GREEN" ? "win" : "loss";
            else if (b2.decision === "NO") b2Result = dirForPayload === "RED" ? "win" : "loss";
            else b2Result = null; // SKIP / unknown → no bet was placed
          }
          const { deliverWebhook, buildResolvedWebhookPayload } = await import("./webhooks.server");
          await deliverWebhook(
            supabase,
            "prediction.resolved",
            buildResolvedWebhookPayload(full, b2 as Record<string, any> | null, dirForPayload, b2Result),
          );
        }
      } catch {
        // ignore — do not block resolution loop
      }
      // Grade Model 7 shadow rows for this prediction. Best-effort.
      try {
        // Kalshi-authoritative direction; fall back to OHLC / local candles only
        // when Kalshi hasn't finalized.
        let dir: "GREEN" | "RED" | "DOJI" | null = finalDirection;
        if (!dir) {
          const { data: c } = await supabase
            .from("candles")
            .select("open,close,high,low,confirm")
            .eq("candle_ts", p.candle_ts)
            .eq("confirm", true)
            .maybeSingle();
          if (c && Number(c.open) > 0 && Number(c.close) > 0) {
            dir = actualDirection({
              open: Number(c.open), high: Number(c.high), low: Number(c.low),
              close: Number(c.close), confirm: true,
            } as ResolutionCandle) as "GREEN" | "RED" | "DOJI";
          }
        }
        const { resolveShadowRowsFor } = await import("./model7/shadow");
        await resolveShadowRowsFor(supabase, p.id, dir);
      } catch { /* never block resolver on shadow */ }


    }

    if (!watchMs || Date.now() >= deadline || unresolvedClosed === 0) {
      break;
    }
    const waitMs = Math.min(pollMs, Math.max(0, deadline - Date.now()));
    if (waitMs > 0) {
      await new Promise((res) => setTimeout(res, waitMs));
    }
  } while (Date.now() < deadline);

  // Reconciliation pass: re-check recently-resolved predictions that fell back
  // to OHLC because Kalshi wasn't finalized yet. Kalshi is source of truth —
  // if it now disagrees with the OHLC-based grade, correct the row.
  let reconciled = 0;
  const reconciledDetails: Array<{ id: string; from: string; to: string; ticker?: string }> = [];
  try {
    const cutoffIso = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
    const { data: recent } = await supabase
      .from("predictions")
      .select("id, prediction, candle_ts, status, settlement_source")
      .in("status", ["win", "loss", "push"])
      .gte("candle_ts", cutoffIso)
      .order("candle_ts", { ascending: false })
      .limit(50);
    for (const p of recent ?? []) {
      const src = ((p as { settlement_source?: string }).settlement_source ?? "") as string;
      if (src.startsWith("kalshi")) continue;
      const kalshi = await fetchKalshiResolution(p.candle_ts);
      if (!kalshi) continue;
      let newStatus: "win" | "loss" | "push";
      if (p.prediction === "YES") newStatus = kalshi.result === "YES" ? "win" : "loss";
      else if (p.prediction === "NO") newStatus = kalshi.result === "NO" ? "win" : "loss";
      else newStatus = "push";
      if (newStatus === p.status) {
        await supabase
          .from("predictions")
          .update({
            settlement_source: `kalshi+${src || "reconciled"}`,
            settlement_ticker: kalshi.ticker,
            settlement_value: kalshi.settlement_value ?? null,
          })
          .eq("id", p.id);
        continue;
      }
      await supabase
        .from("predictions")
        .update({
          status: newStatus,
          actual_direction: kalshi.result === "YES" ? "GREEN" : kalshi.result === "NO" ? "RED" : "DOJI",
          settlement_source: `kalshi+${src || "reconciled"}`,
          settlement_ticker: kalshi.ticker,
          settlement_value: kalshi.settlement_value ?? null,
          resolved_at: new Date().toISOString(),
        })
        .eq("id", p.id);
      reconciled++;
      if (reconciledDetails.length < 20) {
        reconciledDetails.push({ id: p.id, from: p.status as string, to: newStatus, ticker: kalshi.ticker });
      }
    }
  } catch {
    // best-effort — never fail resolve loop on reconcile errors
  }

  await supabase.from("api_runs").insert({
    run_type: "resolve-predictions",
    request_payload: { pending_count: pendingCount, watch_ms: watchMs },
    response_payload: { resolved, checked, resolver: "kalshi_primary_okx_coinbase_fallback", attempts, reconciled, reconciledDetails },
    success: true,
  });

  // Trigger Model 7 Variant B retrain if enough new resolved rows have landed.
  if (resolved > 0) {
    try {
      const { data: activeSettings } = await supabase
        .from("model_settings").select("model_version").eq("is_active", true).maybeSingle();
      const tmv = (activeSettings?.model_version as string | undefined) ?? "6.0";
      const { maybeRetrainVariantB } = await import("./model7/trainer");
      const fit = await maybeRetrainVariantB(supabase, tmv);
      if (fit) {
        await supabase.from("api_runs").insert({
          run_type: "model7-variant-b-retrain",
          response_payload: fit as unknown as Record<string, unknown>,
          success: fit.fitted,
        });
      }
    } catch (e) {
      await supabase.from("api_runs").insert({
        run_type: "model7-variant-b-retrain",
        response_payload: { error: e instanceof Error ? e.message : String(e) },
        success: false,
        error_message: e instanceof Error ? e.message : String(e),
      });
    }
  }

  return { resolved, pending: pendingCount, attempts, reconciled };
}
