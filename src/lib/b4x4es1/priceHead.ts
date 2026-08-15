// ES1 frozen price head: RobustScaler(10–90) + L2 logistic regression (C=0.01).
//
// The objective is exactly sklearn's:
//   min_w,b  sum_i s_i * logloss(y_i, sigma(w·x_i + b)) + (1/(2C)) * ||w||^2
// with an UN-penalized intercept and sample weights s_i. It is strictly convex,
// so the optimum is unique: we solve it with damped Newton/IRLS to a tight
// gradient tolerance rather than approximating with first-order descent.

import {
  ES1_FEATURES,
  ES1_LOGISTIC_C,
  ES1_MAX_ITER,
  ES1_PRICE_SPEC,
  ES1_RETRAIN_BLOCK,
  ES1_SCALER,
  ES1_SCALER_Q_HIGH,
  ES1_SCALER_Q_LOW,
  ES1_SOLVER,
  ES1_TRAIN_WINDOW,
  ES1_MIN_TRAIN_ROWS,
  es1FeatureSchemaHash,
  es1LocalDate,
  sha256,
} from "./config";

export interface Scaler {
  center: number[];
  scale: number[];
}

export interface Es1Fit {
  fitId: string;
  artifactSha256: string;
  featureSchemaHash: string;
  specification: string;
  scalerName: string;
  scaler: Scaler;
  coefficients: number[];
  intercept: number;
  trainingRowCount: number;
  trainingStartTs: string;
  trainingEndTs: string;
  trainingStartIndex: number;
  trainingEndIndex: number;
  blockIndex: number;
  solver: string;
  converged: boolean;
  iterations: number;
  gradientNorm: number;
  C: number;
}

export interface TrainingRow {
  targetTs: string;
  vector: number[];
  label: 1 | 0; // GREEN = 1, RED = 0
  index: number; // absolute eligible-row index
}

function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

/** Linear-interpolated quantile (numpy "linear" method). */
export function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return NaN;
  if (sorted.length === 1) return sorted[0];
  const pos = (sorted.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

export function fitRobustScaler(X: readonly number[][]): Scaler {
  const d = X[0]?.length ?? 0;
  const center: number[] = [];
  const scale: number[] = [];
  for (let j = 0; j < d; j++) {
    const col = X.map((r) => r[j]).sort((a, b) => a - b);
    const med = quantile(col, 0.5);
    const iqr = quantile(col, ES1_SCALER_Q_HIGH) - quantile(col, ES1_SCALER_Q_LOW);
    center.push(med);
    scale.push(iqr > 0 && Number.isFinite(iqr) ? iqr : 1);
  }
  return { center, scale };
}

export function applyScaler(scaler: Scaler, x: readonly number[]): number[] {
  return x.map((v, j) => (v - scaler.center[j]) / scaler.scale[j]);
}

/** Day-balanced sample weights normalized to mean 1 (America/Boise days). */
export function dayBalancedWeights(targetTimestamps: readonly string[]): number[] {
  const counts = new Map<string, number>();
  const days = targetTimestamps.map((ts) => es1LocalDate(ts));
  for (const d of days) counts.set(d, (counts.get(d) ?? 0) + 1);
  const raw = days.map((d) => 1 / (counts.get(d) ?? 1));
  const mean = raw.reduce((a, b) => a + b, 0) / Math.max(1, raw.length);
  return mean > 0 ? raw.map((w) => w / mean) : raw.map(() => 1);
}

function solveSymmetric(A: number[][], b: number[]): number[] | null {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    if (!(Math.abs(M[pivot][col]) > 1e-14)) return null;
    [M[col], M[pivot]] = [M[pivot], M[col]];
    const p = M[col][col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col] / p;
      if (f === 0) continue;
      for (let c = col; c <= n; c++) M[r][c] -= f * M[col][c];
    }
  }
  return M.map((row, i) => row[n] / row[i][i]);
}

export interface SolveResult {
  coefficients: number[];
  intercept: number;
  iterations: number;
  converged: boolean;
  gradientNorm: number;
}

