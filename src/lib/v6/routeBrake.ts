// V6-r5.1 — Route Drawdown Brake.
//
// This module NEVER touches the frozen V6 model or the V6-r5 directional rules:
// no feature formula, ridge coefficient, GB stump, calibration distribution,
// broad/anchor calculation, base threshold, r5 threshold, RED feeder rule or
// conflict rule is read or changed here.
//
// The brake is veto-only and route-specific. It may turn a published GREEN or
// Anchor RED into ABSTAIN and nothing else. Broad RED is never restricted, and
// there is NO daily or global emergency cap of any kind.

import type { Direction } from "./inference";

export const V6_R5_1_MODEL_REVISION = "V6-r5.1-route-drawdown-brake";
/** Actual deployment timestamp of V6-r5.1. Live results are never backdated. */
export const V6_R5_1_ACTIVATED_AT = "2026-08-12T21:45:00.000Z";

export const R5_ROUTE_GREEN = "R5_GREEN";
export const R5_ROUTE_ANCHOR_RED = "R5_ANCHOR_RED";

export const R5_GREEN_SOURCE_KEY = "V6_R5_GREEN_STOCH_PULLBACK";
export const R5_RED_ANCHOR_SOURCE_KEY = "V6_R5_RED_ANCHOR_CLOSE_CONTROL";
export const R5_RED_BROAD_SOURCE_KEY = "V6_R5_RED_BROAD_CONTROLLED_RANGE";

export const R5_GREEN_ROUTE_BRAKE_REASON = "R5_GREEN_ROUTE_DRAWDOWN_BRAKE";
export const R5_ANCHOR_RED_ROUTE_BRAKE_REASON = "R5_ANCHOR_RED_ROUTE_DRAWDOWN_BRAKE";

/** Consecutive eligible shadow losses that pause a route. */
export const R5_ROUTE_BRAKE_PAUSE_LOSSES = 2;
/** Eligible shadow wins that resume a paused route. */
export const R5_ROUTE_BRAKE_RESUME_WINS = 1;

/** No daily / global emergency cap exists under r5.1. */
export const R5_DAILY_EMERGENCY_CAP_ENABLED = false;

export type ShadowResult = "WIN" | "LOSS" | "PUSH" | null;

export interface RouteBrakeState {
  routeKey: string;
  pauseActive: boolean;
  consecutiveShadowLosses: number;
  lastShadowResult: ShadowResult;
  lastShadowTargetTs: string | null;
  lastShadowPrediction: string | null;
}

export function emptyRouteBrakeState(routeKey: string): RouteBrakeState {
  return {
    routeKey,
    pauseActive: false,
    consecutiveShadowLosses: 0,
    lastShadowResult: null,
    lastShadowTargetTs: null,
    lastShadowPrediction: null,
  };
}

/**
 * Apply one resolved eligible shadow outcome to a route state.
 *
 * WIN  -> streak 0, pause cleared.
 * LOSS -> streak += 1, pause once the streak reaches the threshold.
 * PUSH / invalid / OP_FAIL / no eligible signal -> state unchanged.
 */
export function applyShadowOutcome(
  state: RouteBrakeState,
  outcome: ShadowResult,
  targetTs?: string | null,
  prediction?: string | null,
): RouteBrakeState {
  if (outcome !== "WIN" && outcome !== "LOSS") return state;
  if (outcome === "WIN") {
    return {
      ...state,
      pauseActive: false,
      consecutiveShadowLosses: 0,
      lastShadowResult: "WIN",
      lastShadowTargetTs: targetTs ?? state.lastShadowTargetTs,
      lastShadowPrediction: prediction ?? state.lastShadowPrediction,
    };
  }
  const losses = state.consecutiveShadowLosses + 1;
  return {
    ...state,
    consecutiveShadowLosses: losses,
    pauseActive: state.pauseActive || losses >= R5_ROUTE_BRAKE_PAUSE_LOSSES,
    lastShadowResult: "LOSS",
    lastShadowTargetTs: targetTs ?? state.lastShadowTargetTs,
    lastShadowPrediction: prediction ?? state.lastShadowPrediction,
  };
}

export interface RouteBrakeDecision {
  prediction: Direction;
  source: string;
  reason: string | null;
  greenBrakeTriggered: boolean;
  anchorRedBrakeTriggered: boolean;
  triggered: boolean;
  routeKey: string | null;
  brakeReason: string | null;
  underlyingPrediction: Direction | null;
}

/**
 * Veto-only publication brake applied AFTER the existing r5 router has produced
 * its decision. It can only downgrade a GREEN or Anchor RED publication to
 * ABSTAIN; it never flips direction, never creates a trade, and never touches
 * the Broad RED route or an existing router conflict ABSTAIN.
 */
export function applyRouteBrake(
  preBrakePrediction: Direction,
  preBrakeSource: string,
  preBrakeReason: string | null,
  greenState: RouteBrakeState,
  anchorState: RouteBrakeState,
): RouteBrakeDecision {
  const greenBrakeTriggered =
    preBrakePrediction === "GREEN" &&
    preBrakeSource === R5_GREEN_SOURCE_KEY &&
    greenState.pauseActive;

  const anchorRedBrakeTriggered =
    preBrakePrediction === "RED" &&
    preBrakeSource === R5_RED_ANCHOR_SOURCE_KEY &&
    anchorState.pauseActive;

  if (greenBrakeTriggered || anchorRedBrakeTriggered) {
    const brakeReason = greenBrakeTriggered
      ? R5_GREEN_ROUTE_BRAKE_REASON
      : R5_ANCHOR_RED_ROUTE_BRAKE_REASON;
    return {
      prediction: "ABSTAIN",
      source: "ABSTAIN",
      reason: brakeReason,
      greenBrakeTriggered,
      anchorRedBrakeTriggered,
      triggered: true,
      routeKey: greenBrakeTriggered ? R5_ROUTE_GREEN : R5_ROUTE_ANCHOR_RED,
      brakeReason,
      underlyingPrediction: preBrakePrediction,
    };
  }

  return {
    prediction: preBrakePrediction,
    source: preBrakeSource,
    reason: preBrakeReason,
    greenBrakeTriggered: false,
    anchorRedBrakeTriggered: false,
    triggered: false,
    routeKey: null,
    brakeReason: null,
    underlyingPrediction: null,
  };
}

/**
 * Contribution of a brake trigger relative to abstaining.
 *   underlying LOSS vetoed -> raw +1, adjusted +1
 *   underlying WIN  vetoed -> raw -1, adjusted -0.8
 *   no trigger / PUSH / unresolved -> 0
 */
export function routeBrakeContribution(
  triggered: boolean,
  underlying: Direction | null,
  actual: "GREEN" | "RED" | "PUSH" | null,
): { raw: number; adjusted: number; result: string | null; avoidedLoss: boolean; sacrificedWin: boolean } {
  if (!triggered || !underlying || underlying === "ABSTAIN" || !actual || actual === "PUSH") {
    return {
      raw: 0,
      adjusted: 0,
      result: triggered && actual === "PUSH" ? "PUSH" : null,
      avoidedLoss: false,
      sacrificedWin: false,
    };
  }
  const win = underlying === actual;
  return {
    raw: win ? -1 : 1,
    adjusted: win ? -0.8 : 1,
    result: win ? "WIN" : "LOSS",
    avoidedLoss: !win,
    sacrificedWin: win,
  };
}
