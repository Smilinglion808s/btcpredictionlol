// Small L2-regularized binary logistic regression + Platt calibration.
// Self-contained. No external ML deps.

export interface LogisticFit {
  weights: number[];
  intercept: number;
  means: number[];
  scales: number[];
  platt_a: number;
  platt_b: number;
  n_train: number;
  n_holdout: number;
}

function sigmoid(z: number): number {
  if (z >= 0) { const e = Math.exp(-z); return 1 / (1 + e); }
  const e = Math.exp(z); return e / (1 + e);
}

function standardize(X: number[][]): { Z: number[][]; means: number[]; scales: number[] } {
  const n = X.length, d = X[0]?.length ?? 0;
  const means = new Array<number>(d).fill(0);
  const scales = new Array<number>(d).fill(1);
  for (let j = 0; j < d; j++) {
    let s = 0; for (let i = 0; i < n; i++) s += X[i][j];
    means[j] = s / n;
  }
  for (let j = 0; j < d; j++) {
    let s = 0; for (let i = 0; i < n; i++) { const v = X[i][j] - means[j]; s += v * v; }
    const sd = Math.sqrt(s / Math.max(1, n));
    scales[j] = sd > 1e-9 ? sd : 1;
  }
  const Z = X.map((row) => row.map((v, j) => (v - means[j]) / scales[j]));
  return { Z, means, scales };
}

/** Train logistic regression via gradient descent w/ L2 (sklearn C=1/lambda). */
export function trainLogistic(
  X: number[][],
  y: number[],
  opts: { lambda: number; maxIter: number; tol: number },
): { w: number[]; b: number; means: number[]; scales: number[] } {
  const { Z, means, scales } = standardize(X);
  const n = Z.length, d = Z[0].length;
  const w = new Array<number>(d).fill(0);
  let b = 0;
  const lr = 0.1;
  let prevLoss = Infinity;
  for (let iter = 0; iter < opts.maxIter; iter++) {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    let loss = 0;
    for (let i = 0; i < n; i++) {
      let z = b;
      const row = Z[i];
      for (let j = 0; j < d; j++) z += w[j] * row[j];
      const p = sigmoid(z);
      const err = p - y[i];
      for (let j = 0; j < d; j++) gw[j] += err * row[j];
      gb += err;
      loss += -(y[i] * Math.log(Math.max(p, 1e-12)) + (1 - y[i]) * Math.log(Math.max(1 - p, 1e-12)));
    }
    for (let j = 0; j < d; j++) gw[j] = gw[j] / n + opts.lambda * w[j] / n;
    gb /= n;
    for (let j = 0; j < d; j++) w[j] -= lr * gw[j];
    b -= lr * gb;
    loss /= n;
    let reg = 0; for (let j = 0; j < d; j++) reg += w[j] * w[j];
    loss += (opts.lambda / (2 * n)) * reg;
    if (Math.abs(prevLoss - loss) < opts.tol) break;
    prevLoss = loss;
  }
  return { w, b, means, scales };
}

export function predictProb(
  x: number[],
  w: number[],
  b: number,
  means: number[],
  scales: number[],
): number {
  let z = b;
  for (let j = 0; j < x.length; j++) z += w[j] * ((x[j] - means[j]) / scales[j]);
  return sigmoid(z);
}

/** Platt scaling: fit sigmoid(a*p_raw + b_) to validation labels via GD. */
export function fitPlatt(rawProbs: number[], labels: number[]): { a: number; b: number } {
  const n = rawProbs.length;
  if (n < 5) return { a: 1, b: 0 };
  let a = 1, b = 0;
  const lr = 0.5;
  for (let iter = 0; iter < 300; iter++) {
    let ga = 0, gb = 0;
    for (let i = 0; i < n; i++) {
      const p = sigmoid(a * rawProbs[i] + b);
      const err = p - labels[i];
      ga += err * rawProbs[i];
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
