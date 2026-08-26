// T10 Bridge — completed 15-minute candle sourcing (server only).
//
// Binance Global Spot and USD-M Perpetual BTCUSDT. Only candles that CLOSED at
// or before the target boundary are returned, so the unfinished target candle
// can never enter a technical value.
//
// PRIMARY source is `t10_prior_klines`, pushed by the always-on Railway
// collector (Binance REST is geo-blocked from the edge worker, so a direct
// fetch returns HTTP 403 there). The direct REST fetch remains as a fallback
// for environments that can reach Binance, e.g. local replay scripts.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { T10Candle } from "./technicals";

const SPOT_URL = [
  "https://api.binance.com/api/v3/klines",
  "https://data-api.binance.vision/api/v3/klines",
  "https://api-gcp.binance.com/api/v3/klines",
  "https://api1.binance.com/api/v3/klines",
  "https://api2.binance.com/api/v3/klines",
] as const;
const FUT_URL = [
  "https://fapi.binance.com/fapi/v1/klines",
  "https://fapi1.binance.com/fapi/v1/klines",
  "https://fapi2.binance.com/fapi/v1/klines",
] as const;
const TF_MS = 15 * 60 * 1000;

export const T10_PRIOR_KLINES_TABLE = "t10_prior_klines";

type Kline = [
  number, string, string, string, string, string, number, string, number, string, string, string,
];

function toCandle(k: Kline): T10Candle {
  return {
    ts: new Date(k[0]).toISOString(),
    open: Number(k[1]),
    high: Number(k[2]),
    low: Number(k[3]),
    close: Number(k[4]),
    volume: Number(k[5]),
    quote_volume: Number(k[7]),
    trade_count: Number(k[8]),
    taker_buy_quote_volume: Number(k[10]),
  };
}

async function fetchKlines(
  hosts: readonly string[],
  targetMs: number,
  limit: number,
): Promise<T10Candle[]> {
  const qs = new URLSearchParams({
    symbol: "BTCUSDT",
    interval: "15m",
    endTime: String(targetMs - 1),
    limit: String(limit),
  });
  let lastError = "t10_klines_no_host";
  // Some edge egress IPs are geo-blocked (HTTP 403/451) by the primary
  // Binance host, so identical public-data mirrors are tried in order.
  for (const url of hosts) {
    try {
      const res = await fetch(`${url}?${qs.toString()}`);
      if (!res.ok) {
        lastError = `t10_klines_${res.status}`;
        continue;
      }
      const rows = (await res.json()) as Kline[];
      return rows
        .map(toCandle)
        // Keep only candles whose close time is at or before the boundary.
        .filter((c) => new Date(c.ts).getTime() + TF_MS <= targetMs);
    } catch (e) {
      lastError = e instanceof Error ? `t10_klines_${e.message}` : "t10_klines_fetch_failed";
    }
  }
  throw new Error(lastError);
}

async function loadStoredKlines(
  sb: SupabaseClient,
  venue: "SPOT" | "FUT",
  targetMs: number,
  limit: number,
): Promise<T10Candle[]> {
  const { data, error } = await sb
    .from(T10_PRIOR_KLINES_TABLE)
    .select("candle_ts,open,high,low,close,volume,quote_volume,taker_buy_quote_volume,trade_count")
    .eq("venue", venue)
    .lte("candle_ts", new Date(targetMs - TF_MS).toISOString())
    .order("candle_ts", { ascending: false })
    .limit(limit);
  if (error) throw new Error(`t10_prior_klines_${error.message}`);
  return (data ?? [])
    .map((r) => ({
      ts: new Date(r.candle_ts as string).toISOString(),
      open: Number(r.open),
      high: Number(r.high),
      low: Number(r.low),
      close: Number(r.close),
      volume: Number(r.volume),
      quote_volume: Number(r.quote_volume),
      taker_buy_quote_volume: Number(r.taker_buy_quote_volume),
      trade_count: Number(r.trade_count),
    }))
    .reverse();
}

export interface T10MarketData {
  spot: T10Candle[];
  fut: T10Candle[];
  error: string | null;
  source: "COLLECTOR" | "BINANCE_REST" | "NONE";
}

/** Completed Spot + Futures candles ending exactly at the target boundary. */
export async function loadT10PriorCandles(
  targetTs: string,
  limit = 64,
  sb?: SupabaseClient,
  minCandles = 40,
): Promise<T10MarketData> {
  const targetMs = new Date(targetTs).getTime();

  if (sb) {
    try {
      const [spot, fut] = await Promise.all([
        loadStoredKlines(sb, "SPOT", targetMs, limit),
        loadStoredKlines(sb, "FUT", targetMs, limit),
      ]);
      if (spot.length >= minCandles && fut.length >= minCandles) {
        return { spot, fut, error: null, source: "COLLECTOR" };
      }
    } catch {
      /* fall through to the direct REST path */
    }
  }

  try {
    const [spot, fut] = await Promise.all([
      fetchKlines(SPOT_URL, targetMs, limit),
      fetchKlines(FUT_URL, targetMs, limit),
    ]);
    return { spot, fut, error: null, source: "BINANCE_REST" };
  } catch (e) {
    return {
      spot: [],
      fut: [],
      error: e instanceof Error ? e.message : String(e),
      source: "NONE",
    };
  }
}
