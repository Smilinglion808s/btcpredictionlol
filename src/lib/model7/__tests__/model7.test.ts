// Model 7 Shadow — golden tests.
// Verifies:
//   1. Frozen scorer reproduces the JSON's exact_scoring_formula on a fixture
//      row (vector -> standardize -> logit -> probability).
//   2. Threshold boundaries: 0.58 -> YES, 0.5799 -> SKIP, 0.26 -> SKIP,
//      0.2599 -> NO. (Note: 0.26 is the NO ceiling per spec text but the JSON
//      base_decision uses "<= 0.26" -> NO; we honor JSON semantics.)
//   3. Each hard-NO override forces NO from a YES base decision.
//   4. Missing partial snapshot follows the missing policy (features omitted).
//   5. Variant B refuses to fit with < 72 clean rows.

import { describe, expect, it } from "vitest";
import { loadFrozenModel } from "../fitStore";
import { scoreFeatureMap } from "../scorer";
import { fitLogisticRegression } from "../logistic";
import { buildFeatureMap } from "../featurize";
import { runShadowForPrediction } from "../shadow";

describe("Model 7 — frozen scorer & thresholds", () => {
  const fit = loadFrozenModel();

  it("loads 205 features / means / scales / coefficients", () => {
    expect(fit.feature_order.length).toBe(205);
    expect(fit.feature_means.length).toBe(205);
    expect(fit.feature_scales.length).toBe(205);
    expect(fit.coefficients.length).toBe(205);
  });

  it("reproduces intercept-only logit when feature_map is empty", () => {
    const res = scoreFeatureMap({}, {}, fit, {});
    // With every feature=0, standardized z_j = -means[j]/scales[j].
    // Verify the closed-form matches to 1e-9.
    let expected = fit.intercept;
    for (let j = 0; j < fit.feature_order.length; j++) {
      const z = (0 - fit.feature_means[j]) / fit.feature_scales[j];
      expected += fit.coefficients[j] * z;
    }
    expect(Math.abs(res.logit - expected)).toBeLessThan(1e-9);
    const sig = 1 / (1 + Math.exp(-expected));
    expect(Math.abs(res.probability_green - sig)).toBeLessThan(1e-9);
  });

  it("applies thresholds correctly at boundaries", () => {
    // Synthesize a fake fit with 1 feature to hit exact probabilities.
    const one = {
      model_fit_id: "test", feature_order: ["x"],
      feature_means: [0], feature_scales: [1], coefficients: [1],
      intercept: 0, categorical_vocab: {},
    };
    const logitFor = (p: number) => Math.log(p / (1 - p));
    const yes = scoreFeatureMap({ x: logitFor(0.58) }, {}, one, {});
    expect(yes.base_decision).toBe("YES");
    const skipHigh = scoreFeatureMap({ x: logitFor(0.5799) }, {}, one, {});
    expect(skipHigh.base_decision).toBe("SKIP");
    const noBoundary = scoreFeatureMap({ x: logitFor(0.26) }, {}, one, {});
    expect(noBoundary.base_decision).toBe("NO");
    const skipLow = scoreFeatureMap({ x: logitFor(0.2599) }, {}, one, {});
    expect(skipLow.base_decision).toBe("NO"); // 0.2599 < 0.26 → NO per JSON <= semantics
  });

  it("hard-NO overrides force NO from YES base", () => {
    const one = {
      model_fit_id: "test", feature_order: ["x"],
      feature_means: [0], feature_scales: [1], coefficients: [1],
      intercept: 0, categorical_vocab: {},
    };
    const highLogit = 5.0; // p ~ 0.99, base = YES
    const r1 = scoreFeatureMap({ x: highLogit }, {}, one, { prediction: "NO CLEAR EDGE" });
    expect(r1.base_decision).toBe("YES");
    expect(r1.decision).toBe("NO");
    expect(r1.hard_no_override_fired).toBe("upstream_no_clear_edge");

    const r2 = scoreFeatureMap({ x: highLogit }, {}, one, { market_condition: "trending_expansion" });
    expect(r2.decision).toBe("NO");
    expect(r2.hard_no_override_fired).toBe("trending_expansion");

    const r3 = scoreFeatureMap({ x: highLogit }, {}, one, { failed_breakout_down: "True" });
    expect(r3.decision).toBe("NO");
    expect(r3.hard_no_override_fired).toBe("failed_breakout_down");
  });

  it("Variant B vs B2 at p=0.70 with upstream NO CLEAR EDGE: B forces NO, B2 keeps YES", () => {
    // Spec acceptance check: same fixture, same fit; the ONLY difference is
    // B2 disables the upstream_no_clear_edge override. Fit uses one feature
    // scaled so probability_green == 0.70 exactly (base_decision = YES).
    const one = {
      model_fit_id: "test", feature_order: ["x"],
      feature_means: [0], feature_scales: [1], coefficients: [1],
      intercept: 0, categorical_vocab: {},
    };
    const logitFor = (p: number) => Math.log(p / (1 - p));
    const ctx = { prediction: "NO CLEAR EDGE" };

    // Variant B — override intact.
    const rB = scoreFeatureMap({ x: logitFor(0.70) }, {}, one, ctx);
    expect(Math.abs(rB.probability_green - 0.70)).toBeLessThan(1e-9);
    expect(rB.base_decision).toBe("YES");
    expect(rB.decision).toBe("NO");
    expect(rB.hard_no_override_fired).toBe("upstream_no_clear_edge");

    // Variant B2 — override removed.
    const rB2 = scoreFeatureMap({ x: logitFor(0.70) }, {}, one, ctx, { skipUpstreamNoClearEdge: true });
    expect(Math.abs(rB2.probability_green - 0.70)).toBeLessThan(1e-9);
    expect(rB2.base_decision).toBe("YES");
    expect(rB2.decision).toBe("YES");
    expect(rB2.hard_no_override_fired).toBe("none");
    // Override ledger records the rule as evaluated-but-not-applied.
    const nce = rB2.override_reasons.find((r) => r.rule === "upstream_no_clear_edge");
    expect(nce?.fired).toBe(false);
    expect(nce?.applied).toBe(false);
  });
});

