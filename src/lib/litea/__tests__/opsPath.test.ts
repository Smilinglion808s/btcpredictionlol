// Version 1 through the ACTUAL signed ops handler (`decision.commit`), with the
// database, the clock and the transport all replaced by in-process fakes.
// No network request and no production row is touched by this file.

import { describe, expect, it, afterEach } from "vitest";
import { runC85Op } from "@/lib/c85/ops.server";
import { LITE_A_MODEL_VERSION } from "@/lib/c85/config";
import { isModelAllowedToSend } from "@/lib/webhooks.server";

const TARGET_OPEN = "2026-09-10T18:15:00.000Z";

const admittedTarget = {
  model_version: LITE_A_MODEL_VERSION,
  ticker: "KXBTC15M-26SEP101815-T77250",
  target_open_utc: TARGET_OPEN,
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

const outboxRequest = {
  dedupe_key: `${LITE_A_MODEL_VERSION}:${admittedTarget.ticker}:${TARGET_OPEN}`,
  payload: { model: LITE_A_MODEL_VERSION, requested_by: "litea-worker" },
  expires_at: "2026-09-10T18:15:08.000Z",
};

/**
 * Minimal in-memory stand-in for the service client. Records every write and
 * serves the COMMITTED row back — that is what the dispatch path must use.
 */
function fakeDb(
  persisted?: Record<string, unknown> | null,
  opts: { ownerUpdateMatches?: boolean } = {},
) {
  const rpcCalls: any[] = [];
  const writes: Record<string, any[]> = {};
  const record = (table: string, op: string, value: unknown) => {
    (writes[table] ??= []).push({ op, value });
  };
  const matched = opts.ownerUpdateMatches !== false;
  const client: any = {
    rpc: async (name: string, args: any) => {
      rpcCalls.push({ name, args });
      if (name === "c85_litea_claim_outbox") {
        record("c85_outbox", "claim", args);
        return { data: { outcome: "CLAIMED" }, error: null };
      }
      return { data: { ok: true, target_id: "fake-target-id" }, error: null };
    },
    from: (table: string) => {
      const chain: any = {
        insert: async (value: unknown) => {
          record(table, "insert", value);
          return { error: null };
        },
        update: (value: unknown) => {
          record(table, "update", value);
          const eq: any = () => eq;
          eq.eq = eq;
          // The owner-and-PENDING conditional write reports affected rows.
          eq.select = async () => ({
            data: matched ? [{ dedupe_key: "fake-key" }] : [],
            error: null,
          });
          // Awaitable at any depth of `.eq()` chaining.
          eq.then = (resolve: any) => resolve({ error: null });
          return eq;
        },
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data: table === "c85_targets" ? (persisted ?? null) : null,
          error: null,
        }),
        then: (resolve: any) => resolve({ data: [], error: null }),
      };
      return chain;
    },
  };
  return { client, rpcCalls, writes };
}


afterEach(() => {
  delete process.env['LITEA_SERVER_EXECUTION_ENABLED'];
});

