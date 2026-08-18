// B4x4-ES1 Binance Dual-Venue Adaptive R1 — frozen, pure decision policy.
//
// Two independent Binance markets (Global SPOT and Global USD-M PERP) each
// derive a temporal orientation from exactly two inputs measured at the strict
// T-2s feature cutoff:
//
//   final_imbalance_10bps        (the last pre-boundary 10-bps depth imbalance)
//   mean_imbalance_10bps_60s     (the mean of the same measure over 60s)
//
// Same signs  => persistent condition  => FADE the final imbalance.
// Opposing    => recent shift          => FOLLOW the final imbalance.
//
// The two markets publish only when their resulting adaptive directions agree.
//
// Nothing in this module reads A2, the ES1 price head, B4 cells or pCorrect,
// the Balanced 3-of-4 votes, outcomes, prior predictions, magnitudes,
// percentiles, history_ready, brakes, saturation or the time of day.

import { createHash } from "crypto";
import {
  BINANCE_OB_COLLECTOR_VERSION,
  BINANCE_OB_SYMBOL,
  BINANCE_OB_VENUE,
  BINANCE_OB_VERSION,
  MAX_TARGET_AGE_MS,
  MIN_READY_OBSERVATIONS,
  MIN_TARGET_AGE_MS,
  binanceObConfigHash,
  binanceObFeatureSchemaHash,
} from "./binanceOb/config";
import type { Direction, MarketReadiness } from "./balanced";

// ---- frozen identity ---------------------------------------------------

export const MODEL_NAME = "B4x4-ES1" as const;
export const MODEL_VERSION = "b4x4-es1-binance-dual-adaptive-r1" as const;
export const POLICY_VERSION = "binance-dual-venue-adaptive-r1" as const;
export const IMPLEMENTATION_REVISION = "dual-venue-adaptive-r1" as const;
export const VARIANT = "spot-perp-temporal-orientation-agreement" as const;
export const DISPLAY_NAME = "B4x4-ES1 Dual-Venue Adaptive R1" as const;
export const FEATURE_SCHEMA =
  "binance-spot-perp-final-vs-mean60-10bps-tminus2-r1" as const;
export const RESOLVER_VERSION = "dual-venue-adaptive-resolver-r1" as const;
export const ACTIVATION_ID = "b4x4-es1" as const;

/** The exact frozen configuration the config hash is computed over. */
export const DUAL_ADAPTIVE_POLICY_CONFIG = {
  model_name: MODEL_NAME,
  model_version: MODEL_VERSION,
  policy_version: POLICY_VERSION,
  implementation_revision: IMPLEMENTATION_REVISION,
  variant: VARIANT,
  feature_schema: FEATURE_SCHEMA,
  venue: BINANCE_OB_VENUE,
  symbol: BINANCE_OB_SYMBOL,
  markets: ["SPOT", "USD_M_PERP"],
  inputs: ["final_imbalance_10bps", "mean_imbalance_10bps_60s"],
  feature_cutoff: "T_MINUS_2S",
  orientation: {
    same_sign: "FADE",
    opposing_sign: "FOLLOW",
  },
  publish_rule: "SPOT_AND_PERP_ADAPTIVE_DIRECTIONS_MUST_AGREE",
  tie_action: "ABSTAIN",
  binance_feature_version: BINANCE_OB_VERSION,
  binance_collector_version: BINANCE_OB_COLLECTOR_VERSION,
  min_observations: MIN_READY_OBSERVATIONS,
  target_age_ms: [MIN_TARGET_AGE_MS, MAX_TARGET_AGE_MS],
  require_resync_continuous: true,
  require_history_ready: false,
  uses_percentiles: false,
  uses_magnitudes: false,
  uses_outcomes: false,
  uses_es1_price_head: false,
  uses_a2: false,
  uses_b4: false,
  uses_balanced_votes: false,
  uses_prior_predictions: false,
  uses_brakes: false,
  configurable_thresholds: [],
} as const;

