import { describe, expect, it } from "vitest";
import {
  betaPCorrect,
  brakeAttribution,
  buildGrid,
  cellKey,
  empiricalRank,
  evaluateB4x4,
  gridQualityPercentile,
  quartileOf,
  replayB4x4,
  type HistoryEntry,
  type SourceRow,
} from "../engine";
import { b4x4LocalDate } from "../config";

function entry(
  ts: string,
  confidence: number,
  direction: "GREEN" | "RED",
  actual: "GREEN" | "RED" | null,
  ranks: [number, number] = [0.5, 0.5],
): HistoryEntry {
  return {
    candleTs: ts,
    confidence,
    direction,
    globalRank: ranks[0],
    sameSideRank: ranks[1],
    globalQuartile: quartileOf(ranks[0]),
    sameSideQuartile: quartileOf(ranks[1]),
    qualityMean: (ranks[0] + ranks[1]) / 2,
    actualDirection: actual,
    correct: actual == null ? null : direction === actual,
  };
}

/** Deterministic pseudo-random source rows for warmup-heavy scenarios. */
function synthRows(n: number, startMs = Date.UTC(2026, 0, 1)): SourceRow[] {
  let seed = 42;
  const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648);
  const rows: SourceRow[] = [];
  for (let i = 0; i < n; i++) {
    const p = 0.2 + rand() * 0.6;
    const actual = rand() > 0.5 ? "GREEN" : "RED";
    rows.push({
      candleTs: new Date(startMs + i * 15 * 60 * 1000).toISOString(),
      probabilityGreen: p,
      timingStatus: "ON_TIME",
      leakageCheckPassed: true,
      actualDirection: actual as "GREEN" | "RED",
    });
  }
  return rows;
}

describe("B4x4 ranks", () => {
  it("uses right-inclusive empirical ranking including ties", () => {
    expect(empiricalRank([0.1, 0.2, 0.3, 0.4], 0.3)).toBeCloseTo(0.75);
    expect(empiricalRank([0.2, 0.2, 0.2, 0.2], 0.2)).toBe(1);
    expect(empiricalRank([0.5, 0.6], 0.1)).toBe(0);
    expect(empiricalRank([], 0.5)).toBeNull();
  });

  it("filters same-side history by raw direction", () => {
    const history = [
      entry("t1", 0.10, "GREEN", "GREEN"),
      entry("t2", 0.40, "RED", "RED"),
      entry("t3", 0.05, "GREEN", "RED"),
    ];
    const green = history.filter((h) => h.direction === "GREEN").map((h) => h.confidence);
    expect(empiricalRank(green, 0.10)).toBeCloseTo(1);
    const red = history.filter((h) => h.direction === "RED").map((h) => h.confidence);
    expect(empiricalRank(red, 0.10)).toBe(0);
  });
});

describe("B4x4 quartiles", () => {
  it("maps boundaries at 0.25 / 0.50 / 0.75 / 1.00", () => {
    expect(quartileOf(0)).toBe(0);
    expect(quartileOf(0.2499)).toBe(0);
    expect(quartileOf(0.25)).toBe(1);
    expect(quartileOf(0.4999)).toBe(1);
    expect(quartileOf(0.5)).toBe(2);
    expect(quartileOf(0.7499)).toBe(2);
    expect(quartileOf(0.75)).toBe(3);
    expect(quartileOf(1)).toBe(3);
  });
});

describe("B4x4 beta smoothing", () => {
  it("returns 0.500 for an empty cell", () => {
    expect(betaPCorrect(0, 0)).toBe(0.5);
  });
  it("returns 16/26 for 8 wins in 10", () => {
    expect(betaPCorrect(8, 10)).toBeCloseTo(16 / 26, 12);
  });
  it("builds all 16 cells even when unobserved", () => {
    const grid = buildGrid([entry("t1", 0.2, "GREEN", "GREEN", [0.9, 0.9])]);
    expect(grid.size).toBe(16);
    expect(grid.get(cellKey(3, 3))!.pCorrect).toBeCloseTo(9 / 17, 12);
    expect(grid.get(cellKey(0, 0))!.pCorrect).toBe(0.5);
  });
});

