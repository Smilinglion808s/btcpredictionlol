// T30 PriceFlow Balanced — walk-forward logistic head, dual-horizon rank and
// the frozen first-match decision order.
//
// Mechanics match the certified PriceFlow head (RobustScaler(10,90), C=0.003,
// UTC-day balanced weights, unpenalised intercept, ts-lbfgs-certified solver).
// The only change is the dual-rank publication selector.

import { fitCertifiedLogistic } from "@/lib/b4x4es1/certifiedFit";
import {
  T30_FAST_RANK_MIN,
  T30_FAST_RANK_WINDOW,
  T30_FIT_BLOCK_SIZE,
  T30_FIRST_BLOCK_START,
  T30_LOGISTIC_C,
  T30_LONG_RANK_MIN,
  T30_LONG_RANK_WINDOW,
  T30_MAX_ITER,
  T30_MAX_TRAINING_LOOKBACK,
  T30_MIN_TRAINING_ROWS,
  T30_REASONS,
  T30_SCALER_Q_HIGH,
  T30_SCALER_Q_LOW,
  T30_TOL,
  utcDate,
  type T30Direction,
} from "./config";

export interface T30Scaler {
  center: number[];
  scale: number[];
}

export interface T30TrainingRow {
  targetTs: string;
  index: number;
  vector: number[];
  /** Confirmed OKX label: >0 GREEN, <0 RED, 0 excluded (PUSH). */
  label: number;
}

