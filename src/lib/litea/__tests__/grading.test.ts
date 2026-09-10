import { describe, expect, it } from "vitest";
import { gradeLiveCalls } from "../statsQuery.server";

const TS = "2026-09-10T06:30:00.000Z";

function row(over: Record<string, unknown>) {
  return { target_open_utc: TS, ticker: "KXBTC15M-26SEP100245-45", final_side: 0, ...over };
}
function settleMap(entries: Array<[string, string, number | null]>) {
  const m = new Map<string, number>();
  for (const [ticker, ts, label] of entries) {
    if (label == null) continue;
    m.set(`${ticker}@${new Date(ts).toISOString()}`, label);
  }
  return m;
}

describe("gradeLiveCalls", () => {
  it("grades both call directions against both official labels", () => {
    const s = settleMap([
      ["KXBTC15M-A", "2026-09-10T06:00:00Z", 1],
      ["KXBTC15M-B", "2026-09-10T06:15:00Z", -1],
      ["KXBTC15M-C", "2026-09-10T06:30:00Z", -1],
      ["KXBTC15M-D", "2026-09-10T06:45:00Z", 1],
    ]);
    const out = gradeLiveCalls(
      [
        row({ ticker: "KXBTC15M-A", target_open_utc: "2026-09-10T06:00:00Z", final_side: 1 }),
        row({ ticker: "KXBTC15M-B", target_open_utc: "2026-09-10T06:15:00Z", final_side: -1 }),
        row({ ticker: "KXBTC15M-C", target_open_utc: "2026-09-10T06:30:00Z", final_side: 1 }),
        row({ ticker: "KXBTC15M-D", target_open_utc: "2026-09-10T06:45:00Z", final_side: -1 }),
      ],
      s,
    );
    expect(out).toEqual({ calls: 4, wins: 2, losses: 2, pending: 0 });
  });

  it("leaves a call pending when the official label is absent", () => {
    const out = gradeLiveCalls([row({ final_side: 1 })], settleMap([]));
    expect(out).toEqual({ calls: 1, wins: 0, losses: 0, pending: 1 });
  });

  it("a same-time label from a different ticker cannot grade the call", () => {
    const s = settleMap([["OTHER-MARKET-45", TS, 1]]);
    const out = gradeLiveCalls([row({ final_side: 1 })], s);
    expect(out).toEqual({ calls: 1, wins: 0, losses: 0, pending: 1 });
  });

  it("a same-ticker label at a different target cannot grade the call", () => {
    const s = settleMap([["KXBTC15M-26SEP100245-45", "2026-09-10T06:45:00Z", 1]]);
    const out = gradeLiveCalls([row({ final_side: 1 })], s);
    expect(out).toEqual({ calls: 1, wins: 0, losses: 0, pending: 1 });
  });

  it("never counts or grades abstentions (final_side 0)", () => {
    const s = settleMap([["KXBTC15M-26SEP100245-45", TS, 1]]);
    const out = gradeLiveCalls([row({ final_side: 0 })], s);
    expect(out).toEqual({ calls: 0, wins: 0, losses: 0, pending: 0 });
  });

  it("mixed batch: calls graded, abstain excluded, unsettled pending", () => {
    const s = settleMap([
      ["KXBTC15M-A", "2026-09-10T06:00:00Z", 1],
      ["KXBTC15M-B", "2026-09-10T06:15:00Z", -1],
    ]);
    const out = gradeLiveCalls(
      [
        row({ ticker: "KXBTC15M-A", target_open_utc: "2026-09-10T06:00:00Z", final_side: 1 }),
        row({ ticker: "KXBTC15M-B", target_open_utc: "2026-09-10T06:15:00Z", final_side: 1 }),
        row({ ticker: "KXBTC15M-C", target_open_utc: "2026-09-10T06:30:00Z", final_side: -1 }),
        row({ ticker: "KXBTC15M-D", target_open_utc: "2026-09-10T06:45:00Z", final_side: 0 }),
      ],
      s,
    );
    expect(out).toEqual({ calls: 3, wins: 1, losses: 1, pending: 1 });
  });
});
