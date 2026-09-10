// Version 1 duplicate-send protection, proven against an IN-PROCESS receiver.
// No network call, no real endpoint, no production write. Every execution
// control stays absent/false except where a test sets it on itself.

import { afterEach, describe, expect, it } from "vitest";
import {
  dispatchLiteaDecision,
  type LiteAClaimOutcome,
  type LiteADispatchDeps,
  type LiteADecisionRecord,
} from "../dispatch.server";
import { LITE_A_MODEL_VERSION } from "@/lib/c85/config";

const DEADLINE = 8_000;

function liveRow(openMs: number): LiteADecisionRecord {
  return {
    model_version: LITE_A_MODEL_VERSION,
    ticker: "KXBTC15M-26SEP101815-T77250",
    target_open_utc: new Date(openMs).toISOString(),
    run_mode: "LIVE",
    status: "ORDINARY_CALL",
    final_side: 1,
    probability_yes: 0.6412,
    admission_rank: 0.981,
    publication_offset_ms: 6120,
    features: {
      input_valid: true,
      lite_a: { head_id: "litea-head-2026-09-10" },
      strike_policy: { value: 77250, source: "official", estimated: false },
    },
  };
}

/**
 * One shared in-memory outbox plus a local receiver, behaving like the
 * prepared claim RPC: exactly one owner per key.
 */
function harness(opts: { failFirst?: boolean; ambiguous?: boolean } = {}) {
  const received: Record<string, unknown>[] = [];
  const attempts: string[] = [];
  const rows = new Map<string, { state: string; owner: string | null; until: number }>();
  let now = Date.now();

  const deps: LiteADispatchDeps = {
    now: () => now,
    async claim(entry): Promise<{ outcome: LiteAClaimOutcome }> {
      const existing = rows.get(entry.dedupeKey);
      const until = new Date(entry.expiresAt).getTime();
      if (!existing) {
        rows.set(entry.dedupeKey, { state: "PENDING", owner: entry.owner, until });
        return { outcome: "CLAIMED" };
      }
      if (existing.state === "SENT") return { outcome: "ALREADY_SENT" };
      if (existing.state !== "PENDING") return { outcome: "TERMINAL" };
      if (existing.owner === entry.owner && existing.until > now) return { outcome: "CLAIMED" };
      if (existing.until > now) return { outcome: "HELD_BY_OTHER" };
      return { outcome: "AMBIGUOUS" };
    },
    async ownsClaim(key, owner) {
      const row = rows.get(key);
      return !!row && row.state === "PENDING" && row.owner === owner && row.until > now;
    },
    async deliver(payload, guard) {
      // Every real attempt re-checks the guard immediately before transport.
      attempts.push("attempt");
      if (!(await guard())) return { delivered: 0 };
      if (opts.ambiguous) throw new Error("socket hang up");
      if (opts.failFirst) return { delivered: 0 };
      received.push(payload);
      return { delivered: 1 };
    },
    async settle(entry) {
      const row = rows.get(entry.dedupeKey);
      if (!row || row.owner !== entry.owner) return; // only the owner settles
      row.state = entry.status;
      row.owner = null;
    },
  };

  return {
    deps,
    received,
    attempts,
    rows,
    advance: (ms: number) => {
      now += ms;
    },
  };
}

const ON = {
  executionEnabled: true,
  allowedModels: new Set([LITE_A_MODEL_VERSION]),
  transportDeadlineMs: DEADLINE,
  targetId: "fake-target-id",
};

afterEach(() => {
  delete process.env['LITEA_SERVER_EXECUTION_ENABLED'];
});

