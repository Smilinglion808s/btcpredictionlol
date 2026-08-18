// Walk-forward stationary technical model used by the B4x4-ES1 Balanced
// Precision Stack R1 "fill" leg (venue-disagreement route).
//
// Frozen recipe (matches the research oracle):
//   median imputation (numeric) + RobustScaler(25, 75)
//   most-frequent imputation + one-hot (categorical)
//   LogisticRegression(penalty=l2, C=0.03, solver=lbfgs, max_iter=5000)
// Refit in 16-opportunity blocks: for the block starting at opportunity index
// `b`, train on prior eligible non-PUSH rows with indices [0, b-2); no fit
// exists while b-2 < 16.

import { fitCertifiedLogistic } from "./certifiedFit";
import { quantile } from "./priceHead";

export const PRECISION_TECHNICAL_C = 0.03;
export const PRECISION_TECHNICAL_MAX_ITER = 5000;
export const PRECISION_TECHNICAL_BLOCK = 16;
export const PRECISION_TECHNICAL_TRAIN_LAG = 2;
export const PRECISION_TECHNICAL_MIN_TRAIN_ROWS = 16;

export const PRECISION_TECHNICAL_CATEGORICALS = ["ema_alignment"] as const;

export const PRECISION_TECHNICAL_FEATURES = [
  "body_pct_of_range",
  "upper_wick_pct",
  "lower_wick_pct",
  "close_position_in_range",
  "change_pct",
  "dist_from_ema9_pct",
  "dist_from_ema21_pct",
  "dist_from_ema50_pct",
  "ema_alignment",
  "trend_age_candles",
  "atr14_pct",
  "range_expansion_vs_avg20",
  "bb_width_pct",
  "bb_position",
  "rsi14",
  "macd_hist_over_atr14",
  "roc_4",
  "roc_8",
  "momentum_8_over_atr",
  "stoch_k14",
  "stoch_d3",
  "channel_width_pct",
  "channel_position_0_1",
  "dist_to_high20_pct",
  "dist_to_low20_pct",
  "same_color_streak",
  "higher_low_sequence_4",
  "lower_high_sequence_4",
  "failed_breakout_up",
  "failed_breakout_down",
  "bullish_liquidity_sweep",
  "bearish_liquidity_sweep",
  "inside_bar",
  "outside_bar",
  "volume_expansion",
  "vol_zscore_20",
  "dist_from_vwap20_pct",
  "path_efficiency_4",
  "dist_from_4_candle_low_bps",
  "dist_from_4_candle_high_bps",
  "boundary_contiguous",
] as const;

export type TechnicalFeatureRow = Record<string, number | string | boolean | null>;

export interface TechnicalModel {
  numericNames: string[];
  medians: number[];
  center: number[];
  scale: number[];
  categoricalLevels: Record<string, string[]>;
  coefficients: number[];
  intercept: number;
  trainRows: number;
  converged: boolean;
  predictGreenProbability(row: TechnicalFeatureRow): number;
}

function toNumber(v: unknown): number | null {
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const low = v.toLowerCase();
    if (low === "true") return 1;
    if (low === "false") return 0;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  return quantile(s, 0.5);
}

function sigmoid(z: number): number {
  return z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z));
}

const CATEGORICAL_SET = new Set<string>(PRECISION_TECHNICAL_CATEGORICALS);

/** Fit the walk-forward technical head on already-selected training rows. */
export function fitTechnicalModel(
  rows: readonly TechnicalFeatureRow[],
  labels: readonly number[],
): TechnicalModel | null {
  if (rows.length < PRECISION_TECHNICAL_MIN_TRAIN_ROWS) return null;
  if (new Set(labels).size < 2) return null;

  const numericNames = PRECISION_TECHNICAL_FEATURES.filter((f) => !CATEGORICAL_SET.has(f));
  const rawCols = numericNames.map((name) =>
    rows.map((r) => toNumber(r[name])),
  );
  const medians = rawCols.map((col) => median(col.filter((v): v is number => v !== null)));
  const filled = rawCols.map((col, j) => col.map((v) => (v === null ? medians[j] : v)));

  const center: number[] = [];
  const scale: number[] = [];
  for (const col of filled) {
    const sorted = [...col].sort((a, b) => a - b);
    const med = quantile(sorted, 0.5);
    const iqr = quantile(sorted, 0.75) - quantile(sorted, 0.25);
    center.push(med);
    scale.push(iqr > 0 && Number.isFinite(iqr) ? iqr : 1);
  }

  // Categorical: most-frequent imputation + one-hot over the training vocabulary.
  const categoricalLevels: Record<string, string[]> = {};
  const modes: Record<string, string> = {};
  for (const name of PRECISION_TECHNICAL_CATEGORICALS) {
    const counts = new Map<string, number>();
    for (const r of rows) {
      const v = r[name];
      if (v === null || v === undefined) continue;
      const s = String(v);
      counts.set(s, (counts.get(s) ?? 0) + 1);
    }
    const levels = [...counts.keys()].sort();
    categoricalLevels[name] = levels;
    let best = levels[0] ?? "";
    let bestN = -1;
    for (const [k, n] of counts) if (n > bestN) { best = k; bestN = n; }
    modes[name] = best;
  }

  const encode = (row: TechnicalFeatureRow): number[] => {
    const out: number[] = [];
    numericNames.forEach((name, j) => {
      const raw = toNumber(row[name]);
      const v = raw === null ? medians[j] : raw;
      out.push((v - center[j]) / scale[j]);
    });
    for (const name of PRECISION_TECHNICAL_CATEGORICALS) {
      const levels = categoricalLevels[name] ?? [];
      const raw = row[name];
      const value = raw === null || raw === undefined ? modes[name] : String(raw);
      for (const level of levels) out.push(value === level ? 1 : 0);
    }
    return out;
  };

  const Z = rows.map(encode);
  const weights = new Array<number>(rows.length).fill(1);
  const solved = fitCertifiedLogistic(Z, labels, weights, {
    C: PRECISION_TECHNICAL_C,
    maxIter: PRECISION_TECHNICAL_MAX_ITER,
  });

  return {
    numericNames,
    medians,
    center,
    scale,
    categoricalLevels,
    coefficients: solved.coefficients,
    intercept: solved.intercept,
    trainRows: rows.length,
    converged: solved.converged,
    predictGreenProbability(row: TechnicalFeatureRow) {
      const z = encode(row).reduce((acc, v, j) => acc + v * solved.coefficients[j], solved.intercept);
      return sigmoid(z);
    },
  };
}

/**
 * Training bound for the block containing opportunity `index`:
 * blockStart − 2, or null when fewer than 16 rows are available.
 */
export function technicalTrainEndFor(index: number): number | null {
  const blockStart = Math.floor(index / PRECISION_TECHNICAL_BLOCK) * PRECISION_TECHNICAL_BLOCK;
  const trainEnd = blockStart - PRECISION_TECHNICAL_TRAIN_LAG;
  return trainEnd >= PRECISION_TECHNICAL_MIN_TRAIN_ROWS ? trainEnd : null;
}
