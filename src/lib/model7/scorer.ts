// Model 7 — probability + decision scorer
// Aligns a raw feature_map to a fixed feature_order, standardizes, computes
// logit + sigmoid, applies fixed thresholds, applies hard-NO overrides.

export interface ModelFit {
  model_fit_id: string;
  feature_order: string[];
  feature_means: number[];
  feature_scales: number[];
  coefficients: number[];
  intercept: number;
  // For unknown-category tracking: the set of categorical column names the
  // fit knows a vocabulary for. Values seen but not in vocab are logged.
  categorical_vocab: Record<string, string[]>;
}

export interface OverrideEvaluation {
  rule: string;
  fired: boolean;
  applied: boolean; // true only for the rule that produced the final NO
}

export interface ScoreResult {
  probability_green: number;
  logit: number;
  standardized_vector: number[];
  base_decision: "YES" | "NO" | "SKIP";
  hard_no_override_fired: string; // rule id or "none"
  override_reasons: OverrideEvaluation[];
  decision: "YES" | "NO" | "SKIP";
  would_trade: boolean;
  feature_vector_nonzero_count: number;
  unknown_categories: Record<string, string[]>;
}

const YES_T = 0.58;
const NO_T = 0.26;

function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

export function scoreFeatureMap(
  featureMap: Record<string, number>,
  categoricals: Record<string, string>,
  fit: ModelFit,
  hardNoContext: {
    prediction?: string | null;
    market_condition?: string | null;
    failed_breakout_down?: unknown;
  },
  options?: { skipUpstreamNoClearEdge?: boolean },
): ScoreResult {
  // Align + standardize + logit.
  let logit = fit.intercept;
  let nonzero = 0;
  const zVec = new Array<number>(fit.feature_order.length);
  for (let j = 0; j < fit.feature_order.length; j++) {
    const name = fit.feature_order[j];
    const raw = featureMap[name] ?? 0;
    if (raw !== 0) nonzero++;
    const z = (raw - fit.feature_means[j]) / fit.feature_scales[j];
    zVec[j] = z;
    logit += fit.coefficients[j] * z;
  }
  const p = sigmoid(logit);

  const base: "YES" | "NO" | "SKIP" = p >= YES_T ? "YES" : p <= NO_T ? "NO" : "SKIP";

  // Evaluate every override; report full ledger + first-fired winner.
  const fbd = String(hardNoContext.failed_breakout_down ?? "").toLowerCase();
  const nceFired = !options?.skipUpstreamNoClearEdge &&
    (hardNoContext.prediction ?? "").toString() === "NO CLEAR EDGE";
  const trendingFired = (hardNoContext.market_condition ?? "").toString() === "trending_expansion";
  const fbdFired = fbd === "true";

  let override = "none";
  if (nceFired) override = "upstream_no_clear_edge";
  else if (trendingFired) override = "trending_expansion";
  else if (fbdFired) override = "failed_breakout_down";

  const override_reasons: OverrideEvaluation[] = [
    { rule: "upstream_no_clear_edge", fired: nceFired, applied: override === "upstream_no_clear_edge" },
    { rule: "trending_expansion", fired: trendingFired, applied: override === "trending_expansion" },
    { rule: "failed_breakout_down", fired: fbdFired, applied: override === "failed_breakout_down" },
  ];

  const decision: "YES" | "NO" | "SKIP" = override !== "none" ? "NO" : base;

  // Track unknown categoricals (values seen but not in vocab).
  const unknown: Record<string, string[]> = {};
  for (const [col, val] of Object.entries(categoricals)) {
    const vocab = fit.categorical_vocab[col];
    if (vocab && !vocab.includes(val)) {
      (unknown[col] ||= []).push(val);
    }
  }

  return {
    probability_green: p,
    logit,
    standardized_vector: zVec,
    base_decision: base,
    hard_no_override_fired: override,
    override_reasons,
    decision,
    would_trade: decision !== "SKIP",
    feature_vector_nonzero_count: nonzero,
    unknown_categories: unknown,
  };
}