describe("Version 1 duplicate-send protection", () => {
  it("sends nothing at all with the controls at their defaults", async () => {
    const h = harness();
    const out = await dispatchLiteaDecision(h.deps, liveRow(Date.now() - 6_000), {
      ...ON,
      executionEnabled: false,
      allowedModels: new Set<string>(),
    });
    expect(out.verdict).toBe("EXECUTION_DISABLED");
    expect(h.attempts).toHaveLength(0);
    expect(h.received).toHaveLength(0);
    expect(h.rows.size).toBe(0);
  });

  it("gives two concurrent same-key requests exactly one delivery", async () => {
    process.env['LITEA_SERVER_EXECUTION_ENABLED'] = "true";
    const h = harness();
    const row = liveRow(Date.now() - 6_000);
    const [a, b] = await Promise.all([
      dispatchLiteaDecision(h.deps, row, ON),
      dispatchLiteaDecision(h.deps, row, ON),
    ]);
    const verdicts = [a.verdict, b.verdict].sort();
    expect(verdicts).toEqual(["NOT_CLAIM_OWNER", "SENT"]);
    expect(h.received).toHaveLength(1);
    expect(a.dedupeKey).toBe(b.dedupeKey);
  });

  it("refuses a replay of a terminal entry", async () => {
    process.env['LITEA_SERVER_EXECUTION_ENABLED'] = "true";
    const h = harness();
    const row = liveRow(Date.now() - 6_000);
    expect((await dispatchLiteaDecision(h.deps, row, ON)).verdict).toBe("SENT");
    const replay = await dispatchLiteaDecision(h.deps, row, ON);
    expect(replay.verdict).toBe("ALREADY_SENT");
    expect(h.received).toHaveLength(1);
  });

  it("cancels the attempt when the deadline lapses while waiting", async () => {
    process.env['LITEA_SERVER_EXECUTION_ENABLED'] = "true";
    const h = harness();
    const row = liveRow(Date.now() - 7_900);
    h.advance(200); // now past the 8000 ms ceiling
    const out = await dispatchLiteaDecision(h.deps, row, ON);
    expect(out.verdict).toBe("EXPIRED");
    expect(h.received).toHaveLength(0);
  });

  it("cancels at the transport when the kill switch flips between checks", async () => {
    process.env['LITEA_SERVER_EXECUTION_ENABLED'] = "true";
    const h = harness();
    const row = liveRow(Date.now() - 6_000);
    // The guard reads the live switch, so disabling it here is seen by the
    // check that runs immediately before the send.
    const deps: LiteADispatchDeps = {
      ...h.deps,
      deliver: async (payload, guard) => {
        delete process.env['LITEA_SERVER_EXECUTION_ENABLED'];
        return h.deps.deliver(payload, guard);
      },
    };
    const out = await dispatchLiteaDecision(deps, row, ON);
    expect(out.verdict).toBe("FAILED");
    expect(h.received).toHaveLength(0);
  });

  it("treats an ambiguous first delivery as possibly sent and never re-sends", async () => {
    process.env['LITEA_SERVER_EXECUTION_ENABLED'] = "true";
    const h = harness({ ambiguous: true });
    const row = liveRow(Date.now() - 6_000);
    await expect(dispatchLiteaDecision(h.deps, row, ON)).rejects.toThrow();
    // The claim was taken before the attempt, so a competing caller is refused
    // rather than issuing a second signal.
    const second = await dispatchLiteaDecision(h.deps, row, ON);
    expect(second.verdict).toBe("NOT_CLAIM_OWNER");
    expect(second.claim).toBe("HELD_BY_OTHER");
    expect(h.received).toHaveLength(0);
  });

  it("only the claim owner may write the terminal state", async () => {
    process.env['LITEA_SERVER_EXECUTION_ENABLED'] = "true";
    const h = harness();
    const row = liveRow(Date.now() - 6_000);
    await dispatchLiteaDecision(h.deps, row, ON);
    await h.deps.settle({
      dedupeKey: [...h.rows.keys()][0],
      owner: "someone-else",
      targetId: null,
      status: "FAILED",
      error: "x",
      publicationOffsetMs: null,
    });
    expect([...h.rows.values()][0].state).toBe("SENT");
  });
});
