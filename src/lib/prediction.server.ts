// Server-only AI prediction + resolution logic. Imported by server fns and the cron route.
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeIndicatorBundle, nextCandleTs, type Candle } from "./indicators";

const DEFAULT_INSTRUCTIONS =
  "You are running BTCUSDT 15m Model 2 — reduced filter. Use only the supplied closed candles. Make a Run Next prediction for the next 15m candle. Return JSON only with fields: prediction (YES or NO), confidence (0-100), setup_type, market_condition, reasoning_summary, indicators (object of short strings).";


interface AiOutput {
  prediction: "YES" | "NO";
  confidence: number;
  setup_type: string;
  market_condition: string;
  reasoning_summary: string;
  indicators: Record<string, string>;
}

export async function runAiPredictionServer(supabase: SupabaseClient) {
  const started = Date.now();
  let aiPayload: unknown = null;
  let aiResponse: unknown = null;
  let success = true;
  let errorMessage: string | null = null;

  try {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set. Add it in project settings.");
    }

    const { data: candles, error: cErr } = await supabase
      .from("candles")
      .select("candle_ts, open, high, low, close, volume")
      .eq("symbol", "BTC-USDT")
      .eq("timeframe", "15m")
      .order("candle_ts", { ascending: false })
      .limit(100);
    if (cErr) throw cErr;
    if (!candles || candles.length < 30)
      throw new Error("Not enough candle history. Click Refresh Candles first.");

    const ordered: Candle[] = candles.slice().reverse() as Candle[];
    const indicators = computeIndicatorBundle(ordered);
    if (!indicators) throw new Error("Failed to compute indicators");

    const { data: settings } = await supabase
      .from("model_settings")
      .select("*")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (!settings) throw new Error("No active model settings");

    const last = indicators.last;
    const lastCandleTs = last.candle_ts;
    const targetCandleTs = nextCandleTs(lastCandleTs);

    // Only closed/confirmed candles, most recent 80
    const closedCandles = ordered.filter((c) => (c as Candle & { confirm?: boolean }).confirm !== false);
    const candlesForPrompt = (closedCandles.length >= 30 ? closedCandles : ordered)
      .slice(-80)
      .map((c) => ({
        t: c.candle_ts,
        o: Number(c.open),
        h: Number(c.high),
        l: Number(c.low),
        c: Number(c.close),
        v: Number(c.volume),
      }));

    const instructions =
      (settings.prompt_template as string)?.trim() || DEFAULT_INSTRUCTIONS;
    const modelId = (settings.model_version as string) || "gpt-5.5";

    const inputPayload = {
      symbol: "BTCUSDT",
      interval: "15m",
      run_type: "Run Next",
      candles: candlesForPrompt,
      computed_indicators: {
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
    };

    aiPayload = {
      model: modelId,
      instructions,
      input: JSON.stringify(inputPayload),
      text: { format: { type: "json_object" } },
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

    const text: string =
      json.output_text ??
      json.output?.[0]?.content?.[0]?.text ??
      json.choices?.[0]?.message?.content ??
      "";
    if (!text) throw new Error("OpenAI returned empty output");

    let parsed: AiOutput;
    try {
      parsed = JSON.parse(text);
    } catch {
      const m = text.match(/\{[\s\S]*\}/);
      if (!m) throw new Error("AI returned non-JSON content");
      parsed = JSON.parse(m[0]);
    }

    if (parsed.prediction !== "YES" && parsed.prediction !== "NO") {
      throw new Error("AI prediction must be YES or NO");
    }

    const status =
      settings.require_manual_approval ? "manual_review" : "pending";

    const { data: inserted, error: insErr } = await supabase
      .from("predictions")
      .insert({
        symbol: "BTC-USDT",
        timeframe: "15m",
        model_version: settings.model_version,
        candle_ts: targetCandleTs,
        prediction: parsed.prediction,
        confidence: Number(parsed.confidence) || 0,
        btc_price_at_prediction: last.close,
        setup_type: parsed.setup_type ?? null,
        market_condition: parsed.market_condition ?? null,
        reasoning_summary: parsed.reasoning_summary ?? null,
        full_ai_response: json,
        indicators: indicators as unknown as Record<string, unknown>,
        status,
      })
      .select()
      .single();
    if (insErr) throw insErr;

    await supabase.from("api_runs").insert({
      run_type: "run-ai-prediction",
      request_payload: { model: modelId, candle_count: candlesForPrompt.length },
      response_payload: { prediction_id: inserted.id, confidence: inserted.confidence, prediction: inserted.prediction, duration_ms: Date.now() - started },
      success: true,
    });

    return inserted;
  } catch (e) {
    success = false;
    errorMessage = e instanceof Error ? e.message : String(e);
    await supabase.from("api_runs").insert({
      run_type: "run-ai-prediction",
      request_payload: aiPayload as Record<string, unknown> | null,
      response_payload: aiResponse as Record<string, unknown> | null,
      success: false,
      error_message: errorMessage,
    });
    throw new Error(errorMessage);
  }
}

export async function resolvePredictionsServer(supabase: SupabaseClient) {
  const { data: pending, error } = await supabase
    .from("predictions")
    .select("id, prediction, candle_ts, symbol, timeframe")
    .eq("status", "pending")
    .order("candle_ts", { ascending: true })
    .limit(200);
  if (error) throw error;

  let resolved = 0;
  for (const p of pending ?? []) {
    const { data: candle } = await supabase
      .from("candles")
      .select("open, high, low, close, confirm")
      .eq("symbol", p.symbol)
      .eq("timeframe", p.timeframe)
      .eq("candle_ts", p.candle_ts)
      .maybeSingle();
    if (!candle || !candle.confirm) continue;

    const open = Number(candle.open);
    const close = Number(candle.close);
    let status: "win" | "loss" | "push";
    if (close === open) status = "push";
    else if (p.prediction === "YES") status = close > open ? "win" : "loss";
    else status = close < open ? "win" : "loss";

    await supabase
      .from("predictions")
      .update({
        status,
        actual_next_candle_open: candle.open,
        actual_next_candle_high: candle.high,
        actual_next_candle_low: candle.low,
        actual_next_candle_close: candle.close,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", p.id);
    resolved++;
  }

  await supabase.from("api_runs").insert({
    run_type: "resolve-predictions",
    request_payload: { pending_count: pending?.length ?? 0 },
    response_payload: { resolved },
    success: true,
  });

  return { resolved, pending: pending?.length ?? 0 };
}
