// Preprocessing for m3-se-r1: median imputation + missing indicator,
// 1st/99th winsorization, median/IQR (robust) scaling. Fit on training rows
// only, then applied identically at every downstream stage.

export interface Preprocess {
  medians: number[];
  q1: number[];
  q99: number[];
  iqrs: number[];   // scale = IQR (75th - 25th), or 1 if zero.
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * q));
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

export function fitPreprocess(X: number[][]): Preprocess {
  const d = X[0]?.length ?? 0;
  const medians = new Array<number>(d).fill(0);
  const q1 = new Array<number>(d).fill(0);
  const q99 = new Array<number>(d).fill(0);
  const iqrs = new Array<number>(d).fill(1);
  for (let j = 0; j < d; j++) {
    const col: number[] = [];
    for (const row of X) {
      const v = row[j];
      if (Number.isFinite(v)) col.push(v);
    }
    col.sort((a, b) => a - b);
    medians[j] = quantile(col, 0.5);
    q1[j] = quantile(col, 0.01);
    q99[j] = quantile(col, 0.99);
    const p25 = quantile(col, 0.25);
    const p75 = quantile(col, 0.75);
    const iqr = p75 - p25;
    iqrs[j] = iqr > 1e-9 ? iqr : 1;
  }
  return { medians, q1, q99, iqrs };
}

/** Apply impute + winsorize + robust scale. Returns a fresh row. */
export function applyPreprocess(row: number[], pp: Preprocess): number[] {
  const d = pp.medians.length;
  const out = new Array<number>(d);
  for (let j = 0; j < d; j++) {
    let v = row[j];
    if (!Number.isFinite(v)) v = pp.medians[j];
    if (v < pp.q1[j]) v = pp.q1[j];
    else if (v > pp.q99[j]) v = pp.q99[j];
    out[j] = (v - pp.medians[j]) / pp.iqrs[j];
  }
  return out;
}

export function applyPreprocessBatch(X: number[][], pp: Preprocess): number[][] {
  return X.map((r) => applyPreprocess(r, pp));
}
