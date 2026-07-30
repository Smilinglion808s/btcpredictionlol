import { describe, it, expect } from "vitest";
import { a96Decide } from "../engine";
import { fourCandleEfficiency } from "../features";
import { A96_CONFIG } from "../config";
import type { Candle, FitState } from "../types";

const TF_MS = 15 * 60 * 1000;
const TARGET = new Date("2026-07-30T12:00:00.000Z");

const FIT: FitState = {
  fit_episode_id: "ep-1",
  artifact_fit_id: "fit-1",
  comparable_resolved_count: 50,
  layer_a_wins: 20, layer_a_losses: 10, layer_a_net: 10,
  layer_b_wins: 30, layer_b_losses: 5, layer_b_net: 25,
};

/** Four contiguous canonical candles ending at T-15m, given body deltas. */
function candles(bodies: number[], base = 100_000): Candle[] {
  let open = base;
  const out: Candle[] = [];
  for (let i = 0; i < 4; i++) {
    const close = open + bodies[i];
    out.push({
      timestamp: new Date(TARGET.getTime() - (4 - i) * TF_MS),
      open,
      high: Math.max(open, close) + 50,
      low: Math.min(open, close) - 500, // keeps distance-from-low veto off
      close,
    });
    open = close;
  }
  return out;
}

/**
 * Build four candles whose path efficiency equals `target` exactly enough for
 * threshold testing: net displacement / total body path.
 * bodies = [+d, -x, +x, 0] → net = d, path = d + 2x → eff = d/(d+2x).
 */
function candlesWithEfficiency(eff: number): Candle[] {
  const d = 100;
  const path = d / eff;
  const x = (path - d) / 2;
  return candles([d, -x, x, 0]);
}

function decide(over: Partial<Parameters<typeof a96Decide>[0]> = {}) {
  return a96Decide({
    layerADirection: "GREEN",
    layerBDirection: "GREEN",
    layerAProbMean: 0.52, // margin 0.02 → eligible
    baseSelectedLayer: "B",
    fitState: FIT,
    targetTimestamp: TARGET,
    targetOpen: 100_000,
    priorCandles: candlesWithEfficiency(0.8), // passes efficiency veto
    ...over,
  });
}

describe("a96-r3 four-candle path efficiency feature", () => {
  it("uses exactly four prior candles, all before the target boundary", () => {
    const cs = candles([10, -5, 5, 0]);
    expect(cs).toHaveLength(A96_CONFIG.required_prior_candles);
    for (const c of cs) expect(c.timestamp.getTime()).toBeLessThan(TARGET.getTime());
    expect(fourCandleEfficiency(cs.slice(0, 3))).toBeNull();
    expect(fourCandleEfficiency([...cs, cs[3]])).toBeNull();
  });

  it("uses priorCandles[0].open and priorCandles[3].close for the numerator", () => {
    const cs = candles([200, -50, 50, 25]);
    const f = fourCandleEfficiency(cs)!;
    expect(f.net_displacement).toBeCloseTo(Math.abs(cs[3].close - cs[0].open), 10);
  });

  it("denominator equals the sum of four absolute candle bodies", () => {
    const cs = candles([200, -50, 50, 25]);
    const f = fourCandleEfficiency(cs)!;
    expect(f.total_body_path).toBeCloseTo(200 + 50 + 50 + 25, 10);
  });

  it("zero denominator deterministically produces efficiency 0.0", () => {
    const cs = candles([0, 0, 0, 0]);
    const f = fourCandleEfficiency(cs)!;
    expect(f.total_body_path).toBe(0);
    expect(f.path_efficiency).toBe(0.0);
  });
});

