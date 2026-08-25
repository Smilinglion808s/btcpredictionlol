// Cross89 — prior-completed 15m candle loader for live decisions (server-only).
//
// Only candles that closed at or before the target boundary are returned, so
// nothing from the in-progress candle can reach the technical block.

import { TF_MS } from "./config";
import type { Tech15mCandle } from "./technicals";

const SPOT = "https://api.binance.com/api/v3/klines";
const FUT = "https://fapi.binance.com/fapi/v1/klines";

function parse(rows: unknown[][]): Tech15mCandle[] {
  return rows.map((r) => ({
    openMs: Number(r[0]),
    open: Number(r[1]),
    high: Number(r[2]),
    low: Number(r[3]),
    close: Number(r[4]),
    volume: Number(r[5]),
    quoteVolume: Number(r[7]),
    tradeCount: Number(r[8]),
    takerBuyQuoteVolume: Number(r[10]),
  }));
}

async function load(base: string, targetMs: number, limit: number): Promise<Tech15mCandle[]> {
  const endTime = targetMs - 1; // strictly before the target candle opens
  const res = await fetch(`${base}?symbol=BTCUSDT&interval=15m&endTime=${endTime}&limit=${limit}`);
  if (!res.ok) throw new Error(`BINANCE_15M_${res.status}`);
  const rows = parse((await res.json()) as unknown[][]);
  // Defensive: drop anything that is not fully completed before the target.
  return rows.filter((c) => c.openMs + TF_MS <= targetMs);
}

export interface PriorSeries {
  spot: Tech15mCandle[];
  fut: Tech15mCandle[];
  spotIndex: number;
  futIndex: number;
}

/** Fetch both venues in parallel; index points at the candle that closed at T. */
export async function loadPriorSeries(targetMs: number, limit = 200): Promise<PriorSeries> {
  const [spot, fut] = await Promise.all([load(SPOT, targetMs, limit), load(FUT, targetMs, limit)]);
  const wanted = targetMs - TF_MS;
  return {
    spot,
    fut,
    spotIndex: spot.findIndex((c) => c.openMs === wanted),
    futIndex: fut.findIndex((c) => c.openMs === wanted),
  };
}
