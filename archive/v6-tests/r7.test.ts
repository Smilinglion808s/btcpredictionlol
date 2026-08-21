import { describe, expect, it } from "vitest";
import {
  classifyAction,
  computeStateCandidate,
  evaluateR7,
  expertStateStats,
  percentileBin,
  rawContributionVsR6,
  resolveState,
  selectR7,
  R7_MIN_EXPERT_STATE_SAMPLES,
  R7_PUBLICATION_ENABLED,
  R7_SHADOW_ENABLED,
  type ExpertKey,
  type ExpertStateStats,
  type R7HistoryRow,
} from "../r7";

const NONE = {
  E1_R6: "NONE",
  E2_FROZEN_CORE: "NONE",
  E3_R4: "NONE",
  E4_STATE_MAP: "NONE",
} as R7HistoryRow["candidates"];

function row(
  i: number,
  stateId: string,
  actual: "GREEN" | "RED",
  candidates: Partial<R7HistoryRow["candidates"]> = {},
): R7HistoryRow {
  return {
    targetTs: new Date(Date.UTC(2026, 0, 1, 0, i * 15)).toISOString(),
    stateId,
    actual,
    candidates: { ...NONE, ...candidates },
  };
}

function stats(partial: Partial<ExpertStateStats>): ExpertStateStats {
  return {
    candidate: "NONE",
    samples: 0,
    wins: 0,
    losses: 0,
    rawNet: 0,
    winRate: null,
    rawEdgeRate: null,
    qualified: false,
    ...partial,
  };
}

describe("r7 ships shadow-first", () => {
  it("never publishes", () => {
    expect(R7_SHADOW_ENABLED).toBe(true);
    expect(R7_PUBLICATION_ENABLED).toBe(false);
  });
});

describe("4x4 state binning", () => {
  it("uses fixed quartile edges with 1.0 in the top bin", () => {
    expect(percentileBin(0)).toBe(0);
    expect(percentileBin(0.2499)).toBe(0);
    expect(percentileBin(0.25)).toBe(1);
    expect(percentileBin(0.5)).toBe(2);
    expect(percentileBin(0.75)).toBe(3);
    expect(percentileBin(1)).toBe(3);
  });

  it("fails closed on invalid percentiles", () => {
    expect(percentileBin(null)).toBeNull();
    expect(percentileBin(NaN)).toBeNull();
    expect(percentileBin(1.4)).toBeNull();
    expect(resolveState(0.4, null).evaluable).toBe(false);
    expect(resolveState(0.4, 0.9).stateId).toBe("B1_A3");
  });
});

describe("E4 state map", () => {
  it("stays NONE below the minimum sample count", () => {
    const history = Array.from({ length: 7 }, (_, i) => row(i, "B1_A1", "GREEN"));
    expect(computeStateCandidate(history, "B1_A1").candidate).toBe("NONE");
  });

  it("emits a direction once the state clears the 60% win rate", () => {
    const history = [
      ...Array.from({ length: 7 }, (_, i) => row(i, "B1_A1", "GREEN")),
      ...Array.from({ length: 3 }, (_, i) => row(10 + i, "B1_A1", "RED")),
      row(20, "B0_A0", "GREEN"),
    ];
    const s = computeStateCandidate(history, "B1_A1");
    expect(s.sampleCount).toBe(10);
    expect(s.greenWinRate).toBeCloseTo(0.7);
    expect(s.candidate).toBe("GREEN");
  });

  it("stays NONE when neither side reaches the threshold", () => {
    const history = [
      ...Array.from({ length: 5 }, (_, i) => row(i, "B2_A2", "GREEN")),
      ...Array.from({ length: 5 }, (_, i) => row(10 + i, "B2_A2", "RED")),
    ];
    expect(computeStateCandidate(history, "B2_A2").candidate).toBe("NONE");
  });
});

describe("expert qualification", () => {
  const history = [
    ...Array.from({ length: 6 }, (_, i) => row(i, "B1_A1", "GREEN", { E1_R6: "GREEN" })),
    ...Array.from({ length: 2 }, (_, i) => row(10 + i, "B1_A1", "RED", { E1_R6: "GREEN" })),
    row(20, "B3_A3", "RED", { E1_R6: "GREEN" }),
  ];

  it("counts only same-state directional samples", () => {
    const s = expertStateStats("E1_R6", "GREEN", history, "B1_A1");
    expect(s.samples).toBe(8);
    expect(s.wins).toBe(6);
    expect(s.losses).toBe(2);
    expect(s.rawNet).toBe(4);
    expect(s.winRate).toBeCloseTo(0.75);
    expect(s.qualified).toBe(true);
  });

  it("disqualifies below the minimum sample count", () => {
    const short = history.slice(0, R7_MIN_EXPERT_STATE_SAMPLES - 1);
    expect(expertStateStats("E1_R6", "GREEN", short, "B1_A1").qualified).toBe(false);
  });

  it("disqualifies a non-directional candidate", () => {
    expect(expertStateStats("E1_R6", "NONE", history, "B1_A1").qualified).toBe(false);
  });
});

