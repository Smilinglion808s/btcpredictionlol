// V6-r3 — Broad Conflict and Reliability Protection.
//
// This module NEVER touches the frozen V6 core: no feature formulas, ridge
// coefficients, GB stumps, calibration distributions, base thresholds, Armor
// rules or canonical resolution are read or changed here. It adds two narrow
// abstention layers around the frozen decision and demotes the Regime Inverter
// to shadow-only.

import type { Direction, PredictionSource } from "./inference";

export const V6_R3_MODEL_REVISION = "V6-r3-broad-conflict-reliability";
/** Explicit activation boundary for V6-r3. Older rows keep their prior revision. */
export const V6_R3_ACTIVATED_AT = "2026-08-06T02:00:00.000Z";

/** Frozen r3 thresholds. Never tuned at runtime. */
export const BROAD_CONFLICT_MIN_DISTANCE = 0.025;
export const BROAD_CONFLICT_MAX_DISTANCE = 0.075;
export const BROAD_RED_RELIABILITY_WINDOW = 12;
export const BROAD_RED_RELIABILITY_THRESHOLD = -2.0;

export const BROAD_CONFLICT_VETO_REASON = "BROAD_MILD_ANCHOR_CONFLICT_VETO";
export const BROAD_RED_RELIABILITY_REASON = "BROAD_RED_RELIABILITY_VETO";

/** The Regime Inverter may no longer publish under r3. */
export const REGIME_INVERTER_SHADOW_ONLY = true;
export const REGIME_INVERTER_PUBLICATION_ENABLED = false;

export type SelectedComponent = "BROAD" | "ANCHOR" | "NONE";
export type Directional = "GREEN" | "RED";

function round(value: number, places = 10): number {
  const f = 10 ** places;
  return Math.round(value * f) / f;
}

function isDirectional(v: unknown): v is Directional {
  return v === "GREEN" || v === "RED";
}

/**
 * The component that controlled the frozen V6 final score. Exact-distance ties
 * go to BROAD, matching the frozen core. NONE only when the frozen model could
 * not produce a valid component decision.
 */
export function selectComponent(
  broadPercentile: number,
  anchorPercentile: number,
): { component: SelectedComponent; broadDistance: number; anchorDistance: number } {
  const broadDistance = Math.abs(broadPercentile - 0.5);
  const anchorDistance = Math.abs(anchorPercentile - 0.5);
  if (!Number.isFinite(broadPercentile) || !Number.isFinite(anchorPercentile)) {
    return { component: "NONE", broadDistance, anchorDistance };
  }
  return {
    component: broadDistance >= anchorDistance ? "BROAD" : "ANCHOR",
    broadDistance,
    anchorDistance,
  };
}

// ---------------------------------------------------------------------------
// Rule A — Broad mild-anchor-conflict veto
// ---------------------------------------------------------------------------

export interface BroadConflictDecision {
  evaluable: boolean;
  triggered: boolean;
  reason: string | null;
  originalPrediction: Direction | null;
  originalSource: PredictionSource | null;
  anchorPercentile: number | null;
  anchorDirection: Directional | null;
  anchorDistance: number | null;
  prediction: Direction;
  predictionSource: PredictionSource;
}

/**
 * Narrow veto: a BROAD-selected V6_BASE direction that the anchor mildly
 * contradicts ([0.025, 0.075) from neutral) abstains. Pickups, anchor-selected
 * decisions and non-finite anchors fail closed (no trigger).
 */
export function applyBroadConflictVeto(
  prediction: Direction,
  source: PredictionSource,
  selectedComponent: SelectedComponent,
  anchorPercentile: number,
): BroadConflictDecision {
  const anchorFinite = Number.isFinite(anchorPercentile);
  const evaluable =
    isDirectional(prediction) &&
    source === "V6_BASE" &&
    selectedComponent === "BROAD" &&
    anchorFinite;

  const anchorDistance = anchorFinite ? Math.abs(anchorPercentile - 0.5) : null;
  const anchorDirection: Directional | null = anchorFinite
    ? anchorPercentile > 0.5
      ? "GREEN"
      : anchorPercentile < 0.5
        ? "RED"
        : null
    : null;

  const opposite =
    evaluable &&
    ((prediction === "RED" && anchorPercentile > 0.5) ||
      (prediction === "GREEN" && anchorPercentile < 0.5));

  const triggered =
    opposite &&
    anchorDistance !== null &&
    anchorDistance >= BROAD_CONFLICT_MIN_DISTANCE &&
    anchorDistance < BROAD_CONFLICT_MAX_DISTANCE;

  return {
    evaluable,
    triggered,
    reason: triggered ? BROAD_CONFLICT_VETO_REASON : null,
    originalPrediction: evaluable ? prediction : null,
    originalSource: evaluable ? source : null,
    anchorPercentile: anchorFinite ? anchorPercentile : null,
    anchorDirection,
    anchorDistance,
    prediction: triggered ? "ABSTAIN" : prediction,
    predictionSource: triggered ? "ABSTAIN" : source,
  };
}

// ---------------------------------------------------------------------------
// Rule B — BROAD_RED Reliability Governor
// ---------------------------------------------------------------------------

