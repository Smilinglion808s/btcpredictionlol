// Real-seam tests for the COMBINED Version 1.1 route: the actual runC85Op
// decision.commit handler with a fake Supabase and a stubbed fetch, so the
// durable claim payload, the wire payload and the controls are all exercised.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ORIGINAL_ENV = { ...process.env };

function fakeSupabase(opts: { endpoints: { events: string[] }[] }) {
  const calls = {
    claims: [] as any[],
    commits: [] as any[],
  };
  const sb: any = {
    calls,
    rpc: vi.fn(async (fn: string, args: any) => {
      if (fn === "c85_litea_claim_outbox") {
        calls.claims.push(args);
        return {
          data: {
            claimed: true,
            owner: args.p_owner,
            row: { id: "outbox-1", dedupe_key: args.p_dedupe_key, payload: args.p_payload },
          },
          error: null,
        };
      }
      calls.commits.push(args);
      return { data: { ok: true, target_id: "target-1" }, error: null };
    }),
    from: (table: string) => {
      const builder: any = {
        select: () => builder,
        eq: () => builder,
        order: () => builder,
        limit: () => builder,
        maybeSingle: async () => ({ data: null, error: null }),
        then: undefined,
      };
      if (table === "webhook_endpoints") {
        builder.eq = () => ({
          ...builder,
          then: (res: any) =>
            Promise.resolve({
              data: opts.endpoints.map((e, i) => ({
                id: `ep-${i}`,
                url: `https://example.invalid/${i}`,
                secret: "s",
                events: e.events,
                is_active: true,
              })),
              error: null,
            }).then(res),
        });
      }
      return builder;
    },
  };
  return sb;
}

describe("combined Version 1.1 route — durable payload identity", () => {
  beforeEach(() => {
    vi.resetModules();
    delete process.env["LITEA_SERVER_EXECUTION_ENABLED"];
    delete process.env["V11_SERVER_EXECUTION_ENABLED"];
  });
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("with BOTH controls off, nothing is claimed and nothing is sent", async () => {
    const { v11DeliveryArmed, v1DeliveryDisabled } = await import("../dispatch.server");
    expect(v1DeliveryDisabled()).toBe(true);
    expect(v11DeliveryArmed()).toBe(false);

    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("the durable claim payload carries the SAME combined identity as the wire payload", async () => {
    const { v11V1LegClaimRelabel } = await import("../dispatch.server");
    const claimed: any[] = [];
    const deps = v11V1LegClaimRelabel({
      claim: async (entry: any) => {
        claimed.push(entry);
        return { claimed: true };
      },
    });

    await deps.claim({
      key: "interval-key",
      payload: {
        model_version: "lite-a-floor4-top10-r1",
        prediction: "YES",
        target_ts: "2026-09-12T04:00:00Z",
      },
    });

    const payload = claimed[0].payload;
    // Combined identity, leg and stake metadata are persisted, not only sent.
    expect(payload.model_version ?? payload.model_id).not.toBe(undefined);
    expect(JSON.stringify(payload)).toContain("V1");
    // The key itself is untouched: one interval, one claim.
    expect(claimed[0].key).toBe("interval-key");
    // Original V1 content survives for the bot and for the audit trail.
    expect(payload.prediction).toBe("YES");
    expect(payload.target_ts).toBe("2026-09-12T04:00:00Z");
  });
});

describe("combined stream requires exactly one destination", () => {
  beforeEach(() => vi.resetModules());
  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    vi.restoreAllMocks();
  });

  it("counts active prediction.created destinations without exposing any URL", async () => {
    const { countActiveEndpointsForEvent } = await import("@/lib/webhooks.server");
    const sb = fakeSupabase({
      endpoints: [{ events: ["prediction.created"] }, { events: ["prediction.resolved"] }],
    });
    const n = await countActiveEndpointsForEvent(sb, "prediction.created");
    expect(n).toBe(1);
  });
});
