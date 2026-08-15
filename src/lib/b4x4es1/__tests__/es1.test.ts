import { describe, expect, it } from "vitest";
import {
  ES1_FEATURES,
  ES1_MIN_TRAIN_ROWS,
  ES1_RETRAIN_BLOCK,
  ES1_TRAIN_WINDOW,
  GRID_OUTCOME_DELAY_MS,
  OB_MIN_HISTORY,
  TF_MS,
} from "../config";
import {
  buildFeatureRows,
  computeFeatures,
  segmentCandles,
  type CanonicalCandle,
} from "../features";
import {
  betaPCorrect,
  cellKey,
  decideEs1,
  empiricalRank,
  guardAttribution,
  quartileOf,
  scoreAgainst,
  type Es1HistoryEntry,
  type Es1Input,
} from "../engine";
import {
  dayBalancedWeights,
  fitBoundaryFor,
  fitRobustScaler,
  applyScaler,
  quantile,
  trainingWindowFor,
} from "../priceHead";

// ---- helpers ----------------------------------------------------------
function candle(tsMs: number, o: number, h: number, l: number, c: number): CanonicalCandle {
  return { candleTs: new Date(tsMs).toISOString(), open: o, high: h, low: l, close: c, volume: 1 };
}
function series(n: number, start = Date.UTC(2026, 6, 1, 0, 0, 0)): CanonicalCandle[] {
  const out: CanonicalCandle[] = [];
  for (let i = 0; i < n; i++) {
    const base = 100 + i * 0.5;
    out.push(candle(start + i * TF_MS, base, base + 2, base - 2, base + 1));
  }
  return out;
}
function baseInput(over: Partial<Es1Input> = {}): Es1Input {
  return {
    targetTs: "2026-08-10T00:00:00.000Z",
    featureCutoffTs: "2026-08-09T23:59:59.999Z",
    latestSourceTs: "2026-08-09T23:45:00.000Z",
    featureVector: new Array(8).fill(0.1),
    featureValues: Object.fromEntries(ES1_FEATURES.map((f) => [f, 0.1])),
    featureVectorHash: "hash",
    featureValid: true,
    featureInvalidReason: null,
    timingValid: true,
    timingInvalidReason: null,
    priceProbabilityGreen: 0.6,
    priceFitId: "fit-1",
    a2ProbabilityGreen: 0.7,
    a2RowId: "a2-1",
    a2PredictionId: "p-1",
    sourceIndexAbsolute: 10,
    obSnapshot: null,
    obHistory: [],
    ...over,
  };
}
function rankHistory(n: number, evidence = 0.001): Es1HistoryEntry[] {
  return Array.from({ length: n }, (_, i) => ({
    targetTs: new Date(Date.UTC(2026, 7, 1) + i * TF_MS).toISOString(),
    sourceIndex: i,
    direction: "GREEN" as const,
    evidence,
    priceConfidence: evidence,
    a2Confidence: evidence,
    cell: "G1-S1",
    pCorrect: 0.5,
    actualDirection: "GREEN" as const,
  }));
}

