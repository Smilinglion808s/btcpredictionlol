// Orchestrator integration regression tests.
//
// Cover the wiring that pure engine tests cannot see: build identity stamping,
// target-row protection, and the atomic resolver-attempt claim.

import { describe, expect, it, vi } from "vitest";
import { B4X4_IMPLEMENTATION_REVISION, B4X4_MODEL_VERSION } from "../config";
import { decisionToRow, resolveB4x4Row, runB4x4ForA2Combined } from "../orchestrator";
import type { B4x4Decision } from "../engine";

// Canonical source loading is exercised by the external fixture parity test;
// here the orchestrator wiring itself is under test.
vi.mock("../backfill", () => ({ loadCanonicalSourceRows: async () => [] }));


function fakeDecision(): B4x4Decision {
  return {
    decisionReason: "ABSTAIN_A2_PROBABILITY_INVALID",
    wouldTrade: false,
    finalPrediction: null,
    localDate: "2026-08-10",
  } as unknown as B4x4Decision;
}

describe("B4x4 orchestrator integration", () => {
  it("stamps implementation revision and build identity on every new row", () => {
    const row = decisionToRow(
      { predictionId: "p1", candleTs: "2026-08-10T00:00:00.000Z", probabilityGreen: null, timingStatus: null, leakageCheckPassed: null },
      fakeDecision(),
    );
    expect(row.implementation_revision).toBe(B4X4_IMPLEMENTATION_REVISION);
    expect(typeof row.build_identifier).toBe("string");
    expect(String(row.build_identifier)).toContain("b4x4-v1-runtime-integrity-r1");
    expect(row.deploy_environment).toBeTruthy();
    expect(row.model_version).toBe(B4X4_MODEL_VERSION);
  });

  it("returns the pre-existing row instead of overwriting it (target-row protection)", async () => {
    const existing = { id: "row-1", target_candle_ts: "2026-08-10T00:00:00.000Z", run_mode: "BACKFILL", would_trade: false };
    const select = vi.fn();
    const supabase = {
      from: vi.fn(() => ({
        upsert: () => ({ select: () => ({ maybeSingle: async () => ({ data: null, error: null }) }) }),
        select: (...args: unknown[]) => {
          select(...args);
          const chain: Record<string, unknown> = {};
          chain.eq = () => chain;
          chain.maybeSingle = async () => ({ data: existing });
          return chain;
        },
        insert: async () => ({}),
      })),
    } as never;

    const saved = await runB4x4ForA2Combined(supabase, {
      predictionId: "p1",
      candleTs: "2026-08-10T00:00:00.000Z",
      probabilityGreen: null,
      timingStatus: null,
      leakageCheckPassed: null,
      runMode: "BACKFILL",
    });
    expect(saved).toEqual(existing);
  });

  it("claims a resolver attempt atomically before scoring, and skips resolved rows", async () => {
    const rpc = vi.fn(async () => ({ data: { found: true, already_resolved: true, id: "row-1" }, error: null }));
    const from = vi.fn();
    await resolveB4x4Row({ rpc, from } as never, "2026-08-10T00:00:00.000Z", "GREEN");
    expect(rpc).toHaveBeenCalledWith("b4x4_begin_resolution_attempt", {
      p_target_candle_ts: "2026-08-10T00:00:00.000Z",
      p_model_version: B4X4_MODEL_VERSION,
    });
    // Already resolved: no further table access, no double scoring.
    expect(from).not.toHaveBeenCalled();
  });

  it("does nothing when no row exists for the target", async () => {
    const rpc = vi.fn(async () => ({ data: { found: false }, error: null }));
    const from = vi.fn();
    await resolveB4x4Row({ rpc, from } as never, "2026-08-10T00:00:00.000Z", "RED");
    expect(from).not.toHaveBeenCalled();
  });
});
