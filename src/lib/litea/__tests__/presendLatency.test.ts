// Version 1 PRE-SEND latency patch — isolated before/after evidence.
//
// Runs the GENUINE commit-side dispatch (`dispatchLiteaDecision`) and the
// GENUINE transport (`deliverWebhookNow` -> `fetch`) against instrumented,
// deliberately slowed fake dependencies and an in-process receiver. No network,
// no endpoint, no production write, no execution switch changed.
//
// "Pre-fetch elapsed" below is simulated: the delays are fixed per awaited
// dependency (LAT_MS each), so the numbers measure how many sequential awaited
// round trips remain before `fetch()` is invoked — not live production latency.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LITE_A_MODEL_VERSION } from "@/lib/c85/config";

const LAT_MS = 40; // stand-in cost of one awaited dependency round trip
const TARGET = "2026-09-11T21:15:00.000Z";
const OPEN_MS = Date.parse(TARGET);

const ROW = {
  model_version: LITE_A_MODEL_VERSION,
  ticker: "KXBTC15M-26SEP112115-T77250",
  target_open_utc: TARGET,
  run_mode: "LIVE",
  status: "ORDINARY_CALL",
  final_side: 1,
  probability_yes: 0.71,
  admission_rank: 0.66,
  publication_offset_ms: 5180,
  packet_freeze_ns: "1",
  decision_durable_ns: "2",
  features: {
    input_valid: true,
    lite_a: { head_id: "litea-head-2026-09-11" },
    strike_policy: { value: 77250, source: "official", estimated: false },
  },
};

