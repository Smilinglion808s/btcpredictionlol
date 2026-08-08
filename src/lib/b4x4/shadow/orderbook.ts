// B4x4 order-book shadow — PURE calculations. No IO, no side effects.
//
// SHADOW ONLY. Nothing in this module may be read by the B4x4 decision engine.
// Frozen identity: b4x4-ob-shadow-v1 / OKX / BTC-USDT.

export const B4X4_OB_SHADOW_VERSION = "b4x4-ob-shadow-v1";
export const B4X4_OB_PROVIDER = "okx";
export const B4X4_OB_INSTRUMENT = "BTC-USDT";
/** Maximum age (from the prediction cutoff) for a snapshot to be CAPTURED_VALID. */
export const B4X4_OB_MAX_SNAPSHOT_AGE_MS = 2_000;

export interface Level {
  price: number;
  qty: number;
}

export interface Book {
  bids: Level[]; // descending price
  asks: Level[]; // ascending price
}

export interface Trade {
  ts: number; // ms epoch (event time)
  price: number;
  size: number;
  side: "buy" | "sell"; // aggressor side
}

export type CaptureStatus =
  | "CAPTURED_VALID"
  | "CAPTURED_STALE"
  | "CAPTURED_SEQUENCE_GAP"
  | "CAPTURED_INCOMPLETE"
  | "NO_PREBOUNDARY_SNAPSHOT"
  | "COLLECTOR_ERROR"
  | "HISTORICAL_NOT_CAPTURED";

export type FlowDirection = "GREEN" | "RED" | "NEUTRAL" | "UNAVAILABLE";
export type FlowRelationship = "AGREE" | "CONFLICT" | "NEUTRAL" | "UNAVAILABLE";

