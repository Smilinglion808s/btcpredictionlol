// B4x4 window-integrity regression.
//
// Proves that the PRODUCTION loadHistory path (which re-reads the canonical
// A2_Combined stream from the frozen source epoch) yields the absolute
// 768-row grid window, and that a bounded local slice — the defect this
// repair fixed — collapses the window instead.

import { describe, expect, it } from "vitest";
import { loadHistory } from "../orchestrator";
import { evaluateB4x4, replayB4x4, type SourceRow } from "../engine";
import {
  B4X4_SOURCE_EPOCH_TS,
  GRID_REFERENCE_LOOKBACK,
  GRID_TRAINING_LOOKBACK,
} from "../config";

const TOTAL = 1500; // > 1152 = 768 training + 384 reference
const EPOCH = Date.parse(B4X4_SOURCE_EPOCH_TS);

interface Synth {
  id: string;
  prediction_id: string;
  candle_ts: string;
  probability_green: number;
  timing_status: string;
  leakage_check_passed: boolean;
  model_fit_id: string;
  created_at: string;
  predictions: { actual_direction: string; model_version: string };
}

function synthRows(n: number): Synth[] {
  const out: Synth[] = [];
  for (let i = 0; i < n; i++) {
    const ts = new Date(EPOCH + i * 900_000).toISOString();
    // Deterministic pseudo-random probability and outcome.
    const p = 0.3 + ((i * 37) % 41) / 100;
    const actual = (i * 7 + Math.floor(p * 100)) % 2 === 0 ? "GREEN" : "RED";
    out.push({
      id: `src-${i}`,
      prediction_id: `pred-${i}`,
      candle_ts: ts,
      probability_green: Number(p.toFixed(4)),
      timing_status: "ON_TIME",
      leakage_check_passed: true,
      model_fit_id: "fit-1",
      created_at: ts,
      predictions: { actual_direction: actual, model_version: "a2" },
    });
  }
  return out;
}

/** Minimal Supabase query stub honouring gte/lte/range on candle_ts. */
function fakeSupabase(rows: Synth[]) {
  return {
    from() {
      let data = rows;
      let range: [number, number] = [0, 999];
      const api: Record<string, unknown> = {
        select() { return api; },
        eq() { return api; },
        order() { return api; },
        gte(_col: string, v: string) {
          data = data.filter((r) => r.candle_ts >= new Date(v).toISOString());
          return api;
        },
        lte(_col: string, v: string) {
          data = data.filter((r) => r.candle_ts <= new Date(v).toISOString());
          return api;
        },
        range(a: number, b: number) {
          range = [a, b];
          return api;
        },
        then(resolve: (v: { data: Synth[]; error: null }) => void) {
          resolve({ data: data.slice(range[0], range[1] + 1), error: null });
        },
      };
      return api;
    },
  } as never;
}

const ALL = synthRows(TOTAL + 1);
const TARGET = ALL[TOTAL]!;
const targetSource: SourceRow = {
  candleTs: TARGET.candle_ts,
  probabilityGreen: TARGET.probability_green,
  timingStatus: "ON_TIME",
  leakageCheckPassed: true,
  actualDirection: null,
};
const daily = { localDate: "2026-08-11", dailyNetBefore: 0, dailyResolvedTradeCountBefore: 0 };

describe("B4x4 absolute window integrity (production loadHistory path)", () => {
  it("mature grid uses 768 training source rows starting at i-768", async () => {
    const history = await loadHistory(fakeSupabase(ALL), TARGET.candle_ts);
    expect(history.length).toBe(TOTAL);

    const d = evaluateB4x4(targetSource, history, daily);
    expect(d.sourceIndexAbsolute).toBe(TOTAL);
    expect(d.gridTrainingSourceCount).toBe(GRID_TRAINING_LOOKBACK);
    expect(d.gridTrainingStartIndex).toBe(TOTAL - GRID_TRAINING_LOOKBACK);
    expect(d.gridTrainingEndIndex).toBe(TOTAL - 1);
    expect(d.gridReferenceSourceCount).toBe(GRID_REFERENCE_LOOKBACK);
    expect(d.gridWindowIntegrityPassed).toBe(true);
  });

  it("more than 1152 rows are required and are actually loaded", async () => {
    const history = await loadHistory(fakeSupabase(ALL), TARGET.candle_ts);
    expect(history.length).toBeGreaterThan(
      GRID_TRAINING_LOOKBACK + GRID_REFERENCE_LOOKBACK,
    );
  });

  it("a bounded local slice collapses the window (the repaired defect)", async () => {
    // Simulate the pre-repair loader that only saw a bounded recent slice.
    const bounded = ALL.slice(-449, -1); // 448 source rows, as observed in prod
    const history = await loadHistory(fakeSupabase(bounded), TARGET.candle_ts);
    expect(history.length).toBe(448);

    const d = evaluateB4x4(targetSource, history, daily);
    expect(d.sourceIndexAbsolute).toBe(448);
    expect(d.gridTrainingSourceCount).toBeLessThan(GRID_TRAINING_LOOKBACK);
    expect(d.gridTrainingSourceCount).not.toBe(GRID_TRAINING_LOOKBACK);
  });

  it("full replay never truncates any mature row's window", () => {
    const replay = replayB4x4(
      ALL.map((r) => ({
        candleTs: r.candle_ts,
        probabilityGreen: r.probability_green,
        timingStatus: "ON_TIME" as const,
        leakageCheckPassed: true,
        actualDirection: r.predictions.actual_direction as "GREEN" | "RED",
      })),
    );
    const mature = replay.filter((r) => r.decision.sourceIndexAbsolute >= 1152);
    expect(mature.length).toBeGreaterThan(300);
    for (const r of mature) {
      expect(r.decision.gridTrainingSourceCount).toBe(GRID_TRAINING_LOOKBACK);
      expect(r.decision.gridReferenceSourceCount).toBe(GRID_REFERENCE_LOOKBACK);
      expect(r.decision.gridTrainingStartIndex).toBe(
        r.decision.sourceIndexAbsolute - GRID_TRAINING_LOOKBACK,
      );
    }
  });
});
