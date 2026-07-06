// Server-only AI prediction + resolution logic. Imported by server fns and the cron route.
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeIndicatorBundle, type Candle } from "./indicators";
import {
  fetchAndUpsertCandles,
  fetchOkxClosedCandle,
  fetchCurrentPartialCandle,
  type PartialCandle,
} from "./okx.server";
import { fetchKalshiResolution } from "./kalshi.server";

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

export async function runAiPredictionServer(supabase: SupabaseClient) {
  const started = Date.now();
  let aiPayload: unknown = null;
  let aiResponse: unknown = null;
  let success = true;
  let errorMessage: string | null = null;

  try {
    let ordered = await loadPredictionCandles(supabase);
    if (ordered.length < 30)
      throw new Error("Not enough candle history. Click Refresh Candles first.");

    let latestInput = ordered[ordered.length - 1];
    let freshness = freshnessFor(latestInput.candle_ts);
    let freshnessAction = freshness.inputFeaturesFresh ? "fresh" : "stale_refetch_attempted";
    let fetchSource: "okx" | "coinbase" | null = null;

    if (!freshness.inputFeaturesFresh) {
      try {
        const refresh = await fetchAndUpsertCandles(supabase);
        fetchSource = refresh.primary_source;
        ordered = await loadPredictionCandles(supabase);
        if (ordered.length < 30) throw new Error("Not enough candle history after refresh.");
        latestInput = ordered[ordered.length - 1];
        freshness = freshnessFor(latestInput.candle_ts);
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

    const indicators = computeIndicatorBundle(ordered);
    if (!indicators) throw new Error("Failed to compute indicators");

    const last = indicators.last;
    // Target candle = the UPCOMING candle (next 15m boundary). Cron fires ~1m
    // before that boundary so we predict the candle about to open.
    const targetCandleTs = new Date(Math.ceil(Date.now() / TF_MS) * TF_MS).toISOString();

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

    // Fetch the currently-forming candle (best-effort — never blocks predict).
    let partial: PartialCandle | null = null;
    try {
      partial = await fetchCurrentPartialCandle();
    } catch {
      partial = null;
    }

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


    aiPayload = {
      model: modelId,
      instructions: `${instructions}\n\nRespond with JSON only.`,
      input: `Return your prediction as JSON. Input data:\n${JSON.stringify(inputPayload)}`,
      text: { format: { type: "json_object" } },
      max_output_tokens: 2048,
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

    const insertPayload = {
      symbol: "BTC-USDT",
      timeframe: "15m",
      model_version: settings.model_version,
      api_model_id: (settings as any).api_model_id || null,
      candle_ts: targetCandleTs,
      prediction: rawCall,
      confidence: confidence100,
      btc_price_at_prediction: last.close,
      setup_type: parsed.final_interpretation ?? parsed.setup_type ?? null,
      market_condition: parsed.market_condition ?? null,
      reasoning_summary: notesParts.join(" • ") || null,
      full_ai_response: json,
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
    };

    const { data: inserted, error: insErr } = await supabase
      .from("predictions")
      .insert(insertPayload as any)
      .select()
      .single();
    if (insErr) throw insErr;

    // Fire prediction.created webhooks (best-effort; failure logged, not fatal)
    try {
      const { deliverWebhook, buildPredictionPayload } = await import("./webhooks.server");
      await deliverWebhook(supabase, "prediction.created", buildPredictionPayload(inserted));
    } catch (whErr) {
      await supabase.from("api_runs").insert({
        run_type: "webhook-created-error",
        response_payload: { error: whErr instanceof Error ? whErr.message : String(whErr), prediction_id: inserted.id },
        success: false,
        error_message: whErr instanceof Error ? whErr.message : String(whErr),
      });
    }

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
        | { result: "YES" | "NO" | "DOJI"; candle: ResolutionCandle; source: string; ticker?: string }
        | null = null;

      const actual = await fetchActualResolutionCandle(p.candle_ts, TF_MS);
      if (actual) {
        const validOhlc =
          Number.isFinite(actual.open) && Number.isFinite(actual.close) &&
          Number.isFinite(actual.high) && Number.isFinite(actual.low) &&
          actual.open > 0 && actual.close > 0;
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
        resolution = { result: candleResult(actual), candle: actual, source: actual.source };
      }

      if (!resolution) {
        if (checked.length < 30) {
          checked.push({ id: p.id, candle_ts: p.candle_ts, source: "okx/coinbase", resolved: false });
        }
        continue;
      }

      let status: "win" | "loss" | "push";
      if (resolution.result === "DOJI") status = "push";
      else if (p.prediction === "YES") status = resolution.result === "YES" ? "win" : "loss";
      else if (p.prediction === "NO") status = resolution.result === "NO" ? "win" : "loss";
      else status = "push";

      const { error: updateError } = await supabase
        .from("predictions")
        .update({
          status,
          actual_next_candle_open: resolution.candle.open,
          actual_next_candle_high: resolution.candle.high,
          actual_next_candle_low: resolution.candle.low,
          actual_next_candle_close: resolution.candle.close,
          actual_direction: actualDirection(resolution.candle),
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
      // Fire prediction.resolved webhook (best-effort)
      try {
        const { data: full } = await supabase
          .from("predictions")
          .select("*")
          .eq("id", p.id)
          .maybeSingle();
        if (full) {
          const { deliverWebhook, buildPredictionPayload } = await import("./webhooks.server");
          await deliverWebhook(supabase, "prediction.resolved", buildPredictionPayload(full));
        }
      } catch {
        // ignore — do not block resolution loop
      }
    }

    if (!watchMs || Date.now() >= deadline || unresolvedClosed === 0) {
      break;
    }
    const waitMs = Math.min(pollMs, Math.max(0, deadline - Date.now()));
    if (waitMs > 0) {
      await new Promise((res) => setTimeout(res, waitMs));
    }
  } while (Date.now() < deadline);

  await supabase.from("api_runs").insert({
    run_type: "resolve-predictions",
    request_payload: { pending_count: pendingCount, watch_ms: watchMs },
    response_payload: { resolved, checked, resolver: "okx_primary_coinbase_fallback", attempts },
    success: true,
  });

  return { resolved, pending: pendingCount, attempts };
}
