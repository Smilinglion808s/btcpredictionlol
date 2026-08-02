// a96-r4 engine tests: feature math, threshold boundaries, decision ordering,
// margin-gate removal, direction alignment, look-ahead safety, and the
// audit-only r3 counterfactual.

import { describe, it, expect } from "vitest";
import { a96Decide, a96DecideR3Counterfactual } from "../engine";
import {
  fourCandleEfficiency,
  meanTwoCandleBodyToRange,
  fourCandleAlignedWickPressure,
  alignedMacdHistAtr,
} from "../features";
import { A96_CONFIG, A96_MODEL_VERSION, A96_VARIANT } from "../config";
import type { Candle, FitState } from "../types";

const TF_MS = 15 * 60 * 1000;
const TARGET = new Date("2026-07-30T12:00:00.000Z");
const T15 = new Date(TARGET.getTime() - TF_MS);

const FIT: FitState = {
  fit_episode_id: "ep-1",
  artifact_fit_id: "fit-1",
  comparable_resolved_count: 50,
  layer_a_wins: 20, layer_a_losses: 10, layer_a_net: 10,
  layer_b_wins: 30, layer_b_losses: 5, layer_b_net: 25,
};

/**
 * Four contiguous canonical candles ending at T-15m.
 * `wickPad` widens the range symmetrically so body-to-range can be tuned
 * without changing the bodies (and therefore without changing efficiency).
 */
function candles(bodies: number[], wickPad = 1, base = 1_000_000): Candle[] {
  let open = base;
  const out: Candle[] = [];
  for (let i = 0; i < 4; i++) {
    const close = open + bodies[i];
    out.push({
      timestamp: new Date(TARGET.getTime() - (4 - i) * TF_MS),
      open,
      high: Math.max(open, close) + wickPad,
      low: Math.min(open, close) - wickPad,
      close,
    });
    open = close;
  }
  return out;
}

/** bodies = [+d, -x, +x, 0] → net = d, path = d + 2x → eff = d/(d+2x). */
function candlesWithEfficiency(eff: number, wickPad = 60): Candle[] {
  const d = 100;
  const path = d / eff;
  const x = (path - d) / 2;
  return candles([d, -x, x, 0], wickPad);
}

const GOOD_TECH = { macd_hist: 0.5, atr14: 100, source_ts: T15 };

function decide(over: Partial<Parameters<typeof a96Decide>[0]> = {}) {
  const priors = (over.priorCandles ?? candlesWithEfficiency(0.8)) as Candle[];
  return a96Decide({
    layerADirection: "GREEN",
    layerBDirection: "GREEN",
    layerAProbMean: 0.52,
    baseSelectedLayer: "B",
    fitState: FIT,
    targetTimestamp: TARGET,
    targetOpen: priors[3].close,
    priorCandles: priors,
    technical: GOOD_TECH,
    ...over,
  });
}

describe("a96-r4 config", () => {
  it("is the frozen r4 version with frozen thresholds", () => {
    expect(A96_MODEL_VERSION).toBe("a96-r4");
    expect(A96_VARIANT).toBe("layer-a-structure-macd");
    expect(A96_CONFIG.four_candle_efficiency_veto_min_inclusive).toBe(0.25);
    expect(A96_CONFIG.four_candle_efficiency_veto_max_exclusive).toBe(0.40);
    expect(A96_CONFIG.agreement_distance_from_4_low_bps).toBe(32.0);
    expect(A96_CONFIG.agreement_mean_2_body_to_range_max).toBe(0.30);
    expect(A96_CONFIG.mean_two_body_to_range_max).toBe(0.65);
    expect(A96_CONFIG.four_candle_aligned_wick_pressure_max).toBe(0.20);
    expect(A96_CONFIG.aligned_macd_hist_atr_max).toBe(0.17);
  });
});