describe("decision.commit for Version 1", () => {
  it("refuses a worker outbox request while the server control is off", async () => {
    const db = fakeDb(admittedTarget);
    const out = await runC85Op(
      db.client,
      "c85-worker-amsterdam-1",
      { op: "decision.commit", target: admittedTarget, checkpoint: null, outbox: outboxRequest } as any,
      LITE_A_MODEL_VERSION,
    );
    expect(out.status).toBe(400);
    expect(String(out.result.error)).toContain("shadow-only");
    expect(db.rpcCalls).toHaveLength(0);
    expect(db.writes["c85_outbox"]).toBeUndefined();
    expect(isModelAllowedToSend(LITE_A_MODEL_VERSION)).toBe(false);
  });

  it("still records the shadow decision normally with no outbox at all", async () => {
    const db = fakeDb(admittedTarget);
    const out = await runC85Op(
      db.client,
      "c85-worker-amsterdam-1",
      { op: "decision.commit", target: admittedTarget, checkpoint: null } as any,
      LITE_A_MODEL_VERSION,
    );
    expect(out.status).toBe(200);
    expect(out.result.dispatch).toBeUndefined();
    expect(db.rpcCalls[0].args.p_outbox).toBeNull();
    expect(db.writes["c85_outbox"]).toBeUndefined();
  });

  it("with the control on: durable first, then one claim and the send attempt", async () => {
    process.env['LITEA_SERVER_EXECUTION_ENABLED'] = "true";
    expect(isModelAllowedToSend(LITE_A_MODEL_VERSION)).toBe(true);
    const fresh = { ...admittedTarget, target_open_utc: new Date(Date.now() - 6_000).toISOString() };
    const db = fakeDb(fresh);
    const out = await runC85Op(
      db.client,
      "c85-worker-amsterdam-1",
      { op: "decision.commit", target: fresh, checkpoint: null, outbox: outboxRequest } as any,
      LITE_A_MODEL_VERSION,
    );
    expect(out.status).toBe(200);
    // The decision is durable through the same transactional RPC as always,
    // and the Version 1 dispatch is a SEPARATE step afterwards.
    expect(db.rpcCalls[0].name).toBe("c85_commit_decision");
    expect(db.rpcCalls[0].args.p_outbox).toBeNull();
    // Exactly one exclusive claim, keyed on the stable event identity.
    const claims = db.writes["c85_outbox"].filter((w) => w.op === "claim");
    expect(claims).toHaveLength(1);
    expect(String(claims[0].value.p_owner)).toContain("litea-dispatch-");
    // No endpoint exists in this fake, so nothing was accepted anywhere.
    expect(out.result.dispatch).toBe("FAILED");
  });

  it("delivers from the committed record, never from an altered replay body", async () => {
    process.env['LITEA_SERVER_EXECUTION_ENABLED'] = "true";
    const committed = {
      ...admittedTarget,
      target_open_utc: new Date(Date.now() - 6_000).toISOString(),
    };
    const db = fakeDb(committed);
    // The wire body claims the opposite side; the persisted record wins.
    await runC85Op(
      db.client,
      "c85-worker-amsterdam-1",
      {
        op: "decision.commit",
        target: { ...committed, final_side: -1 },
        checkpoint: null,
        outbox: outboxRequest,
      } as any,
      LITE_A_MODEL_VERSION,
    );
    const claim = db.writes["c85_outbox"].find((w) => w.op === "claim");
    expect(claim.value.p_payload.direction).toBe("GREEN");
    expect(claim.value.p_payload.prediction).toBe("YES");
  });

  it("does not dispatch when the committed record cannot be read back", async () => {
    process.env['LITEA_SERVER_EXECUTION_ENABLED'] = "true";
    const db = fakeDb(null);
    const out = await runC85Op(
      db.client,
      "c85-worker-amsterdam-1",
      { op: "decision.commit", target: admittedTarget, checkpoint: null, outbox: outboxRequest } as any,
      LITE_A_MODEL_VERSION,
    );
    expect(out.result.dispatch).toBe("NO_PERSISTED_RECORD");
    expect(db.writes["c85_outbox"]).toBeUndefined();
  });

  it("never dispatches an old shadow row even with the control on", async () => {
    process.env['LITEA_SERVER_EXECUTION_ENABLED'] = "true";
    const stale = { ...admittedTarget, target_open_utc: new Date(Date.now() - 86_400_000).toISOString() };
    const db = fakeDb(stale);
    const out = await runC85Op(
      db.client,
      "c85-worker-amsterdam-1",
      { op: "decision.commit", target: stale, checkpoint: null, outbox: outboxRequest } as any,
      LITE_A_MODEL_VERSION,
    );
    expect(out.result.dispatch).toBe("EXPIRED");
    expect(db.writes["c85_outbox"]).toBeUndefined();
  });

  it("leaves C85 identities exactly as they were", async () => {
    process.env['LITEA_SERVER_EXECUTION_ENABLED'] = "true";
    const db = fakeDb(admittedTarget);
    const out = await runC85Op(
      db.client,
      "c85-worker-1",
      {
        op: "decision.commit",
        target: { ...admittedTarget, model_version: "c85-multi-meta-r1" },
        checkpoint: null,
        outbox: outboxRequest,
      } as any,
      "c85-multi-meta-r1",
    );
    // C85 keeps its own transactional outbox path and gains no Version 1 step.
    expect(db.rpcCalls[0].args.p_outbox).toEqual(outboxRequest);
    expect(out.result.dispatch).toBeUndefined();
    expect(isModelAllowedToSend("c85-multi-meta-r1")).toBe(false);
    expect(isModelAllowedToSend("t45-priceflow")).toBe(true);
  });
});
