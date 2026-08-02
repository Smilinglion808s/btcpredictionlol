import type { Candle } from "./types";
import { A96_CONFIG } from "./config";

export class CandleHistoryError extends Error {}

export function bodyToRange(c: Candle): number {
  const range = c.high - c.low;
  if (range <= 0) return 0.0;
  return Math.abs(c.close - c.open) / range;
}

export interface FourCandleEfficiency {
  net_displacement: number;
  total_body_path: number;
  path_efficiency: number;
}

/**
 * r3 four-candle path efficiency, computed from the immutable prediction-time
 * prior-candle snapshot (T-60, T-45, T-30, T-15, oldest → newest).
 *
 * netDisplacement = |priorCandles[3].close - priorCandles[0].open|
 * totalBodyPath   = sum of |close - open| across the four candles
 * efficiency      = totalBodyPath > 0 ? netDisplacement / totalBodyPath : 0.0
 *
 * Returns null when exactly four candles are not available (no substitution,
 * no clamping, no rounding).
 */
export function fourCandleEfficiency(priorCandles: Candle[]): FourCandleEfficiency | null {
  const need = A96_CONFIG.required_prior_candles;
  if (!Array.isArray(priorCandles) || priorCandles.length !== need) return null;
  const first = priorCandles[0];
  const last = priorCandles[need - 1];
  if (!first || !last) return null;
  const net_displacement = Math.abs(last.close - first.open);
  const total_body_path = priorCandles.reduce((sum, c) => sum + Math.abs(c.close - c.open), 0);
  const path_efficiency = total_body_path > 0 ? net_displacement / total_body_path : 0.0;
  return { net_displacement, total_body_path, path_efficiency };
}

interface AgreementFeatures {
  distance_from_4_candle_low_bps: number;
  mean_2_candle_body_to_range: number;
}

export function agreementFeatures(args: {
  priorCandles: Candle[];
  targetTimestamp: Date;
  targetOpen: number;
  required?: number;
  expectedSec?: number;
}): AgreementFeatures {
  const required = args.required ?? A96_CONFIG.required_prior_candles;
  const expectedSec = args.expectedSec ?? A96_CONFIG.expected_candle_seconds;
  if (!(args.targetOpen > 0)) throw new CandleHistoryError("target_open must be positive");
  if (args.priorCandles.length < required) {
    throw new CandleHistoryError(`Need ${required} completed candles; received ${args.priorCandles.length}`);
  }
  const sorted = [...args.priorCandles].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime()).slice(-required);
  for (let i = 1; i < sorted.length; i++) {
    const delta = (sorted[i].timestamp.getTime() - sorted[i - 1].timestamp.getTime()) / 1000;
    if (delta !== expectedSec) {
      throw new CandleHistoryError(`Non-contiguous candle history: observed ${delta}s, expected ${expectedSec}s`);
    }
  }
  const finalDelta = (args.targetTimestamp.getTime() - sorted[sorted.length - 1].timestamp.getTime()) / 1000;
  if (finalDelta !== expectedSec) {
    throw new CandleHistoryError(
      `Latest candle is not immediately prior to target: observed ${finalDelta}s, expected ${expectedSec}s`,
    );
  }
  const recentLow = Math.min(...sorted.map((c) => c.low));
  const distance = ((args.targetOpen - recentLow) / args.targetOpen) * 10000.0;
  const last2 = sorted.slice(-2);
  const mean2 = (bodyToRange(last2[0]) + bodyToRange(last2[1])) / 2.0;
  return {
    distance_from_4_candle_low_bps: distance,
    mean_2_candle_body_to_range: mean2,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// a96-r4 features. All pure, deterministic, prediction-time only.
// No rounding, no clamping, no zero substitution. Invalid ⇒ null.
// ─────────────────────────────────────────────────────────────────────────────

export interface TwoCandleBody {
  body_to_range_t15: number;
  body_to_range_t30: number;
  mean_two_body_to_range: number;
}

/**
 * Mean body-to-range across the two most recent prior candles (T-30, T-15).
 * `priorCandles` must be exactly the four required candles, oldest → newest.
 * Returns null when a range is <= 0 or a value is non-finite.
 */
export function meanTwoCandleBodyToRange(priorCandles: Candle[]): TwoCandleBody | null {
  const need = A96_CONFIG.required_prior_candles;
  if (!Array.isArray(priorCandles) || priorCandles.length !== need) return null;
  const t30 = priorCandles[need - 2];
  const t15 = priorCandles[need - 1];
  if (!t30 || !t15) return null;
  const ratio = (c: Candle): number | null => {
    const range = c.high - c.low;
    if (!Number.isFinite(range) || range <= 0) return null;
    const v = Math.abs(c.close - c.open) / range;
    return Number.isFinite(v) ? v : null;
  };
  const r30 = ratio(t30);
  const r15 = ratio(t15);
  if (r30 == null || r15 == null) return null;
  return {
    body_to_range_t15: r15,
    body_to_range_t30: r30,
    mean_two_body_to_range: (r15 + r30) / 2,
  };
}

export interface WickPressure {
  raw: number[];
  aligned: number[];
  direction_sign: 1 | -1;
  four_candle_aligned_wick_pressure: number;
}

/**
 * Four-candle direction-aligned wick pressure over T-60..T-15.
 * rawWickPressure = (lowerWick - upperWick) / range; aligned = raw * sign.
 * Returns null when any range is <= 0 or a value is non-finite.
 */
export function fourCandleAlignedWickPressure(
  priorCandles: Candle[],
  layerADirection: "GREEN" | "RED",
): WickPressure | null {
  const need = A96_CONFIG.required_prior_candles;
  if (!Array.isArray(priorCandles) || priorCandles.length !== need) return null;
  const sign: 1 | -1 = layerADirection === "GREEN" ? 1 : -1;
  const raw: number[] = [];
  for (const c of priorCandles) {
    const range = c.high - c.low;
    if (!Number.isFinite(range) || range <= 0) return null;
    const lowerWick = Math.min(c.open, c.close) - c.low;
    const upperWick = c.high - Math.max(c.open, c.close);
    const v = (lowerWick - upperWick) / range;
    if (!Number.isFinite(v)) return null;
    raw.push(v);
  }
  const aligned = raw.map((v) => v * sign);
  const mean = aligned.reduce((s, v) => s + v, 0) / aligned.length;
  if (!Number.isFinite(mean)) return null;
  return { raw, aligned, direction_sign: sign, four_candle_aligned_wick_pressure: mean };
}

/** EMA with adjust=false, seeded on the first value. */
export function emaAdjustFalse(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + out[i - 1] * (1 - k));
  }
  return out;
}

