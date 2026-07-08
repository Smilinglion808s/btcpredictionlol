// Pure feature engine — no randomness, no Date.now(). Same input => same output.
import type { Candle } from "../indicators";
import type { PartialCandle } from "../okx.server";
import {
  CLOSE_UPPER_35, CLOSE_LOWER_35, STRONG_BODY, WEAK_BODY, MARUBOZU_BODY,
  NEAR_LEVEL_ATR_MULT, EXTENDED_ATR_MULT,
  EXPANSION_NORMAL, EXPANSION_EXPANDING, EXPANSION_STRONG, EXPANSION_EXHAUSTION,
  FLAT_ATR_FRACTION,
  FIB_SUPPORT_EDGE_MAX, FIB_LOWER_MID_MAX, FIB_TRUE_MID_MAX, FIB_UPPER_MID_MAX,
  FIB_RESISTANCE_EDGE_MAX,
  VOL_HIGH, VOL_LOW, VOL_CONVICTION,
  PARTIAL_OPEN_DRIFT_MAX,
} from "./config";

export interface CandleFeat {
  ts: string;
  open: number; high: number; low: number; close: number; volume: number;
  range: number; body: number; body_pct_of_range: number;
  upper_wick_pct: number; lower_wick_pct: number; close_position_pct: number;
  green: boolean; red: boolean; doji: boolean;
  upper_35_close: boolean; lower_35_close: boolean;
  strong_body: boolean; weak_body: boolean; marubozu: boolean;
}

export type FibZone =
  | "breakdown" | "support_edge" | "lower_mid" | "true_mid"
  | "upper_mid" | "resistance_edge" | "breakout";

export type AtrState = "compressed" | "normal" | "expanding" | "strong_expansion" | "exhaustion";
export type PartialDirection = "green" | "red" | "flat";
export type VwapEvent = "reclaim" | "loss" | "none";

export interface PartialFeat {
  present: boolean;
  degraded_mode: boolean;
  feed_mismatch: boolean;
  synthesized: boolean;
  completeness: number;
  minutes_elapsed: number;
  direction: PartialDirection | null;
  close_position_pct: number | null;
  range_vs_atr: number | null;
  body_pct: number | null;
  upper_wick_pct: number | null;
  lower_wick_pct: number | null;
  vwap_event: VwapEvent;
}

export interface Features {
  candle_ts_input: string;
  last: CandleFeat;
  prev: CandleFeat | null;
  history: CandleFeat[];
  avg_range_20: number;
  atr_14: number;
  vwap: number | null;
  vwap_slope: number | null;
  ema21: number | null;
  above_vwap: boolean;
  below_vwap: boolean;
  near_vwap: boolean;
  extended_from_vwap: boolean;
  vwap_reclaim: boolean;
  vwap_loss: boolean;

  range20_high: number;
  range20_low: number;
  range20_mid: number;
  range20_size: number;
  near_resistance: boolean;
  near_support: boolean;
  room_to_resistance: number;
  room_to_support: number;
  room_to_resistance_pct: number;
  room_to_support_pct: number;

  channel_low: number;
  channel_high: number;
  channel_range: number;
  channel_position: number;
  fib_zone: FibZone;
  channel_resistance_rejection: boolean;
  channel_support_bounce: boolean;
  channel_breakout_confirmed: boolean;
  channel_breakdown_confirmed: boolean;

  last_3_close_change: number; last_5_close_change: number; last_8_close_change: number;
  last_3_positive: boolean; last_3_negative: boolean;
  last_5_positive: boolean; last_5_negative: boolean;
  last_8_positive: boolean; last_8_negative: boolean;
  last_8_flat: boolean;
  higher_low_sequence: boolean; lower_high_sequence: boolean;
  consecutive_same_color_streak: number;
  streak_color: "green" | "red" | null;

  volume_avg_20: number; volume_expansion: number;
  high_volume: boolean; low_volume: boolean; conviction_volume: boolean;

  atr_range_expansion_ratio: number;
  atr_state: AtrState;

  failed_breakout_up: boolean;
  failed_breakout_down: boolean;
  bullish_liquidity_sweep: boolean;
  bearish_liquidity_sweep: boolean;
  acceptance_break_up: boolean;
  acceptance_break_down: boolean;
  repeated_support_defense: boolean;
  repeated_resistance_rejection: boolean;

  bullish_structure: boolean;
  bearish_structure: boolean;

  partial: PartialFeat;
}

const num = (v: unknown): number => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? ""));
  return Number.isFinite(n) ? n : 0;
};