/** One resolved ORIGINAL broad-selected base-RED signal in the rolling window. */
export interface BroadRedEntry {
  target_candle_ts: string;
  broad_red_shadow_prediction: "RED";
  actual_direction: Directional;
  broad_red_shadow_raw_score: number;
  broad_red_shadow_adjusted_score: number;
}

/** A resolved prediction row in the minimal shape the governor cares about. */
export interface BroadRedCandidate {
  target_candle_ts: string;
  selected_component: string | null;
  base_v6_prediction: string | null;
  base_v6_prediction_source: string | null;
  operational_status: string | null;
  canonical_ground_truth_valid: boolean | null;
  actual_direction: string | null;
}

export interface BroadRedSummary {
  ready: boolean;
  active: boolean;
  count: number;
  wins: number;
  losses: number;
  adjustedNet: number;
  threshold: number;
}

/** Original BROAD_RED shadow scoring: correct +0.8 adjusted / +1 raw, wrong -1. */
export function broadRedShadowScores(actual: Directional): { raw: number; adjusted: number } {
  return actual === "RED" ? { raw: 1, adjusted: 0.8 } : { raw: -1, adjusted: -1 };
}

/**
 * Shadow-history membership. Follows the ORIGINAL frozen broad-selected base
 * RED signal, regardless of any later veto, recovery or inversion.
 */
export function isEligibleBroadRedSignal(row: BroadRedCandidate): boolean {
  return (
    row.operational_status === "OK" &&
    row.canonical_ground_truth_valid === true &&
    isDirectional(row.actual_direction) &&
    row.selected_component === "BROAD" &&
    row.base_v6_prediction === "RED" &&
    row.base_v6_prediction_source === "V6_BASE"
  );
}

export function toBroadRedEntry(row: BroadRedCandidate): BroadRedEntry | null {
  if (!isEligibleBroadRedSignal(row)) return null;
  const actual = row.actual_direction as Directional;
  const s = broadRedShadowScores(actual);
  return {
    target_candle_ts: new Date(row.target_candle_ts).toISOString(),
    broad_red_shadow_prediction: "RED",
    actual_direction: actual,
    broad_red_shadow_raw_score: s.raw,
    broad_red_shadow_adjusted_score: s.adjusted,
  };
}

/** Chronological, de-duplicated, latest 12 entries. */
export function buildBroadRedHistory(rows: readonly BroadRedCandidate[]): BroadRedEntry[] {
  const byTs = new Map<string, BroadRedEntry>();
  for (const row of rows) {
    const entry = toBroadRedEntry(row);
    if (entry) byTs.set(entry.target_candle_ts, entry);
  }
  return [...byTs.values()]
    .sort((a, b) => a.target_candle_ts.localeCompare(b.target_candle_ts))
    .slice(-BROAD_RED_RELIABILITY_WINDOW);
}

/** Idempotent append: an already-present target timestamp never double-counts. */
export function appendBroadRedEntry(
  history: readonly BroadRedEntry[],
  entry: BroadRedEntry,
): BroadRedEntry[] {
  if (history.some((h) => h.target_candle_ts === entry.target_candle_ts)) return [...history];
  return [...history, entry]
    .sort((a, b) => a.target_candle_ts.localeCompare(b.target_candle_ts))
    .slice(-BROAD_RED_RELIABILITY_WINDOW);
}

/** Rolling reliability of the ORIGINAL BROAD_RED branch over the last 12. */
export function summarizeBroadRed(history: readonly BroadRedEntry[]): BroadRedSummary {
  const window = history.slice(-BROAD_RED_RELIABILITY_WINDOW);
  const wins = window.filter((h) => h.broad_red_shadow_adjusted_score > 0).length;
  const losses = window.length - wins;
  const adjustedNet = round(0.8 * wins - losses);
  const ready = window.length === BROAD_RED_RELIABILITY_WINDOW;
  return {
    ready,
    active: ready && adjustedNet <= BROAD_RED_RELIABILITY_THRESHOLD,
    count: window.length,
    wins,
    losses,
    adjustedNet,
    threshold: BROAD_RED_RELIABILITY_THRESHOLD,
  };
}

export interface BroadRedReliabilityDecision {
  evaluable: boolean;
  triggered: boolean;
  reason: string | null;
  prediction: Direction;
  predictionSource: PredictionSource;
}

/**
 * Publication gate: only an eligible surviving BROAD-selected V6_BASE RED may
 * be suppressed, and only when the governor is ready and active.
 */
export function applyBroadRedReliabilityVeto(
  prediction: Direction,
  source: PredictionSource,
  selectedComponent: SelectedComponent,
  summary: BroadRedSummary,
): BroadRedReliabilityDecision {
  const evaluable =
    prediction === "RED" && source === "V6_BASE" && selectedComponent === "BROAD";
  const triggered = evaluable && summary.ready && summary.active;
  return {
    evaluable,
    triggered,
    reason: triggered ? BROAD_RED_RELIABILITY_REASON : null,
    prediction: triggered ? "ABSTAIN" : prediction,
    predictionSource: triggered ? "ABSTAIN" : source,
  };
}

/**
 * Counterfactual value of an r3 abstention rule versus publishing the
 * underlying direction. Vetoed loss = +1 raw / +1 adjusted; vetoed win = -1 raw
 * / -0.8 adjusted; no trigger = 0.
 */
export function vetoContribution(
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
