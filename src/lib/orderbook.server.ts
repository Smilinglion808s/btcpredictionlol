// Server-only: sample the Binance BTCUSDT orderbook multiple times before a
// prediction and aggregate the snapshots into a flow summary the AI can use
// as a confidence filter. Best-effort — falls back to disabled on failure.

type Level = [string, string]; // [price, qty]

interface DepthResp {
  bids: Level[];
  asks: Level[];
}

interface AggTrade {
  p: string;
  q: string;
  T: number;
  m: boolean; // buyer is maker => sell aggressor
}

interface Snapshot {
  t: number;
  mid: number;
  obi_30: number; // ±0.1%
  obi_2: number;  // ±0.25%
  obi_5: number;  // ±0.5%
  bid_depth_tight: number;
  ask_depth_tight: number;
  bid_wall: boolean;
  ask_wall: boolean;
}

export interface OrderbookAggregate {
  enabled: boolean;
  mode: "confidence_filter_only";
  weight: 0;
  source: string;
  symbol: string;
  timestamp_ms: number;
  samples_taken: number;
  sample_span_ms: number;
  mid_price: number;
  mid_price_drift: number;      // last-first, USD
  obi_30s: number;              // latest tight-band OBI
  obi_2m: number;
  obi_5m: number;
  obi_2m_avg: number;           // averaged across samples
  obi_2m_trend: number;         // slope: end - start
  delta_1m: number;
  delta_3m: number;
  delta_15m: number;
  bid_wall_near_support: boolean;
  ask_wall_near_resistance: boolean;
  bid_liquidity_pulling: boolean;  // tight bid depth shrinking across samples
  ask_liquidity_pulling: boolean;
  absorption_signal: "none" | "bid_absorption" | "ask_absorption";
  orderbook_pressure: "bullish" | "bearish" | "neutral";
  orderbook_momentum: "building_bullish" | "building_bearish" | "fading_bullish" | "fading_bearish" | "flat";
  confidence_effect: "ignore" | "boost_yes" | "boost_no" | "cap_yes" | "cap_no";
  snapshots: Array<{ t: number; mid: number; obi_2m: number }>;
  fetch_error?: string;
}

const HOSTS = [
  "https://data-api.binance.vision",
  "https://api.binance.com",
  "https://api.binance.us",
];

async function tryFetch(path: string): Promise<Response | null> {
  for (const host of HOSTS) {
    try {
      const r = await fetch(host + path, {
        headers: { accept: "application/json", "user-agent": "BTC15mBot/1.0" },
      });
      if (r.ok) return r;
    } catch {
      // try next host
    }
  }
  return null;
}

function sumQtyInBand(levels: Level[], mid: number, pct: number): number {
  const lo = mid * (1 - pct);
  const hi = mid * (1 + pct);
  let s = 0;
  for (const [p, q] of levels) {
    const price = Number(p);
    if (price < lo || price > hi) continue;
    s += Number(q);
  }
  return s;
}

function obi(bids: Level[], asks: Level[], mid: number, pct: number): number {
  const b = sumQtyInBand(bids, mid, pct);
  const a = sumQtyInBand(asks, mid, pct);
  const tot = b + a;
  if (tot === 0) return 0;
  return Number(((b - a) / tot).toFixed(4));
}

function detectWall(levels: Level[], mid: number, pct: number, mult = 6): boolean {
  const inBand = levels
    .map(([p, q]) => ({ price: Number(p), qty: Number(q) }))
    .filter((l) => Math.abs(l.price - mid) / mid <= pct);
  if (inBand.length < 5) return false;
  const median = inBand
    .map((l) => l.qty)
    .sort((a, b) => a - b)[Math.floor(inBand.length / 2)];
  return inBand.some((l) => l.qty >= median * mult && l.qty >= 50);
}

function disabled(reason: string): OrderbookAggregate {
  return {
    enabled: false,
    mode: "confidence_filter_only",
    weight: 0,
    source: "binance_spot",
    symbol: "BTCUSDT",
    timestamp_ms: Date.now(),
    samples_taken: 0,
    sample_span_ms: 0,
    mid_price: 0,
    mid_price_drift: 0,
    obi_30s: 0, obi_2m: 0, obi_5m: 0,
    obi_2m_avg: 0, obi_2m_trend: 0,
    delta_1m: 0, delta_3m: 0, delta_15m: 0,
    bid_wall_near_support: false,
    ask_wall_near_resistance: false,
    bid_liquidity_pulling: false,
    ask_liquidity_pulling: false,
    absorption_signal: "none",
    orderbook_pressure: "neutral",
    orderbook_momentum: "flat",
    confidence_effect: "ignore",
    snapshots: [],
    fetch_error: reason,
  };
}

async function takeSnapshot(): Promise<Snapshot | null> {
  const res = await tryFetch("/api/v3/depth?symbol=BTCUSDT&limit=500");
  if (!res) return null;
  const depth = (await res.json()) as DepthResp;
  const bestBid = Number(depth.bids[0]?.[0] ?? 0);
  const bestAsk = Number(depth.asks[0]?.[0] ?? 0);
  const mid = (bestBid + bestAsk) / 2 || bestBid || bestAsk;
  return {
    t: Date.now(),
    mid,
    obi_30: obi(depth.bids, depth.asks, mid, 0.001),
    obi_2: obi(depth.bids, depth.asks, mid, 0.0025),
    obi_5: obi(depth.bids, depth.asks, mid, 0.005),
    bid_depth_tight: sumQtyInBand(depth.bids, mid, 0.001),
    ask_depth_tight: sumQtyInBand(depth.asks, mid, 0.001),
    bid_wall: detectWall(depth.bids, mid, 0.003),
    ask_wall: detectWall(depth.asks, mid, 0.003),
  };
}

