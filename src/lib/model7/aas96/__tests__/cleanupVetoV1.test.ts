import { describe, it, expect } from "vitest";
import { evaluateCleanupVetoV1 } from "../cleanupVetoV1";

const base = { baselineAbstainReason: null };

describe("cleanup_veto_v1", () => {
  it("fires when H96=GREEN and H64!=GREEN (recent_h64_conflict)", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "GREEN", h64: "RED", h96: "GREEN", h192: "GREEN",
    });
    expect(r.fired).toBe(true);
    expect(r.conflictSubtype).toBe("recent_h64_conflict");
    expect(r.publishedPrediction).toBe("ABSTAIN");
    expect(r.publishedAbstainReason).toBe("b96_green_horizon_conflict");
  });

  it("fires when H96=GREEN and H192!=GREEN (long_h192_conflict)", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "RED",
      h32: "RED", h64: "GREEN", h96: "GREEN", h192: "RED",
    });
    expect(r.fired).toBe(true);
    expect(r.conflictSubtype).toBe("long_h192_conflict");
    expect(r.publishedPrediction).toBe("ABSTAIN");
  });

  it("fires as dual conflict when both H64 and H192 disagree", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "GREEN", h64: "RED", h96: "GREEN", h192: "RED",
    });
    expect(r.fired).toBe(true);
    expect(r.conflictSubtype).toBe("dual_h64_h192_conflict");
  });

  it("does not fire when H96=GREEN with H64+H192=GREEN", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "RED", h64: "GREEN", h96: "GREEN", h192: "GREEN",
    });
    expect(r.fired).toBe(false);
    expect(r.publishedPrediction).toBe("GREEN");
  });

  it("does not fire when H96 is RED (rule scoped to H96=GREEN)", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "RED",
      h32: "RED", h64: "RED", h96: "RED", h192: "GREEN",
    });
    expect(r.fired).toBe(false);
    expect(r.publishedPrediction).toBe("RED");
  });

  it("preserves an existing SKIP baseline (never reclassifies)", () => {
    const r = evaluateCleanupVetoV1({
      baselinePrediction: "SKIP", baselineAbstainReason: "no_partial_snapshot",
      h32: "GREEN", h64: "RED", h96: "GREEN", h192: "GREEN",
    });
    expect(r.publishedPrediction).toBe("SKIP");
    expect(r.publishedAbstainReason).toBe("no_partial_snapshot");
  });

  it("marks evaluable=false when any of H64/H96/H192 missing", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "GREEN", h64: null, h96: "GREEN", h192: "GREEN",
    });
    expect(r.evaluable).toBe(false);
    expect(r.fired).toBe(false);
  });
});
