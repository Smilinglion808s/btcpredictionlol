// Server-only AI prediction + resolution logic. Imported by server fns and the cron route.
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeIndicatorBundle, nextCandleTs, type Candle } from "./indicators";

const DEFAULT_INSTRUCTIONS =
  "You are running the BTCUSDT 15m prediction model with the supplied indicator_weights. Use only the supplied closed candles and weights to make a Run Next prediction for the next 15m candle. Return JSON only with fields: prediction (YES or NO), confidence (0-100), final_interpretation (short label summarizing the setup), setup_type, market_condition, reasoning_summary, indicators (object of short strings).";


interface AiOutput {
  prediction: "YES" | "NO";
  confidence: number;
  final_interpretation?: string;
  setup_type: string;
  market_condition: string;
  reasoning_summary: string;
  indicators: Record<string, string>;
}

type ResolutionCandle = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number;
  confirm?: boolean;
};

async function fetchCoinbaseClosedCandle(candleTs: string, timeframeMs: number): Promise<ResolutionCandle | null> {
  const targetMs = new Date(candleTs).getTime();
  const targetSec = Math.floor(targetMs / 1000);
  const start = new Date(targetMs - timeframeMs).toISOString();
  const end = new Date(targetMs + timeframeMs * 2).toISOString();
  const url = new URL("https://api.exchange.coinbase.com/products/BTC-USD/candles");
  url.searchParams.set("granularity", "900");
  url.searchParams.set("start", start);
  url.searchParams.set("end", end);

  const response = await fetch(url, {
    headers: {
      accept: "application/json",
      "user-agent": "BTC-15m-Prediction-Dashboard/1.0",
    },
  });
  if (!response.ok) return null;

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
    // Target candle = the UPCOMING candle (next 15m boundary). Cron fires ~1m
    // before that boundary so we predict the candle about to open.
    const TF_MS = 15 * 60 * 1000;
    const targetCandleTs = new Date(Math.ceil(Date.now() / TF_MS) * TF_MS).toISOString();
    void nextCandleTs;

    // Idempotency: if a prediction already exists for this candle + model, return it.
    const { data: existing } = await supabase
      .from("predictions")
      .select("*")
      .eq("symbol", "BTC-USDT")
      .eq("timeframe", "15m")
      .eq("model_version", (await supabase.from("model_settings").select("model_version").eq("is_active", true).maybeSingle()).data?.model_version ?? "")
      .eq("candle_ts", targetCandleTs)
      .maybeSingle();
    if (existing) return existing;



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
    const modelId = ((settings as any).api_model_id as string)?.trim() || "gpt-5.5";

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

    if (parsed.prediction !== "YES" && parsed.prediction !== "NO") {
      throw new Error("AI prediction must be YES or NO");
    }

    const status =
      settings.require_manual_approval ? "manual_review" : "pending";

    const insertPayload = {
      symbol: "BTC-USDT",
      timeframe: "15m",
      model_version: settings.model_version,
      api_model_id: (settings as any).api_model_id || null,
      candle_ts: targetCandleTs,
      prediction: parsed.prediction,
      confidence: Number(parsed.confidence) || 0,
      btc_price_at_prediction: last.close,
      setup_type: parsed.final_interpretation ?? parsed.setup_type ?? null,
      market_condition: parsed.market_condition ?? null,
      reasoning_summary: parsed.reasoning_summary ?? null,
      full_ai_response: json,
      indicators: indicators as unknown as Record<string, unknown>,
      status,
    };

    const { data: inserted, error: insErr } = await supabase
      .from("predictions")
      .insert(insertPayload as any)
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

  const TF_MS = 15 * 60 * 1000;
  let resolved = 0;
  const checked: Array<{ id: string; candle_ts: string; source: string; resolved: boolean }> = [];
  for (const p of pending ?? []) {
    const candleEndsAt = new Date(p.candle_ts).getTime() + TF_MS;
    // Only attempt to resolve once the candle window has closed.
    if (Date.now() < candleEndsAt + 30_000) continue;

    // Source of truth: Coinbase closed 15m candle. Fall back to DB if Coinbase
    // is unreachable.
    let candle: ResolutionCandle | null = null;
    let source = "none";
    try {
      candle = await fetchCoinbaseClosedCandle(p.candle_ts, TF_MS);
      if (candle) {
        source = "coinbase";
        await supabase.from("candles").upsert(
          {
            symbol: p.symbol,
            timeframe: p.timeframe,
            candle_ts: p.candle_ts,
            open: candle.open,
            high: candle.high,
            low: candle.low,
            close: candle.close,
            volume: candle.volume ?? 0,
            confirm: true,
          },
          { onConflict: "symbol,timeframe,candle_ts" },
        );
      }
    } catch {
      // fall through to DB fallback
    }

    if (!candle) {
      const { data: dbCandle } = await supabase
        .from("candles")
        .select("open, high, low, close, confirm")
        .eq("symbol", p.symbol)
        .eq("timeframe", p.timeframe)
        .eq("candle_ts", p.candle_ts)
        .maybeSingle();
      if (dbCandle && dbCandle.confirm) {
        candle = {
          open: Number(dbCandle.open),
          high: Number(dbCandle.high),
          low: Number(dbCandle.low),
          close: Number(dbCandle.close),
          confirm: true,
        };
        source = "database";
      }
    }

    if (!candle) {
      checked.push({ id: p.id, candle_ts: p.candle_ts, source, resolved: false });
      continue;
    }

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
    checked.push({ id: p.id, candle_ts: p.candle_ts, source, resolved: true });
  }

  await supabase.from("api_runs").insert({
    run_type: "resolve-predictions",
    request_payload: { pending_count: pending?.length ?? 0 },
    response_payload: { resolved, checked },
    success: true,
  });

  return { resolved, pending: pending?.length ?? 0 };
}
