// Cross89 — walk-forward correctness head, dual ranks and frozen decision rule.

import { fitCertifiedLogistic } from "@/lib/b4x4es1/certifiedFit";
import {
  T30X_FAST_RANK_MIN,
  T30X_FAST_RANK_WINDOW,
  T30X_FIRST_FIT_INDEX,
  T30X_FIT_BLOCK_SIZE,
  T30X_LOGISTIC_C,
  T30X_LONG_RANK_MIN,
  T30X_LONG_RANK_WINDOW,
  T30X_MAX_ITER,
  T30X_MAX_LOOKBACK,
  T30X_REASONS,
  T30X_SCALER_Q_HIGH,
  T30X_SCALER_Q_LOW,
  T30X_TOL,
  utcDate,
  type T30XDirection,
} from "./config";

export interface X89Scaler {
  center: number[];
  scale: number[];
}

export interface X89TrainingRow {
  targetTs: string;
  index: number;
  vector: number[];
  /** Correctness label: 1 correct, 0 incorrect. PUSH rows are excluded. */
  label: 0 | 1;
}

export interface X89Head {
  scaler: X89Scaler;
  coefficients: number[];
  intercept: number;
  trainingRowCount: number;
  trainingStartIndex: number;
  trainingEndIndex: number;
  trainingStartTs: string;
  trainingEndTs: string;
  blockStartIndex: number;
  converged: boolean;
  iterations: number;
  gradientNorm: number;
}

export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function fitX89Scaler(X: readonly (readonly number[])[]): X89Scaler {
  const d = X[0]?.length ?? 0;
  const center: number[] = [];
  const scale: number[] = [];
  for (let j = 0; j < d; j++) {
    const col = X.map((r) => r[j]).sort((a, b) => a - b);
    center.push(quantile(col, 0.5));
    const iqr = quantile(col, T30X_SCALER_Q_HIGH) - quantile(col, T30X_SCALER_Q_LOW);
    scale.push(iqr > 0 && Number.isFinite(iqr) ? iqr : 1);
  }
  return { center, scale };
}

export function applyX89Scaler(s: X89Scaler, x: readonly number[]): number[] {
  return x.map((v, j) => (v - s.center[j]) / s.scale[j]);
}

/** UTC-day balanced sample weights normalized to mean 1. */
export function dayBalancedWeights(timestamps: readonly string[]): number[] {
  const counts = new Map<string, number>();
  for (const ts of timestamps) {
    const d = utcDate(ts);
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }
  const raw = timestamps.map((ts) => 1 / (counts.get(utcDate(ts)) ?? 1));
  const m = raw.reduce((a, b) => a + b, 0) / raw.length;
  return raw.map((w) => w / m);
}

/** Blocks start at 2784 and repeat every 96 source rows. */
export function blockStartFor(index: number): number | null {
  if (index < T30X_FIRST_FIT_INDEX) return null;
  const k = Math.floor((index - T30X_FIRST_FIT_INDEX) / T30X_FIT_BLOCK_SIZE);
  return T30X_FIRST_FIT_INDEX + k * T30X_FIT_BLOCK_SIZE;
}

export function trainingRangeFor(blockStart: number): { from: number; to: number } {
  return { from: Math.max(0, blockStart - T30X_MAX_LOOKBACK), to: blockStart };
}

/** Deterministic walk-forward fit for one block boundary. */
export function fitX89Head(blockStart: number, rows: readonly X89TrainingRow[]): X89Head {
  if (rows.length === 0) throw new Error("T30X_EMPTY_TRAINING_WINDOW");
  const X = rows.map((r) => r.vector);
  const scaler = fitX89Scaler(X);
  const Z = X.map((x) => applyX89Scaler(scaler, x));
  const weights = dayBalancedWeights(rows.map((r) => r.targetTs));
  const fit = fitCertifiedLogistic(
    Z,
    rows.map((r) => r.label),
    weights,
    { C: T30X_LOGISTIC_C, tol: T30X_TOL, maxIter: T30X_MAX_ITER },
  );
  return {
    scaler,
    coefficients: fit.coefficients,
    intercept: fit.intercept,
    trainingRowCount: rows.length,
    trainingStartIndex: rows[0].index,
    trainingEndIndex: rows[rows.length - 1].index,
    trainingStartTs: rows[0].targetTs,
    trainingEndTs: rows[rows.length - 1].targetTs,
    blockStartIndex: blockStart,
    converged: fit.converged,
    iterations: fit.iterations,
    gradientNorm: fit.gradientNorm,
  };
}

