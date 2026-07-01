// Server-only outbound webhook delivery for predictions.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "crypto";

export type WebhookEvent = "prediction.created" | "prediction.resolved";

interface Endpoint {
  id: string;
  url: string;
  secret: string;
  events: string[];
  is_active: boolean;
}

const BACKOFFS_MS = [0, 2_000, 10_000, 30_000];

function formatMountainTime(iso: string): string {
  const d = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Denver",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "longOffset",
  }).formatToParts(d);

  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  const offset = get("timeZoneName").replace("GMT", "");

  return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${offset}`;
}

export function buildPredictionPayload(row: Record<string, any>) {
  const TF_MS = 15 * 60 * 1000;
  const candleTs = row.candle_ts as string;
  const endsAt = new Date(new Date(candleTs).getTime() + TF_MS).toISOString();
  const confNum = Number(row.confidence ?? 0);
  const nowIso = new Date().toISOString();
  return {
    model_version: row.model_version ?? null,
    api_model_id: row.api_model_id ?? null,
    candle_ts: candleTs,
    candle_ts_mt: formatMountainTime(candleTs),
    candle_ends_at: endsAt,
    candle_ends_at_mt: formatMountainTime(endsAt),
    sent_at: nowIso,
    sent_at_mt: formatMountainTime(nowIso),
    timezone: "America/Denver",
    prediction: row.prediction,
    confidence: confNum,
    confidence_fraction: `${Math.max(1, Math.min(5, Math.round(confNum / 20)))}/5`,
    btc_price_at_prediction: row.btc_price_at_prediction != null ? Number(row.btc_price_at_prediction) : null,
    setup_type: row.setup_type ?? null,
    market_condition: row.market_condition ?? null,
    reasoning_summary: row.reasoning_summary ?? null,
    status: row.status,
    actual_next_candle_close: row.actual_next_candle_close != null ? Number(row.actual_next_candle_close) : null,
    created_at: row.created_at ?? null,
    resolved_at: row.resolved_at ?? null,
  };
}

async function postOnce(url: string, body: string, signature: string, event: WebhookEvent) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5_000);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-btc15m-event": event,
        "x-btc15m-signature": `sha256=${signature}`,
        "user-agent": "BTC15mBot-Webhook/1.0",
      },
      body,
      signal: controller.signal,
    });
    let text = "";
    try {
      text = (await res.text()).slice(0, 1000);
    } catch {
      /* ignore */
    }
    return { status: res.status, ok: res.ok, body: text };
  } finally {
    clearTimeout(timer);
  }
}

export async function deliverWebhook(
  supabase: SupabaseClient,
  event: WebhookEvent,
  payloadObj: Record<string, unknown>,
) {
  const { data: endpoints } = await supabase
    .from("webhook_endpoints")
    .select("id,url,secret,events,is_active")
    .eq("is_active", true);
  const list = (endpoints ?? []) as Endpoint[];
  const withEvent = list.filter((e) => e.events?.includes(event));
  if (!withEvent.length) return { delivered: 0 };

  const body = JSON.stringify({ event, ...payloadObj });

  // Deliver in parallel across endpoints; per-endpoint sequential retries.
  await Promise.all(
    withEvent.map(async (ep) => {
      const signature = createHmac("sha256", ep.secret).update(body).digest("hex");
      let lastStatus: number | null = null;
      let lastErr: string | null = null;
      let lastBody: string | null = null;
      for (let attempt = 1; attempt <= BACKOFFS_MS.length; attempt++) {
        if (BACKOFFS_MS[attempt - 1]) {
          await new Promise((r) => setTimeout(r, BACKOFFS_MS[attempt - 1]));
        }
        try {
          const r = await postOnce(ep.url, body, signature, event);
          lastStatus = r.status;
          lastBody = r.body;
          lastErr = null;
          await supabase.from("webhook_deliveries").insert({
            endpoint_id: ep.id,
            event,
            payload: JSON.parse(body),
            status_code: r.status,
            response_body: r.body,
            attempt,
          });
          if (r.ok) break;
        } catch (e) {
          lastErr = e instanceof Error ? e.message : String(e);
          await supabase.from("webhook_deliveries").insert({
            endpoint_id: ep.id,
            event,
            payload: JSON.parse(body),
            error: lastErr,
            attempt,
          });
        }
      }
      await supabase
        .from("webhook_endpoints")
        .update({ last_delivery_at: new Date().toISOString(), last_status: lastStatus })
        .eq("id", ep.id);
      void lastErr;
      void lastBody;
    }),
  );

  return { delivered: withEvent.length };
}
