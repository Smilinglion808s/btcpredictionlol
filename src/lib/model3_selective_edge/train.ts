// End-to-end training pipeline for m3-se-r2.
// Chronological, no leakage. Returns a serializable artifact + diagnostics.
//
// Key R2 changes vs R1:
//   * Fixed windows (slow 1024, fast 384, cal 256, oof warmup 384, block 32).
//   * Capped class-balance weights on slow / fast / stacker fits.
//   * Fast expert uses exponential recency weighting (half-life 96).
//   * Selector inputs rebuilt (5 consensus + 6 aligned magnitude fields).
//   * Selector penalty selected via grid search (ROC-AUC then Brier tiebreak).
//   * Selector interpreted as a ranker; publish gate uses selector_score_raw
//     (pre-Platt), with the threshold = P40 of calibration scores.
//   * Retain-prior-fit on insufficient history is enforced at the caller.

import { createHash } from "crypto";
import {
  M3SE_MODEL_VERSION,
  M3SE_FEATURE_SCHEMA_VERSION,
  M3SE_SLOW_ROWS,
  M3SE_FAST_ROWS,
  M3SE_CAL_ROWS,
  M3SE_OOF_WARMUP_ROWS,
  M3SE_OOF_BLOCK_SIZE,
  M3SE_MIN_LABELED_ROWS,
  M3SE_FAST_HALF_LIFE,
  M3SE_SLOW_LAMBDA,
  M3SE_FAST_LAMBDA,
  M3SE_STACKER_LAMBDA,
  M3SE_SELECTOR_LAMBDA_GRID,
  M3SE_CLASS_WEIGHT_MIN,
  M3SE_CLASS_WEIGHT_MAX,
  M3SE_MAX_ITER,
  M3SE_TOL,
  M3SE_TARGET_COVERAGE,
  M3SE_DIRECTION_STRENGTH_PERCENTILE,
  M3SE_MIN_SELECTION_THRESHOLD,
  M3SE_MIN_ESTIMATED_COVERAGE,
  M3SE_MAX_ESTIMATED_COVERAGE,
} from "./config";
import {
  M3SE_FEATURE_NAMES,
  M3SE_SELECTOR_V2_FEATURE_NAMES,
  buildSelectorRowV2,
  computeM3SEConsensus,
  type M3SEConsensus,
} from "./features";
import { fitPreprocess, applyPreprocessBatch, applyPreprocess, type Preprocess } from "./preprocess";
import {
  trainLogistic,
  predictProb,
  fitPlatt,
  applyPlatt,
  type LogisticModel,
} from "./logistic";

export interface M3SEArtifact {
  model_version: string;
  feature_schema_version: string;
  preprocess: Preprocess;
  slow: LogisticModel;
  fast: LogisticModel;
  stacker: LogisticModel;
  selector: LogisticModel;
  platt_direction: { a: number; b: number };
  platt_correctness: { a: number; b: number };
  selection_threshold: number;
  // Sorted calibration selector scores (used for percentile lookups at score time).
  calibration_selector_scores_sorted: number[];
  // R3 publish gate: direction strength only.
  direction_strength_threshold: number;
  calibration_direction_strengths_sorted: number[];
  green_class_weight: number;
  red_class_weight: number;
  fast_half_life: number;
}

export interface M3SEFitResult {
  ok: true;
  fit_id: string;
  artifact: M3SEArtifact;
  windows: {
    slow_start_ts: string; slow_end_ts: string; slow_rows: number;
    fast_start_ts: string; fast_end_ts: string; fast_rows: number;
    oof_start_ts: string; oof_end_ts: string; oof_rows: number; oof_block_size: number;
    calibration_start_ts: string; calibration_end_ts: string; calibration_rows: number;
  };
  diagnostics: {
    oof_direction_accuracy: number;
    oof_direction_balanced_accuracy: number;
    oof_direction_brier: number;
    oof_direction_log_loss: number;
    calibration_direction_accuracy: number;
    calibration_direction_balanced_accuracy: number;
    calibration_direction_brier: number;
    calibration_direction_log_loss: number;
    predicted_green_share: number;
    predicted_red_share: number;
    selector_roc_auc: number;
    selector_pr_auc: number;
    selector_brier: number;
    selector_log_loss: number;
    selector_top20_accuracy: number;
    selector_top40_accuracy: number;
    selector_top60_accuracy: number;
    selector_bottom40_accuracy: number;
    selector_top60_lift_vs_raw: number;
    selector_top60_lift_vs_bottom40: number;
    target_coverage: number;
    calibration_estimated_coverage: number;
    selector_score_calibration_min: number;
    selector_score_calibration_median: number;
    selector_score_calibration_p40: number;
    selector_score_calibration_p60: number;
    selector_score_calibration_max: number;
    direction_strength_calibration_min: number;
    direction_strength_calibration_median: number;
    direction_strength_calibration_p65: number;
    direction_strength_calibration_p70: number;
    direction_strength_calibration_max: number;
    selector_estimated_coverage: number;
    slow_lambda: number;
    fast_lambda: number;
    stacker_lambda: number;
    selector_lambda: number;
    selector_lambda_search: Array<{ lambda: number; roc_auc: number; brier: number }>;
    training_green_count: number;
    training_red_count: number;
    green_class_weight: number;
    red_class_weight: number;
    fast_half_life: number;
  };
  hashes: { feature_schema_hash: string; artifact_hash: string };
}

