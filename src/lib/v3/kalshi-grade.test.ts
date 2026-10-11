import { describe, expect, it } from "vitest";
import { cachedOutcome, fetchV3KalshiOutcome, gradeV3, pickRefreshBatch, pool, refreshAndResolve, v3KalshiTicker, validateKalshiMarket, type GradeDeps } from "./kalshi-grade";

const T = (iso: string) => Date.parse(iso);
const mk = (open: number, o: any = {}) => ({ ticker: v3KalshiTicker(open), market_type: "binary", status: "finalized", result: "yes",
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
    [{ ticker: "KXBTC15M-26OCT110830-30" }], [{ market_type: "scalar" }], [{ market_type: undefined }], [{ close_time: "2026-10-11T12:30:00Z" }]])("%o", (c) => {
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

it("rejects non-quarter-hour candle timestamps", () => {
  const o = T("2026-10-11T12:00:00Z");
  expect(validateKalshiMarket(mk(o), o + 1000)).toBe("CANDLE_TIME_INVALID");
  expect(validateKalshiMarket(mk(o), NaN)).toBe("CANDLE_TIME_INVALID");
});

// Fixed Oct 11 cohort (Boise 00:00–15:29; excludes 15:30 Boise = 21:30Z).
const COHORT: [string, number, "yes" | "no"][] = [
  ["08:00", 1, "yes"], ["09:30", -1, "yes"], ["09:45", -1, "yes"], ["10:45", 1, "yes"], ["12:00", 1, "yes"], ["12:15", -1, "no"],
  ["14:00", -1, "yes"], ["16:45", -1, "yes"], ["17:00", -1, "no"], ["17:45", -1, "no"], ["21:00", -1, "no"], ["21:15", -1, "no"],
];
const copen = (h: string) => T(`2026-10-11T${h}:00Z`);

function memoryDeps(results: Map<number, any>, opts: { readFail?: boolean; writeFail?: boolean } = {}) {
  const db = new Map<number, any>();
  const deps: GradeDeps & { db: Map<number, any>; calls: number; inFlight: number; maxInFlight: number } = {
    db, calls: 0, inFlight: 0, maxInFlight: 0,
    async readCache() { return opts.readFail ? { rows: [], error: true } : { rows: [...db.values()], error: false }; },
    async record(row: any) {
      if (opts.writeFail) return { error: true };
      const t = Date.parse(row.candle_open); const prev = db.get(t);
      if (!prev?.final) db.set(t, { ...row, attempts: (prev?.attempts ?? 0) + 1 }); // mirrors WHERE NOT final
      return { error: false };
    },
    async fetchOutcome(t: number) {
      deps.calls++; deps.inFlight++; deps.maxInFlight = Math.max(deps.maxInFlight, deps.inFlight);
      await new Promise((r) => setTimeout(r, 2)); deps.inFlight--;
      const m = results.get(t);
      if (!m) return { ok: false, reason: "HTTP_404", endpoint: "historical" } as const;
      const v = validateKalshiMarket(m, t);
      return typeof v === "string" ? { ok: false, reason: v, endpoint: "markets" } as const : { ok: true, outcome: v, endpoint: "markets", raw: m } as const;
    },
  };
  return deps;
}

describe("refreshAndResolve", () => {
  const now = T("2026-10-11T22:00:00Z");
  const opens = COHORT.map(([h]) => copen(h));
  const markets = new Map(COHORT.map(([h, , r]) => [copen(h), mk(copen(h), { result: r })]));
  it("12-call direction+result fixture grades 8W/4L with pool ≤3", async () => {
    const deps = memoryDeps(markets);
    const g = await refreshAndResolve(opens, now, deps);
    expect(g.unavailable).toBe(false);
    expect(deps.maxInFlight).toBeLessThanOrEqual(3);
    const res = COHORT.map(([h, d]) => gradeV3(d, g.outcomes.get(copen(h)) ?? null));
    expect(res.filter((x) => x === "W").length).toBe(8);
    expect(res.filter((x) => x === "L").length).toBe(4);
    expect(res[2]).toBe("L"); expect(res[7]).toBe("L");
  });
  it("a later failed lookup never downgrades a finalized row", async () => {
    const deps = memoryDeps(markets);
    await refreshAndResolve(opens, now, deps);
    const t = opens[0];
    await deps.record({ candle_open: new Date(t).toISOString(), final: false, result: null, last_error: "HTTP_503" });
    expect(deps.db.get(t).final).toBe(true);
    const g = await refreshAndResolve(opens, now + 3_600_000, memoryDepsFrom(deps));
    expect(g.outcomes.get(t)?.result).toBe("yes");
  });
  it("cache read error ⇒ unavailable, no fetches", async () => {
    const deps = memoryDeps(markets, { readFail: true });
    const g = await refreshAndResolve(opens, now, deps);
    expect(g.unavailable).toBe(true); expect(deps.calls).toBe(0);
  });
  it("cache write error ⇒ unavailable", async () => {
    const g = await refreshAndResolve(opens, now, memoryDeps(markets, { writeFail: true }));
    expect(g.unavailable).toBe(true);
  });
  it("cached rows with wrong identity are ignored", () => {
    const t = opens[0];
    expect(cachedOutcome({ final: true, ticker: "KXBTC15M-X", result: "yes", close_time: new Date(t + 900_000).toISOString() }, t)).toBeNull();
    expect(cachedOutcome({ final: true, ticker: v3KalshiTicker(t), result: "yes", close_time: new Date(t).toISOString() }, t)).toBeNull();
  });
  it("pool bounds concurrency", async () => {
    let n = 0, max = 0;
    await pool([...Array(10).keys()], 3, async () => { n++; max = Math.max(max, n); await new Promise((r) => setTimeout(r, 1)); n--; });
    expect(max).toBe(3);
  });
});

function memoryDepsFrom(d: ReturnType<typeof memoryDeps>) {
  return { ...d, fetchOutcome: async () => ({ ok: false, reason: "HTTP_503", endpoint: "markets" }) as const } as GradeDeps;
}
