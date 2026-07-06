// Server-only OKX fetch + upsert. Imported by server fns and the cron route.
import type { SupabaseClient } from "@supabase/supabase-js";

interface OkxCandleRow {
  ts: string;
  o: string;
  h: string;
  l: string;
  c: string;
  vol: string;
  volCcyQuote: string;
  confirm: string;
}

export interface NormalizedCandle {
  symbol: string;
  timeframe: string;
  candle_ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  volume_quote: number;
  confirm: boolean;
  raw: unknown;
}

export interface OkxClosedCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  confirm: boolean;
}

const SYMBOL = "BTC-USDT";
const TF = "15m";

function normalizeOkxRow(row: string[]): NormalizedCandle {
  const [ts, o, h, l, c, vol, , volCcyQuote, confirm] = row;
  return {
    symbol: SYMBOL,
    timeframe: TF,
    candle_ts: new Date(Number(ts)).toISOString(),
    open: Number(o),
    high: Number(h),
    low: Number(l),
    close: Number(c),
    volume: Number(vol),
    volume_quote: Number(volCcyQuote ?? 0),
    confirm: confirm === "1",
    raw: row,
  };
}

export async function fetchOkxClosedCandle(candleTs: string): Promise<OkxClosedCandle | null> {
  const base = process.env.OKX_REST_BASE_URL || "https://www.okx.com";
  const targetMs = new Date(candleTs).getTime();
  const url = `${base}/api/v5/market/candles?instId=${SYMBOL}&bar=${TF}&limit=200`;

  for (let i = 0; i < 3; i++) {
    try {
      const res = await fetch(url, { headers: { accept: "application/json" } });
      if (!res.ok) throw new Error(`OKX HTTP ${res.status}: ${await res.text()}`);
      const json = (await res.json()) as { code: string; msg: string; data: string[][] };
      if (json.code !== "0") throw new Error(`OKX error ${json.code}: ${json.msg}`);

      const row = json.data.find((r) => Number(r[0]) === targetMs);
      if (!row) return null;
      const candle = normalizeOkxRow(row);
      if (!candle.confirm) return null;
      return {
        open: candle.open,
        high: candle.high,
        low: candle.low,
        close: candle.close,
        volume: candle.volume,
        confirm: candle.confirm,
      };
    } catch {
      await new Promise((res) => setTimeout(res, 400 * (i + 1)));
    }
  }
  return null;
}

export async function fetchAndUpsertOkxCandles(supabase: SupabaseClient) {
  const base = process.env.OKX_REST_BASE_URL || "https://www.okx.com";
  const url = `${base}/api/v5/market/candles?instId=${SYMBOL}&bar=${TF}&limit=200`;

  const started = Date.now();
  let normalized: NormalizedCandle[] = [];
  let success = true;
  let errorMessage: string | null = null;

  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (!res.ok) {
      throw new Error(`OKX HTTP ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as { code: string; msg: string; data: string[][] };
    if (json.code !== "0") {
      throw new Error(`OKX error ${json.code}: ${json.msg}`);
    }

    normalized = json.data.map(normalizeOkxRow);

    const { error: upsertErr } = await supabase
      .from("candles")
      .upsert(normalized, { onConflict: "symbol,timeframe,candle_ts" });
    if (upsertErr) throw upsertErr;
  } catch (e) {
    success = false;
    errorMessage = e instanceof Error ? e.message : String(e);
  }

  await supabase.from("api_runs").insert({
    run_type: "fetch-okx-candles",
    request_payload: { url },
    response_payload: { count: normalized.length, duration_ms: Date.now() - started },
    success,
    error_message: errorMessage,
  });

  if (!success) throw new Error(errorMessage ?? "OKX fetch failed");

  // Return latest 200 from DB (sorted ascending for chart use).
  const { data, error } = await supabase
    .from("candles")
    .select("*")
    .eq("symbol", SYMBOL)
    .eq("timeframe", TF)
    .order("candle_ts", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).slice().reverse();
}
