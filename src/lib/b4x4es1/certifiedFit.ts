// ES1 certified price-head fitter.
//
// Reproduces the numerical path of
//   RobustScaler(quantile_range=(10, 90))
//   LogisticRegression(C=0.01, solver="lbfgs", tol=1e-4, max_iter=1000)
// as run by the offline sklearn oracle, using the pinned L-BFGS port in
// `lbfgs.ts`.
//
// Objective (exactly sklearn's `LinearModelLoss` for the binary case):
//   f(w, b) = (1 / S) * sum_i s_i * [ log(1 + exp(z_i)) - y_i * z_i ]
//             + 0.5 * (1 / (C * S)) * ||w||^2
//   z_i = x_i . w + b,   S = sum_i s_i
// The intercept is unpenalised.

import { lbfgsMinimize, LBFGS_GTOL } from "./lbfgs";

export const CERTIFIED_FIT_C = 0.01;
export const CERTIFIED_FIT_TOL = 1e-4;
export const CERTIFIED_FIT_MAX_ITER = 1000;

export interface CertifiedFitResult {
  coefficients: number[];
  intercept: number;
  converged: boolean;
  iterations: number;
  gradientNorm: number;
  stopReason: string;
  objective: number;
}

function logAddExp0(z: number): number {
  // log(1 + exp(z)) computed the stable way numpy/sklearn do.
  return z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z));
}

function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

/**
 * Fit the L2 logistic price head on already-scaled features.
 * `Z` rows must be RobustScaler output, `labels` in {0, 1}, `weights` the
 * day-balanced sample weights.
 */
export function fitCertifiedLogistic(
  Z: readonly (readonly number[])[],
  labels: readonly number[],
  weights: readonly number[],
  opts: { C?: number; tol?: number; maxIter?: number } = {},
): CertifiedFitResult {
  const C = opts.C ?? CERTIFIED_FIT_C;
  const tol = opts.tol ?? CERTIFIED_FIT_TOL;
  const maxIter = opts.maxIter ?? CERTIFIED_FIT_MAX_ITER;
  const n = Z.length;
  const d = n > 0 ? Z[0].length : 0;

  let swSum = 0;
  for (let i = 0; i < n; i++) swSum += weights[i];
  const l2 = 1 / (C * swSum);

  const objective = (theta: readonly number[]) => {
    const w = theta.slice(0, d);
    const b = theta[d];
    let loss = 0;
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    for (let i = 0; i < n; i++) {
      const row = Z[i];
      let z = b;
      for (let j = 0; j < d; j++) z += row[j] * w[j];
      const s = weights[i];
      loss += s * (logAddExp0(z) - labels[i] * z);
      const r = s * (sigmoid(z) - labels[i]);
      for (let j = 0; j < d; j++) gw[j] += row[j] * r;
      gb += r;
    }
    let f = loss / swSum;
    let reg = 0;
    for (let j = 0; j < d; j++) reg += w[j] * w[j];
    f += 0.5 * l2 * reg;
    const g = new Array<number>(d + 1);
    for (let j = 0; j < d; j++) g[j] = gw[j] / swSum + l2 * w[j];
    g[d] = gb / swSum;
    return { f, g };
  };

  const res = lbfgsMinimize(
    objective,
    new Array<number>(d + 1).fill(0),
    maxIter,
    tol === CERTIFIED_FIT_TOL ? LBFGS_GTOL : tol,
  );

  return {
    coefficients: res.x.slice(0, d),
    intercept: res.x[d],
    converged: res.converged,
    iterations: res.iterations,
    gradientNorm: res.gradientNorm,
    stopReason: res.stopReason,
    objective: res.f,
  };
}
