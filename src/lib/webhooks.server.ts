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

const TF_MS_15M = 15 * 60 * 1000;

// Legacy payload — served by /api/public/predictions/{latest,upcoming} and
// prediction.resolved. `candle_ts` in the DB is the target-candle CLOSE
// (nextCloseMs), so starts_at = candle_ts − 15m and ends_at = candle_ts.
export function buildPredictionPayload(row: Record<string, any>) {
  const candleTs = row.candle_ts as string;
  const closeMs = new Date(candleTs).getTime();
  const startsAt = new Date(closeMs - TF_MS_15M).toISOString();
  const endsAt = candleTs;
  const confNum = Number(row.confidence ?? 0);
  const nowIso = new Date().toISOString();
  return {
    model_version: row.model_version ?? null,
    api_model_id: row.api_model_id ?? null,
    candle_starts_at: startsAt,
    candle_starts_at_mt: formatMountainTime(startsAt),
    candle_ts: candleTs,
    candle_ts_mt: formatMountainTime(candleTs),
    candle_ends_at: endsAt,
    candle_ends_at_mt: formatMountainTime(endsAt),
    target_candle_close_at: candleTs,
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

export const B2_DECISION_POLICY_VERSION = "model7-b2-no-nce-v1";
export const B2_MODEL_ID = "model7_variant_b2";

// Variant B4.2 (Daily Edge Guard) — kept for tracking; no longer webhook source.
export const B4_2_DECISION_POLICY_VERSION = "model7-b4_2-daily-edge-guard-v1";
export const B4_2_MODEL_ID = "model7_variant_b4_2";

export function buildB4_2WebhookPayload(inputs: B2WebhookInputs) {
  const base = buildB2WebhookPayload(inputs);
  return {
    ...base,
    model: B4_2_MODEL_ID,
    model_version: "b4.2 6.0",
    decision_policy_version: B4_2_DECISION_POLICY_VERSION,
  };
}

// Variant A2 Conflict — legacy outbound source; kept for backwards-compat only.
export const A2_CONFLICT_DECISION_POLICY_VERSION = "model7-a2-conflict-v1";
export const A2_CONFLICT_MODEL_ID = "model7_variant_a2_conflict";

export function buildA2ConflictWebhookPayload(inputs: B2WebhookInputs) {
  const base = buildB2WebhookPayload(inputs);
  return {
    ...base,
    model: A2_CONFLICT_MODEL_ID,
    model_version: "a2-conflict 6.0",
    decision_policy_version: A2_CONFLICT_DECISION_POLICY_VERSION,
  };
}

// TD1-RC (Model 8 layer over A2_Combined) — ACTIVE outbound webhook source.
// TD1-RC only preserves A2_Combined's YES/NO or converts to SKIP; it never
// flips direction. Payload shape mirrors B2 for bot compatibility, but the
// underlying decision fields come from the model7_td1_rc_shadow row.
export const TD1_RC_DECISION_POLICY_VERSION = "model7-a2-combined-td1-rc-v1";
export const TD1_RC_MODEL_ID = "model7_td1_rc";

export interface Td1RcWebhookInputs {
  td1Row: Record<string, any>;     // model7_td1_rc_shadow row
  prediction: Record<string, any>; // predictions row
}

export function buildTd1RcWebhookPayload({ td1Row, prediction }: Td1RcWebhookInputs) {
  const candleTs = prediction.candle_ts as string;
  const startMs = new Date(candleTs).getTime();
  const startsAt = new Date(startMs).toISOString();
  const endsAt = new Date(startMs + TF_MS_15M).toISOString();
  const nowIso = new Date().toISOString();
  const decision: string | null = (td1Row.external_final_decision as string | null) ?? null;
  const wouldTrade: boolean = Boolean(td1Row.would_trade);
  const pGreen = td1Row.a2_probability_green != null ? Number(td1Row.a2_probability_green) : null;

  let predictionLabel: "YES" | "NO" | "NO CLEAR EDGE";
  if (!wouldTrade) predictionLabel = "NO CLEAR EDGE";
  else if (decision === "YES") predictionLabel = "YES";
  else if (decision === "NO") predictionLabel = "NO";
  else predictionLabel = "NO CLEAR EDGE";

  let confidence: number;
  if (pGreen == null) confidence = 0;
  else if (predictionLabel === "YES") confidence = Math.round(pGreen * 100);
  else if (predictionLabel === "NO") confidence = Math.round((1 - pGreen) * 100);
  else confidence = Math.round(Math.max(pGreen, 1 - pGreen) * 100);

  return {
    model: TD1_RC_MODEL_ID,
    model_version: "td1-rc 1.0",
    model_artifact_sha256: td1Row.td1_artifact_sha256 ?? null,
    decision_policy_version: TD1_RC_DECISION_POLICY_VERSION,
    model_fit_id: td1Row.td1_fit_id ?? null,
    setup_type: prediction.setup_type ?? null,

    prediction: predictionLabel,
    confidence,

    decision,
    trade: wouldTrade,
    probability_green: pGreen,
    base_decision: td1Row.a2_original_decision ?? null,
    override_reasons: td1Row.all_veto_reasons_json ?? [],

    // TD1-RC specific audit fields
    a2_source_variant: td1Row.a2_source_variant ?? "A2_Combined",
    a2_original_decision: td1Row.a2_original_decision ?? null,
    td1_veto_fired: Boolean(td1Row.td1_veto_fired),
    containment_veto_fired: Boolean(td1Row.containment_veto_fired),
    td1_predicted_loss_probability: td1Row.td1_predicted_loss_probability ?? null,
    td1_threshold: td1Row.td1_threshold ?? 0.60,
    skip_reason: td1Row.skip_reason ?? null,
    prospective_test_id: td1Row.prospective_test_id ?? null,

    candle_starts_at: startsAt,
    candle_starts_at_mt: formatMountainTime(startsAt),
    candle_ends_at: endsAt,
    candle_ends_at_mt: formatMountainTime(endsAt),
    target_candle_close_at: endsAt,

    dedupe_key: `BTC-USDT-15m-${startsAt}`,
    prediction_id: prediction.id ?? null,
    shadow_id: null,

    btc_price_at_prediction: prediction.btc_price_at_prediction != null
      ? Number(prediction.btc_price_at_prediction) : null,
    market_condition: prediction.market_condition ?? null,

    timing_status: td1Row.timing_status ?? null,
    boundary_delta_ms: null,
    scored_at: null,

    sent_at: nowIso,
    sent_at_mt: formatMountainTime(nowIso),
    timezone: "America/Denver",
  };
}


export interface B2WebhookInputs {
  shadow: Record<string, any>;     // model7_shadow row (variant='B2')
  prediction: Record<string, any>; // predictions row (Model 6 snapshot)
}

// Neutral prediction.created payload emitted from Variant B2 only.
// `candle_ts` in the DB is the target-candle START (open time); ends_at = candle_ts + 15m.
export function buildB2WebhookPayload({ shadow, prediction }: B2WebhookInputs) {
  const candleTs = prediction.candle_ts as string;
  const startMs = new Date(candleTs).getTime();
  const startsAt = new Date(startMs).toISOString();
  const endsAt = new Date(startMs + TF_MS_15M).toISOString();
  const nowIso = new Date().toISOString();
  const decision: string | null = shadow.decision ?? null;
  const wouldTrade: boolean = Boolean(shadow.would_trade);
  const pGreen = shadow.probability_green != null ? Number(shadow.probability_green) : null;

  let predictionLabel: "YES" | "NO" | "NO CLEAR EDGE";
  if (!wouldTrade) predictionLabel = "NO CLEAR EDGE";
  else if (decision === "YES") predictionLabel = "YES";
  else if (decision === "NO") predictionLabel = "NO";
  else predictionLabel = "NO CLEAR EDGE";

  let confidence: number;
  if (pGreen == null) confidence = 0;
  else if (predictionLabel === "YES") confidence = Math.round(pGreen * 100);
  else if (predictionLabel === "NO") confidence = Math.round((1 - pGreen) * 100);
  else confidence = Math.round(Math.max(pGreen, 1 - pGreen) * 100);

  return {
    model: B2_MODEL_ID,
    model_version: "b2 6.0",
    model_artifact_sha256: shadow.model_artifact_sha256 ?? null,
    decision_policy_version: B2_DECISION_POLICY_VERSION,
    model_fit_id: shadow.model_fit_id ?? null,
    setup_type: prediction.setup_type ?? null,

    prediction: predictionLabel,
    confidence,

    decision,
    trade: wouldTrade,
    probability_green: pGreen,
    base_decision: shadow.base_decision ?? null,
    override_reasons: shadow.override_reasons_json ?? [],

    candle_starts_at: startsAt,
    candle_starts_at_mt: formatMountainTime(startsAt),
    candle_ends_at: endsAt,
    candle_ends_at_mt: formatMountainTime(endsAt),
    target_candle_close_at: endsAt,

    dedupe_key: `BTC-USDT-15m-${startsAt}`,
    prediction_id: prediction.id ?? null,
    shadow_id: shadow.id ?? null,

    btc_price_at_prediction: prediction.btc_price_at_prediction != null
      ? Number(prediction.btc_price_at_prediction) : null,
    market_condition: prediction.market_condition ?? null,

    timing_status: shadow.timing_status ?? null,
    boundary_delta_ms: shadow.boundary_delta_ms ?? null,
    scored_at: shadow.scored_at ?? null,

    sent_at: nowIso,
    sent_at_mt: formatMountainTime(nowIso),
    timezone: "America/Denver",
  };
}

// Neutral prediction.resolved payload — pairs the resolved candle outcome
// with B2's decision for that candle so the bot has a matched pair.
export function buildResolvedWebhookPayload(
  prediction: Record<string, any>,
  b2Shadow: Record<string, any> | null,
  actualDirection: "GREEN" | "RED" | "DOJI" | null,
  b2Result: "win" | "loss" | "push" | null,
) {
  const candleTs = prediction.candle_ts as string;
  const startMs = new Date(candleTs).getTime();
  const startsAt = new Date(startMs).toISOString();
  const endsAt = new Date(startMs + TF_MS_15M).toISOString();
  const nowIso = new Date().toISOString();
  return {
    model: B2_MODEL_ID,
    model_version: "b2 6.0",
    decision_policy_version: B2_DECISION_POLICY_VERSION,
    setup_type: prediction.setup_type ?? null,
    dedupe_key: `BTC-USDT-15m-${startsAt}`,
    prediction_id: prediction.id ?? null,
    shadow_id: b2Shadow?.id ?? null,

    candle_starts_at: startsAt,
    candle_starts_at_mt: formatMountainTime(startsAt),
    candle_ends_at: endsAt,
    candle_ends_at_mt: formatMountainTime(endsAt),
    target_candle_close_at: endsAt,

    b2_decision: b2Shadow?.decision ?? null,
    b2_would_trade: b2Shadow ? Boolean(b2Shadow.would_trade) : null,
    b2_probability_green: b2Shadow?.probability_green != null
      ? Number(b2Shadow.probability_green) : null,

    actual_direction: actualDirection,
    b2_result: b2Result,
    actual_next_candle_close: prediction.actual_next_candle_close != null
      ? Number(prediction.actual_next_candle_close) : null,

    resolved_at: prediction.resolved_at ?? null,
    sent_at: nowIso,
    sent_at_mt: formatMountainTime(nowIso),
    timezone: "America/Denver",
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