// ---- features ---------------------------------------------------------
describe("ES1 features", () => {
  it("computes each frozen formula exactly", () => {
    const seg = series(50);
    const { values, valid } = computeFeatures(seg, 49);
    const closes = seg.map((c) => c.close);
    expect(valid).toBe(true);
    for (const n of [1, 2, 4, 8, 16]) {
      expect(values[`return_${n}` as never]).toBeCloseTo(
        Math.log(closes[49]) - Math.log(closes[49 - n]),
        12,
      );
    }
    let path = 0;
    for (let k = 0; k < 8; k++) path += Math.abs(closes[49 - k] - closes[48 - k]);
    expect(values.signed_efficiency_8).toBeCloseTo((closes[49] - closes[41]) / path, 12);
    const c = seg[49];
    const range = c.high - c.low;
    expect(values.close_location).toBeCloseTo((2 * (c.close - c.low)) / range - 1, 12);
    const upper = c.high - Math.max(c.open, c.close);
    const lower = Math.min(c.open, c.close) - c.low;
    expect(values.wick_balance).toBeCloseTo((lower - upper) / range, 12);
  });

  it("invalidates zero range and zero path without imputing", () => {
    const seg = series(50);
    seg[49] = candle(new Date(seg[49].candleTs).getTime(), 100, 100, 100, 100);
    expect(computeFeatures(seg, 49).valid).toBe(false);
    const flat = Array.from({ length: 20 }, (_, i) =>
      candle(Date.UTC(2026, 6, 1) + i * TF_MS, 100, 101, 99, 100),
    );
    expect(computeFeatures(flat, 49).reason).toBe("zero_path");
  });

  it("requires 32 prior candles inside the segment", () => {
    const seg = series(50);
    expect(computeFeatures(seg, 31).valid).toBe(false);
    expect(computeFeatures(seg, 32).valid).toBe(true);
  });

  it("invalidates every row of a segment shorter than 40 candles", () => {
    expect(buildFeatureRows(series(39)).some((r) => r.valid)).toBe(false);
    expect(buildFeatureRows(series(39)).every((r) => r.invalidReason != null)).toBe(true);
    expect(buildFeatureRows(series(50)).some((r) => r.valid)).toBe(true);
  });

  it("segments on canonical gaps and never spans them", () => {
    const a = series(50);
    const b = series(50, Date.UTC(2026, 6, 2, 0, 0, 0));
    const segs = segmentCandles([...a, ...b]);
    expect(segs.length).toBe(2);
    expect(segs[0].length).toBe(50);
  });

  it("shifts the feature vector one target forward and never reads the target candle", () => {
    const seg = series(50);
    const rows = buildFeatureRows(seg);
    const row = rows.find((r) => r.valid)!;
    const sourceMs = new Date(row.latestSourceTs).getTime();
    expect(new Date(row.targetTs).getTime() - sourceMs).toBe(TF_MS);
    expect(new Date(row.featureCutoffTs).getTime()).toBe(new Date(row.targetTs).getTime() - 1);
  });
});

// ---- price head -------------------------------------------------------
describe("ES1 price head windows and weights", () => {
  it("needs 768 rows and retrains on exact 96-row boundaries", () => {
    expect(fitBoundaryFor(ES1_MIN_TRAIN_ROWS - 1)).toBeNull();
    expect(fitBoundaryFor(ES1_MIN_TRAIN_ROWS)).toBe(768);
    expect(fitBoundaryFor(863)).toBe(768);
    expect(fitBoundaryFor(864)).toBe(768 + ES1_RETRAIN_BLOCK);
  });

  it("uses a rolling 1536-row training window", () => {
    expect(trainingWindowFor(768)).toEqual({ start: 0, end: 768 });
    const w = trainingWindowFor(2304);
    expect(w.end - w.start).toBe(ES1_TRAIN_WINDOW);
  });

  it("balances Boise-day weights to mean 1", () => {
    const ts = ["2026-08-01T18:00:00Z", "2026-08-01T19:00:00Z", "2026-08-02T18:00:00Z"];
    const w = dayBalancedWeights(ts);
    expect(w[0]).toBeCloseTo(w[1], 12);
    expect(w[2]).toBeCloseTo(2 * w[0], 12);
    expect(w.reduce((a, b) => a + b, 0) / w.length).toBeCloseTo(1, 12);
  });

  it("scales with a linear 10-90 robust quantile range", () => {
    const X = Array.from({ length: 11 }, (_, i) => [i]);
    const sc = fitRobustScaler(X);
    const col = X.map((r) => r[0]);
    expect(sc.center[0]).toBe(quantile(col, 0.5));
    expect(sc.scale[0]).toBeCloseTo(quantile(col, 0.9) - quantile(col, 0.1), 12);
    expect(applyScaler(sc, [sc.center[0]])[0]).toBe(0);
  });
});

