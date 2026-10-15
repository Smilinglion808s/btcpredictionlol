import { describe, expect, it } from "vitest";
import { deriveAltWorkerView, type AltWorkerInput } from "./alt-worker-view";

const now = 1_000_000;
const down = { ok: false as const, code: "UNAVAILABLE" };
const health = (state: string, qs = "FRESH") => ({ ok: true as const, data: { state, symbols: { SOLUSDT: { quote_state: qs }, DOGEUSDT: { quote_state: qs } } } });
const events = (age: number) => ({ ok: true as const, data: { symbols: { SOLUSDT: { quote: { bid: "1", ask: "2", receipt_ms: now - age, flags: [] } }, DOGEUSDT: { quote: { bid: "1", ask: "2", receipt_ms: now - age, flags: [] } } } } });
const paper = { ok: true as const, data: { starting_balance: "1000", cash: "1000", equity: "1000", positions: [], recent_trades: [], trade_count: 0, config: { strategy_enabled: false } } };

describe("deriveAltWorkerView", () => {
  it("no data -> UNKNOWN", () => expect(deriveAltWorkerView(undefined, now).label).toBe("UNKNOWN"));
  it("unreachable / 503 everywhere -> red, never green", () => {
    const v = deriveAltWorkerView({ health: down, events: down, paper: down }, now);
    expect(v.label).toBe("UNREACHABLE");
    expect(v.symbols.every((s) => s.tone === "red")).toBe(true);
    expect(v.paper).toEqual({ reason: "Paper ledger unavailable" });
  });
  it("ledger 503 while feed live keeps feed but marks paper unavailable", () => {
    const v = deriveAltWorkerView({ health: health("RUNNING"), events: events(500), paper: down }, now);
    expect(v.label).toBe("LIVE");
    expect(v.paper && "reason" in v.paper).toBe(true);
  });
  it("old quotes -> STALE even if worker says FRESH", () => {
    const v = deriveAltWorkerView({ health: health("RUNNING"), events: events(20_000), paper }, now);
    expect(v.label).toBe("STALE");
    expect(v.symbols[0].tone).toBe("amber");
  });
  it("worker STALE state -> STALE", () => {
    expect(deriveAltWorkerView({ health: health("STALE", "STALE"), events: events(500), paper }, now).label).toBe("STALE");
  });
  it("events unreachable -> symbols UNKNOWN, not live", () => {
    const v = deriveAltWorkerView({ health: health("RUNNING"), events: down, paper } as AltWorkerInput, now);
    expect(v.label).not.toBe("LIVE");
    expect(v.symbols[0].label).toBe("UNKNOWN");
  });
  it("fresh running -> LIVE; strategy disabled shown", () => {
    const v = deriveAltWorkerView({ health: health("RUNNING"), events: events(500), paper }, now);
    expect(v.label).toBe("LIVE");
    expect(v.paper && "strategy" in v.paper && v.paper.strategy).toBe("DISABLED");
  });
});
