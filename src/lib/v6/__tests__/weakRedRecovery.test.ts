// V6-r2 weak-broad RED veto coverage recovery.
//
// Every case starts from the frozen weak_broad_red_veto parity vector and only
// perturbs rsi14 / roc_4 on the current technical row, so the frozen V6 core
// (ridge, boosted, broad, anchor, base decision) is exercised unchanged.

import { describe, it, expect } from "vitest";
import {
  inferV6,
  WEAK_RED_RSI_THRESHOLD,
  WEAK_RED_ROC4_THRESHOLD,
  type Direction,
  type TechnicalRow,
} from "../inference";
import { V6_MODEL_REVISION } from "../regimeInverter";
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

function run(vector: Vector, overrides: Partial<TechnicalRow> = {}) {
  return inferV6(
    { ...vector.current_completed_row, ...overrides },
    vector.previous_1_completed_row,
    vector.previous_4_completed_row,
    { priorBasePredictions: vector.state.priorBasePredictions },
  );
}

const weak = pick("weak_broad_red_veto");

describe("V6-r2 weak RED recovery", () => {
  it("uses the frozen thresholds", () => {
    expect(WEAK_RED_RSI_THRESHOLD).toBe(58);
    expect(WEAK_RED_ROC4_THRESHOLD).toBe(0.28);
    expect(V6_MODEL_REVISION).toBe("V6-r2-regime-inverter-red-recovery");
  });

  it("still identifies the weak-broad RED veto candidate", () => {
    const out = run(weak, { rsi14: 70, roc_4: 0 });
    expect(out.weakRedVetoCandidate).toBe(true);
    expect(out.weakRedVetoOriginalPrediction).toBe("RED");
    expect(out.preWeakRedVetoPrediction).toBe("RED");
    expect(out.predictionSource).toBe("V6_BASE");
    expect(out.weakRedVetoBroadPercentile).toBeGreaterThanOrEqual(0.15);
  });

  it("restores RED when rsi14 < 58", () => {
    const out = run(weak, { rsi14: 41.234567, roc_4: 0 });
    expect(out.weakRedRsiRecoveryTriggered).toBe(true);
    expect(out.weakRedRecoveryReason).toBe("WEAK_RED_RSI_CONTINUATION_RECOVERY");
    expect(out.finalPrediction).toBe("RED");
    expect(out.weakBroadRedVetoTriggered).toBe(false);
    expect(out.abstainReason).toBeNull();
  });

  it("restores RED at exactly rsi14 == 58", () => {
    const out = run(weak, { rsi14: 58, roc_4: 0 });
    expect(out.weakRedRsiRecoveryTriggered).toBe(true);
    expect(out.finalPrediction).toBe("RED");
  });

  it("does not use the RSI branch when rsi14 > 58", () => {
    const out = run(weak, { rsi14: 58.0000001, roc_4: 0 });
    expect(out.weakRedRsiRecoveryTriggered).toBe(false);
  });

  it("restores RED when roc_4 > 0.28 with rsi14 > 58", () => {
    const out = run(weak, { rsi14: 72, roc_4: 0.51 });
    expect(out.weakRedRoc4RecoveryTriggered).toBe(true);
    expect(out.weakRedRecoveryReason).toBe("WEAK_RED_ROC4_OVEREXTENSION_RECOVERY");
    expect(out.finalPrediction).toBe("RED");
  });

  it("restores RED at exactly roc_4 == 0.28", () => {
    const out = run(weak, { rsi14: 72, roc_4: 0.28 });
    expect(out.weakRedRoc4RecoveryTriggered).toBe(true);
    expect(out.finalPrediction).toBe("RED");
  });

  it("does not use the ROC4 branch just below the threshold", () => {
    const out = run(weak, { rsi14: 72, roc_4: 0.2799999999 });
    expect(out.weakRedRoc4RecoveryTriggered).toBe(false);
    expect(out.finalPrediction).toBe("ABSTAIN");
    expect(out.abstainReason).toBe("WEAK_BROAD_RED_VETO");
  });

  it("gives RSI priority when both branches would qualify", () => {
    const out = run(weak, { rsi14: 40, roc_4: 0.9 });
    expect(out.weakRedRsiRecoveryTriggered).toBe(true);
    expect(out.weakRedRoc4RecoveryTriggered).toBe(false);
    expect(out.weakRedRoc4RecoveryEvaluable).toBe(false);
    expect(out.weakRedRecoveryReason).toBe("WEAK_RED_RSI_CONTINUATION_RECOVERY");
  });

  it("keeps ABSTAIN when both branches fail", () => {
    const out = run(weak, { rsi14: 65, roc_4: 0.1 });
    expect(out.weakRedRecoveryTriggered).toBe(false);
    expect(out.finalPrediction).toBe("ABSTAIN");
    expect(out.predictionAfterWeakRedRecovery).toBe("ABSTAIN");
  });

  it("never restores RED when rsi14 or roc_4 is unavailable", () => {
    for (const bad of [null, undefined, "n/a", Number.NaN]) {
      const out = run(weak, { rsi14: bad as never, roc_4: bad as never });
      expect(out.weakRedRecoveryTriggered).toBe(false);
      expect(out.finalPrediction).toBe("ABSTAIN");
    }
    const missingRoc = run(weak, { rsi14: 70, roc_4: null as never });
    expect(missingRoc.weakRedRecoveryTriggered).toBe(false);
    expect(missingRoc.finalPrediction).toBe("ABSTAIN");
  });

  it("keeps a restored RED on the V6_BASE source before inversion", () => {
    const out = run(weak, { rsi14: 40 });
    expect(out.predictionSourceAfterWeakRedRecovery).toBe("V6_BASE");
    expect(out.redPickupTriggered).toBe(false);
    expect(out.greenPickupTriggered).toBe(false);
  });

  it("uses full precision, not rounded display values", () => {
    const justOver = run(weak, { rsi14: 58.4, roc_4: 0 }); // rounds to 58 for display
    expect(justOver.weakRedRsiRecoveryTriggered).toBe(false);
    const justUnder = run(weak, { rsi14: 57.999999999, roc_4: 0 });
    expect(justUnder.weakRedRsiRecoveryTriggered).toBe(true);
  });

  it("leaves non-weak-RED outcomes untouched", () => {
    for (const name of [
      "base_green",
      "base_abstain",
      "consensus_red_pickup",
      "momentum_green_pickup",
      "green_saturation_veto",
    ]) {
      const v = pick(name);
      const out = run(v, { rsi14: 10, roc_4: 5 });
      expect(out.weakRedVetoCandidate).toBe(false);
      expect(out.weakRedRecoveryTriggered).toBe(false);
      expect(out.weakRedRecoveryReason).toBeNull();
      expect(out.finalPrediction).toBe(out.preWeakRedVetoPrediction);
    }
  });
});