function fin(n: number | null | undefined): number | null {
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/** Safe ratio: null (never zero) when the denominator is invalid. */
export function ratio(num: number, den: number): number | null {
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  const v = num / den;
  return Number.isFinite(v) ? v : null;
}

/** Normalized imbalance in [-1, 1]; null when both sides are empty. */
export function imbalance(bid: number, ask: number): number | null {
  const r = ratio(bid - ask, bid + ask);
  if (r == null) return null;
  return Math.max(-1, Math.min(1, r));
}

export function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

export interface TopOfBook {
  best_bid_price: number | null;
  best_bid_qty: number | null;
  best_ask_price: number | null;
  best_ask_qty: number | null;
  mid_price: number | null;
  spread_abs: number | null;
  spread_bps: number | null;
  microprice: number | null;
  microprice_offset_bps: number | null;
}

export function computeTopOfBook(book: Book): TopOfBook {
  const bb = book.bids[0];
  const ba = book.asks[0];
  const bidP = fin(bb?.price);
  const bidQ = fin(bb?.qty);
  const askP = fin(ba?.price);
  const askQ = fin(ba?.qty);
  const empty: TopOfBook = {
    best_bid_price: bidP,
    best_bid_qty: bidQ,
    best_ask_price: askP,
    best_ask_qty: askQ,
    mid_price: null,
    spread_abs: null,
    spread_bps: null,
    microprice: null,
    microprice_offset_bps: null,
  };
  if (bidP == null || askP == null) return empty;
  const mid = (bidP + askP) / 2;
  const spread = askP - bidP;
  const spreadBps = ratio(spread, mid) == null ? null : (spread / mid) * 10_000;
  const qSum = (bidQ ?? 0) + (askQ ?? 0);
  const micro =
    bidQ == null || askQ == null || qSum === 0
      ? null
      : (askP * bidQ + bidP * askQ) / qSum;
  const microOff =
    micro == null || mid === 0 ? null : ((micro - mid) / mid) * 10_000;
  return {
    ...empty,
    mid_price: mid,
    spread_abs: spread,
    spread_bps: spreadBps,
    microprice: micro,
    microprice_offset_bps: microOff,
  };
}

export interface SideDepth {
  base: number;
  quote: number;
}

export interface DepthBuckets {
  buckets: Record<string, { bid: SideDepth; ask: SideDepth; imbalance: number | null }>;
  queue_imbalance_top1: number | null;
  queue_imbalance_top5: number | null;
  queue_imbalance_top20: number | null;
  depth_imbalance_1bps: number | null;
  depth_imbalance_5bps: number | null;
  depth_imbalance_10bps: number | null;
  depth_imbalance_25bps: number | null;
}

function sumLevels(levels: Level[]): SideDepth {
  let base = 0;
  let quote = 0;
  for (const l of levels) {
    if (!Number.isFinite(l.price) || !Number.isFinite(l.qty)) continue;
    base += l.qty;
    quote += l.qty * l.price;
  }
  return { base, quote };
}

function withinBps(levels: Level[], mid: number, bps: number): Level[] {
  const band = (mid * bps) / 10_000;
  return levels.filter((l) => Math.abs(l.price - mid) <= band);
}

/** Depth by top-N levels and by distance bands from mid. */
export function computeDepth(book: Book, mid: number | null): DepthBuckets {
  const buckets: DepthBuckets["buckets"] = {};
  const put = (key: string, bids: Level[], asks: Level[]) => {
    const bid = sumLevels(bids);
    const ask = sumLevels(asks);
    buckets[key] = { bid, ask, imbalance: imbalance(bid.base, ask.base) };
  };
  put("top1", book.bids.slice(0, 1), book.asks.slice(0, 1));
  put("top5", book.bids.slice(0, 5), book.asks.slice(0, 5));
  put("top20", book.bids.slice(0, 20), book.asks.slice(0, 20));
  if (mid != null && Number.isFinite(mid) && mid > 0) {
    for (const bps of [1, 5, 10, 25]) {
      put(`bps${bps}`, withinBps(book.bids, mid, bps), withinBps(book.asks, mid, bps));
    }
  }
  const g = (k: string) => buckets[k]?.imbalance ?? null;
  return {
    buckets,
    queue_imbalance_top1: g("top1"),
    queue_imbalance_top5: g("top5"),
    queue_imbalance_top20: g("top20"),
    depth_imbalance_1bps: g("bps1"),
    depth_imbalance_5bps: g("bps5"),
    depth_imbalance_10bps: g("bps10"),
    depth_imbalance_25bps: g("bps25"),
  };
}

export interface FlowWindow {
  seconds: number;
  taker_buy_quote: number;
  taker_sell_quote: number;
  cvd_quote: number;
  normalized_delta: number | null;
  event_count: number;
  window_complete: boolean;
}

export interface TradeFlow {
  windows: Record<string, FlowWindow>;
  taker_delta_30s: number | null;
  taker_delta_2m: number | null;
  taker_delta_3m: number | null;
  taker_delta_5m: number | null;
  taker_delta_15m: number | null;
  cvd_3m: number | null;
  trade_event_count: number;
  all_windows_complete: boolean;
}

export const FLOW_WINDOWS: Array<{ key: string; seconds: number }> = [
  { key: "w30s", seconds: 30 },
  { key: "w2m", seconds: 120 },
  { key: "w3m", seconds: 180 },
  { key: "w5m", seconds: 300 },
  { key: "w15m", seconds: 900 },
];

/**
 * Taker flow over pre-cutoff windows. `bufferStartMs` is the earliest event
 * timestamp the buffer can vouch for — a window is only "complete" when the
 * buffer covers its entire span. Events at or after the cutoff are dropped.
 */
export function computeTradeFlow(
  trades: Trade[],
  cutoffMs: number,
  bufferStartMs: number | null,
): TradeFlow {
  const eligible = trades.filter(
    (t) => Number.isFinite(t.ts) && t.ts <= cutoffMs && Number.isFinite(t.size) && Number.isFinite(t.price),
  );
  const windows: Record<string, FlowWindow> = {};
  for (const { key, seconds } of FLOW_WINDOWS) {
    const start = cutoffMs - seconds * 1000;
    let buy = 0;
    let sell = 0;
    let count = 0;
    for (const t of eligible) {
      if (t.ts < start) continue;
      const quote = t.size * t.price;
      if (t.side === "buy") buy += quote;
      else sell += quote;
      count++;
    }
    windows[key] = {
      seconds,
      taker_buy_quote: buy,
      taker_sell_quote: sell,
      cvd_quote: buy - sell,
      normalized_delta: imbalance(buy, sell),
      event_count: count,
      window_complete: bufferStartMs != null && bufferStartMs <= start,
    };
  }
  const nd = (k: string) => (windows[k]?.window_complete ? windows[k].normalized_delta : null);
  return {
    windows,
    taker_delta_30s: nd("w30s"),
    taker_delta_2m: nd("w2m"),
    taker_delta_3m: nd("w3m"),
    taker_delta_5m: nd("w5m"),
    taker_delta_15m: nd("w15m"),
    cvd_3m: windows.w3m?.window_complete ? windows.w3m.cvd_quote : null,
    trade_event_count: eligible.length,
    all_windows_complete: FLOW_WINDOWS.every(({ key }) => windows[key]?.window_complete === true),
  };
}

export interface FlowLabels {
  flow_component_count: number;
  flow_composite_score: number | null;
  flow_direction: FlowDirection;
  flow_strength: number | null;
  flow_coherent: boolean;
  flow_strong_coherent: boolean;
}

/** Signed, audit-only directional components. Never a veto. */
export function computeFlowLabels(input: {
  micropriceOffsetBps: number | null;
  spreadBps: number | null;
  queueImbalanceTop5: number | null;
  takerDelta3m: number | null;
}): FlowLabels {
  const comps: number[] = [];
  if (input.micropriceOffsetBps != null && input.spreadBps != null) {
    comps.push(
      clamp(input.micropriceOffsetBps / Math.max(input.spreadBps / 2, 0.01), -1, 1),
    );
  }
  if (input.queueImbalanceTop5 != null) comps.push(clamp(input.queueImbalanceTop5, -1, 1));
  if (input.takerDelta3m != null) comps.push(clamp(input.takerDelta3m, -1, 1));

  if (comps.length < 2) {
    return {
      flow_component_count: comps.length,
      flow_composite_score: comps.length ? comps[0] : null,
      flow_direction: "UNAVAILABLE",
      flow_strength: comps.length ? Math.abs(comps[0]) : null,
      flow_coherent: false,
      flow_strong_coherent: false,
    };
  }
  const composite = comps.reduce((a, b) => a + b, 0) / comps.length;
  const nonZero = comps.filter((c) => c !== 0);
  const coherent =
    nonZero.length >= 2 && nonZero.every((c) => Math.sign(c) === Math.sign(nonZero[0]));
  const strength = Math.abs(composite);
  return {
    flow_component_count: comps.length,
    flow_composite_score: composite,
    flow_direction: composite > 0 ? "GREEN" : composite < 0 ? "RED" : "NEUTRAL",
    flow_strength: strength,
    flow_coherent: coherent,
    flow_strong_coherent: coherent && strength >= 0.5,
  };
}

/** Audit-only relationship between the shadow flow label and B4x4 raw direction. */
export function flowRelationship(
  flow: FlowDirection,
  rawDirection: string | null | undefined,
): FlowRelationship {
  if (flow === "UNAVAILABLE") return "UNAVAILABLE";
  if (rawDirection !== "GREEN" && rawDirection !== "RED") return "UNAVAILABLE";
  if (flow === "NEUTRAL") return "NEUTRAL";
  return flow === rawDirection ? "AGREE" : "CONFLICT";
}

/** Capture classification from snapshot quality inputs. */
export function classifyCapture(input: {
  hasSnapshot: boolean;
  errorCode?: string | null;
  eventTsMs: number | null;
  cutoffMs: number;
  sequenceGap?: boolean | null;
  bookComplete?: boolean | null;
  /** Local receipt time of the response; must also be at or before the cutoff. */
  localReceiptMs?: number | null;
  /** Top-of-book crossed (best bid >= best ask) — never a valid capture. */
  crossed?: boolean | null;
}): { status: CaptureStatus; ageMs: number | null } {
  if (input.errorCode) return { status: "COLLECTOR_ERROR", ageMs: null };
  if (!input.hasSnapshot || input.eventTsMs == null) {
    return { status: "NO_PREBOUNDARY_SNAPSHOT", ageMs: null };
  }
  // Leakage guard: an event at or after the cutoff can never be used.
  if (input.eventTsMs > input.cutoffMs) return { status: "NO_PREBOUNDARY_SNAPSHOT", ageMs: null };
  // A response received after the cutoff may not be used either.
  if (input.localReceiptMs != null && input.localReceiptMs > input.cutoffMs) {
    return { status: "NO_PREBOUNDARY_SNAPSHOT", ageMs: null };
  }
  const ageMs = input.cutoffMs - input.eventTsMs;
  if (input.sequenceGap === true) return { status: "CAPTURED_SEQUENCE_GAP", ageMs };
  if (input.bookComplete === false || input.crossed === true) {
    return { status: "CAPTURED_INCOMPLETE", ageMs };
  }
  if (ageMs > B4X4_OB_MAX_SNAPSHOT_AGE_MS) return { status: "CAPTURED_STALE", ageMs };
  return { status: "CAPTURED_VALID", ageMs };
}

