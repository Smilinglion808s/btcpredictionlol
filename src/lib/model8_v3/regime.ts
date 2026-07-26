// Model 3 FWD v3.0.1 — regime monitoring (MONITORING ONLY).
// Pure functions. Output is persisted alongside every prediction row and
// must NEVER enter the feature vector, thresholds, fit selection, or any
// automatic retraining trigger.

import type { Candle } from "./features";

export const REGIME_LABELS = [
  "LOW_VOL_RANGE",
  "LOW_VOL_TREND",
  "HIGH_VOL_RANGE",
  "HIGH_VOL_TREND",
  "TRANSITION",
] as const;
export type RegimeLabel = (typeof REGIME_LABELS)[number];

export const REGIME_TRANSITION_THRESHOLD = 0.5;
export const RAPID_VOL_PCT_CHANGE = 0.3;
export const RAPID_TREND_EFF_CHANGE = 0.3;

export interface RegimeSnapshot {
  atr_14_to_price: number | null;
  realized_volatility_8: number | null;
  realized_volatility_32: number | null;
  volatility_ratio_8_32: number | null;
  trend_efficiency_8: number | null;
  trend_efficiency_32: number | null;
  ema9_minus_ema21_to_atr: number | null;
  volume_zscore_32: number | null;
  volatility_percentile_256: number | null;
  trend_percentile_256: number | null;
  volume_percentile_256: number | null;
  regime_label: RegimeLabel | null;
  regime_transition_score: number | null;
  regime_alerts: Record<string, unknown> | null;
}

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

function trueRange(c: Candle, prevClose: number): number {
  return Math.max(
    c.high - c.low,
    Math.abs(c.high - prevClose),
    Math.abs(c.low - prevClose),
  );
}

function atr14(candles: Candle[]): number[] {
  const out = new Array<number>(candles.length).fill(0);
  const trs: number[] = [0];
  for (let i = 1; i < candles.length; i++) trs.push(trueRange(candles[i], candles[i - 1].close));
  let sum = 0;
  for (let i = 1; i <= 14 && i < trs.length; i++) sum += trs[i];
  if (candles.length > 14) out[14] = sum / 14;
  for (let i = 15; i < candles.length; i++) out[i] = (out[i - 1] * 13 + trs[i]) / 14;
  return out;
}

function std(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  const v = values.reduce((a, b) => a + (b - m) * (b - m), 0) / values.length;
  return Math.sqrt(v);
}

function realizedVol(closes: number[], window: number, endIdx: number): number | null {
  if (endIdx < window) return null;
  const rets: number[] = [];
  for (let i = endIdx - window + 1; i <= endIdx; i++) {
    if (closes[i - 1] > 0 && closes[i] > 0) rets.push(Math.log(closes[i] / closes[i - 1]));
  }
  return std(rets);
}

function trendEfficiency(closes: number[], window: number, endIdx: number): number | null {
  if (endIdx < window) return null;
  const start = endIdx - window;
  const net = Math.abs(closes[endIdx] - closes[start]);
  let path = 0;
  for (let i = start + 1; i <= endIdx; i++) path += Math.abs(closes[i] - closes[i - 1]);
  return path > 0 ? net / path : 0;
}

function percentileRank(series: number[], value: number): number | null {
  if (!series.length || Number.isNaN(value)) return null;
  let below = 0;
  for (const v of series) if (v <= value) below++;
  return below / series.length;
}

function classifyRegime(volPct: number | null, trendPct: number | null, transitionScore: number): RegimeLabel | null {
  if (transitionScore >= REGIME_TRANSITION_THRESHOLD) return "TRANSITION";
  if (volPct == null || trendPct == null) return null;
  const highVol = volPct >= 0.5;
  const trending = trendPct >= 0.5;
  if (highVol && trending) return "HIGH_VOL_TREND";
  if (highVol && !trending) return "HIGH_VOL_RANGE";
  if (!highVol && trending) return "LOW_VOL_TREND";
  return "LOW_VOL_RANGE";
}

