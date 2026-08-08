import { describe, expect, it } from "vitest";
import {
  classifyCapture,
  computeDepth,
  computeFlowLabels,
  computeTopOfBook,
  computeTradeFlow,
  flowRelationship,
  imbalance,
  ratio,
  type Book,
  type Trade,
} from "../shadow/orderbook";
import { buildShadowRow } from "../shadow/persist.server";

const TARGET = "2026-08-08T12:00:00.000Z";
const TARGET_MS = Date.parse(TARGET);
const CUTOFF = TARGET_MS - 1;

function book(): Book {
  const bids = Array.from({ length: 25 }, (_, i) => ({ price: 100 - i * 0.01, qty: 2 }));
  const asks = Array.from({ length: 25 }, (_, i) => ({ price: 100.02 + i * 0.01, qty: 1 }));
  return { bids, asks };
}

function trade(secBefore: number, side: "buy" | "sell", size = 1): Trade {
  return { ts: CUTOFF - secBefore * 1000, price: 100, size, side };
}

describe("order-book math", () => {
  it("computes mid, spread and microprice", () => {
    const t = computeTopOfBook({ bids: [{ price: 100, qty: 3 }], asks: [{ price: 102, qty: 1 }] });
    expect(t.mid_price).toBe(101);
    expect(t.spread_abs).toBe(2);
    expect(t.spread_bps).toBeCloseTo((2 / 101) * 10000, 9);
    // (ask*bidQty + bid*askQty) / (bidQty + askQty)
    expect(t.microprice).toBeCloseTo((102 * 3 + 100 * 1) / 4, 9);
    expect(t.microprice_offset_bps).toBeCloseTo(((101.5 - 101) / 101) * 10000, 9);
  });

  it("returns null (not zero) for invalid denominators", () => {
    expect(ratio(1, 0)).toBeNull();
    expect(imbalance(0, 0)).toBeNull();
    const t = computeTopOfBook({ bids: [{ price: 100, qty: 0 }], asks: [{ price: 102, qty: 0 }] });
    expect(t.microprice).toBeNull();
    expect(t.microprice_offset_bps).toBeNull();
  });

  it("computes depth buckets and bounded imbalances", () => {
    const d = computeDepth(book(), 100.01);
    expect(d.buckets.top1.bid.base).toBe(2);
    expect(d.buckets.top5.bid.base).toBe(10);
    expect(d.buckets.top20.ask.base).toBe(20);
    expect(d.queue_imbalance_top1).toBeCloseTo(1 / 3, 9);
    for (const v of [
      d.queue_imbalance_top5,
      d.queue_imbalance_top20,
      d.depth_imbalance_1bps,
      d.depth_imbalance_25bps,
    ]) {
      if (v != null) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
    expect(d.buckets.top1.bid.quote).toBeCloseTo(200, 6);
  });
});

describe("trade flow", () => {
  const trades = [trade(10, "buy", 2), trade(100, "sell"), trade(1000, "buy")];

  it("never includes post-cutoff events", () => {
    const withLeak = [...trades, { ts: CUTOFF + 5, price: 100, size: 99, side: "buy" as const }];
    const f = computeTradeFlow(withLeak, CUTOFF, CUTOFF - 900_000);
    expect(f.trade_event_count).toBe(3);
    expect(f.windows.w30s.taker_buy_quote).toBe(200);
  });

  it("marks incomplete windows explicitly and nulls their deltas", () => {
    const f = computeTradeFlow(trades, CUTOFF, CUTOFF - 60_000);
    expect(f.windows.w30s.window_complete).toBe(true);
    expect(f.windows.w15m.window_complete).toBe(false);
    expect(f.taker_delta_15m).toBeNull();
    expect(f.all_windows_complete).toBe(false);
  });

  it("computes cvd and normalized delta", () => {
    const f = computeTradeFlow(trades, CUTOFF, CUTOFF - 900_000);
    expect(f.cvd_3m).toBe(200 - 100);
    expect(f.taker_delta_3m).toBeCloseTo(100 / 300, 9);
  });
});

describe("flow labels", () => {
  it("needs two components to be available", () => {
    const l = computeFlowLabels({
      micropriceOffsetBps: null,
      spreadBps: null,
      queueImbalanceTop5: 0.4,
      takerDelta3m: null,
    });
    expect(l.flow_direction).toBe("UNAVAILABLE");
  });

  it("labels direction, coherence and strength", () => {
    const l = computeFlowLabels({
      micropriceOffsetBps: 2,
      spreadBps: 2,
      queueImbalanceTop5: 0.8,
      takerDelta3m: 0.6,
    });
    expect(l.flow_component_count).toBe(3);
    expect(l.flow_direction).toBe("GREEN");
    expect(l.flow_coherent).toBe(true);
    expect(l.flow_strong_coherent).toBe(true);
    expect(l.flow_strength).toBeGreaterThan(0.5);
  });

  it("maps AGREE / CONFLICT / NEUTRAL / UNAVAILABLE", () => {
    expect(flowRelationship("GREEN", "GREEN")).toBe("AGREE");
    expect(flowRelationship("GREEN", "RED")).toBe("CONFLICT");
    expect(flowRelationship("NEUTRAL", "RED")).toBe("NEUTRAL");
    expect(flowRelationship("UNAVAILABLE", "RED")).toBe("UNAVAILABLE");
    expect(flowRelationship("GREEN", null)).toBe("UNAVAILABLE");
  });
});

describe("capture classification", () => {
  const base = { hasSnapshot: true, cutoffMs: CUTOFF, sequenceGap: false, bookComplete: true };
  it("accepts a fresh pre-boundary snapshot", () => {
    expect(classifyCapture({ ...base, eventTsMs: CUTOFF - 500 }).status).toBe("CAPTURED_VALID");
  });
  it("rejects an event at or after the cutoff", () => {
    expect(classifyCapture({ ...base, eventTsMs: CUTOFF + 1 }).status).toBe("NO_PREBOUNDARY_SNAPSHOT");
    expect(classifyCapture({ ...base, eventTsMs: TARGET_MS }).status).toBe("NO_PREBOUNDARY_SNAPSHOT");
  });
  it("marks stale, sequence gap, incomplete and missing", () => {
    expect(classifyCapture({ ...base, eventTsMs: CUTOFF - 5000 }).status).toBe("CAPTURED_STALE");
    expect(classifyCapture({ ...base, eventTsMs: CUTOFF - 10, sequenceGap: true }).status).toBe("CAPTURED_SEQUENCE_GAP");
    expect(classifyCapture({ ...base, eventTsMs: CUTOFF - 10, bookComplete: false }).status).toBe("CAPTURED_INCOMPLETE");
    expect(classifyCapture({ ...base, hasSnapshot: false, eventTsMs: null }).status).toBe("NO_PREBOUNDARY_SNAPSHOT");
    expect(classifyCapture({ ...base, eventTsMs: CUTOFF - 10, errorCode: "COLLECTOR_ERROR" }).status).toBe("COLLECTOR_ERROR");
  });
});

describe("shadow row builder", () => {
  const pred = {
    id: "pred-1",
    target_candle_ts: TARGET,
    run_mode: "LIVE",
    raw_direction: "GREEN",
    final_prediction: "GREEN",
    would_trade: true,
  };

  it("builds an audit row with no metrics when nothing was captured", () => {
    const row = buildShadowRow(pred, null);
    expect(row.capture_status).toBe("NO_PREBOUNDARY_SNAPSHOT");
    expect(row.b4x4_prediction_id).toBe("pred-1");
    expect(row.shadow_only).toBe(true);
    expect(row.used_in_decision).toBe(false);
    expect(row.mid_price).toBeUndefined();
  });

  it("abstained predictions still produce a row", () => {
    const row = buildShadowRow({ ...pred, would_trade: false, final_prediction: null }, null);
    expect(row.b4x4_prediction_id).toBe("pred-1");
    expect(row.b4x4_published).toBe(false);
  });

  it("computes metrics from a valid pre-boundary snapshot", () => {
    const row = buildShadowRow(pred, {
      event_ts: new Date(CUTOFF - 400).toISOString(),
      book_json: book(),
      trades_json: [trade(5, "buy", 3), trade(20, "sell")],
      trade_window_start_ts: new Date(CUTOFF - 900_000).toISOString(),
      book_complete: true,
      sequence_gap: false,
      captured_at: new Date(CUTOFF - 400).toISOString(),
    });
    expect(row.capture_status).toBe("CAPTURED_VALID");
    expect(row.snapshot_age_ms).toBe(400);
    expect(row.mid_price).toBeCloseTo(100.01, 9);
    expect(row.queue_imbalance_top5).not.toBeNull();
    expect(["AGREE", "CONFLICT", "NEUTRAL", "UNAVAILABLE"]).toContain(row.raw_direction_relationship);
    expect(row.add_cancel_imbalance).toBeNull();
    expect(row.add_cancel_source_available).toBe(false);
  });

  it("never fabricates metrics for historical placeholders", () => {
    const row = buildShadowRow(pred, { error_code: "COLLECTOR_ERROR", error_message: "x" });
    expect(row.capture_status).toBe("COLLECTOR_ERROR");
    expect(row.mid_price).toBeUndefined();
    expect(row.flow_direction).toBeUndefined();
  });

  it("is deterministic for the same snapshot (idempotent upsert payload)", () => {
    const snap = {
      event_ts: new Date(CUTOFF - 100).toISOString(),
      book_json: book(),
      trades_json: [],
      trade_window_start_ts: null,
      book_complete: true,
      sequence_gap: false,
    };
    const a = buildShadowRow(pred, snap);
    const b = buildShadowRow(pred, snap);
    expect({ ...a, snapshot_persisted_at: null }).toEqual({ ...b, snapshot_persisted_at: null });
  });
});
