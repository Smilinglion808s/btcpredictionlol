// Server-only AI prediction + resolution logic. Imported by server fns and the cron route.
import type { SupabaseClient } from "@supabase/supabase-js";
import { computeIndicatorBundle, nextCandleTs, type Candle } from "./indicators";

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

    // NO CLEAR EDGE → record as 'push' so it shows on stats without affecting win rate.
    const isSkip = rawCall === "NO CLEAR EDGE";
    const status = isSkip
      ? "push"
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

export async function resolvePredictionsServer(supabase: SupabaseClient) {
  const { fetchKalshiResolution } = await import("./kalshi.server");

  const { data: pending, error } = await supabase
    .from("predictions")
    .select("id, prediction, candle_ts, symbol, timeframe")
    .eq("status", "pending")
    .order("candle_ts", { ascending: true })
    .limit(200);
  if (error) throw error;

  const TF_MS = 15 * 60 * 1000;
  let resolved = 0;
  const checked: Array<{ id: string; candle_ts: string; source: string; resolved: boolean; ticker?: string; error?: string }> = [];

  for (const p of pending ?? []) {
    const candleEndsAt = new Date(p.candle_ts).getTime() + TF_MS;
    // Wait until Kalshi has had time to settle (settlement_timer ~1s but allow margin).
    if (Date.now() < candleEndsAt + 15_000) continue;

    let kalshi: Awaited<ReturnType<typeof fetchKalshiResolution>> = null;
    try {
      kalshi = await fetchKalshiResolution(p.candle_ts);
    } catch {
      // fall through
    }

    if (!kalshi) {
      checked.push({ id: p.id, candle_ts: p.candle_ts, source: "kalshi", resolved: false });
      continue;
    }

    let status: "win" | "loss" | "push";
    if (p.prediction === "YES") status = kalshi.result === "YES" ? "win" : "loss";
    else if (p.prediction === "NO") status = kalshi.result === "NO" ? "win" : "loss";
    else status = "push";

    const { error: updateError } = await supabase
      .from("predictions")
      .update({
        status,
        actual_next_candle_close: kalshi.settlement_value ?? null,
        resolved_at: new Date().toISOString(),
      })
      .eq("id", p.id);
    if (updateError) {
      checked.push({ id: p.id, candle_ts: p.candle_ts, source: "kalshi", resolved: false, ticker: kalshi.ticker, error: updateError.message });
      continue;
    }
    resolved++;
    checked.push({ id: p.id, candle_ts: p.candle_ts, source: "kalshi", resolved: true, ticker: kalshi.ticker });
  }

  await supabase.from("api_runs").insert({
    run_type: "resolve-predictions",
    request_payload: { pending_count: pending?.length ?? 0 },
    response_payload: { resolved, checked, resolver: "kalshi" },
    success: true,
  });

  return { resolved, pending: pending?.length ?? 0 };
}
