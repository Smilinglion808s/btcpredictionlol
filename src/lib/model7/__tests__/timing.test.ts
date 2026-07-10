// Model 7 Shadow — timing + leakage tests (strict boundary enforcement).

import { describe, expect, it } from "vitest";
import {
  computeTimingPlan,
  inspectHistoryLeakage,
  waitUntilScoreable,
  checkCandleIntegrity,
  runShadowForPrediction,
  SCORE_NOT_BEFORE_DELAY_MS,
} from "../shadow";
import type { Candle } from "../featurize";

const TARGET_ISO = "2026-07-10T19:30:00.000Z";
const TARGET_MS = Date.parse(TARGET_ISO);
const TF = 15 * 60 * 1000;

function mkCandle(ms: number, close = 100, open = 100): Candle {
  return { candle_ts: new Date(ms).toISOString(), open, high: 101, low: 99, close, volume: 1 };
}

// --- Fake clock/sleep for deterministic waiting tests ------------------------
function fakeClock(startMs: number) {
  let t = startMs;
  return {
    now: () => t,
    sleep: async (ms: number) => { t += ms; },
    advance: (ms: number) => { t += ms; },
    get t() { return t; },
  };
}

describe("Model 7 shadow — timing plan", () => {
  it("computes score_not_before, feature_cutoff, previous_candle from candle_ts", () => {
    const p = computeTimingPlan(TARGET_ISO);
    expect(p.target_boundary_ms).toBe(TARGET_MS);
    expect(p.score_not_before_ms).toBe(TARGET_MS + SCORE_NOT_BEFORE_DELAY_MS);
    expect(p.feature_cutoff_ms).toBe(TARGET_MS - 1);
    expect(p.previous_candle_ms).toBe(TARGET_MS - TF);
  });
});

describe("Model 7 shadow — bounded-wait timing", () => {
  it("worker 40s before boundary: keeps waiting past 25s cap, never returns early", async () => {
    const plan = computeTimingPlan(TARGET_ISO);
    const clk = fakeClock(TARGET_MS - 40_000);
    const res = await waitUntilScoreable(plan, { now: clk.now, sleep: clk.sleep });
    expect(res.reached).toBe(true);
    expect(clk.t).toBeGreaterThanOrEqual(plan.score_not_before_ms);
  });

  it("worker 5s before boundary: waits through boundary, resumes at or after +1.5s", async () => {
    const plan = computeTimingPlan(TARGET_ISO);
    const clk = fakeClock(TARGET_MS - 5_000);
    const res = await waitUntilScoreable(plan, { now: clk.now, sleep: clk.sleep });
    expect(res.reached).toBe(true);
    expect(clk.t - plan.target_boundary_ms).toBeGreaterThanOrEqual(SCORE_NOT_BEFORE_DELAY_MS);
  });

  it("worker 2s after boundary: does not sleep, reached immediately", async () => {
    const plan = computeTimingPlan(TARGET_ISO);
    const clk = fakeClock(TARGET_MS + 2_000);
    // score_not_before is boundary+1.5s → we're already past it.
    const res = await waitUntilScoreable(plan, { now: clk.now, sleep: clk.sleep });
    expect(res.reached).toBe(true);
    expect(res.waited_ms).toBe(0);
  });

  it("simulated early wake: aborts when maxTotalMs elapses before boundary", async () => {
    const plan = computeTimingPlan(TARGET_ISO);
    const clk = fakeClock(TARGET_MS - 10 * 60 * 1000); // 10 min before
    const res = await waitUntilScoreable(plan, {
      now: clk.now, sleep: clk.sleep, maxTotalMs: 60_000,
    });
    // We hit the total-wait ceiling before reaching the boundary.
    expect(res.reached).toBe(false);
    // Post-wait clock is BEFORE score_not_before → orchestrator will block.
    expect(clk.t).toBeLessThan(plan.score_not_before_ms);
  });
});

