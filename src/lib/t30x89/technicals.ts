// Cross89 — prior-candle 15-minute technical block (pure).
//
// Computed from Binance 15m candles that are FULLY COMPLETED before the target
// boundary T. The series is shifted one row: the newest usable candle is the
// one that closed exactly at T (i.e. opened at T - 15m). Nothing from the
// in-progress candle may reach this module.

export interface Tech15mCandle {
  /** Candle open time in ms (UTC). */
  openMs: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  tradeCount: number;
  takerBuyQuoteVolume: number;
}

/** Raw (unaligned) technical values for one index of the series. */
export interface TechValues {
  ret1: number;
  ret4: number;
  ret8: number;
  ret16: number;
  bodyAtr: number;
  wickBalance: number;
  upperWickFrac: number;
  lowerWickFrac: number;
  ema9_21_atr: number;
  macdHistAtr: number;
  rsiCentered: number;
  stochCentered: number;
  diSpread: number;
  bbPosition: number;
  takerFlow1: number;
  takerFlow4: number;
  takerFlow8: number;
  takerFlowDelta: number;
  trendSignedAge: number;
  failedBreakout: number;
  efficiency8: number;
  adx14: number;
  rangeAtr: number;
  atrRatio4_14: number;
  volRatio4_16: number;
  bbWidth: number;
  volumeZ20: number;
  tradeCountZ20: number;
  signPersistence8: number;
  signChanges8: number;
  close: number;
  quoteFlow: number;
}

/** Minimum history required before any index can be evaluated. */
export const TECH_MIN_HISTORY = 60;

const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);
const logRetBps = (a: number, b: number): number => Math.log(a / b) * 10_000;

function mean(xs: readonly number[]): number {
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: readonly number[]): number {
  const m = mean(xs);
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / xs.length);
}

