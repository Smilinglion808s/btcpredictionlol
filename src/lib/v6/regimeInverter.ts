// V6 Regime Inverter — pure adaptive layer (V6-r1-regime-inverter).
//
// This module NEVER touches the frozen V6 core: no feature formulas, ridge
// coefficients, GB stumps, calibration distributions, thresholds, Armor rules,
// or canonical resolution are read or changed here. It only observes the
// resolved history of ORIGINAL (uninverted) V6_BASE directional signals and,
// when that relationship has gone materially negative, reverses eligible
// V6_BASE directions at publication time.

import type { Actual, Direction } from "./inference";

export const V6_MODEL_REVISION = "V6-r3-broad-conflict-reliability";
/** Explicit activation boundary for V6-r3. Older rows keep their prior revision. */
export const V6_MODEL_REVISION_ACTIVATED_AT = "2026-08-06T02:00:00.000Z";
/**
 * Revision tag of the inverter's own persisted shadow window. It is deliberately
 * decoupled from `V6_MODEL_REVISION`: the rolling history and its scoring rules
 * did not change in r3 (only its publication authority did), so the stored
 * window must survive the r3 activation intact.
 */
export const V6_REGIME_INVERTER_STATE_REVISION = "V6-regime-inverter-v1";
/** V6-r3: the inverter is shadow-only and may never change publication. */
export const V6_REGIME_INVERTER_SHADOW_ONLY = true;
export const V6_REGIME_INVERTER_PUBLICATION_ENABLED = false;

export const V6_REGIME_INVERTER_WINDOW = 20;
export const V6_REGIME_INVERTER_THRESHOLD = -2.8;
export const V6_REGIME_INVERTER_REASON = "V6_REGIME_INVERSION";
export const V6_REGIME_INVERTER_SOURCE = "REGIME_INVERTER";

export type Directional = "GREEN" | "RED";

/** One resolved ORIGINAL V6_BASE directional signal in the rolling window. */
export interface ShadowEntry {
  target_candle_ts: string;
  original_v6_base_prediction: Directional;
  actual_direction: Directional;
  original_v6_shadow_raw_score: number;
  original_v6_shadow_adjusted_score: number;
}

/** A resolved prediction row, in the minimal shape the inverter cares about. */
export interface ShadowCandidate {
  target_candle_ts: string;
  prediction_source: string | null;
  original_v6_base_prediction: string | null;
  operational_status: string | null;
  canonical_ground_truth_valid: boolean | null;
  actual_direction: string | null;
}

export interface ShadowSummary {
  ready: boolean;
  active: boolean;
  count: number;
  wins: number;
  losses: number;
  adjustedNet: number;
  threshold: number;
}

function round(value: number, places = 10): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function isDirectional(value: unknown): value is Directional {
  return value === "GREEN" || value === "RED";
}

/** Original-direction shadow scoring: correct +0.8 adjusted / +1 raw, wrong -1. */
export function shadowScores(
  original: Directional,
  actual: Directional,
): { raw: number; adjusted: number } {
  return original === actual ? { raw: 1, adjusted: 0.8 } : { raw: -1, adjusted: -1 };
}

/**
 * Eligibility for the rolling shadow history. Pickups, strategic abstentions,
 * OP_FAIL, PUSH and invalid canonical ground truth are all excluded.
 */
export function isEligibleShadowSignal(row: ShadowCandidate): boolean {
  return (
    row.prediction_source === "V6_BASE" &&
    isDirectional(row.original_v6_base_prediction) &&
    row.canonical_ground_truth_valid === true &&
    isDirectional(row.actual_direction) &&
    row.operational_status === "OK"
  );
}

export function toShadowEntry(row: ShadowCandidate): ShadowEntry | null {
  if (!isEligibleShadowSignal(row)) return null;
  const original = row.original_v6_base_prediction as Directional;
  const actual = row.actual_direction as Directional;
  const s = shadowScores(original, actual);
  return {
    target_candle_ts: new Date(row.target_candle_ts).toISOString(),
    original_v6_base_prediction: original,
    actual_direction: actual,
    original_v6_shadow_raw_score: s.raw,
    original_v6_shadow_adjusted_score: s.adjusted,
  };
}

