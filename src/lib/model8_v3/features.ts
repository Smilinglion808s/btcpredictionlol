// Feature builder for model8_v3. Pure functions over an ordered array of
// confirmed candles. No I/O. No external dependencies. Chronological (oldest
// first). Feature vector for index i uses ONLY candles[0..i] (no leakage).

export interface Candle {
  ts: string; // ISO
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const M8V3_FEATURE_NAMES = [
  "ret_1",
  "ret_3",
  "ret_6",
  "ret_12",
  "ret_24",
  "range_1",
  "body_1",
  "close_pos_1",
  "ema9_dist",
  "ema21_dist",
  "rsi14",
  "vol_12",
  "hi_dist_20",
  "lo_dist_20",
] as const;
export type M8V3FeatureName = (typeof M8V3_FEATURE_NAMES)[number];

function ema(values: number[], span: number): number[] {
  const out = new Array<number>(values.length).fill(0);
  const k = 2 / (span + 1);
  let prev = values[0];
  out[0] = prev;
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rsi(closes: number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(50);
  if (closes.length < period + 1) return out;
  let gain = 0, loss = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) gain += d; else loss -= d;
  }
  let avgG = gain / period, avgL = loss / period;
  out[period] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const g = d > 0 ? d : 0;
    const l = d < 0 ? -d : 0;
    avgG = (avgG * (period - 1) + g) / period;
    avgL = (avgL * (period - 1) + l) / period;
    out[i] = avgL === 0 ? 100 : 100 - 100 / (1 + avgG / avgL);
  }
  return out;
}

function safeLogRet(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  return Math.log(a / b);
}

/**
 * Build feature matrix and labels from `candles` (chronological).
 * Label at index i is direction of candle i+1 vs candle i's close (via next open→close).
 * We follow "GREEN if next.close > next.open, RED if <, PUSH if =".
 * Rows with label=PUSH are dropped from training.
 */
export function buildTrainingMatrix(candles: Candle[]): {
  X: number[][]; // n_samples x n_features
  y: number[]; // 1 = GREEN, 0 = RED
  targetFeatureRow: number[]; // features for the newest candle (label unknown)
} {
  const n = candles.length;
  const closes = candles.map((c) => c.close);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const rsi14 = rsi(closes, 14);

  const featRow = (i: number): number[] => {
    const c = candles[i];
    const range = c.high - c.low;
    const body = c.close - c.open;
    const closePos = range > 0 ? (c.close - c.low) / range : 0.5;
    const closesUpTo = closes.slice(Math.max(0, i - 12), i + 1);
    const rets: number[] = [];
    for (let k = 1; k < closesUpTo.length; k++) rets.push(safeLogRet(closesUpTo[k], closesUpTo[k - 1]));
    const mean = rets.length ? rets.reduce((a, b) => a + b, 0) / rets.length : 0;
    const variance = rets.length ? rets.reduce((a, b) => a + (b - mean) * (b - mean), 0) / rets.length : 0;
    const vol12 = Math.sqrt(variance);
    const window20 = candles.slice(Math.max(0, i - 19), i + 1);
    const hi20 = Math.max(...window20.map((x) => x.high));
    const lo20 = Math.min(...window20.map((x) => x.low));
    return [
      i >= 1 ? safeLogRet(closes[i], closes[i - 1]) : 0,
      i >= 3 ? safeLogRet(closes[i], closes[i - 3]) : 0,
      i >= 6 ? safeLogRet(closes[i], closes[i - 6]) : 0,
      i >= 12 ? safeLogRet(closes[i], closes[i - 12]) : 0,
      i >= 24 ? safeLogRet(closes[i], closes[i - 24]) : 0,
      c.close > 0 ? range / c.close : 0,
      c.close > 0 ? body / c.close : 0,
      closePos,
      c.close > 0 ? (c.close - ema9[i]) / c.close : 0,
      c.close > 0 ? (c.close - ema21[i]) / c.close : 0,
      (rsi14[i] - 50) / 50,
      vol12,
      c.close > 0 ? (hi20 - c.close) / c.close : 0,
      c.close > 0 ? (c.close - lo20) / c.close : 0,
    ];
  };

  const X: number[][] = [];
  const y: number[] = [];
  // Only train on candle indices where i>=24 (lag stable) and i+1 exists with directional label.
  for (let i = 24; i < n - 1; i++) {
    const nxt = candles[i + 1];
    if (nxt.close === nxt.open) continue; // PUSH → drop
    X.push(featRow(i));
    y.push(nxt.close > nxt.open ? 1 : 0);
  }
  const targetFeatureRow = featRow(n - 1);
  return { X, y, targetFeatureRow };
}