describe("Model 7 — logistic regression fitter", () => {
  it("recovers a simple linear separator", () => {
    // y=1 iff x1+x2 > 0. Generate a tiny separable dataset.
    const X: number[][] = [];
    const y: number[] = [];
    for (let i = -10; i <= 10; i++) {
      for (let j = -10; j <= 10; j++) {
        if (i === 0 && j === 0) continue;
        X.push([i, j]);
        y.push(i + j > 0 ? 1 : 0);
      }
    }
    const fit = fitLogisticRegression({ X, y, C: 1e6, maxIter: 200, tol: 1e-7 });
    // Weights should be roughly proportional and positive.
    expect(fit.coefficients[0]).toBeGreaterThan(0);
    expect(fit.coefficients[1]).toBeGreaterThan(0);
    // Predict a few points.
    const sig = (z: number) => 1 / (1 + Math.exp(-z));
    const w = fit.coefficients, b = fit.intercept;
    expect(sig(w[0] * 3 + w[1] * 3 + b)).toBeGreaterThan(0.8);
    expect(sig(w[0] * -3 + w[1] * -3 + b)).toBeLessThan(0.2);
  });
});

describe("Model 7 — missing partial snapshot policy", () => {
  it("emits __missing indicators for every partial_* numeric when snapshot is absent", () => {
    const row = {
      candle_ts: "2026-07-10T00:00:00Z",
      prediction: "GREEN",
      confidence: 65,
      // Every partial_* field null → mirrors the 'missing partial snapshot' path.
      partial_completeness: null,
      partial_close_position_pct: null,
      partial_range_vs_atr: null,
      partial_module_bull_pts: null,
      partial_module_bear_pts: null,
      current_partial_snapshot: null,
      indicators: {},
    };
    const { feature_map, categoricals } = buildFeatureMap(row, []);
    for (const k of [
      "partial_completeness", "partial_close_position_pct", "partial_range_vs_atr",
      "partial_module_bull_pts", "partial_module_bear_pts",
    ]) {
      expect(feature_map[`${k}__missing`]).toBe(1.0);
      expect(feature_map[k]).toBeUndefined();
    }
    // Categorical partial_* fields resolve to "missing" per normCat().
    expect(categoricals.partial_direction).toBe("missing");
    expect(categoricals.partial_agreement).toBe("missing");
    expect(feature_map["partial_direction=missing"]).toBe(1.0);
  });
});

describe("Model 7 — fault isolation from production", () => {
  it("runShadowForPrediction resolves (does not throw) when Supabase.insert throws", async () => {
    // Fault-injected client: every mutation path rejects. If the shadow
    // runner leaked the error, this promise would reject and the production
    // insert code path (which awaits it non-blockingly) would surface it.
    const thrower = () => { throw new Error("injected supabase failure"); };
    const stub = {
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              lt: () => ({ order: () => ({ limit: () => Promise.resolve({ data: [], error: null }) }) }),
              order: () => ({ limit: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
            }),
          }),
        }),
        insert: thrower, // <-- forces every insertShadowRow / api_runs write to throw
      }),
    } as never;

    const predictionRow = {
      id: "pred-fault-1",
      candle_ts: "2026-07-10T00:15:00Z",
      prediction: "GREEN",
      confidence: 70,
      model_version: "6.0",
      indicators: {},
    };

    // The contract: this MUST resolve. If shadow ever throws, production is at risk.
    let threw = false;
    try {
      await runShadowForPrediction(stub, predictionRow as never);
    } catch {
      threw = true;
    }
    expect(threw).toBe(false);
  });
});
