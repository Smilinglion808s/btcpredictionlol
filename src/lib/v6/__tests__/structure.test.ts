import { describe, expect, it } from "vitest";
import {
  applyStructureConfirmation,
  evaluateStructureExpansion,
  evaluateStructureRejection,
  structureContribution,
  STRUCTURE_CONFIRMATION_VETO_REASON,
  STRUCTURE_EXPANSION_EFFICIENCY_MIN,
  STRUCTURE_EXPANSION_RANGE_MIN,
  STRUCTURE_REJECTION_ALIGNED_WICK_MIN,
  STRUCTURE_REJECTION_LOWER_WICK_MIN,
  V6_R4_MODEL_REVISION,
} from "../structure";

const inputs = (o: Partial<Record<string, number | null>> = {}) => ({
  lower_wick_pct: 0.1,
  aligned_wick_pressure_4: 0.1,
  range_expansion_vs_avg20: 0.5,
  path_efficiency_4: 0.1,
  ...o,
}) as never;

describe("V6-r4 frozen constants", () => {
  it("uses exactly the frozen thresholds", () => {
    expect(STRUCTURE_REJECTION_LOWER_WICK_MIN).toBe(0.4);
    expect(STRUCTURE_REJECTION_ALIGNED_WICK_MIN).toBe(0);
    expect(STRUCTURE_EXPANSION_RANGE_MIN).toBe(0.8);
    expect(STRUCTURE_EXPANSION_EFFICIENCY_MIN).toBe(0.3);
    expect(V6_R4_MODEL_REVISION).toBe("V6-r4-structure-confirmation");
  });
});

describe("Structure A — rejection / defense", () => {
  it("passes at exactly the thresholds", () => {
    expect(
      evaluateStructureRejection(inputs({ lower_wick_pct: 0.4, aligned_wick_pressure_4: 0 })).pass,
    ).toBe(true);
  });
  it("fails just below the wick threshold at full precision", () => {
    expect(
      evaluateStructureRejection(inputs({ lower_wick_pct: 0.3999999, aligned_wick_pressure_4: 0.5 })).pass,
    ).toBe(false);
  });
  it("fails on negative aligned wick pressure", () => {
    expect(
      evaluateStructureRejection(inputs({ lower_wick_pct: 0.9, aligned_wick_pressure_4: -0.0001 })).pass,
    ).toBe(false);
  });
  it("requires both conditions", () => {
    expect(evaluateStructureRejection(inputs({ lower_wick_pct: 0.9 })).pass).toBe(true);
    expect(evaluateStructureRejection(inputs({ aligned_wick_pressure_4: 5 })).pass).toBe(false);
  });
  it("fails closed on missing inputs", () => {
    const r = evaluateStructureRejection(inputs({ lower_wick_pct: null }));
    expect(r.evaluable).toBe(false);
    expect(r.pass).toBe(false);
  });
});

describe("Structure B — expansion / efficiency", () => {
  it("passes at exactly the thresholds", () => {
    expect(
      evaluateStructureExpansion(inputs({ range_expansion_vs_avg20: 0.8, path_efficiency_4: 0.3 })).pass,
    ).toBe(true);
  });
  it("fails just below either threshold", () => {
    expect(
      evaluateStructureExpansion(inputs({ range_expansion_vs_avg20: 0.7999999, path_efficiency_4: 0.9 })).pass,
    ).toBe(false);
    expect(
      evaluateStructureExpansion(inputs({ range_expansion_vs_avg20: 1.5, path_efficiency_4: 0.2999999 })).pass,
    ).toBe(false);
  });
  it("fails closed on missing inputs", () => {
    const r = evaluateStructureExpansion(inputs({ path_efficiency_4: null }));
    expect(r.evaluable).toBe(false);
    expect(r.pass).toBe(false);
  });
});