export type M3SEFitFail = { ok: false; reason: string };

// ---------- utility ---------------------------------------------------------

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * q));
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

/** R3 direction strength: |logit(p_green)| on a clamped probability. */
export function directionStrengthFromP(pGreen: number): number {
  const p = Math.min(0.999, Math.max(0.001, pGreen));
  return Math.abs(Math.log(p / (1 - p)));
}

function accuracy(p: number[], y: number[]): number {
  let c = 0; for (let i = 0; i < p.length; i++) if ((p[i] >= 0.5 ? 1 : 0) === y[i]) c++;
  return p.length ? c / p.length : 0;
}
function balancedAccuracy(p: number[], y: number[]): number {
  let tp = 0, tn = 0, pos = 0, neg = 0;
  for (let i = 0; i < p.length; i++) {
    const pred = p[i] >= 0.5 ? 1 : 0;
    if (y[i] === 1) { pos++; if (pred === 1) tp++; }
    else { neg++; if (pred === 0) tn++; }
  }
  const sens = pos > 0 ? tp / pos : 0;
  const spec = neg > 0 ? tn / neg : 0;
  return (sens + spec) / 2;
}
function brier(p: number[], y: number[]): number {
  let s = 0; for (let i = 0; i < p.length; i++) s += (p[i] - y[i]) ** 2;
  return p.length ? s / p.length : 0;
}
function logLoss(p: number[], y: number[]): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) {
    const pp = Math.min(0.9999, Math.max(0.0001, p[i]));
    s += -(y[i] * Math.log(pp) + (1 - y[i]) * Math.log(1 - pp));
  }
  return p.length ? s / p.length : 0;
}
function rocAuc(p: number[], y: number[]): number {
  const pos = y.filter((v) => v === 1).length;
  const neg = y.length - pos;
  if (pos === 0 || neg === 0) return 0.5;
  const pairs = p.map((v, i) => ({ v, y: y[i] })).sort((a, b) => b.v - a.v);
  let tp = 0, fp = 0, prevFp = 0, prevTp = 0, auc = 0;
  for (const { y: yi } of pairs) {
    if (yi === 1) tp++; else fp++;
    auc += (fp - prevFp) * (tp + prevTp) / 2;
    prevFp = fp; prevTp = tp;
  }
  return auc / (pos * neg);
}
function prAuc(p: number[], y: number[]): number {
  const pos = y.reduce((a, b) => a + b, 0);
  if (pos === 0) return 0;
  const pairs = p.map((v, i) => ({ v, y: y[i] })).sort((a, b) => b.v - a.v);
  let tp = 0, fp = 0, prevRec = 0, prevPrec = 1, auc = 0;
  for (const { y: yi } of pairs) {
    if (yi === 1) tp++; else fp++;
    const rec = tp / pos;
    const prec = tp / (tp + fp);
    auc += (rec - prevRec) * (prec + prevPrec) / 2;
    prevRec = rec; prevPrec = prec;
  }
  return auc;
}

function cappedClassWeights(y: number[]): { green: number; red: number; nGreen: number; nRed: number } {
  const nGreen = y.reduce((a, v) => a + v, 0);
  const nRed = y.length - nGreen;
  const clamp = (v: number) => Math.min(M3SE_CLASS_WEIGHT_MAX, Math.max(M3SE_CLASS_WEIGHT_MIN, v));
  const gw = nGreen > 0 ? clamp(y.length / (2 * nGreen)) : 1;
  const rw = nRed > 0 ? clamp(y.length / (2 * nRed)) : 1;
  return { green: gw, red: rw, nGreen, nRed };
}

