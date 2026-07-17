// AAS96 dual L2 logistic regression trainer.
// Deterministic full-batch gradient descent with adaptive step (backtracking).
// Objective: mean(log(1+exp(z_i)) - y_i * z_i) + lambda * sum(beta_j^2)
// The intercept is NOT regularized.

export interface LogisticFit {
  intercept: number;
  coef: number[]; // length = X.cols
  lambda: number;
  iterations: number;
  finalLoss: number;
  converged: boolean;
}

function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

function softplus(z: number): number {
  return z > 0 ? z + Math.log1p(Math.exp(-z)) : Math.log1p(Math.exp(z));
}

function objective(X: number[][], y: number[], b0: number, beta: number[], lambda: number): number {
  const n = X.length;
  let loss = 0;
  for (let i = 0; i < n; i++) {
    let z = b0;
    const row = X[i];
    for (let j = 0; j < beta.length; j++) z += row[j] * beta[j];
    loss += softplus(z) - y[i] * z;
  }
  loss /= Math.max(1, n);
  let reg = 0;
  for (let j = 0; j < beta.length; j++) reg += beta[j] * beta[j];
  return loss + lambda * reg;
}

function gradient(X: number[][], y: number[], b0: number, beta: number[], lambda: number): { g0: number; g: number[] } {
  const n = X.length;
  const p = beta.length;
  let g0 = 0;
  const g = new Array<number>(p).fill(0);
  for (let i = 0; i < n; i++) {
    let z = b0;
    const row = X[i];
    for (let j = 0; j < p; j++) z += row[j] * beta[j];
    const pi = sigmoid(z);
    const diff = pi - y[i];
    g0 += diff;
    for (let j = 0; j < p; j++) g[j] += diff * row[j];
  }
  const inv = 1 / Math.max(1, n);
  g0 *= inv;
  for (let j = 0; j < p; j++) g[j] = g[j] * inv + 2 * lambda * beta[j];
  return { g0, g };
}

export function trainLogistic(
  X: number[][],
  y: number[],
  lambda: number,
  opts?: { maxIter?: number; tol?: number },
): LogisticFit {
  const maxIter = opts?.maxIter ?? 500;
  const tol = opts?.tol ?? 1e-6;
  const p = X[0]?.length ?? 0;
  let b0 = 0;
  let beta = new Array<number>(p).fill(0);
  let step = 1.0;
  let loss = objective(X, y, b0, beta, lambda);
  let converged = false;
  let it = 0;
  for (; it < maxIter; it++) {
    const { g0, g } = gradient(X, y, b0, beta, lambda);
    // gradient norm
    let gn = g0 * g0;
    for (let j = 0; j < p; j++) gn += g[j] * g[j];
    gn = Math.sqrt(gn);
    if (gn < tol) { converged = true; break; }
    // Backtracking line search — halve step until improvement.
    let s = step;
    let newLoss = loss;
    let newB0 = b0;
    let newBeta = beta;
    for (let ls = 0; ls < 25; ls++) {
      newB0 = b0 - s * g0;
      newBeta = new Array<number>(p);
      for (let j = 0; j < p; j++) newBeta[j] = beta[j] - s * g[j];
      newLoss = objective(X, y, newB0, newBeta, lambda);
      if (newLoss < loss - 1e-12) break;
      s *= 0.5;
    }
    if (newLoss >= loss - 1e-12) { converged = true; break; }
    // Grow step opportunistically.
    step = Math.min(s * 1.5, 4.0);
    b0 = newB0;
    beta = newBeta;
    if (loss - newLoss < tol * Math.max(1, Math.abs(loss))) {
      loss = newLoss; converged = true; break;
    }
    loss = newLoss;
  }
  return { intercept: b0, coef: beta, lambda, iterations: it, finalLoss: loss, converged };
}

export function predictProb(fit: LogisticFit, x: number[]): number {
  let z = fit.intercept;
  for (let j = 0; j < fit.coef.length; j++) z += fit.coef[j] * x[j];
  return sigmoid(z);
}