describe("B4x4 grid quality percentile", () => {
  it("counts strictly lower scores and equal-cell rows by quality mean", () => {
    const reference = [
      entry("a", 0.1, "GREEN", "GREEN", [0.9, 0.9]), // same cell, lower quality mean
      entry("b", 0.1, "GREEN", "GREEN", [0.95, 0.95]), // same cell, higher quality mean
      entry("c", 0.1, "GREEN", "GREEN", [0.1, 0.1]), // different (empty) cell
    ];
    const cells = buildGrid([
      entry("x", 0.1, "GREEN", "GREEN", [0.9, 0.9]),
      entry("y", 0.1, "GREEN", "GREEN", [0.9, 0.9]),
    ]);
    const pCorrect = cells.get(cellKey(3, 3))!.pCorrect; // 10/18 > 0.5
    const pct = gridQualityPercentile(reference, cells, pCorrect, 0.92);
    // c scores 0.5 (below), a ties with quality_mean 0.9 <= 0.92 (below), b does not.
    expect(pct).toBeCloseTo(2 / 3, 12);
  });
});

describe("B4x4 decision routes", () => {
  const history = synthRows(900).map((r, i) =>
    entry(
      r.candleTs,
      Math.abs((r.probabilityGreen as number) - 0.5),
      (r.probabilityGreen as number) >= 0.5 ? "GREEN" : "RED",
      r.actualDirection as "GREEN" | "RED",
      [(i % 100) / 100, ((i * 7) % 100) / 100],
    ),
  );

  it("abstains before 768 valid source rows", () => {
    const d = evaluateB4x4(
      { candleTs: "2026-02-01T00:00:00.000Z", probabilityGreen: 0.8, timingStatus: "ON_TIME", leakageCheckPassed: true, actualDirection: null },
      history.slice(0, 100),
      { localDate: "2026-02-01", dailyNetBefore: 0, dailyResolvedTradeCountBefore: 0 },
    );
    expect(d.decisionReason).toBe("ABSTAIN_WARMUP_SOURCE_HISTORY");
    expect(d.wouldTrade).toBe(false);
  });

  it("flags operational abstentions for invalid source data", () => {
    const bad: SourceRow = { candleTs: "t", probabilityGreen: 1.4, timingStatus: "ON_TIME", leakageCheckPassed: true, actualDirection: null };
    expect(evaluateB4x4(bad, history, { localDate: "d", dailyNetBefore: 0, dailyResolvedTradeCountBefore: 0 }).decisionReason)
      .toBe("ABSTAIN_A2_PROBABILITY_INVALID");
    expect(evaluateB4x4({ ...bad, probabilityGreen: 0.7, timingStatus: "LATE_WARNING" }, history, { localDate: "d", dailyNetBefore: 0, dailyResolvedTradeCountBefore: 0 }).decisionReason)
      .toBe("ABSTAIN_A2_TIMING_INVALID");
    expect(evaluateB4x4({ ...bad, probabilityGreen: 0.7, leakageCheckPassed: false }, history, { localDate: "d", dailyNetBefore: 0, dailyResolvedTradeCountBefore: 0 }).decisionReason)
      .toBe("ABSTAIN_A2_LEAKAGE_INVALID");
  });

  it("never reverses the A2 direction", () => {
    const rows = synthRows(1200);
    for (const r of replayB4x4(rows)) {
      if (r.decision.wouldTrade) {
        expect(r.decision.finalPrediction).toBe(r.decision.rawDirection);
        expect(r.decision.finalPrediction).toBe(
          (r.row.probabilityGreen as number) >= 0.5 ? "GREEN" : "RED",
        );
      } else {
        expect(r.decision.finalPrediction).toBeNull();
      }
    }
  });
});