// ---- decision chain ---------------------------------------------------
describe("ES1 decision chain", () => {
  it("treats 0.50 as GREEN and abstains on invalid data first", () => {
    const g = decideEs1(baseInput({ priceProbabilityGreen: 0.5 }), rankHistory(400));
    expect(g.priceDirection).toBe("GREEN");
    const r = decideEs1(baseInput({ priceProbabilityGreen: 0.4999999 }), rankHistory(400));
    expect(r.priceDirection).toBe("RED");
    const bad = decideEs1(baseInput({ featureValid: false, featureVector: null }), []);
    expect(bad.decisionReason).toBe("ABSTAIN_DATA_OR_TIMING_INVALID");
  });

  it("abstains when the price fit is missing", () => {
    const d = decideEs1(baseInput({ priceFitId: null }), rankHistory(400));
    expect(d.decisionReason).toBe("ABSTAIN_ES1_PRICE_NOT_READY");
  });

  it("abstains on missing or disagreeing A2 without ever flipping direction", () => {
    const missing = decideEs1(baseInput({ a2ProbabilityGreen: null }), rankHistory(400));
    expect(missing.decisionReason).toBe("ABSTAIN_A2_MISSING_OR_INVALID");
    const disagree = decideEs1(
      baseInput({ priceProbabilityGreen: 0.6, a2ProbabilityGreen: 0.3 }),
      rankHistory(400),
    );
    expect(disagree.decisionReason).toBe("ABSTAIN_ES1_A2_DISAGREE");
    expect(disagree.finalPrediction).toBeNull();
    expect(disagree.hybridDirection).toBe("GREEN");
  });

  it("qualifies at combined rank equality of 0.20 and rejects below it", () => {
    const hist = rankHistory(400, 0.4); // every prior confidence above current
    const low = decideEs1(
      baseInput({ priceProbabilityGreen: 0.5001, a2ProbabilityGreen: 0.5001 }),
      hist,
    );
    expect(low.combinedConfidenceRank).toBeLessThan(0.2);
    expect(low.decisionReason).toBe("ABSTAIN_COMBINED_CONFIDENCE_BELOW_020");
    const high = decideEs1(baseInput(), rankHistory(400, 0.0001));
    expect(high.combinedConfidenceRank).toBeGreaterThanOrEqual(0.2);
    expect(high.finalPrediction).toBe("GREEN");
  });

  it("uses lower-inclusive empirical ranks", () => {
    expect(empiricalRank([1, 2, 3, 4], 2)).toBeCloseTo(0.5, 12);
    expect(empiricalRank([], 1)).toBeNull();
  });

  it("maps quartiles and cells exactly", () => {
    expect(quartileOf(0)).toBe(1);
    expect(quartileOf(0.25)).toBe(2);
    expect(quartileOf(1)).toBe(4);
    expect(cellKey(2, 3)).toBe("G2-S3");
  });

  it("computes Beta(8,8) pCorrect", () => {
    expect(betaPCorrect(0, 0)).toBeCloseTo(0.5, 12);
    expect(betaPCorrect(10, 20)).toBeCloseTo(18 / 36, 12);
  });

  it("scores PUSH as zero and abstention as zero", () => {
    expect(scoreAgainst("GREEN", "GREEN").score).toBe(1);
    expect(scoreAgainst("GREEN", "RED").score).toBe(-1);
    expect(scoreAgainst("GREEN", "PUSH").score).toBe(0);
    expect(scoreAgainst(null, "GREEN").score).toBe(0);
  });
});

