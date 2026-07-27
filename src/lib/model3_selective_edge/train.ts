// End-to-end training pipeline for m3-se-r1.
// Chronological, no leakage. Returns a full serializable artifact + diagnostics.

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
  M3SE_SLOW_LAMBDA,
  M3SE_FAST_LAMBDA,
  M3SE_STACKER_LAMBDA,
  M3SE_SELECTOR_LAMBDA,
  M3SE_MAX_ITER,
  M3SE_TOL,
  M3SE_TARGET_COVERAGE,
  M3SE_MIN_SELECTION_THRESHOLD,
  M3SE_MIN_ESTIMATED_COVERAGE,
  M3SE_MAX_ESTIMATED_COVERAGE,
} from "./config";
import {
  M3SE_FEATURE_NAMES,
  M3SE_ALIGNED_FEATURE_NAMES,
  buildAlignedFromDirection,
} from "./features";
import { fitPreprocess, applyPreprocessBatch, applyPreprocess, type Preprocess } from "./preprocess";
import {
  trainLogistic,
  predictLogit,
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
    oof_direction_brier: number;
    oof_direction_log_loss: number;
    calibration_direction_accuracy: number;
    calibration_direction_brier: number;
    calibration_direction_log_loss: number;
    selector_roc_auc: number;
    selector_pr_auc: number;
    selector_brier: number;
    selector_log_loss: number;
    target_coverage: number;
    estimated_coverage: number;
    slow_lambda: number;
    fast_lambda: number;
    stacker_lambda: number;
    selector_lambda: number;
  };
  hashes: { feature_schema_hash: string; artifact_hash: string };
}

export type M3SEFitFail = { ok: false; reason: string };

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
  return `m3se_${nTrain}_${h.digest("hex").slice(0, 12)}`;
}

function hashArtifact(a: M3SEArtifact): string {
  return createHash("sha256").update(JSON.stringify(a)).digest("hex").slice(0, 16);
}
function hashFeatureSchema(): string {
  return createHash("sha256")
    .update([...M3SE_FEATURE_NAMES, "|", ...M3SE_ALIGNED_FEATURE_NAMES].join(","))
    .digest("hex")
    .slice(0, 16);
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, (sorted.length - 1) * q));
  const lo = Math.floor(idx), hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - idx) + sorted[hi] * (idx - lo);
}