function weightsForTargets(y: number[], green: number, red: number, recency?: number[]): number[] {
  const w = new Array<number>(y.length);
  for (let i = 0; i < y.length; i++) {
    const cw = y[i] === 1 ? green : red;
    w[i] = recency ? cw * recency[i] : cw;
  }
  return w;
}

function recencyWeights(n: number, halfLife: number): number[] {
  // age 0 == most recent row (last index in a chronological array).
  const w = new Array<number>(n);
  for (let i = 0; i < n; i++) {
    const age = n - 1 - i;
    w[i] = Math.pow(0.5, age / halfLife);
  }
  return w;
}

/** Stacker features (unchanged R1 recipe, spec §5 keeps direction stacker). */
function stackerFeatureRow(featureRow: number[], slowLogit: number, fastLogit: number): number[] {
  return [
    slowLogit,
    fastLogit,
    featureRow[15], // realized_volatility_8_to_32
    featureRow[19], // trend_efficiency_32
    featureRow[9],  // ema9_minus_ema21_to_atr
  ];
}

function stableFitId(art: M3SEArtifact, nTrain: number): string {
  const h = createHash("sha256");
  h.update(art.model_version);
  h.update("|"); h.update(String(nTrain));
  for (const v of art.slow.w) h.update(v.toFixed(8));
  h.update("|s=" + art.slow.b.toFixed(8));
  for (const v of art.fast.w) h.update(v.toFixed(8));
  h.update("|f=" + art.fast.b.toFixed(8));
  for (const v of art.stacker.w) h.update(v.toFixed(8));
  h.update("|k=" + art.stacker.b.toFixed(8));
  for (const v of art.selector.w) h.update(v.toFixed(8));
  h.update("|l=" + art.selector.b.toFixed(8));
  return `m3ser3_${nTrain}_${h.digest("hex").slice(0, 12)}`;
}

function hashArtifact(a: M3SEArtifact): string {
  return createHash("sha256").update(JSON.stringify(a)).digest("hex").slice(0, 16);
}
function hashFeatureSchema(): string {
  return createHash("sha256")
    .update([...M3SE_FEATURE_NAMES, "|", ...M3SE_SELECTOR_V2_FEATURE_NAMES].join(","))
    .digest("hex")
    .slice(0, 16);
}

// ---------- pipeline --------------------------------------------------------

