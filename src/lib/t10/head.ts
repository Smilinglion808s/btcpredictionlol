// T10 Bridge — correctness head, strict past-only ranks and the frozen
// first-match decision order.
//
// The head predicts whether the T10 base direction will be CORRECT. It never
// predicts GREEN/RED directly and it never flips the base direction: it either
// publishes that direction or abstains.

import { fitCertifiedLogistic } from "@/lib/b4x4es1/certifiedFit";
import {
  T10_FAST_RANK_FLOOR,
  T10_FAST_RANK_WINDOW,
  T10_FEATURE_ORDER,
  T10_FIRST_FIT_INDEX,
  T10_LOGISTIC_C,
  T10_LONG_RANK_FLOOR,
  T10_LONG_RANK_WINDOW,
  T10_MAX_ITER,
  T10_REASONS,
  T10_REFIT_BLOCK,
  T10_SCALER_Q_HIGH,
  T10_SCALER_Q_LOW,
  T10_TOL,
  T10_TRAINING_LOOKBACK,
  utcDate,
  type T10Direction,
} from "./config";
import type { T10FeatureMap } from "./features";

export interface T10Scaler {
  center: number[];
  scale: number[];
}

export interface T10TrainingRow {
  targetTs: string;
  index: number;
  vector: number[];
  /** Correctness label: 1 when the base direction matched the outcome. */
  label: 0 | 1;
}

