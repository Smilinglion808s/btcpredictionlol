// Server-only candle ingest + partial-candle fetch. Imported by server fns and the cron route.
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
  fetch_source: "okx" | "coinbase";
  raw: unknown;
}

export interface ClosedCandle {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  confirm: boolean;
}

export interface PartialCandle {
  start_ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  minutes_elapsed: number;
  source: "okx" | "coinbase";
}

const SYMBOL = "BTC-USDT";
const TF = "15m";
const TF_MS = 15 * 60 * 1000;

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
    fetch_source: "okx",
    raw: row,
  };
}

function normalizeCoinbaseRow(row: [number, number, number, number, number, number]): NormalizedCandle {
  const [t, low, high, open, close, volume] = row;
  return {
    symbol: SYMBOL,
    timeframe: TF,
    candle_ts: new Date(t * 1000).toISOString(),
    open,
    high,
    low,
    close,
    volume,
    volume_quote: 0,
    // Coinbase doesn't return confirm — assume closed if the window ended.
    confirm: Date.now() >= t * 1000 + TF_MS,
    fetch_source: "coinbase",
    raw: row,
  };
}

// ------------------------- OKX fetchers -------------------------

async function tryOkxCandles(): Promise<{ candles: NormalizedCandle[]; status: number; error?: string }> {
  const base = process.env.OKX_REST_BASE_URL || "https://www.okx.com";
  const url = `${base}/api/v5/market/candles?instId=${SYMBOL}&bar=${TF}&limit=200`;
  try {
    const res = await fetch(url, { headers: { accept: "application/json" } });
    if (res.status === 429) {
      return { candles: [], status: 429, error: `OKX 429 rate-limited` };
    }
    if (!res.ok) {
      return { candles: [], status: res.status, error: `OKX HTTP ${res.status}: ${await res.text()}` };
    }
    const json = (await res.json()) as { code: string; msg: string; data: string[][] };
    if (json.code !== "0") {
      return { candles: [], status: 200, error: `OKX error ${json.code}: ${json.msg}` };
    }
    return { candles: json.data.map(normalizeOkxRow), status: 200 };
  } catch (e) {
    return { candles: [], status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

async function tryCoinbaseCandles(): Promise<{ candles: NormalizedCandle[]; status: number; error?: string }> {
  const end = new Date();
  const start = new Date(end.getTime() - 200 * TF_MS);
  const url = new URL("https://api.exchange.coinbase.com/products/BTC-USD/candles");
  url.searchParams.set("granularity", "900");
  url.searchParams.set("start", start.toISOString());
  url.searchParams.set("end", end.toISOString());
  try {
    const res = await fetch(url, {
      headers: {
        accept: "application/json",
        "user-agent": "Mozilla/5.0 (compatible; BTC15mBot/1.0; +https://btcpredictionlol.lovable.app)",
      },
    });
    if (!res.ok) {
      return { candles: [], status: res.status, error: `Coinbase HTTP ${res.status}: ${await res.text()}` };
    }
    const rows = (await res.json()) as Array<[number, number, number, number, number, number]>;
    return { candles: rows.map(normalizeCoinbaseRow), status: 200 };
  } catch (e) {
    return { candles: [], status: 0, error: e instanceof Error ? e.message : String(e) };
  }
}

export async function fetchOkxClosedCandle(candleTs: string): Promise<ClosedCandle | null> {
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
      return { open: candle.open, high: candle.high, low: candle.low, close: candle.close, volume: candle.volume, confirm: candle.confirm };
    } catch {
      await new Promise((res) => setTimeout(res, 400 * (i + 1)));
    }
  }
  return null;
}

/**
 * Fetches the currently-forming (unconfirmed) 15m candle from OKX, with
 * Coinbase fallback. Returns null if neither source is available.
 */
export async function fetchCurrentPartialCandle(): Promise<PartialCandle | null> {
  const now = Date.now();
  const currentStart = Math.floor(now / TF_MS) * TF_MS;
  const minutesElapsed = Math.min(15, Math.floor((now - currentStart) / 60_000));

  // OKX first
  const okx = await tryOkxCandles();
  if (okx.candles.length) {
    const partial = okx.candles.find((c) => new Date(c.candle_ts).getTime() === currentStart && !c.confirm);
    if (partial) {
      return {
        start_ts: partial.candle_ts,
        open: partial.open, high: partial.high, low: partial.low, close: partial.close, volume: partial.volume,
        minutes_elapsed: minutesElapsed,
        source: "okx",
      };
    }
  }
  // Coinbase fallback
  const cb = await tryCoinbaseCandles();
  const partial = cb.candles.find((c) => new Date(c.candle_ts).getTime() === currentStart);
  if (partial) {
    return {
      start_ts: partial.candle_ts,
      open: partial.open, high: partial.high, low: partial.low, close: partial.close, volume: partial.volume,
      minutes_elapsed: minutesElapsed,
      source: "coinbase",
    };
  }
  return null;
}

/**
 * Fetch + upsert candles with OKX primary, Coinbase fallback. Returns the
 * latest ~200 rows sorted ascending, plus provenance metadata so callers can
 * see which source served the run.
 */
export async function fetchAndUpsertCandles(supabase: SupabaseClient): Promise<{
  candles: Array<Record<string, unknown>>;
  primary_source: "okx" | "coinbase" | null;
  attempts: Array<{ source: string; status: number; error?: string; rows: number }>;
}> {
  const started = Date.now();
  const attempts: Array<{ source: string; status: number; error?: string; rows: number }> = [];
  let normalized: NormalizedCandle[] = [];
  let primary: "okx" | "coinbase" | null = null;

  const okx = await tryOkxCandles();
  attempts.push({ source: "okx", status: okx.status, error: okx.error, rows: okx.candles.length });
  if (okx.candles.length) {
    normalized = okx.candles;
    primary = "okx";
  } else {
    const cb = await tryCoinbaseCandles();
    attempts.push({ source: "coinbase", status: cb.status, error: cb.error, rows: cb.candles.length });
    if (cb.candles.length) {
      normalized = cb.candles;
      primary = "coinbase";
    }
  }

  let upsertErrorMessage: string | null = null;
  if (normalized.length) {
    const { error: upsertErr } = await supabase
      .from("candles")
      .upsert(normalized, { onConflict: "symbol,timeframe,candle_ts" });
    if (upsertErr) upsertErrorMessage = upsertErr.message;
  }

  const success = normalized.length > 0 && !upsertErrorMessage;
  await supabase.from("api_runs").insert({
    run_type: "fetch-okx-candles",
    request_payload: { attempts_summary: attempts.map((a) => ({ source: a.source, status: a.status, rows: a.rows })) },
    response_payload: {
      count: normalized.length,
      primary_source: primary,
      duration_ms: Date.now() - started,
      attempts,
      upsert_error: upsertErrorMessage,
    },
    success,
    error_message: success ? null : (upsertErrorMessage ?? (attempts.map((a) => a.error).filter(Boolean).join(" | ") || "No candles from any source")),
  });

  if (!success) {
    throw new Error(upsertErrorMessage ?? (attempts.map((a) => a.error).filter(Boolean).join(" | ") || "No candles from any source"));
  }

  const { data, error } = await supabase
    .from("candles")
    .select("*")
    .eq("symbol", SYMBOL)
    .eq("timeframe", TF)
    .order("candle_ts", { ascending: false })
    .limit(200);
  if (error) throw error;
  return {
    candles: (data ?? []).slice().reverse(),
    primary_source: primary,
    attempts,
  };
}

/**
 * Backwards-compatible wrapper — same signature as before, returns just the
 * candle array. New code should prefer `fetchAndUpsertCandles`.
 */
export async function fetchAndUpsertOkxCandles(supabase: SupabaseClient) {
  const { candles } = await fetchAndUpsertCandles(supabase);
  return candles;
}
