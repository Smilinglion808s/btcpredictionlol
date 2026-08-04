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
import { applyRegimeInverter, V6_MODEL_REVISION } from "../regimeInverter";
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
