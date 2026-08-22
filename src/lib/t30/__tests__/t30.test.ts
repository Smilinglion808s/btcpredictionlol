// T30 PriceFlow Balanced R1 — identity, packet, rank and decision invariants.

import { describe, expect, it } from "vitest";
import { createHash } from "crypto";
import {
  T30_CONFIG_CANONICAL,
  T30_CONFIG_HASH,
  T30_EXPECTED_OBSERVATIONS,
  T30_FEATURE_ORDER,
  T30_FEATURE_ORDER_HASH,
  T30_FAST_RANK_WINDOW,
  T30_LONG_RANK_WINDOW,
  T30_REASONS,
} from "../config";
import { buildT30Features } from "../features";
import { t30BlockStart, t30Decide, t30PercentileRank, t30Score } from "../head";
import { validateT30Samples } from "../ingest";
import type { T30SecondBar } from "../features";

const sha = (s: string) => createHash("sha256").update(s).digest("hex");

function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function packet(seed: number, n = T30_EXPECTED_OBSERVATIONS): T30SecondBar[] {
  const r = rng(seed);
  const bars: T30SecondBar[] = [];
  let price = 61000;
  for (let i = 0; i < n; i++) {
    const open = price;
    const close = open * (1 + (r() - 0.5) * 0.001);
    const volume = r() * 3 + 0.05;
    const quoteVolume = volume * ((open + close) / 2);
    bars.push({
      offsetSeconds: i,
      open,
      high: Math.max(open, close) * 1.0001,
      low: Math.min(open, close) * 0.9999,
      close,
      volume,
      quoteVolume,
      tradeCount: Math.floor(r() * 200) + 1,
      takerBuyQuoteVolume: quoteVolume * r(),
    });
    price = close;
  }
  return bars;
}

describe("T30 identity", () => {
  it("has 28 uniquely named frozen features", () => {
    expect(T30_FEATURE_ORDER.length).toBe(28);
    expect(new Set(T30_FEATURE_ORDER).size).toBe(28);
    expect(T30_FEATURE_ORDER.every((f) => f.startsWith("t30_"))).toBe(true);
  });

  it("matches the frozen config and feature-order hashes", () => {
    expect(sha(T30_CONFIG_CANONICAL)).toBe(T30_CONFIG_HASH);
    expect(sha(JSON.stringify(T30_FEATURE_ORDER))).toBe(T30_FEATURE_ORDER_HASH);
  });

  it("contains no T45 field anywhere in the matrix", () => {
    expect(T30_FEATURE_ORDER.some((f) => f.includes("t45"))).toBe(false);
    expect(T30_FEATURE_ORDER.some((f) => f.includes("r2"))).toBe(false);
  });
});

describe("T30 packet rules", () => {
  it("produces a complete 28-length vector from 30 aligned final bars", () => {
    const out = buildT30Features(packet(3));
    expect(out.spotComplete).toBe(true);
    expect(out.featureComplete).toBe(true);
    expect(out.vector?.length).toBe(28);
  });

  it("fails closed on 29 bars", () => {
    const out = buildT30Features(packet(3).slice(0, 29));
    expect(out.spotComplete).toBe(false);
    expect(out.vector).toBeNull();
  });

  it("fails closed on a missing interior offset", () => {
    const out = buildT30Features(packet(3).filter((b) => b.offsetSeconds !== 11));
    expect(out.spotComplete).toBe(false);
  });

  it("rejects offset 30 and later at ingest", () => {
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    const mk = (offset: number) => ({
      bar_open_ms: base + offset * 1000,
      open: 1,
      high: 1,
      low: 1,
      close: 1,
      volume: 1,
      quote_volume: 1,
      taker_buy_volume: 0.5,
      taker_buy_quote_volume: 0.5,
      trade_count: 1,
      is_final: true,
    });
    const { rows, rejected } = validateT30Samples([mk(0), mk(29), mk(30), mk(44)]);
    expect(rows.map((r) => r.offset_seconds)).toEqual([0, 29]);
    expect(rejected.every((r) => r.reason === "OUTSIDE_T30_WINDOW")).toBe(true);
  });

  it("rejects non-final bars", () => {
    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    const { rows, rejected } = validateT30Samples([
      {
        bar_open_ms: base,
        open: 1,
        high: 1,
        low: 1,
        close: 1,
        volume: 1,
        quote_volume: 1,
        taker_buy_volume: 0,
        taker_buy_quote_volume: 0,
        trade_count: 1,
        is_final: false,
      },
    ]);
    expect(rows.length).toBe(0);
    expect(rejected[0].reason).toBe("T30_NONFINAL_BAR");
  });
});