export interface T30Head {
  scaler: T30Scaler;
  coefficients: number[];
  intercept: number;
  trainingRowCount: number;
  trainingStartTs: string;
  trainingEndTs: string;
  trainingStartIndex: number;
  trainingEndIndex: number;
  trainingFingerprint: string;
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

export function fitT30Scaler(X: readonly (readonly number[])[]): T30Scaler {
  const d = X[0]?.length ?? 0;
  const center: number[] = [];
  const scale: number[] = [];
  for (let j = 0; j < d; j++) {
    const col = X.map((r) => r[j]).sort((a, b) => a - b);
    center.push(quantile(col, 0.5));
    const iqr = quantile(col, T30_SCALER_Q_HIGH) - quantile(col, T30_SCALER_Q_LOW);
    scale.push(iqr > 0 && Number.isFinite(iqr) ? iqr : 1);
  }
  return { center, scale };
}

export function applyT30Scaler(scaler: T30Scaler, x: readonly number[]): number[] {
  return x.map((v, j) => (v - scaler.center[j]) / scaler.scale[j]);
}

/** UTC-day balanced sample weights normalised to mean 1. */
export function t30DayWeights(timestamps: readonly string[]): number[] {
  const counts = new Map<string, number>();
  const days = timestamps.map((ts) => utcDate(ts));
  for (const d of days) counts.set(d, (counts.get(d) ?? 0) + 1);
  const raw = days.map((d) => 1 / (counts.get(d) ?? 1));
  const mean = raw.reduce((a, b) => a + b, 0) / Math.max(1, raw.length);
  return raw.map((w) => w / mean);
}

/** Block boundary owning absolute source index `index`; null before warm-up. */
export function t30BlockStart(index: number): number | null {
  if (index < T30_FIRST_BLOCK_START) return null;
  return (
    T30_FIRST_BLOCK_START +
    Math.floor((index - T30_FIRST_BLOCK_START) / T30_FIT_BLOCK_SIZE) * T30_FIT_BLOCK_SIZE
  );
}

export function t30BlockIndex(blockStart: number): number {
  return Math.floor((blockStart - T30_FIRST_BLOCK_START) / T30_FIT_BLOCK_SIZE);
}

/** Deterministic fingerprint of the exact training window used by a fit. */
export function t30TrainingFingerprint(rows: readonly T30TrainingRow[]): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  const push = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
      h2 = Math.imul(h2 + s.charCodeAt(i) + 1, 2246822519) >>> 0;
    }
  };
  push(`${rows.length}`);
  for (const r of rows) {
    push(`${r.index}|${r.targetTs}|${r.label}|`);
    for (const v of r.vector) push(`${v};`);
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/** Fit the block head from the window strictly before `blockStart`. */
export function fitT30Head(
  blockStart: number,
  history: readonly T30TrainingRow[],
): T30Head | null {
  const lo = Math.max(0, blockStart - T30_MAX_TRAINING_LOOKBACK);
  const train = history
    .filter(
      (r) => r.index >= lo && r.index < blockStart && r.label !== 0 && Number.isFinite(r.label),
    )
    .sort((a, b) => a.index - b.index);
  if (train.length < T30_MIN_TRAINING_ROWS) return null;

  const X = train.map((r) => r.vector);
  const scaler = fitT30Scaler(X);
  const Z = X.map((x) => applyT30Scaler(scaler, x));
  const y = train.map((r) => (r.label > 0 ? 1 : 0));
  const w = t30DayWeights(train.map((r) => r.targetTs));

  const fit = fitCertifiedLogistic(Z, y, w, {
    C: T30_LOGISTIC_C,
    tol: T30_TOL,
    maxIter: T30_MAX_ITER,
  });

  return {
    scaler,
    coefficients: fit.coefficients,
    intercept: fit.intercept,
    trainingRowCount: train.length,
    trainingStartTs: train[0].targetTs,
    trainingEndTs: train[train.length - 1].targetTs,
    trainingStartIndex: train[0].index,
    trainingEndIndex: train[train.length - 1].index,
    trainingFingerprint: t30TrainingFingerprint(train),
    blockIndex: t30BlockIndex(blockStart),
    blockStartIndex: blockStart,
    converged: fit.converged,
    iterations: fit.iterations,
    gradientNorm: fit.gradientNorm,
  };
}

export function t30FitCertified(head: T30Head): boolean {
  return (
    head.converged &&
    Number.isFinite(head.gradientNorm) &&
    Number.isFinite(head.intercept) &&
    head.coefficients.every((c) => Number.isFinite(c)) &&
    head.scaler.center.every((c) => Number.isFinite(c)) &&
    head.scaler.scale.every((s) => Number.isFinite(s) && s !== 0)
  );
}

export function t30Probability(head: T30Head, vector: readonly number[]): number {
  const z = applyT30Scaler(head.scaler, vector).reduce(
    (a, v, j) => a + v * head.coefficients[j],
    head.intercept,
  );
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

export interface T30RankResult {
  rank: number | null;
  historyCount: number;
  windowStartTs: string | null;
  windowEndTs: string | null;
}

export interface T30PriorConfidence {
  targetTs: string;
  confidence: number;
}

/**
 * Midrank of `confidence` against the previous `window` finite confidences.
 * Equality counts half — the T45 percentile convention — and the full window is
 * required, otherwise the rank is not ready and the model abstains.
 */
export function t30PercentileRank(
  confidence: number,
  prior: readonly T30PriorConfidence[],
  window: number,
): T30RankResult {
  const history = prior.filter((p) => Number.isFinite(p.confidence)).slice(-window);
  if (history.length < window) {
    return {
      rank: null,
      historyCount: history.length,
      windowStartTs: history.length ? history[0].targetTs : null,
      windowEndTs: history.length ? history[history.length - 1].targetTs : null,
    };
  }
  let below = 0;
  let equal = 0;
  for (const p of history) {
    if (p.confidence < confidence) below++;
    else if (p.confidence === confidence) equal++;
  }
  return {
    rank: (below + 0.5 * equal) / history.length,
    historyCount: history.length,
    windowStartTs: history[0].targetTs,
    windowEndTs: history[history.length - 1].targetTs,
  };
}

export interface T30Decision {
  probabilityGreen: number;
  confidence: number;
  baseDirection: T30Direction;
  longRank: T30RankResult;
  fastRank: T30RankResult;
  modelDirection: T30Direction;
  modelWouldTrade: boolean;
  decisionValid: boolean;
  reason: string;
  gateLongReady: boolean;
  gateFastReady: boolean;
  gateLongPassed: boolean;
  gateFastPassed: boolean;
}

/**
 * Frozen first-match decision order (steps 4..9; packet/feature/fit failures
 * are handled by the caller before this function is reached).
 */
export function t30Decide(
  probability: number,
  prior: readonly T30PriorConfidence[],
): T30Decision {
  const confidence = Math.abs(probability - 0.5);
  const baseDirection: T30Direction = probability >= 0.5 ? 1 : -1;
  const longRank = t30PercentileRank(confidence, prior, T30_LONG_RANK_WINDOW);
  const fastRank = t30PercentileRank(confidence, prior, T30_FAST_RANK_WINDOW);

  const gateLongReady = longRank.rank != null;
  const gateFastReady = fastRank.rank != null;
  const gateLongPassed = gateLongReady && (longRank.rank as number) >= T30_LONG_RANK_MIN;
  const gateFastPassed = gateFastReady && (fastRank.rank as number) >= T30_FAST_RANK_MIN;

  const base = {
    probabilityGreen: probability,
    confidence,
    baseDirection,
    longRank,
    fastRank,
    gateLongReady,
    gateFastReady,
    gateLongPassed,
    gateFastPassed,
  };

  if (!Number.isFinite(probability)) {
    return {
      ...base,
      modelDirection: 0,
      modelWouldTrade: false,
      decisionValid: false,
      reason: T30_REASONS.PROBABILITY_INVALID,
    };
  }
  if (!gateLongReady) {
    return {
      ...base,
      modelDirection: 0,
      modelWouldTrade: false,
      decisionValid: false,
      reason: T30_REASONS.LONG_RANK_NOT_READY,
    };
  }
  if (!gateFastReady) {
    return {
      ...base,
      modelDirection: 0,
      modelWouldTrade: false,
      decisionValid: false,
      reason: T30_REASONS.FAST_RANK_NOT_READY,
    };
  }
  if (!gateLongPassed) {
    return {
      ...base,
      modelDirection: baseDirection,
      modelWouldTrade: false,
      decisionValid: true,
      reason: T30_REASONS.BELOW_LONG_RANK_GATE,
    };
  }
  if (!gateFastPassed) {
    return {
      ...base,
      modelDirection: baseDirection,
      modelWouldTrade: false,
      decisionValid: true,
      reason: T30_REASONS.BELOW_FAST_RANK_GATE,
    };
  }
  return {
    ...base,
    modelDirection: baseDirection,
    modelWouldTrade: true,
    decisionValid: true,
    reason: T30_REASONS.PUBLISH,
  };
}

/** Five-state scoring: ABSTAIN is never collapsed into PUSH. */
export function t30Score(
  wouldTrade: boolean | null,
  direction: T30Direction | null,
  actualDirection: number | null,
): { result: string | null; score: number | null } {
  if (wouldTrade == null || direction == null) return { result: null, score: null };
  if (!wouldTrade) return { result: "ABSTAIN", score: 0 };
  if (actualDirection == null) return { result: null, score: null };
  if (actualDirection === 0) return { result: "PUSH", score: 0 };
  return actualDirection === direction
    ? { result: "WIN", score: 1 }
    : { result: "LOSS", score: -1 };
}

/** Flat-stake realized units from captured decimal odds. */
export function t30OddsUnits(result: string | null, decimalOdds: number | null): number | null {
  if (result == null || decimalOdds == null || !Number.isFinite(decimalOdds)) return null;
  if (result === "WIN") return decimalOdds - 1;
  if (result === "LOSS") return -1;
  return 0;
}
