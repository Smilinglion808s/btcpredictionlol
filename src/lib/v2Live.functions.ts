// V2 Final R1 dashboard status. Read-only; public like the other tile feeds
// (see the access note in v12Live.functions.ts). Status only — no secrets.
import { createServerFn } from "@tanstack/react-start";
import { sanitizeStatus } from "./v2/contract";

export const getV2Live = createServerFn({ method: "POST" }).handler(async () => {
  const { serviceClient } = await import("./c85/ops.server");
  const sb = serviceClient();
  const since = new Date(Date.now() - 6 * 3600_000).toISOString();
  const [rt, cps, intents] = await Promise.all([
    sb.from("v2_worker_runtime").select("worker_id,status,updated_at").order("updated_at", { ascending: false }).limit(3),
    sb.from("v2_checkpoints")
      .select("candle_open,checkpoint,sleeve,side,probability,eligible,features_ready,reason,decision_at,received_at,receipt_latency_ms,sleeve_name:payload->>sleeve_name")
      .gte("candle_open", since).order("received_at", { ascending: false }).limit(60),
    sb.from("v2_candle_intents").select("candle_open,sleeve,side,execution,created_at")
      .gte("candle_open", since).order("candle_open", { ascending: false }).limit(24),
  ]);
  return {
    serverNow: Date.now(),
    runtime: (rt.data ?? []).map((r: any) => ({ worker_id: r.worker_id, updated_at: r.updated_at, status: sanitizeStatus(r.status) as Record<string, any> })),
    checkpoints: (cps.data ?? []) as any[],
    intents: (intents.data ?? []) as any[],
    error: rt.error || cps.error || intents.error ? "READ_FAILED" : null,
  };
});