describe("Model 7 shadow — leakage inspection", () => {
  const plan = computeTimingPlan(TARGET_ISO);
  const prev = mkCandle(TARGET_MS - TF);
  const prev2 = mkCandle(TARGET_MS - 2 * TF);
  const prev3 = mkCandle(TARGET_MS - 3 * TF);

  it("passes when history is strictly before boundary and previous candle present", () => {
    const rep = inspectHistoryLeakage(plan, [prev, prev2, prev3]);
    expect(rep.passed).toBe(true);
    expect(rep.previous_candle_present).toBe(true);
    expect(rep.history_gap_encountered).toBe(false);
    expect(rep.latest_source_candle_ms).toBe(TARGET_MS - TF);
  });

  it("blocks when a candle at target_boundary_ts appears in history", () => {
    const targetCandle = mkCandle(TARGET_MS);
    const rep = inspectHistoryLeakage(plan, [targetCandle, prev, prev2]);
    expect(rep.passed).toBe(false);
    expect(rep.reason).toBe("TARGET_CANDLE_LEAKAGE_BLOCKED");
    expect(rep.offending_features.length).toBeGreaterThan(0);
  });

  it("blocks when a candle after target_boundary_ts appears in history", () => {
    const future = mkCandle(TARGET_MS + TF);
    const rep = inspectHistoryLeakage(plan, [future, prev, prev2]);
    expect(rep.passed).toBe(false);
    expect(rep.reason).toBe("TARGET_CANDLE_LEAKAGE_BLOCKED");
  });

  it("blocks when previous candle is missing (target candle not substituted)", () => {
    const rep = inspectHistoryLeakage(plan, [prev2, prev3]);
    expect(rep.passed).toBe(false);
    expect(rep.reason).toBe("PREVIOUS_CANDLE_NOT_FINALIZED");
  });

  it("detects history gap between adjacent rows", () => {
    // Skip prev2 → gap between prev (T-15m) and prev3 (T-45m).
    const rep = inspectHistoryLeakage(plan, [prev, prev3]);
    expect(rep.history_gap_encountered).toBe(true);
  });
});

describe("Model 7 shadow — golden integration fixture (19:30:00 target)", () => {
  it("previous 19:15 candle admitted, target 19:30 candle rejected", () => {
    const plan = computeTimingPlan("2026-07-10T19:30:00.000Z");
    const c1915 = mkCandle(Date.parse("2026-07-10T19:15:00.000Z"));
    const c1900 = mkCandle(Date.parse("2026-07-10T19:00:00.000Z"));
    const c1845 = mkCandle(Date.parse("2026-07-10T18:45:00.000Z"));
    // Passing case.
    const ok = inspectHistoryLeakage(plan, [c1915, c1900, c1845]);
    expect(ok.passed).toBe(true);
    expect(ok.latest_source_candle_ms).toBe(Date.parse("2026-07-10T19:15:00.000Z"));
    expect(ok.latest_source_candle_ms).toBeLessThan(plan.target_boundary_ms);

    // Failing paired fixture: adds a 19:30 candle.
    const c1930 = mkCandle(Date.parse("2026-07-10T19:30:00.000Z"));
    const bad = inspectHistoryLeakage(plan, [c1930, c1915, c1900]);
    expect(bad.passed).toBe(false);
    expect(bad.reason).toBe("TARGET_CANDLE_LEAKAGE_BLOCKED");
  });
});

describe("Model 7 shadow — previous-candle OHLC integrity", () => {
  const plan = computeTimingPlan(TARGET_ISO);
  const goodPrev: Candle = {
    candle_ts: new Date(TARGET_MS - TF).toISOString(),
    open: 100, high: 105, low: 99, close: 103, volume: 1,
  };
  const prev2 = mkCandle(TARGET_MS - 2 * TF);

  it("accepts a well-formed previous candle", () => {
    expect(checkCandleIntegrity(goodPrev).ok).toBe(true);
    const rep = inspectHistoryLeakage(plan, [goodPrev, prev2]);
    expect(rep.passed).toBe(true);
  });

  it("blocks when high < max(open, close)", () => {
    const bad: Candle = { ...goodPrev, high: 102, close: 103 }; // high(102) < close(103)
    const r = checkCandleIntegrity(bad);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("high_lt_max_open_close");
    const rep = inspectHistoryLeakage(plan, [bad, prev2]);
    expect(rep.passed).toBe(false);
    expect(rep.reason).toBe("PREVIOUS_CANDLE_NOT_FINALIZED");
  });

  it("blocks when low > min(open, close)", () => {
    const bad: Candle = { ...goodPrev, low: 101, open: 100 }; // low(101) > open(100)
    expect(checkCandleIntegrity(bad).reason).toBe("low_gt_min_open_close");
    const rep = inspectHistoryLeakage(plan, [bad, prev2]);
    expect(rep.passed).toBe(false);
    expect(rep.reason).toBe("PREVIOUS_CANDLE_NOT_FINALIZED");
  });

  it("blocks when any OHLC is zero or non-finite", () => {
    expect(checkCandleIntegrity({ ...goodPrev, close: 0 }).ok).toBe(false);
    expect(checkCandleIntegrity({ ...goodPrev, open: NaN }).ok).toBe(false);
  });
});

