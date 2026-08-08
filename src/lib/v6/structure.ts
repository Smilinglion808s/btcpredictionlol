// V6-r4 — Balanced Structure Confirmation.
//
// This module NEVER touches the frozen V6 core: no feature formulas, ridge
// coefficients, GB stumps, calibration distributions, base thresholds, r1/r2/r3
// rules or canonical resolution are read or changed here.
//
// It adds ONE final gate after the complete V6-r3 publication logic. The gate
// may only convert an otherwise directional prediction to ABSTAIN. It never
// reverses direction and never creates a directional prediction.

import type { Direction, PredictionSource } from "./inference";

export const V6_R4_MODEL_REVISION = "V6-r4-structure-confirmation";
/** Explicit activation boundary for V6-r4. Older rows keep their prior revision. */
export const V6_R4_ACTIVATED_AT = "2026-08-08T08:00:00.000Z";

/** Frozen r4 thresholds. Never tuned at runtime. */
export const STRUCTURE_REJECTION_LOWER_WICK_MIN = 0.4;
export const STRUCTURE_REJECTION_ALIGNED_WICK_MIN = 0.0;
export const STRUCTURE_EXPANSION_RANGE_MIN = 0.8;
export const STRUCTURE_EXPANSION_EFFICIENCY_MIN = 0.3;

export const STRUCTURE_CONFIRMATION_VETO_REASON = "STRUCTURE_CONFIRMATION_VETO";

export type Directional = "GREEN" | "RED";

function isDirectional(v: unknown): v is Directional {
  return v === "GREEN" || v === "RED";
}

function finite(v: unknown): number | null {
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
}

export interface StructureInputs {
  lower_wick_pct: number | null | undefined;
  aligned_wick_pressure_4: number | null | undefined;
  range_expansion_vs_avg20: number | null | undefined;
  path_efficiency_4: number | null | undefined;
}

export interface StructureBranch {
  evaluable: boolean;
  pass: boolean;
}

/** Structure A — rejection / defense. Missing inputs fail closed. */
export function evaluateStructureRejection(inputs: StructureInputs): StructureBranch {
  const wick = finite(inputs.lower_wick_pct);
  const aligned = finite(inputs.aligned_wick_pressure_4);
  const evaluable = wick !== null && aligned !== null;
  return {
    evaluable,
    pass:
      evaluable &&
      (wick as number) >= STRUCTURE_REJECTION_LOWER_WICK_MIN &&
      (aligned as number) >= STRUCTURE_REJECTION_ALIGNED_WICK_MIN,
  };
}

/** Structure B — expansion / efficiency. Missing inputs fail closed. */
export function evaluateStructureExpansion(inputs: StructureInputs): StructureBranch {
  const range = finite(inputs.range_expansion_vs_avg20);
  const eff = finite(inputs.path_efficiency_4);
  const evaluable = range !== null && eff !== null;
  return {
    evaluable,
    pass:
      evaluable &&
      (range as number) >= STRUCTURE_EXPANSION_RANGE_MIN &&
      (eff as number) >= STRUCTURE_EXPANSION_EFFICIENCY_MIN,
  };
}

export interface StructureConfirmationDecision {
  evaluable: boolean;
  rejection: StructureBranch;
  expansion: StructureBranch;
  pass: boolean;
  triggered: boolean;
  reason: string | null;
  preStructurePrediction: Direction;
  preStructureSource: PredictionSource;
  prediction: Direction;
  predictionSource: PredictionSource;
  /** Underlying directional call preserved when the gate vetoes. */
  underlyingPrediction: Directional | null;
  values: {
    lower_wick: number | null;
    aligned_wick: number | null;
    range_expansion: number | null;
    path_efficiency: number | null;
  };
}

/**
 * Final gate. Applies only to a directional r3 publication; ABSTAIN and OP_FAIL
 * pass through untouched and are never converted into a direction.
 */
export function applyStructureConfirmation(
  prediction: Direction,
  source: PredictionSource,
  inputs: StructureInputs,
): StructureConfirmationDecision {
  const rejection = evaluateStructureRejection(inputs);
  const expansion = evaluateStructureExpansion(inputs);
  const evaluable = isDirectional(prediction);
  const pass = rejection.pass || expansion.pass;
  const triggered = evaluable && !pass;

  return {
    evaluable,
    rejection,
    expansion,
    pass: evaluable ? pass : false,
    triggered,
    reason: triggered ? STRUCTURE_CONFIRMATION_VETO_REASON : null,
    preStructurePrediction: prediction,
    preStructureSource: source,
    prediction: triggered ? "ABSTAIN" : prediction,
    predictionSource: triggered ? "ABSTAIN" : source,
    underlyingPrediction: triggered ? (prediction as Directional) : null,
    values: {
      lower_wick: finite(inputs.lower_wick_pct),
      aligned_wick: finite(inputs.aligned_wick_pressure_4),
      range_expansion: finite(inputs.range_expansion_vs_avg20),
      path_efficiency: finite(inputs.path_efficiency_4),
    },
  };
}

/**
 * Counterfactual value of the structure abstention versus publishing the
 * underlying direction. Avoided loss = +1 raw / +1 adjusted; sacrificed win =
 * -1 raw / -0.8 adjusted; no trigger = 0. Kept independent of every other layer.
 */
export function structureContribution(
  triggered: boolean,
  underlying: Direction | null,
  actual: "GREEN" | "RED" | "PUSH" | null,
): { raw: number; adjusted: number; avoidedLoss: boolean; sacrificedWin: boolean } {
  if (!triggered || !actual || actual === "PUSH" || !isDirectional(underlying)) {
    return { raw: 0, adjusted: 0, avoidedLoss: false, sacrificedWin: false };
  }
  return underlying === actual
    ? { raw: -1, adjusted: -0.8, avoidedLoss: false, sacrificedWin: true }
    : { raw: 1, adjusted: 1, avoidedLoss: true, sacrificedWin: false };
}
