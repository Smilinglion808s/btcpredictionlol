// B4x4-ES1 Balanced Binance 3-of-4 R1 — frozen, pure decision policy.
//
// Four equally weighted directional votes decide the active B4x4-ES1 direction:
//   1. certified ES1 price-head direction
//   2. Binance Global SPOT 10-bps depth imbalance (follow)
//   3. Binance Global SPOT 60s normalized OFI (follow)
//   4. Binance Global USD-M PERP 10-bps depth imbalance (FADED)
//
// All four votes are required and must be nonzero. 3-of-4 or 4-of-4 publishes;
// a 2-2 tie abstains. Nothing in this module reads outcomes, running state,
// time of day, magnitudes, A2, the B4 grid, brakes or any prior decision.

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

// ---- frozen identity ---------------------------------------------------

export const BALANCED_MODEL_NAME = "B4x4-ES1" as const;
export const BALANCED_MODEL_VERSION = "b4x4-es1-balanced-binance-r1" as const;
export const BALANCED_VARIANT = "es1-binance-3of4-balanced" as const;
export const BALANCED_DECISION_POLICY_VERSION = "ES1_BINANCE_3OF4_BALANCED_R1" as const;
export const BALANCED_PROSPECTIVE_TEST_ID = "B4X4_ES1_BINANCE_3OF4_BALANCED_R1" as const;
export const BALANCED_FEATURE_SCHEMA =
  "es1-price-spot-depth-spot-ofi60-perp-fade-votes-r1" as const;
export const BALANCED_IMPLEMENTATION_REVISION = "b4x4-es1-live-balanced-binance-r1" as const;
export const LEGACY_POLICY_VERSION = "LEGACY_B4X4_ES1_POLICY" as const;

/** The exact frozen configuration the config hash is computed over. */
export const BALANCED_POLICY_CONFIG = {
  model_name: BALANCED_MODEL_NAME,
  model_version: BALANCED_MODEL_VERSION,
  variant: BALANCED_VARIANT,
  decision_policy_version: BALANCED_DECISION_POLICY_VERSION,
  prospective_test_id: BALANCED_PROSPECTIVE_TEST_ID,
  feature_schema: BALANCED_FEATURE_SCHEMA,
  implementation_revision: BALANCED_IMPLEMENTATION_REVISION,
  votes: [
    { id: "ES1", source: "ES1_CERTIFIED_PRICE_DIRECTION", fade: false },
    { id: "SPOT_DEPTH", source: "SPOT.final_imbalance_10bps", fade: false },
    { id: "SPOT_OFI60", source: "SPOT.normalized_ofi_60s", fade: false },
    { id: "PERP_FADE", source: "USD_M_PERP.final_imbalance_10bps", fade: true },
  ],
  required_votes: 4,
  publish_min_agreement: 3,
  tie_action: "ABSTAIN",
  venue: BINANCE_OB_VENUE,
  symbol: BINANCE_OB_SYMBOL,
  binance_feature_version: BINANCE_OB_VERSION,
  binance_collector_version: BINANCE_OB_COLLECTOR_VERSION,
  min_observations: MIN_READY_OBSERVATIONS,
  target_age_ms: [MIN_TARGET_AGE_MS, MAX_TARGET_AGE_MS],
  require_resync_continuous: true,
  require_history_ready: false,
  uses_percentiles: false,
  uses_magnitudes: false,
  uses_outcomes: false,
} as const;

let _hash: string | null = null;
export function balancedConfigHash(): string {
  _hash ??= createHash("sha256")
    .update(
      JSON.stringify({
        policy: BALANCED_POLICY_CONFIG,
        binance_config_hash: binanceObConfigHash(),
        binance_feature_schema_hash: binanceObFeatureSchemaHash(),
      }),
    )
    .digest("hex");
  return _hash;
}

// ---- types -------------------------------------------------------------

export type Direction = "GREEN" | "RED";
export type Vote = 1 | -1 | null;

export type AgreementTier =
  | "UNANIMOUS_4_OF_4"
  | "MAJORITY_3_OF_4"
  | "TIE_2_OF_2"
  | "INPUT_NOT_READY";