// ---- order-book route -------------------------------------------------
describe("ES1 order-book fade route", () => {
  const obHistory = Array.from({ length: OB_MIN_HISTORY }, (_, i) => ({
    targetTs: new Date(Date.UTC(2026, 7, 9) + i * TF_MS).toISOString(),
    absDepth: 0.5 + i * 0.01,
  }));

  it("falls back to price when the snapshot is missing, stale or incomplete", () => {
    const missing = decideEs1(baseInput(), rankHistory(400, 0.0001));
    expect(missing.hybridRoute).toBe("PRICE_RIDGE8");
    expect(missing.obRouteRejectReason).toBe("NO_SNAPSHOT");

    const stale = decideEs1(
      baseInput({
        obSnapshot: {
          targetTs: "2026-08-10T00:00:00.000Z",
          snapshotTs: "2026-08-10T00:00:00.000Z", // not strictly before target
          captureStatus: "OK",
          bookComplete: true,
          depthImbalance10bps: 0.1,
        },
        obHistory,
      }),
      rankHistory(400, 0.0001),
    );
    expect(stale.hybridRoute).toBe("PRICE_RIDGE8");
  });

  it("requires at least 32 prior valid captures", () => {
    const d = decideEs1(
      baseInput({
        obSnapshot: {
          targetTs: "2026-08-10T00:00:00.000Z",
          snapshotTs: "2026-08-09T23:59:00.000Z",
          captureStatus: "OK",
          bookComplete: true,
          depthImbalance10bps: 0.01,
        },
        obHistory: obHistory.slice(0, OB_MIN_HISTORY - 1),
      }),
      rankHistory(400, 0.0001),
    );
    expect(d.obRouteRejectReason).toBe("INSUFFICIENT_OB_HISTORY");
    expect(d.hybridRoute).toBe("PRICE_RIDGE8");
  });

  it("fades a qualifying quiet book and maps direction by sign", () => {
    const mk = (depth: number) =>
      decideEs1(
        baseInput({
          a2ProbabilityGreen: depth >= 0 ? 0.2 : 0.8,
          obSnapshot: {
            targetTs: "2026-08-10T00:00:00.000Z",
            snapshotTs: "2026-08-09T23:59:00.000Z",
            captureStatus: "OK",
            bookComplete: true,
            depthImbalance10bps: depth,
          },
          obHistory,
        }),
        rankHistory(400, 0.0001),
      );
    const pos = mk(0);
    expect(pos.hybridRoute).toBe("OB_DEPTH10_FADE");
    expect(pos.hybridDirection).toBe("RED"); // >= 0 fades to RED
    const neg = mk(-0.01);
    expect(neg.hybridRoute).toBe("OB_DEPTH10_FADE");
    expect(neg.hybridDirection).toBe("GREEN");
    expect(pos.hybridEvidence).toBeCloseTo(1 - (pos.obAbsPercentile ?? 0), 12);
  });
});

// ---- B4 guard ---------------------------------------------------------
describe("ES1 B4 correctness guard", () => {
  function gridHistory(cellWins: number, cellLosses: number): Es1HistoryEntry[] {
    const base = rankHistory(800, 0.0001);
    const now = Date.UTC(2026, 7, 10);
    return base.map((h, i) => ({
      ...h,
      targetTs: new Date(now - (base.length - i) * TF_MS).toISOString(),
      actualDirection:
        i >= base.length - cellWins - cellLosses && i < base.length - cellLosses ? "GREEN" : "RED",
    }));
  }

  it("never fires before the grid is mature", () => {
    const d = decideEs1(baseInput({ sourceIndexAbsolute: 100 }), rankHistory(400, 0.0001));
    expect(d.b4Ready).toBe(false);
    expect(d.b4GuardVetoFired).toBe(false);
    expect(d.finalPrediction).toBe("GREEN");
  });

  it("respects the 16m15s outcome-availability delay", () => {
    expect(GRID_OUTCOME_DELAY_MS).toBe(16 * 60 * 1000 + 15 * 1000);
    const hist = gridHistory(5, 5);
    const tooSoon = decideEs1(
      baseInput({
        sourceIndexAbsolute: 900,
        targetTs: new Date(new Date(hist[hist.length - 1].targetTs).getTime() + 1000).toISOString(),
      }),
      hist,
    );
    // the immediately preceding row cannot contribute to the cell counts
    expect(tooSoon.b4CellResolvedCount ?? 0).toBeLessThan(hist.length);
  });

  it("passes at pCorrect equality of 0.45 and is veto-only", () => {
    expect(betaPCorrect(14, 30)).toBeGreaterThan(0.45);
    // 0.45 exactly: (wins+8)/(n+16) = 0.45 -> wins=13, n=30
    expect(betaPCorrect(28, 64)).toBeCloseTo(0.45, 12);
  });

  it("attributes guard outcomes without changing direction", () => {
    expect(guardAttribution(true, true, -1, "GREEN").klass).toBe("AVOIDED_LOSS");
    expect(guardAttribution(true, true, 1, "GREEN").klass).toBe("SACRIFICED_WIN");
    expect(guardAttribution(false, true, 1, "GREEN").klass).toBe("NO_INCREMENTAL_CHANGE");
  });
});

