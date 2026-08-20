// T45 Balanced — walk-forward logistic head, confidence rank and decision gate.
//
// Numerically pinned to the frozen research replay:
//   RobustScaler(quantile_range=(10, 90))
//   LogisticRegression(C=0.003, solver="lbfgs", max_iter=5000)
//   sample_weight = UTC-day balanced, normalised to mean 1
// solved with the same certified L-BFGS port ES1 uses.

import { fitCertifiedLogistic } from "@/lib/b4x4es1/certifiedFit";
import {
  T45_BLOCK_SIZE,
  T45_FIRST_BLOCK_START,
  T45_LOGISTIC_C,
  T45_MAX_ITER,
  T45_MIN_TRAIN_ROWS,
  T45_RANK_MIN_HISTORY,
  T45_RANK_THRESHOLD,
  T45_RANK_WINDOW,
  T45_SCALER_Q_HIGH,
  T45_SCALER_Q_LOW,
  T45_TOL,
  T45_TRAIN_WINDOW,
  t45UtcDate,
  type T45Direction,
} from "./config";

export interface T45Scaler {
  center: number[];
  scale: number[];
}

export interface T45TrainingRow {
  targetTs: string;
  index: number;
  vector: number[];
  /** Training label feedback: >0 GREEN, <0 RED, 0 excluded. */
  label: number;
}

export interface T45Head {
  scaler: T45Scaler;
  coefficients: number[];
  intercept: number;
  trainingRowCount: number;
  trainingStartTs: string;
  trainingEndTs: string;
  blockIndex: number;
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

export function fitT45Scaler(X: readonly (readonly number[])[]): T45Scaler {
  const d = X[0]?.length ?? 0;
  const center: number[] = [];
  const scale: number[] = [];
  for (let j = 0; j < d; j++) {
    const col = X.map((r) => r[j]).sort((a, b) => a - b);
    center.push(quantile(col, 0.5));
    const iqr = quantile(col, T45_SCALER_Q_HIGH) - quantile(col, T45_SCALER_Q_LOW);
    scale.push(iqr > 0 && Number.isFinite(iqr) ? iqr : 1);
  }
  return { center, scale };
}

export function applyT45Scaler(scaler: T45Scaler, x: readonly number[]): number[] {
  return x.map((v, j) => (v - scaler.center[j]) / scaler.scale[j]);
}

/** UTC-day balanced sample weights normalised to mean 1. */
export function t45DayWeights(timestamps: readonly string[]): number[] {
  const counts = new Map<string, number>();
  const days = timestamps.map((ts) => t45UtcDate(ts));
  for (const d of days) counts.set(d, (counts.get(d) ?? 0) + 1);
  const raw = days.map((d) => 1 / (counts.get(d) ?? 1));
  const mean = raw.reduce((a, b) => a + b, 0) / Math.max(1, raw.length);
  return raw.map((w) => w / mean);
}

/**
 * The walk-forward block that owns absolute row `index`. Rows before the first
 * block start are never scored.
 */
export function t45BlockStart(index: number): number | null {
  if (index < T45_FIRST_BLOCK_START) return null;
  return (
    T45_FIRST_BLOCK_START +
    Math.floor((index - T45_FIRST_BLOCK_START) / T45_BLOCK_SIZE) * T45_BLOCK_SIZE
  );
}

export function t45BlockIndex(blockStart: number): number {
  return Math.floor((blockStart - T45_FIRST_BLOCK_START) / T45_BLOCK_SIZE);
}

/**
 * Fit the block head from the previous `T45_TRAIN_WINDOW` rows before
 * `blockStart`, keeping only complete rows with a non-zero label.
 */
export function fitT45Head(
  blockStart: number,
  history: readonly T45TrainingRow[],
): T45Head | null {
  const lo = Math.max(0, blockStart - T45_TRAIN_WINDOW);
  const train = history.filter(
    (r) => r.index >= lo && r.index < blockStart && r.label !== 0 && Number.isFinite(r.label),
  );
  if (train.length < T45_MIN_TRAIN_ROWS) return null;
  train.sort((a, b) => a.index - b.index);

  const X = train.map((r) => r.vector);
  const scaler = fitT45Scaler(X);
  const Z = X.map((x) => applyT45Scaler(scaler, x));
  const y = train.map((r) => (r.label > 0 ? 1 : 0));
  const w = t45DayWeights(train.map((r) => r.targetTs));

  const fit = fitCertifiedLogistic(Z, y, w, {
    C: T45_LOGISTIC_C,
    tol: T45_TOL,
    maxIter: T45_MAX_ITER,
  });

  return {
    scaler,
    coefficients: fit.coefficients,
    intercept: fit.intercept,
    trainingRowCount: train.length,
    trainingStartTs: train[0].targetTs,
    trainingEndTs: train[train.length - 1].targetTs,
    blockIndex: t45BlockIndex(blockStart),
    blockStartIndex: blockStart,
    converged: fit.converged,
    iterations: fit.iterations,
    gradientNorm: fit.gradientNorm,
  };
}

export function t45Probability(head: T45Head, vector: readonly number[]): number {
  const z = applyT45Scaler(head.scaler, vector).reduce(
    (a, v, j) => a + v * head.coefficients[j],
    head.intercept,
  );
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

/**
 * Midrank of `confidence` against the previous `T45_RANK_WINDOW` finite
 * confidences (strictly past-only). Returns null below the minimum history.
 */
export function t45ConfidenceRank(
  confidence: number,
  priorConfidences: readonly number[],
): { rank: number | null; historyCount: number } {
  const history = priorConfidences
    .slice(-T45_RANK_WINDOW)
    .filter((v) => Number.isFinite(v));
  if (history.length < T45_RANK_MIN_HISTORY) {
    return { rank: null, historyCount: history.length };
  }
  let below = 0;
  let equal = 0;
  for (const v of history) {
    if (v < confidence) below++;
    else if (v === confidence) equal++;
  }
  return { rank: (below + 0.5 * equal) / history.length, historyCount: history.length };
}

export interface T45Decision {
  probabilityGreen: number;
  confidence: number;
  confidenceRank: number | null;
  rankHistoryCount: number;
  baseDirection: T45Direction;
  activePrediction: T45Direction;
  activeSleeve: "Q375" | "NONE";
  activeWouldTrade: boolean;
}

export function t45Decide(
  probability: number,
  priorConfidences: readonly number[],
): T45Decision {
  const confidence = Math.abs(probability - 0.5);
  const { rank, historyCount } = t45ConfidenceRank(confidence, priorConfidences);
  const baseDirection: T45Direction = probability >= 0.5 ? 1 : -1;
  const trade = rank != null && rank >= T45_RANK_THRESHOLD;
  return {
    probabilityGreen: probability,
    confidence,
    confidenceRank: rank,
    rankHistoryCount: historyCount,
    baseDirection,
    activePrediction: trade ? baseDirection : 0,
    activeSleeve: trade ? "Q375" : "NONE",
    activeWouldTrade: trade,
  };
}

/** Five-state scoring: never collapse ABSTAIN into PUSH. */
export function t45Score(
  wouldTrade: boolean | null,
  prediction: T45Direction | null,
  actualDirection: number | null,
): { result: string | null; score: number | null } {
  if (wouldTrade == null || prediction == null) return { result: null, score: null };
  if (!wouldTrade) return { result: "ABSTAIN", score: 0 };
  if (actualDirection == null) return { result: null, score: null };
  if (actualDirection === 0) return { result: "PUSH", score: 0 };
  return actualDirection === prediction
    ? { result: "WIN", score: 1 }
    : { result: "LOSS", score: -1 };
}
