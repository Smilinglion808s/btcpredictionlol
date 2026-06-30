// Shared indicator helpers (pure functions, safe on server & client).
export interface Candle {
  candle_ts: string; // ISO
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export function ema(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  out.push(prev);
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

export function computeIndicatorBundle(candles: Candle[]) {
  if (candles.length === 0) return null;
  const closes = candles.map((c) => c.close);
  const ema9 = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const last = candles[candles.length - 1];
  const prev = candles[candles.length - 2] ?? last;
  const body = Math.abs(last.close - last.open);
  const range = Math.max(last.high - last.low, 1e-9);
  const upperWick = last.high - Math.max(last.open, last.close);
  const lowerWick = Math.min(last.open, last.close) - last.low;
  const bodyPct = body / range;
  const upperWickPct = upperWick / range;
  const lowerWickPct = lowerWick / range;

  const last20 = candles.slice(-20);
  const high20 = Math.max(...last20.map((c) => c.high));
  const low20 = Math.min(...last20.map((c) => c.low));
  const volAvg = last20.reduce((s, c) => s + c.volume, 0) / last20.length;
  const volExpansion = last.volume / Math.max(volAvg, 1e-9);

  const e9 = ema9[ema9.length - 1];
  const e21 = ema21[ema21.length - 1];
  const e50 = ema50[ema50.length - 1];
  const trend =
    e9 > e21 && e21 > e50 ? "up" : e9 < e21 && e21 < e50 ? "down" : "mixed";

  const failedBreakoutUp =
    prev.high >= high20 * 0.999 && last.close < high20 * 0.997;
  const failedBreakoutDown =
    prev.low <= low20 * 1.001 && last.close > low20 * 1.003;

  const choppy =
    Math.abs(e9 - e21) / Math.max(last.close, 1e-9) < 0.0015 && bodyPct < 0.3;

  return {
    last,
    ema9: e9,
    ema21: e21,
    ema50: e50,
    trend,
    bodyPct: round(bodyPct, 3),
    upperWickPct: round(upperWickPct, 3),
    lowerWickPct: round(lowerWickPct, 3),
    range20High: high20,
    range20Low: low20,
    volumeExpansion: round(volExpansion, 2),
    failedBreakoutUp,
    failedBreakoutDown,
    choppy,
    ema9Series: ema9,
    ema21Series: ema21,
    ema50Series: ema50,
  };
}

function round(n: number, d: number) {
  const f = Math.pow(10, d);
  return Math.round(n * f) / f;
}

export const FIFTEEN_MIN_MS = 15 * 60 * 1000;

export function nextCandleTs(candleTs: string): string {
  return new Date(new Date(candleTs).getTime() + FIFTEEN_MIN_MS).toISOString();
}