describe("Model 7 shadow — PREDICTION_ROW_POST_BOUNDARY guard", () => {
  // Minimal fake supabase client that records inserts.
  function mkStub(historyCandles: Candle[]) {
    const inserts: Array<Record<string, unknown>> = [];
    const stub = {
      from: (table: string) => {
        if (table === "candles") {
          return {
            select: () => ({ eq: () => ({ eq: () => ({
              lt: () => ({ order: () => ({ limit: () => Promise.resolve({ data: historyCandles, error: null }) }) }),
            }) }) }),
          };
        }
        if (table === "model7_training_fits") {
          return {
            select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
            update: () => ({ eq: () => Promise.resolve({ error: null }) }),
          };
        }
        return {
          insert: (row: Record<string, unknown>) => {
            if (table === "model7_shadow") inserts.push(row);
            return Promise.resolve({ error: null });
          },
        };
      },
    } as never;
    return { stub, inserts };
  }

  const goodHistory: Candle[] = [
    { candle_ts: new Date(TARGET_MS - TF).toISOString(), open: 100, high: 105, low: 99, close: 103, volume: 1 },
    mkCandle(TARGET_MS - 2 * TF),
    mkCandle(TARGET_MS - 3 * TF),
  ];

  it("blocks when predictionRow.created_at == target_boundary_ts", async () => {
    const { stub, inserts } = mkStub(goodHistory);
    const predictionRow = {
      id: "pred-post-boundary",
      candle_ts: TARGET_ISO,
      created_at: TARGET_ISO, // equals target boundary → post-boundary
      prediction: "GREEN", confidence: 70, model_version: "6.0", indicators: {},
    };
    // Score at a time already past score_not_before so the guard is reached.
    const realNow = Date.now;
    Date.now = () => TARGET_MS + 2_000;
    try {
      await runShadowForPrediction(stub, predictionRow as never);
    } finally {
      Date.now = realNow;
    }
    // Every emitted variant row must be blocked with timing_status set.
    expect(inserts.length).toBeGreaterThan(0);
    for (const row of inserts) {
      expect(row.timing_status).toBe("PREDICTION_ROW_POST_BOUNDARY");
      expect(row.leakage_check_passed).toBe(false);
      expect(row.decision).toBeUndefined();
      expect(row.probability_green).toBeUndefined();
      expect(row.prediction_row_created_at).toBe(TARGET_ISO);
      expect(row.prediction_row_lead_ms).toBe(0);
    }
  });

  it("passes the guard when predictionRow.created_at is strictly before boundary", async () => {
    const { stub, inserts } = mkStub(goodHistory);
    const predictionRow = {
      id: "pred-pre-boundary",
      candle_ts: TARGET_ISO,
      created_at: new Date(TARGET_MS - 20_000).toISOString(),
      prediction: "GREEN", confidence: 70, model_version: "6.0", indicators: {},
    };
    const realNow = Date.now;
    Date.now = () => TARGET_MS + 2_000;
    try {
      await runShadowForPrediction(stub, predictionRow as never);
    } finally {
      Date.now = realNow;
    }
    // No row should be blocked with PREDICTION_ROW_POST_BOUNDARY.
    for (const row of inserts) {
      expect(row.timing_status).not.toBe("PREDICTION_ROW_POST_BOUNDARY");
      expect(row.prediction_row_lead_ms).toBe(20_000);
    }
  });
});