/** Damped Newton (IRLS) solve of weighted L2 logistic regression. */
export function solveWeightedL2Logistic(
  Z: readonly number[][],
  y: readonly number[],
  sampleWeight: readonly number[],
  C = ES1_LOGISTIC_C,
  maxIter = ES1_MAX_ITER,
  tol = 1e-10,
): SolveResult {
  const n = Z.length;
  const d = Z[0]?.length ?? 0;
  const p = d + 1; // + intercept
  const lambda = 1 / C;
  let theta = new Array<number>(p).fill(0); // [w..., b]

  const gradHess = (th: number[]) => {
    const g = new Array<number>(p).fill(0);
    const H: number[][] = Array.from({ length: p }, () => new Array<number>(p).fill(0));
    for (let i = 0; i < n; i++) {
      const xi = Z[i];
      let z = th[d];
      for (let j = 0; j < d; j++) z += th[j] * xi[j];
      const s = sigmoid(z);
      const w = sampleWeight[i];
      const err = w * (s - y[i]);
      for (let j = 0; j < d; j++) g[j] += err * xi[j];
      g[d] += err;
      const hw = w * s * (1 - s);
      for (let a = 0; a < d; a++) {
        for (let b = a; b < d; b++) H[a][b] += hw * xi[a] * xi[b];
        H[a][d] += hw * xi[a];
      }
      H[d][d] += hw;
    }
    for (let j = 0; j < d; j++) {
      g[j] += lambda * th[j];
      H[j][j] += lambda;
    }
    for (let a = 0; a < p; a++) for (let b = 0; b < a; b++) H[a][b] = H[b][a];
    return { g, H };
  };

  const loss = (th: number[]) => {
    let l = 0;
    for (let i = 0; i < n; i++) {
      const xi = Z[i];
      let z = th[d];
      for (let j = 0; j < d; j++) z += th[j] * xi[j];
      const yz = z * (y[i] === 1 ? 1 : -1);
      l += sampleWeight[i] * (yz >= 0 ? Math.log1p(Math.exp(-yz)) : -yz + Math.log1p(Math.exp(yz)));
    }
    let reg = 0;
    for (let j = 0; j < d; j++) reg += th[j] * th[j];
    return l + (lambda / 2) * reg;
  };

  let iterations = 0;
  let gradNorm = Infinity;
  let converged = false;
  for (let iter = 0; iter < maxIter; iter++) {
    iterations = iter + 1;
    const { g, H } = gradHess(theta);
    gradNorm = Math.sqrt(g.reduce((a, v) => a + v * v, 0));
    if (gradNorm < tol) {
      converged = true;
      break;
    }
    const step = solveSymmetric(H, g.map((v) => -v));
    if (!step) break;
    // Backtracking line search keeps the Newton step monotone.
    const base = loss(theta);
    let t = 1;
    let next = theta.map((v, j) => v + t * step[j]);
    for (let k = 0; k < 40 && !(loss(next) <= base); k++) {
      t /= 2;
      next = theta.map((v, j) => v + t * step[j]);
    }
    theta = next;
  }
  return {
    coefficients: theta.slice(0, d),
    intercept: theta[d],
    iterations,
    converged,
    gradientNorm: gradNorm,
  };
}

/** Train one immutable fit artifact from labeled training rows. */
export function trainEs1Fit(rows: readonly TrainingRow[], blockIndex: number): Es1Fit | null {
  if (rows.length < ES1_MIN_TRAIN_ROWS) return null;
  const X = rows.map((r) => r.vector);
  const y = rows.map((r) => r.label);
  const scaler = fitRobustScaler(X);
  const Z = X.map((x) => applyScaler(scaler, x));
  const weights = dayBalancedWeights(rows.map((r) => r.targetTs));
  const solved = solveWeightedL2Logistic(Z, y, weights);
  const artifact = {
    specification: ES1_PRICE_SPEC,
    scaler: ES1_SCALER,
    features: ES1_FEATURES,
    C: ES1_LOGISTIC_C,
    solver: ES1_SOLVER,
    max_iter: ES1_MAX_ITER,
    center: scaler.center,
    scale: scaler.scale,
    coefficients: solved.coefficients,
    intercept: solved.intercept,
    training_start_ts: rows[0].targetTs,
    training_end_ts: rows[rows.length - 1].targetTs,
    training_row_count: rows.length,
    block_index: blockIndex,
  };
  const artifactSha256 = sha256(artifact);
  return {
    fitId: `es1-fit-${String(blockIndex).padStart(5, "0")}-${artifactSha256.slice(0, 12)}`,
    artifactSha256,
    featureSchemaHash: es1FeatureSchemaHash(),
    specification: ES1_PRICE_SPEC,
    scalerName: ES1_SCALER,
    scaler,
    coefficients: solved.coefficients,
    intercept: solved.intercept,
    trainingRowCount: rows.length,
    trainingStartTs: rows[0].targetTs,
    trainingEndTs: rows[rows.length - 1].targetTs,
    trainingStartIndex: rows[0].index,
    trainingEndIndex: rows[rows.length - 1].index,
    blockIndex,
    solver: ES1_SOLVER,
    converged: solved.converged,
    iterations: solved.iterations,
    gradientNorm: solved.gradientNorm,
    C: ES1_LOGISTIC_C,
  };
}

export function predictProbabilityGreen(fit: Es1Fit, vector: readonly number[]): number {
  const z = applyScaler(fit.scaler, vector).reduce(
    (acc, v, j) => acc + v * fit.coefficients[j],
    fit.intercept,
  );
  return sigmoid(z);
}

/**
 * Fit-episode boundary for eligible-row index `i`:
 * the initial fit is trained at index 768 and every 96 predictions thereafter.
 */
export function fitBoundaryFor(i: number): number | null {
  if (i < ES1_MIN_TRAIN_ROWS) return null;
  return (
    ES1_MIN_TRAIN_ROWS +
    Math.floor((i - ES1_MIN_TRAIN_ROWS) / ES1_RETRAIN_BLOCK) * ES1_RETRAIN_BLOCK
  );
}

export function trainingWindowFor(boundary: number): { start: number; end: number } {
  return { start: Math.max(0, boundary - ES1_TRAIN_WINDOW), end: boundary };
}