/** Chronological, de-duplicated, latest `V6_REGIME_INVERTER_WINDOW` entries. */
export function buildShadowHistory(rows: readonly ShadowCandidate[]): ShadowEntry[] {
  const byTs = new Map<string, ShadowEntry>();
  for (const row of rows) {
    const entry = toShadowEntry(row);
    if (entry) byTs.set(entry.target_candle_ts, entry);
  }
  return [...byTs.values()]
    .sort((a, b) => a.target_candle_ts.localeCompare(b.target_candle_ts))
    .slice(-V6_REGIME_INVERTER_WINDOW);
}

/** Idempotent append: an already-present target timestamp never double-counts. */
export function appendShadowEntry(
  history: readonly ShadowEntry[],
  entry: ShadowEntry,
): ShadowEntry[] {
  if (history.some((h) => h.target_candle_ts === entry.target_candle_ts)) {
    return [...history];
  }
  return [...history, entry]
    .sort((a, b) => a.target_candle_ts.localeCompare(b.target_candle_ts))
    .slice(-V6_REGIME_INVERTER_WINDOW);
}

/** Rolling reliability of the ORIGINAL V6_BASE direction over the window. */
export function summarizeShadow(history: readonly ShadowEntry[]): ShadowSummary {
  const window = history.slice(-V6_REGIME_INVERTER_WINDOW);
  const wins = window.filter((h) => h.original_v6_shadow_adjusted_score > 0).length;
  const losses = window.length - wins;
  const adjustedNet = round(0.8 * wins - losses);
  const ready = window.length === V6_REGIME_INVERTER_WINDOW;
  return {
    ready,
    active: ready && adjustedNet <= V6_REGIME_INVERTER_THRESHOLD,
    count: window.length,
    wins,
    losses,
    adjustedNet,
    threshold: V6_REGIME_INVERTER_THRESHOLD,
  };
}

export interface InverterDecision {
  evaluable: boolean;
  triggered: boolean;
  finalPrediction: Direction;
  finalPredictionSource: string;
  originalPrediction: Directional | null;
  replacementPrediction: Directional | null;
  reason: string | null;
}

/**
 * Step 11 of the decision order: applied only AFTER every existing Armor rule.
 * Only a directional prediction whose surviving source is V6_BASE may flip.
 */
export function applyRegimeInverter(
  preInverterPrediction: Direction,
  preInverterSource: string,
  summary: ShadowSummary,
): InverterDecision {
  const evaluable =
    preInverterSource === "V6_BASE" && isDirectional(preInverterPrediction);

  if (!evaluable || !summary.ready || !summary.active) {
    return {
      evaluable,
      triggered: false,
      finalPrediction: preInverterPrediction,
      finalPredictionSource: preInverterSource,
      originalPrediction: evaluable ? (preInverterPrediction as Directional) : null,
      replacementPrediction: null,
      reason: null,
    };
  }

  const original = preInverterPrediction as Directional;
  const replacement: Directional = original === "GREEN" ? "RED" : "GREEN";
  return {
    evaluable: true,
    triggered: true,
    finalPrediction: replacement,
    finalPredictionSource: V6_REGIME_INVERTER_SOURCE,
    originalPrediction: original,
    replacementPrediction: replacement,
    reason: V6_REGIME_INVERTER_REASON,
  };
}

/**
 * Counterfactual value of the flip: final score minus pre-inverter score.
 * Loss turned into win = +2 raw / +1.8 adjusted; the reverse is symmetric.
 */
export function inverterContribution(
  triggered: boolean,
  preInverter: Direction,
  final: Direction,
  actual: Actual | null,
): { raw: number; adjusted: number } {
  if (!triggered || !actual || actual === "PUSH" || !isDirectional(preInverter)) {
    return { raw: 0, adjusted: 0 };
  }
  const preRaw = preInverter === actual ? 1 : -1;
  const preAdj = preInverter === actual ? 0.8 : -1;
  const finRaw = final === actual ? 1 : -1;
  const finAdj = final === actual ? 0.8 : -1;
  return { raw: round(finRaw - preRaw), adjusted: round(finAdj - preAdj) };
}