describe("selection", () => {
  const base: Record<ExpertKey, ExpertStateStats> = {
    E1_R6: stats({}),
    E2_FROZEN_CORE: stats({}),
    E3_R4: stats({}),
    E4_STATE_MAP: stats({}),
  };

  it("abstains when nothing qualifies", () => {
    const s = selectR7(base, true);
    expect(s.prediction).toBe("ABSTAIN");
    expect(s.selectedExpert).toBeNull();
  });

  it("abstains when the state is unavailable", () => {
    expect(selectR7(base, false).reason).toBe("R7_STATE_UNAVAILABLE");
  });

  it("picks the highest raw edge rate", () => {
    const s = selectR7(
      {
        ...base,
        E1_R6: stats({ candidate: "GREEN", samples: 10, wins: 7, losses: 3, rawNet: 4, winRate: 0.7, rawEdgeRate: 0.4, qualified: true }),
        E2_FROZEN_CORE: stats({ candidate: "RED", samples: 10, wins: 8, losses: 2, rawNet: 6, winRate: 0.8, rawEdgeRate: 0.6, qualified: true }),
      },
      true,
    );
    expect(s.prediction).toBe("RED");
    expect(s.selectedExpert).toBe("E2_FROZEN_CORE");
  });

  it("abstains on an exact cross-direction edge tie", () => {
    const s = selectR7(
      {
        ...base,
        E1_R6: stats({ candidate: "GREEN", samples: 10, wins: 8, losses: 2, rawNet: 6, winRate: 0.8, rawEdgeRate: 0.6, qualified: true }),
        E2_FROZEN_CORE: stats({ candidate: "RED", samples: 10, wins: 8, losses: 2, rawNet: 6, winRate: 0.8, rawEdgeRate: 0.6, qualified: true }),
      },
      true,
    );
    expect(s.prediction).toBe("ABSTAIN");
    expect(s.reason).toBe("R7_EXPERT_EDGE_TIE");
  });

  it("breaks a same-direction tie by sample count then priority", () => {
    const s = selectR7(
      {
        ...base,
        E1_R6: stats({ candidate: "GREEN", samples: 10, wins: 8, losses: 2, rawNet: 6, winRate: 0.8, rawEdgeRate: 0.6, qualified: true }),
        E4_STATE_MAP: stats({ candidate: "GREEN", samples: 20, wins: 16, losses: 4, rawNet: 12, winRate: 0.8, rawEdgeRate: 0.6, qualified: true }),
      },
      true,
    );
    expect(s.selectedExpert).toBe("E4_STATE_MAP");
  });
});

describe("action classification and raw contribution", () => {
  it("labels each interaction with r6", () => {
    expect(classifyAction("GREEN", "GREEN")).toBe("KEEP_R6");
    expect(classifyAction("GREEN", "RED")).toBe("REROUTE_DIRECTION");
    expect(classifyAction("GREEN", "ABSTAIN")).toBe("REJECT_R6");
    expect(classifyAction("ABSTAIN", "RED")).toBe("ADD_OPPORTUNITY");
    expect(classifyAction("ABSTAIN", "ABSTAIN")).toBe("NONE");
  });

  it("scores contribution versus r6 in raw units", () => {
    expect(rawContributionVsR6("KEEP_R6", "GREEN", "GREEN", "GREEN")).toBe(0);
    expect(rawContributionVsR6("REJECT_R6", "GREEN", "ABSTAIN", "RED")).toBe(1);
    expect(rawContributionVsR6("REJECT_R6", "GREEN", "ABSTAIN", "GREEN")).toBe(-1);
    expect(rawContributionVsR6("ADD_OPPORTUNITY", "ABSTAIN", "RED", "RED")).toBe(1);
    expect(rawContributionVsR6("REROUTE_DIRECTION", "GREEN", "RED", "RED")).toBe(2);
    expect(rawContributionVsR6("REROUTE_DIRECTION", "GREEN", "RED", "GREEN")).toBe(-2);
    expect(rawContributionVsR6("REROUTE_DIRECTION", "GREEN", "RED", "PUSH")).toBe(0);
  });
});

describe("evaluateR7", () => {
  it("abstains with an unusable state and reports NONE candidates", () => {
    const out = evaluateR7({
      broadPercentile: null,
      anchorPercentile: 0.6,
      r6Prediction: "GREEN",
      frozenCorePrediction: "GREEN",
      r4ShadowPrediction: "GREEN",
      history: [],
    });
    expect(out.stateEvaluable).toBe(false);
    expect(out.selection.prediction).toBe("ABSTAIN");
    expect(out.candidates.E1_R6).toBe("NONE");
    expect(out.action).toBe("REJECT_R6");
  });

  it("selects a qualified expert from same-state history", () => {
    const history = [
      ...Array.from({ length: 8 }, (_, i) => row(i, "B1_A1", "GREEN", { E2_FROZEN_CORE: "GREEN" })),
    ];
    const out = evaluateR7({
      broadPercentile: 0.3,
      anchorPercentile: 0.3,
      r6Prediction: "ABSTAIN",
      frozenCorePrediction: "GREEN",
      r4ShadowPrediction: "ABSTAIN",
      history,
    });
    expect(out.stateId).toBe("B1_A1");
    expect(out.selection.prediction).toBe("GREEN");
    expect(out.selection.selectedExpert).toBe("E2_FROZEN_CORE");
    expect(out.action).toBe("ADD_OPPORTUNITY");
  });
});