/** Compute regime snapshot from strictly-prior candles (chronological, oldest→newest). */
export function computeRegimeSnapshot(candles: Candle[]): RegimeSnapshot {
  const empty: RegimeSnapshot = {
    atr_14_to_price: null, realized_volatility_8: null, realized_volatility_32: null,
    volatility_ratio_8_32: null, trend_efficiency_8: null, trend_efficiency_32: null,
    ema9_minus_ema21_to_atr: null, volume_zscore_32: null,
    volatility_percentile_256: null, trend_percentile_256: null, volume_percentile_256: null,
    regime_label: null, regime_transition_score: null, regime_alerts: null,
  };
  const n = candles.length;
  if (n < 33) return empty;

  const closes = candles.map((c) => c.close);
  const vols = candles.map((c) => c.volume ?? 0);
  const last = n - 1;

  const atrArr = atr14(candles);
  const atrNow = atrArr[last] || null;
  const price = closes[last];
  const atrToPrice = atrNow && price > 0 ? atrNow / price : null;

  const rv8 = realizedVol(closes, 8, last);
  const rv32 = realizedVol(closes, 32, last);
  const volRatio = rv8 != null && rv32 != null && rv32 > 0 ? rv8 / rv32 : null;

  const te8 = trendEfficiency(closes, 8, last);
  const te32 = trendEfficiency(closes, 32, last);

  const e9 = ema(closes, 9);
  const e21 = ema(closes, 21);
  const emaSpread = atrNow && atrNow > 0 ? (e9[last] - e21[last]) / atrNow : null;

  const vw = vols.slice(Math.max(0, last - 31), last + 1);
  const vMean = vw.reduce((a, b) => a + b, 0) / vw.length;
  const vStd = std(vw);
  const volZ = vStd > 0 ? (vols[last] - vMean) / vStd : null;

  // Rolling 256-window percentile series built from prior indices.
  const winStart = Math.max(0, last - 255);
  const vpSeries: number[] = [];
  const tpSeries: number[] = [];
  const volumeSeries: number[] = [];
  for (let i = winStart; i <= last; i++) {
    const r = realizedVol(closes, 8, i);
    const t = trendEfficiency(closes, 8, i);
    if (r != null) vpSeries.push(r);
    if (t != null) tpSeries.push(t);
    volumeSeries.push(vols[i]);
  }
  const volatilityPct = rv8 != null ? percentileRank(vpSeries, rv8) : null;
  const trendPct = te8 != null ? percentileRank(tpSeries, te8) : null;
  const volumePct = percentileRank(volumeSeries, vols[last]);

  // Transition score = magnitude of 4-candle percentile change (vol + trend).
  let transitionScore = 0;
  if (last >= 4) {
    const rvPrev = realizedVol(closes, 8, last - 4);
    const tePrev = trendEfficiency(closes, 8, last - 4);
    const vpPrev = rvPrev != null ? percentileRank(vpSeries, rvPrev) : null;
    const tpPrev = tePrev != null ? percentileRank(tpSeries, tePrev) : null;
    const dv = volatilityPct != null && vpPrev != null ? Math.abs(volatilityPct - vpPrev) : 0;
    const dt = trendPct != null && tpPrev != null ? Math.abs(trendPct - tpPrev) : 0;
    transitionScore = Math.min(1, dv + dt);
  }

  const label = classifyRegime(volatilityPct, trendPct, transitionScore);

  const alerts: Record<string, unknown> = {};
  if (last >= 4) {
    const rvPrev = realizedVol(closes, 8, last - 4);
    if (rvPrev != null && volatilityPct != null) {
      const vpPrev = percentileRank(vpSeries, rvPrev);
      if (vpPrev != null && Math.abs(volatilityPct - vpPrev) >= RAPID_VOL_PCT_CHANGE) {
        alerts.rapid_volatility_percentile_change = { from: vpPrev, to: volatilityPct };
      }
    }
    const tePrev = trendEfficiency(closes, 8, last - 4);
    if (tePrev != null && te8 != null && Math.abs(te8 - tePrev) >= RAPID_TREND_EFF_CHANGE) {
      alerts.rapid_trend_efficiency_change = { from: tePrev, to: te8 };
    }
  }
  if (transitionScore >= REGIME_TRANSITION_THRESHOLD) {
    alerts.regime_transition = { score: transitionScore, threshold: REGIME_TRANSITION_THRESHOLD };
  }

  return {
    atr_14_to_price: atrToPrice,
    realized_volatility_8: rv8,
    realized_volatility_32: rv32,
    volatility_ratio_8_32: volRatio,
    trend_efficiency_8: te8,
    trend_efficiency_32: te32,
    ema9_minus_ema21_to_atr: emaSpread,
    volume_zscore_32: volZ,
    volatility_percentile_256: volatilityPct,
    trend_percentile_256: trendPct,
    volume_percentile_256: volumePct,
    regime_label: label,
    regime_transition_score: transitionScore,
    regime_alerts: Object.keys(alerts).length ? alerts : null,
  };
}