export function probabilityCorrect(head: X89Head, vector: readonly number[]): number {
  const z = applyX89Scaler(head.scaler, vector).reduce(
    (acc, v, j) => acc + v * head.coefficients[j],
    head.intercept,
  );
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

/** Frozen percentile: count(previous <= current) / historyLength. */
export function percentileRank(current: number, history: readonly number[]): number | null {
  if (history.length === 0) return null;
  let c = 0;
  for (const v of history) {
    if (!Number.isFinite(v)) return null;
    if (v <= current) c++;
  }
  return c / history.length;
}

export interface X89Decision {
  baseDirection: T30XDirection;
  probabilityCorrect: number | null;
  longRank: number | null;
  fastRank: number | null;
  modelWouldTrade: boolean;
  modelDirection: T30XDirection;
  reason: string;
  decisionValid: boolean;
}

export interface X89DecisionInput {
  packetReady: boolean;
  baseDirection: T30XDirection;
  spotTechReady: boolean;
  futTechReady: boolean;
  vector: number[] | null;
  head: X89Head | null;
  probability: number | null;
  longHistory: readonly number[];
  fastHistory: readonly number[];
}

/** First-match evaluation of the frozen decision order. */
export function decideX89(i: X89DecisionInput): X89Decision {
  const base: X89Decision = {
    baseDirection: i.baseDirection,
    probabilityCorrect: null,
    longRank: null,
    fastRank: null,
    modelWouldTrade: false,
    modelDirection: 0,
    reason: T30X_REASONS.PACKET_NOT_READY,
    decisionValid: false,
  };
  if (!i.packetReady) return base;
  if (i.baseDirection === 0) return { ...base, reason: T30X_REASONS.DIRECTION_ZERO };
  if (!i.spotTechReady) return { ...base, reason: T30X_REASONS.SPOT_TECH_NOT_READY };
  if (!i.futTechReady) return { ...base, reason: T30X_REASONS.FUTURES_TECH_NOT_READY };
  if (!i.vector) return { ...base, reason: T30X_REASONS.FEATURE_INVALID };
  if (!i.head) return { ...base, reason: T30X_REASONS.FIT_NOT_READY };

  const p = i.probability;
  if (p == null || !Number.isFinite(p)) {
    return { ...base, reason: T30X_REASONS.PROBABILITY_INVALID };
  }
  const withP = { ...base, probabilityCorrect: p, decisionValid: true };

  if (i.longHistory.length !== T30X_LONG_RANK_WINDOW) {
    return { ...withP, reason: T30X_REASONS.LONG_RANK_NOT_READY };
  }
  const longRank = percentileRank(p, i.longHistory);
  if (longRank == null) return { ...withP, reason: T30X_REASONS.LONG_RANK_NOT_READY };

  if (i.fastHistory.length !== T30X_FAST_RANK_WINDOW) {
    return { ...withP, longRank, reason: T30X_REASONS.FAST_RANK_NOT_READY };
  }
  const fastRank = percentileRank(p, i.fastHistory);
  if (fastRank == null) return { ...withP, longRank, reason: T30X_REASONS.FAST_RANK_NOT_READY };

  const ranked = { ...withP, longRank, fastRank };
  if (longRank < T30X_LONG_RANK_MIN) {
    return { ...ranked, reason: T30X_REASONS.BELOW_LONG_RANK_GATE };
  }
  if (fastRank < T30X_FAST_RANK_MIN) {
    return { ...ranked, reason: T30X_REASONS.BELOW_FAST_RANK_GATE };
  }
  return {
    ...ranked,
    modelWouldTrade: true,
    modelDirection: i.baseDirection,
    reason: T30X_REASONS.PUBLISH,
  };
}

export const X89_RANK_WINDOWS = {
  long: T30X_LONG_RANK_WINDOW,
  fast: T30X_FAST_RANK_WINDOW,
} as const;
