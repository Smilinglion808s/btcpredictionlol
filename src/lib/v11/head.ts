// Version 1.1 candidate — daily UTC logistic head, rank, availability, gate.
//
// Numerics reuse the project's pinned certified L-BFGS port (the same one that
// drives the T45 PriceFlow head), with RobustScaler(10,90) and UTC-day-balanced
// weights normalised to mean 1. The reference offline implementation is
// sklearn 1.8 / numpy 2.3.5; see `V11_FIT_REPRODUCTION_NOTE`.

import { fitCertifiedLogistic } from "@/lib/b4x4es1/certifiedFit";
import {
  V11_AVAILABILITY_MIN,
  V11_CONFIG_FINGERPRINT,
  V11_FEATURE_ORDER_HASH,
  V11_AVAILABILITY_NUMERATOR,
  V11_AVAILABILITY_WINDOW,
  V11_FEATURE_ORDER,
  V11_LOGISTIC_C,
  V11_MAX_ITER,
  V11_MIN_TRAIN_ROWS,
  V11_RANK_MIN_HISTORY,
  V11_RANK_WINDOW,
  V11_SCALER_Q_HIGH,
  V11_SCALER_Q_LOW,
  V11_TOL,
  V11_TRAIN_DAYS,
  utcDate,
} from "./config";

export const V11_FIT_REPRODUCTION_NOTE =
  "Fitted in-process with the pinned ts-lbfgs certified port; the original " +
  "reference stack (numpy 2.3.5 / pandas 2.2.3 / scipy 1.17 / sklearn 1.8) is " +
  "not executed here, so coefficients may differ in the last float digits.";

export interface V11Scaler {
  center: number[];
  scale: number[];
}

export interface V11TrainingRow {
  targetTs: string;
  vector: number[];
  /** Native KALSHI settlement instant; must be strictly before the cutoff. */
  settlementTs: string;
  /** >0 up, <0 down, 0 excluded. */
  label: number;
}