export interface T10Head {
  scaler: T10Scaler;
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

/** Ordered 94-length model vector; null when any component is unusable. */
export function t10Vector(values: T10FeatureMap): number[] | null {
  const out: number[] = [];
  for (const k of T10_FEATURE_ORDER) {
    const v = values[k];
    if (!Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
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

/** RobustScaler with a 10th–90th percentile range. */
export function fitT10Scaler(X: readonly (readonly number[])[]): T10Scaler {
  const d = X[0]?.length ?? 0;
  const center: number[] = [];
  const scale: number[] = [];
  for (let j = 0; j < d; j++) {
    const col = X.map((r) => r[j]).sort((a, b) => a - b);
    center.push(quantile(col, 0.5));
    const spread = quantile(col, T10_SCALER_Q_HIGH) - quantile(col, T10_SCALER_Q_LOW);
    scale.push(spread > 0 && Number.isFinite(spread) ? spread : 1);
  }
  return { center, scale };
}

export function applyT10Scaler(scaler: T10Scaler, x: readonly number[]): number[] {
  return x.map((v, j) => (v - scaler.center[j]) / scaler.scale[j]);
}

/** UTC-day balanced sample weights normalised to mean 1. */
export function t10DayWeights(timestamps: readonly string[]): number[] {
  const counts = new Map<string, number>();
  const days = timestamps.map((ts) => utcDate(ts));
  for (const d of days) counts.set(d, (counts.get(d) ?? 0) + 1);
  const raw = days.map((d) => 1 / (counts.get(d) ?? 1));
  const mean = raw.reduce((a, b) => a + b, 0) / Math.max(1, raw.length);
  return raw.map((w) => w / mean);
}

/** Block boundary owning absolute source index `index`; null before warm-up. */
export function t10BlockStart(index: number): number | null {
  if (index < T10_FIRST_FIT_INDEX) return null;
  return (
    T10_FIRST_FIT_INDEX +
    Math.floor((index - T10_FIRST_FIT_INDEX) / T10_REFIT_BLOCK) * T10_REFIT_BLOCK
  );
}

export function t10BlockIndex(blockStart: number): number {
  return Math.floor((blockStart - T10_FIRST_FIT_INDEX) / T10_REFIT_BLOCK);
}

/** Deterministic fingerprint of the exact training window used by a fit. */
export function t10TrainingFingerprint(rows: readonly T10TrainingRow[]): string {
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

/** Fit the block head from the ≤8,640 rows strictly before `blockStart`. */
export function fitT10Head(
  blockStart: number,
  history: readonly T10TrainingRow[],
): T10Head | null {
  const lo = Math.max(0, blockStart - T10_TRAINING_LOOKBACK);
  const train = history
    .filter((r) => r.index >= lo && r.index < blockStart)
    .sort((a, b) => a.index - b.index);
  if (train.length < 1) return null;
  // A degenerate single-class window cannot produce a certified head.
  if (train.every((r) => r.label === train[0].label)) return null;

  const X = train.map((r) => r.vector);
  const scaler = fitT10Scaler(X);
  const Z = X.map((x) => applyT10Scaler(scaler, x));
  const y = train.map((r) => r.label);
  const w = t10DayWeights(train.map((r) => r.targetTs));

  const fit = fitCertifiedLogistic(Z, y, w, {
    C: T10_LOGISTIC_C,
    tol: T10_TOL,
    maxIter: T10_MAX_ITER,
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
    trainingFingerprint: t10TrainingFingerprint(train),
    blockIndex: t10BlockIndex(blockStart),
    blockStartIndex: blockStart,
    converged: fit.converged,
    iterations: fit.iterations,
    gradientNorm: fit.gradientNorm,
  };
}

export function t10FitCertified(head: T10Head): boolean {
  return (
    head.converged &&
    Number.isFinite(head.gradientNorm) &&
    Number.isFinite(head.intercept) &&
    head.coefficients.length === T10_FEATURE_ORDER.length &&
    head.coefficients.every((c) => Number.isFinite(c)) &&
    head.scaler.center.every((c) => Number.isFinite(c)) &&
    head.scaler.scale.every((s) => Number.isFinite(s) && s !== 0)
  );
}

/** P(base direction is correct). */
export function t10Probability(head: T10Head, vector: readonly number[]): number {
  const z = applyT10Scaler(head.scaler, vector).reduce(
    (a, v, j) => a + v * head.coefficients[j],
    head.intercept,
  );
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

export interface T10RankResult {
  rank: number | null;
  historyCount: number;
  windowStartTs: string | null;
  windowEndTs: string | null;
}

export interface T10PriorProbability {
  targetTs: string;
  probability: number;
}

/**
 * Strict past-only rank: mean(previous EXACTLY `window` finite probabilities
 * <= current). Equality is included, the current target is excluded and a
 * partial window is never used.
 */
export function t10Rank(
  probability: number,
  prior: readonly T10PriorProbability[],
  window: number,
): T10RankResult {
  const history = prior.filter((p) => Number.isFinite(p.probability)).slice(-window);
  if (history.length < window) {
    return {
      rank: null,
      historyCount: history.length,
      windowStartTs: history.length ? history[0].targetTs : null,
      windowEndTs: history.length ? history[history.length - 1].targetTs : null,
    };
  }
  let atOrBelow = 0;
  for (const p of history) if (p.probability <= probability) atOrBelow += 1;
  return {
    rank: atOrBelow / history.length,
    historyCount: history.length,
    windowStartTs: history[0].targetTs,
    windowEndTs: history[history.length - 1].targetTs,
  };
}

/** Order-sensitive checksum of the rolling probability state actually used. */
export function t10RankChecksum(prior: readonly T10PriorProbability[]): string {
  let h = 0x811c9dc5;
  const push = (s: string) => {
    for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619) >>> 0;
  };
  push(`${prior.length}`);
  for (const p of prior.slice(-T10_LONG_RANK_WINDOW)) push(`${p.targetTs}:${p.probability}|`);
  return h.toString(16).padStart(8, "0");
}

export interface T10Decision {
  probability: number;
  baseDirection: T10Direction;
  longRank: T10RankResult;
  fastRank: T10RankResult;
  policyWouldTrade: boolean;
  policyDirection: T10Direction;
  reason: string;
  rankCertified: boolean;
}

/**
 * Frozen first-match decision order, steps 5..9. Steps 1..4 (packet, prior
 * technicals, features, fit certification) are enforced by the caller before
 * this function is reached.
 */
export function t10Decide(
  probability: number,
  baseDirection: T10Direction,
  prior: readonly T10PriorProbability[],
): T10Decision {
  const longRank = t10Rank(probability, prior, T10_LONG_RANK_WINDOW);
  const fastRank = t10Rank(probability, prior, T10_FAST_RANK_WINDOW);
  const rankCertified = longRank.rank != null && fastRank.rank != null;
  const base = { probability, baseDirection, longRank, fastRank, rankCertified };

  if (!rankCertified) {
    return {
      ...base,
      policyWouldTrade: false,
      policyDirection: 0,
      reason: T10_REASONS.RANK_STATE_NOT_READY,
    };
  }
  if (baseDirection === 0) {
    return {
      ...base,
      policyWouldTrade: false,
      policyDirection: 0,
      reason: T10_REASONS.BASE_DIRECTION_FLAT,
    };
  }
  if ((longRank.rank as number) < T10_LONG_RANK_FLOOR) {
    return {
      ...base,
      policyWouldTrade: false,
      policyDirection: baseDirection,
      reason: T10_REASONS.LONG_RANK_BELOW,
    };
  }
  if ((fastRank.rank as number) < T10_FAST_RANK_FLOOR) {
    return {
      ...base,
      policyWouldTrade: false,
      policyDirection: baseDirection,
      reason: T10_REASONS.FAST_RANK_BELOW,
    };
  }
  return {
    ...base,
    policyWouldTrade: true,
    policyDirection: baseDirection,
    reason: T10_REASONS.PUBLISH,
  };
}

/** Raw scoring: WIN +1, LOSS -1, ABSTAIN 0, PUSH 0 (excluded from W/L). */
export function t10Score(
  wouldTrade: boolean,
  direction: T10Direction,
  actual: "GREEN" | "RED" | "PUSH" | null,
): { result: string; raw: number } {
  if (!wouldTrade || direction === 0) return { result: "ABSTAIN", raw: 0 };
  if (actual == null) return { result: "PENDING", raw: 0 };
  if (actual === "PUSH") return { result: "PUSH", raw: 0 };
  const dir = direction === 1 ? "GREEN" : "RED";
  return dir === actual ? { result: "WIN", raw: 1 } : { result: "LOSS", raw: -1 };
}