let _hash: string | null = null;
export function dualAdaptiveConfigHash(): string {
  _hash ??= createHash("sha256")
    .update(
      JSON.stringify({
        policy: DUAL_ADAPTIVE_POLICY_CONFIG,
        binance_config_hash: binanceObConfigHash(),
        binance_feature_schema_hash: binanceObFeatureSchemaHash(),
      }),
    )
    .digest("hex");
  return _hash;
}

// ---- sign / orientation ------------------------------------------------

export type ObSign = 1 | -1 | null;
export type AdaptiveMode = "FOLLOW" | "FADE";

/** Strict sign: null for null, non-finite, NaN and exact zero. */
export function strictSign(value: number | null): ObSign {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return null;
  return value > 0 ? 1 : -1;
}

export function directionOfSign(sign: ObSign): Direction | null {
  return sign === 1 ? "GREEN" : sign === -1 ? "RED" : null;
}

export const MODE_REASON_FADE = "FINAL_SIGN_MATCHES_MEAN60_SIGN" as const;
export const MODE_REASON_FOLLOW = "FINAL_SIGN_OPPOSES_MEAN60_SIGN" as const;

export interface MarketAdaptive {
  featureId: string | null;
  captureStatus: string | null;
  ready: boolean;
  readyReason: string | null;
  gateReason: string | null;
  historyReady: boolean;
  finalImbalance10bps: number | null;
  meanImbalance10bps60s: number | null;
  finalSign: ObSign;
  mean60Sign: ObSign;
  mode: AdaptiveMode | null;
  modeReason: string | null;
  adaptiveSign: ObSign;
  direction: Direction | null;
  /** null when both inputs were finite and nonzero. */
  inputInvalidReason: string | null;
}

/** Per-market adaptive orientation. Reads only the two frozen inputs. */
export function evaluateMarketAdaptive(m: MarketReadiness | null): MarketAdaptive {
  const base: MarketAdaptive = {
    featureId: m?.featureId ?? null,
    captureStatus: m?.captureStatus ?? null,
    ready: m != null && m.gateReason == null,
    readyReason: m?.readyReason ?? null,
    // A passing gate is `null`; only a completely absent readiness view is
    // NO_MARKET_READINESS. `??` here would have failed every healthy market.
    gateReason: m == null ? "NO_MARKET_READINESS" : m.gateReason,
    historyReady: m?.historyReady === true,
    finalImbalance10bps: m?.finalImbalance10bps ?? null,
    meanImbalance10bps60s: m?.meanImbalance10bps60s ?? null,
    finalSign: null,
    mean60Sign: null,
    mode: null,
    modeReason: null,
    adaptiveSign: null,
    direction: null,
    inputInvalidReason: null,
  };
  if (!m) return base;

  const finalSign = strictSign(m.finalImbalance10bps);
  const mean60Sign = strictSign(m.meanImbalance10bps60s);
  base.finalSign = finalSign;
  base.mean60Sign = mean60Sign;

  if (finalSign === null) {
    base.inputInvalidReason = "FINAL_IMBALANCE_10BPS_INVALID_OR_ZERO";
    return base;
  }
  if (mean60Sign === null) {
    base.inputInvalidReason = "MEAN_IMBALANCE_10BPS_60S_INVALID_OR_ZERO";
    return base;
  }

  if (finalSign === mean60Sign) {
    base.mode = "FADE";
    base.adaptiveSign = (finalSign === 1 ? -1 : 1) as ObSign;
    base.modeReason = MODE_REASON_FADE;
  } else {
    base.mode = "FOLLOW";
    base.adaptiveSign = finalSign;
    base.modeReason = MODE_REASON_FOLLOW;
  }
  base.direction = directionOfSign(base.adaptiveSign);
  return base;
}

// ---- decision ----------------------------------------------------------

