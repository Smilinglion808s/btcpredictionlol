// Model C — Dual Horizon: pure decision layer.
//
// Inputs: two component probabilities (already produced by the featurizer +
// scaler + logistic pipelines) and the normalized market-condition signals
// from the production snapshot. Output: base_decision, override_reasons_json,
// final_decision, trade — matching the shadow_output_contract in
// model_c_shadow_spec_v1.
//
// Registry enforcement: `upstream_no_clear_edge` was retired 2026-07-10 and
// must always log fired:false, applied:false regardless of upstream signal.
// The remaining hard-NO overrides are `trending_expansion` and
// `failed_breakout_down`.

export const MODEL_C_CUTOFF = 0.52;

export type ModelCDecision = "YES" | "NO";

export interface ModelCDecisionInputs {
  p_global: number;
  p_recent: number;
  market_condition?: string | null;
  failed_breakout_down?: boolean | string | null;
  // Passed through for the registry log only; never influences the decision.
  upstream_prediction?: string | null;
}

export interface ModelCOverrideEntry {
  id: string;
  fired: boolean;
  applied: boolean;
  note?: string;
}

export interface ModelCDecisionResult {
  p_global: number;
  p_recent: number;
  p_ensemble: number;
  base_decision: ModelCDecision;
  override_reasons_json: ModelCOverrideEntry[];
  final_decision: ModelCDecision;
  trade: boolean;
}

function isTruthyFlag(v: unknown): boolean {
  if (v === true) return true;
  if (typeof v === "string") {
    const s = v.trim().toLowerCase();
    return s === "true" || s === "1" || s === "yes";
  }
  return false;
}

function normalizeCondition(v: unknown): string {
  return typeof v === "string" ? v.trim().toLowerCase() : "";
}

export function blend(pGlobal: number, pRecent: number): number {
  return 0.5 * pGlobal + 0.5 * pRecent;
}

export function baseDecisionFor(pEnsemble: number): ModelCDecision {
  return pEnsemble >= MODEL_C_CUTOFF ? "YES" : "NO";
}

/**
 * Deterministic decision. Never returns SKIP — every eligible candle
 * produces YES or NO per spec (`no SKIP zone`).
 */
export function decideModelC(inputs: ModelCDecisionInputs): ModelCDecisionResult {
  const pEnsemble = blend(inputs.p_global, inputs.p_recent);
  const base = baseDecisionFor(pEnsemble);

  const trendingExpansionFired =
    normalizeCondition(inputs.market_condition) === "trending_expansion";
  const failedBreakoutDownFired = isTruthyFlag(inputs.failed_breakout_down);

  // Overrides only apply when they would flip a YES to NO (they are hard-NO).
  const trendingApplied = trendingExpansionFired && base === "YES";
  const failedApplied = failedBreakoutDownFired && base === "YES";

  const overrides: ModelCOverrideEntry[] = [
    {
      id: "upstream_no_clear_edge",
      fired: false,
      applied: false,
      note: "removed per registry (retired 2026-07-10)",
    },
    { id: "trending_expansion", fired: trendingExpansionFired, applied: trendingApplied },
    { id: "failed_breakout_down", fired: failedBreakoutDownFired, applied: failedApplied },
  ];

  const final: ModelCDecision = trendingApplied || failedApplied ? "NO" : base;

  return {
    p_global: inputs.p_global,
    p_recent: inputs.p_recent,
    p_ensemble: pEnsemble,
    base_decision: base,
    override_reasons_json: overrides,
    final_decision: final,
    trade: final === "YES",
  };
}
