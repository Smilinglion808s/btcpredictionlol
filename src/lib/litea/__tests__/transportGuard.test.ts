// The transport half of Version 1 duplicate-send protection: ONE automatic
// attempt per configured endpoint, no background resend for any response,
// timeout, exception or cancellation. `fetch` is replaced by an IN-PROCESS
// receiver; no network, no real endpoint, no financial activity.

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
const V1 = { maxAttempts: 1 } as const;

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

describe("Version 1 guarded transport", () => {
  it("posts nothing when the guard is false at the transport check", async () => {
    // Since the pre-send latency patch the awaited guard runs ONCE, immediately
    // before the transport (the authoritative check). A false guard therefore
    // cancels the attempt there rather than at intake: nothing is posted.
    const db = fakeSupabase();
    const out = await deliverWebhookNow(db.client, "prediction.created", payload, {
      ...V1,
      guard: () => false,
    });
    await out.settle;
    expect(out.delivered).toBe(0);
    expect(posts).toHaveLength(0);
  });


  it("posts nothing for Version 1 when the server control is absent", async () => {
    delete process.env['LITEA_SERVER_EXECUTION_ENABLED'];
    const db = fakeSupabase();
    const out = await deliverWebhookNow(db.client, "prediction.created", payload, {
      ...V1,
      guard: () => true,
    });
    expect(out.delivered).toBe(0);
    expect(posts).toHaveLength(0);
  });

  it("does not resend after an HTTP 500", async () => {
    const db = fakeSupabase();
    const out = await deliverWebhookNow(db.client, "prediction.created", payload, {
      ...V1,
      guard: () => true,
    });
    await out.settle;
    expect(posts).toHaveLength(1);
    expect(out.delivered).toBe(0);
  });

  it("does not resend after a timeout or thrown transport error", async () => {
    vi.stubGlobal("fetch", async () => {
      posts.push("throw");
      throw new Error("socket hang up");
    });
    const db = fakeSupabase();
    const out = await deliverWebhookNow(db.client, "prediction.created", payload, {
      ...V1,
      guard: () => true,
    });
    await out.settle;
    expect(posts).toHaveLength(1);
    expect(out.delivered).toBe(0);
  });

  it("never revives a cancelled attempt in the background", async () => {
    const db = fakeSupabase();
    let live = true;
    // The switch flips while the transport check itself is awaiting.
    const out = await deliverWebhookNow(db.client, "prediction.created", payload, {
      ...V1,
      guard: async () => {
        await new Promise((r) => setTimeout(r, 5));
        const now = live;
        live = false;
        return now && false;
      },
    });
    await out.settle;
    expect(posts).toHaveLength(0); // cancelled before transport
    expect(out.delivered).toBe(0);
  });


  it("delivers once and does not repeat on success", async () => {
    vi.stubGlobal("fetch", async (url: string) => {
      posts.push(String(url));
      return new Response("ok", { status: 200 });
    });
    const db = fakeSupabase();
    const out = await deliverWebhookNow(db.client, "prediction.created", payload, {
      ...V1,
      guard: () => true,
    });
    await out.settle;
    expect(out.delivered).toBe(1);
    expect(posts).toHaveLength(1);
  });
});

describe("legacy unguarded callers", () => {
  it("keep their background retry behaviour", async () => {
    const db = fakeSupabase();
    const out = await deliverWebhookNow(db.client, "prediction.created", {
      model: process.env['LITEA_SERVER_EXECUTION_ENABLED'] === "true"
        ? "lite-a-floor4-top10-r1"
        : "t45-priceflow",
      prediction: "YES",
    });
    expect(posts).toHaveLength(1);
    void out.settle;
    // The first backoff is 2s; a legacy caller still retries on its own.
    for (let i = 0; i < 60 && posts.length < 2; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    expect(posts.length).toBeGreaterThan(1);
  }, 15_000);
});
