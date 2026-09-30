import { describe, expect, it, vi, beforeEach } from "vitest";
import { createHmac } from "crypto";
import { flushV2Forward, signV2Forward } from "./forward.server";

function fakeSb(state: { enabled: boolean; rows: any[] }) {
  const updates: any[] = [];
  const q = (table: string) => {
    const ctx: any = { table, filters: [] as any[], patch: null as any };
    const chain: any = {
      select: () => chain,
      update: (p: any) => { ctx.patch = p; return chain; },
      in: (c: string, v: any[]) => { ctx.filters.push((r: any) => v.includes(r[c])); return chain; },
      eq: (c: string, v: any) => { ctx.filters.push((r: any) => r[c] === v); return chain; },
      lt: (c: string, v: string) => { ctx.filters.push((r: any) => r[c] < v); return chain; },
      gte: (c: string, v: string) => { ctx.filters.push((r: any) => r[c] >= v); return chain; },
      limit: () => chain,
      maybeSingle: async () => ({ data: { enabled: state.enabled } }),
      then: (res: any) => {
        if (table !== "v2_forward_outbox") return res({ data: null });
        const hit = state.rows.filter((r) => ctx.filters.every((f: any) => f(r)));
        if (ctx.patch) { hit.forEach((r) => Object.assign(r, ctx.patch)); updates.push(ctx.patch); }
        return res({ data: hit.map((r) => ({ ...r })) });
      },
    };
    return chain;
  };
  return { sb: { from: q }, updates };
}

const row = (ageMs: number) => ({
  candle_open: "2026-09-29T16:15:00.000Z", status: "pending", attempts: 0, updated_at: new Date().toISOString(),
  decision_at: new Date(Date.now() - ageMs).toISOString(),
  payload: { dedupe_key: "v2-final-r1:2026-09-29T16:15:00Z", side: "UP" },
});

describe("v2 forward", () => {
  beforeEach(() => {
    process.env["V2_FORWARD_URL"] = "https://receiver.test/hook";
    process.env["V2_FORWARD_SECRET"] = "s3cret";
  });

  it("signs timestamp.body with HMAC-SHA256", () => {
    expect(signV2Forward("k", "1", "{}")).toBe(createHmac("sha256", "k").update("1.{}").digest("hex"));
  });

  it("sends nothing while the switch is off", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    const st = { enabled: false, rows: [row(1000)] };
    await flushV2Forward(fakeSb(st).sb);
    expect(f).not.toHaveBeenCalled();
    expect(st.rows[0].status).toBe("pending");
  });

  it("sends once with signature and marks sent", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 })); vi.stubGlobal("fetch", f);
    const st = { enabled: true, rows: [row(1000)] };
    await flushV2Forward(fakeSb(st).sb);
    await flushV2Forward(fakeSb(st).sb);
    expect(f).toHaveBeenCalledTimes(1);
    const init = (f.mock.calls[0] as any)[1];
    expect(init.headers["x-v2-signature"]).toBe(signV2Forward("s3cret", init.headers["x-v2-timestamp"], init.body));
    expect(st.rows[0].status).toBe("sent");
  });

  it("expires stale rows instead of sending late", async () => {
    const f = vi.fn(); vi.stubGlobal("fetch", f);
    const st = { enabled: true, rows: [row(200_000)] };
    await flushV2Forward(fakeSb(st).sb);
    expect(f).not.toHaveBeenCalled();
    expect(st.rows[0].status).toBe("expired");
  });

  it("keeps 5xx pending for retry, 4xx rejected", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("x", { status: 503 })));
    const a = { enabled: true, rows: [row(1000)] };
    await flushV2Forward(fakeSb(a).sb);
    expect(a.rows[0].status).toBe("pending");
    vi.stubGlobal("fetch", vi.fn(async () => new Response("bad", { status: 400 })));
    const b = { enabled: true, rows: [row(1000)] };
    await flushV2Forward(fakeSb(b).sb);
    expect(b.rows[0].status).toBe("rejected");
  });

  it("uses redirect: manual and blocks 3xx as REDIRECT_BLOCKED", async () => {
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { location: "https://evil.test" } }));
    vi.stubGlobal("fetch", f);
    const st = { enabled: true, rows: [row(1000)] };
    await flushV2Forward(fakeSb(st).sb);
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0] as any)[1].redirect).toBe("manual");
    expect(st.rows[0].status).toBe("rejected");
    expect((st.rows[0] as any).last_error).toBe("REDIRECT_BLOCKED");
    expect((st.rows[0] as any).response_status).toBe(302);
  });

  it("concurrent flushes deliver only once", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 })); vi.stubGlobal("fetch", f);
    const st = { enabled: true, rows: [row(1000)] };
    await Promise.all([flushV2Forward(fakeSb(st).sb), flushV2Forward(fakeSb(st).sb)]);
    expect(f).toHaveBeenCalledTimes(1);
    expect(st.rows[0].status).toBe("sent");
  });

  it("request construction is valid in the runtime (real Request)", () => {
    const req = new Request("https://receiver.test/hook", {
      method: "POST", redirect: "manual", body: "{}",
      headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(2500),
    });
    expect(req.redirect).toBe("manual");
  });
});
