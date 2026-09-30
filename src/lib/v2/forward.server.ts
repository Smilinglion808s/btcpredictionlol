// V2 -> betting app forwarder. Sends each candle's single intent (queued atomically by
// the v2_enqueue_forward trigger) to the V2 receiver in the betting app. Never calls any
// V1.2 receiver/executor. At-least-once with a stable dedupe_key; the receiver must
// ignore repeats. Rows older than 120s from their decision are expired, never sent late.
import { createHmac } from "node:crypto";

const MAX_AGE_MS = 120_000;
const TIMEOUT_MS = 2_500;
export const V2_RECEIVER_REGION = "us-west-1";
const STUCK_MS = 10_000;

export function signV2Forward(secret: string, ts: string, body: string) {
  return createHmac("sha256", secret).update(`${ts}.${body}`).digest("hex");
}

export async function flushV2Forward(sb: any, candleOpen?: string): Promise<void> {
  const url = process.env["V2_FORWARD_URL"];
  const secret = process.env["V2_FORWARD_SECRET"];
  const now = Date.now();
  const cutoff = new Date(now - MAX_AGE_MS).toISOString();

  // The newly committed intent gets the direct path; cleanup/backlog draining
  // stays on heartbeat. Independent reads overlap, as in the V1.2 handoff.
  if (!candleOpen) {
    const { error } = await sb.from("v2_forward_outbox")
      .update({ status: "expired", last_error: "STALE", updated_at: new Date(now).toISOString() })
      .in("status", ["pending", "sending"]).lt("decision_at", cutoff);
    if (error) throw new Error("V2_FORWARD_CLEANUP_FAILED");
  }
  let query = sb.from("v2_forward_outbox")
    .select("candle_open,payload,attempts,status,updated_at")
    .in("status", ["pending", "sending"]).gte("decision_at", cutoff);
  if (candleOpen) query = query.eq("candle_open", candleOpen);
  const [settings, pending] = await Promise.all([
    sb.from("v2_forward_settings").select("enabled").eq("id", true).maybeSingle(),
    query.limit(5),
  ]);
  if (settings.error || pending.error) throw new Error("V2_FORWARD_READ_FAILED");
  if (!settings.data?.enabled || !url || !secret) return;
  const rows = pending.data;

  for (const r of rows ?? []) {
    if (r.status === "sending" && now - Date.parse(r.updated_at) < STUCK_MS) continue;
    // Conditional claim so concurrent requests don't double-send.
    const { data: claimed, error: claimError } = await sb.from("v2_forward_outbox")
      .update({ status: "sending", attempts: r.attempts + 1, updated_at: new Date().toISOString() })
      .eq("candle_open", r.candle_open).eq("status", r.status).eq("attempts", r.attempts)
      .select("candle_open");
    if (claimError) throw new Error("V2_FORWARD_CLAIM_FAILED");
    if (!claimed?.length) continue;

    const body = JSON.stringify(r.payload);
    const ts = String(Date.now());
    const t0 = Date.now();
    let status = "pending", code: number | null = null, err: string | null = null;
    try {
      const res = await fetch(url, {
        method: "POST",
        redirect: "error",
        headers: {
          "x-region": V2_RECEIVER_REGION,
          "content-type": "application/json",
          "x-v2-timestamp": ts,
          "x-v2-signature": signV2Forward(secret, ts, body),
          "x-v2-dedupe-key": r.payload.dedupe_key,
          "user-agent": "btcpredictionlol-v2-forwarder/2",
        },
        body,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      code = res.status;
      if (res.ok) status = "sent";
      else if (res.status >= 400 && res.status < 500 && res.status !== 408 && res.status !== 429) {
        status = "rejected";
        err = (await res.text().catch(() => "")).slice(0, 200) || `HTTP_${res.status}`;
      } else err = `HTTP_${res.status}`;
    } catch (e) {
      err = e instanceof Error ? e.name : "FETCH_FAILED";
    }
    const { error: saveError } = await sb.from("v2_forward_outbox").update({
      status, response_status: code, response_ms: Date.now() - t0, last_error: err,
      sent_at: status === "sent" ? new Date().toISOString() : null, updated_at: new Date().toISOString(),
    }).eq("candle_open", r.candle_open).eq("status", "sending").eq("attempts", r.attempts + 1);
    if (saveError) throw new Error("V2_FORWARD_RECEIPT_FAILED");
  }
}