function ema(values: readonly number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  for (let i = 0; i < values.length; i++) {
    prev = i === 0 ? values[0] : values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function trueRange(c: Tech15mCandle, prev: Tech15mCandle | undefined): number {
  if (!prev) return c.high - c.low;
  return Math.max(c.high - c.low, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
}

/** Simple-moving-average ATR, the frozen convention. */
function atrAt(series: readonly Tech15mCandle[], i: number, period: number): number {
  let sum = 0;
  for (let k = i - period + 1; k <= i; k++) sum += trueRange(series[k], series[k - 1]);
  return sum / period;
}

function rsi14(series: readonly Tech15mCandle[], i: number): number {
  let gain = 0;
  let loss = 0;
  for (let k = i - 13; k <= i; k++) {
    const d = series[k].close - series[k - 1].close;
    if (d >= 0) gain += d;
    else loss -= d;
  }
  const avgG = gain / 14;
  const avgL = loss / 14;
  if (avgL === 0) return avgG === 0 ? 50 : 100;
  const rs = avgG / avgL;
  return 100 - 100 / (1 + rs);
}

function stoch14(series: readonly Tech15mCandle[], i: number): number {
  let hi = -Infinity;
  let lo = Infinity;
  for (let k = i - 13; k <= i; k++) {
    hi = Math.max(hi, series[k].high);
    lo = Math.min(lo, series[k].low);
  }
  return hi > lo ? ((series[i].close - lo) / (hi - lo)) * 100 : 50;
}

/** Wilder DI/ADX over 14, computed with simple smoothing to stay deterministic. */
function dmiAdx(series: readonly Tech15mCandle[], i: number): { diSpread: number; adx: number } {
  const dxs: number[] = [];
  let last = { plus: 0, minus: 0 };
  for (let end = i - 13; end <= i; end++) {
    let plusDM = 0;
    let minusDM = 0;
    let tr = 0;
    for (let k = end - 13; k <= end; k++) {
      const up = series[k].high - series[k - 1].high;
      const down = series[k - 1].low - series[k].low;
      if (up > down && up > 0) plusDM += up;
      if (down > up && down > 0) minusDM += down;
      tr += trueRange(series[k], series[k - 1]);
    }
    const plusDI = tr > 0 ? (100 * plusDM) / tr : 0;
    const minusDI = tr > 0 ? (100 * minusDM) / tr : 0;
    last = { plus: plusDI, minus: minusDI };
    const sum = plusDI + minusDI;
    dxs.push(sum > 0 ? (100 * Math.abs(plusDI - minusDI)) / sum : 0);
  }
  return { diSpread: last.plus - last.minus, adx: mean(dxs) };
}

function flowOver(series: readonly Tech15mCandle[], i: number, n: number): number {
  let q = 0;
  let b = 0;
  for (let k = i - n + 1; k <= i; k++) {
    q += series[k].quoteVolume;
    b += series[k].takerBuyQuoteVolume;
  }
  return q > 0 ? (2 * b) / q - 1 : NaN;
}

function efficiency(series: readonly Tech15mCandle[], i: number, n: number): number {
  let path = 0;
  for (let k = i - n + 1; k <= i; k++) path += Math.abs(Math.log(series[k].close / series[k - 1].close));
  return path > 0 ? Math.abs(Math.log(series[i].close / series[i - n].close)) / path : 0;
}

/**
 * Technicals at index `i` of a chronologically ascending 15m series.
 * Returns null when the index has insufficient history.
 */
export function techAt(series: readonly Tech15mCandle[], i: number): TechValues | null {
  if (i < TECH_MIN_HISTORY || i >= series.length) return null;
  const c = series[i];
  const closes = series.map((s) => s.close);

  const atr14 = atrAt(series, i, 14);
  const atr4 = atrAt(series, i, 4);
  const range = c.high - c.low;
  const body = c.close - c.open;
  const upper = range > 0 ? (c.high - Math.max(c.open, c.close)) / range : 0;
  const lower = range > 0 ? (Math.min(c.open, c.close) - c.low) / range : 0;

  const closeSlice = closes.slice(0, i + 1);
  const e9 = ema(closeSlice, 9);
  const e21 = ema(closeSlice, 21);
  const e12 = ema(closeSlice, 12);
  const e26 = ema(closeSlice, 26);
  const macdLine = e12.map((v, k) => v - e26[k]);
  const signalLine = ema(macdLine, 9);
  const macdHist = macdLine[i] - signalLine[i];

  const { diSpread, adx } = dmiAdx(series, i);

  const win20 = closes.slice(i - 19, i + 1);
  const mid20 = mean(win20);
  const sd20 = stdev(win20);
  const bbPosition = sd20 > 0 ? (c.close - mid20) / (2 * sd20) : NaN;
  const bbWidth = mid20 > 0 && sd20 > 0 ? (4 * sd20) / mid20 : NaN;

  const f1 = flowOver(series, i, 1);
  const f4 = flowOver(series, i, 4);
  const f8 = flowOver(series, i, 8);

  const vols = series.slice(i - 19, i + 1).map((s) => s.volume);
  const trs = series.slice(i - 19, i + 1).map((s) => s.tradeCount);
  const volSd = stdev(vols);
  const trSd = stdev(trs);

  const vol4 = mean(series.slice(i - 3, i + 1).map((s) => s.volume));
  const vol16 = mean(series.slice(i - 15, i + 1).map((s) => s.volume));

  const signs: number[] = [];
  for (let k = i - 7; k <= i; k++) signs.push(sign(series[k].close - series[k - 1].close));
  const nonzero = signs.filter((s) => s !== 0);
  let changes = 0;
  for (let k = 1; k < nonzero.length; k++) if (nonzero[k] !== nonzero[k - 1]) changes++;

  // Signed trend age: consecutive candles with EMA9 above/below EMA21.
  const trendSign = sign(e9[i] - e21[i]);
  let age = 0;
  for (let k = i; k >= 1; k--) {
    if (sign(e9[k] - e21[k]) !== trendSign || trendSign === 0) break;
    age++;
  }

  // Failed breakout against the prior 20-candle range (excludes candle i).
  let priorHigh = -Infinity;
  let priorLow = Infinity;
  for (let k = i - 20; k <= i - 1; k++) {
    priorHigh = Math.max(priorHigh, series[k].high);
    priorLow = Math.min(priorLow, series[k].low);
  }
  const failedBreakout =
    c.high > priorHigh && c.close < priorHigh ? -1 : c.low < priorLow && c.close > priorLow ? 1 : 0;

  return {
    ret1: logRetBps(c.close, closes[i - 1]),
    ret4: logRetBps(c.close, closes[i - 4]),
    ret8: logRetBps(c.close, closes[i - 8]),
    ret16: logRetBps(c.close, closes[i - 16]),
    bodyAtr: atr14 > 0 ? body / atr14 : NaN,
    wickBalance: lower - upper,
    upperWickFrac: upper,
    lowerWickFrac: lower,
    ema9_21_atr: atr14 > 0 ? (e9[i] - e21[i]) / atr14 : NaN,
    macdHistAtr: atr14 > 0 ? macdHist / atr14 : NaN,
    rsiCentered: rsi14(series, i) - 50,
    stochCentered: stoch14(series, i) - 50,
    diSpread,
    bbPosition,
    takerFlow1: f1,
    takerFlow4: f4,
    takerFlow8: f8,
    takerFlowDelta: f1 - f4,
    trendSignedAge: trendSign * age,
    failedBreakout,
    efficiency8: efficiency(series, i, 8),
    adx14: adx,
    rangeAtr: atr14 > 0 ? range / atr14 : NaN,
    atrRatio4_14: atr14 > 0 ? atr4 / atr14 : NaN,
    volRatio4_16: vol16 > 0 ? vol4 / vol16 : NaN,
    bbWidth,
    volumeZ20: volSd > 0 ? (c.volume - mean(vols)) / volSd : NaN,
    tradeCountZ20: trSd > 0 ? (c.tradeCount - mean(trs)) / trSd : NaN,
    signPersistence8: nonzero.length ? Math.abs(nonzero.reduce((a, b) => a + b, 0)) / nonzero.length : 0,
    signChanges8: nonzero.length > 1 ? changes / (nonzero.length - 1) : 0,
    close: c.close,
    quoteFlow: f1,
  };
}
