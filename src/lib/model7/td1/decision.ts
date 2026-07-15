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

export interface Td1RcDecision {
  externalFinalDecision: ExternalDecision;
  wouldTrade: boolean;
  td1LossProbability: number;
  td1VetoFired: boolean;
  containmentVetoFired: boolean;
  allVetoReasons: string[];
  primarySkipReason: string | null;
}

function assertFiniteFeatures(features: Td1Features): void {
  for (const name of TD1_FEATURE_ORDER) {
    if (!Number.isFinite(features[name])) throw new Error(`TD1_FEATURE_NONFINITE:${name}`);
  }
}

export function scoreTree(tree: TreeNode, features: Td1Features): number {
  assertFiniteFeatures(features);
  let node: TreeNode = tree;
  for (let depth = 0; depth <= 3; depth += 1) {
    if (node.leaf) {
      const p = node.leaf.lossProbability;
      if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error("TD1_PROBABILITY_INVALID");
      return p;
    }
    if (node.featureIndex === undefined || node.threshold === undefined || !node.left || !node.right) {
      throw new Error("TD1_ARTIFACT_INVALID");
    }
    const featureName = TD1_FEATURE_ORDER[node.featureIndex];
    node = features[featureName] <= node.threshold ? node.left : node.right;
  }
  throw new Error("TD1_TREE_DEPTH_EXCEEDED");
}

export function decideTd1Rc(args: {
  a2FinalDecision: Side;
  features: Td1Features;
  artifact: Td1Artifact;
  containment: ContainmentConsumption;
  threshold?: number;
}): Td1RcDecision {
  const threshold = args.threshold ?? 0.60;
  const pLoss = scoreTree(args.artifact.tree, args.features);
  const td1Veto = pLoss >= threshold;
  const containmentVeto = args.containment.vetoFired;
  const reasons: string[] = [];
  if (containmentVeto) reasons.push("DIRECTIONAL_CONTAINMENT");
  if (td1Veto) reasons.push("TD1_TURN_RISK");
  const skip = reasons.length > 0;
  return {
    externalFinalDecision: skip ? "SKIP" : args.a2FinalDecision,
    wouldTrade: !skip,
    td1LossProbability: pLoss,
    td1VetoFired: td1Veto,
    containmentVetoFired: containmentVeto,
    allVetoReasons: reasons,
    primarySkipReason: reasons[0] ?? null,
  };
}

export function resolveA2Counterfactual(side: Side, actual: "GREEN" | "RED"): "WIN" | "LOSS" {
  return (side === "YES" && actual === "GREEN") || (side === "NO" && actual === "RED") ? "WIN" : "LOSS";
}
