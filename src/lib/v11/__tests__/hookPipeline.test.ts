// The fallback leg is timed against the interval open. Legacy T45 work on the
// same hook must never be able to push an eligible dispatch past the ceiling.

import { describe, expect, it } from "vitest";
import { v11ObserveAndDispatch } from "../hookPipeline";

const at = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("Version 1.1 boundary pipeline", () => {
  it("dispatches as soon as the observation commits, even while legacy work is held past the ceiling", async () => {
    // Simulated timeline, scaled 1000:1 (48s -> 48ms, 60s -> 60ms).
    const t0 = Date.now();
    let dispatchedAt = -1;
    let legacyFinishedAt = -1;

    // Legacy T45 legs: still running well past the 60s ceiling.
    const legacy = at(90).then(() => {
      legacyFinishedAt = Date.now() - t0;
    });

    const pipeline = v11ObserveAndDispatch(
      async () => {
        await at(46); // observation commits at ~46
        return { commit: { committed: true } };
      },
      async () => {
        dispatchedAt = Date.now() - t0;
        return { verdict: "WOULD_SEND" };
      },
    );

    // The handler awaits BOTH, exactly as the hook does.
    await legacy;
    const out = await pipeline;

    expect(out.dispatch).toEqual({ verdict: "WOULD_SEND" });
    expect(dispatchedAt).toBeGreaterThanOrEqual(0);
    // Dispatched inside the (scaled) 60s ceiling...
    expect(dispatchedAt).toBeLessThan(60);
    // ...and strictly before the legacy work finished.
    expect(dispatchedAt).toBeLessThan(legacyFinishedAt);
  });

  it("still returns the observation alongside the dispatch verdict", async () => {
    const out = await v11ObserveAndDispatch(
      async () => ({ ok: true }),
      async () => ({ verdict: "EXECUTION_DISABLED" }),
    );
    expect(out.observation).toEqual({ ok: true });
    expect(out.dispatch).toEqual({ verdict: "EXECUTION_DISABLED" });
  });

  it("never dispatches when the observation itself failed", async () => {
    let called = 0;
    const out = await v11ObserveAndDispatch(
      async () => {
        throw new Error("observer blew up");
      },
      async () => {
        called++;
        return { verdict: "WOULD_SEND" };
      },
    );
    expect(called).toBe(0);
    expect((out.observation as { error: string }).error).toContain("observer blew up");
    expect((out.dispatch as { verdict: string }).verdict).toBe("NO_FRESH_COMMIT");
  });

  it("a thrown dispatch cannot break the hook response", async () => {
    const out = await v11ObserveAndDispatch(
      async () => ({ ok: true }),
      async () => {
        throw new Error("claim rpc down");
      },
    );
    expect((out.dispatch as { verdict: string }).verdict).toBe("ERROR");
  });
});