export function trainM3SE(
  X: number[][],
  y: number[],
  rowTimestamps: string[],
): M3SEFitResult | M3SEFitFail {
  const N = X.length;
  if (N < M3SE_MIN_LABELED_ROWS) {
    return { ok: false, reason: `insufficient_labeled_rows:${N}<${M3SE_MIN_LABELED_ROWS}` };
  }

  // 1) Chronological split — reserve calibration at the tail.
  const calStart = N - M3SE_CAL_ROWS;
  const trainX = X.slice(0, calStart);
  const trainY = y.slice(0, calStart);
  const trainTs = rowTimestamps.slice(0, calStart);
  const calX = X.slice(calStart);
  const calY = y.slice(calStart);
  const calTs = rowTimestamps.slice(calStart);

  if (trainX.length < M3SE_SLOW_ROWS) {
    return { ok: false, reason: `insufficient_train_pool:${trainX.length}<${M3SE_SLOW_ROWS}` };
  }
  if (calX.length < M3SE_CAL_ROWS) {
    return { ok: false, reason: `insufficient_calibration:${calX.length}<${M3SE_CAL_ROWS}` };
  }

  // 2) Preprocess (fit on training pool only).
  const pp = fitPreprocess(trainX);
  const trainZ = applyPreprocessBatch(trainX, pp);
  const calZ = applyPreprocessBatch(calX, pp);

  // 3) Class-balance weights derived from the SLOW window (published on the fit).
  const slowStartIdx = Math.max(0, trainZ.length - M3SE_SLOW_ROWS);
  const slowX = trainZ.slice(slowStartIdx);
  const slowY = trainY.slice(slowStartIdx);
  const slowCW = cappedClassWeights(slowY);
  const slowWeights = weightsForTargets(slowY, slowCW.green, slowCW.red);
  const slow = trainLogistic(slowX, slowY, {
    lambda: M3SE_SLOW_LAMBDA, maxIter: M3SE_MAX_ITER, tol: M3SE_TOL, sampleWeights: slowWeights,
  });

  // 4) Fast expert with recency × class weights.
  const fastStartIdx = Math.max(0, trainZ.length - M3SE_FAST_ROWS);
  const fastX = trainZ.slice(fastStartIdx);
  const fastY = trainY.slice(fastStartIdx);
  const fastCW = cappedClassWeights(fastY);
  const fastRec = recencyWeights(fastX.length, M3SE_FAST_HALF_LIFE);
  const fastWeights = weightsForTargets(fastY, fastCW.green, fastCW.red, fastRec);
  const fast = trainLogistic(fastX, fastY, {
    lambda: M3SE_FAST_LAMBDA, maxIter: M3SE_MAX_ITER, tol: M3SE_TOL, sampleWeights: fastWeights,
  });

  // 5) OOF loop — expanding window, strictly past-only.
  const oofSlow: number[] = new Array(trainZ.length).fill(NaN);
  const oofFast: number[] = new Array(trainZ.length).fill(NaN);
  let oofStartIdx = -1, oofEndIdx = -1;

  for (let s = M3SE_OOF_WARMUP_ROWS; s < trainZ.length; s += M3SE_OOF_BLOCK_SIZE) {
    const trainHead = trainZ.slice(0, s);
    const trainHeadY = trainY.slice(0, s);
    const sSlowStart = Math.max(0, s - M3SE_SLOW_ROWS);
    const sFastStart = Math.max(0, s - M3SE_FAST_ROWS);
    const iterSlowY = trainHeadY.slice(sSlowStart);
    const iterFastY = trainHeadY.slice(sFastStart);
    const iterSlowCW = cappedClassWeights(iterSlowY);
    const iterFastCW = cappedClassWeights(iterFastY);
    const iterSlowW = weightsForTargets(iterSlowY, iterSlowCW.green, iterSlowCW.red);
    const iterFastRec = recencyWeights(iterFastY.length, M3SE_FAST_HALF_LIFE);
    const iterFastW = weightsForTargets(iterFastY, iterFastCW.green, iterFastCW.red, iterFastRec);
    const mSlow = trainLogistic(trainHead.slice(sSlowStart), iterSlowY, {
      lambda: M3SE_SLOW_LAMBDA, maxIter: M3SE_MAX_ITER, tol: M3SE_TOL, sampleWeights: iterSlowW,
    });
    const mFast = trainLogistic(trainHead.slice(sFastStart), iterFastY, {
      lambda: M3SE_FAST_LAMBDA, maxIter: M3SE_MAX_ITER, tol: M3SE_TOL, sampleWeights: iterFastW,
    });
    const end = Math.min(trainZ.length, s + M3SE_OOF_BLOCK_SIZE);
    for (let i = s; i < end; i++) {
      const zRow = trainZ[i];
      oofSlow[i] = predictProb(zRow, mSlow);
      oofFast[i] = predictProb(zRow, mFast);
    }
    if (oofStartIdx < 0) oofStartIdx = s;
    oofEndIdx = end - 1;
  }

  if (oofStartIdx < 0) return { ok: false, reason: "oof_never_ran" };

  // 6) Direction stacker on OOF outputs (class weights, ridge = STACKER_LAMBDA).
  const stackerX: number[][] = [];
  const stackerY: number[] = [];
  const oofRowIdxs: number[] = [];
  for (let i = oofStartIdx; i <= oofEndIdx; i++) {
    if (!Number.isFinite(oofSlow[i]) || !Number.isFinite(oofFast[i])) continue;
    const rawRow = trainX[i];
    const sLogit = Math.log(oofSlow[i] / (1 - oofSlow[i]));
    const fLogit = Math.log(oofFast[i] / (1 - oofFast[i]));
    stackerX.push(stackerFeatureRow(rawRow, sLogit, fLogit));
    stackerY.push(trainY[i]);
    oofRowIdxs.push(i);
  }
  const stackerPp = fitPreprocess(stackerX);
  const stackerZ = applyPreprocessBatch(stackerX, stackerPp);
  const stackerCW = cappedClassWeights(stackerY);
  const stackerW = weightsForTargets(stackerY, stackerCW.green, stackerCW.red);
  const stackerFit = trainLogistic(stackerZ, stackerY, {
    lambda: M3SE_STACKER_LAMBDA, maxIter: M3SE_MAX_ITER, tol: M3SE_TOL, sampleWeights: stackerW,
  });
  // Bake preprocess into stacker weights so scorers don't need to re-standardize.
  const stackerFlat: LogisticModel = {
    w: stackerFit.w.map((wj, j) => wj / stackerPp.iqrs[j]),
    b: stackerFit.b - stackerFit.w.reduce((s, wj, j) => s + wj * stackerPp.medians[j] / stackerPp.iqrs[j], 0),
  };
  const stackerRaw = stackerX.map((r) => predictProb(r, stackerFlat));

  // 7) Platt calibration for direction (Platt fit on OOF; evaluated on calibration).
  const platt_direction = fitPlatt(stackerRaw.map((p) => Math.log(p / (1 - p))), stackerY);

  const calStackerX: number[][] = [];
  for (let i = 0; i < calZ.length; i++) {
    const pSlow = predictProb(calZ[i], slow);
    const pFast = predictProb(calZ[i], fast);
    const sLogit = Math.log(pSlow / (1 - pSlow));
    const fLogit = Math.log(pFast / (1 - pFast));
    calStackerX.push(stackerFeatureRow(calX[i], sLogit, fLogit));
  }
  const calStackerRaw = calStackerX.map((r) => predictProb(r, stackerFlat));
  const calStackerCalibrated = calStackerRaw.map((p) =>
    applyPlatt(Math.log(p / (1 - p)), platt_direction.a, platt_direction.b),
  );

  // 8) Selector inputs — OOF-side and calibration-side.
  const selectorRawX: number[][] = [];
  const selectorY: number[] = [];
  const selectorRawDirs: Array<"GREEN" | "RED"> = [];
  for (let k = 0; k < stackerX.length; k++) {
    const i = oofRowIdxs[k];
    const pDir = stackerRaw[k];
    const rawDir: "GREEN" | "RED" = pDir >= 0.5 ? "GREEN" : "RED";
    selectorRawDirs.push(rawDir);
    const zSlow = Math.log(oofSlow[i] / (1 - oofSlow[i]));
    const zFast = Math.log(oofFast[i] / (1 - oofFast[i]));
    const zStack = Math.log(pDir / (1 - pDir));
    const consensus = computeM3SEConsensus(rawDir, zSlow, zFast, zStack);
    selectorRawX.push(buildSelectorRowV2(trainX[i], rawDir, consensus));
    const correct = (rawDir === "GREEN" && trainY[i] === 1) || (rawDir === "RED" && trainY[i] === 0);
    selectorY.push(correct ? 1 : 0);
  }
  const selectorPp = fitPreprocess(selectorRawX);
  const selectorZ = applyPreprocessBatch(selectorRawX, selectorPp);
  const selectorCW = cappedClassWeights(selectorY);
  const selectorW = weightsForTargets(selectorY, selectorCW.green, selectorCW.red);

  const calSelectorRawX: number[][] = [];
  const calSelectorY: number[] = [];
  const calRawDirs: Array<"GREEN" | "RED"> = [];
  for (let i = 0; i < calStackerCalibrated.length; i++) {
    const rawDir: "GREEN" | "RED" = calStackerCalibrated[i] >= 0.5 ? "GREEN" : "RED";
    calRawDirs.push(rawDir);
    const zSlow = Math.log(predictProb(calZ[i], slow) / (1 - predictProb(calZ[i], slow)));
    const zFast = Math.log(predictProb(calZ[i], fast) / (1 - predictProb(calZ[i], fast)));
    const zStack = Math.log(calStackerRaw[i] / (1 - calStackerRaw[i]));
    const consensus = computeM3SEConsensus(rawDir, zSlow, zFast, zStack);
    calSelectorRawX.push(buildSelectorRowV2(calX[i], rawDir, consensus));
    const correct = (rawDir === "GREEN" && calY[i] === 1) || (rawDir === "RED" && calY[i] === 0);
    calSelectorY.push(correct ? 1 : 0);
  }

  // 9) Selector penalty grid search — evaluate on the calibration set
  //    (chronologically forward from OOF training rows).
  const lambdaSearch: Array<{ lambda: number; roc_auc: number; brier: number }> = [];
  let bestLambda: number = M3SE_SELECTOR_LAMBDA_GRID[0];
  let bestSelector: LogisticModel | null = null;
  let bestAuc = -Infinity;
  let bestBrier = Infinity;
  for (const lam of M3SE_SELECTOR_LAMBDA_GRID) {
    const inner = trainLogistic(selectorZ, selectorY, {
      lambda: lam, maxIter: M3SE_MAX_ITER, tol: M3SE_TOL, sampleWeights: selectorW,
    });
    const flat: LogisticModel = {
      w: inner.w.map((wj, j) => wj / selectorPp.iqrs[j]),
      b: inner.b - inner.w.reduce((s, wj, j) => s + wj * selectorPp.medians[j] / selectorPp.iqrs[j], 0),
    };
    const calScores = calSelectorRawX.map((r) => predictProb(r, flat));
    const auc = rocAuc(calScores, calSelectorY);
    const bri = brier(calScores, calSelectorY);
    lambdaSearch.push({ lambda: lam, roc_auc: auc, brier: bri });
    if (auc > bestAuc + 1e-9 || (Math.abs(auc - bestAuc) < 1e-9 && bri < bestBrier)) {
      bestAuc = auc; bestBrier = bri; bestLambda = lam; bestSelector = flat;
    }
  }
  if (!bestSelector) return { ok: false, reason: "selector_grid_failed" };
  const selector = bestSelector;

  // 10) Selector raw score distributions.
  const selectorRawTrain = selectorRawX.map((r) => predictProb(r, selector));
  const selectorRawCal = calSelectorRawX.map((r) => predictProb(r, selector));

  // Platt for correctness (diagnostics only).
  const platt_correctness = fitPlatt(selectorRawTrain.map((p) => Math.log(p / (1 - p))), selectorY);
  const calSelectorCalibrated = selectorRawCal.map((p) =>
    applyPlatt(Math.log(p / (1 - p)), platt_correctness.a, platt_correctness.b),
  );

  // 11) Threshold = P40 of calibration selector_score_raw (top 60%).
  const sortedCal = [...selectorRawCal].sort((a, b) => a - b);
  const quantileThreshold = quantile(sortedCal, 1 - M3SE_TARGET_COVERAGE);
  const selection_threshold = Math.max(M3SE_MIN_SELECTION_THRESHOLD, quantileThreshold);
  const selector_estimated_coverage =
    selectorRawCal.filter((p) => p >= selection_threshold).length / Math.max(1, selectorRawCal.length);

  // 11b) R3 publish gate — direction strength = |logit(p_green_stacked_calibrated)|.
  const calDirectionStrengths = calStackerCalibrated.map((p) => directionStrengthFromP(p));
  const sortedCalDs = [...calDirectionStrengths].sort((a, b) => a - b);
  const direction_strength_threshold = quantile(sortedCalDs, M3SE_DIRECTION_STRENGTH_PERCENTILE);
  const calibration_estimated_coverage =
    calDirectionStrengths.filter((v) => v >= direction_strength_threshold).length /
    Math.max(1, calDirectionStrengths.length);

  // 12) Diagnostics.
  const oof_direction_accuracy = accuracy(stackerRaw, stackerY);
  const oof_direction_balanced_accuracy = balancedAccuracy(stackerRaw, stackerY);
  const oof_direction_brier = brier(stackerRaw, stackerY);
  const oof_direction_log_loss = logLoss(stackerRaw, stackerY);
  const calibration_direction_accuracy = accuracy(calStackerCalibrated, calY);
  const calibration_direction_balanced_accuracy = balancedAccuracy(calStackerCalibrated, calY);
  const calibration_direction_brier = brier(calStackerCalibrated, calY);
  const calibration_direction_log_loss = logLoss(calStackerCalibrated, calY);
  const predicted_green_share = calRawDirs.filter((d) => d === "GREEN").length / Math.max(1, calRawDirs.length);
  const predicted_red_share = 1 - predicted_green_share;

  const selector_roc_auc = rocAuc(selectorRawCal, calSelectorY);
  const selector_pr_auc = prAuc(selectorRawCal, calSelectorY);
  const selector_brier = brier(calSelectorCalibrated, calSelectorY);
  const selector_log_loss = logLoss(calSelectorCalibrated, calSelectorY);

  // Selector rank-band accuracies on calibration.
  const bandAccuracy = (topFrac: number, bottom = false): number => {
    if (selectorRawCal.length === 0) return 0;
    const idxs = selectorRawCal.map((v, i) => ({ v, i })).sort((a, b) => b.v - a.v);
    const k = Math.max(1, Math.round(selectorRawCal.length * topFrac));
    const chosen = bottom ? idxs.slice(-k) : idxs.slice(0, k);
    let c = 0;
    for (const x of chosen) if (calSelectorY[x.i] === 1) c++;
    return c / chosen.length;
  };
  const selector_top20_accuracy = bandAccuracy(0.20);
  const selector_top40_accuracy = bandAccuracy(0.40);
  const selector_top60_accuracy = bandAccuracy(0.60);
  const selector_bottom40_accuracy = bandAccuracy(0.40, true);
  const rawAcc = calSelectorY.reduce((a, v) => a + v, 0) / Math.max(1, calSelectorY.length);
  const selector_top60_lift_vs_raw = selector_top60_accuracy - rawAcc;
  const selector_top60_lift_vs_bottom40 = selector_top60_accuracy - selector_bottom40_accuracy;

  // 13) Validation gates.
  const allFinite = (arr: number[]) => arr.every((v) => Number.isFinite(v));
  if (!allFinite(slow.w) || !Number.isFinite(slow.b) ||
      !allFinite(fast.w) || !Number.isFinite(fast.b) ||
      !allFinite(stackerFlat.w) || !Number.isFinite(stackerFlat.b) ||
      !allFinite(selector.w) || !Number.isFinite(selector.b)) {
    return { ok: false, reason: "non_finite_coefficients" };
  }
  if (calibration_estimated_coverage < M3SE_MIN_ESTIMATED_COVERAGE ||
      calibration_estimated_coverage > M3SE_MAX_ESTIMATED_COVERAGE) {
    return { ok: false, reason: `estimated_coverage_${calibration_estimated_coverage.toFixed(3)}_outside_[${M3SE_MIN_ESTIMATED_COVERAGE},${M3SE_MAX_ESTIMATED_COVERAGE}]` };
  }
  const uniqDir = new Set(calStackerCalibrated.map((v) => Math.round(v * 10000)));
  if (uniqDir.size < 5) return { ok: false, reason: "direction_probabilities_constant" };
  const uniqSel = new Set(selectorRawCal.map((v) => Math.round(v * 10000)));
  if (uniqSel.size < 5) return { ok: false, reason: "selector_scores_constant" };

  const artifact: M3SEArtifact = {
    model_version: M3SE_MODEL_VERSION,
    feature_schema_version: M3SE_FEATURE_SCHEMA_VERSION,
    preprocess: pp,
    slow, fast,
    stacker: stackerFlat,
    selector,
    platt_direction,
    platt_correctness,
    selection_threshold,
    calibration_selector_scores_sorted: sortedCal,
    direction_strength_threshold,
    calibration_direction_strengths_sorted: sortedCalDs,
    green_class_weight: slowCW.green,
    red_class_weight: slowCW.red,
    fast_half_life: M3SE_FAST_HALF_LIFE,
  };
  const fit_id = stableFitId(artifact, trainZ.length);
  const feature_schema_hash = hashFeatureSchema();
  const artifact_hash = hashArtifact(artifact);

  return {
    ok: true,
    fit_id,
    artifact,
    windows: {
      slow_start_ts: trainTs[slowStartIdx] ?? trainTs[0],
      slow_end_ts: trainTs[trainTs.length - 1] ?? "",
      slow_rows: slowX.length,
      fast_start_ts: trainTs[fastStartIdx] ?? trainTs[0],
      fast_end_ts: trainTs[trainTs.length - 1] ?? "",
      fast_rows: fastX.length,
      oof_start_ts: trainTs[oofStartIdx] ?? trainTs[0],
      oof_end_ts: trainTs[oofEndIdx] ?? trainTs[trainTs.length - 1],
      oof_rows: stackerX.length,
      oof_block_size: M3SE_OOF_BLOCK_SIZE,
      calibration_start_ts: calTs[0] ?? "",
      calibration_end_ts: calTs[calTs.length - 1] ?? "",
      calibration_rows: calX.length,
    },
    diagnostics: {
      oof_direction_accuracy,
      oof_direction_balanced_accuracy,
      oof_direction_brier,
      oof_direction_log_loss,
      calibration_direction_accuracy,
      calibration_direction_balanced_accuracy,
      calibration_direction_brier,
      calibration_direction_log_loss,
      predicted_green_share,
      predicted_red_share,
      selector_roc_auc,
      selector_pr_auc,
      selector_brier,
      selector_log_loss,
      selector_top20_accuracy,
      selector_top40_accuracy,
      selector_top60_accuracy,
      selector_bottom40_accuracy,
      selector_top60_lift_vs_raw,
      selector_top60_lift_vs_bottom40,
      target_coverage: M3SE_TARGET_COVERAGE,
      calibration_estimated_coverage,
      selector_score_calibration_min: sortedCal[0] ?? 0,
      selector_score_calibration_median: quantile(sortedCal, 0.5),
      selector_score_calibration_p40: quantile(sortedCal, 0.4),
      selector_score_calibration_p60: quantile(sortedCal, 0.6),
      selector_score_calibration_max: sortedCal[sortedCal.length - 1] ?? 0,
      direction_strength_calibration_min: sortedCalDs[0] ?? 0,
      direction_strength_calibration_median: quantile(sortedCalDs, 0.5),
      direction_strength_calibration_p65: quantile(sortedCalDs, 0.65),
      direction_strength_calibration_p70: quantile(sortedCalDs, 0.70),
      direction_strength_calibration_max: sortedCalDs[sortedCalDs.length - 1] ?? 0,
      selector_estimated_coverage,
      slow_lambda: M3SE_SLOW_LAMBDA,
      fast_lambda: M3SE_FAST_LAMBDA,
      stacker_lambda: M3SE_STACKER_LAMBDA,
      selector_lambda: bestLambda,
      selector_lambda_search: lambdaSearch,
      training_green_count: slowCW.nGreen,
      training_red_count: slowCW.nRed,
      green_class_weight: slowCW.green,
      red_class_weight: slowCW.red,
      fast_half_life: M3SE_FAST_HALF_LIFE,
    },
    hashes: { feature_schema_hash, artifact_hash },
  };
}

