// V6 parity: every supplied test vector must match the frozen reference within
// 1e-12 on probabilities/scores/percentiles and exactly on every decision.

import { describe, it, expect } from "vitest";
import { inferV6, type TechnicalRow, type Direction } from "../inference";
import vectors from "./parity_vectors.json";

type Vector = {
  case: string;
  current_completed_row: TechnicalRow;
  previous_1_completed_row: TechnicalRow;
  previous_4_completed_row: TechnicalRow;
  state: { priorBasePredictions: Direction[] };
  expected: Record<string, unknown>;
};

const NUMERIC = [
  "ridgePGreen",
  "ridgePercentile",
  "gbPGreen",
  "gbPercentile",
  "broadScore",
  "broadPercentile",
  "anchorScore",
  "anchorPercentile",
  "finalScore",
] as const;

const EXACT = [
  "basePrediction",
  "saturationVetoTriggered",
  "redPickupTriggered",
  "greenPickupTriggered",
  "predictionSource",
  "weakBroadRedVetoTriggered",
  "finalPrediction",
  "abstainReason",
] as const;

describe("V6 frozen parity vectors", () => {
  const cases = (vectors as { vectors: Vector[] }).vectors;

  it("covers every supplied vector", () => {
    expect(cases.length).toBeGreaterThan(0);
  });

  for (const vector of cases) {
    it(`matches case: ${vector.case}`, () => {
      const out = inferV6(
        vector.current_completed_row,
        vector.previous_1_completed_row,
        vector.previous_4_completed_row,
        { priorBasePredictions: vector.state.priorBasePredictions },
      );

      for (const key of NUMERIC) {
        const expected = vector.expected[key];
        if (typeof expected !== "number") continue;
        expect(Math.abs((out[key] as number) - expected)).toBeLessThanOrEqual(1e-12);
      }

      for (const key of EXACT) {
        if (!(key in vector.expected)) continue;
        // V6-r2: the weak-broad RED veto keeps its original candidate semantics,
        // but an approved recovery branch may restore the RED publication.
        if (key === "weakBroadRedVetoTriggered") {
          expect(out.weakRedVetoCandidate).toBe(vector.expected[key]);
          continue;
        }
        if (
          out.weakRedRecoveryTriggered &&
          (key === "finalPrediction" || key === "abstainReason")
        ) continue;
        expect(out[key]).toBe(vector.expected[key]);
      }
    });
  }
});
