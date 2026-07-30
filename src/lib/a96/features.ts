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