export const DUAL_ADAPTIVE_REASONS = [
  "ABSTAIN_DUAL_ADAPTIVE_ACTIVATION_NOT_REACHED",
  "ABSTAIN_DUAL_ADAPTIVE_SPOT_FEATURE_MISSING",
  "ABSTAIN_DUAL_ADAPTIVE_PERP_FEATURE_MISSING",
  "ABSTAIN_DUAL_ADAPTIVE_SPOT_NOT_READY",
  "ABSTAIN_DUAL_ADAPTIVE_PERP_NOT_READY",
  "ABSTAIN_DUAL_ADAPTIVE_VERSION_OR_HASH_MISMATCH",
  "ABSTAIN_DUAL_ADAPTIVE_SPOT_INPUT_INVALID",
  "ABSTAIN_DUAL_ADAPTIVE_PERP_INPUT_INVALID",
  "ABSTAIN_DUAL_ADAPTIVE_VENUE_DECISIONS_DISAGREE",
  "PUBLISH_DUAL_ADAPTIVE_SPOT_PERP_AGREE",
] as const;
export type DualAdaptiveReason = (typeof DUAL_ADAPTIVE_REASONS)[number];

const VERSION_OR_HASH_GATES = new Set([
  "VENUE_MISMATCH",
  "SYMBOL_MISMATCH",
  "FEATURE_VERSION_MISMATCH",
  "COLLECTOR_VERSION_MISMATCH",
  "CONFIG_HASH_MISMATCH",
  "FEATURE_SCHEMA_HASH_MISMATCH",
  "TARGET_TS_MISMATCH",
]);

export interface DualAdaptiveInput {
  targetTs: string;
  spot: MarketReadiness | null;
  perp: MarketReadiness | null;
  /** Committed activation boundary; null = not activated yet. */
  activationTargetTs?: string | null;
}

export interface DualAdaptiveDecision {
  modelVersion: typeof MODEL_VERSION;
  policyVersion: typeof POLICY_VERSION;
  implementationRevision: typeof IMPLEMENTATION_REVISION;
  featureSchema: typeof FEATURE_SCHEMA;
  configHash: string;
  variant: typeof VARIANT;
  activationTargetTs: string | null;
  activated: boolean;
  spot: MarketAdaptive;
  perp: MarketAdaptive;
  ready: boolean;
  readyReason: DualAdaptiveReason | null;
  detailedReason: string | null;
  venueAgreement: boolean;
  candidateDirection: Direction | null;
  finalPrediction: Direction | null;
  wouldTrade: boolean;
  decisionReason: DualAdaptiveReason;
}

/**
 * Frozen dual-venue decision. First-match abstention ordering:
 * activation -> feature presence -> readiness -> version/hash -> inputs -> agreement.
 */