function candleFeat(c: Candle): CandleFeat {
  const o = num(c.open), h = num(c.high), l = num(c.low), cl = num(c.close);
  const v = num(c.volume);
  const range = Math.max(h - l, 1e-9);
  const body = Math.abs(cl - o);
  const body_pct_of_range = body / range;
  const upper_wick_pct = (h - Math.max(o, cl)) / range;
  const lower_wick_pct = (Math.min(o, cl) - l) / range;
  const close_position_pct = (cl - l) / range;
  const green = cl > o; const red = cl < o; const doji = cl === o;
  return {
    ts: c.candle_ts,
    open: o, high: h, low: l, close: cl, volume: v,
    range, body, body_pct_of_range,
    upper_wick_pct, lower_wick_pct, close_position_pct,
    green, red, doji,
    upper_35_close: close_position_pct >= CLOSE_UPPER_35,
    lower_35_close: close_position_pct <= CLOSE_LOWER_35,
    strong_body: body_pct_of_range >= STRONG_BODY,
    weak_body: body_pct_of_range < WEAK_BODY,
    marubozu: body_pct_of_range >= MARUBOZU_BODY,
  };
}

function ema(values: number[], period: number): number | null {
  if (values.length < period) return null;
  const k = 2 / (period + 1);
  let e = values.slice(0, period).reduce((s, x) => s + x, 0) / period;
  for (let i = period; i < values.length; i++) e = values[i] * k + e * (1 - k);
  return e;
}