function accuracy(p: number[], y: number[]): number {
  let c = 0; for (let i = 0; i < p.length; i++) if ((p[i] >= 0.5 ? 1 : 0) === y[i]) c++;
  return p.length ? c / p.length : 0;
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

/** Stacker features: [slow_logit, fast_logit, realized_vol, trend_eff_32, ema9-21] */
function stackerFeatureRow(
  featureRow: number[], // raw (unscaled) feature vector
  slowLogit: number,
  fastLogit: number,
): number[] {
  return [
    slowLogit,
    fastLogit,
    featureRow[15], // realized_volatility_8_to_32
    featureRow[19], // trend_efficiency_32
    featureRow[9],  // ema9_minus_ema21_to_atr
  ];
}

export function trainM3SE(
  X: number[][],
  y: number[],
  rowTimestamps: string[],
): M3SEFitResult | M3SEFitFail {
  const N = X.length;
  if (N < M3SE_MIN_LABELED_ROWS) {
    return { ok: false, reason: `insufficient_labeled_rows:${N}<${M3SE_MIN_LABELED_ROWS}` };
  }

  // -------- 1) Chronological split --------------------------------------
  // Reserve calibration at the tail. Everything before that is training pool.
  const calStart = N - M3SE_CAL_ROWS;
  const trainX = X.slice(0, calStart);
  const trainY = y.slice(0, calStart);
  const trainTs = rowTimestamps.slice(0, calStart);
  const calX = X.slice(calStart);
  const calY = y.slice(calStart);
  const calTs = rowTimestamps.slice(calStart);

  // -------- 2) Preprocess (fit on training pool only) --------------------
  const pp = fitPreprocess(trainX);
  const trainZ = applyPreprocessBatch(trainX, pp);
  const calZ = applyPreprocessBatch(calX, pp);

  // -------- 3) Direction experts (final fits) ----------------------------
  // Slow expert: last M3SE_SLOW_ROWS of the training pool.
  const slowStartIdx = Math.max(0, trainZ.length - M3SE_SLOW_ROWS);
  const slowX = trainZ.slice(slowStartIdx);
  const slowY = trainY.slice(slowStartIdx);
  const slow = trainLogistic(slowX, slowY, { lambda: M3SE_SLOW_LAMBDA, maxIter: M3SE_MAX_ITER, tol: M3SE_TOL });

  const fastStartIdx = Math.max(0, trainZ.length - M3SE_FAST_ROWS);
  const fastX = trainZ.slice(fastStartIdx);
  const fastY = trainY.slice(fastStartIdx);
  const fast = trainLogistic(fastX, fastY, { lambda: M3SE_FAST_LAMBDA, maxIter: M3SE_MAX_ITER, tol: M3SE_TOL });

  // -------- 4) OOF loop: expanding-window blocks -------------------------
  // For each block of M3SE_OOF_BLOCK_SIZE rows starting at OOF_WARMUP_ROWS,
  // fit slow/fast on rows [0..start), then score rows [start..start+block).
  const oofSlow: number[] = new Array(trainZ.length).fill(NaN);
  const oofFast: number[] = new Array(trainZ.length).fill(NaN);
  const oofStackerRaw: number[] = new Array(trainZ.length).fill(NaN);
  let oofStartIdx = -1, oofEndIdx = -1;

  for (let s = M3SE_OOF_WARMUP_ROWS; s < trainZ.length; s += M3SE_OOF_BLOCK_SIZE) {
    const trainHead = trainZ.slice(0, s);
    const trainHeadY = trainY.slice(0, s);
    const sSlowStart = Math.max(0, s - M3SE_SLOW_ROWS);
    const sFastStart = Math.max(0, s - M3SE_FAST_ROWS);
    const mSlow = trainLogistic(
      trainHead.slice(sSlowStart), trainHeadY.slice(sSlowStart),
      { lambda: M3SE_SLOW_LAMBDA, maxIter: M3SE_MAX_ITER, tol: M3SE_TOL },
    );
    const mFast = trainLogistic(
      trainHead.slice(sFastStart), trainHeadY.slice(sFastStart),
      { lambda: M3SE_FAST_LAMBDA, maxIter: M3SE_MAX_ITER, tol: M3SE_TOL },
    );
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

  // -------- 5) Direction stacker on OOF outputs --------------------------
  const stackerX: number[][] = [];
  const stackerY: number[] = [];
  const oofRowIdxs: number[] = [];
  for (let i = oofStartIdx; i <= oofEndIdx; i++) {
    if (!Number.isFinite(oofSlow[i]) || !Number.isFinite(oofFast[i])) continue;
    const rawRow = trainX[i]; // unscaled features for direct feature access
    const sLogit = Math.log(oofSlow[i] / (1 - oofSlow[i]));
    const fLogit = Math.log(oofFast[i] / (1 - oofFast[i]));
    stackerX.push(stackerFeatureRow(rawRow, sLogit, fLogit));
    stackerY.push(trainY[i]);
    oofRowIdxs.push(i);
  }
  // Standardize stacker features via a lightweight preprocess (median/IQR).
  const stackerPp = fitPreprocess(stackerX);
  const stackerZ = applyPreprocessBatch(stackerX, stackerPp);
  const stacker = trainLogistic(stackerZ, stackerY, {
    lambda: M3SE_STACKER_LAMBDA, maxIter: M3SE_MAX_ITER, tol: M3SE_TOL,
  });

  // Bake stacker preprocess INTO stacker weights so downstream code doesn't
  // need to re-standardize. Since z = (raw - med) / iqr, we substitute:
  //   b' = b - Σ w_j * med_j / iqr_j
  //   w'_j = w_j / iqr_j
  const stackerFlat: LogisticModel = {
    w: stacker.w.map((wj, j) => wj / stackerPp.iqrs[j]),
    b: stacker.b - stacker.w.reduce((s, wj, j) => s + wj * stackerPp.medians[j] / stackerPp.iqrs[j], 0),
  };

  const stackerRaw: number[] = [];
  for (let i = 0; i < stackerX.length; i++) stackerRaw.push(predictProb(stackerX[i], stackerFlat));

  // -------- 6) Platt calibration for direction ---------------------------
  // Fit on OOF training-side outputs, then evaluate on hold-out calibration.
  const platt_direction = fitPlatt(stackerRaw.map((p) => Math.log(p / (1 - p))), stackerY);

  const calStackerX: number[][] = [];
  for (let i = 0; i < calZ.length; i++) {
    const zRow = calZ[i];
    const rawRow = calX[i];
    const pSlow = predictProb(zRow, slow);
    const pFast = predictProb(zRow, fast);
    const sLogit = Math.log(pSlow / (1 - pSlow));
    const fLogit = Math.log(pFast / (1 - pFast));
    calStackerX.push(stackerFeatureRow(rawRow, sLogit, fLogit));
  }
  const calStackerRaw = calStackerX.map((r) => predictProb(r, stackerFlat));
  const calStackerCalibrated = calStackerRaw.map((p) => applyPlatt(Math.log(p / (1 - p)), platt_direction.a, platt_direction.b));

  // -------- 7) Correctness selector --------------------------------------
  // Train on OOF rows: label = 1 if raw stacked prediction matched y.
  const selectorX: number[][] = [];
  const selectorY: number[] = [];
  for (let k = 0; k < stackerX.length; k++) {
    const i = oofRowIdxs[k];
    const pDir = stackerRaw[k];
    const rawDir: "GREEN" | "RED" = pDir >= 0.5 ? "GREEN" : "RED";
    const correct = (rawDir === "GREEN" && trainY[i] === 1) || (rawDir === "RED" && trainY[i] === 0);
    // Use RAW feature vector (unscaled) for alignment; then preprocess after.
    selectorX.push(buildAlignedFromDirection(trainX[i], rawDir));
    selectorY.push(correct ? 1 : 0);
  }
  const selectorPp = fitPreprocess(selectorX);
  const selectorZ = applyPreprocessBatch(selectorX, selectorPp);
  const selectorInner = trainLogistic(selectorZ, selectorY, {
    lambda: M3SE_SELECTOR_LAMBDA, maxIter: M3SE_MAX_ITER, tol: M3SE_TOL,
  });
  const selector: LogisticModel = {
    w: selectorInner.w.map((wj, j) => wj / selectorPp.iqrs[j]),
    b: selectorInner.b - selectorInner.w.reduce(
      (s, wj, j) => s + wj * selectorPp.medians[j] / selectorPp.iqrs[j], 0,
    ),
  };

  const selectorRaw: number[] = selectorX.map((r) => predictProb(r, selector));

  // -------- 8) Platt for selector, threshold on calibration --------------
  const platt_correctness = fitPlatt(selectorRaw.map((p) => Math.log(p / (1 - p))), selectorY);

  // Build calibration selector inputs from calibrated direction preds.
  const calSelectorX: number[][] = [];
  const calSelectorY: number[] = [];
  for (let i = 0; i < calStackerCalibrated.length; i++) {
    const rawDir: "GREEN" | "RED" = calStackerCalibrated[i] >= 0.5 ? "GREEN" : "RED";
    calSelectorX.push(buildAlignedFromDirection(calX[i], rawDir));
    const correct = (rawDir === "GREEN" && calY[i] === 1) || (rawDir === "RED" && calY[i] === 0);
    calSelectorY.push(correct ? 1 : 0);
  }
  const calSelectorRaw = calSelectorX.map((r) => predictProb(r, selector));
  const calSelectorCalibrated = calSelectorRaw.map((p) =>
    applyPlatt(Math.log(p / (1 - p)), platt_correctness.a, platt_correctness.b),
  );

  // Threshold = Q_{1-targetCoverage}(pCorrectCalibration). This is a coverage
  // rank threshold, not a hard 50% correctness probability gate.
  const sortedCal = [...calSelectorCalibrated].sort((a, b) => a - b);
  const q = quantile(sortedCal, 1 - M3SE_TARGET_COVERAGE);
  const selection_threshold = Math.max(M3SE_MIN_SELECTION_THRESHOLD, q);
  const estimated_coverage = calSelectorCalibrated.filter((p) => p >= selection_threshold).length / Math.max(1, calSelectorCalibrated.length);

  // -------- 9) Diagnostics + validation gates ----------------------------
  const oof_direction_accuracy = accuracy(stackerRaw, stackerY);
  const oof_direction_brier = brier(stackerRaw, stackerY);
  const oof_direction_log_loss = logLoss(stackerRaw, stackerY);
  const calibration_direction_accuracy = accuracy(calStackerCalibrated, calY);
  const calibration_direction_brier = brier(calStackerCalibrated, calY);
  const calibration_direction_log_loss = logLoss(calStackerCalibrated, calY);
  const selector_roc_auc = rocAuc(calSelectorCalibrated, calSelectorY);
  const selector_pr_auc = prAuc(calSelectorCalibrated, calSelectorY);
  const selector_brier = brier(calSelectorCalibrated, calSelectorY);
  const selector_log_loss = logLoss(calSelectorCalibrated, calSelectorY);

  // Validation §14
  const allFinite = (arr: number[]) => arr.every((v) => Number.isFinite(v));
  if (!allFinite(slow.w) || !Number.isFinite(slow.b) ||
      !allFinite(fast.w) || !Number.isFinite(fast.b) ||
      !allFinite(stackerFlat.w) || !Number.isFinite(stackerFlat.b) ||
      !allFinite(selector.w) || !Number.isFinite(selector.b)) {
    return { ok: false, reason: "non_finite_coefficients" };
  }
  if (estimated_coverage < M3SE_MIN_ESTIMATED_COVERAGE || estimated_coverage > M3SE_MAX_ESTIMATED_COVERAGE) {
    return { ok: false, reason: `estimated_coverage_${estimated_coverage.toFixed(3)}_outside_[${M3SE_MIN_ESTIMATED_COVERAGE},${M3SE_MAX_ESTIMATED_COVERAGE}]` };
  }
  // Non-constant probs
  const uniq = new Set(calStackerCalibrated.map((v) => Math.round(v * 10000)));
  if (uniq.size < 5) return { ok: false, reason: "direction_probabilities_constant" };

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
      oof_direction_brier,
      oof_direction_log_loss,
      calibration_direction_accuracy,
      calibration_direction_brier,
      calibration_direction_log_loss,
      selector_roc_auc,
      selector_pr_auc,
      selector_brier,
      selector_log_loss,
      target_coverage: M3SE_TARGET_COVERAGE,
      estimated_coverage,
      slow_lambda: M3SE_SLOW_LAMBDA,
      fast_lambda: M3SE_FAST_LAMBDA,
      stacker_lambda: M3SE_STACKER_LAMBDA,
      selector_lambda: M3SE_SELECTOR_LAMBDA,
    },
    hashes: { feature_schema_hash, artifact_hash },
  };
}

/** Score one live raw feature row using the artifact. Returns everything the
 *  prediction row needs. */
export function scoreM3SE(rawFeatureRow: number[], art: M3SEArtifact) {
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
  const alignedRow = buildAlignedFromDirection(rawFeatureRow, rawDir);
  const pCorrectRaw = predictProb(alignedRow, art.selector);
  const pCorrectCalibrated = applyPlatt(
    Math.log(pCorrectRaw / (1 - pCorrectRaw)),
    art.platt_correctness.a, art.platt_correctness.b,
  );
  return {
    pSlow, pFast, slowLogit, fastLogit,
    pStackedRaw, pStackedCalibrated,
    rawDir,
    rawConfidence: Math.max(pStackedCalibrated, 1 - pStackedCalibrated),
    alignedRow,
    pCorrectRaw, pCorrectCalibrated,
  };
}