export type BalancedDecisionReason =
  | "PUBLISH_BALANCED_4_OF_4_GREEN"
  | "PUBLISH_BALANCED_4_OF_4_RED"
  | "PUBLISH_BALANCED_3_OF_4_GREEN"
  | "PUBLISH_BALANCED_3_OF_4_RED"
  | "ABSTAIN_BALANCED_VOTE_TIE_2_2"
  | "ABSTAIN_ES1_NOT_PARITY_CERTIFIED"
  | "ABSTAIN_ES1_DIRECTION_INVALID"
  | "ABSTAIN_BINANCE_SPOT_NOT_READY"
  | "ABSTAIN_BINANCE_PERP_NOT_READY"
  | "ABSTAIN_BINANCE_SEQUENCE_NOT_CONTINUOUS"
  | "ABSTAIN_BINANCE_FEATURE_INVALID"
  | "ABSTAIN_BALANCED_ACTIVATION_NOT_REACHED";

export interface Es1VoteInput {
  /** ES1 certified price-head direction for the exact target. */
  priceDirection: Direction | null;
  parityCertified: boolean;
  probabilityGreen: number | null;
  confidence: number | null;
  priceFitId: string | null;
  priceFitSource: string | null;
}

/** One Binance market's readiness view, derived from its boundary feature row. */
export interface MarketReadiness {
  featureId: string | null;
  featureValuesHash: string | null;
  captureStatus: string | null;
  ready: boolean;
  readyReason: string | null;
  resyncContinuous: boolean | null;
  finalImbalance10bps: number | null;
  normalizedOfi60s: number | null;
  /** null when every gate passed, otherwise the first failing gate. */
  gateReason: string | null;
  /** True when the only failure is sequence/resync continuity. */
  continuityFailure: boolean;
}

export interface BalancedInput {
  targetTs: string;
  es1: Es1VoteInput;
  spot: MarketReadiness;
  perp: MarketReadiness;
  /** Activation boundary for the balanced policy; null = not activated. */
  activationBoundaryTs?: string | null;
}

export interface BalancedDecision {
  policyVersion: typeof BALANCED_DECISION_POLICY_VERSION;
  configHash: string;
  featureSchema: typeof BALANCED_FEATURE_SCHEMA;
  activationBoundaryTs: string | null;
  es1Vote: Vote;
  spotDepthVote: Vote;
  spotOfi60Vote: Vote;
  perpFadeVote: Vote;
  greenVoteCount: number;
  redVoteCount: number;
  voteSum: number | null;
  voteMargin: number | null;
  votePattern: string;
  agreementTier: AgreementTier;
  finalPrediction: Direction | null;
  wouldTrade: boolean;
  decisionReason: BalancedDecisionReason;
}

// ---- gates -------------------------------------------------------------

const num = (v: unknown): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;

export interface MarketGateOptions {
  targetTs: string;
  expectedConfigHash?: string;
  expectedFeatureSchemaHash?: string;
}

/**
 * Fail-closed readiness gate for one Binance market boundary feature row.
 * Returns a `MarketReadiness` view; `gateReason` is the first failing rule.
 */
export function marketReadinessFrom(
  row: Record<string, unknown> | null,
  opts: MarketGateOptions,
): MarketReadiness {
  const base: MarketReadiness = {
    featureId: (row?.id as string | undefined) ?? null,
    featureValuesHash: (row?.feature_values_hash as string | undefined) ?? null,
    captureStatus: (row?.capture_status as string | undefined) ?? null,
    ready: row?.ready === true,
    readyReason: (row?.ready_reason as string | undefined) ?? null,
    resyncContinuous:
      typeof row?.resync_continuous === "boolean" ? (row.resync_continuous as boolean) : null,
    finalImbalance10bps: num(row?.final_imbalance_10bps),
    normalizedOfi60s: num(row?.normalized_ofi_60s),
    gateReason: null,
    continuityFailure: false,
  };
  const fail = (reason: string, continuity = false): MarketReadiness => ({
    ...base,
    gateReason: reason,
    continuityFailure: continuity,
  });

  if (!row) return fail("NO_BOUNDARY_FEATURE");

  const rowTargetMs = new Date(String(row.target_ts)).getTime();
  if (rowTargetMs !== new Date(opts.targetTs).getTime()) return fail("TARGET_TS_MISMATCH");
  if (row.venue !== BINANCE_OB_VENUE) return fail("VENUE_MISMATCH");
  if (row.symbol !== BINANCE_OB_SYMBOL) return fail("SYMBOL_MISMATCH");
  if (row.feature_version !== BINANCE_OB_VERSION) return fail("FEATURE_VERSION_MISMATCH");
  if (row.collector_version !== BINANCE_OB_COLLECTOR_VERSION) {
    return fail("COLLECTOR_VERSION_MISMATCH");
  }
  const expectedConfig = opts.expectedConfigHash ?? binanceObConfigHash();
  const expectedSchema = opts.expectedFeatureSchemaHash ?? binanceObFeatureSchemaHash();
  if (row.config_hash !== expectedConfig) return fail("CONFIG_HASH_MISMATCH");
  if (row.feature_schema_hash !== expectedSchema) return fail("FEATURE_SCHEMA_HASH_MISMATCH");

  if (row.capture_status !== "FRESH") return fail("CAPTURE_NOT_FRESH");
  if (row.ready !== true) return fail(`NOT_READY_${String(row.ready_reason ?? "UNKNOWN")}`);
  if (row.sequence_ok !== true) return fail("SEQUENCE_NOT_OK", true);
  if (row.book_complete_10bps !== true) return fail("BOOK_INCOMPLETE_10BPS");
  if (row.resync_continuous !== true) return fail("RESYNC_NOT_CONTINUOUS", true);
  const genMin = num(row.resync_generation_min);
  const genMax = num(row.resync_generation_max);
  if (genMin == null || genMax == null || genMin !== genMax) {
    return fail("RESYNC_GENERATION_SPLIT", true);
  }
  if (row.final_received_at == null || row.final_exchange_event_ts == null) {
    return fail("NO_FINAL_OBSERVATION");
  }
  const age = num(row.final_target_age_ms);
  if (age == null || age < MIN_TARGET_AGE_MS || age > MAX_TARGET_AGE_MS) {
    return fail("TARGET_AGE_OUT_OF_RANGE");
  }
  const obs = num(row.observation_count_60s);
  if (obs == null || obs < MIN_READY_OBSERVATIONS) return fail("INSUFFICIENT_OBSERVATIONS");

  return base;
}

