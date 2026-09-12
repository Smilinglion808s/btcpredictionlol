import { describe, expect, it } from "vitest";
import { v11ObservationGate } from "../hookGate";
import { V11_PUBLICATION_CEILING_MS } from "../config";

const TARGET = Date.parse("2026-09-12T03:30:00.000Z");

/**
 * Simulates the hook's V11 leg against an immutable single-row store, exactly
 * as production behaves: the first committed observation for a target wins.
 */
function makeRun() {
  const store = new Map<string, { mode: "LIVE_SHADOW" | "RECOVERY" }>();
  return {
    store,
    invoke(opts: { signed: boolean; nowMs: number }) {
      const gate = v11ObservationGate({
        signed: opts.signed,
        targetMs: TARGET,
        nowMs: opts.nowMs,
      });
      if (!gate.run) return { observed: false, reason: gate.reason };
      if (store.has("t")) return { observed: false, reason: "DUPLICATE" };
      store.set("t", { mode: opts.signed ? "LIVE_SHADOW" : "RECOVERY" });
      return { observed: true, reason: gate.reason };
    },
  };
}

describe("v11ObservationGate", () => {
  it("blocks the unsigned watchdog inside the 60s ceiling", () => {
    const gate = v11ObservationGate({ signed: false, targetMs: TARGET, nowMs: TARGET + 45_250 });
    expect(gate).toEqual({ run: false, reason: "RESERVED_FOR_SIGNED_COLLECTOR" });
  });

  it("always admits the signed collector", () => {
    expect(
      v11ObservationGate({ signed: true, targetMs: TARGET, nowMs: TARGET + 45_753 }).run,
    ).toBe(true);
  });

  it("admits unsigned recovery at or after the ceiling", () => {
    expect(
      v11ObservationGate({
        signed: false,
        targetMs: TARGET,
        nowMs: TARGET + V11_PUBLICATION_CEILING_MS,
      }),
    ).toEqual({ run: true, reason: "AFTER_CEILING_RECOVERY" });
  });

  it("unsigned T+45 leaves the target unclaimed, then signed T+45.x records LIVE_SHADOW", () => {
    const run = makeRun();
    expect(run.invoke({ signed: false, nowMs: TARGET + 45_250 })).toEqual({
      observed: false,
      reason: "RESERVED_FOR_SIGNED_COLLECTOR",
    });
    expect(run.store.size).toBe(0);

    expect(run.invoke({ signed: true, nowMs: TARGET + 45_753 })).toEqual({
      observed: true,
      reason: "SIGNED_COLLECTOR",
    });
    expect(run.store.get("t")).toEqual({ mode: "LIVE_SHADOW" });
  });

  it("post-60s recovery still works when the collector never arrives", () => {
    const run = makeRun();
    run.invoke({ signed: false, nowMs: TARGET + 45_250 });
    expect(run.store.size).toBe(0);
    expect(run.invoke({ signed: false, nowMs: TARGET + 75_000 })).toEqual({
      observed: true,
      reason: "AFTER_CEILING_RECOVERY",
    });
    expect(run.store.get("t")).toEqual({ mode: "RECOVERY" });
  });

  it("never promotes an already recorded recovery row to live", () => {
    const run = makeRun();
    run.invoke({ signed: false, nowMs: TARGET + 75_000 });
    expect(run.invoke({ signed: true, nowMs: TARGET + 80_000 })).toEqual({
      observed: false,
      reason: "DUPLICATE",
    });
    expect(run.store.get("t")).toEqual({ mode: "RECOVERY" });
  });
});
