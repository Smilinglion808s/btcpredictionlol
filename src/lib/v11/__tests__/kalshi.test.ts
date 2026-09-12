// Settlement timing provenance.
//
// Per the official market lifecycle, a finalized market publishes
// `settlement_ts`. That field is authoritative; `determination_time` precedes
// settlement and must never be used as one. Anything implausible falls back to
// the conservative observed time, tagged as such by the caller.

import { describe, expect, it } from "vitest";
import { nativeSettlementTsOf, pick, type KalshiMarket } from "../kalshi.server";

const CLOSE = "2026-09-11T18:00:00.000Z";
const OBSERVED = Date.parse("2026-09-11T18:30:00.000Z");

const base: KalshiMarket = {
  ticker: "KXBTCD-26SEP1118-T1",
  status: "finalized",
  result: "yes",
  market_type: "binary",
  title: "Bitcoin up in next 15 minutes?",
  close_time: CLOSE,
};

describe("native settlement instant", () => {
  it("prefers the official settlement_ts", () => {
    expect(
      nativeSettlementTsOf(
        { ...base, settlement_ts: "2026-09-11T18:00:12.000Z", settled_time: "2026-09-11T18:05:00.000Z" },
        OBSERVED,
      ),
    ).toBe("2026-09-11T18:00:12.000Z");
  });

  it("accepts the legacy spellings when settlement_ts is absent", () => {
    expect(nativeSettlementTsOf({ ...base, settled_time: "2026-09-11T18:00:30.000Z" }, OBSERVED)).toBe(
      "2026-09-11T18:00:30.000Z",
    );
    expect(
      nativeSettlementTsOf({ ...base, settlement_timestamp: "2026-09-11T18:01:00.000Z" }, OBSERVED),
    ).toBe("2026-09-11T18:01:00.000Z");
  });

  it("never treats determination_time as settlement", () => {
    expect(
      nativeSettlementTsOf({ ...base, determination_time: "2026-09-11T18:00:02.000Z" }, OBSERVED),
    ).toBeNull();
  });

  it("rejects a settlement before close, a future one, and sentinel epochs", () => {
    expect(nativeSettlementTsOf({ ...base, settlement_ts: "2026-09-11T17:30:00.000Z" }, OBSERVED)).toBeNull();
    expect(nativeSettlementTsOf({ ...base, settlement_ts: "2026-09-11T19:30:00.000Z" }, OBSERVED)).toBeNull();
    expect(nativeSettlementTsOf({ ...base, settlement_ts: "1970-01-01T00:00:00.000Z" }, OBSERVED)).toBeNull();
    expect(nativeSettlementTsOf({ ...base, settlement_ts: "not-a-date" }, OBSERVED)).toBeNull();
  });

  it("returns null (caller uses observed time) when nothing is published", () => {
    expect(nativeSettlementTsOf(base, OBSERVED)).toBeNull();
  });
});

describe("resolution payload", () => {
  it("reads a finalized payload end to end", () => {
    const res = pick(
      [{ ...base, settlement_ts: "2026-09-11T18:00:09.000Z", settlement_value_dollars: "1" }],
      OBSERVED,
    );
    expect(res?.result).toBe("YES");
    expect(res?.nativeSettlementTs).toBe("2026-09-11T18:00:09.000Z");
    expect(res?.settlementValue).toBe(1);
  });

  it("ignores markets that are not finalized or settled", () => {
    expect(pick([{ ...base, status: "active" }], OBSERVED)).toBeNull();
  });
});