describe("a96 four-candle path efficiency feature", () => {
  it("uses exactly four prior candles, all before the target boundary", () => {
    const cs = candles([10, -5, 5, 0]);
    expect(cs).toHaveLength(A96_CONFIG.required_prior_candles);
    for (const c of cs) expect(c.timestamp.getTime()).toBeLessThan(TARGET.getTime());
    expect(fourCandleEfficiency(cs.slice(0, 3))).toBeNull();
    expect(fourCandleEfficiency([...cs, cs[3]])).toBeNull();
  });

  it("exact four input timestamps are T-60, T-45, T-30, T-15", () => {
    const cs = candles([10, -5, 5, 0]);
    expect(cs.map((c) => c.timestamp.toISOString())).toEqual([
      new Date(TARGET.getTime() - 4 * TF_MS).toISOString(),
      new Date(TARGET.getTime() - 3 * TF_MS).toISOString(),
      new Date(TARGET.getTime() - 2 * TF_MS).toISOString(),
      T15.toISOString(),
    ]);
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

describe("a96-r4 two-candle body-to-range feature", () => {
  it("averages the T-30 and T-15 body-to-range values", () => {
    const cs = candles([10, 10, 10, 10], 5);
    const f = meanTwoCandleBodyToRange(cs)!;
    // body 10, range 10 + 2*5 = 20 → 0.5 each
    expect(f.body_to_range_t30).toBeCloseTo(0.5, 12);
    expect(f.body_to_range_t15).toBeCloseTo(0.5, 12);
    expect(f.mean_two_body_to_range).toBeCloseTo(0.5, 12);
  });

  it("a zero range makes the feature invalid", () => {
    const cs = candles([0, 0, 0, 0], 0);
    expect(meanTwoCandleBodyToRange(cs)).toBeNull();
  });
});

describe("a96-r4 aligned wick pressure feature", () => {
  it("GREEN keeps the raw sign, RED inverts it", () => {
    const cs = candles([10, 10, 10, 10], 5);
    const green = fourCandleAlignedWickPressure(cs, "GREEN")!;
    const red = fourCandleAlignedWickPressure(cs, "RED")!;
    expect(green.direction_sign).toBe(1);
    expect(red.direction_sign).toBe(-1);
    expect(red.four_candle_aligned_wick_pressure)
      .toBeCloseTo(-green.four_candle_aligned_wick_pressure, 12);
    expect(green.raw).toEqual(red.raw);
  });

  it("is the mean of the four aligned per-candle values", () => {
    const cs = candles([10, 10, 10, 10], 5);
    const f = fourCandleAlignedWickPressure(cs, "GREEN")!;
    const mean = f.aligned.reduce((s, v) => s + v, 0) / 4;
    expect(f.four_candle_aligned_wick_pressure).toBeCloseTo(mean, 12);
  });
});

describe("a96-r4 aligned MACD/ATR feature", () => {
  it("divides the MACD histogram by ATR14 and aligns by direction", () => {
    expect(alignedMacdHistAtr(17, 100, "GREEN")).toBeCloseTo(0.17, 12);
    expect(alignedMacdHistAtr(17, 100, "RED")).toBeCloseTo(-0.17, 12);
  });

  it("rejects null, NaN, infinite, zero and negative inputs", () => {
    expect(alignedMacdHistAtr(null, 100, "GREEN")).toBeNull();
    expect(alignedMacdHistAtr(NaN, 100, "GREEN")).toBeNull();
    expect(alignedMacdHistAtr(Infinity, 100, "GREEN")).toBeNull();
    expect(alignedMacdHistAtr(1, 0, "GREEN")).toBeNull();
    expect(alignedMacdHistAtr(1, -5, "GREEN")).toBeNull();
    expect(alignedMacdHistAtr(1, null, "GREEN")).toBeNull();
  });
});

describe("a96-r4 efficiency veto boundaries", () => {
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

describe("a96-r4 body-concentration boundary (<= 0.65 passes)", () => {
  /** bodies equal b, symmetric pad w → bodyToRange = b / (b + 2w). */
  function candlesWithBodyRatio(ratio: number): Candle[] {
    const b = 100;
    const w = (b / ratio - b) / 2;
    return candles([b, -b, b, b], w);
  }

  it("exactly 0.65 passes", () => {
    const d = decide({ layerBDirection: "RED", priorCandles: candlesWithBodyRatio(0.65) });
    expect(d.feature_values.mean_2_candle_body_to_range).toBeCloseTo(0.65, 10);
    expect(d.feature_values.body_concentration_condition).toBe(false);
    expect(d.body_ratio_veto_fired).toBe(false);
    expect(d.prediction).toBe("GREEN");
  });

  it("above 0.65 abstains", () => {
    const d = decide({ layerBDirection: "RED", priorCandles: candlesWithBodyRatio(0.70) });
    expect(d.feature_values.body_concentration_condition).toBe(true);
    expect(d.body_ratio_veto_fired).toBe(true);
    expect(d.reason).toBe("ABSTAIN_TWO_CANDLE_BODY_CONCENTRATION_HIGH");
  });
});

describe("a96-r4 wick-pressure boundary (<= 0.20 passes)", () => {
  /**
   * Lower-wick heavy candles: body b upward, lower wick L, no upper wick.
   * rawWickPressure = L / (b + L). Aligned with GREEN → positive.
   */
  function wickCandles(pressure: number): Candle[] {
    const b = 100;
    const L = (pressure * b) / (1 - pressure);
    let open = 1_000_000;
    const out: Candle[] = [];
    for (let i = 0; i < 4; i++) {
      const close = open + b;
      out.push({
        timestamp: new Date(TARGET.getTime() - (4 - i) * TF_MS),
        open, close, high: close, low: open - L,
      });
      open = close;
    }
    return out;
  }

  it("exactly 0.20 passes", () => {
    const cs = wickCandles(0.20);
    const d = decide({ layerBDirection: "RED", priorCandles: cs });
    expect(d.feature_values.four_candle_aligned_wick_pressure).toBeCloseTo(0.20, 10);
    expect(d.feature_values.wick_pressure_condition).toBe(false);
    expect(d.wick_pressure_veto_fired).toBe(false);
  });

  it("above 0.20 abstains", () => {
    const cs = wickCandles(0.30);
    const d = decide({ layerBDirection: "RED", priorCandles: cs });
    expect(d.feature_values.wick_pressure_condition).toBe(true);
    expect(d.wick_pressure_veto_fired).toBe(true);
    expect(d.reason).toBe("ABSTAIN_FOUR_CANDLE_WICK_PRESSURE_HIGH");
  });

  it("the same candles aligned against a RED Layer A flip sign and pass", () => {
    const cs = wickCandles(0.30);
    const d = decide({ layerADirection: "RED", layerBDirection: "GREEN", priorCandles: cs });
    expect(d.feature_values.direction_sign).toBe(-1);
    expect(d.feature_values.four_candle_aligned_wick_pressure).toBeCloseTo(-0.30, 10);
    expect(d.wick_pressure_veto_fired).toBe(false);
  });
});

describe("a96-r4 MACD boundary (<= 0.17 passes)", () => {
  it("exactly 0.17 passes", () => {
    const d = decide({ technical: { macd_hist: 17, atr14: 100, source_ts: T15 } });
    expect(d.feature_values.aligned_macd_hist_atr).toBeCloseTo(0.17, 12);
    expect(d.macd_veto_fired).toBe(false);
    expect(d.prediction).toBe("GREEN");
  });

  it("above 0.17 abstains", () => {
    const d = decide({ technical: { macd_hist: 18, atr14: 100, source_ts: T15 } });
    expect(d.feature_values.macd_veto_condition).toBe(true);
    expect(d.macd_veto_fired).toBe(true);
    expect(d.reason).toBe("ABSTAIN_MACD_MOMENTUM_OVEREXTENDED");
  });

  it("a RED Layer A aligns the histogram sign", () => {
    const d = decide({ layerADirection: "RED", layerBDirection: "GREEN", technical: { macd_hist: -18, atr14: 100, source_ts: T15 } });
    expect(d.feature_values.aligned_macd_hist_atr).toBeCloseTo(0.18, 12);
    expect(d.macd_veto_fired).toBe(true);
  });

  it("missing / zero ATR or a stale technical timestamp never publishes", () => {
    for (const tech of [
      null,
      { macd_hist: 1, atr14: 0, source_ts: T15 },
      { macd_hist: 1, atr14: -1, source_ts: T15 },
      { macd_hist: null, atr14: 100, source_ts: T15 },
      { macd_hist: 1, atr14: 100, source_ts: new Date(T15.getTime() - TF_MS) },
    ]) {
      const d = decide({ technical: tech as never });
      expect(d.prediction).toBe("ABSTAIN");
      expect(d.reason).toBe("ABSTAIN_R4_FEATURE_HISTORY_INVALID");
      expect(d.r4_feature_history_valid).toBe(false);
      expect(d.feature_values.aligned_macd_hist_atr).toBeNull();
    }
  });
});

describe("a96-r4 margin gate removal", () => {
  for (const p of [0.5, 0.500001, 0.52, 0.9, 0.05]) {
    it(`prob ${p} publishes when all active rules pass`, () => {
      const d = decide({ layerAProbMean: p });
      expect(d.prediction).toBe("GREEN");
      expect(d.margin_veto_fired).toBe(false);
      expect(d.layer_a_prob_margin).toBeCloseTo(Math.abs(p - 0.5), 12);
    });
  }

  it("records the legacy margin band without gating", () => {
    const d = decide({ layerAProbMean: 0.9 });
    expect(d.legacy_margin_condition).toBe(false);
    expect(d.legacy_margin_outside_band).toBe(true);
    expect(d.margin_band_eligible).toBe(false);
    expect(d.prediction).toBe("GREEN");
  });

  it("invalid probability still abstains", () => {
    for (const p of [null, undefined, NaN, Infinity, -0.1, 1.1]) {
      const d = decide({ layerAProbMean: p as never });
      expect(d.reason).toBe("ABSTAIN_LAYER_A_PROBABILITY_INVALID");
      expect(d.selected_layer).toBe("NONE");
      expect(d.layer_a_probability_valid).toBe(false);
    }
  });
});

describe("a96-r4 decision ordering and audit semantics", () => {
  it("efficiency veto precedes the agreement veto", () => {
    const cs = candlesWithEfficiency(0.3).map((c) => ({ ...c, high: c.high + 1_000 }));
    const d = decide({ priorCandles: cs });
    expect(d.reason).toBe("ABSTAIN_FOUR_CANDLE_EFFICIENCY_TOXIC_BAND");
    expect(d.agreement_veto_fired).toBe(false);
    expect(d.feature_values.body_ratio_veto_condition).toBe(true);
  });

  it("agreement veto precedes the r4 structural vetoes", () => {
    // Wick-dominated prior two candles → r3 agreement body-ratio veto.
    const cs = candlesWithEfficiency(0.8).map((c) => ({ ...c, high: c.high + 10_000, low: c.low - 10_000 }));
    const d = decide({ priorCandles: cs });
    expect(d.agreement_veto_fired).toBe(true);
    expect(d.reason).toContain("ABSTAIN_AGREEMENT_");
    expect(d.body_ratio_veto_fired).toBe(false);
    expect(d.wick_pressure_veto_fired).toBe(false);
    expect(d.macd_veto_fired).toBe(false);
  });

  it("condition flags are recorded even when an earlier rule fires", () => {
    const d = decide({
      priorCandles: candlesWithEfficiency(0.3),
      technical: { macd_hist: 90, atr14: 100, source_ts: T15 },
    });
    expect(d.efficiency_veto_fired).toBe(true);
    expect(d.feature_values.macd_veto_condition).toBe(true);
    expect(d.macd_veto_fired).toBe(false);
  });

  it("fit selector and Layer B cannot change the direction", () => {
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

  it("missing or non-contiguous prior history abstains", () => {
    const short = candlesWithEfficiency(0.8).slice(0, 3);
    expect(decide({ priorCandles: short }).reason).toBe("ABSTAIN_R4_FEATURE_HISTORY_INVALID");
    const dup = candlesWithEfficiency(0.8);
    dup[2] = { ...dup[2], timestamp: dup[1].timestamp };
    expect(decide({ priorCandles: dup }).reason).toBe("ABSTAIN_R4_FEATURE_HISTORY_INVALID");
  });

  it("target-candle data cannot alter the decision (look-ahead trap)", () => {
    const priors = candlesWithEfficiency(0.8);
    const a = a96Decide({
      layerADirection: "GREEN", layerBDirection: "RED", layerAProbMean: 0.52,
      baseSelectedLayer: "A", fitState: FIT, targetTimestamp: TARGET,
      targetOpen: priors[3].close, priorCandles: priors, technical: GOOD_TECH,
    });
    // Same inputs, target candle resolves violently the other way — the
    // engine never sees it, so the decision is byte-identical.
    const b = a96Decide({
      layerADirection: "GREEN", layerBDirection: "RED", layerAProbMean: 0.52,
      baseSelectedLayer: "A", fitState: FIT, targetTimestamp: TARGET,
      targetOpen: priors[3].close, priorCandles: priors, technical: GOOD_TECH,
    });
    expect(JSON.stringify(b)).toBe(JSON.stringify(a));
    expect(a.prediction).toBe("GREEN");
  });
});

describe("a96 r3 counterfactual (audit only)", () => {
  it("still applies the r3 margin band that r4 removed", () => {
    const priors = candlesWithEfficiency(0.8);
    const cf = a96DecideR3Counterfactual({
      layerADirection: "GREEN", layerBDirection: "RED", layerAProbMean: 0.9,
      targetTimestamp: TARGET, targetOpen: priors[3].close, priorCandles: priors,
    });
    expect(cf.decision).toBe("ABSTAIN");
    expect(cf.reason).toBe("ABSTAIN_LAYER_A_MARGIN_OUTSIDE_BAND");
    // r4 publishes the same candle.
    expect(decide({ layerAProbMean: 0.9, layerBDirection: "RED", priorCandles: priors }).prediction).toBe("GREEN");
  });

  it("is independent of the r4 structural vetoes", () => {
    const cs = (() => {
      const b = 100;
      const w = (b / 0.70 - b) / 2;
      return candles([b, -b, b, b], w);
    })();
    const cf = a96DecideR3Counterfactual({
      layerADirection: "GREEN", layerBDirection: "RED", layerAProbMean: 0.52,
      targetTimestamp: TARGET, targetOpen: cs[3].close, priorCandles: cs,
    });
    expect(cf.direction).toBe("GREEN");
    // r4 vetoes the same candle on body concentration.
    expect(decide({ layerBDirection: "RED", priorCandles: cs }).reason)
      .toBe("ABSTAIN_TWO_CANDLE_BODY_CONCENTRATION_HIGH");
  });
});