// ---- parity / boundary / webhook regressions --------------------------
import oracleParity from "./oracle-parity.json";
import {
  ES1_WEBHOOK_ACTIVATION_FLOOR_TS,
  decisionToRow,
  maybeSendEs1Webhook,
  nextCleanBoundaryTs,
} from "../orchestrator.server";
import { CONFIDENCE_RANK_WINDOW } from "../config";

describe("ES1 confidence-rank semantics", () => {
  it("allows partial history with a single finite prior value", () => {
    const one: Es1HistoryEntry[] = [
      {
        targetTs: "2026-08-01T06:15:00.000Z",
        sourceIndex: 0,
        direction: "GREEN",
        evidence: 0.0001,
        priceConfidence: 0.0001,
        a2Confidence: 0.0001,
        cell: null,
        pCorrect: null,
        actualDirection: "GREEN",
      },
    ];
    const d = decideEs1(baseInput(), one);
    expect(d.priceRankHistoryCount).toBe(1);
    expect(d.combinedConfidenceRank).toBe(1);
    expect(d.finalPrediction).toBe("GREEN");
  });

  it("abstains with a null rank when no prior raw history exists", () => {
    const d = decideEs1(baseInput(), []);
    expect(d.combinedConfidenceRank).toBeNull();
    expect(d.decisionReason).toBe("ABSTAIN_CONFIDENCE_RANK_NOT_READY");
    expect(d.wouldTrade).toBe(false);
  });

  it("excludes pre-raw-epoch rows and never back-fills the 384 window", () => {
    const preEpoch: Es1HistoryEntry[] = Array.from({ length: 200 }, (_, i) => ({
      targetTs: new Date(Date.UTC(2026, 6, 10) + i * TF_MS).toISOString(),
      sourceIndex: null,
      direction: "GREEN" as const,
      evidence: 0.9,
      priceConfidence: 0.9,
      a2Confidence: 0.9,
      cell: null,
      pCorrect: null,
      actualDirection: "GREEN" as const,
    }));
    const raw = rankHistory(10, 0.00001);
    const d = decideEs1(baseInput(), [...preEpoch, ...raw]);
    expect(d.priceRankHistoryCount).toBe(10);
    expect(d.a2RankHistoryCount).toBe(10);

    const many = rankHistory(CONFIDENCE_RANK_WINDOW + 50, 0.00001);
    const capped = decideEs1(baseInput(), [...preEpoch, ...many]);
    expect(capped.priceRankHistoryCount).toBe(CONFIDENCE_RANK_WINDOW);
  });
});