export function decideDualAdaptive(input: DualAdaptiveInput): DualAdaptiveDecision {
  const spot = evaluateMarketAdaptive(input.spot);
  const perp = evaluateMarketAdaptive(input.perp);
  const configHash = dualAdaptiveConfigHash();
  const activationTargetTs = input.activationTargetTs ?? null;
  const activated =
    activationTargetTs != null &&
    new Date(input.targetTs).getTime() >= new Date(activationTargetTs).getTime();

  const base = {
    modelVersion: MODEL_VERSION,
    policyVersion: POLICY_VERSION,
    implementationRevision: IMPLEMENTATION_REVISION,
    featureSchema: FEATURE_SCHEMA,
    configHash,
    variant: VARIANT,
    activationTargetTs,
    activated,
    spot,
    perp,
  } as const;

  const abstain = (
    reason: DualAdaptiveReason,
    detailedReason: string | null,
    ready: boolean,
  ): DualAdaptiveDecision => ({
    ...base,
    ready,
    readyReason: reason,
    detailedReason,
    venueAgreement: false,
    candidateDirection: null,
    finalPrediction: null,
    wouldTrade: false,
    decisionReason: reason,
  });

  // 1. activation
  if (!activated) {
    return abstain(
      "ABSTAIN_DUAL_ADAPTIVE_ACTIVATION_NOT_REACHED",
      activationTargetTs == null ? "NO_ACTIVATION_RECORD" : `ACTIVATES_AT_${activationTargetTs}`,
      false,
    );
  }

  // 2. exact-target feature presence
  if (input.spot == null || spot.gateReason === "NO_BOUNDARY_FEATURE") {
    return abstain("ABSTAIN_DUAL_ADAPTIVE_SPOT_FEATURE_MISSING", "NO_BOUNDARY_FEATURE", false);
  }
  if (input.perp == null || perp.gateReason === "NO_BOUNDARY_FEATURE") {
    return abstain("ABSTAIN_DUAL_ADAPTIVE_PERP_FEATURE_MISSING", "NO_BOUNDARY_FEATURE", false);
  }

  // 3. version / hash identity (checked before generic readiness so an
  //    identity drift is never reported as a transient readiness failure)
  if (spot.gateReason != null && VERSION_OR_HASH_GATES.has(spot.gateReason)) {
    return abstain(
      "ABSTAIN_DUAL_ADAPTIVE_VERSION_OR_HASH_MISMATCH",
      `SPOT_${spot.gateReason}`,
      false,
    );
  }
  if (perp.gateReason != null && VERSION_OR_HASH_GATES.has(perp.gateReason)) {
    return abstain(
      "ABSTAIN_DUAL_ADAPTIVE_VERSION_OR_HASH_MISMATCH",
      `PERP_${perp.gateReason}`,
      false,
    );
  }

  // 4. canonical Binance readiness
  if (spot.gateReason != null) {
    return abstain("ABSTAIN_DUAL_ADAPTIVE_SPOT_NOT_READY", spot.gateReason, false);
  }
  if (perp.gateReason != null) {
    return abstain("ABSTAIN_DUAL_ADAPTIVE_PERP_NOT_READY", perp.gateReason, false);
  }

  // 5. decision inputs finite and nonzero
  if (spot.inputInvalidReason != null) {
    return abstain("ABSTAIN_DUAL_ADAPTIVE_SPOT_INPUT_INVALID", spot.inputInvalidReason, true);
  }
  if (perp.inputInvalidReason != null) {
    return abstain("ABSTAIN_DUAL_ADAPTIVE_PERP_INPUT_INVALID", perp.inputInvalidReason, true);
  }

  // 6. cross-venue agreement
  if (spot.direction !== perp.direction) {
    return {
      ...base,
      ready: true,
      readyReason: null,
      detailedReason: `SPOT_${spot.mode}_${spot.direction}_VS_PERP_${perp.mode}_${perp.direction}`,
      venueAgreement: false,
      candidateDirection: null,
      finalPrediction: null,
      wouldTrade: false,
      decisionReason: "ABSTAIN_DUAL_ADAPTIVE_VENUE_DECISIONS_DISAGREE",
    };
  }

  return {
    ...base,
    ready: true,
    readyReason: null,
    detailedReason: `SPOT_${spot.mode}_PERP_${perp.mode}`,
    venueAgreement: true,
    candidateDirection: spot.direction,
    finalPrediction: spot.direction,
    wouldTrade: true,
    decisionReason: "PUBLISH_DUAL_ADAPTIVE_SPOT_PERP_AGREE",
  };
}

// ---- counterfactual shadows -------------------------------------------

export const DUAL_ADAPTIVE_SHADOW_POLICIES = [
  "BINANCE_SPOT_ADAPTIVE_ONLY_R1",
  "BINANCE_PERP_ADAPTIVE_ONLY_R1",
  "BINANCE_SPOT_FOLLOW_FIXED_R1",
  "BINANCE_SPOT_FADE_FIXED_R1",
  "BINANCE_SPOT_PERSISTENT_FOLLOW_FIXED_R1",
  "BINANCE_SPOT_PERSISTENT_FADE_FIXED_R1",
  "BINANCE_SPOT_PERP_CONSENSUS_FOLLOW_FIXED_R1",
  "BINANCE_SPOT_PERP_CONSENSUS_FADE_FIXED_R1",
] as const;
export type DualAdaptiveShadowPolicy = (typeof DUAL_ADAPTIVE_SHADOW_POLICIES)[number];

export interface DualAdaptiveShadow {
  policy_name: DualAdaptiveShadowPolicy;
  qualified: boolean;
  qualification_reason: string;
  candidate_direction: Direction | null;
  would_trade: boolean;
}

const invert = (d: Direction | null): Direction | null =>
  d === "GREEN" ? "RED" : d === "RED" ? "GREEN" : null;

/**
 * Reporting-only counterfactuals evaluated from the same frozen inputs.
 * "Persistent" means the final and mean-60 signs match on that market.
 */
