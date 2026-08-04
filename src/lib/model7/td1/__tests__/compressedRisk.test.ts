import { describe, expect, it } from "vitest";
import {
  ABSTAIN_TD1_COMPRESSED_RISK,
  TD1_COMPRESSED_RISK_THRESHOLD,
  classifyCompressedRiskCounterfactual,
  evaluateCompressedRisk,
  scoreDecision,
} from "../compressedRisk";
import { decideTd1Rc, type Td1Artifact, type Td1Features } from "../decision";
import { TD1_FEATURE_ORDER } from "../decision";

const features = Object.fromEntries(
  TD1_FEATURE_ORDER.map((n) => [n, 0]),
) as Td1Features;

/** Single-leaf artifact whose loss probability we control per test. */
function artifactWithProb(p: number): Td1Artifact {
  return {
    schemaVersion: "1.0.0",
    fitId: "test-fit",
    baseVariant: "A2_Combined",
    trainedThroughCandleTs: "2026-01-01T00:00:00.000Z",
    featureOrder: TD1_FEATURE_ORDER,
    tree: { leaf: { lossProbability: p, sampleCount: 10, lossCount: 5 } },
    artifactSha256: "deadbeef",
  };
}

const noContainment = { vetoFired: false, slotsBefore: 0, slotsAfter: 0, episodeArmed: false };

function decide(p: number, marketCondition: string | null) {
  const cr = evaluateCompressedRisk({ marketCondition, lossProbability: p });
  return decideTd1Rc({
    a2FinalDecision: "YES",
    features,
    artifact: artifactWithProb(p),
    containment: noContainment,
    compressedRisk: cr,
  });
}

describe("TD1 compressed-risk threshold", () => {
  it("is 0.45 and inclusive without rounding", () => {
    expect(TD1_COMPRESSED_RISK_THRESHOLD).toBe(0.45);
    expect(evaluateCompressedRisk({ marketCondition: "compressed", lossProbability: 0.45 }).condition).toBe(true);
    expect(evaluateCompressedRisk({ marketCondition: "compressed", lossProbability: 0.4499999 }).condition).toBe(false);
  });

  it("compressed + exactly 0.45 abstains", () => {
    const d = decide(0.45, "compressed");
    expect(d.externalFinalDecision).toBe("SKIP");
    expect(d.wouldTrade).toBe(false);
    expect(d.primarySkipReason).toBe(ABSTAIN_TD1_COMPRESSED_RISK);
    expect(d.compressedRiskVetoFired).toBe(true);
  });

  it("compressed + 0.449999 does not fire the new rule", () => {
    const d = decide(0.449999, "compressed");
    expect(d.compressedRiskVetoFired).toBe(false);
    expect(d.externalFinalDecision).toBe("YES");
  });

  it("non-compressed above 0.45 but below 0.60 does not fire", () => {
    const d = decide(0.55, "trending");
    expect(d.compressedRiskVetoFired).toBe(false);
    expect(d.legacyGlobalVetoCondition).toBe(false);
    expect(d.externalFinalDecision).toBe("YES");
  });

  it("compressed above 0.60 → compressed-risk wins first match, legacy still recorded", () => {
    const d = decide(0.7, "compressed");
    expect(d.primarySkipReason).toBe(ABSTAIN_TD1_COMPRESSED_RISK);
    expect(d.legacyGlobalVetoCondition).toBe(true);
    expect(d.allVetoReasons).toContain("TD1_TURN_RISK");
  });

  it("missing market condition → not evaluable, does not fire, legacy behavior continues", () => {
    const d = decide(0.7, null);
    expect(d.compressedRiskEvaluable).toBe(false);
    expect(d.compressedRiskVetoFired).toBe(false);
    expect(d.primarySkipReason).toBe("TD1_TURN_RISK");
    const unknown = evaluateCompressedRisk({ marketCondition: "unknown", lossProbability: 0.9 });
    expect(unknown.evaluable).toBe(false);
    expect(unknown.condition).toBe(false);
  });

  it("does not change direction — only publishes or skips", () => {
    const d = decideTd1Rc({
      a2FinalDecision: "NO",
      features,
      artifact: artifactWithProb(0.1),
      containment: noContainment,
      compressedRisk: evaluateCompressedRisk({ marketCondition: "compressed", lossProbability: 0.1 }),
    });
    expect(d.externalFinalDecision).toBe("NO");
    expect(d.underlyingDirection).toBe("NO");
  });
});

describe("audit-only policy counterfactuals", () => {
  it("previous policy reproduces the pre-patch tree (no compressed rule)", () => {
    const d = decide(0.5, "compressed");
    expect(d.externalFinalDecision).toBe("SKIP");
    expect(d.previousPolicy.decision).toBe("YES");
    expect(d.previousPolicy.reasons).toEqual([]);
  });

  it("no-global-veto counterfactual never affects the active decision", () => {
    const d = decide(0.65, "trending");
    expect(d.externalFinalDecision).toBe("SKIP"); // legacy 0.60 gate still active live
    expect(d.noGlobalVetoPolicy.decision).toBe("YES");
  });
});

describe("resolution counterfactual classification", () => {
  it("AVOIDED_LOSS", () => {
    const r = classifyCompressedRiskCounterfactual({
      vetoFired: true, underlyingDirection: "YES", actualDirection: "RED",
    });
    expect(r.classification).toBe("AVOIDED_LOSS");
    expect(r.vetoValue).toBe(1);
    expect(r.abstentionScore).toBe(0);
  });

  it("SACRIFICED_WIN", () => {
    const r = classifyCompressedRiskCounterfactual({
      vetoFired: true, underlyingDirection: "YES", actualDirection: "GREEN",
    });
    expect(r.classification).toBe("SACRIFICED_WIN");
    expect(r.vetoValue).toBe(-1);
  });

  it("PUSH scores zero", () => {
    const r = classifyCompressedRiskCounterfactual({
      vetoFired: true, underlyingDirection: "NO", actualDirection: "PUSH",
    });
    expect(r.classification).toBe("PUSH");
    expect(r.vetoValue).toBe(0);
    expect(r.abstentionScore).toBe(0);
  });

  it("NOT_APPLICABLE when the veto never fired", () => {
    expect(classifyCompressedRiskCounterfactual({
      vetoFired: false, underlyingDirection: "YES", actualDirection: "GREEN",
    }).classification).toBe("NOT_APPLICABLE");
  });

  it("scoreDecision: WIN +1, LOSS -1, PUSH/SKIP 0", () => {
    expect(scoreDecision("YES", "GREEN")).toEqual({ result: "WIN", score: 1 });
    expect(scoreDecision("YES", "RED")).toEqual({ result: "LOSS", score: -1 });
    expect(scoreDecision("SKIP", "GREEN")).toEqual({ result: "PUSH", score: 0 });
    expect(scoreDecision("NO", "PUSH")).toEqual({ result: "PUSH", score: 0 });
  });
});