describe("B4x4 intraday brake", () => {
  const rows = synthRows(1400);
  const replay = replayB4x4(rows);
  const evaluable = replay.find((r) => r.decision.gridQualityPercentile != null)!;

  it("activates at exactly daily net -2 and stays inactive at -1", () => {
    const idx = replay.indexOf(evaluable);
    const history = replay.slice(0, idx).map((r) => r.decision.historyEntry!).filter(Boolean);
    const at1 = evaluateB4x4(evaluable.row, history, { localDate: "d", dailyNetBefore: -1, dailyResolvedTradeCountBefore: 3 });
    const at2 = evaluateB4x4(evaluable.row, history, { localDate: "d", dailyNetBefore: -2, dailyResolvedTradeCountBefore: 3 });
    expect(at1.intradayBrakeActive).toBe(false);
    expect(at2.intradayBrakeActive).toBe(true);
  });

  it("requires percentile >= 0.80 and p_correct > 0.50 under protection", () => {
    const idx = replay.indexOf(evaluable);
    const history = replay.slice(0, idx).map((r) => r.decision.historyEntry!).filter(Boolean);
    const braked = evaluateB4x4(evaluable.row, history, { localDate: "d", dailyNetBefore: -5, dailyResolvedTradeCountBefore: 6 });
    if (braked.wouldTrade) {
      expect(braked.gridQualityPercentile!).toBeGreaterThanOrEqual(0.8);
      expect(braked.pCorrect!).toBeGreaterThan(0.5);
    } else if (braked.baseCandidate) {
      expect(braked.decisionReason).toBe("ABSTAIN_INTRADAY_BRAKE");
      expect(braked.intradayBrakeVetoFired).toBe(true);
    }
  });

  it("recovers when the resolved day net climbs back above -2", () => {
    const idx = replay.indexOf(evaluable);
    const history = replay.slice(0, idx).map((r) => r.decision.historyEntry!).filter(Boolean);
    const recovered = evaluateB4x4(evaluable.row, history, { localDate: "d", dailyNetBefore: 0, dailyResolvedTradeCountBefore: 8 });
    expect(recovered.intradayBrakeActive).toBe(false);
  });
});

describe("B4x4 brake attribution", () => {
  it("classifies avoided losses and sacrificed wins", () => {
    expect(brakeAttribution(false, true, "GREEN", "RED")).toEqual({ klass: "AVOIDED_LOSS", value: 1 });
    expect(brakeAttribution(false, true, "GREEN", "GREEN")).toEqual({ klass: "SACRIFICED_WIN", value: -1 });
    expect(brakeAttribution(true, false, "GREEN", "GREEN")).toEqual({ klass: "NO_INCREMENTAL_CHANGE", value: 0 });
    expect(brakeAttribution(false, false, null, "GREEN")).toEqual({ klass: "NO_INCREMENTAL_CHANGE", value: 0 });
  });
});

describe("B4x4 local day handling", () => {
  it("uses the America/Boise calendar date across the UTC day boundary", () => {
    expect(b4x4LocalDate("2026-08-05T05:00:00.000Z")).toBe("2026-08-04"); // MDT (UTC-6)
    expect(b4x4LocalDate("2026-08-05T06:00:00.000Z")).toBe("2026-08-05");
    expect(b4x4LocalDate("2026-01-05T06:00:00.000Z")).toBe("2026-01-04"); // MST (UTC-7)
    expect(b4x4LocalDate("2026-01-05T07:00:00.000Z")).toBe("2026-01-05");
  });

  it("ignores unresolved predictions in the day net", () => {
    const rows = synthRows(1000).map((r, i) =>
      i > 900 ? { ...r, actualDirection: null } : r,
    );
    const replay = replayB4x4(rows);
    for (const r of replay.slice(901)) {
      expect(r.resultScore).toBe(0);
    }
  });
});
