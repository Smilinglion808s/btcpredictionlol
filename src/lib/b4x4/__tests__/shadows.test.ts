import { describe, expect, it } from "vitest";
import type { B4x4Decision, HistoryEntry } from "../engine";
import {
  SHADOW_A_VARIANT,
  SHADOW_B_VARIANT,
  evaluateShadowA,
  evaluateShadowB,
  shortCellStats,
} from "../shadows";

function decision(over: Partial<B4x4Decision> = {}): B4x4Decision {
  return {
    probabilityGreen: 0.61,
    rawDirection: "GREEN",
    confidence: 0.61,
    dataValid: true,
    dataInvalidReason: null,
    sourceIndexAbsolute: 800,
    globalRank: 0.7,
    globalHistoryCount: 384,
    globalHistoryStartTs: null,
    globalHistoryEndTs: null,
    globalHistoryStartIndex: null,
    globalHistoryEndIndex: null,
    sameSideRank: 0.7,
    sameSideHistoryCount: 300,
    sameSideHistoryStartTs: null,
    sameSideHistoryEndTs: null,
    sameSideInputSourceCount: 768,
    sameSideFilteredCount: 300,
    sameSideHistoryStartIndex: null,
    sameSideHistoryEndIndex: null,
    sameSideRawDirectionFilter: "GREEN",
    globalRankQuartile: 3,
    sameSideRankQuartile: 3,
    qualityMean: 0.7,
    gridTrainingResolvedCount: 700,
    gridTrainingSourceCount: 768,
    gridTrainingStartIndex: 32,
    gridTrainingEndIndex: 799,
    gridTrainingStartTs: null,
    gridTrainingEndTs: null,
    gridWindowIntegrityPassed: true,
    gridWindowIntegrityReason: null,
    gridCell: "3-3",
    gridCellResolvedCount: 40,
    gridCellWins: 24,
    gridCellLosses: 16,
    pCorrect: 0.57,
    gridReferenceCount: 384,
    gridReferenceSourceCount: 384,
    gridReferenceStartIndex: null,
    gridReferenceEndIndex: null,
    gridReferenceStartTs: null,
    gridReferenceEndTs: null,
    gridQualityPercentile: 0.9,
    gridSnapshot: null,
    ...(over as object),
  } as B4x4Decision;
}

function hist(n: number, cell: [number, number], correct: boolean[]): HistoryEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    candleTs: new Date(Date.UTC(2026, 0, 1) + i * 900_000).toISOString(),
    confidence: 0.6,
    direction: "GREEN" as const,
    globalRank: 0.6,
    sameSideRank: 0.6,
    globalQuartile: cell[0],
    sameSideQuartile: cell[1],
    qualityMean: 0.6,
    actualDirection: correct[i % correct.length] ? ("GREEN" as const) : ("RED" as const),
    correct: correct[i % correct.length]!,
  }));
}

describe("B4x4 policy shadows (reporting only)", () => {
  it("shadow A gates expansion-only rows on short-cell reliability", () => {
    const history = hist(900, [3, 3], [false, false, false, true]);
    const d = decision({ coreEligible: false, expansionEligible: true, selectedRoute: "EXPANSION", baseCandidate: true } as Partial<B4x4Decision>);
    const s = evaluateShadowA(d, history, 0);
    expect(s.shadowVariant).toBe(SHADOW_A_VARIANT);
    expect(s.gateFired).toBe(true);
    expect(s.wouldTrade).toBe(false);
    expect(s.decisionReason).toBe("ABSTAIN_SHADOW_SHORT_CELL_RELIABILITY");
  });

  it("shadow A leaves core rows untouched", () => {
    const history = hist(900, [3, 3], [true]);
    const d = decision({ coreEligible: true, expansionEligible: false, selectedRoute: "CORE", baseCandidate: true } as Partial<B4x4Decision>);
    const s = evaluateShadowA(d, history, 0);
    expect(s.gateFired).toBe(false);
    expect(s.wouldTrade).toBe(true);
    expect(s.finalPrediction).toBe("GREEN");
  });

  it("shadow B vetoes only the marginal expansion band", () => {
    const base = { coreEligible: false, expansionEligible: true, selectedRoute: "EXPANSION", baseCandidate: true };
    const inBand = evaluateShadowB(decision({ ...base, gridQualityPercentile: 0.67 } as Partial<B4x4Decision>), 0);
    expect(inBand.gateFired).toBe(true);
    expect(inBand.wouldTrade).toBe(false);
    const above = evaluateShadowB(decision({ ...base, gridQualityPercentile: 0.71 } as Partial<B4x4Decision>), 0);
    expect(above.gateFired).toBe(false);
    expect(above.wouldTrade).toBe(true);
    expect(above.shadowVariant).toBe(SHADOW_B_VARIANT);
  });

  it("each shadow replays the brake against its own daily net", () => {
    const d = decision({ coreEligible: true, expansionEligible: false, selectedRoute: "CORE", baseCandidate: true, gridQualityPercentile: 0.5 } as Partial<B4x4Decision>);
    const braked = evaluateShadowB(d, -3);
    expect(braked.brakeActive).toBe(true);
    expect(braked.brakeVetoFired).toBe(true);
    expect(braked.wouldTrade).toBe(false);
    const clear = evaluateShadowB(d, -1);
    expect(clear.brakeVetoFired).toBe(false);
    expect(clear.wouldTrade).toBe(true);
  });

  it("short-cell stats only look back 96 source positions", () => {
    const history = hist(300, [3, 3], [true]);
    const stats = shortCellStats(history, 300, "3-3");
    expect(stats.sourceWindowCount).toBe(96);
    expect(stats.wins).toBe(96);
  });
});
