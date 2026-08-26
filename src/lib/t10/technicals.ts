// T10 Bridge — completed-candle technical block (pure).
//
// Inputs are COMPLETED 15-minute candles only. For target T the newest usable
// candle is the one that CLOSED at T; the unfinished target candle never
// enters any value here. Spot and USD-M Perpetual are computed with identical
// formulas, then direction-aligned to the T10 base direction.

import {
  T10_CROSS_ORDER,
  T10_FUT_TECHNICAL_ORDER,
  T10_SPOT_TECHNICAL_ORDER,
  type T10Direction,
} from "./config";
import type { T10FeatureMap } from "./features";

export interface T10Candle {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quote_volume: number;
  taker_buy_quote_volume: number;
  trade_count: number;
}

const BPS = 10_000;
/** Minimum completed candles needed for the 20-period / Wilder-14 windows. */
export const T10_MIN_TECHNICAL_CANDLES = 40;

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const mean = (xs: readonly number[]) => (xs.length ? sum(xs) / xs.length : 0);
const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);
const safeDiv = (a: number, b: number) => (b > 0 && Number.isFinite(b) ? a / b : 0);

function emaSeries(values: readonly number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function trueRanges(c: readonly T10Candle[]): number[] {
  const tr: number[] = [];
  for (let i = 0; i < c.length; i++) {
    const prevClose = i > 0 ? c[i - 1].close : c[i].open;
    tr.push(
      Math.max(
        c[i].high - c[i].low,
        Math.abs(c[i].high - prevClose),
        Math.abs(c[i].low - prevClose),
      ),
    );
  }
  return tr;
}

function atr(c: readonly T10Candle[], period: number): number {
  const tr = trueRanges(c);
  return mean(tr.slice(-period));
}

function rsi(c: readonly T10Candle[], period = 14): number {
  const closes = c.map((x) => x.close);
  let gain = 0;
  let loss = 0;
  const start = Math.max(1, closes.length - period);
  for (let i = start; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d;
    else loss -= d;
  }
  const n = closes.length - start;
  if (n <= 0) return 50;
  const avgGain = gain / n;
  const avgLoss = loss / n;
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100;
  const rs = avgGain / avgLoss;
  return 100 - 100 / (1 + rs);
}

function stochK(c: readonly T10Candle[], period = 14): number {
  const w = c.slice(-period);
  const hi = Math.max(...w.map((x) => x.high));
  const lo = Math.min(...w.map((x) => x.low));
  if (hi === lo) return 50;
  return ((c[c.length - 1].close - lo) / (hi - lo)) * 100;
}

function directional(c: readonly T10Candle[], period = 14): {
  plusDI: number;
  minusDI: number;
  adx: number;
} {
  const w = c.slice(-(period * 2 + 1));
  const plusDM: number[] = [];
  const minusDM: number[] = [];
  const tr = trueRanges(w);
  for (let i = 1; i < w.length; i++) {
    const up = w[i].high - w[i - 1].high;
    const down = w[i - 1].low - w[i].low;
    plusDM.push(up > down && up > 0 ? up : 0);
    minusDM.push(down > up && down > 0 ? down : 0);
  }
  const dx: number[] = [];
  for (let end = period; end <= plusDM.length; end++) {
    const trs = sum(tr.slice(end - period + 1, end + 1));
    const p = safeDiv(sum(plusDM.slice(end - period, end)) * 100, trs);
    const m = safeDiv(sum(minusDM.slice(end - period, end)) * 100, trs);
    const denom = p + m;
    dx.push(denom > 0 ? (Math.abs(p - m) / denom) * 100 : 0);
  }
  const trs = sum(tr.slice(-period));
  const plusDI = safeDiv(sum(plusDM.slice(-period)) * 100, trs);
  const minusDI = safeDiv(sum(minusDM.slice(-period)) * 100, trs);
  return { plusDI, minusDI, adx: dx.length ? mean(dx.slice(-period)) : 0 };
}

function stdev(xs: readonly number[]): number {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return Math.sqrt(sum(xs.map((x) => (x - m) * (x - m))) / xs.length);
}

function takerFlow(c: T10Candle): number {
  return c.quote_volume > 0 ? (2 * c.taker_buy_quote_volume) / c.quote_volume - 1 : 0;
}

function retBps(c: readonly T10Candle[], lag: number): number {
  const last = c[c.length - 1].close;
  const prior = c[c.length - 1 - lag]?.close;
  return prior && prior > 0 ? Math.log(last / prior) * BPS : 0;
}

/** Raw (unaligned) technical block of one venue's completed candles. */
export interface T10VenueTechnicals {
  ret1: number;
  ret4: number;
  ret8: number;
  ret16: number;
  body_atr: number;
  wick_balance: number;
  ema9_21_atr: number;
  macd_hist_atr: number;
  rsi_centered: number;
  stoch_centered: number;
  di_spread: number;
  bb_position: number;
  taker_flow1: number;
  taker_flow4: number;
  taker_flow8: number;
  taker_flow_delta: number;
  trend_signed_age: number;
  upper_wick_share: number;
  lower_wick_share: number;
  failed_breakout: number;
  efficiency8: number;
  adx14: number;
  range_atr: number;
  atr_ratio4_14: number;
  vol_ratio4_16: number;
  bb_width: number;
  volume_z20: number;
  trade_count_z20: number;
  sign_persistence8: number;
  sign_changes8: number;
  taker_flow_last: number;
  close: number;
}

export function venueTechnicals(candles: readonly T10Candle[]): T10VenueTechnicals {
  const c = candles;
  const last = c[c.length - 1];
  const atr14 = atr(c, 14);
  const atr4 = atr(c, 4);
  const range = last.high - last.low;
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;

  const closes = c.map((x) => x.close);
  const ema9 = emaSeries(closes, 9);
  const ema21 = emaSeries(closes, 21);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = ema12.map((v, i) => v - ema26[i]);
  const macdSignal = emaSeries(macdLine, 9);
  const macdHist = macdLine[macdLine.length - 1] - macdSignal[macdSignal.length - 1];

  const { plusDI, minusDI, adx } = directional(c, 14);
  const bbWindow = closes.slice(-20);
  const bbMid = mean(bbWindow);
  const bbSd = stdev(bbWindow);

  const flows = c.map(takerFlow);
  const flow4 = mean(flows.slice(-4));
  const flow8 = mean(flows.slice(-8));

  // Signed run length of consecutive same-direction completed candles.
  let age = 0;
  const lastDir = sign(last.close - last.open);
  if (lastDir !== 0) {
    for (let i = c.length - 1; i >= 0; i--) {
      if (sign(c[i].close - c[i].open) === lastDir) age += 1;
      else break;
    }
  }

  const prior8High = Math.max(...c.slice(-9, -1).map((x) => x.high));
  const prior8Low = Math.min(...c.slice(-9, -1).map((x) => x.low));
  const failedUp = last.high > prior8High && last.close < prior8High ? 1 : 0;
  const failedDown = last.low < prior8Low && last.close > prior8Low ? 1 : 0;

  const window8 = c.slice(-9);
  const logRets8: number[] = [];
  for (let i = 1; i < window8.length; i++) {
    logRets8.push(Math.log(window8[i].close / window8[i - 1].close));
  }
  const path8 = sum(logRets8.map((r) => Math.abs(r)));
  const nonzero8 = logRets8.map(sign).filter((s) => s !== 0);
  let changes8 = 0;
  for (let i = 1; i < nonzero8.length; i++) if (nonzero8[i] !== nonzero8[i - 1]) changes8 += 1;

  const vols20 = c.slice(-20).map((x) => x.volume);
  const trades20 = c.slice(-20).map((x) => x.trade_count);
  const volSd = stdev(vols20);
  const tradeSd = stdev(trades20);

  return {
    ret1: retBps(c, 1),
    ret4: retBps(c, 4),
    ret8: retBps(c, 8),
    ret16: retBps(c, 16),
    body_atr: safeDiv(last.close - last.open, atr14),
    wick_balance: range > 0 ? (lowerWick - upperWick) / range : 0,
    ema9_21_atr: safeDiv(ema9[ema9.length - 1] - ema21[ema21.length - 1], atr14),
    macd_hist_atr: safeDiv(macdHist, atr14),
    rsi_centered: rsi(c, 14) - 50,
    stoch_centered: stochK(c, 14) - 50,
    di_spread: plusDI - minusDI,
    bb_position: bbSd > 0 ? (last.close - bbMid) / (2 * bbSd) : 0,
    taker_flow1: flows[flows.length - 1],
    taker_flow4: flow4,
    taker_flow8: flow8,
    taker_flow_delta: flow4 - flow8,
    trend_signed_age: lastDir * age,
    upper_wick_share: range > 0 ? upperWick / range : 0,
    lower_wick_share: range > 0 ? lowerWick / range : 0,
    failed_breakout: failedUp - failedDown,
    efficiency8: path8 > 0 ? Math.abs(sum(logRets8)) / path8 : 0,
    adx14: adx,
    range_atr: safeDiv(range, atr14),
    atr_ratio4_14: safeDiv(atr4, atr14),
    vol_ratio4_16: safeDiv(mean(c.slice(-4).map((x) => x.volume)), mean(c.slice(-16).map((x) => x.volume))),
    bb_width: bbMid > 0 ? (4 * bbSd) / bbMid : 0,
    volume_z20: volSd > 0 ? (c[c.length - 1].volume - mean(vols20)) / volSd : 0,
    trade_count_z20: tradeSd > 0 ? (c[c.length - 1].trade_count - mean(trades20)) / tradeSd : 0,
    sign_persistence8: nonzero8.length ? Math.abs(mean(nonzero8)) : 0,
    sign_changes8: changes8,
    taker_flow_last: flows[flows.length - 1],
    close: last.close,
  };
}

export interface T10TechnicalResult {
  values: T10FeatureMap;
  ready: boolean;
  reason: string | null;
  basisBps: number | null;
}

/**
 * Build the 65 direction-aligned completed-candle features (Spot block,
 * Futures block, basis / flow-agreement / session terms).
 *
 * `spot` / `fut` are ascending completed candles whose LAST element closed at
 * the target boundary. `priorBasisBps` is the basis one candle earlier.
 */
export function buildT10Technicals(
  targetTs: string,
  d: T10Direction,
  spot: readonly T10Candle[],
  fut: readonly T10Candle[],
): T10TechnicalResult {
  if (spot.length < T10_MIN_TECHNICAL_CANDLES || fut.length < T10_MIN_TECHNICAL_CANDLES) {
    return { values: {}, ready: false, reason: "T10_TECHNICAL_HISTORY_SHORT", basisBps: null };
  }
  const s = venueTechnicals(spot);
  const f = venueTechnicals(fut);
  const sPrev = venueTechnicals(spot.slice(0, -1));
  const fPrev = venueTechnicals(fut.slice(0, -1));

  const basisBps = Math.log(f.close / s.close) * BPS;
  const priorBasisBps = Math.log(fPrev.close / sPrev.close) * BPS;

  const values: T10FeatureMap = {
    aligned_ret1: d * s.ret1,
    aligned_ret4: d * s.ret4,
    aligned_ret8: d * s.ret8,
    aligned_ret16: d * s.ret16,
    aligned_body_atr: d * s.body_atr,
    aligned_wick_balance: d * s.wick_balance,
    aligned_ema9_21_atr: d * s.ema9_21_atr,
    aligned_macd_hist_atr: d * s.macd_hist_atr,
    aligned_rsi_centered: d * s.rsi_centered,
    aligned_stoch_centered: d * s.stoch_centered,
    aligned_di_spread: d * s.di_spread,
    aligned_bb_position: d * s.bb_position,
    aligned_taker_flow1: d * s.taker_flow1,
    aligned_taker_flow4: d * s.taker_flow4,
    aligned_taker_flow8: d * s.taker_flow8,
    aligned_taker_flow_delta: d * s.taker_flow_delta,
    aligned_trend_signed_age: d * s.trend_signed_age,
    directional_wick_threat: d >= 0 ? s.upper_wick_share : s.lower_wick_share,
    directional_wick_support: d >= 0 ? s.lower_wick_share : s.upper_wick_share,
    aligned_failed_breakout: d * s.failed_breakout,
    efficiency8: s.efficiency8,
    adx14: s.adx14,
    range_atr: s.range_atr,
    atr_ratio4_14: s.atr_ratio4_14,
    vol_ratio4_16: s.vol_ratio4_16,
    bb_width: s.bb_width,
    volume_z20: s.volume_z20,
    trade_count_z20: s.trade_count_z20,
    sign_persistence8: s.sign_persistence8,
    sign_changes8: s.sign_changes8,

    aligned_fut_ret1: d * f.ret1,
    aligned_fut_ret4: d * f.ret4,
    aligned_fut_ret8: d * f.ret8,
    aligned_fut_ret16: d * f.ret16,
    aligned_fut_body_atr: d * f.body_atr,
    aligned_fut_wick_balance: d * f.wick_balance,
    aligned_fut_ema9_21_atr: d * f.ema9_21_atr,
    aligned_fut_macd_hist_atr: d * f.macd_hist_atr,
    aligned_fut_rsi_centered: d * f.rsi_centered,
    aligned_fut_stoch_centered: d * f.stoch_centered,
    aligned_fut_di_spread: d * f.di_spread,
    aligned_fut_bb_position: d * f.bb_position,
    aligned_fut_taker_flow1: d * f.taker_flow1,
    aligned_fut_taker_flow4: d * f.taker_flow4,
    aligned_fut_taker_flow8: d * f.taker_flow8,
    aligned_fut_taker_flow_delta: d * f.taker_flow_delta,
    aligned_fut_trend_signed_age: d * f.trend_signed_age,
    fut_directional_wick_threat: d >= 0 ? f.upper_wick_share : f.lower_wick_share,
    fut_directional_wick_support: d >= 0 ? f.lower_wick_share : f.upper_wick_share,
    aligned_fut_failed_breakout: d * f.failed_breakout,
    fut_efficiency8: f.efficiency8,
    fut_adx14: f.adx14,
    fut_range_atr: f.range_atr,
    fut_atr_ratio4_14: f.atr_ratio4_14,
    fut_vol_ratio4_16: f.vol_ratio4_16,
    fut_bb_width: f.bb_width,
    fut_volume_z20: f.volume_z20,
    fut_trade_count_z20: f.trade_count_z20,
    fut_sign_persistence8: f.sign_persistence8,
    fut_sign_changes8: f.sign_changes8,

    aligned_basis_bps: d * basisBps,
    aligned_basis_delta1: d * (basisBps - priorBasisBps),
    spot_fut_flow_agreement: sign(s.taker_flow_last) === sign(f.taker_flow_last) ? 1 : 0,
    ...sessionTerms(targetTs),
  };

  const keys = [...T10_SPOT_TECHNICAL_ORDER, ...T10_FUT_TECHNICAL_ORDER, ...T10_CROSS_ORDER];
  const ready = keys.every((k) => Number.isFinite(values[k]));
  return {
    values,
    ready,
    reason: ready ? null : "T10_TECHNICAL_NON_FINITE",
    basisBps,
  };
}

/** Session sine/cosine from the known target UTC time-of-day. */
export function sessionTerms(targetTs: string): T10FeatureMap {
  const ms = new Date(targetTs).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const frac = ((ms % dayMs) + dayMs) % dayMs / dayMs;
  return {
    session_sin: Math.sin(2 * Math.PI * frac),
    session_cos: Math.cos(2 * Math.PI * frac),
  };
}
