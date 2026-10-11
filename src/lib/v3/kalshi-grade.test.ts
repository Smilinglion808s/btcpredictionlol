import { describe, expect, it } from "vitest";
import { fetchV3KalshiOutcome, gradeV3, pickRefreshBatch, v3KalshiTicker, validateKalshiMarket } from "./kalshi-grade";

const T = (iso: string) => Date.parse(iso);
const mk = (open: number, o: any = {}) => ({ ticker: v3KalshiTicker(open), status: "finalized", result: "yes",
  close_time: new Date(open + 900_000).toISOString(), ...o });
const res = (status: number, body?: any) => new Response(body ? JSON.stringify(body) : null, { status });

describe("ticker mapping", () => {
  it("maps candle open to ET close (EDT/EST)", () => {
    expect(v3KalshiTicker(T("2026-10-11T09:45:00Z"))).toBe("KXBTC15M-26OCT110600-00");
    expect(v3KalshiTicker(T("2026-10-11T16:45:00Z"))).toBe("KXBTC15M-26OCT111300-00");
    expect(v3KalshiTicker(T("2026-10-11T08:00:00Z"))).toBe("KXBTC15M-26OCT110415-15");
    expect(v3KalshiTicker(T("2026-01-15T04:45:00Z"))).toBe("KXBTC15M-26JAN150000-00");
  });
});

describe("Oct 11 regression cohort", () => {
  const results = ["yes","yes","yes","yes","yes","no","yes","yes","no","no","no","no"];
  const tickers = ["110415-15","110545-45","110600-00","110700-00","110815-15","110830-30","111015-15","111300-00","111315-15","111400-00","111715-15","111730-30"];
  it("tickers map back to candle opens", () => {
    const opens = ["08:00","09:30","09:45","10:45","12:00","12:15","14:00","16:45","17:00","17:45","21:00","21:15"];
    opens.forEach((h, i) => expect(v3KalshiTicker(T(`2026-10-11T${h}:00Z`))).toBe(`KXBTC15M-26OCT${tickers[i]}`));
    expect(results.length).toBe(12);
  });
  it("DOWN calls at 09:45Z and 16:45Z lose on YES despite OKX down candles", () => {
    for (const o of ["2026-10-11T09:45:00Z", "2026-10-11T16:45:00Z"]) {
      const v = validateKalshiMarket(mk(T(o)), T(o));
      expect(typeof v).toBe("object");
      expect(gradeV3(-1, v as any)).toBe("L");
    }
  });
});

describe("validation stays pending", () => {
  const o = T("2026-10-11T12:00:00Z");
  it.each([[{ status: "closed" }], [{ status: "settled" }], [{ status: "weird" }], [{ result: "" }],
    [{ ticker: "KXBTC15M-26OCT110830-30" }], [{ close_time: "2026-10-11T12:30:00Z" }]])("%o", (c) => {
    const v = validateKalshiMarket(mk(o, c), o);
    expect(typeof v).toBe("string");
    expect(gradeV3(1, null)).toBe("P");
  });
});

describe("fetch", () => {
  const o = T("2026-10-11T12:00:00Z");
  it("falls back to historical on 404", async () => {
    const urls: string[] = [];
    const f: any = async (u: string) => { urls.push(u); return urls.length === 1 ? res(404) : res(200, { market: mk(o, { result: "no" }) }); };
    const r = await fetchV3KalshiOutcome(o, f);
    expect(r.ok && r.outcome.result).toBe("no");
    expect(urls[1]).toContain("/historical/markets/KXBTC15M-26OCT110815-15");
  });
  it.each([[async () => res(404)], [async () => res(429)], [async () => res(503)], [async () => res(302)],
    [async () => { throw new TypeError("net"); }], [async () => new Response("not json", { status: 200 })]])("failure pending", async (f: any) => {
    const r = await fetchV3KalshiOutcome(o, f);
    expect(r.ok).toBe(false);
  });
});

describe("refresh batch", () => {
  it("new closed calls first, bounded, no starvation by 404 rows", () => {
    const now = T("2026-10-11T22:00:00Z");
    const opens = Array.from({ length: 30 }, (_, i) => now - 900_000 * (i + 1));
    const cache = new Map<number, any>(opens.slice(5).map((t) => [t, { candle_open: "", final: false, attempts: 3,
      next_retry_at: new Date(now - 1).toISOString(), last_attempt_at: new Date(now - 60_000).toISOString() }]));
    const b = pickRefreshBatch([...opens, now], cache, now, 12);
    expect(b.length).toBe(12);
    expect(b.slice(0, 5)).toEqual(opens.slice(0, 5));
    expect(b).not.toContain(now);
  });
});
