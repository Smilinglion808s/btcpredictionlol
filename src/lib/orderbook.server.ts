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
    source: orderbookSource,
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


// the orderbook from Coinbase (primary, always reachable — same host we use
// for candle grading) with OKX as a fallback. Both return aggregated depth
// and recent trades with an aggressor side, which is all we need for OBI +
// signed delta.

async function fetchJson(url: string, timeoutMs = 5000): Promise<unknown | null> {
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), timeoutMs);
    const r = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        accept: "application/json",
        "user-agent":
          "Mozilla/5.0 (compatible; BTC15mBot/1.0; +https://btcpredictionlol.lovable.app)",
      },
    });
    clearTimeout(timer);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

let orderbookSource = "coinbase_spot";

async function fetchDepth(): Promise<DepthResp | null> {
  // Coinbase level=2: aggregated book, top ~50 bids/asks. Enough for tight-band OBI.
  const cb = (await fetchJson(
    "https://api.exchange.coinbase.com/products/BTC-USD/book?level=2",
  )) as { bids?: [string, string, number][]; asks?: [string, string, number][] } | null;
  if (cb?.bids && cb?.asks) {
    orderbookSource = "coinbase_spot";
    return {
      bids: cb.bids.map(([p, q]) => [p, q] as Level),
      asks: cb.asks.map(([p, q]) => [p, q] as Level),
    };
  }
  // OKX fallback: sz=400 full aggregated book.
  const okx = (await fetchJson(
    "https://www.okx.com/api/v5/market/books?instId=BTC-USDT&sz=400",
  )) as { data?: Array<{ bids: string[][]; asks: string[][] }> } | null;
  const row = okx?.data?.[0];
  if (row?.bids && row?.asks) {
    orderbookSource = "okx_spot";
    return {
      bids: row.bids.map((r) => [r[0], r[1]] as Level),
      asks: row.asks.map((r) => [r[0], r[1]] as Level),
    };
  }
  return null;
}

interface UnifiedTrade {
  T: number;         // ms
  q: number;         // size
  aggressor: "buy" | "sell";
}

async function fetchRecentTrades(): Promise<UnifiedTrade[] | null> {
  // Coinbase trades endpoint returns up to 1000 recent trades with side = aggressor side.
  const cb = (await fetchJson(
    "https://api.exchange.coinbase.com/products/BTC-USD/trades?limit=1000",
  )) as Array<{ time: string; size: string; price: string; side: "buy" | "sell" }> | null;
  if (cb && Array.isArray(cb)) {
    return cb.map((t) => ({
      T: new Date(t.time).getTime(),
      q: Number(t.size),
      aggressor: t.side,
    }));
  }
  // OKX fallback: side is aggressor side ("buy"|"sell"), ts is ms string.
  const okx = (await fetchJson(
    "https://www.okx.com/api/v5/market/trades?instId=BTC-USDT&limit=500",
  )) as { data?: Array<{ ts: string; sz: string; px: string; side: "buy" | "sell" }> } | null;
  if (okx?.data) {
    return okx.data.map((t) => ({
      T: Number(t.ts),
      q: Number(t.sz),
      aggressor: t.side,
    }));
  }
  return null;
}

async function takeSnapshot(): Promise<Snapshot | null> {
  const depth = await fetchDepth();
  if (!depth || !depth.bids.length || !depth.asks.length) return null;
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
    const trades = await fetchRecentTrades();
    let delta1 = 0, delta3 = 0, delta15 = 0;
    if (trades) {
      for (const t of trades) {
        const age = now - t.T;
        if (age < 0 || age > 15 * 60 * 1000) continue;
        const signed = (t.aggressor === "buy" ? 1 : -1) * t.q;
        if (age <= 60_000) delta1 += signed;
        if (age <= 180_000) delta3 += signed;
        delta15 += signed;
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
      source: orderbookSource,
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