describe("Combined structure confirmation gate", () => {
  it("rejection alone permits publication and preserves the source", () => {
    const d = applyStructureConfirmation(
      "GREEN",
      "V6_BASE",
      inputs({ lower_wick_pct: 0.5, aligned_wick_pressure_4: 0.1 }),
    );
    expect(d.pass).toBe(true);
    expect(d.triggered).toBe(false);
    expect(d.prediction).toBe("GREEN");
    expect(d.predictionSource).toBe("V6_BASE");
  });

  it("expansion alone permits publication when rejection inputs are missing", () => {
    const d = applyStructureConfirmation(
      "RED",
      "WEAK_RED_RSI_RECOVERY" as never,
      inputs({
        lower_wick_pct: null,
        aligned_wick_pressure_4: null,
        range_expansion_vs_avg20: 1.12,
        path_efficiency_4: 0.44,
      }),
    );
    expect(d.rejection.pass).toBe(false);
    expect(d.expansion.pass).toBe(true);
    expect(d.prediction).toBe("RED");
    expect(d.predictionSource).toBe("WEAK_RED_RSI_RECOVERY");
  });

  it("both structures passing permits publication", () => {
    const d = applyStructureConfirmation(
      "GREEN",
      "GREEN_MOMENTUM_PICKUP" as never,
      inputs({
        lower_wick_pct: 0.6,
        aligned_wick_pressure_4: 0.2,
        range_expansion_vs_avg20: 1.4,
        path_efficiency_4: 0.7,
      }),
    );
    expect(d.pass).toBe(true);
    expect(d.predictionSource).toBe("GREEN_MOMENTUM_PICKUP");
  });

  it("neither structure passing abstains without reversing direction", () => {
    for (const dir of ["GREEN", "RED"] as const) {
      const d = applyStructureConfirmation(dir, "V6_BASE", inputs());
      expect(d.triggered).toBe(true);
      expect(d.prediction).toBe("ABSTAIN");
      expect(d.predictionSource).toBe("ABSTAIN");
      expect(d.reason).toBe(STRUCTURE_CONFIRMATION_VETO_REASON);
      expect(d.underlyingPrediction).toBe(dir);
      expect(d.preStructurePrediction).toBe(dir);
    }
  });

  it("never converts ABSTAIN or OP_FAIL into a direction", () => {
    for (const p of ["ABSTAIN", "OP_FAIL"] as const) {
      const d = applyStructureConfirmation(p as never, p as never, inputs({
        lower_wick_pct: 0.9,
        aligned_wick_pressure_4: 0.9,
      }));
      expect(d.evaluable).toBe(false);
      expect(d.triggered).toBe(false);
      expect(d.pass).toBe(false);
      expect(d.prediction).toBe(p);
      expect(d.predictionSource).toBe(p);
    }
  });
});

describe("Structure confirmation accounting", () => {
  it("credits +1 raw / +1 adjusted for an avoided loss", () => {
    expect(structureContribution(true, "GREEN", "RED")).toEqual({
      raw: 1, adjusted: 1, avoidedLoss: true, sacrificedWin: false,
    });
  });
  it("charges -1 raw / -0.8 adjusted for a sacrificed win", () => {
    expect(structureContribution(true, "RED", "RED")).toEqual({
      raw: -1, adjusted: -0.8, avoidedLoss: false, sacrificedWin: true,
    });
  });
  it("contributes zero when not triggered or on PUSH", () => {
    expect(structureContribution(false, "RED", "GREEN").raw).toBe(0);
    expect(structureContribution(true, "RED", "PUSH").adjusted).toBe(0);
  });
});

describe("Structure gate must not contaminate the inverter shadow", () => {
  it("grades the underlying V6_BASE direction even when structure vetoes it", async () => {
    const { buildShadowHistory, summarizeShadow } = await import("../regimeInverter");
    // Original V6_BASE = RED, structure FAIL → published ABSTAIN, actual GREEN.
    const history = buildShadowHistory([
      {
        target_candle_ts: "2026-08-08T09:00:00.000Z",
        prediction_source: "V6_BASE", // effective base source, not the published one
        original_v6_base_prediction: "RED",
        operational_status: "OK",
        canonical_ground_truth_valid: true,
        actual_direction: "GREEN",
      },
    ]);
    expect(history).toHaveLength(1);
    expect(history[0].original_v6_base_prediction).toBe("RED");
    expect(history[0].original_v6_shadow_raw_score).toBe(-1);
    expect(summarizeShadow(history).losses).toBe(1);

    // Published r4 scores zero while structure takes the +1 credit.
    expect(structureContribution(true, "RED", "GREEN")).toMatchObject({ raw: 1, adjusted: 1 });
  });
});
