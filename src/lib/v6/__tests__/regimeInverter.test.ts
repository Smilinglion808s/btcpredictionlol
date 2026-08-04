import { describe, expect, it } from "vitest";
import {
  applyRegimeInverter,
  appendShadowEntry,
  buildShadowHistory,
  inverterContribution,
  isEligibleShadowSignal,
  shadowScores,
  summarizeShadow,
  V6_REGIME_INVERTER_THRESHOLD,
  V6_REGIME_INVERTER_WINDOW,
  type ShadowCandidate,
} from "../regimeInverter";

function candidate(over: Partial<ShadowCandidate> = {}): ShadowCandidate {
  return {
    target_candle_ts: "2026-01-01T00:00:00.000Z",
    prediction_source: "V6_BASE",
    original_v6_base_prediction: "GREEN",
    operational_status: "OK",
    canonical_ground_truth_valid: true,
    actual_direction: "GREEN",
    ...over,
  };
}

/** n eligible rows, `wins` of them correct, oldest first. */
function rows(n: number, wins: number): ShadowCandidate[] {
  return Array.from({ length: n }, (_, i) =>
    candidate({
      target_candle_ts: new Date(Date.UTC(2026, 0, 1, 0, 15 * i)).toISOString(),
      actual_direction: i < wins ? "GREEN" : "RED",
    }),
  );
}

describe("shadow scoring", () => {
  it("scores correct originals +0.8 adjusted and wrong -1", () => {
    expect(shadowScores("GREEN", "GREEN")).toEqual({ raw: 1, adjusted: 0.8 });
    expect(shadowScores("RED", "GREEN")).toEqual({ raw: -1, adjusted: -1 });
  });
});

describe("eligibility", () => {
  it("accepts only resolved directional V6_BASE signals", () => {
    expect(isEligibleShadowSignal(candidate())).toBe(true);
    expect(isEligibleShadowSignal(candidate({ prediction_source: "CONSENSUS_RED_PICKUP" }))).toBe(false);
    expect(isEligibleShadowSignal(candidate({ original_v6_base_prediction: "ABSTAIN" }))).toBe(false);
    expect(isEligibleShadowSignal(candidate({ actual_direction: "PUSH" }))).toBe(false);
    expect(isEligibleShadowSignal(candidate({ operational_status: "OP_FAIL" }))).toBe(false);
    expect(isEligibleShadowSignal(candidate({ canonical_ground_truth_valid: false }))).toBe(false);
  });
});

describe("rolling window", () => {
  it("keeps the newest 20 entries chronologically and de-duplicates", () => {
    const history = buildShadowHistory(rows(30, 30));
    expect(history).toHaveLength(V6_REGIME_INVERTER_WINDOW);
    const sorted = [...history].sort((a, b) => a.target_candle_ts.localeCompare(b.target_candle_ts));
    expect(history).toEqual(sorted);

    const dup = buildShadowHistory([...rows(5, 5), ...rows(5, 5)]);
    expect(dup).toHaveLength(5);
  });

  it("append is idempotent per target timestamp", () => {
    const base = buildShadowHistory(rows(3, 3));
    const again = appendShadowEntry(base, base[0]!);
    expect(again).toHaveLength(3);
  });
});

describe("activation threshold", () => {
  it("stays dormant until exactly 20 resolved signals exist", () => {
    const partial = summarizeShadow(buildShadowHistory(rows(19, 0)));
    expect(partial.ready).toBe(false);
    expect(partial.active).toBe(false);
  });

  it("activates only when adjusted net is at or below -2.8", () => {
    // 9 wins / 11 losses => 0.8*9 - 11 = -3.8 (active)
    const bad = summarizeShadow(buildShadowHistory(rows(20, 9)));
    expect(bad.adjustedNet).toBeCloseTo(-3.8, 10);
    expect(bad.active).toBe(true);

    // 10 wins / 10 losses => -2.0 (dormant)
    const ok = summarizeShadow(buildShadowHistory(rows(20, 10)));
    expect(ok.adjustedNet).toBeCloseTo(-2, 10);
    expect(ok.active).toBe(false);
    expect(ok.threshold).toBe(V6_REGIME_INVERTER_THRESHOLD);
  });
});

describe("applyRegimeInverter", () => {
  const active = summarizeShadow(buildShadowHistory(rows(20, 9)));
  const dormant = summarizeShadow(buildShadowHistory(rows(20, 10)));

  it("flips an eligible V6_BASE direction while active", () => {
    const d = applyRegimeInverter("GREEN", "V6_BASE", active);
    expect(d.triggered).toBe(true);
    expect(d.finalPrediction).toBe("RED");
    expect(d.finalPredictionSource).toBe("REGIME_INVERTER");
    expect(d.reason).toBe("V6_REGIME_INVERSION");
  });

  it("never touches abstentions or pickup-sourced predictions", () => {
    expect(applyRegimeInverter("ABSTAIN", "ABSTAIN", active).triggered).toBe(false);
    expect(applyRegimeInverter("RED", "CONSENSUS_RED_PICKUP", active).triggered).toBe(false);
    expect(
      applyRegimeInverter("GREEN", "MOMENTUM_EXPANSION_GREEN_PICKUP", active).finalPrediction,
    ).toBe("GREEN");
  });

  it("passes through unchanged while dormant", () => {
    const d = applyRegimeInverter("GREEN", "V6_BASE", dormant);
    expect(d.evaluable).toBe(true);
    expect(d.triggered).toBe(false);
    expect(d.finalPrediction).toBe("GREEN");
    expect(d.finalPredictionSource).toBe("V6_BASE");
  });
});

describe("inverterContribution", () => {
  it("credits a flip that converted a loss into a win", () => {
    expect(inverterContribution(true, "GREEN", "RED", "RED")).toEqual({ raw: 2, adjusted: 1.8 });
  });
  it("charges a flip that destroyed a win", () => {
    expect(inverterContribution(true, "GREEN", "RED", "GREEN")).toEqual({ raw: -2, adjusted: -1.8 });
  });
  it("is zero when not triggered or on PUSH", () => {
    expect(inverterContribution(false, "GREEN", "GREEN", "RED")).toEqual({ raw: 0, adjusted: 0 });
    expect(inverterContribution(true, "GREEN", "RED", "PUSH")).toEqual({ raw: 0, adjusted: 0 });
  });
});
