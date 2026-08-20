// T45 PriceFlow — walk-forward logistic head, confidence rank and gate.
//
// Mechanics are identical to the previous T45 head except that the R2 inputs
// are physically absent. Independently declared so the two models can never
// drift into each other.

import { fitCertifiedLogistic } from "@/lib/b4x4es1/certifiedFit";
import {
  T45PF_BLOCK_SIZE,
  T45PF_FIRST_BLOCK_START,
  T45PF_LOGISTIC_C,
  T45PF_MAX_ITER,
  T45PF_MIN_TRAIN_ROWS,
  T45PF_RANK_MIN_HISTORY,
  T45PF_RANK_THRESHOLD,
  T45PF_RANK_WINDOW,
  T45PF_SCALER_Q_HIGH,
  T45PF_SCALER_Q_LOW,
  T45PF_TOL,
  T45PF_TRAIN_WINDOW,
  utcDate,
  type T45PFDirection,
} from "./config";

export interface PFScaler {
  center: number[];
  scale: number[];
}

export interface PFTrainingRow {
  targetTs: string;
  index: number;
  vector: number[];
  /** Canonical confirmed label: >0 GREEN, <0 RED, 0 excluded (PUSH). */
  label: number;
}

export interface PFHead {
  scaler: PFScaler;
  coefficients: number[];
  intercept: number;
  trainingRowCount: number;
  trainingStartTs: string;
  trainingEndTs: string;
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

export function fitPFScaler(X: readonly (readonly number[])[]): PFScaler {
  const d = X[0]?.length ?? 0;
  const center: number[] = [];
  const scale: number[] = [];
  for (let j = 0; j < d; j++) {
    const col = X.map((r) => r[j]).sort((a, b) => a - b);
    center.push(quantile(col, 0.5));
    const iqr = quantile(col, T45PF_SCALER_Q_HIGH) - quantile(col, T45PF_SCALER_Q_LOW);
    scale.push(iqr > 0 && Number.isFinite(iqr) ? iqr : 1);
  }
  return { center, scale };
}

export function applyPFScaler(scaler: PFScaler, x: readonly number[]): number[] {
  return x.map((v, j) => (v - scaler.center[j]) / scaler.scale[j]);
}

/** UTC-day balanced sample weights normalised to mean 1. */
export function pfDayWeights(timestamps: readonly string[]): number[] {
  const counts = new Map<string, number>();
  const days = timestamps.map((ts) => utcDate(ts));
  for (const d of days) counts.set(d, (counts.get(d) ?? 0) + 1);
  const raw = days.map((d) => 1 / (counts.get(d) ?? 1));
  const mean = raw.reduce((a, b) => a + b, 0) / Math.max(1, raw.length);
  return raw.map((w) => w / mean);
}

export function pfBlockStart(index: number): number | null {
  if (index < T45PF_FIRST_BLOCK_START) return null;
  return (
    T45PF_FIRST_BLOCK_START +
    Math.floor((index - T45PF_FIRST_BLOCK_START) / T45PF_BLOCK_SIZE) * T45PF_BLOCK_SIZE
  );
}

export function pfBlockIndex(blockStart: number): number {
  return Math.floor((blockStart - T45PF_FIRST_BLOCK_START) / T45PF_BLOCK_SIZE);
}

/** Deterministic fingerprint of the exact training window used by a fit. */
export function pfTrainingFingerprint(rows: readonly PFTrainingRow[]): string {
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

/** Fit the block head from the trailing window strictly before `blockStart`. */
export function fitPFHead(
  blockStart: number,
  history: readonly PFTrainingRow[],
): PFHead | null {
  const lo = Math.max(0, blockStart - T45PF_TRAIN_WINDOW);
  const train = history
    .filter(
      (r) => r.index >= lo && r.index < blockStart && r.label !== 0 && Number.isFinite(r.label),
    )
    .sort((a, b) => a.index - b.index);
  if (train.length < T45PF_MIN_TRAIN_ROWS) return null;

  const X = train.map((r) => r.vector);
  const scaler = fitPFScaler(X);
  const Z = X.map((x) => applyPFScaler(scaler, x));
  const y = train.map((r) => (r.label > 0 ? 1 : 0));
  const w = pfDayWeights(train.map((r) => r.targetTs));

  const fit = fitCertifiedLogistic(Z, y, w, {
    C: T45PF_LOGISTIC_C,
    tol: T45PF_TOL,
    maxIter: T45PF_MAX_ITER,
  });

  return {
    scaler,
    coefficients: fit.coefficients,
    intercept: fit.intercept,
    trainingRowCount: train.length,
    trainingStartTs: train[0].targetTs,
    trainingEndTs: train[train.length - 1].targetTs,
    trainingFingerprint: pfTrainingFingerprint(train),
    blockIndex: pfBlockIndex(blockStart),
    blockStartIndex: blockStart,
    converged: fit.converged,
    iterations: fit.iterations,
    gradientNorm: fit.gradientNorm,
  };
}

/** Certification gate for a fit before it may drive a published decision. */
export function pfFitCertified(head: PFHead): boolean {
  return (
    head.converged &&
    Number.isFinite(head.gradientNorm) &&
    Number.isFinite(head.intercept) &&
    head.coefficients.every((c) => Number.isFinite(c)) &&
    head.scaler.center.every((c) => Number.isFinite(c)) &&
    head.scaler.scale.every((s) => Number.isFinite(s) && s !== 0)
  );
}

export function pfProbability(head: PFHead, vector: readonly number[]): number {
  const z = applyPFScaler(head.scaler, vector).reduce(
    (a, v, j) => a + v * head.coefficients[j],
    head.intercept,
  );
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

/** Midrank against the previous finite confidences (strictly past-only). */
export function pfConfidenceRank(
  confidence: number,
  priorConfidences: readonly number[],
): { rank: number | null; historyCount: number } {
  const history = priorConfidences
    .slice(-T45PF_RANK_WINDOW)
    .filter((v) => Number.isFinite(v));
  if (history.length < T45PF_RANK_MIN_HISTORY) {
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

export interface PFDecision {
  probabilityGreen: number;
  confidence: number;
  confidenceRank: number | null;
  rankHistoryCount: number;
  baseDirection: T45PFDirection;
  activePrediction: T45PFDirection;
  activeSleeve: "Q375" | "NONE";
  activeWouldTrade: boolean;
  reason: string;
}

export function pfDecide(
  probability: number,
  priorConfidences: readonly number[],
  reasons: { RANK_NOT_READY: string; BELOW_RANK_GATE: string; PUBLISH: string },
): PFDecision {
  const confidence = Math.abs(probability - 0.5);
  const { rank, historyCount } = pfConfidenceRank(confidence, priorConfidences);
  const baseDirection: T45PFDirection = probability >= 0.5 ? 1 : -1;
  const trade = rank != null && rank >= T45PF_RANK_THRESHOLD;
  return {
    probabilityGreen: probability,
    confidence,
    confidenceRank: rank,
    rankHistoryCount: historyCount,
    baseDirection,
    activePrediction: trade ? baseDirection : 0,
    activeSleeve: trade ? "Q375" : "NONE",
    activeWouldTrade: trade,
    reason:
      rank == null
        ? reasons.RANK_NOT_READY
        : trade
          ? reasons.PUBLISH
          : reasons.BELOW_RANK_GATE,
  };
}

/** Five-state scoring: ABSTAIN is never collapsed into PUSH. */
export function pfScore(
  wouldTrade: boolean | null,
  prediction: T45PFDirection | null,
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