/** Feature-value gate for the two SPOT inputs / one PERP input actually voted on. */
function featureValueReason(m: MarketReadiness, needOfi: boolean): string | null {
  if (m.finalImbalance10bps == null) return "IMBALANCE_10BPS_INVALID";
  if (m.finalImbalance10bps === 0) return "IMBALANCE_10BPS_ZERO";
  if (needOfi) {
    if (m.normalizedOfi60s == null) return "NORMALIZED_OFI_60S_INVALID";
    if (m.normalizedOfi60s === 0) return "NORMALIZED_OFI_60S_ZERO";
  }
  return null;
}

// ---- votes -------------------------------------------------------------

export function signVote(value: number | null | undefined, fade = false): Vote {
  if (typeof value !== "number" || !Number.isFinite(value) || value === 0) return null;
  const follow: Vote = value > 0 ? 1 : -1;
  if (!fade) return follow;
  return follow === 1 ? -1 : 1;
}

export function directionOfVote(vote: Vote): Direction | null {
  return vote === 1 ? "GREEN" : vote === -1 ? "RED" : null;
}

function label(vote: Vote): string {
  return vote === 1 ? "GREEN" : vote === -1 ? "RED" : "NONE";
}

export function votePatternOf(
  es1: Vote,
  spotDepth: Vote,
  spotOfi: Vote,
  perpFade: Vote,
): string {
  return [
    `ES1=${label(es1)}`,
    `SPOT_DEPTH=${label(spotDepth)}`,
    `SPOT_OFI60=${label(spotOfi)}`,
    `PERP_FADE=${label(perpFade)}`,
  ].join("|");
}

// ---- active decision ---------------------------------------------------

