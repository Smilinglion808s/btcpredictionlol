// Live inputs come from the collector's finalized one-second bars, never from
// a derived legacy row. Every requirement is checked, and anything ambiguous
// fails closed (returns null) rather than producing a value.

import { describe, expect, it } from "vitest";
import { readT45InputsFromSamples } from "../store.server";

const TARGET = "2026-09-12T01:00:00.000Z";
const openMs = Date.parse(TARGET);

function bar(off: number, over: Record<string, unknown> = {}) {
  return {
    offset_seconds: off,
    open: 100 + off,
    high: 101 + off,
    low: 99 + off,
    close: 100.5 + off,
    volume: 1,
    quote_volume: 100,
    trade_count: 5,
    taker_buy_quote_volume: 50,
    bar_open_ts: new Date(openMs + off * 1000).toISOString(),
    is_final: true,
    received_at: new Date(openMs + off * 1000 + 400).toISOString(),
    created_at: new Date(openMs + off * 1000 + 700).toISOString(),
    ...over,
  };
}

const fullSet = () => [...new Array(45).keys()].map((i) => bar(i));

/** Minimal stand-in for the chained PostgREST query builder used by the read. */
function sbWith(rows: unknown[] | null) {
  const chain: any = {
    select: () => chain,
    eq: () => chain,
    order: () => Promise.resolve({ data: rows, error: null }),
  };
  return { from: () => chain } as any;
}

describe("readT45InputsFromSamples", () => {
  it("builds inputs and real receipt evidence from 45 finalized bars", async () => {
    const res = await readT45InputsFromSamples(sbWith(fullSet()), TARGET);
    expect(res).not.toBeNull();
    expect(res!.barsUsed).toBe(45);
    expect(res!.source).toBe("t45_second_samples");
    expect(Date.parse(res!.lastBarReceivedAt!)).toBe(openMs + 44_000 + 400);
    expect(Date.parse(res!.lastBarPersistedAt!)).toBe(openMs + 44_000 + 700);
    expect(Object.keys(res!.feats).length).toBeGreaterThan(0);
  });

  it("refuses a short set", async () => {
    expect(await readT45InputsFromSamples(sbWith(fullSet().slice(0, 44)), TARGET)).toBeNull();
  });

  it("refuses duplicate offsets instead of picking one", async () => {
    expect(await readT45InputsFromSamples(sbWith([...fullSet(), bar(44)]), TARGET)).toBeNull();
  });

  it("refuses a non-final bar", async () => {
    const rows = fullSet();
    rows[20] = bar(20, { is_final: false });
    expect(await readT45InputsFromSamples(sbWith(rows), TARGET)).toBeNull();
  });

  it("refuses a bar whose event time is not exactly T+offset", async () => {
    const rows = fullSet();
    rows[7] = bar(7, { bar_open_ts: new Date(openMs + 7_500).toISOString() });
    expect(await readT45InputsFromSamples(sbWith(rows), TARGET)).toBeNull();
  });

  it("refuses a bar with no receipt evidence", async () => {
    const rows = fullSet();
    rows[44] = bar(44, { received_at: null });
    expect(await readT45InputsFromSamples(sbWith(rows), TARGET)).toBeNull();
  });

  it("returns null when the collector wrote nothing", async () => {
    expect(await readT45InputsFromSamples(sbWith([]), TARGET)).toBeNull();
  });
});