export interface TechnicalSnapshot {
  macd_hist: number;
  atr14: number;
}

/**
 * MACD histogram + ATR14 for the LAST candle of `candles` (which must be the
 * confirmed T-15m candle). Requires at least `technical_min_history_candles`
 * contiguous confirmed candles. Returns null when inputs are unusable.
 */
export function macdAtrFromSeries(candles: Candle[]): TechnicalSnapshot | null {
  const minLen = A96_CONFIG.technical_min_history_candles;
  if (!Array.isArray(candles) || candles.length < minLen) return null;
  for (const c of candles) {
    if (![c.open, c.high, c.low, c.close].every((n) => Number.isFinite(n) && n > 0)) return null;
  }
  const closes = candles.map((c) => c.close);
  const ema12 = emaAdjustFalse(closes, A96_CONFIG.macd_fast_period);
  const ema26 = emaAdjustFalse(closes, A96_CONFIG.macd_slow_period);
  const macdLine = closes.map((_, i) => ema12[i] - ema26[i]);
  const signal = emaAdjustFalse(macdLine, A96_CONFIG.macd_signal_period);
  const macd_hist = macdLine[macdLine.length - 1] - signal[signal.length - 1];
  if (!Number.isFinite(macd_hist)) return null;

  const trs: number[] = [];
  for (let i = 1; i < candles.length; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    trs.push(Math.max(c.high - c.low, Math.abs(c.high - prevClose), Math.abs(c.low - prevClose)));
  }
  const p = A96_CONFIG.atr_period;
  if (trs.length < p) return null;
  const window = trs.slice(-p);
  const atr14 = window.reduce((s, v) => s + v, 0) / p;
  if (!Number.isFinite(atr14) || atr14 <= 0) return null;
  return { macd_hist, atr14 };
}

/** (macdHist / atr14) * directionSign. Null when unusable. */
export function alignedMacdHistAtr(
  macdHist: number | null | undefined,
  atr14: number | null | undefined,
  layerADirection: "GREEN" | "RED",
): number | null {
  if (macdHist == null || atr14 == null) return null;
  const m = Number(macdHist);
  const a = Number(atr14);
  if (!Number.isFinite(m)) return null;
  if (!Number.isFinite(a) || a <= 0) return null;
  const sign = layerADirection === "GREEN" ? 1 : -1;
  const v = (m / a) * sign;
  return Number.isFinite(v) ? v : null;
}