/**
 * Take `samples` depth snapshots spaced `intervalMs` apart (default 4 samples
 * over ~12s), then combine with the last 15m of aggTrades to produce a flow
 * summary. This gives the AI directional momentum in the book, not just a
 * static snapshot.
 */
export async function fetchBinanceOrderbookAggregate(
  opts: { samples?: number; intervalMs?: number } = {},
): Promise<OrderbookAggregate> {
  const samples = Math.max(1, Math.min(6, opts.samples ?? 4));
  const intervalMs = Math.max(500, Math.min(10_000, opts.intervalMs ?? 4_000));

  try {
    const snaps: Snapshot[] = [];
    for (let i = 0; i < samples; i++) {
      const s = await takeSnapshot();
      if (s) snaps.push(s);
      if (i < samples - 1) await new Promise((r) => setTimeout(r, intervalMs));
    }
    if (snaps.length === 0) return disabled("binance_unreachable");

    const first = snaps[0];
    const last = snaps[snaps.length - 1];
    const midDrift = Number((last.mid - first.mid).toFixed(2));
    const obi2Avg = Number((snaps.reduce((a, s) => a + s.obi_2, 0) / snaps.length).toFixed(4));
    const obi2Trend = Number((last.obi_2 - first.obi_2).toFixed(4));

    // liquidity pulling: tight-band depth shrinks materially across samples
    const bidShrink = snaps.length >= 2 && first.bid_depth_tight > 0
      && last.bid_depth_tight / first.bid_depth_tight < 0.7;
    const askShrink = snaps.length >= 2 && first.ask_depth_tight > 0
      && last.ask_depth_tight / first.ask_depth_tight < 0.7;

    // trades (last 15m)
    const now = Date.now();
    const tradesRes = await tryFetch(
      `/api/v3/aggTrades?symbol=BTCUSDT&startTime=${now - 15 * 60 * 1000}&limit=1000`,
    );
    let delta1 = 0, delta3 = 0, delta15 = 0;
    if (tradesRes) {
      const trades = (await tradesRes.json()) as AggTrade[];
      for (const t of trades) {
        const age = now - t.T;
        const signed = (t.m ? -1 : 1) * Number(t.q);
        if (age <= 60_000) delta1 += signed;
        if (age <= 180_000) delta3 += signed;
        if (age <= 900_000) delta15 += signed;
      }
    }

    // absorption: strong aggressor delta but wall not breaking + book not tipping
    let absorption: OrderbookAggregate["absorption_signal"] = "none";
    if (delta1 > 5 && last.ask_wall && last.obi_2 <= 0) absorption = "ask_absorption";
    else if (delta1 < -5 && last.bid_wall && last.obi_2 >= 0) absorption = "bid_absorption";

    // pressure (latest snapshot + short-term delta agree)
    let pressure: OrderbookAggregate["orderbook_pressure"] = "neutral";
    if (last.obi_2 > 0.15 && delta3 > 0) pressure = "bullish";
    else if (last.obi_2 < -0.15 && delta3 < 0) pressure = "bearish";

    // momentum from the OBI trend across snapshots
    let momentum: OrderbookAggregate["orderbook_momentum"] = "flat";
    if (obi2Trend > 0.08) momentum = last.obi_2 > 0 ? "building_bullish" : "fading_bearish";
    else if (obi2Trend < -0.08) momentum = last.obi_2 < 0 ? "building_bearish" : "fading_bullish";

    let effect: OrderbookAggregate["confidence_effect"] = "ignore";
    if (pressure === "bullish") effect = "boost_yes";
    else if (pressure === "bearish") effect = "boost_no";
    if (absorption === "ask_absorption") effect = "cap_yes";
    else if (absorption === "bid_absorption") effect = "cap_no";

    return {
      enabled: true,
      mode: "confidence_filter_only",
      weight: 0,
      source: "binance_spot",
      symbol: "BTCUSDT",
      timestamp_ms: now,
      samples_taken: snaps.length,
      sample_span_ms: last.t - first.t,
      mid_price: Number(last.mid.toFixed(2)),
      mid_price_drift: midDrift,
      obi_30s: last.obi_30,
      obi_2m: last.obi_2,
      obi_5m: last.obi_5,
      obi_2m_avg: obi2Avg,
      obi_2m_trend: obi2Trend,
      delta_1m: Number(delta1.toFixed(4)),
      delta_3m: Number(delta3.toFixed(4)),
      delta_15m: Number(delta15.toFixed(4)),
      bid_wall_near_support: last.bid_wall,
      ask_wall_near_resistance: last.ask_wall,
      bid_liquidity_pulling: bidShrink,
      ask_liquidity_pulling: askShrink,
      absorption_signal: absorption,
      orderbook_pressure: pressure,
      orderbook_momentum: momentum,
      confidence_effect: effect,
      snapshots: snaps.map((s) => ({
        t: s.t,
        mid: Number(s.mid.toFixed(2)),
        obi_2m: s.obi_2,
      })),
    };
  } catch (e) {
    return disabled(e instanceof Error ? e.message : String(e));
  }
}
