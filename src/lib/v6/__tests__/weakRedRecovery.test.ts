// V6-r2 weak-broad RED veto coverage recovery.
//
// Branch logic is tested against the pure evaluator (so the frozen V6 core is
// never perturbed), plus end-to-end assertions on the frozen parity vectors.

import { describe, it, expect } from "vitest";
import {
  evaluateWeakRedRecovery,
  inferV6,
  WEAK_RED_RSI_THRESHOLD,
  WEAK_RED_ROC4_THRESHOLD,
  adjustedScore,
  rawScore,
  type Direction,
  type TechnicalRow,
} from "../inference";
import {
  applyRegimeInverter,
  inverterContribution,
  shadowScores,
  V6_MODEL_REVISION,
  type ShadowSummary,
} from "../regimeInverter";
import vectors from "./parity_vectors.json";

type Vector = {
  case: string;
  current_completed_row: TechnicalRow;
  previous_1_completed_row: TechnicalRow;
  previous_4_completed_row: TechnicalRow;
  state: { priorBasePredictions: Direction[] };
  expected: Record<string, unknown>;
};

const ALL = (vectors as { vectors: Vector[] }).vectors;
const pick = (name: string) => ALL.find((v) => v.case === name)!;
const run = (v: Vector) =>
  inferV6(v.current_completed_row, v.previous_1_completed_row, v.previous_4_completed_row, {
    priorBasePredictions: v.state.priorBasePredictions,
  });

describe("V6-r2 weak RED recovery — frozen thresholds", () => {
  it("uses 58 / 0.28 and the new revision id", () => {
    expect(WEAK_RED_RSI_THRESHOLD).toBe(58);
    expect(WEAK_RED_ROC4_THRESHOLD).toBe(0.28);
    expect(V6_MODEL_REVISION).toBe("V6-r2-regime-inverter-red-recovery");
  });
});