describe("T30 dual-horizon rank", () => {
  const prior = (n: number, from = 0) =>
    Array.from({ length: n }, (_, i) => ({
      targetTs: new Date(Date.UTC(2026, 0, 1) + i * 900_000).toISOString(),
      confidence: (from + i) / 10_000,
    }));

  it("is not ready until the full window exists", () => {
    expect(t30PercentileRank(0.1, prior(767), T30_LONG_RANK_WINDOW).rank).toBeNull();
    expect(t30PercentileRank(0.1, prior(768), T30_LONG_RANK_WINDOW).rank).not.toBeNull();
    expect(t30PercentileRank(0.1, prior(95), T30_FAST_RANK_WINDOW).rank).toBeNull();
    expect(t30PercentileRank(0.1, prior(96), T30_FAST_RANK_WINDOW).rank).not.toBeNull();
  });

  it("counts equality as half a rank", () => {
    const history = [0.1, 0.1, 0.2, 0.3].map((c, i) => ({
      targetTs: `2026-01-0${i + 1}T00:00:00.000Z`,
      confidence: c,
    }));
    expect(t30PercentileRank(0.1, history, 4).rank).toBeCloseTo(0.25, 12);
  });
});

describe("T30 decision order", () => {
  const mkPrior = (n: number, value: number) =>
    Array.from({ length: n }, (_, i) => ({
      targetTs: new Date(Date.UTC(2026, 0, 1) + i * 900_000).toISOString(),
      confidence: value,
    }));

  it("abstains before the long rank is ready", () => {
    const d = t30Decide(0.9, mkPrior(100, 0.01));
    expect(d.reason).toBe(T30_REASONS.LONG_RANK_NOT_READY);
    expect(d.modelWouldTrade).toBe(false);
  });

  it("publishes only when both gates pass", () => {
    const d = t30Decide(0.9, mkPrior(768, 0.001));
    expect(d.reason).toBe(T30_REASONS.PUBLISH);
    expect(d.modelWouldTrade).toBe(true);
    expect(d.modelDirection).toBe(1);
  });

  it("abstains below the long-rank gate", () => {
    const d = t30Decide(0.5001, mkPrior(768, 0.4));
    expect(d.reason).toBe(T30_REASONS.BELOW_LONG_RANK_GATE);
    expect(d.modelWouldTrade).toBe(false);
  });
});

describe("T30 scoring", () => {
  it("keeps ABSTAIN distinct from PUSH", () => {
    expect(t30Score(false, 1, 1)).toEqual({ result: "ABSTAIN", score: 0 });
    expect(t30Score(true, 1, 0)).toEqual({ result: "PUSH", score: 0 });
    expect(t30Score(true, 1, 1)).toEqual({ result: "WIN", score: 1 });
    expect(t30Score(true, 1, -1)).toEqual({ result: "LOSS", score: -1 });
  });
});

describe("T30 fit blocks", () => {
  it("has no fit before the warm-up requirement", () => {
    expect(t30BlockStart(2783)).toBeNull();
    expect(t30BlockStart(2784)).toBe(2784);
    expect(t30BlockStart(2879)).toBe(2784);
    expect(t30BlockStart(2880)).toBe(2880);
  });
});
