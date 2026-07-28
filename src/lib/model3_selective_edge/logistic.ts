// L2-regularized binary logistic regression + Platt calibration.
// Inputs are already-preprocessed (no internal standardization).
// R2: adds optional per-row sample weights for class-balance + recency weighting.

export interface LogisticModel {
  w: number[];
  b: number;
}

export function sigmoid(z: number): number {
  if (z >= 0) { const e = Math.exp(-z); return 1 / (1 + e); }
  const e = Math.exp(z); return e / (1 + e);
}

export function trainLogistic(
  X: number[][],
  y: number[],
  opts: { lambda: number; maxIter: number; tol: number; sampleWeights?: number[] },
): LogisticModel {
  const n = X.length;
  const d = X[0]?.length ?? 0;
  const w = new Array<number>(d).fill(0);
  let b = 0;
  const lr = 0.1;
  let prev = Infinity;

  const sw = opts.sampleWeights;
  // Effective sample size = sum of weights (falls back to n if unweighted).
  let wsum = 0;
  if (sw) { for (let i = 0; i < n; i++) wsum += sw[i]; }
  else wsum = n;
  const eff = wsum > 0 ? wsum : 1;

  for (let iter = 0; iter < opts.maxIter; iter++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0, loss = 0;
    for (let i = 0; i < n; i++) {
      const wi = sw ? sw[i] : 1;
      const row = X[i];
      let z = b;
      for (let j = 0; j < d; j++) z += w[j] * row[j];
      const p = sigmoid(z);
      const err = (p - y[i]) * wi;
      for (let j = 0; j < d; j++) gw[j] += err * row[j];
      gb += err;
      loss += wi * -(y[i] * Math.log(Math.max(p, 1e-12)) + (1 - y[i]) * Math.log(Math.max(1 - p, 1e-12)));
    }
    for (let j = 0; j < d; j++) gw[j] = gw[j] / eff + opts.lambda * w[j] / eff;
    gb /= eff;
    for (let j = 0; j < d; j++) w[j] -= lr * gw[j];
    b -= lr * gb;
    loss /= eff;
    let reg = 0; for (let j = 0; j < d; j++) reg += w[j] * w[j];
    loss += (opts.lambda / (2 * eff)) * reg;
    if (Math.abs(prev - loss) < opts.tol) break;
    prev = loss;
  }
  return { w, b };
}

export function predictLogit(x: number[], m: LogisticModel): number {
  let z = m.b;
  for (let j = 0; j < x.length; j++) z += m.w[j] * x[j];
  return z;
}
export function predictProb(x: number[], m: LogisticModel): number {
  return sigmoid(predictLogit(x, m));
}

export function fitPlatt(raw: number[], y: number[]): { a: number; b: number } {
  const n = raw.length;
  if (n < 5) return { a: 1, b: 0 };
  let a = 1, b = 0;
  const lr = 0.5;
  for (let iter = 0; iter < 400; iter++) {
    let ga = 0, gb = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(a * raw[i] + b);
      const err = p - y[i];
      ga += err * raw[i];
      gb += err;
    }
    a -= lr * ga / n;
    b -= lr * gb / n;
  }
  return { a, b };
}
export function applyPlatt(raw: number, a: number, b: number): number {
  return sigmoid(a * raw + b);
}