export function decideBalanced(input: BalancedInput): BalancedDecision {
  const es1Vote: Vote =
    input.es1.priceDirection === "GREEN" ? 1 : input.es1.priceDirection === "RED" ? -1 : null;
  const spotDepthVote = signVote(input.spot.finalImbalance10bps);
  const spotOfi60Vote = signVote(input.spot.normalizedOfi60s);
  const perpFadeVote = signVote(input.perp.finalImbalance10bps, true);

  const votes: Vote[] = [es1Vote, spotDepthVote, spotOfi60Vote, perpFadeVote];
  const greenVoteCount = votes.filter((v) => v === 1).length;
  const redVoteCount = votes.filter((v) => v === -1).length;
  const allValid = votes.every((v) => v === 1 || v === -1);

  const shell = {
    policyVersion: BALANCED_DECISION_POLICY_VERSION,
    configHash: balancedConfigHash(),
    featureSchema: BALANCED_FEATURE_SCHEMA,
    activationBoundaryTs: input.activationBoundaryTs ?? null,
    es1Vote,
    spotDepthVote,
    spotOfi60Vote,
    perpFadeVote,
    greenVoteCount,
    redVoteCount,
    voteSum: allValid ? greenVoteCount - redVoteCount : null,
    voteMargin: allValid ? Math.abs(greenVoteCount - redVoteCount) : null,
    votePattern: votePatternOf(es1Vote, spotDepthVote, spotOfi60Vote, perpFadeVote),
  } as const;

  const abstain = (
    reason: BalancedDecisionReason,
    tier: AgreementTier = "INPUT_NOT_READY",
  ): BalancedDecision => ({
    ...shell,
    agreementTier: tier,
    finalPrediction: null,
    wouldTrade: false,
    decisionReason: reason,
  });

  // First-match deterministic ordering.
  if (!input.es1.parityCertified) return abstain("ABSTAIN_ES1_NOT_PARITY_CERTIFIED");
  if (es1Vote == null) return abstain("ABSTAIN_ES1_DIRECTION_INVALID");

  if (input.spot.continuityFailure || input.perp.continuityFailure) {
    return abstain("ABSTAIN_BINANCE_SEQUENCE_NOT_CONTINUOUS");
  }
  if (input.spot.gateReason) return abstain("ABSTAIN_BINANCE_SPOT_NOT_READY");
  if (input.perp.gateReason) return abstain("ABSTAIN_BINANCE_PERP_NOT_READY");
  if (featureValueReason(input.spot, true) || featureValueReason(input.perp, false)) {
    return abstain("ABSTAIN_BINANCE_FEATURE_INVALID");
  }
  if (!allValid) return abstain("ABSTAIN_BINANCE_FEATURE_INVALID");

  if (greenVoteCount === 2 && redVoteCount === 2) {
    return abstain("ABSTAIN_BALANCED_VOTE_TIE_2_2", "TIE_2_OF_2");
  }

  const direction: Direction = greenVoteCount >= 3 ? "GREEN" : "RED";
  const unanimous = greenVoteCount === 4 || redVoteCount === 4;
  const reason = (
    unanimous
      ? direction === "GREEN"
        ? "PUBLISH_BALANCED_4_OF_4_GREEN"
        : "PUBLISH_BALANCED_4_OF_4_RED"
      : direction === "GREEN"
        ? "PUBLISH_BALANCED_3_OF_4_GREEN"
        : "PUBLISH_BALANCED_3_OF_4_RED"
  ) as BalancedDecisionReason;

  return {
    ...shell,
    agreementTier: unanimous ? "UNANIMOUS_4_OF_4" : "MAJORITY_3_OF_4",
    finalPrediction: direction,
    wouldTrade: true,
    decisionReason: reason,
  };
}

/**
 * Activation gate applied on top of a decision. Before the activation boundary
 * the balanced policy records everything but never trades.
 */
export function applyActivationGate(
  decision: BalancedDecision,
  targetTs: string,
  activationBoundaryTs: string | null,
): BalancedDecision {
  if (!decision.wouldTrade) return decision;
  const activeFrom = activationBoundaryTs ? new Date(activationBoundaryTs).getTime() : null;
  if (activeFrom != null && new Date(targetTs).getTime() >= activeFrom) return decision;
  return {
    ...decision,
    finalPrediction: null,
    wouldTrade: false,
    decisionReason: "ABSTAIN_BALANCED_ACTIVATION_NOT_REACHED",
  };
}

// ---- shadow policies ---------------------------------------------------

export const BALANCED_SHADOW_POLICIES = [
  "ES1_PRICE_HEAD_ALL_R1",
  "BINANCE_SPOT_DEPTH_FOLLOW_R1",
  "ES1_SPOT_DEPTH_CONFIRM_R1",
  "BINANCE_SPOT_DEPTH_OFI60_CONFIRM_R1",
  "BINANCE_SPOT_PERP_FADE_AGREE_R1",
  "BINANCE_OB_UNANIMOUS_3OF3_R1",
  "ES1_BINANCE_UNANIMOUS_4OF4_R1",
  "ES1_BINANCE_3OF4_BALANCED_R1",
  "LEGACY_B4X4_ES1_POLICY",
] as const;
export type BalancedShadowPolicy = (typeof BALANCED_SHADOW_POLICIES)[number];

export interface ShadowEvaluation {
  policy_name: BalancedShadowPolicy;
  qualified: boolean;
  qualification_reason: string;
  candidate_direction: Direction | null;
  would_trade: boolean;
  agreement_tier: AgreementTier | null;
  is_active_policy: boolean;
}

export interface LegacyCounterfactual {
  direction: Direction | null;
  wouldTrade: boolean;
  decisionReason: string;
}