describe("V6-r2 recovery branches", () => {
  it("restores RED below the RSI threshold", () => {
    const r = evaluateWeakRedRecovery(true, 41.234567, 0);
    expect(r.rsiRecoveryTriggered).toBe(true);
    expect(r.reason).toBe("WEAK_RED_RSI_CONTINUATION_RECOVERY");
  });

  it("restores RED at exactly rsi14 == 58", () => {
    expect(evaluateWeakRedRecovery(true, 58, 0).rsiRecoveryTriggered).toBe(true);
  });

  it("does not use the RSI branch above 58", () => {
    expect(evaluateWeakRedRecovery(true, 58.0000001, 0).rsiRecoveryTriggered).toBe(false);
  });

  it("restores RED above the ROC4 threshold", () => {
    const r = evaluateWeakRedRecovery(true, 72, 0.51);
    expect(r.roc4RecoveryTriggered).toBe(true);
    expect(r.reason).toBe("WEAK_RED_ROC4_OVEREXTENSION_RECOVERY");
  });

  it("restores RED at exactly roc_4 == 0.28", () => {
    expect(evaluateWeakRedRecovery(true, 72, 0.28).roc4RecoveryTriggered).toBe(true);
  });

  it("does not use the ROC4 branch just below the threshold", () => {
    const r = evaluateWeakRedRecovery(true, 72, 0.2799999999);
    expect(r.roc4RecoveryTriggered).toBe(false);
    expect(r.recoveryTriggered).toBe(false);
    expect(r.reason).toBeNull();
  });

  it("gives RSI priority and assigns exactly one reason", () => {
    const r = evaluateWeakRedRecovery(true, 40, 0.9);
    expect(r.rsiRecoveryTriggered).toBe(true);
    expect(r.roc4RecoveryEvaluable).toBe(false);
    expect(r.roc4RecoveryTriggered).toBe(false);
    expect(r.reason).toBe("WEAK_RED_RSI_CONTINUATION_RECOVERY");
  });

  it("compares at full precision, not rounded display values", () => {
    expect(evaluateWeakRedRecovery(true, 58.4, 0).rsiRecoveryTriggered).toBe(false);
    expect(evaluateWeakRedRecovery(true, 57.999999999, 0).rsiRecoveryTriggered).toBe(true);
    expect(evaluateWeakRedRecovery(true, 72, 0.284999).roc4RecoveryTriggered).toBe(true);
  });

  it("fails closed on missing or invalid technicals", () => {
    for (const bad of [Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(evaluateWeakRedRecovery(true, bad, bad).recoveryTriggered).toBe(false);
    }
    expect(evaluateWeakRedRecovery(true, Number.NaN, 5).recoveryTriggered).toBe(false);
    expect(evaluateWeakRedRecovery(true, 72, Number.NaN).recoveryTriggered).toBe(false);
    expect(evaluateWeakRedRecovery(true, Number.NaN, 5).recoveryEvaluable).toBe(false);
  });

  it("never evaluates when the row is not a weak-RED candidate", () => {
    const r = evaluateWeakRedRecovery(false, 20, 9);
    expect(r.recoveryEvaluable).toBe(false);
    expect(r.recoveryTriggered).toBe(false);
    expect(r.reason).toBeNull();
  });
});

describe("V6-r2 end-to-end on frozen vectors", () => {
  const weak = run(pick("weak_broad_red_veto"));

  it("identifies the weak-broad RED candidate unchanged", () => {
    expect(weak.weakRedVetoCandidate).toBe(true);
    expect(weak.weakRedVetoOriginalPrediction).toBe("RED");
    expect(weak.preWeakRedVetoPrediction).toBe("RED");
    expect(weak.predictionSource).toBe("V6_BASE");
    expect(weak.weakRedVetoBroadPercentile!).toBeGreaterThanOrEqual(0.15);
    expect(weak.weakRedRsiThreshold).toBe(58);
    expect(weak.weakRedRoc4Threshold).toBe(0.28);
  });

  it("keeps a restored RED on V6_BASE and off the pickup paths", () => {
    if (!weak.weakRedRecoveryTriggered) return;
    expect(weak.finalPrediction).toBe("RED");
    expect(weak.predictionAfterWeakRedRecovery).toBe("RED");
    expect(weak.predictionSourceAfterWeakRedRecovery).toBe("V6_BASE");
    expect(weak.weakBroadRedVetoTriggered).toBe(false);
    expect(weak.redPickupTriggered).toBe(false);
    expect(weak.greenPickupTriggered).toBe(false);
    expect(weak.abstainReason).toBeNull();
  });

  it("leaves every non-weak-RED outcome untouched", () => {
    const cases: Array<[string, Direction | "ABSTAIN"]> = [
      ["base_green", "GREEN"],
      ["base_abstain", "ABSTAIN"],
      ["consensus_red_pickup", "RED"],
      ["momentum_green_pickup", "GREEN"],
      ["green_saturation_veto", "ABSTAIN"],
    ];
    for (const [name, expected] of cases) {
      const out = run(pick(name));
      expect(out.weakRedVetoCandidate).toBe(false);
      expect(out.weakRedRecoveryTriggered).toBe(false);
      expect(out.weakRedRecoveryReason).toBeNull();
      expect(out.finalPrediction).toBe(expected);
    }
  });

  it("lets the Regime Inverter flip a restored RED without touching recovery scoring", () => {
    const inverted = applyRegimeInverter("RED", "V6_BASE", {
      ready: true,
      active: true,
      count: 20,
      wins: 4,
      losses: 16,
      adjustedNet: -9,
      threshold: -2.8,
    });
    expect(inverted.triggered).toBe(true);
    expect(inverted.finalPrediction).toBe("GREEN");
    expect(inverted.finalPredictionSource).toBe("REGIME_INVERTER");

    // Recovery contribution grades the restored RED only; the inverter's own
    // contribution is scored separately.
    const actual = "GREEN" as const;
    expect(rawScore("RED", actual)).toBe(-1);
    expect(adjustedScore("RED", actual)).toBe(-1);
    expect(adjustedScore("GREEN", actual)).toBe(0.8);
  });
});

// V6-r2 hotfix: a RED restored by either recovery branch is still an ORIGINAL
// V6_BASE directional prediction and must remain eligible for the Regime
// Inverter. Pickups and retained vetoes stay ineligible.
describe("V6-r2 recovered RED reaches the Regime Inverter", () => {
  const summary = (over: Partial<ShadowSummary> = {}): ShadowSummary => ({
    ready: true,
    active: true,
    count: 20,
    wins: 9,
    losses: 11,
    adjustedNet: -3.8,
    threshold: -2.8,
    ...over,
  });

  const activeS = summary();
  const dormantS = summary({ active: false, wins: 10, losses: 10, adjustedNet: -2 });
  const notReadyS = summary({ ready: false, active: false, count: 12 });

  // Mirrors the orchestrator: pre-inverter values come straight from inference.
  const recovered = (branch: "rsi" | "roc4") => {
    const r = evaluateWeakRedRecovery(true, branch === "rsi" ? 41 : 72, branch === "rsi" ? 0 : 0.51);
    expect(r.recoveryTriggered).toBe(true);
    expect(r.reason).toBe(
      branch === "rsi"
        ? "WEAK_RED_RSI_CONTINUATION_RECOVERY"
        : "WEAK_RED_ROC4_OVEREXTENSION_RECOVERY",
    );
    // Restored RED publishes on V6_BASE, never as a pickup.
    return { prediction: "RED" as Direction, source: "V6_BASE" };
  };

  it("an RSI-restored RED stays V6_BASE before inversion", () => {
    const p = recovered("rsi");
    expect(p.prediction).toBe("RED");
    expect(p.source).toBe("V6_BASE");
    expect(applyRegimeInverter(p.prediction, p.source, dormantS).evaluable).toBe(true);
  });

  it("a ROC4-restored RED stays V6_BASE before inversion", () => {
    const p = recovered("roc4");
    expect(applyRegimeInverter(p.prediction, p.source, dormantS).evaluable).toBe(true);
  });

  for (const branch of ["rsi", "roc4"] as const) {
    it(`an active inverter flips a ${branch}-restored RED to GREEN`, () => {
      const p = recovered(branch);
      const d = applyRegimeInverter(p.prediction, p.source, activeS);
      expect(d.evaluable).toBe(true);
      expect(d.triggered).toBe(true);
      expect(d.originalPrediction).toBe("RED");
      expect(d.replacementPrediction).toBe("GREEN");
      expect(d.finalPrediction).toBe("GREEN");
      expect(d.finalPredictionSource).toBe("REGIME_INVERTER");
      expect(d.reason).toBe("V6_REGIME_INVERSION");
    });
  }

  it("an inactive inverter leaves a restored RED unchanged", () => {
    const d = applyRegimeInverter("RED", "V6_BASE", dormantS);
    expect(d.triggered).toBe(false);
    expect(d.finalPrediction).toBe("RED");
    expect(d.finalPredictionSource).toBe("V6_BASE");
  });

  it("a not-ready inverter leaves a restored RED unchanged", () => {
    const d = applyRegimeInverter("RED", "V6_BASE", notReadyS);
    expect(d.triggered).toBe(false);
    expect(d.finalPrediction).toBe("RED");
    expect(d.finalPredictionSource).toBe("V6_BASE");
  });

  it("pickups remain ineligible", () => {
    for (const src of ["CONSENSUS_RED_PICKUP", "MOMENTUM_EXPANSION_GREEN_PICKUP"]) {
      const d = applyRegimeInverter(src.includes("RED") ? "RED" : "GREEN", src, activeS);
      expect(d.evaluable).toBe(false);
      expect(d.triggered).toBe(false);
      expect(d.finalPredictionSource).toBe(src);
    }
  });

  it("a retained weak-broad RED veto stays ABSTAIN and never inverts", () => {
    const r = evaluateWeakRedRecovery(true, 72, 0.1);
    expect(r.recoveryTriggered).toBe(false);
    const d = applyRegimeInverter("ABSTAIN", "ABSTAIN", activeS);
    expect(d.evaluable).toBe(false);
    expect(d.finalPrediction).toBe("ABSTAIN");
  });

  it("scores recovery and inversion separately and grades the original RED", () => {
    const actual = "GREEN" as const;
    // Shadow history always grades the ORIGINAL uninverted V6_BASE RED.
    expect(shadowScores("RED", actual)).toEqual({ raw: -1, adjusted: -1 });
    // Recovery: restored RED vs the prior ABSTAIN (0).
    expect(adjustedScore("RED", actual)).toBe(-1);
    // Inverter: final GREEN vs pre-inverter RED.
    expect(inverterContribution(true, "RED", "GREEN", actual)).toEqual({ raw: 2, adjusted: 1.8 });
    expect(adjustedScore("GREEN", actual)).toBe(0.8);
  });
});