const ENDPOINT = {
  id: "ep-local",
  url: "http://127.0.0.1:1/in-process-receiver",
  secret: "test-secret",
  events: ["prediction.created"],
  is_active: true,
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Trace {
  posts: { body: string; atMs: number }[];
  endpointReads: number;
  ownsCalls: number;
  claims: number;
  deliveryInserts: any[];
}

function fakeSupabase(trace: Trace) {
  return {
    from(table: string) {
      if (table === "webhook_endpoints") {
        const chain: any = {
          select: () => chain,
          eq: async () => {
            trace.endpointReads += 1;
            await sleep(LAT_MS); // an endpoint read costs a real round trip
            return { data: [ENDPOINT], error: null };
          },
          update: () => ({ eq: async () => ({ error: null }) }),
        };
        return chain;
      }
      const chain: any = {
        insert: async (v: any) => {
          trace.deliveryInserts.push(v);
          return { error: null };
        },
        update: () => chain,
        eq: () => chain,
        select: async () => ({ data: [{ dedupe_key: "x" }], error: null }),
      };
      return chain;
    },
  } as any;
}

function makeDeps(mod: any, supabase: any, trace: Trace, over: Partial<any> = {}) {
  return {
    now: () => Date.now(),
    async claim() {
      trace.claims += 1;
      await sleep(LAT_MS);
      return { outcome: "CLAIMED" as const };
    },
    async ownsClaim() {
      trace.ownsCalls += 1;
      await sleep(LAT_MS);
      return true;
    },
    isEnabledNow: () => true,
    allowedNow: () => new Set([LITE_A_MODEL_VERSION]),
    async deliver(payload: Record<string, unknown>, guard: () => Promise<boolean>) {
      const d = await mod.wh.deliverWebhookNow(supabase, "prediction.created", payload, {
        guard,
        maxAttempts: 1,
        targetOpenMs: OPEN_MS,
      });
      await d.settle;
      return { delivered: d.delivered, sendStartedAtMs: d.sendStartedAtMs };
    },
    async settle() {
      await sleep(LAT_MS);
      return { applied: true };
    },
    ...over,
  };
}

async function loadFresh() {
  vi.resetModules();
  const wh = await import("@/lib/webhooks.server");
  const dispatch = await import("@/lib/litea/dispatch.server");
  return { wh, dispatch };
}

function run(mod: any, deps: any, row: any = ROW, over: Partial<any> = {}) {
  return mod.dispatch.dispatchLiteaDecision(deps, row, {
    targetId: "11111111-1111-1111-1111-111111111111",
    executionEnabled: true,
    allowedModels: new Set([LITE_A_MODEL_VERSION]),
    transportDeadlineMs: 8000,
    ...over,
  });
}

let trace: Trace;

beforeEach(() => {
  trace = { posts: [], endpointReads: 0, ownsCalls: 0, claims: 0, deliveryInserts: [] };
  process.env['LITEA_SERVER_EXECUTION_ENABLED'] = "true";
  // The fixture target is a fixed instant; run the clock just after its open so
  // the ORIGINAL 8 s ceiling is live rather than long past.
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(new Date(OPEN_MS + 5_200));
  vi.stubGlobal("fetch", async (_url: string, init: any) => {
    trace.posts.push({ body: String(init?.body ?? ""), atMs: Date.now() });
    return new Response("ok", { status: 200 });
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  delete process.env['LITEA_SERVER_EXECUTION_ENABLED'];
});

describe("Version 1 pre-send path", () => {
  it("cold instance: one claim, ONE ownership read, one endpoint read", async () => {
    const mod = await loadFresh();
    const supabase = fakeSupabase(trace);
    const t0 = Date.now();
    const out = await run(mod, makeDeps(mod, supabase, trace));
    const preFetchMs = trace.posts[0].atMs - t0;

    expect(out.verdict).toBe("SENT");
    expect(trace.claims).toBe(1);
    expect(trace.ownsCalls).toBe(1); // was 2 before this patch
    expect(trace.endpointReads).toBe(1);
    // claim + endpoints + final ownership = 3 sequential round trips.
    expect(preFetchMs).toBeLessThan(4 * LAT_MS + 60);
    console.info(
      `[cold] pre-fetch ${preFetchMs}ms, awaited deps=3 (claim, endpoints, ownership)`,
    );
  });

  it("warm endpoint cache: no endpoint read at send time", async () => {
    const mod = await loadFresh();
    const supabase = fakeSupabase(trace);
    await mod.wh.primeWebhookEndpoints(supabase, true); // the pre-boundary warm
    trace.endpointReads = 0;

    const t0 = Date.now();
    const out = await run(mod, makeDeps(mod, supabase, trace));
    const preFetchMs = trace.posts[0].atMs - t0;

    expect(out.verdict).toBe("SENT");
    expect(trace.endpointReads).toBe(0);
    expect(trace.ownsCalls).toBe(1);
    // claim + ownership only.
    expect(preFetchMs).toBeLessThan(3 * LAT_MS + 60);
    console.info(`[warm] pre-fetch ${preFetchMs}ms, awaited deps=2 (claim, ownership)`);
  });

  it("records an attempt-start timestamp taken at fetch invocation", async () => {
    const mod = await loadFresh();
    const supabase = fakeSupabase(trace);
    await mod.wh.primeWebhookEndpoints(supabase, true);
    const out = await run(mod, makeDeps(mod, supabase, trace));

    const insert = trace.deliveryInserts[0];
    expect(insert.attempt).toBe(1);
    const started = Date.parse(insert.attempt_started_at);
    expect(Math.abs(started - trace.posts[0].atMs)).toBeLessThanOrEqual(5);
    expect(insert.attempt_start_offset_ms).toBe(started - OPEN_MS);
    // Distinct from message-built time (payload.sent_at) and model completion.
    expect(out.sendStartedAtMs).toBe(started);
    expect(out.sendStartOffsetMs).toBe(started - OPEN_MS);
    expect(Date.parse(JSON.parse(trace.posts[0].body).sent_at)).toBeLessThanOrEqual(started);
  });

  it("emits an identical body to the pre-patch payload contract", async () => {
    const mod = await loadFresh();
    const supabase = fakeSupabase(trace);
    await mod.wh.primeWebhookEndpoints(supabase, true);
    await run(mod, makeDeps(mod, supabase, trace));

    const body = JSON.parse(trace.posts[0].body);
    const expected = mod.dispatch.liteaPayloadFromRecord(ROW);
    expect(Object.keys(body).sort()).toEqual(["event", ...Object.keys(expected)].sort());
    expect(body.event).toBe("prediction.created");
    expect(body.model).toBe(LITE_A_MODEL_VERSION);
    expect(body.prediction).toBe("YES");
    expect(body.dedupe_key).toBe(expected.dedupe_key);
    expect(body.market_ticker).toBe(ROW.ticker);
    expect(body.strike).toBe(77250);
  });

  it("the ORIGINAL expiry is still enforced after the last awaited lookup", async () => {
    const mod = await loadFresh();
    const supabase = fakeSupabase(trace);
    await mod.wh.primeWebhookEndpoints(supabase, true);
    // Ownership resolves only after the original 8 s ceiling has passed.
    const deps = makeDeps(mod, supabase, trace, {
      async ownsClaim() {
        trace.ownsCalls += 1;
        await sleep(LAT_MS);
        vi.setSystemTime(new Date(OPEN_MS + 9_000));
        return true;
      },
    });
    vi.setSystemTime(new Date(OPEN_MS + 5_500));
    const out = await run(mod, deps);

    expect(trace.posts).toHaveLength(0);
    expect(out.delivered).toBe(0);
  });

  it("no claim and no post for abstention, invalid input, missing head or disablement", async () => {
    const mod = await loadFresh();
    const supabase = fakeSupabase(trace);
    await mod.wh.primeWebhookEndpoints(supabase, true);
    const deps = makeDeps(mod, supabase, trace);

    expect((await run(mod, deps, { ...ROW, final_side: 0 })).verdict).toBe("ABSTAIN");
    expect(
      (await run(mod, deps, { ...ROW, features: { ...ROW.features, input_valid: false } })).verdict,
    ).toBe("INPUT_INVALID");
    expect(
      (await run(mod, deps, { ...ROW, features: { input_valid: true, lite_a: {} } })).verdict,
    ).toBe("NO_HEAD");
    expect((await run(mod, deps, ROW, { executionEnabled: false })).verdict).toBe(
      "EXECUTION_DISABLED",
    );
    expect(trace.claims).toBe(0);
    expect(trace.posts).toHaveLength(0);
  });

  it("does not post when the decision was not durably persisted or is not ours", async () => {
    const mod = await loadFresh();
    const supabase = fakeSupabase(trace);
    await mod.wh.primeWebhookEndpoints(supabase, true);

    const held = makeDeps(mod, supabase, trace, {
      async claim() {
        trace.claims += 1;
        return { outcome: "HELD_BY_OTHER" as const };
      },
    });
    expect((await run(mod, held)).verdict).toBe("NOT_CLAIM_OWNER");

    const unavailable = makeDeps(mod, supabase, trace, {
      async claim() {
        trace.claims += 1;
        return { outcome: "UNAVAILABLE" as const };
      },
    });
    expect((await run(mod, unavailable)).verdict).toBe("NOT_CLAIM_OWNER");
    expect(trace.posts).toHaveLength(0);
  });

  it("one claim and one POST for two concurrent requests on the same identity", async () => {
    const mod = await loadFresh();
    const supabase = fakeSupabase(trace);
    await mod.wh.primeWebhookEndpoints(supabase, true);
    let granted = false;
    const deps = makeDeps(mod, supabase, trace, {
      async claim() {
        trace.claims += 1;
        await sleep(LAT_MS);
        if (granted) return { outcome: "HELD_BY_OTHER" as const };
        granted = true;
        return { outcome: "CLAIMED" as const };
      },
    });
    const [a, b] = await Promise.all([run(mod, deps), run(mod, deps)]);
    expect([a.verdict, b.verdict].sort()).toEqual(["NOT_CLAIM_OWNER", "SENT"]);
    expect(trace.posts).toHaveLength(1);
  });

  it("ownership lost between claim and transport cancels the only attempt", async () => {
    const mod = await loadFresh();
    const supabase = fakeSupabase(trace);
    await mod.wh.primeWebhookEndpoints(supabase, true);
    const deps = makeDeps(mod, supabase, trace, {
      async ownsClaim() {
        trace.ownsCalls += 1;
        await sleep(LAT_MS);
        return false;
      },
    });
    const out = await run(mod, deps);
    expect(trace.posts).toHaveLength(0);
    expect(out.delivered).toBe(0);
    expect(trace.ownsCalls).toBe(1);
  });
});

// --- Start evidence must not depend on the response ---------------------
describe("Version 1 attempt-start evidence is response-independent", () => {
  it("(a) a held, unresolved fetch already has start evidence before any response", async () => {
    const mod = await loadFresh();
    const supabase = fakeSupabase(trace);
    await mod.wh.primeWebhookEndpoints(supabase, true);

    let release: (r: Response) => void = () => {};
    const logs: any[] = [];
    const info = vi.spyOn(console, "info").mockImplementation((line: any) => {
      try {
        logs.push(JSON.parse(String(line)));
      } catch {
        /* ignore */
      }
    });
    vi.stubGlobal("fetch", (_u: string, init: any) => {
      trace.posts.push({ body: String(init?.body ?? ""), atMs: Date.now() });
      return new Promise<Response>((r) => {
        release = r;
      });
    });

    const pending = run(mod, makeDeps(mod, supabase, trace));
    // Give the invocation a tick; the response has NOT been produced yet.
    await sleep(2 * LAT_MS + 30);
    const start = logs.find((l) => l.evt === "webhook_attempt_start");
    expect(start).toBeTruthy();
    expect(start.attempt).toBe(1);
    expect(Math.abs(Date.parse(start.attempt_started_at) - trace.posts[0].atMs)).toBeLessThanOrEqual(5);
    expect(JSON.stringify(start)).not.toContain("test-secret");
    expect(trace.deliveryInserts).toHaveLength(0); // nothing durable yet

    release(new Response("ok", { status: 200 }));
    await pending;
    info.mockRestore();
  });

  it("(b) a thrown/timed-out fetch keeps its true invocation instant, one attempt only", async () => {
    const mod = await loadFresh();
    const supabase = fakeSupabase(trace);
    await mod.wh.primeWebhookEndpoints(supabase, true);
    let invokedAt = 0;
    vi.stubGlobal("fetch", async (_u: string, init: any) => {
      invokedAt = Date.now();
      trace.posts.push({ body: String(init?.body ?? ""), atMs: invokedAt });
      await sleep(15);
      throw new Error("socket hang up");
    });

    const out = await run(mod, makeDeps(mod, supabase, trace));
    expect(out.delivered).toBe(0);
    expect(trace.posts).toHaveLength(1); // no extra attempt, no retry

    const insert = trace.deliveryInserts[0];
    expect(insert.error).toContain("socket hang up");
    expect(insert.status_code).toBeNull();
    const started = Date.parse(insert.attempt_started_at);
    expect(Math.abs(started - invokedAt)).toBeLessThanOrEqual(5);
    expect(started).toBeLessThan(Date.now()); // the invocation, not the failure time
    expect(insert.attempt_start_offset_ms).toBe(started - OPEN_MS);
    expect(out.sendStartedAtMs).toBe(started);
  });

  it("(c) an attempt cancelled at the final gate has no start at all", async () => {
    const mod = await loadFresh();
    const supabase = fakeSupabase(trace);
    await mod.wh.primeWebhookEndpoints(supabase, true);
    const deps = makeDeps(mod, supabase, trace, {
      async ownsClaim() {
        trace.ownsCalls += 1;
        return false;
      },
    });
    const out = await run(mod, deps);
    expect(trace.posts).toHaveLength(0);
    expect(out.sendStartedAtMs ?? null).toBeNull();
    const insert = trace.deliveryInserts[0];
    expect(insert.attempt_started_at).toBeNull();
    expect(insert.attempt_start_offset_ms).toBeNull();
    expect(insert.error).toBe("cancelled_before_send");
  });

  it("(d) no response-time fallback is ever written as a send-start", async () => {
    const mod = await loadFresh();
    const supabase = fakeSupabase(trace);
    await mod.wh.primeWebhookEndpoints(supabase, true);

    const updates: any[] = [];
    const targetsClient = {
      from(table: string) {
        if (table === "webhook_endpoints" || table === "webhook_deliveries") {
          return supabase.from(table);
        }
        const chain: any = {
          update: (v: any) => {
            updates.push(v);
            return chain;
          },
          eq: () => chain,
          then: (r: any) => r({ data: null, error: null }),
        };
        return chain;
      },
    } as any;
    const real = mod.dispatch.supabaseLiteaDispatchDeps(targetsClient, async () => ({
      delivered: 1,
      sendStartedAtMs: null, // delivered, but the instant is genuinely unknown
    }));
    await real.settle({
      dedupeKey: "k",
      owner: "o",
      targetId: "11111111-1111-1111-1111-111111111111",
      status: "SENT",
      error: null,
      publicationOffsetMs: 5200,
      sendStartedAtMs: null,
    });
    expect(updates.at(-1).dispatch_ns).toBeNull(); // never Date.now()
  });
});