/** All nine comparison policies, evaluated from the same frozen votes. */
export function evaluateBalancedShadowPolicies(
  decision: BalancedDecision,
  legacy: LegacyCounterfactual,
): ShadowEvaluation[] {
  const { es1Vote, spotDepthVote, spotOfi60Vote, perpFadeVote } = decision;
  const out: ShadowEvaluation[] = [];

  const push = (
    policy_name: BalancedShadowPolicy,
    direction: Direction | null,
    reason: string,
    tier: AgreementTier | null = null,
  ) =>
    out.push({
      policy_name,
      qualified: direction != null,
      qualification_reason: direction != null ? "QUALIFIED" : reason,
      candidate_direction: direction,
      would_trade: direction != null,
      agreement_tier: tier,
      is_active_policy: policy_name === "ES1_BINANCE_3OF4_BALANCED_R1",
    });

  const agree = (...votes: Vote[]): Direction | null => {
    if (votes.some((v) => v !== 1 && v !== -1)) return null;
    return votes.every((v) => v === votes[0]) ? directionOfVote(votes[0]!) : null;
  };

  push(
    "ES1_PRICE_HEAD_ALL_R1",
    directionOfVote(es1Vote),
    es1Vote == null ? "ES1_VOTE_UNAVAILABLE" : "",
  );
  push(
    "BINANCE_SPOT_DEPTH_FOLLOW_R1",
    directionOfVote(spotDepthVote),
    spotDepthVote == null ? "SPOT_DEPTH_VOTE_UNAVAILABLE" : "",
  );
  push(
    "ES1_SPOT_DEPTH_CONFIRM_R1",
    agree(es1Vote, spotDepthVote),
    es1Vote == null || spotDepthVote == null ? "INPUT_UNAVAILABLE" : "VOTES_DISAGREE",
  );
  push(
    "BINANCE_SPOT_DEPTH_OFI60_CONFIRM_R1",
    agree(spotDepthVote, spotOfi60Vote),
    spotDepthVote == null || spotOfi60Vote == null ? "INPUT_UNAVAILABLE" : "VOTES_DISAGREE",
  );
  push(
    "BINANCE_SPOT_PERP_FADE_AGREE_R1",
    agree(spotDepthVote, perpFadeVote),
    spotDepthVote == null || perpFadeVote == null ? "INPUT_UNAVAILABLE" : "VOTES_DISAGREE",
  );
  push(
    "BINANCE_OB_UNANIMOUS_3OF3_R1",
    agree(spotDepthVote, spotOfi60Vote, perpFadeVote),
    spotDepthVote == null || spotOfi60Vote == null || perpFadeVote == null
      ? "INPUT_UNAVAILABLE"
      : "VOTES_DISAGREE",
  );
  push(
    "ES1_BINANCE_UNANIMOUS_4OF4_R1",
    agree(es1Vote, spotDepthVote, spotOfi60Vote, perpFadeVote),
    [es1Vote, spotDepthVote, spotOfi60Vote, perpFadeVote].some((v) => v == null)
      ? "INPUT_UNAVAILABLE"
      : "VOTES_DISAGREE",
    decision.agreementTier,
  );
  out.push({
    policy_name: "ES1_BINANCE_3OF4_BALANCED_R1",
    qualified: decision.wouldTrade,
    qualification_reason: decision.wouldTrade ? "QUALIFIED" : decision.decisionReason,
    candidate_direction: decision.finalPrediction,
    would_trade: decision.wouldTrade,
    agreement_tier: decision.agreementTier,
    is_active_policy: true,
  });
  out.push({
    policy_name: "LEGACY_B4X4_ES1_POLICY",
    qualified: legacy.wouldTrade,
    qualification_reason: legacy.wouldTrade ? "QUALIFIED" : legacy.decisionReason,
    candidate_direction: legacy.wouldTrade ? legacy.direction : null,
    would_trade: legacy.wouldTrade,
    agreement_tier: null,
    is_active_policy: false,
  });
  return out;
}

// ---- scoring -----------------------------------------------------------

export type ActualDirection = "GREEN" | "RED" | "PUSH";

export function scoreDirection(
  direction: Direction | null,
  actual: ActualDirection | null,
): { result: "WIN" | "LOSS" | "PUSH" | null; score: number } {
  if (!direction || !actual) return { result: null, score: 0 };
  if (actual === "PUSH") return { result: "PUSH", score: 0 };
  return direction === actual ? { result: "WIN", score: 1 } : { result: "LOSS", score: -1 };
}

/** Incremental value of the balanced policy versus the legacy counterfactual. */
export function incrementalValue(
  activeScore: number | null,
  legacyScore: number | null,
): number | null {
  if (activeScore == null && legacyScore == null) return null;
  return (activeScore ?? 0) - (legacyScore ?? 0);
}
