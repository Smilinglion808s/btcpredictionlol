// AAS96 preprocessing. Fit-only-on-training median imputation + mean/std
// scaling for numerics; deterministic one-hot for categoricals; boolean
// direct mapping. Adds missing indicators. Column ordering per spec:
// numeric_direct, numeric_missing, boolean_direct, boolean_missing,
// categorical_one_hot (sorted).

import type { FeatureMap } from "./featurize";

export interface Scaler {
  numeric: Record<string, { median: number; mean: number; std: number }>;
  booleans: string[]; // keys used
  categoricals: Record<string, string[]>; // vocab (lexicographically sorted)
}

const UNKNOWN = "__unknown__";
const MISSING = "__missing__";

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}
function meanStd(values: number[]): { mean: number; std: number } {
  if (values.length === 0) return { mean: 0, std: 0 };
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const varr = values.reduce((a, b) => a + (b - mean) ** 2, 0) / values.length;
  return { mean, std: Math.sqrt(varr) };
}

/** Fit scaler on training rows only. */
export function fitScaler(rows: FeatureMap[]): Scaler {
  if (rows.length === 0) {
    return { numeric: {}, booleans: [], categoricals: {} };
  }
  const first = rows[0];
  const numericKeys = Object.keys(first).filter((k) => k.startsWith("num__"));
  const boolKeys = Object.keys(first).filter((k) => k.startsWith("bool__"));
  const catKeys = Object.keys(first).filter((k) => k.startsWith("cat__"));

  const numeric: Scaler["numeric"] = {};
  for (const k of numericKeys) {
    const vals: number[] = [];
    for (const r of rows) {
      const v = r[k];
      if (typeof v === "number" && Number.isFinite(v)) vals.push(v);
    }
    const med = median(vals);
    // Impute for scaling stats using the median.
    const imputed = rows.map((r) => {
      const v = r[k];
      return typeof v === "number" && Number.isFinite(v) ? v : med;
    });
    const { mean, std } = meanStd(imputed);
    numeric[k] = { median: med, mean, std };
  }

  const categoricals: Scaler["categoricals"] = {};
  for (const k of catKeys) {
    const set = new Set<string>();
    for (const r of rows) {
      const v = r[k];
      set.add(typeof v === "string" ? v : MISSING);
    }
    categoricals[k] = [...set].sort();
  }
  return { numeric, booleans: boolKeys, categoricals };
}

/** Apply scaler, produce numeric feature vector + ordered names. */
export function applyScaler(scaler: Scaler, row: FeatureMap): { names: string[]; values: number[] } {
  const names: string[] = [];
  const values: number[] = [];

  const numericKeys = Object.keys(scaler.numeric).sort();
  for (const k of numericKeys) {
    const { median: med, mean, std } = scaler.numeric[k];
    const raw = row[k];
    const present = typeof raw === "number" && Number.isFinite(raw);
    const val = present ? (raw as number) : med;
    const scaled = std > 1e-12 ? (val - mean) / std : 0;
    names.push(k);
    values.push(scaled);
  }
  for (const k of numericKeys) {
    const raw = row[k];
    const present = typeof raw === "number" && Number.isFinite(raw);
    names.push(`${k}__missing`);
    values.push(present ? 0 : 1);
  }
  const boolKeys = [...scaler.booleans].sort();
  for (const k of boolKeys) {
    const raw = row[k];
    names.push(k);
    values.push(typeof raw === "number" ? raw : 0);
  }
  for (const k of boolKeys) {
    const raw = row[k];
    names.push(`${k}__missing`);
    values.push(raw == null ? 1 : 0);
  }
  const catKeys = Object.keys(scaler.categoricals).sort();
  for (const k of catKeys) {
    const vocab = scaler.categoricals[k];
    const raw = row[k];
    const s = typeof raw === "string" ? raw : MISSING;
    const eff = vocab.includes(s) ? s : (vocab.includes(UNKNOWN) ? UNKNOWN : vocab[0] ?? MISSING);
    for (const v of vocab) {
      names.push(`${k}=${v}`);
      values.push(v === eff ? 1 : 0);
    }
  }
  return { names, values };
}

export function batchApply(scaler: Scaler, rows: FeatureMap[]): { names: string[]; matrix: number[][] } {
  if (rows.length === 0) return { names: [], matrix: [] };
  const first = applyScaler(scaler, rows[0]);
  const matrix: number[][] = [first.values];
  for (let i = 1; i < rows.length; i++) matrix.push(applyScaler(scaler, rows[i]).values);
  return { names: first.names, matrix };
}
