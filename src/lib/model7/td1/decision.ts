// TD1-RC scoring + decision. Faithful port of td1_rc_reference.ts.

export type Side = "YES" | "NO";
export type ExternalDecision = Side | "SKIP";

export const TD1_FEATURE_ORDER = [
  "current_side",
  "current_directional_confidence",
  "same_side_share_8",
  "signed_lean_8",
  "same_direction_run_length",
  "sigma_20",
  "opposing_drift_4",
  "opposing_drift_8",
  "opposing_drift_12",
  "efficiency_ratio_8",
  "reversal_rate_8",
  "oriented_close_position_8",
  "oriented_structure_shift_4",
  "short_long_drift_shift",
  "bias_origin_displacement",
  "bias_origin_hold_count",
] as const;

export type Td1FeatureName = typeof TD1_FEATURE_ORDER[number];
export type Td1Features = Record<Td1FeatureName, number>;

export interface TreeNode {
  leaf?: { lossProbability: number; sampleCount: number; lossCount: number };
  featureIndex?: number;
  threshold?: number;
  left?: TreeNode;
  right?: TreeNode;
}

export interface Td1Artifact {
  schemaVersion: "1.0.0";
  fitId: string;
  baseVariant: "A2_Combined";
  trainedThroughCandleTs: string;
  featureOrder: readonly Td1FeatureName[];
  tree: TreeNode;
  artifactSha256: string;
}

export interface ContainmentConsumption {
  vetoFired: boolean;
  slotsBefore: number;
  slotsAfter: number;
  episodeArmed: boolean;
}

export interface Td1PolicyOutcome {
  decision: ExternalDecision;
  wouldTrade: boolean;
  reasons: string[];
  primaryReason: string | null;
}

export interface Td1RcDecision {
  externalFinalDecision: ExternalDecision;
  wouldTrade: boolean;
  td1LossProbability: number;
  td1VetoFired: boolean;
  containmentVetoFired: boolean;
  allVetoReasons: string[];
  primarySkipReason: string | null;
  // --- td1-rc-compressed-risk-v1 ---
  compressedRiskEvaluable: boolean;
  compressedRiskCondition: boolean;
  compressedRiskVetoFired: boolean;
  compressedRiskReason: string | null;
  legacyGlobalVetoCondition: boolean;
  /** Direction that would have been published had no gate fired. */
  underlyingDirection: Side;
  /** Audit-only replay of the exact pre-patch policy. Never published. */
  previousPolicy: Td1PolicyOutcome;
  /** Audit-only replay with compressed-risk active and the 0.60 gate disabled. */
  noGlobalVetoPolicy: Td1PolicyOutcome;
}

function buildOutcome(side: Side, reasons: string[]): Td1PolicyOutcome {
  const skip = reasons.length > 0;
  return {
    decision: skip ? "SKIP" : side,
    wouldTrade: !skip,
    reasons,
    primaryReason: reasons[0] ?? null,
  };
}

export function decideTd1Rc(args: {
  a2FinalDecision: Side;
  features: Td1Features;
  artifact: Td1Artifact;
  containment: ContainmentConsumption;
  threshold?: number;
  /** Prediction-time compressed-risk evaluation for this candle. */
  compressedRisk?: { evaluable: boolean; condition: boolean; reason: string | null };
}): Td1RcDecision {
  const threshold = args.threshold ?? TD1_GLOBAL_TURN_RISK_THRESHOLD;
  const pLoss = scoreTree(args.artifact.tree, args.features);
  const td1Veto = pLoss >= threshold;
  const containmentVeto = args.containment.vetoFired;

  const cr = args.compressedRisk ?? { evaluable: false, condition: false, reason: null };
  const compressedVeto = cr.condition === true;

  // Active policy, first-match order: compressed risk -> containment -> global
  // turn risk. The legacy gates keep their existing relative order.
  const reasons: string[] = [];
  if (compressedVeto) reasons.push(ABSTAIN_TD1_COMPRESSED_RISK);
  if (containmentVeto) reasons.push("DIRECTIONAL_CONTAINMENT");
  if (td1Veto) reasons.push("TD1_TURN_RISK");
  const active = buildOutcome(args.a2FinalDecision, reasons);

  // Audit-only counterfactual 1: exact pre-patch decision tree.
  const prevReasons: string[] = [];
  if (containmentVeto) prevReasons.push("DIRECTIONAL_CONTAINMENT");
  if (td1Veto) prevReasons.push("TD1_TURN_RISK");

  // Audit-only counterfactual 2: compressed risk active, global 0.60 disabled.
  const noGlobalReasons: string[] = [];
  if (compressedVeto) noGlobalReasons.push(ABSTAIN_TD1_COMPRESSED_RISK);
  if (containmentVeto) noGlobalReasons.push("DIRECTIONAL_CONTAINMENT");

  return {
    externalFinalDecision: active.decision,
    wouldTrade: active.wouldTrade,
    td1LossProbability: pLoss,
    td1VetoFired: td1Veto,
    containmentVetoFired: containmentVeto,
    allVetoReasons: active.reasons,
    primarySkipReason: active.primaryReason,
    compressedRiskEvaluable: cr.evaluable === true,
    compressedRiskCondition: compressedVeto,
    compressedRiskVetoFired: compressedVeto,
    compressedRiskReason: compressedVeto ? ABSTAIN_TD1_COMPRESSED_RISK : null,
    legacyGlobalVetoCondition: td1Veto,
    underlyingDirection: args.a2FinalDecision,
    previousPolicy: buildOutcome(args.a2FinalDecision, prevReasons),
    noGlobalVetoPolicy: buildOutcome(args.a2FinalDecision, noGlobalReasons),
  };
}


export function resolveA2Counterfactual(side: Side, actual: "GREEN" | "RED"): "WIN" | "LOSS" {
  return (side === "YES" && actual === "GREEN") || (side === "NO" && actual === "RED") ? "WIN" : "LOSS";
}