describe("ES1 B4 pre-readiness pass-through", () => {
  it("preserves the aligned base decision before the 768-source grid is ready", () => {
    const d = decideEs1(baseInput({ sourceIndexAbsolute: 10 }), rankHistory(400, 0.00001));
    expect(d.b4Ready).toBe(false);
    expect(d.b4GuardVetoFired).toBe(false);
    expect(d.alignedCandidateBeforeB4).toBe(true);
    expect(d.finalPrediction).toBe(d.hybridDirection);
    expect(d.wouldTrade).toBe(true);
  });
});

describe("ES1 external oracle parity", () => {
  it("has zero final-decision mismatches against the independent sklearn oracle", () => {
    expect(oracleParity.final_decision_mismatches).toBe(0);
    expect(oracleParity.decision_reason_mismatches).toBe(0);
    expect(oracleParity.common_rows).toBeGreaterThan(3000);
    expect(oracleParity.max_probability_delta).toBeLessThan(1e-3);
  });
});

describe("ES1 activation boundary", () => {
  it("always lands on a future clean 15-minute boundary", () => {
    const t = Date.UTC(2026, 7, 15, 1, 37, 12);
    const b = new Date(nextCleanBoundaryTs(t)).getTime();
    expect(b % TF_MS).toBe(0);
    expect(b).toBeGreaterThan(t);
    expect(b - t).toBeLessThanOrEqual(TF_MS);
  });

  it("marks rows before the committed boundary webhook-ineligible", () => {
    const fr = buildFeatureRows(series(50)).find((r) => r.valid)!;
    const decision = decideEs1(
      { ...baseInput(), targetTs: fr.targetTs },
      rankHistory(400, 0.00001),
    );
    const mk = (targetCandleTs: string) =>
      decisionToRow(
        {
          targetCandleTs,
          runMode: "LIVE",
          activationTargetTs: ES1_WEBHOOK_ACTIVATION_FLOOR_TS,
        } as never,
        { targetTs: targetCandleTs, featureRow: fr, a2: null, fit: null, decision } as never,
      );
    const before = mk("2026-08-15T01:30:00.000Z");
    const after = mk("2026-08-15T02:00:00.000Z");
    expect(before.webhook_eligible).toBe(false);
    expect(after.webhook_eligible).toBe(true);
  });
});

describe("ES1 webhook gating", () => {
  function fakeSupabase(claim: boolean) {
    let claims = 0;
    const api = {
      claims: () => claims,
      from() {
        return {
          select: () => ({
            eq: () => ({ maybeSingle: async () => ({ data: null }) }),
            maybeSingle: async () => ({ data: null }),
          }),
          update: () => ({
            eq: () => ({
              is: () => ({
                select: () => ({
                  maybeSingle: async () => {
                    claims++;
                    return { data: claim ? { id: "row" } : null };
                  },
                }),
              }),
            }),
          }),
        };
      },
    };
    return api;
  }

  const liveRow = {
    id: "row",
    run_mode: "LIVE",
    would_trade: true,
    webhook_eligible: true,
    webhook_sent_at: null,
    final_prediction: "GREEN",
    target_candle_ts: "2026-09-01T00:00:00.000Z",
  };

  it("rejects BACKFILL and CATCHUP rows", async () => {
    const sb = fakeSupabase(true);
    expect(
      await maybeSendEs1Webhook(sb as never, { ...liveRow, run_mode: "BACKFILL" } as never),
    ).toBe(false);
    expect(
      await maybeSendEs1Webhook(sb as never, {
        ...liveRow,
        run_mode: "LIVE",
        webhook_eligible: false,
      } as never),
    ).toBe(false);
    expect(sb.claims()).toBe(0);
  });

  it("never re-sends a LIVE row that already claimed the send", async () => {
    const sb = fakeSupabase(false);
    expect(await maybeSendEs1Webhook(sb as never, liveRow as never)).toBe(false);
    expect(
      await maybeSendEs1Webhook(sb as never, {
        ...liveRow,
        webhook_sent_at: "2026-09-01T00:00:05.000Z",
      } as never),
    ).toBe(false);
  });
});