export interface V11Head {
  fitDate: string;
  expiresAt: string;
  /** Midnight-UTC instant this head was cut at. */
  cutoffTs: string | null;
  /** Binds the head to the exact 80-input order it was fitted on. */
  featureOrderHash: string | null;
  /** Binds the head to the frozen scaler/fit/rank configuration. */
  configFingerprint: string | null;
  /** Latest native Kalshi settlement used; must be strictly before the cutoff. */
  maxTrainingSettlementTs: string | null;
  quarantined?: boolean;
  quarantineReason?: string | null;
  scaler: V11Scaler;
  coefficients: number[];
  intercept: number;
  trainingRowCount: number;
  trainingStartTs: string;
  trainingEndTs: string;
  trainingFingerprint: string;
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

export function fitV11Scaler(X: readonly (readonly number[])[]): V11Scaler {
  const d = X[0]?.length ?? 0;
  const center: number[] = [];
  const scale: number[] = [];
  for (let j = 0; j < d; j++) {
    const col = X.map((r) => r[j]).sort((a, b) => a - b);
    center.push(quantile(col, 0.5));
    const iqr = quantile(col, V11_SCALER_Q_HIGH) - quantile(col, V11_SCALER_Q_LOW);
    scale.push(iqr > 0 && Number.isFinite(iqr) ? iqr : 1);
  }
  return { center, scale };
}

export function applyV11Scaler(scaler: V11Scaler, x: readonly number[]): number[] {
  return x.map((v, j) => (v - scaler.center[j]) / scaler.scale[j]);
}

export function v11DayWeights(timestamps: readonly string[]): number[] {
  const counts = new Map<string, number>();
  const days = timestamps.map((ts) => utcDate(ts));
  for (const d of days) counts.set(d, (counts.get(d) ?? 0) + 1);
  const raw = days.map((d) => 1 / (counts.get(d) ?? 1));
  const mean = raw.reduce((a, b) => a + b, 0) / Math.max(1, raw.length);
  return raw.map((w) => w / mean);
}

export function v11TrainingFingerprint(rows: readonly V11TrainingRow[]): string {
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
    push(`${r.targetTs}|${r.label}|`);
    for (const v of r.vector) push(`${v};`);
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/** Midnight-UTC cutoff instant for the head serving UTC day `fitDate`. */
export function v11FitCutoff(fitDate: string): string {
  return `${fitDate}T00:00:00.000Z`;
}

/**
 * Daily UTC fit for `fitDate`: trailing 90 calendar days, valid finite rows,
 * whose target instant AND native Kalshi settlement instant are strictly before
 * the midnight cutoff. Minimum 2688 rows. The head expires at the next midnight.
 */
export function fitV11Head(
  fitDate: string,
  history: readonly V11TrainingRow[],
  now: Date = new Date(),
): V11Head | null {
  const cutoff = Date.parse(v11FitCutoff(fitDate));
  // A head for a cutoff that has not arrived yet cannot be honest: it would be
  // trained without data that exists by the day it claims to serve.
  if (!Number.isFinite(cutoff) || cutoff > now.getTime()) return null;
  const lo = cutoff - V11_TRAIN_DAYS * 86_400_000;
  const train = history
    .filter((r) => {
      const t = Date.parse(r.targetTs);
      const s = Date.parse(r.settlementTs);
      return (
        Number.isFinite(t) &&
        Number.isFinite(s) &&
        t >= lo &&
        t < cutoff &&
        s < cutoff &&
        (r.label === 1 || r.label === -1) &&
        r.vector.length === V11_FEATURE_ORDER.length &&
        r.vector.every((v) => Number.isFinite(v))
      );
    })
    .sort((a, b) => Date.parse(a.targetTs) - Date.parse(b.targetTs));
  if (train.length < V11_MIN_TRAIN_ROWS) return null;

  const X = train.map((r) => r.vector);
  const scaler = fitV11Scaler(X);
  const Z = X.map((x) => applyV11Scaler(scaler, x));
  const y = train.map((r) => (r.label > 0 ? 1 : 0));
  if (!y.some((v) => v === 1) || !y.some((v) => v === 0)) return null;
  const w = v11DayWeights(train.map((r) => r.targetTs));

  const fit = fitCertifiedLogistic(Z, y, w, {
    C: V11_LOGISTIC_C,
    tol: V11_TOL,
    maxIter: V11_MAX_ITER,
  });

  const expires = new Date(cutoff + 86_400_000).toISOString();
  const maxSettlement = train.reduce(
    (a, r) => Math.max(a, Date.parse(r.settlementTs)),
    -Infinity,
  );
  if (!Number.isFinite(maxSettlement) || maxSettlement >= cutoff) return null;
  if (
    scaler.center.length !== V11_FEATURE_ORDER.length ||
    scaler.scale.length !== V11_FEATURE_ORDER.length ||
    fit.coefficients.length !== V11_FEATURE_ORDER.length ||
    !fit.coefficients.every((c) => Number.isFinite(c)) ||
    !Number.isFinite(fit.intercept)
  ) {
    return null;
  }
  return {
    fitDate,
    expiresAt: expires,
    cutoffTs: new Date(cutoff).toISOString(),
    featureOrderHash: V11_FEATURE_ORDER_HASH,
    configFingerprint: V11_CONFIG_FINGERPRINT,
    maxTrainingSettlementTs: new Date(maxSettlement).toISOString(),
    quarantined: false,
    quarantineReason: null,
    scaler,
    coefficients: fit.coefficients,
    intercept: fit.intercept,
    trainingRowCount: train.length,
    trainingStartTs: train[0].targetTs,
    trainingEndTs: train[train.length - 1].targetTs,
    trainingFingerprint: v11TrainingFingerprint(train),
    converged: fit.converged,
    iterations: fit.iterations,
    gradientNorm: fit.gradientNorm,
  };
}

/**
 * A head may only score when it is converged, finite, correctly shaped, bound
 * to THIS feature order and configuration, not quarantined, and cut at a
 * midnight that has already passed with all training settlements before it.
 */
export function v11HeadCertified(head: V11Head, now: Date = new Date()): boolean {
  if (head.quarantined === true) return false;
  if (head.featureOrderHash && head.featureOrderHash !== V11_FEATURE_ORDER_HASH) return false;
  if (head.configFingerprint && head.configFingerprint !== V11_CONFIG_FINGERPRINT) return false;
  if (head.cutoffTs) {
    const cut = Date.parse(head.cutoffTs);
    if (!Number.isFinite(cut) || cut > now.getTime()) return false;
    if (
      head.maxTrainingSettlementTs &&
      !(Date.parse(head.maxTrainingSettlementTs) < cut)
    ) {
      return false;
    }
  }
  if (head.scaler.center.length !== V11_FEATURE_ORDER.length) return false;
  if (head.scaler.scale.length !== V11_FEATURE_ORDER.length) return false;
  return (
    head.converged &&
    Number.isFinite(head.gradientNorm) &&
    Number.isFinite(head.intercept) &&
    head.coefficients.length === V11_FEATURE_ORDER.length &&
    head.coefficients.every((c) => Number.isFinite(c)) &&
    head.scaler.center.every((c) => Number.isFinite(c)) &&
    head.scaler.scale.every((s) => Number.isFinite(s) && s !== 0)
  );
}

/** A head is usable only for targets strictly before its next-midnight expiry. */
export function v11HeadFresh(head: { expiresAt: string }, targetTs: string): boolean {
  return Date.parse(targetTs) < Date.parse(head.expiresAt);
}

export function v11Probability(head: V11Head, vector: readonly number[]): number {
  if (vector.length !== head.coefficients.length) return NaN;
  if (!vector.every((v) => Number.isFinite(v))) return NaN;
  const z = applyV11Scaler(head.scaler, vector).reduce(
    (a, v, j) => a + v * head.coefficients[j],
    head.intercept,
  );
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

/**
 * Pooled midrank of abs(p - .5) against the last 768 finite HISTORICAL
 * confidences (strictly past-only, computed BEFORE the current score is
 * appended). Ties count half.
 */
export function v11ConfidenceRank(
  confidence: number,
  priorConfidences: readonly (number | null)[],
): { rank: number | null; historyCount: number } {
  // Filter FIRST, then take the newest 768: the rank clock counts finite
  // confidences, not calendar opportunities.
  const history = priorConfidences
    .filter((v): v is number => v !== null && Number.isFinite(v))
    .slice(-V11_RANK_WINDOW);
  if (history.length < V11_RANK_MIN_HISTORY) {
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

/**
 * Availability: fraction of finite scores over the previous 768 official
 * opportunities INCLUDING invalid ones; the current opportunity is excluded.
 * Requires at least 192 observed opportunities.
 */
export function v11Availability(priorScores: readonly (number | null)[]): {
  availability: number | null;
  observed: number;
} {
  const window = priorScores.slice(-V11_AVAILABILITY_WINDOW);
  if (window.length < V11_AVAILABILITY_MIN) {
    return { availability: null, observed: window.length };
  }
  const finite = window.filter((v) => v !== null && Number.isFinite(v)).length;
  return { availability: finite / window.length, observed: window.length };
}

/** Admission gate: clip(1 - 0.38 / availability, 0, 1). */
export function v11AdmissionGate(availability: number): number {
  if (!Number.isFinite(availability) || availability <= 0) return 1;
  const g = 1 - V11_AVAILABILITY_NUMERATOR / availability;
  return g < 0 ? 0 : g > 1 ? 1 : g;
}