function utcDayStart(ts: string): number {
  const d = new Date(ts);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

function vwapSeries(cs: CandleFeat[]): number[] {
  // UTC-daily-anchored VWAP.
  const out: number[] = new Array(cs.length).fill(0);
  let pv = 0, vv = 0, dayKey = -1;
  for (let i = 0; i < cs.length; i++) {
    const day = utcDayStart(cs[i].ts);
    if (day !== dayKey) { pv = 0; vv = 0; dayKey = day; }
    const typ = (cs[i].high + cs[i].low + cs[i].close) / 3;
    const v = Math.max(cs[i].volume, 0);
    pv += typ * v; vv += v;
    out[i] = vv > 0 ? pv / vv : typ;
  }
  return out;
}

export interface ComputeContext {
  partial: PartialCandle | null;
  partialSynthesized: boolean;
  channel?: { low?: number; high?: number };
}

export function computeFeatures(rawCandles: Candle[], ctx: ComputeContext): Features {
  if (rawCandles.length < 30) throw new Error("Need >=30 completed candles for Model 6 features");
  const cs = rawCandles.map(candleFeat);
  const n = cs.length;
  const last = cs[n - 1];
  const prev = n >= 2 ? cs[n - 2] : null;
  const win20 = cs.slice(-20);
  const win14 = cs.slice(-14);

  const avg_range_20 = win20.reduce((s, c) => s + c.range, 0) / win20.length;
  const atr_14 = win14.reduce((s, c) => s + c.range, 0) / win14.length;

  const vwapSer = vwapSeries(cs);
  const vwap = vwapSer[n - 1] ?? null;
  const vwap_slope = n >= 4 ? (vwapSer[n - 1] - vwapSer[n - 4]) : null;

  const closes = cs.map((c) => c.close);
  const ema21 = ema(closes, 21);

  const nearVwapEps = NEAR_LEVEL_ATR_MULT * atr_14;
  const extEps = EXTENDED_ATR_MULT * atr_14;
  const above_vwap = vwap != null && last.close > vwap;
  const below_vwap = vwap != null && last.close < vwap;
  const near_vwap = vwap != null && Math.abs(last.close - vwap) <= nearVwapEps;
  const extended_from_vwap = vwap != null && Math.abs(last.close - vwap) >= extEps;
  const vwap_reclaim = vwap != null && prev != null && prev.close < vwap && last.close > vwap;
  const vwap_loss = vwap != null && prev != null && prev.close > vwap && last.close < vwap;

  const range20_high = Math.max(...win20.map((c) => c.high));
  const range20_low = Math.min(...win20.map((c) => c.low));
  const range20_mid = (range20_high + range20_low) / 2;
  const range20_size = range20_high - range20_low;
  const near_resistance = (range20_high - last.close) <= NEAR_LEVEL_ATR_MULT * avg_range_20;
  const near_support = (last.close - range20_low) <= NEAR_LEVEL_ATR_MULT * avg_range_20;
  const room_to_resistance = Math.max(0, range20_high - last.close);
  const room_to_support = Math.max(0, last.close - range20_low);
  const room_to_resistance_pct = range20_size > 0 ? room_to_resistance / range20_size : 0;
  const room_to_support_pct = range20_size > 0 ? room_to_support / range20_size : 0;

  // Fib channel: prefer explicit, else use range20.
  const channel_low = num(ctx.channel?.low ?? range20_low) || range20_low;
  const channel_high = num(ctx.channel?.high ?? range20_high) || range20_high;
  const channel_range = Math.max(channel_high - channel_low, 1e-9);
  const channel_position = (last.close - channel_low) / channel_range;
  const fib_zone: FibZone =
    channel_position < 0 ? "breakdown"
    : channel_position <= FIB_SUPPORT_EDGE_MAX ? "support_edge"
    : channel_position <= FIB_LOWER_MID_MAX ? "lower_mid"
    : channel_position <= FIB_TRUE_MID_MAX ? "true_mid"
    : channel_position <= FIB_UPPER_MID_MAX ? "upper_mid"
    : channel_position <= FIB_RESISTANCE_EDGE_MAX ? "resistance_edge"
    : "breakout";
  const channel_resistance_rejection = last.high >= channel_high && last.close < channel_high;
  const channel_support_bounce = last.low <= channel_low && last.close > channel_low;
  const channel_breakout_confirmed = last.close > channel_high && last.body_pct_of_range >= STRONG_BODY;
  const channel_breakdown_confirmed = last.close < channel_low && last.body_pct_of_range >= STRONG_BODY;

  const changeN = (k: number): number => {
    if (n <= k) return 0;
    const a = cs[n - 1 - k].close, b = cs[n - 1].close;
    return a > 0 ? (b - a) / a : 0;
  };
  const last_3_close_change = changeN(3);
  const last_5_close_change = changeN(5);
  const last_8_close_change = changeN(8);
  const flatBand = FLAT_ATR_FRACTION * avg_range_20;
  const last_8_flat = n >= 9 ? Math.abs(last.close - cs[n - 9].close) <= flatBand : false;

  // Sequences (last 4 candles)
  const tail = cs.slice(-4);
  let higher_low_sequence = true, lower_high_sequence = true;
  for (let i = 1; i < tail.length; i++) {
    if (!(tail[i].low > tail[i - 1].low)) higher_low_sequence = false;
    if (!(tail[i].high < tail[i - 1].high)) lower_high_sequence = false;
  }

  // Same-color streak ending at latest
  let consecutive_same_color_streak = 0;
  let streak_color: "green" | "red" | null = last.green ? "green" : last.red ? "red" : null;
  if (streak_color) {
    for (let i = n - 1; i >= 0; i--) {
      const isSame = streak_color === "green" ? cs[i].green : cs[i].red;
      if (isSame) consecutive_same_color_streak++;
      else break;
    }
  }

  // Volume
  const volume_avg_20 = win20.reduce((s, c) => s + c.volume, 0) / win20.length;
  const volume_expansion = volume_avg_20 > 0 ? last.volume / volume_avg_20 : 0;
  const high_volume = volume_expansion >= VOL_HIGH;
  const low_volume = volume_expansion < VOL_LOW;
  const conviction_volume = volume_expansion >= VOL_CONVICTION;

  // ATR expansion states
  const atr_range_expansion_ratio = avg_range_20 > 0 ? last.range / avg_range_20 : 0;
  const closeVsVwap = vwap != null ? Math.abs(last.close - vwap) : 0;
  const isExh = atr_range_expansion_ratio >= EXPANSION_EXHAUSTION && closeVsVwap >= EXTENDED_ATR_MULT * atr_14;
  const isStrong = !isExh && atr_range_expansion_ratio >= EXPANSION_STRONG && last.body_pct_of_range >= STRONG_BODY;
  const atr_state: AtrState =
    isExh ? "exhaustion"
    : isStrong ? "strong_expansion"
    : atr_range_expansion_ratio >= EXPANSION_EXPANDING ? "expanding"
    : atr_range_expansion_ratio >= EXPANSION_NORMAL ? "normal"
    : "compressed";

  // Failed breakouts vs range20 (of prior 20, so use win20 minus last)
  const priorHigh = Math.max(...cs.slice(-21, -1).map((c) => c.high));
  const priorLow = Math.min(...cs.slice(-21, -1).map((c) => c.low));
  const failed_breakout_up = last.high > priorHigh && last.close < priorHigh;
  const failed_breakout_down = last.low < priorLow && last.close > priorLow;

  // Liquidity sweeps (2.3.1 style): sweep prev high/low and reclaim
  const p = prev;
  const bullish_liquidity_sweep = !!p && last.low < p.low && last.close > p.low && last.close > p.close;
  const bearish_liquidity_sweep = !!p && last.high > p.high && last.close < p.high && last.close < p.close;

  const acceptance_break_up = last.close > priorHigh && atr_range_expansion_ratio >= EXPANSION_EXPANDING;
  const acceptance_break_down = last.close < priorLow && atr_range_expansion_ratio >= EXPANSION_EXPANDING;

  // Repeated defense/rejection: within tolerance of range20 level in last 5
  const tol = 0.2 * atr_14;
  const tail5 = cs.slice(-5);
  const repeated_support_defense =
    tail5.filter((c) => Math.abs(c.low - range20_low) <= tol && c.close > range20_low).length >= 2;
  const repeated_resistance_rejection =
    tail5.filter((c) => Math.abs(c.high - range20_high) <= tol && c.close < range20_high).length >= 2;

  const bullish_structure =
    higher_low_sequence || (ema21 != null && last.close > ema21) || last_8_close_change > 0;
  const bearish_structure =
    lower_high_sequence || (ema21 != null && last.close < ema21) || last_8_close_change < 0;

  // Partial
  const partial: PartialFeat = (() => {
    const p0 = ctx.partial;
    if (!p0) {
      return {
        present: false, degraded_mode: true, feed_mismatch: false, synthesized: false,
        completeness: 0, minutes_elapsed: 0, direction: null,
        close_position_pct: null, range_vs_atr: null,
        body_pct: null, upper_wick_pct: null, lower_wick_pct: null,
        vwap_event: "none",
      };
    }
    const range = Math.max(p0.high - p0.low, 1e-9);
    const completeness = Math.min(1, p0.minutes_elapsed / 15);
    const flatEps = FLAT_ATR_FRACTION * (atr_14 || range);
    const dir: PartialDirection =
      Math.abs(p0.close - p0.open) < flatEps ? "flat"
      : p0.close > p0.open ? "green" : "red";
    const closePos = (p0.close - p0.low) / range;
    const rangeVsAtr = atr_14 > 0 ? range / atr_14 : null;
    const body_pct = Math.abs(p0.close - p0.open) / range;
    const upper_wick_pct = (p0.high - Math.max(p0.open, p0.close)) / range;
    const lower_wick_pct = (Math.min(p0.open, p0.close) - p0.low) / range;
    let vwapEvt: VwapEvent = "none";
    if (vwap != null) {
      if (last.close < vwap && p0.close > vwap) vwapEvt = "reclaim";
      else if (last.close > vwap && p0.close < vwap) vwapEvt = "loss";
    }
    const openDrift = last.close > 0 ? Math.abs(p0.open - last.close) / last.close : 0;
    const feed_mismatch = openDrift > PARTIAL_OPEN_DRIFT_MAX;
    const validWindow = p0.minutes_elapsed >= 1 && !feed_mismatch && !ctx.partialSynthesized;
    return {
      present: validWindow, synthesized: ctx.partialSynthesized,
      feed_mismatch, degraded_mode: !validWindow || completeness < 0.53,
      completeness, minutes_elapsed: p0.minutes_elapsed, direction: dir,
      close_position_pct: closePos, range_vs_atr: rangeVsAtr,
      body_pct, upper_wick_pct, lower_wick_pct, vwap_event: vwapEvt,
    };
  })();

  return {
    candle_ts_input: last.ts,
    last, prev, history: cs,
    avg_range_20, atr_14, vwap, vwap_slope, ema21,
    above_vwap, below_vwap, near_vwap, extended_from_vwap, vwap_reclaim, vwap_loss,
    range20_high, range20_low, range20_mid, range20_size,
    near_resistance, near_support,
    room_to_resistance, room_to_support, room_to_resistance_pct, room_to_support_pct,
    channel_low, channel_high, channel_range, channel_position, fib_zone,
    channel_resistance_rejection, channel_support_bounce,
    channel_breakout_confirmed, channel_breakdown_confirmed,
    last_3_close_change, last_5_close_change, last_8_close_change,
    last_3_positive: last_3_close_change > 0, last_3_negative: last_3_close_change < 0,
    last_5_positive: last_5_close_change > 0, last_5_negative: last_5_close_change < 0,
    last_8_positive: last_8_close_change > 0, last_8_negative: last_8_close_change < 0,
    last_8_flat,
    higher_low_sequence, lower_high_sequence,
    consecutive_same_color_streak, streak_color,
    volume_avg_20, volume_expansion, high_volume, low_volume, conviction_volume,
    atr_range_expansion_ratio, atr_state,
    failed_breakout_up, failed_breakout_down,
    bullish_liquidity_sweep, bearish_liquidity_sweep,
    acceptance_break_up, acceptance_break_down,
    repeated_support_defense, repeated_resistance_rejection,
    bullish_structure, bearish_structure,
    partial,
  };
}
