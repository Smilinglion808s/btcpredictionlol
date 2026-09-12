// The COMBINED Version 1.1 route through the ACTUAL signed ops handler
// (`runC85Op`, op `decision.commit`) — the real dispatch adapter, the real
// claim seam and the real transport, with only the database and the HTTP call
// replaced by in-process fakes. Nothing here reaches a network or a production
// row, and no control is left switched on after a test.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LITE_A_MODEL_VERSION } from "@/lib/c85/config";
import {
  V11_CANDIDATE_VERSION,
  V11_MODEL_VERSION,
  V11_POLICY_VERSION,
  V11_STAKE_FRACTION_OF_BOISE_OPEN,
} from "@/lib/v11/config";

const ORIGINAL_ENV = { ...process.env };

const TICKER = "KXBTC15M-26SEP101815-T77250";

/** The committed ORIGINAL V1 row: LIVE, admitted, head present, inputs valid. */
function admittedTarget(targetOpenUtc: string) {
  return {
    model_version: LITE_A_MODEL_VERSION,
    ticker: TICKER,
    target_open_utc: targetOpenUtc,
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

function outboxRequest(targetOpenUtc: string) {
  return {
    dedupe_key: `${LITE_A_MODEL_VERSION}:${TICKER}:${targetOpenUtc}`,
    payload: { model: LITE_A_MODEL_VERSION, requested_by: "litea-worker" },
    expires_at: new Date(Date.parse(targetOpenUtc) + 8_000).toISOString(),
  };
}

/**
 * In-memory service client: records every write, serves the committed row back
 * and exposes however many active `prediction.created` endpoints a test wants.
 */
function fakeDb(
  persisted: Record<string, unknown> | null,
  opts: { endpoints?: number } = {},
) {
  const rpcCalls: { name: string; args: any }[] = [];
  const writes: Record<string, { op: string; value: any }[]> = {};
  const record = (table: string, op: string, value: unknown) => {
    (writes[table] ??= []).push({ op, value });
  };
  const endpoints = Array.from({ length: opts.endpoints ?? 1 }, (_, i) => ({
    id: `ep-${i}`,
    url: `http://127.0.0.1:1/in-process-receiver/${i}`,
    secret: "test-secret",
    events: ["prediction.created"],
    is_active: true,
  }));
  // The durable outbox row the claim RPC creates, served back to the real
  // ownership guard exactly as the production table would.
  let claimed: { state: string; claim_owner: string; claim_expires_at: string } | null = null;
  const client: any = {
    rpc: async (name: string, args: any) => {
      rpcCalls.push({ name, args });
      if (name === "c85_litea_claim_outbox") {
        record("c85_outbox", "claim", args);
        claimed = {
          state: "PENDING",
          claim_owner: String(args.p_owner),
          claim_expires_at: new Date(Date.now() + 30_000).toISOString(),
        };
        // The real RPC returns an outcome, never a `claimed` boolean.
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
          eq.select = async () => ({ data: [{ dedupe_key: "fake-key" }], error: null });
          eq.then = (resolve: any) => resolve({ error: null });
          return eq;
        },
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => ({
          data:
            table === "c85_targets" ? persisted : table === "c85_outbox" ? claimed : null,
          error: null,
        }),
        then: (resolve: any) =>
          resolve({ data: table === "webhook_endpoints" ? endpoints : [], error: null }),
      };
      return chain;
    },
  };
  return { client, rpcCalls, writes };
}

/** Fresh modules per test so the endpoint cache and env reads never leak. */
async function load() {
  vi.resetModules();
  const ops = await import("@/lib/c85/ops.server");
  const webhooks = await import("@/lib/webhooks.server");
  return { runC85Op: ops.runC85Op, webhooks };
}

function commit(openUtc: string) {
  return {
    op: "decision.commit",
    target: admittedTarget(openUtc),
    checkpoint: null,
    outbox: outboxRequest(openUtc),
  } as any;
}

beforeEach(() => {
  delete process.env['LITEA_SERVER_EXECUTION_ENABLED'];
  delete process.env['V11_SERVER_EXECUTION_ENABLED'];
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("combined Version 1.1 route through the real decision.commit handler", () => {
  it("with BOTH controls off: the decision commits, nothing is claimed, nothing is sent", async () => {
    const { runC85Op, webhooks } = await load();
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", async (...a: unknown[]) => {
      posts.push(a);
      throw new Error("no HTTP is permitted here");
    });
    const openUtc = new Date(Date.now() - 6_500).toISOString();
    const db = fakeDb(admittedTarget(openUtc));

    const out = await runC85Op(db.client, "c85-worker-1", commit(openUtc), LITE_A_MODEL_VERSION);

    expect(out.status).toBe(200);
    expect(out.result.dispatch).toBe("EXECUTION_DISABLED");
    // The worker's outbox request is dropped from the transaction, not honoured.
    expect(db.rpcCalls).toHaveLength(1);
    expect(db.rpcCalls[0]?.name).toBe("c85_commit_decision");
    expect(db.rpcCalls[0]?.args?.p_outbox ?? null).toBeNull();
    expect(db.writes["c85_outbox"]).toBeUndefined();
    expect(posts).toHaveLength(0);
    expect(webhooks.isModelAllowedToSend(LITE_A_MODEL_VERSION)).toBe(false);
    expect(webhooks.isModelAllowedToSend(V11_MODEL_VERSION)).toBe(false);
  });

  it("armed V1.1 only: one claim and one attempt, with the SAME combined identity durable and on the wire", async () => {
    process.env['V11_SERVER_EXECUTION_ENABLED'] = "true";
    const { runC85Op } = await load();
    const posts: { url: string; body: any }[] = [];
    vi.stubGlobal("fetch", async (url: string, init: any) => {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      return new Response(JSON.stringify({ received: true }), { status: 200 });
    });
    // T+6500ms: inside the original Version 1 8s transport ceiling.
    const openMs = Date.now() - 6_500;
    const openUtc = new Date(openMs).toISOString();
    const db = fakeDb(admittedTarget(openUtc));

    const out = await runC85Op(db.client, "c85-worker-1", commit(openUtc), LITE_A_MODEL_VERSION);

    expect(out.status).toBe(200);
    expect(out.result.dispatch).toBe("SENT");
    expect(out.result.dispatch_route).toBe("V11_COMBINED_V1_LEG");

    // Exactly one exclusive claim on the canonical Version 1 interval key.
    const claims = db.writes["c85_outbox"].filter((w) => w.op === "claim");
    expect(claims).toHaveLength(1);
    expect(claims[0].value.p_dedupe_key).toBe(
      `${LITE_A_MODEL_VERSION}:${TICKER}:${openUtc}`,
    );
    // Exactly one automatic outbound attempt for the interval.
    expect(posts).toHaveLength(1);

    const durable = claims[0].value.p_payload;
    console.log("DBGKEYS", JSON.stringify(posts[0].body));
    const wire = posts[0].body;
    for (const payload of [durable, wire]) {
      // Combined identity — the durable row says exactly what went on the wire.
      expect(payload.model).toBe(V11_MODEL_VERSION);
      expect(payload.model_version).toBe(V11_MODEL_VERSION);
      expect(payload.candidate_version).toBe(V11_CANDIDATE_VERSION);
      expect(payload.decision_policy_version).toBe(V11_POLICY_VERSION);
      expect(payload.leg).toBe("V1");
      // Source identity and the original decision content are unchanged.
      expect(payload.source_model_version).toBe(LITE_A_MODEL_VERSION);
      expect(payload.market_ticker).toBe(TICKER);
      expect(payload.direction).toBe("GREEN");
      expect(payload.prediction).toBe("YES");
      expect(payload.probability).toBeCloseTo(0.6412, 6);
      expect(payload.strike).toBe(77250);
      // Stake metadata; the external bot still owns sizing and execution.
      expect(payload.stake_fraction_of_boise_day_opening_principal).toBe(
        V11_STAKE_FRACTION_OF_BOISE_OPEN,
      );
      expect(payload.sizing_owner).toBe("external-betting-bot");
    }
  });

  it("refuses to transmit when ZERO active destinations are configured", async () => {
    process.env['V11_SERVER_EXECUTION_ENABLED'] = "true";
    const { runC85Op } = await load();
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", async (...a: unknown[]) => {
      posts.push(a);
      return new Response("{}", { status: 200 });
    });
    const openUtc = new Date(Date.now() - 6_500).toISOString();
    const db = fakeDb(admittedTarget(openUtc), { endpoints: 0 });

    const out = await runC85Op(db.client, "c85-worker-1", commit(openUtc), LITE_A_MODEL_VERSION);

    expect(out.result.dispatch).not.toBe("SENT");
    expect(posts).toHaveLength(0);
  });

  it("refuses to transmit when SEVERAL active destinations are configured", async () => {
    process.env['V11_SERVER_EXECUTION_ENABLED'] = "true";
    const { runC85Op } = await load();
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", async (...a: unknown[]) => {
      posts.push(a);
      return new Response("{}", { status: 200 });
    });
    const openUtc = new Date(Date.now() - 6_500).toISOString();
    const db = fakeDb(admittedTarget(openUtc), { endpoints: 2 });

    const out = await runC85Op(db.client, "c85-worker-1", commit(openUtc), LITE_A_MODEL_VERSION);

    // Two destinations would mean two bets for one interval: fail closed.
    expect(out.result.dispatch).not.toBe("SENT");
    expect(posts).toHaveLength(0);
  });

  it("never transmits past the original Version 1 transport ceiling", async () => {
    process.env['V11_SERVER_EXECUTION_ENABLED'] = "true";
    const { runC85Op } = await load();
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", async (...a: unknown[]) => {
      posts.push(a);
      return new Response("{}", { status: 200 });
    });
    // Well past the 8s ceiling measured from the target open.
    const openUtc = new Date(Date.now() - 30_000).toISOString();
    const db = fakeDb(admittedTarget(openUtc));

    const out = await runC85Op(db.client, "c85-worker-1", commit(openUtc), LITE_A_MODEL_VERSION);

    expect(out.result.dispatch).toBe("EXPIRED");
    expect(db.writes["c85_outbox"]).toBeUndefined();
    expect(posts).toHaveLength(0);
  });

  it("stays off when the ORIGINAL Version 1 sender is also switched on", async () => {
    process.env['V11_SERVER_EXECUTION_ENABLED'] = "true";
    process.env['LITEA_SERVER_EXECUTION_ENABLED'] = "true";
    const { runC85Op, webhooks } = await load();
    const posts: unknown[] = [];
    vi.stubGlobal("fetch", async (...a: unknown[]) => {
      posts.push(a);
      return new Response("{}", { status: 200 });
    });
    const openUtc = new Date(Date.now() - 6_500).toISOString();
    const db = fakeDb(admittedTarget(openUtc));

    const out = await runC85Op(db.client, "c85-worker-1", commit(openUtc), LITE_A_MODEL_VERSION);

    // The two legs are mutually exclusive: the combined identity cannot send.
    expect(webhooks.isModelAllowedToSend(V11_MODEL_VERSION)).toBe(false);
    expect(out.result.dispatch_route).not.toBe("V11_COMBINED_V1_LEG");
    expect(posts.length).toBeLessThanOrEqual(1);
  });
});