export function evaluateDualAdaptiveShadows(
  decision: DualAdaptiveDecision,
): DualAdaptiveShadow[] {
  const { spot, perp } = decision;
  const out: DualAdaptiveShadow[] = [];
  const push = (
    policy_name: DualAdaptiveShadowPolicy,
    direction: Direction | null,
    reason: string,
  ) =>
    out.push({
      policy_name,
      qualified: direction != null,
      qualification_reason: direction != null ? "QUALIFIED" : reason,
      candidate_direction: direction,
      would_trade: direction != null,
    });

  const spotReady = spot.gateReason == null && spot.inputInvalidReason == null;
  const perpReady = perp.gateReason == null && perp.inputInvalidReason == null;
  const spotFollow = spotReady ? directionOfSign(spot.finalSign) : null;
  const perpFollow = perpReady ? directionOfSign(perp.finalSign) : null;
  const spotPersistent = spotReady && spot.finalSign === spot.mean60Sign;

  push("BINANCE_SPOT_ADAPTIVE_ONLY_R1", spot.direction, spot.gateReason ?? spot.inputInvalidReason ?? "UNAVAILABLE");
  push("BINANCE_PERP_ADAPTIVE_ONLY_R1", perp.direction, perp.gateReason ?? perp.inputInvalidReason ?? "UNAVAILABLE");
  push("BINANCE_SPOT_FOLLOW_FIXED_R1", spotFollow, "SPOT_INPUT_UNAVAILABLE");
  push("BINANCE_SPOT_FADE_FIXED_R1", invert(spotFollow), "SPOT_INPUT_UNAVAILABLE");
  push(
    "BINANCE_SPOT_PERSISTENT_FOLLOW_FIXED_R1",
    spotPersistent ? spotFollow : null,
    spotReady ? "SPOT_NOT_PERSISTENT" : "SPOT_INPUT_UNAVAILABLE",
  );
  push(
    "BINANCE_SPOT_PERSISTENT_FADE_FIXED_R1",
    spotPersistent ? invert(spotFollow) : null,
    spotReady ? "SPOT_NOT_PERSISTENT" : "SPOT_INPUT_UNAVAILABLE",
  );
  const consensus = spotFollow != null && spotFollow === perpFollow ? spotFollow : null;
  push(
    "BINANCE_SPOT_PERP_CONSENSUS_FOLLOW_FIXED_R1",
    consensus,
    spotFollow == null || perpFollow == null ? "INPUT_UNAVAILABLE" : "VENUES_DISAGREE",
  );
  push(
    "BINANCE_SPOT_PERP_CONSENSUS_FADE_FIXED_R1",
    invert(consensus),
    spotFollow == null || perpFollow == null ? "INPUT_UNAVAILABLE" : "VENUES_DISAGREE",
  );
  return out;
}

// ---- scoring -----------------------------------------------------------

export type ActualDirection = "GREEN" | "RED" | "PUSH";

export function scoreDualAdaptive(
  direction: Direction | null,
  actual: ActualDirection | null,
): { result: "WIN" | "LOSS" | "PUSH" | "ABSTAIN"; score: number } {
  if (!direction) return { result: "ABSTAIN", score: 0 };
  if (!actual) return { result: "ABSTAIN", score: 0 };
  if (actual === "PUSH") return { result: "PUSH", score: 0 };
  return direction === actual ? { result: "WIN", score: 1 } : { result: "LOSS", score: -1 };
}

/** Stable prediction-time input snapshot hash. */
export function dualAdaptiveInputHash(decision: DualAdaptiveDecision, targetTs: string): string {
  return createHash("sha256")
    .update(
      JSON.stringify({
        target_ts: targetTs,
        policy_version: POLICY_VERSION,
        config_hash: decision.configHash,
        spot_final: decision.spot.finalImbalance10bps,
        spot_mean60: decision.spot.meanImbalance10bps60s,
        spot_feature_id: decision.spot.featureId,
        perp_final: decision.perp.finalImbalance10bps,
        perp_mean60: decision.perp.meanImbalance10bps60s,
        perp_feature_id: decision.perp.featureId,
      }),
    )
    .digest("hex");
}
