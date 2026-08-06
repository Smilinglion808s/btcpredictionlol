import { describe, expect, it } from "vitest";
import {
  COMPRESSED_RISK_ATTRIBUTION_VERSION,
  attributeCompressedRisk,
} from "../compressedRisk";

const fired = {
  vetoFired: true,
  previousPolicyDecision: "YES" as const,
  previousPolicyWouldTrade: true,
  previousPolicySkipReason: null,
};

describe("compressed-risk policy-delta-v2 attribution", () => {
  it("previous policy trades and wins → SACRIFICED_WIN, score +1, value -1", () => {
    const a = attributeCompressedRisk({ ...fired, actualDirection: "GREEN" });
    expect(a.classification).toBe("SACRIFICED_WIN");
    expect(a.counterfactualScore).toBe(1);
    expect(a.vetoValue).toBe(-1);
    expect(a.incrementalChange).toBe(true);
    expect(a.attributionVersion).toBe(COMPRESSED_RISK_ATTRIBUTION_VERSION);
  });

  it("previous policy trades and loses → AVOIDED_LOSS, score -1, value +1", () => {
    const a = attributeCompressedRisk({ ...fired, actualDirection: "RED" });
    expect(a.classification).toBe("AVOIDED_LOSS");
    expect(a.counterfactualScore).toBe(-1);
    expect(a.vetoValue).toBe(1);
    expect(a.incrementalChange).toBe(true);
  });

  it("previous policy also skips on containment → NO_INCREMENTAL_CHANGE with zero value", () => {
    const a = attributeCompressedRisk({
      vetoFired: true,
      previousPolicyDecision: "SKIP",
      previousPolicyWouldTrade: false,
      previousPolicySkipReason: "DIRECTIONAL_CONTAINMENT",
      actualDirection: "GREEN",
    });
    expect(a.classification).toBe("NO_INCREMENTAL_CHANGE");
    expect(a.counterfactualScore).toBe(0);
    expect(a.vetoValue).toBe(0);
    expect(a.incrementalChange).toBe(false);
    expect(a.previousPolicySkipReason).toBe("DIRECTIONAL_CONTAINMENT");
  });

  it("previous policy also skips on the legacy global veto → same zero treatment", () => {
    const a = attributeCompressedRisk({
      vetoFired: true,
      previousPolicyDecision: "SKIP",
      previousPolicyWouldTrade: false,
      previousPolicySkipReason: "TD1_TURN_RISK",
      actualDirection: "RED",
    });
    expect(a.classification).toBe("NO_INCREMENTAL_CHANGE");
    expect(a.counterfactualScore).toBe(0);
    expect(a.vetoValue).toBe(0);
    expect(a.previousPolicySkipReason).toBe("TD1_TURN_RISK");
  });

  it("PUSH resolution scores zero", () => {
    const a = attributeCompressedRisk({ ...fired, actualDirection: "PUSH" });
    expect(a.classification).toBe("PUSH");
    expect(a.counterfactualScore).toBe(0);
    expect(a.vetoValue).toBe(0);
  });

  it("pending resolution is UNRESOLVED with null score and value", () => {
    const a = attributeCompressedRisk({ ...fired, actualDirection: null });
    expect(a.classification).toBe("UNRESOLVED");
    expect(a.counterfactualScore).toBeNull();
    expect(a.vetoValue).toBeNull();
    expect(a.incrementalChange).toBe(true);
  });

  it("gate did not fire → NOT_APPLICABLE with zero score and value", () => {
    const a = attributeCompressedRisk({
      vetoFired: false,
      previousPolicyDecision: "YES",
      previousPolicyWouldTrade: true,
      actualDirection: "GREEN",
    });
    expect(a.classification).toBe("NOT_APPLICABLE");
    expect(a.counterfactualScore).toBe(0);
    expect(a.vetoValue).toBe(0);
    expect(a.incrementalChange).toBe(false);
  });

  it("A2-ineligible rows (no previous direction) never manufacture a counterfactual", () => {
    const a = attributeCompressedRisk({
      vetoFired: true,
      previousPolicyDecision: null,
      previousPolicyWouldTrade: null,
      actualDirection: "GREEN",
    });
    expect(a.classification).toBe("NO_INCREMENTAL_CHANGE");
    expect(a.vetoValue).toBe(0);
  });

  it("is deterministic across duplicate resolution", () => {
    const a = attributeCompressedRisk({ ...fired, actualDirection: "RED" });
    const b = attributeCompressedRisk({ ...fired, actualDirection: "RED" });
    expect(a).toEqual(b);
  });

  it("frozen checkpoint reconciles to 18 avoided / 17 sacrificed / 2 no-change / +1", () => {
    const rows = [
      ...Array.from({ length: 18 }, () => ({ ...fired, actualDirection: "RED" as const })),
      ...Array.from({ length: 17 }, () => ({ ...fired, actualDirection: "GREEN" as const })),
      ...Array.from({ length: 2 }, () => ({
        vetoFired: true,
        previousPolicyDecision: "SKIP" as const,
        previousPolicyWouldTrade: false,
        previousPolicySkipReason: "DIRECTIONAL_CONTAINMENT",
        actualDirection: "GREEN" as const,
      })),
    ].map(attributeCompressedRisk);
    expect(rows.filter((r) => r.classification === "AVOIDED_LOSS")).toHaveLength(18);
    expect(rows.filter((r) => r.classification === "SACRIFICED_WIN")).toHaveLength(17);
    expect(rows.filter((r) => r.classification === "NO_INCREMENTAL_CHANGE")).toHaveLength(2);
    expect(rows.reduce((s, r) => s + (r.vetoValue ?? 0), 0)).toBe(1);
  });
});
