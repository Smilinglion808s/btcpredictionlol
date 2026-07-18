import { describe, it, expect } from "vitest";
import { evaluateCleanupVetoV1 } from "../cleanupVetoV1";

const base = { baselineAbstainReason: null };

describe("cleanup_veto_v1 — 12 validation cases", () => {
  // 1
  it("case 1: H96=GREEN + H64!=GREEN → recent_h64_conflict, ABSTAIN", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "GREEN", h64: "RED", h96: "GREEN", h192: "GREEN",
    });
    expect(r.fired).toBe(true);
    expect(r.conflictSubtype).toBe("recent_h64_conflict");
    expect(r.publishedPrediction).toBe("ABSTAIN");
    expect(r.publishedAbstainReason).toBe("b96_green_horizon_conflict");
  });

  // 2
  it("case 2: H96=GREEN + H192!=GREEN → long_h192_conflict, ABSTAIN", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "RED",
      h32: "RED", h64: "GREEN", h96: "GREEN", h192: "RED",
    });
    expect(r.fired).toBe(true);
    expect(r.conflictSubtype).toBe("long_h192_conflict");
    expect(r.publishedPrediction).toBe("ABSTAIN");
  });

  // 3
  it("case 3: H96=GREEN + H64 and H192!=GREEN → dual_h64_h192_conflict", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "GREEN", h64: "RED", h96: "GREEN", h192: "RED",
    });
    expect(r.fired).toBe(true);
    expect(r.conflictSubtype).toBe("dual_h64_h192_conflict");
    expect(r.publishedPrediction).toBe("ABSTAIN");
  });

  // 4
  it("case 4: all-GREEN (GGGG) → no fire, published=GREEN", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "GREEN", h64: "GREEN", h96: "GREEN", h192: "GREEN",
    });
    expect(r.fired).toBe(false);
    expect(r.publishedPrediction).toBe("GREEN");
  });

  // 5
  it("case 5: H96=GREEN with H32=RED but H64+H192=GREEN → no fire (H32 non-gating)", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "RED", h64: "GREEN", h96: "GREEN", h192: "GREEN",
    });
    expect(r.fired).toBe(false);
    expect(r.publishedPrediction).toBe("GREEN");
  });

  // 6
  it("case 6: H96=RED (any pattern) → veto never fires", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "RED",
      h32: "RED", h64: "RED", h96: "RED", h192: "GREEN",
    });
    expect(r.fired).toBe(false);
    expect(r.publishedPrediction).toBe("RED");
  });

  // 7
  it("case 7: H96=RED + all others GREEN → no fire, published stays RED", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "RED",
      h32: "GREEN", h64: "GREEN", h96: "RED", h192: "GREEN",
    });
    expect(r.fired).toBe(false);
    expect(r.publishedPrediction).toBe("RED");
  });

  // 8
  it("case 8: preserves existing SKIP baseline verbatim (never relabels)", () => {
    const r = evaluateCleanupVetoV1({
      baselinePrediction: "SKIP", baselineAbstainReason: "no_partial_snapshot",
      h32: "GREEN", h64: "RED", h96: "GREEN", h192: "GREEN",
    });
    expect(r.publishedPrediction).toBe("SKIP");
    expect(r.publishedAbstainReason).toBe("no_partial_snapshot");
    expect(r.reason).toBe("b96_green_horizon_conflict"); // fired flag independent
  });

  // 9
  it("case 9: preserves existing ABSTAIN baseline reason (never relabels)", () => {
    const r = evaluateCleanupVetoV1({
      baselinePrediction: "ABSTAIN", baselineAbstainReason: "prior_reason",
      h32: "GREEN", h64: "RED", h96: "GREEN", h192: "GREEN",
    });
    expect(r.publishedPrediction).toBe("ABSTAIN");
    expect(r.publishedAbstainReason).toBe("prior_reason");
  });

  // 10
  it("case 10: missing H64 → evaluable=false, fired=false, no inference", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "GREEN", h64: null, h96: "GREEN", h192: "GREEN",
    });
    expect(r.evaluable).toBe(false);
    expect(r.fired).toBe(false);
    expect(r.publishedPrediction).toBe("GREEN");
  });

  // 11
  it("case 11: missing H96 → evaluable=false, fired=false", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "GREEN", h64: "GREEN", h96: null, h192: "GREEN",
    });
    expect(r.evaluable).toBe(false);
    expect(r.fired).toBe(false);
  });

  // 12
  it("case 12: missing H192 → evaluable=false, fired=false", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "RED",
      h32: "RED", h64: "GREEN", h96: "GREEN", h192: undefined,
    });
    expect(r.evaluable).toBe(false);
    expect(r.fired).toBe(false);
    expect(r.publishedPrediction).toBe("RED");
  });

  // Direction-invariance guard (extra): veto never reverses direction.
  it("guard: veto never reverses direction — only ABSTAIN or original", () => {
    const cases = [
      { d: "GREEN" as const, h64: "RED" as const, h192: "GREEN" as const },
      { d: "GREEN" as const, h64: "GREEN" as const, h192: "RED" as const },
      { d: "RED" as const, h64: "RED" as const, h192: "GREEN" as const },
    ];
    for (const c of cases) {
      const r = evaluateCleanupVetoV1({
        ...base, baselinePrediction: c.d,
        h32: c.d, h64: c.h64, h96: "GREEN", h192: c.h192,
      });
      expect(["ABSTAIN", c.d]).toContain(r.publishedPrediction);
    }
  });
});
