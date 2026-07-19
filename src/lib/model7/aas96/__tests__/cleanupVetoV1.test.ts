import { describe, it, expect } from "vitest";
import {
  evaluateCleanupVetoV1,
  CLEANUP_VETO_V1_VERSION,
  CLEANUP_VETO_V1_REASON,
} from "../cleanupVetoV1";

const base = { baselineAbstainReason: null };

describe("cleanup_veto_v1 v1.1.0 — active dual-conflict rule only", () => {
  it("version constant is 1.1.0 and reason is dual_h64_h192_conflict", () => {
    expect(CLEANUP_VETO_V1_VERSION).toBe("1.1.0");
    expect(CLEANUP_VETO_V1_REASON).toBe("dual_h64_h192_conflict");
  });

  // Active trigger: H64=RED & H96=GREEN & H192=RED → ABSTAIN
  it("H64 RED, H96 GREEN, H192 RED (baseline GREEN) → veto fires → ABSTAIN", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "GREEN", h64: "RED", h96: "GREEN", h192: "RED",
    });
    expect(r.fired).toBe(true);
    expect(r.conflictSubtype).toBe("dual_h64_h192_conflict");
    expect(r.reason).toBe("dual_h64_h192_conflict");
    expect(r.publishedPrediction).toBe("ABSTAIN");
    expect(r.publishedAbstainReason).toBe("dual_h64_h192_conflict");
    expect(r.version).toBe("1.1.0");
  });

  it("dual conflict may fire when post-selector baseline is RED", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "RED",
      h32: "RED", h64: "RED", h96: "GREEN", h192: "RED",
    });
    expect(r.fired).toBe(true);
    expect(r.publishedPrediction).toBe("ABSTAIN");
  });

  // Disabled branches (previously fired under v1.0.0)
  it("H64 GREEN, H96 GREEN, H192 RED → veto does NOT fire (H192-only branch disabled)", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "GREEN", h64: "GREEN", h96: "GREEN", h192: "RED",
    });
    expect(r.fired).toBe(false);
    expect(r.publishedPrediction).toBe("GREEN");
  });

  it("H64 RED, H96 GREEN, H192 GREEN → veto does NOT fire (H64-only branch disabled)", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "GREEN", h64: "RED", h96: "GREEN", h192: "GREEN",
    });
    expect(r.fired).toBe(false);
    expect(r.publishedPrediction).toBe("GREEN");
  });

  // Non-fire cases
  it("all-GREEN → no fire", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "GREEN", h64: "GREEN", h96: "GREEN", h192: "GREEN",
    });
    expect(r.fired).toBe(false);
    expect(r.publishedPrediction).toBe("GREEN");
  });

  it("all-RED → no fire (H96 not GREEN)", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "RED",
      h32: "RED", h64: "RED", h96: "RED", h192: "RED",
    });
    expect(r.fired).toBe(false);
    expect(r.publishedPrediction).toBe("RED");
  });

  it("H96=RED with any other pattern → no fire", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "RED",
      h32: "GREEN", h64: "RED", h96: "RED", h192: "RED",
    });
    expect(r.fired).toBe(false);
    expect(r.publishedPrediction).toBe("RED");
  });

  // H32 is tracked but never gates
  it("H32=GREEN does not affect the result", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "GREEN", h64: "RED", h96: "GREEN", h192: "RED",
    });
    expect(r.fired).toBe(true);
  });

  it("H32=RED does not affect the result", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "RED", h64: "RED", h96: "GREEN", h192: "RED",
    });
    expect(r.fired).toBe(true);
  });

  it("missing H32 does not prevent evaluation", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: null, h64: "RED", h96: "GREEN", h192: "RED",
    });
    expect(r.evaluable).toBe(true);
    expect(r.fired).toBe(true);
  });

  // Evaluability guards
  it("missing H64 → evaluable=false, fired=false", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "GREEN", h64: null, h96: "GREEN", h192: "RED",
    });
    expect(r.evaluable).toBe(false);
    expect(r.fired).toBe(false);
    expect(r.publishedPrediction).toBe("GREEN");
  });

  it("missing H96 → evaluable=false, fired=false", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "GREEN",
      h32: "GREEN", h64: "RED", h96: null, h192: "RED",
    });
    expect(r.evaluable).toBe(false);
    expect(r.fired).toBe(false);
  });

  it("missing H192 → evaluable=false, fired=false", () => {
    const r = evaluateCleanupVetoV1({
      ...base, baselinePrediction: "RED",
      h32: "RED", h64: "RED", h96: "GREEN", h192: undefined,
    });
    expect(r.evaluable).toBe(false);
    expect(r.fired).toBe(false);
    expect(r.publishedPrediction).toBe("RED");
  });

  // Preserves existing non-actionable baselines verbatim (never relabels)
  it("preserves existing SKIP baseline verbatim even when trigger pattern present", () => {
    const r = evaluateCleanupVetoV1({
      baselinePrediction: "SKIP", baselineAbstainReason: "no_partial_snapshot",
      h32: "GREEN", h64: "RED", h96: "GREEN", h192: "RED",
    });
    expect(r.publishedPrediction).toBe("SKIP");
    expect(r.publishedAbstainReason).toBe("no_partial_snapshot");
    expect(r.reason).toBe("dual_h64_h192_conflict"); // fired flag independent
  });

  it("preserves existing ABSTAIN baseline reason verbatim", () => {
    const r = evaluateCleanupVetoV1({
      baselinePrediction: "ABSTAIN", baselineAbstainReason: "prior_reason",
      h32: "GREEN", h64: "RED", h96: "GREEN", h192: "RED",
    });
    expect(r.publishedPrediction).toBe("ABSTAIN");
    expect(r.publishedAbstainReason).toBe("prior_reason");
  });

  // Direction-invariance guard
  it("guard: veto never reverses direction — only ABSTAIN or original baseline", () => {
    const cases = [
      { d: "GREEN" as const, h64: "RED" as const, h192: "RED" as const },
      { d: "RED" as const, h64: "RED" as const, h192: "RED" as const },
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