describe("a96-r3 efficiency veto boundaries", () => {
  const cases: Array<[number, boolean]> = [
    [0.249999, false],
    [0.25, true],
    [0.399999, true],
    [0.4, false],
    [0.55, false],
  ];
  for (const [eff, shouldAbstain] of cases) {
    it(`efficiency ${eff} → ${shouldAbstain ? "ABSTAIN" : "pass"}`, () => {
      const d = decide({ priorCandles: candlesWithEfficiency(eff) });
      expect(d.feature_values.four_candle_path_efficiency).toBeCloseTo(eff, 9);
      expect(d.feature_values.efficiency_veto_condition).toBe(shouldAbstain);
      expect(d.efficiency_veto_fired).toBe(shouldAbstain);
      if (shouldAbstain) {
        expect(d.prediction).toBe("ABSTAIN");
        expect(d.selected_layer).toBe("NONE");
        expect(d.reason).toBe("ABSTAIN_FOUR_CANDLE_EFFICIENCY_TOXIC_BAND");
      } else {
        expect(d.prediction).toBe("GREEN");
        expect(d.selected_layer).toBe("A");
      }
    });
  }

  it("applies when A and B agree", () => {
    const d = decide({ layerADirection: "RED", layerBDirection: "RED", priorCandles: candlesWithEfficiency(0.3) });
    expect(d.prediction).toBe("ABSTAIN");
    expect(d.efficiency_veto_fired).toBe(true);
  });

  it("applies when A and B disagree", () => {
    const d = decide({ layerADirection: "RED", layerBDirection: "GREEN", priorCandles: candlesWithEfficiency(0.3) });
    expect(d.prediction).toBe("ABSTAIN");
    expect(d.efficiency_veto_fired).toBe(true);
  });
});

describe("a96-r3 decision order and audit", () => {
  it("margin-ineligible remains a margin abstention and records the efficiency condition", () => {
    const d = decide({ layerAProbMean: 0.5, priorCandles: candlesWithEfficiency(0.3) });
    expect(d.reason).toBe("ABSTAIN_LAYER_A_MARGIN_OUTSIDE_BAND");
    expect(d.margin_veto_fired).toBe(true);
    expect(d.efficiency_veto_fired).toBe(false);
    expect(d.feature_values.efficiency_veto_condition).toBe(true);
    expect(d.feature_values.four_candle_path_efficiency).toBeCloseTo(0.3, 9);
  });

  it("invalid probability abstains with NONE and deterministic feature values", () => {
    const d = decide({ layerAProbMean: null });
    expect(d.reason).toBe("ABSTAIN_LAYER_A_PROBABILITY_INVALID");
    expect(d.selected_layer).toBe("NONE");
    expect(d.efficiency_veto_fired).toBe(false);
    expect(typeof d.feature_values.efficiency_veto_condition).toBe("boolean");
  });

  it("eligible directional prediction stores selected_layer = A", () => {
    const d = decide();
    expect(d.prediction).toBe("GREEN");
    expect(d.selected_layer).toBe("A");
    expect(d.reason).toBe("A_B_AGREEMENT_LAYER_A_PASS");
  });

  it("fit selector and Layer B cannot change the r3 direction", () => {
    const d = decide({
      layerADirection: "RED",
      layerBDirection: "GREEN",
      baseSelectedLayer: "B",
      fitState: { ...FIT, layer_b_net: 999, layer_a_net: -999 },
    });
    expect(d.prediction).toBe("RED");
    expect(d.selected_layer).toBe("A");
    expect(d.fit_selector_override_fired).toBe(false);
    expect(d.reason).toBe("A_B_DISAGREEMENT_LAYER_A_PRIMARY");
  });

  it("existing agreement veto behaviour is unchanged when efficiency passes", () => {
    // Wick-dominated prior two candles → body-ratio veto fires.
    const cs = candlesWithEfficiency(0.8).map((c) => ({ ...c, high: c.high + 100_000 }));
    const d = decide({ priorCandles: cs });
    expect(d.prediction).toBe("ABSTAIN");
    expect(d.agreement_veto_fired).toBe(true);
    expect(d.efficiency_veto_fired).toBe(false);
    expect(d.reason).toContain("ABSTAIN_AGREEMENT_");
  });

  it("efficiency veto takes precedence over the agreement veto", () => {
    const cs = candlesWithEfficiency(0.3).map((c) => ({ ...c, high: c.high + 100_000 }));
    const d = decide({ priorCandles: cs });
    expect(d.reason).toBe("ABSTAIN_FOUR_CANDLE_EFFICIENCY_TOXIC_BAND");
    expect(d.agreement_veto_fired).toBe(false);
    expect(d.feature_values.body_ratio_veto_condition).toBe(true);
  });
});
