// The transport-level half of duplicate-send protection: every real attempt,
// first and retry, re-checks the live gate immediately before posting.
// `fetch` is replaced by an IN-PROCESS receiver; no network, no real endpoint.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { deliverWebhookNow } from "@/lib/webhooks.server";
import { LITE_A_MODEL_VERSION } from "@/lib/c85/config";

const endpoint = {
  id: "ep-local",
  url: "http://127.0.0.1:1/in-process-receiver",
  secret: "test-secret",
  events: ["prediction.created"],
  is_active: true,
};

/** Supabase stand-in: one active endpoint, all writes swallowed. */
function fakeSupabase() {
  const inserts: any[] = [];
  return {
    inserts,
    client: {
      from: () => {
        const chain: any = {
          select: () => chain,
          eq: () => Promise.resolve({ data: [endpoint], error: null }),
          insert: async (v: any) => {
            inserts.push(v);
            return { error: null };
          },
          update: () => ({ eq: async () => ({ error: null }) }),
          then: (r: any) => r({ data: [endpoint], error: null }),
        };
        return chain;
      },
    } as any,
  };
}

const payload = { model: LITE_A_MODEL_VERSION, prediction: "YES" };

let posts: string[] = [];

beforeEach(() => {
  posts = [];
  process.env['LITEA_SERVER_EXECUTION_ENABLED'] = "true";
  vi.stubGlobal("fetch", async (url: string) => {
    posts.push(String(url));
    return new Response("no", { status: 500 });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env['LITEA_SERVER_EXECUTION_ENABLED'];
});

describe("guarded Version 1 transport", () => {
  it("posts nothing when the guard is false before the first attempt", async () => {
    const db = fakeSupabase();
    const out = await deliverWebhookNow(db.client, "prediction.created", payload, () => false);
    expect(out.delivered).toBe(0);
    expect(out.attempted).toBe(0);
    expect(posts).toHaveLength(0);
  });

  it("posts nothing for Version 1 when the server control is absent", async () => {
    delete process.env['LITEA_SERVER_EXECUTION_ENABLED'];
    const db = fakeSupabase();
    const out = await deliverWebhookNow(db.client, "prediction.created", payload, () => true);
    expect(out.delivered).toBe(0);
    expect(posts).toHaveLength(0);
  });

  it("cancels the background retries when the guard turns false between attempts", async () => {
    const db = fakeSupabase();
    let live = true;
    const out = await deliverWebhookNow(db.client, "prediction.created", payload, () => live);
    expect(posts).toHaveLength(1); // first attempt happened, endpoint refused
    live = false; // disabled between attempts
    await out.settle;
    expect(posts).toHaveLength(1); // no retry posted
  });

  it("does not retry a guarded attempt whose outcome is ambiguous", async () => {
    vi.stubGlobal("fetch", async () => {
      posts.push("throw");
      throw new Error("socket hang up");
    });
    const db = fakeSupabase();
    const out = await deliverWebhookNow(db.client, "prediction.created", payload, () => true);
    await out.settle;
    expect(posts).toHaveLength(1);
    expect(out.delivered).toBe(0);
  });
});
