// Pure-TS L2 logistic regression.
// Semantics match sklearn LogisticRegression(penalty='l2', C=C, fit_intercept=True):
//   loss(w, b) = -sum_i [ y_i * log s + (1-y_i)*log(1-s) ] + (1/(2*C)) * ||w||^2
//   intercept is UN-penalized (matches sklearn default).
// Solver: batch gradient descent with adaptive step (Barzilai-Borwein-ish
// backtracking). Good enough for n ~ 100-2000, d ~ 200.

export interface LogisticFitInput {
  X: number[][]; // n x d (already standardized externally)
  y: number[];   // 0/1 labels
  C: number;
  maxIter: number;
  tol: number;
}

export interface LogisticFitResult {
  coefficients: number[];
  intercept: number;
  iterations: number;
  final_loss: number;
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

export function fitLogisticRegression(inp: LogisticFitInput): LogisticFitResult {
  const { X, y, C, maxIter, tol } = inp;
  const n = X.length;
  if (n === 0) throw new Error("empty training set");
  const d = X[0].length;
  const w = new Array<number>(d).fill(0);
  let b = 0;
  const lambda = 1 / Math.max(C, 1e-9);

  const gradAndLoss = (w0: number[], b0: number) => {
    const gw = new Array<number>(d).fill(0);
    let gb = 0;
    let loss = 0;
    for (let i = 0; i < n; i++) {
      const xi = X[i];
      let z = b0;
      for (let j = 0; j < d; j++) z += w0[j] * xi[j];
      const p = sigmoid(z);
      const err = p - y[i];
      gb += err;
      for (let j = 0; j < d; j++) gw[j] += err * xi[j];
      // stable log-loss
      const yi = y[i];
      // log(1 + exp(-z*(2y-1)))
      const yz = z * (yi === 1 ? 1 : -1);
      loss += yz >= 0 ? Math.log1p(Math.exp(-yz)) : -yz + Math.log1p(Math.exp(yz));
    }
    for (let j = 0; j < d; j++) {
      gw[j] += lambda * w0[j];
      loss += 0.5 * lambda * w0[j] * w0[j];
    }
    return { gw, gb, loss };
  };

  let { gw, gb, loss } = gradAndLoss(w, b);
  let step = 1e-2;
  let iter = 0;
  let converged = false;

  for (; iter < maxIter; iter++) {
    // Backtracking line search on step.
    let trialStep = step;
    let newW: number[] = w.slice();
    let newB = b;
    let newLoss = loss;
    for (let t = 0; t < 25; t++) {
      newW = w.map((wj, j) => wj - trialStep * gw[j]);
      newB = b - trialStep * gb;
      const trial = gradAndLoss(newW, newB);
      if (trial.loss < loss - 1e-9) {
        newLoss = trial.loss;
        gw = trial.gw; gb = trial.gb;
        break;
      }
      trialStep *= 0.5;
      if (t === 24) { newLoss = trial.loss; gw = trial.gw; gb = trial.gb; }
    }
    const rel = Math.abs(loss - newLoss) / Math.max(1, Math.abs(loss));
    w.splice(0, d, ...newW);
    b = newB;
    loss = newLoss;
    // Try to grow step for next iter.
    step = Math.min(trialStep * 2, 1.0);
    if (rel < tol) { converged = true; iter++; break; }
  }

  return { coefficients: w, intercept: b, iterations: iter, final_loss: loss, converged };
}
