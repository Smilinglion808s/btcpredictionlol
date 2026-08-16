// B4x4-ES1 Binance Order-Book R1 — six frozen shadow policies.
//
// Observational only. A policy row is emitted for every target and every
// policy, including abstentions, and is never webhook eligible.

import {
  BINANCE_OB_POLICY_VERSION,
  POLICY_DEFINITIONS,
  type BinanceObPolicyName,
  type PolicyDefinition,
} from "./config";
import type { PolicyInputs } from "./types";

export type Direction = "GREEN" | "RED";

export interface PolicyEvaluation {
  policy_name: BinanceObPolicyName;
  policy_version: string;
  qualified: boolean;
  qualification_reason: string;
  candidate_direction: Direction | null;
  would_trade: boolean;
  decision_reason: string;
  spot_final_imbalance_10bps: number | null;
  spot_abs_percentile_96: number | null;
  spot_sign_persistence_15s: number | null;
  perp_final_imbalance_10bps: number | null;
  perp_abs_percentile_96: number | null;
  perp_sign_persistence_15s: number | null;
  spot_perp_sign_agree: boolean | null;
}

const NULL_INPUTS: PolicyInputs = {
  finalImbalance10bps: null,
  absPercentile96: null,
  signPersistence15s: null,
  ready: false,
  historyReady: false,
};

function marketReject(prefix: string, m: PolicyInputs, def: PolicyDefinition): string | null {
  if (!m.ready) return `${prefix}_NOT_READY`;
  if (!m.historyReady) return `${prefix}_HISTORY_NOT_READY`;
  const imb = m.finalImbalance10bps;
  if (imb == null || !Number.isFinite(imb)) return `${prefix}_IMBALANCE_MISSING`;
  if (imb === 0) return `${prefix}_IMBALANCE_ZERO`;
  const pct = m.absPercentile96;
  if (pct == null || !Number.isFinite(pct)) return `${prefix}_PERCENTILE_MISSING`;
  // Equality at both bounds qualifies.
  if (pct < def.absPercentileMin) return `${prefix}_BELOW_BAND`;
  if (pct > def.absPercentileMax) return `${prefix}_ABOVE_BAND`;
  if (def.minSignPersistence15s != null) {
    const p = m.signPersistence15s;
    if (p == null || !Number.isFinite(p)) return `${prefix}_PERSISTENCE_MISSING`;
    if (p < def.minSignPersistence15s) return `${prefix}_PERSISTENCE_BELOW_MIN`;
  }
  return null;
}

/** Follow maps positive imbalance to GREEN; fade inverts it. */
export function mapDirection(imbalance: number, fade: boolean): Direction {
  const follow: Direction = imbalance > 0 ? "GREEN" : "RED";
  if (!fade) return follow;
  return follow === "GREEN" ? "RED" : "GREEN";
}

export function evaluatePolicy(
  def: PolicyDefinition,
  spot: PolicyInputs,
  perp: PolicyInputs,
): PolicyEvaluation {
  const usesPerp = def.markets.includes("USD_M_PERP");
  const signAgree =
    spot.finalImbalance10bps != null &&
    perp.finalImbalance10bps != null &&
    spot.finalImbalance10bps !== 0 &&
    perp.finalImbalance10bps !== 0
      ? Math.sign(spot.finalImbalance10bps) === Math.sign(perp.finalImbalance10bps)
      : null;

  const base: PolicyEvaluation = {
    policy_name: def.name,
    policy_version: BINANCE_OB_POLICY_VERSION,
    qualified: false,
    qualification_reason: "",
    candidate_direction: null,
    would_trade: false,
    decision_reason: "",
    spot_final_imbalance_10bps: spot.finalImbalance10bps,
    spot_abs_percentile_96: spot.absPercentile96,
    spot_sign_persistence_15s: spot.signPersistence15s,
    perp_final_imbalance_10bps: usesPerp ? perp.finalImbalance10bps : perp.finalImbalance10bps,
    perp_abs_percentile_96: perp.absPercentile96,
    perp_sign_persistence_15s: perp.signPersistence15s,
    spot_perp_sign_agree: usesPerp ? signAgree : null,
  };

  // First-match rejection reason, evaluated Spot first then Perpetual.
  const reject = marketReject("SPOT", spot, def) ?? (usesPerp ? marketReject("PERP", perp, def) : null);
  if (reject) {
    return {
      ...base,
      qualification_reason: reject,
      decision_reason: `ABSTAIN_${reject}`,
    };
  }
  if (def.requireSignAgreement && signAgree !== true) {
    return {
      ...base,
      qualification_reason: "SPOT_PERP_SIGN_DISAGREE",
      decision_reason: "ABSTAIN_SPOT_PERP_SIGN_DISAGREE",
    };
  }

  const direction = mapDirection(spot.finalImbalance10bps!, def.fade);
  return {
    ...base,
    qualified: true,
    qualification_reason: "QUALIFIED",
    candidate_direction: direction,
    would_trade: true,
    decision_reason: `${def.fade ? "FADE" : "FOLLOW"}_${direction}`,
  };
}

/** Evaluate all six frozen policies for one target. */
export function evaluateAllPolicies(
  spot: PolicyInputs | null,
  perp: PolicyInputs | null,
): PolicyEvaluation[] {
  return POLICY_DEFINITIONS.map((def) =>
    evaluatePolicy(def, spot ?? NULL_INPUTS, perp ?? NULL_INPUTS),
  );
}

/** WIN=+1, LOSS=-1, PUSH=0, abstain=0. */
export function scorePolicy(
  candidate: Direction | null,
  actual: "GREEN" | "RED" | "PUSH" | null,
): { result: "WIN" | "LOSS" | "PUSH" | null; score: number | null } {
  if (!candidate || actual == null) return { result: null, score: null };
  if (actual === "PUSH") return { result: "PUSH", score: 0 };
  return candidate === actual ? { result: "WIN", score: 1 } : { result: "LOSS", score: -1 };
}
