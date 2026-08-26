// T10 Bridge — completed 15-minute candle sourcing (server only).
//
// Binance Global Spot and USD-M Perpetual BTCUSDT. Only candles that CLOSED at
// or before the target boundary are returned, so the unfinished target candle
// can never enter a technical value.

import type { T10Candle } from "./technicals";

const SPOT_URL = "https://api.binance.com/api/v3/klines";
const FUT_URL = "https://fapi.binance.com/fapi/v1/klines";
const TF_MS = 15 * 60 * 1000;

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


export interface T10MarketData {
  spot: T10Candle[];
  fut: T10Candle[];
  error: string | null;
}

/** Completed Spot + Futures candles ending exactly at the target boundary. */
export async function loadT10PriorCandles(
  targetTs: string,
  limit = 64,
): Promise<T10MarketData> {
  const targetMs = new Date(targetTs).getTime();
  try {
    const [spot, fut] = await Promise.all([
      fetchKlines(SPOT_URL, targetMs, limit),
      fetchKlines(FUT_URL, targetMs, limit),
    ]);
    return { spot, fut, error: null };
  } catch (e) {
    return { spot: [], fut: [], error: e instanceof Error ? e.message : String(e) };
  }
}