/** R2 score result. */
export interface M3SEScoreResult {
  pSlow: number;
  pFast: number;
  slowLogit: number;
  fastLogit: number;
  pStackedRaw: number;
  pStackedCalibrated: number;
  rawDir: "GREEN" | "RED";
  rawConfidence: number;
  consensus: M3SEConsensus;
  selectorRowV2: number[];
  selectorScoreRaw: number;      // pre-Platt selector probability (rank score)
  selectorScorePercentile: number; // percentile of raw score in calibration distribution
  pCorrectRaw: number;
  pCorrectCalibrated: number;
  directionStrength: number;
  directionStrengthThreshold: number;
  directionStrengthPercentile: number;
}

function percentileOf(sorted: number[], v: number): number {
  if (sorted.length === 0) return 0.5;
  // Binary search for insertion point.
  let lo = 0, hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid] <= v) lo = mid + 1; else hi = mid;
  }
  return lo / sorted.length;
}

export function scoreM3SE(rawFeatureRow: number[], art: M3SEArtifact): M3SEScoreResult {
  const z = applyPreprocess(rawFeatureRow, art.preprocess);
  const pSlow = predictProb(z, art.slow);
  const pFast = predictProb(z, art.fast);
  const slowLogit = Math.log(pSlow / (1 - pSlow));
  const fastLogit = Math.log(pFast / (1 - pFast));
  const stackerRow = [
    slowLogit, fastLogit,
    rawFeatureRow[15], rawFeatureRow[19], rawFeatureRow[9],
  ];
  const pStackedRaw = predictProb(stackerRow, art.stacker);
  const pStackedCalibrated = applyPlatt(
    Math.log(pStackedRaw / (1 - pStackedRaw)),
    art.platt_direction.a, art.platt_direction.b,
  );
  const rawDir: "GREEN" | "RED" = pStackedCalibrated >= 0.5 ? "GREEN" : "RED";
  const stackerLogit = Math.log(pStackedRaw / (1 - pStackedRaw));
  const consensus = computeM3SEConsensus(rawDir, slowLogit, fastLogit, stackerLogit);
  const selectorRowV2 = buildSelectorRowV2(rawFeatureRow, rawDir, consensus);
  const selectorScoreRaw = predictProb(selectorRowV2, art.selector);
  const selectorScorePercentile = percentileOf(art.calibration_selector_scores_sorted, selectorScoreRaw);
  const directionStrength = directionStrengthFromP(pStackedCalibrated);
  const pCorrectRaw = selectorScoreRaw;
  const pCorrectCalibrated = applyPlatt(
    Math.log(pCorrectRaw / (1 - pCorrectRaw)),
    art.platt_correctness.a, art.platt_correctness.b,
  );
  return {
    pSlow, pFast, slowLogit, fastLogit,
    pStackedRaw, pStackedCalibrated,
    rawDir,
    rawConfidence: Math.max(pStackedCalibrated, 1 - pStackedCalibrated),
    consensus,
    selectorRowV2,
    selectorScoreRaw,
    selectorScorePercentile,
    pCorrectRaw,
    pCorrectCalibrated,
    directionStrength,
    directionStrengthThreshold: art.direction_strength_threshold ?? 0,
    directionStrengthPercentile: percentileOf(
      art.calibration_direction_strengths_sorted ?? [], directionStrength,
    ),
  };
}
