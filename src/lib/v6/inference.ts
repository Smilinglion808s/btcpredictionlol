// V6 — frozen inference engine.
//
// Direct port of the supplied reference implementation (`v6_reference_inference.ts`).
// The numerical source of truth is `model.json` (V6_complete_model.json), which
// must never be retrained, rounded, simplified, or reinterpreted.

import modelJson from "./model.json";

export type Direction = "GREEN" | "RED" | "ABSTAIN";
export type FinalDirection = Direction | "OP_FAIL";
export type Actual = "GREEN" | "RED" | "PUSH";

export type TechnicalRow = Record<string, number | string | boolean | null | undefined>;

export type PredictionSource =
  | "V6_BASE"
  | "CONSENSUS_RED_PICKUP"
  | "MOMENTUM_EXPANSION_GREEN_PICKUP"
  | "ABSTAIN";

export interface V6State {
  /** Prior eligible BASE V6 predictions only, before overlay rules. */
  priorBasePredictions: Direction[];
}

export interface V6Inference {
  ridgeFeatures: Record<string, number>;
  gbFeatures: Record<string, number>;
  imputedFeatures: Array<{ feature: string; original: number | null }>;
  ridgePGreen: number;
  ridgePercentile: number;
  gbPGreen: number;
  gbPercentile: number;
  broadScore: number;
  broadPercentile: number;
  anchorScore: number;
  anchorPercentile: number;
  finalScore: number;
  basePrediction: Direction;
  basePredictionsLast8: Direction[];
  baseGreenCountLast8: number;
  saturationVetoEvaluable: boolean;
  saturationVetoTriggered: boolean;
  redPickupEvaluable: boolean;
  redPickupTriggered: boolean;
  greenPickupEvaluable: boolean;
  greenPickupTriggered: boolean;
  pickupConflict: boolean;
  preWeakRedVetoPrediction: Direction;
  predictionSource: PredictionSource;
  weakBroadRedVetoEvaluable: boolean;
  weakBroadRedVetoTriggered: boolean;
  finalPrediction: Direction;
  abstainReason: string | null;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Model = any;

export const V6_MODEL: Model = modelJson as unknown as Model;
export const V6_MODEL_NAME = "V6";
export const V6_RED_THRESHOLD: number = V6_MODEL.calibration.red_threshold;
export const V6_GREEN_THRESHOLD: number = V6_MODEL.calibration.green_threshold;

const DIRECT_FEATURES = [
  "body_pct_of_range","upper_wick_pct","lower_wick_pct","close_position_in_range",
  "change_pct","dist_from_ema9_pct","dist_from_ema21_pct","dist_from_ema50_pct",
  "close_slope_8","atr14_pct","range_expansion_vs_avg20","bb_width_pct","bb_position",
  "rsi14","macd_hist_over_atr14","roc_4","roc_8","momentum_8_over_atr","stoch_k14",
  "stoch_d3","channel_width_pct","channel_position_0_1","dist_to_high20_pct",
  "dist_to_low20_pct","volume_expansion","vol_zscore_20","dist_from_vwap20_pct",
  "path_efficiency_4","aligned_wick_pressure_4","dist_from_4_candle_low_bps",
  "dist_from_4_candle_high_bps","mean_body_to_range_2","same_color_streak",
  "higher_low_sequence_4","lower_high_sequence_4","failed_breakout_up",
  "failed_breakout_down","bullish_liquidity_sweep","bearish_liquidity_sweep",
  "inside_bar","outside_bar",
] as const;

function asNumber(value: unknown): number {
  if (typeof value === "boolean") return value ? 1 : 0;
  const result = Number(value);
  return Number.isFinite(result) ? result : Number.NaN;
}

function safeDivide(numerator: number, denominator: number): number {
  return Number.isFinite(numerator) && Number.isFinite(denominator) && denominator !== 0
    ? numerator / denominator
    : Number.NaN;
}

function sign(value: number): number {
  return value > 0 ? 1 : value < 0 ? -1 : 0;
}

function sigmoid(value: number): number {
  if (value >= 0) {
    const z = Math.exp(-value);
    return 1 / (1 + z);
  }
  const z = Math.exp(value);
  return z / (1 + z);
}

/** Right-inclusive empirical CDF: count(sortedValue <= value) / N. */
export function empiricalPercentile(sortedValues: number[], value: number): number {
  let low = 0;
  let high = sortedValues.length;
  while (low < high) {
    const mid = Math.floor((low + high) / 2);
    if (sortedValues[mid] <= value) low = mid + 1;
    else high = mid;
  }
  return low / sortedValues.length;
}

function directionNumber(direction: unknown): number {
  return direction === "GREEN" ? 1 : direction === "RED" ? -1 : 0;
}

function alignmentNumber(alignment: unknown): number {
  return alignment === "UP" ? 1 : alignment === "DOWN" ? -1 : 0;
}

export function buildBaseFeatures(row: TechnicalRow): Record<string, number> {
  const f: Record<string, number> = {};
  for (const name of DIRECT_FEATURES) f[name] = asNumber(row[name]);

  const open = asNumber(row.open);
  const close = asNumber(row.close);
  const range = asNumber(row.range);
  const trueRange = asNumber(row.true_range);
  const gap = asNumber(row.gap_from_prev_close);
  const previousClose = open - gap;
  const atr14 = asNumber(row.atr14);
  const direction = directionNumber(row.direction);
  const alignment = alignmentNumber(row.ema_alignment);

  f.range_pct_close = safeDivide(range, close) * 100;
  f.true_range_pct_close = safeDivide(trueRange, close) * 100;
  f.gap_bps = safeDivide(gap, previousClose) * 10_000;
  f.ema9_21_pct = safeDivide(asNumber(row.ema9_minus_ema21), close) * 100;
  f.ema21_50_pct = safeDivide(asNumber(row.ema21_minus_ema50), close) * 100;
  f.stdev20_pct = safeDivide(asNumber(row.stdev_close_20), close) * 100;
  f.macd_line_atr = safeDivide(asNumber(row.macd_line), atr14);
  f.macd_signal_atr = safeDivide(asNumber(row.macd_signal), atr14);
  f.cum_vol_delta_to_avg = safeDivide(
    asNumber(row.cum_volume_delta_20),
    asNumber(row.vol_avg_20),
  );
  f.net_disp4_atr = safeDivide(asNumber(row.net_displacement_4), atr14);
  f.total_body_path4_atr = safeDivide(asNumber(row.total_body_path_4), atr14);
  f.log_volume = Math.log1p(asNumber(row.volume));
  f.trend_age_log = Math.log1p(asNumber(row.trend_age_candles));
  f.prior_direction = direction;
  f.ema_align_up = row.ema_alignment === "UP" ? 1 : 0;
  f.ema_align_down = row.ema_alignment === "DOWN" ? 1 : 0;

  for (const zone of ["support_edge", "lower_mid", "middle", "upper_mid", "resistance_edge"]) {
    f[`zone_${zone}`] = row.channel_zone === zone ? 1 : 0;
  }

  f.wick_asymmetry = f.lower_wick_pct - f.upper_wick_pct;
  f.body_signed = f.body_pct_of_range * direction;
  f.volume_signed_expansion = f.volume_expansion * direction;
  f.stoch_spread = (f.stoch_k14 - f.stoch_d3) / 100;
  f.structure_asym_bps = f.dist_from_4_candle_low_bps - f.dist_from_4_candle_high_bps;
  f.trend_momentum_agreement = alignment * f.momentum_8_over_atr;
  f.trend_macd_agreement = alignment * f.macd_hist_over_atr14;
  f.efficiency_signed = f.path_efficiency_4 * sign(asNumber(row.net_displacement_4));
  f.body_expansion = f.body_pct_of_range * f.range_expansion_vs_avg20;
  f.wick_pressure_efficiency = f.aligned_wick_pressure_4 * f.path_efficiency_4;

  return f;
}

export function buildModelFeatures(
  current: TechnicalRow,
  previous1: TechnicalRow,
  previous4: TechnicalRow,
  model: Model = V6_MODEL,
): { ridge: Record<string, number>; gb: Record<string, number> } {
  const now = buildBaseFeatures(current);
  const lag1 = buildBaseFeatures(previous1);
  const lag4 = buildBaseFeatures(previous4);

  const all: Record<string, number> = { ...now };
  for (const feature of model.feature_schema.gb_features as string[]) {
    if (feature.startsWith("d1_")) {
      const baseName = feature.slice(3);
      all[feature] = now[baseName] - lag1[baseName];
    } else if (feature.startsWith("d4_")) {
      const baseName = feature.slice(3);
      all[feature] = now[baseName] - lag4[baseName];
    }
  }

  const ridge: Record<string, number> = {};
  for (const feature of model.feature_schema.ridge_features as string[]) {
    ridge[feature] = all[feature];
  }
  const gb: Record<string, number> = {};
  for (const feature of model.feature_schema.gb_features as string[]) {
    gb[feature] = all[feature];
  }
  return { ridge, gb };
}

function imputedVector(
  features: Record<string, number>,
  names: string[],
  medians: number[],
  imputedOut?: Array<{ feature: string; original: number | null }>,
): number[] {
  return names.map((name, index) => {
    const value = features[name];
    if (Number.isFinite(value)) return value;
    imputedOut?.push({
      feature: name,
      original: value === undefined || value === null || Number.isNaN(value) ? null : value,
    });
    return medians[index];
  });
}

function ridgeProbability(
  features: Record<string, number>,
  model: Model,
  imputedOut?: Array<{ feature: string; original: number | null }>,
): number {
  const names = model.feature_schema.ridge_features as string[];
  const values = imputedVector(features, names, model.ridge.imputer_statistics, imputedOut);
  let logit = model.ridge.intercept as number;
  for (let i = 0; i < names.length; i += 1) {
    const standardized =
      (values[i] - model.ridge.scaler_mean[i]) / model.ridge.scaler_scale[i];
    logit += model.ridge.coefficients[i] * standardized;
  }
  return sigmoid(logit);
}

function gbProbability(features: Record<string, number>, model: Model): number {
  const names = model.feature_schema.gb_features as string[];
  const featureIndex = new Map(names.map((name, index) => [name, index]));
  const values = imputedVector(features, names, model.gradient_boosting.imputer_statistics);

  const [priorRed, priorGreen] = model.gradient_boosting.class_prior as [number, number];
  let raw = Math.log(priorGreen / priorRed);
  const learningRate = model.gradient_boosting.config.lr as number;

  for (const stump of model.gradient_boosting.stumps) {
    const index = featureIndex.get(stump.feature);
    if (index === undefined) throw new Error(`Unknown GB feature ${stump.feature}`);
    const leaf = values[index] <= stump.threshold ? stump.left_value : stump.right_value;
    raw += learningRate * leaf;
  }
  return sigmoid(raw);
}

function baseDirection(finalScore: number, model: Model): Direction {
  if (finalScore <= model.calibration.red_threshold) return "RED";
  if (finalScore >= model.calibration.green_threshold) return "GREEN";
  return "ABSTAIN";
}

export function inferV6(
  current: TechnicalRow,
  previous1: TechnicalRow,
  previous4: TechnicalRow,
  state: V6State,
  model: Model = V6_MODEL,
): V6Inference {
  const built = buildModelFeatures(current, previous1, previous4, model);
  const imputedFeatures: Array<{ feature: string; original: number | null }> = [];

  const ridgePGreen = ridgeProbability(built.ridge, model, imputedFeatures);
  const gbPGreen = gbProbability(built.gb, model);

  const ridgePercentile = empiricalPercentile(
    model.calibration.ridge_oof_probs_sorted,
    ridgePGreen,
  );
  const gbPercentile = empiricalPercentile(model.calibration.gb_oof_probs_sorted, gbPGreen);

  const centeredRidge = ridgePercentile - 0.5;
  const centeredGb = gbPercentile - 0.5;
  const centeredSum = centeredRidge + centeredGb;

  const broadScore =
    centeredSum === 0
      ? 0.5
      : 0.5 + sign(centeredSum) * Math.min(Math.abs(centeredRidge), Math.abs(centeredGb));

  const broadPercentile = empiricalPercentile(
    model.calibration.broad_oof_scores_sorted,
    broadScore,
  );

  let anchorTotal = 0;
  for (const anchor of model.feature_schema.anchor_features) {
    const rawPercentile = empiricalPercentile(
      model.anchor.training_distributions[anchor.name],
      built.ridge[anchor.name],
    );
    anchorTotal += anchor.orientation === 1 ? rawPercentile : 1 - rawPercentile;
  }
  const anchorScore = anchorTotal / model.feature_schema.anchor_features.length;
  const anchorPercentile = empiricalPercentile(
    model.calibration.anchor_oof_scores_sorted,
    anchorScore,
  );

  // Exact-distance tie goes to broad.
  const finalScore =
    Math.abs(broadPercentile - 0.5) >= Math.abs(anchorPercentile - 0.5)
      ? broadPercentile
      : anchorPercentile;

  const basePrediction = baseDirection(finalScore, model);

  const basePredictionsLast8 = [...state.priorBasePredictions.slice(-7), basePrediction];
  const baseGreenCountLast8 = basePredictionsLast8.filter((v) => v === "GREEN").length;

  const saturationVetoEvaluable =
    basePrediction === "GREEN" && basePredictionsLast8.length === 8;
  const saturationVetoTriggered =
    saturationVetoEvaluable &&
    baseGreenCountLast8 >= 6 &&
    built.ridge.aligned_wick_pressure_4 <= -0.05;

  let preWeakRedVetoPrediction: Direction = saturationVetoTriggered
    ? "ABSTAIN"
    : basePrediction;
  let predictionSource: PredictionSource = basePrediction === "ABSTAIN" ? "ABSTAIN" : "V6_BASE";
  // Parity vectors report source ABSTAIN whenever the saturation veto fires.
  if (saturationVetoTriggered) predictionSource = "ABSTAIN";
  let abstainReason: string | null = saturationVetoTriggered
    ? "GREEN_SATURATION_BEARISH_WICK_VETO"
    : basePrediction === "ABSTAIN"
      ? "BASE_UNCERTAINTY"
      : null;

  const pickupsEvaluable = basePrediction === "ABSTAIN";
  const redPickupTriggered =
    pickupsEvaluable &&
    ridgePercentile < 0.5 &&
    gbPercentile < 0.5 &&
    anchorPercentile < 0.5 &&
    built.ridge.lower_wick_pct >= 0.2;
  const greenPickupTriggered =
    pickupsEvaluable &&
    built.ridge.roc_4 >= 0.15 &&
    built.ridge.range_expansion_vs_avg20 >= 1.0;
  const pickupConflict = redPickupTriggered && greenPickupTriggered;

  if (pickupConflict) {
    preWeakRedVetoPrediction = "ABSTAIN";
    predictionSource = "ABSTAIN";
    abstainReason = "PICKUP_CONFLICT";
  } else if (redPickupTriggered) {
    preWeakRedVetoPrediction = "RED";
    predictionSource = "CONSENSUS_RED_PICKUP";
    abstainReason = null;
  } else if (greenPickupTriggered) {
    preWeakRedVetoPrediction = "GREEN";
    predictionSource = "MOMENTUM_EXPANSION_GREEN_PICKUP";
    abstainReason = null;
  }

  // --- V6-r2 weak-broad RED veto + coverage recovery exceptions ---
  const weakRedVetoCandidate =
    preWeakRedVetoPrediction === "RED" &&
    predictionSource === "V6_BASE" &&
    broadPercentile >= WEAK_RED_BROAD_PERCENTILE_THRESHOLD;

  const rsi14 = built.ridge.rsi14;
  const roc4 = built.ridge.roc_4;
  const rsiValid = Number.isFinite(rsi14);
  const roc4Valid = Number.isFinite(roc4);

  const weakRedRsiRecoveryEvaluable = weakRedVetoCandidate && rsiValid;
  const weakRedRsiRecoveryTriggered =
    weakRedRsiRecoveryEvaluable && rsi14 <= WEAK_RED_RSI_THRESHOLD;

  const weakRedRoc4RecoveryEvaluable =
    weakRedVetoCandidate && !weakRedRsiRecoveryTriggered && rsiValid && roc4Valid && rsi14 > WEAK_RED_RSI_THRESHOLD;
  const weakRedRoc4RecoveryTriggered =
    weakRedRoc4RecoveryEvaluable && roc4 >= WEAK_RED_ROC4_THRESHOLD;

  const weakRedRecoveryEvaluable = weakRedVetoCandidate && rsiValid;
  const weakRedRecoveryTriggered =
    weakRedRsiRecoveryTriggered || weakRedRoc4RecoveryTriggered;
  const weakRedRecoveryReason: WeakRedRecoveryReason = weakRedRsiRecoveryTriggered
    ? "WEAK_RED_RSI_CONTINUATION_RECOVERY"
    : weakRedRoc4RecoveryTriggered
      ? "WEAK_RED_ROC4_OVEREXTENSION_RECOVERY"
      : null;

  const weakBroadRedVetoEvaluable =
    preWeakRedVetoPrediction === "RED" && predictionSource === "V6_BASE";
  const weakBroadRedVetoTriggered = weakRedVetoCandidate && !weakRedRecoveryTriggered;

  const finalPrediction: Direction = weakBroadRedVetoTriggered
    ? "ABSTAIN"
    : preWeakRedVetoPrediction;
  if (weakBroadRedVetoTriggered) abstainReason = "WEAK_BROAD_RED_VETO";


  return {
    ridgeFeatures: built.ridge,
    gbFeatures: built.gb,
    imputedFeatures,
    ridgePGreen,
    ridgePercentile,
    gbPGreen,
    gbPercentile,
    broadScore,
    broadPercentile,
    anchorScore,
    anchorPercentile,
    finalScore,
    basePrediction,
    basePredictionsLast8,
    baseGreenCountLast8,
    saturationVetoEvaluable,
    saturationVetoTriggered,
    redPickupEvaluable: pickupsEvaluable,
    redPickupTriggered,
    greenPickupEvaluable: pickupsEvaluable,
    greenPickupTriggered,
    pickupConflict,
    preWeakRedVetoPrediction,
    predictionSource,
    weakBroadRedVetoEvaluable,
    weakBroadRedVetoTriggered,
    finalPrediction,
    abstainReason,
  };
}

export function updateV6State(state: V6State, inference: V6Inference): V6State {
  return {
    priorBasePredictions: [...state.priorBasePredictions, inference.basePrediction].slice(-7),
  };
}

export function rawScore(prediction: Direction, actual: Actual): number | null {
  if (actual === "PUSH") return null;
  if (prediction === "ABSTAIN") return 0;
  return prediction === actual ? 1 : -1;
}

export function adjustedScore(prediction: Direction, actual: Actual): number | null {
  if (actual === "PUSH") return null;
  if (prediction === "ABSTAIN") return 0;
  return prediction === actual ? 0.8 : -1;
}

/**
 * Counterfactual contribution of an abstention rule that replaced `original`
 * with ABSTAIN.  Replacing a loss is credit; replacing a win is cost.
 */
export function abstentionContribution(
  triggered: boolean,
  original: Direction,
  actual: Actual | null,
): { raw: number; adjusted: number; avoidedLoss: boolean; sacrificedWin: boolean } {
  if (!triggered || !actual || actual === "PUSH" || original === "ABSTAIN") {
    return { raw: 0, adjusted: 0, avoidedLoss: false, sacrificedWin: false };
  }
  const won = original === actual;
  return won
    ? { raw: -1, adjusted: -0.8, avoidedLoss: false, sacrificedWin: true }
    : { raw: 1, adjusted: 1, avoidedLoss: true, sacrificedWin: false };
}

/** Counterfactual contribution of a pickup made from a baseline ABSTAIN. */
export function pickupContribution(
  triggered: boolean,
  picked: Direction,
  actual: Actual | null,
): { raw: number; adjusted: number } {
  if (!triggered || !actual || actual === "PUSH" || picked === "ABSTAIN") {
    return { raw: 0, adjusted: 0 };
  }
  return picked === actual ? { raw: 1, adjusted: 0.8 } : { raw: -1, adjusted: -1 };
}
