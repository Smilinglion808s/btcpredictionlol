// Server-only: fetch Binance BTCUSDT orderbook + recent trades and compute
// an aggregate flow snapshot the AI can use as a confidence filter.
// Best-effort — returns null if Binance is unreachable (e.g. geo-blocked).

type Level = [string, string]; // [price, qty]

interface DepthResp {
  bids: Level[];
  asks: Level[];
}

interface AggTrade {
  p: string; // price
  q: string; // qty
  T: number; // timestamp ms
  m: boolean; // true = buyer is maker (i.e. sell aggressor)
}

export interface OrderbookAggregate {
  enabled: boolean;
  mode: "confidence_filter_only";
  weight: 0;
  source: string;
  symbol: string;
  timestamp_ms: number;
  mid_price: number;
  obi_30s: number; // proxy: tight band ±0.1%
  obi_2m: number;  // proxy: ±0.25%
  obi_5m: number;  // proxy: ±0.5%
  delta_1m: number;
  delta_3m: number;
  delta_15m: number;
  bid_wall_near_support: boolean;
  ask_wall_near_resistance: boolean;
  bid_liquidity_pulling: boolean;   // not detectable single-snapshot -> false
  ask_liquidity_pulling: boolean;   // not detectable single-snapshot -> false
  absorption_signal: "none" | "bid_absorption" | "ask_absorption";
  orderbook_pressure: "bullish" | "bearish" | "neutral";
  confidence_effect:
    | "ignore"
    | "boost_yes"
    | "boost_no"
    | "cap_yes"
    | "cap_no";
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
      // try next
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

export async function fetchBinanceOrderbookAggregate(): Promise<OrderbookAggregate | null> {
  try {
    const depthRes = await tryFetch("/api/v3/depth?symbol=BTCUSDT&limit=500");
    if (!depthRes) {
      return {
        enabled: false,
        mode: "confidence_filter_only",
        weight: 0,
        source: "binance_spot",
        symbol: "BTCUSDT",
        timestamp_ms: Date.now(),
        mid_price: 0,
        obi_30s: 0, obi_2m: 0, obi_5m: 0,
        delta_1m: 0, delta_3m: 0, delta_15m: 0,
        bid_wall_near_support: false,
        ask_wall_near_resistance: false,
        bid_liquidity_pulling: false,
        ask_liquidity_pulling: false,
        absorption_signal: "none",
        orderbook_pressure: "neutral",
        confidence_effect: "ignore",
        fetch_error: "binance_unreachable",
      };
    }
    const depth = (await depthRes.json()) as DepthResp;
    const bestBid = Number(depth.bids[0]?.[0] ?? 0);
    const bestAsk = Number(depth.asks[0]?.[0] ?? 0);
    const mid = (bestBid + bestAsk) / 2 || bestBid || bestAsk;

    const obi30 = obi(depth.bids, depth.asks, mid, 0.001);
    const obi2 = obi(depth.bids, depth.asks, mid, 0.0025);
    const obi5 = obi(depth.bids, depth.asks, mid, 0.005);

    // aggregated trades (last 15m)
    const now = Date.now();
    const tradesRes = await tryFetch(
      `/api/v3/aggTrades?symbol=BTCUSDT&startTime=${now - 15 * 60 * 1000}&limit=1000`,
    );
    let delta1 = 0, delta3 = 0, delta15 = 0;
    if (tradesRes) {
      const trades = (await tradesRes.json()) as AggTrade[];
      for (const t of trades) {
        const age = now - t.T;
        const signed = (t.m ? -1 : 1) * Number(t.q); // buyer maker => sell aggressor
        if (age <= 60_000) delta1 += signed;
        if (age <= 180_000) delta3 += signed;
        if (age <= 900_000) delta15 += signed;
      }
    }

    const bidWall = detectWall(depth.bids, mid, 0.003);
    const askWall = detectWall(depth.asks, mid, 0.003);

    // absorption: strong delta in one direction but price hasn't moved through wall
    let absorption: OrderbookAggregate["absorption_signal"] = "none";
    if (delta1 > 5 && askWall && obi2 <= 0) absorption = "ask_absorption";
    else if (delta1 < -5 && bidWall && obi2 >= 0) absorption = "bid_absorption";

    // pressure
    let pressure: OrderbookAggregate["orderbook_pressure"] = "neutral";
    if (obi2 > 0.15 && delta3 > 0) pressure = "bullish";
    else if (obi2 < -0.15 && delta3 < 0) pressure = "bearish";

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
      mid_price: Number(mid.toFixed(2)),
      obi_30s: obi30,
      obi_2m: obi2,
      obi_5m: obi5,
      delta_1m: Number(delta1.toFixed(4)),
      delta_3m: Number(delta3.toFixed(4)),
      delta_15m: Number(delta15.toFixed(4)),
      bid_wall_near_support: bidWall,
      ask_wall_near_resistance: askWall,
      bid_liquidity_pulling: false,
      ask_liquidity_pulling: false,
      absorption_signal: absorption,
      orderbook_pressure: pressure,
      confidence_effect: effect,
    };
  } catch (e) {
    return {
      enabled: false,
      mode: "confidence_filter_only",
      weight: 0,
      source: "binance_spot",
      symbol: "BTCUSDT",
      timestamp_ms: Date.now(),
      mid_price: 0,
      obi_30s: 0, obi_2m: 0, obi_5m: 0,
      delta_1m: 0, delta_3m: 0, delta_15m: 0,
      bid_wall_near_support: false,
      ask_wall_near_resistance: false,
      bid_liquidity_pulling: false,
      ask_liquidity_pulling: false,
      absorption_signal: "none",
      orderbook_pressure: "neutral",
      confidence_effect: "ignore",
      fetch_error: e instanceof Error ? e.message : String(e),
    };
  }
}
