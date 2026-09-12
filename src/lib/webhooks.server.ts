// Server-only outbound webhook delivery for predictions.
import type { SupabaseClient } from "@supabase/supabase-js";
import { createHmac } from "crypto";
import { LITE_A_MODEL_VERSION } from "@/lib/c85/config";
import { V11_MODEL_VERSION } from "@/lib/v11/config";


export type WebhookEvent = "prediction.created" | "prediction.resolved";

interface Endpoint {
  id: string;
  url: string;
  secret: string;
  events: string[];
  is_active: boolean;
}

const BACKOFFS_MS = [0, 2_000, 10_000, 30_000];

export function formatMountainTime(iso: string): string {
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

    // --- td1-rc-compressed-risk-v1 audit metadata ---
    td1_policy_version: td1Row.td1_policy_version ?? null,
    td1_compressed_risk_threshold: td1Row.td1_compressed_risk_threshold ?? null,
    td1_compressed_risk_market_condition: td1Row.td1_compressed_risk_market_condition ?? null,
    td1_compressed_risk_evaluable: td1Row.td1_compressed_risk_evaluable ?? null,
    td1_compressed_risk_veto_fired: Boolean(td1Row.td1_compressed_risk_veto_fired),
    td1_legacy_global_veto_condition: td1Row.td1_legacy_global_veto_condition ?? null,


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

// ── Model 3 — Selective Edge R2 (m3-se-r2) ───────────────────────────────
// Active outbound webhook source alongside TD1-RC. Emits on every scored
// candle: GREEN → YES, RED → NO, ABSTAIN → NO CLEAR EDGE (trade=false).
export const M3SE_MODEL_ID = "m3-se";
export const M3SE_DECISION_POLICY_VERSION = "m3-se-r2";

export interface M3SeWebhookInputs {
  row: Record<string, any>; // model3_se_predictions row payload
}

export function buildM3SeWebhookPayload({ row }: M3SeWebhookInputs) {
  const candleTs = String(row.target_candle_ts);
  const startMs = new Date(candleTs).getTime();
  const startsAt = new Date(startMs).toISOString();
  const endsAt = new Date(startMs + TF_MS_15M).toISOString();
  const nowIso = new Date().toISOString();

  const published = String(row.published_prediction ?? "ABSTAIN");
  const predictionLabel: "YES" | "NO" | "NO CLEAR EDGE" =
    published === "GREEN" ? "YES" : published === "RED" ? "NO" : "NO CLEAR EDGE";
  const trade = predictionLabel !== "NO CLEAR EDGE";

  const pGreen = row.p_green_stacked_calibrated != null
    ? Number(row.p_green_stacked_calibrated) : null;
  let confidence = 0;
  if (pGreen != null && Number.isFinite(pGreen)) {
    confidence = predictionLabel === "YES"
      ? Math.round(pGreen * 100)
      : predictionLabel === "NO"
        ? Math.round((1 - pGreen) * 100)
        : Math.round(Math.max(pGreen, 1 - pGreen) * 100);
  }

  return {
    model: M3SE_MODEL_ID,
    model_version: String(row.model_version ?? "m3-se-r2"),
    decision_policy_version: M3SE_DECISION_POLICY_VERSION,
    feature_schema_version: row.feature_schema_version ?? null,
    code_version: row.code_version ?? null,
    model_fit_id: row.fit_id ?? null,

    prediction: predictionLabel,
    confidence,
    trade,

    published_prediction: published,
    raw_prediction: row.raw_prediction ?? null,
    raw_confidence: row.raw_confidence != null ? Number(row.raw_confidence) : null,
    probability_green: pGreen,
    p_correct_calibrated: row.p_correct_calibrated != null ? Number(row.p_correct_calibrated) : null,
    selector_score_raw: row.selector_score_raw != null ? Number(row.selector_score_raw) : null,
    selector_score_percentile: row.selector_score_percentile != null
      ? Number(row.selector_score_percentile) : null,
    selection_threshold: row.selection_threshold != null ? Number(row.selection_threshold) : null,
    selector_margin: row.selector_margin != null ? Number(row.selector_margin) : null,

    abstain_reason: row.abstain_reason ?? null,
    abstain_category: row.abstain_category ?? null,
    abstain_detail: row.abstain_detail ?? null,
    data_quality_valid: row.data_quality_valid !== false,

    candle_starts_at: startsAt,
    candle_starts_at_mt: formatMountainTime(startsAt),
    candle_ends_at: endsAt,
    candle_ends_at_mt: formatMountainTime(endsAt),
    target_candle_close_at: endsAt,

    dedupe_key: `m3-se-BTC-USDT-15m-${startsAt}`,
    prediction_id: null,

    btc_price_at_prediction: row.target_open != null ? Number(row.target_open) : null,

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

/** The instant this process handed a request to the HTTP client. */
export interface AttemptStart {
  startedAtMs: number;
  startedAtNs: bigint;
}

/**
 * One HTTP attempt.
 *
 * `startedAtMs` / `startedAtNs` are captured on the LAST line before `fetch()`
 * is invoked, after every awaited gate has already resolved. They mean exactly
 * "the moment this process handed the request to the HTTP client" — NOT the
 * kernel wire time, NOT TLS/connect completion, and NOT the bot's receipt or
 * acknowledgement time.
 *
 * `onStart` is called SYNCHRONOUSLY immediately after the fetch promise has
 * been initiated, so the start instant exists independently of the response.
 * It survives a rejection, an abort/timeout and a never-resolving request. It
 * cannot survive a process crash before the durable write — that is a real
 * limit, not a guarantee.
 */
async function postOnce(
  url: string,
  body: string,
  signature: string,
  event: WebhookEvent,
  timeoutMs = 5_000,
  onStart?: (start: AttemptStart) => void,
) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const init = {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-btc15m-event": event,
      "x-btc15m-signature": `sha256=${signature}`,
      "user-agent": "BTC15mBot-Webhook/1.0",
    },
    body,
    signal: controller.signal,
  } as const;

  try {
    // --- nothing awaited, allocated or logged between here and fetch() ---
    const startedAtNs = process.hrtime.bigint();
    const startedAtMs = Date.now();
    const pending = fetch(url, init);
    // Initiated. Publishing the start now costs the attempt nothing and does
    // not depend on the response ever arriving.
    onStart?.({ startedAtMs, startedAtNs });
    const res = await pending;
    let text = "";
    try {
      text = (await res.text()).slice(0, 1000);
    } catch {
      /* ignore */
    }
    return { status: res.status, ok: res.ok, body: text, startedAtMs, startedAtNs };
  } finally {
    clearTimeout(timer);
  }
}

/** Secret-free structured start evidence. Emitted at invocation, never amended. */
function logAttemptStart(
  model: string,
  event: WebhookEvent,
  endpointId: string,
  attempt: number,
  startedAtMs: number,
  targetOpenMs: number | null,
) {
  console.info(
    JSON.stringify({
      evt: "webhook_attempt_start",
      model,
      event,
      endpoint_id: endpointId,
      attempt,
      attempt_started_at: new Date(startedAtMs).toISOString(),
      attempt_start_offset_ms: targetOpenMs != null ? startedAtMs - targetOpenMs : null,
    }),
  );
}



/**
 * Master kill switch for ALL outbound webhooks (every model, every event).
 * Set to true only when the user explicitly asks to turn webhooks back on.
 */
export const OUTBOUND_WEBHOOKS_ENABLED = true;

/**
 * Static permitted outbound sources. Every other model (T45, T30, T10, B4x4,
 * ES1, V6, TD1-RC, A2, Model 3/6/7) may still call deliverWebhook — their
 * payloads are dropped here.
 *
 * T45 Price Flow is intentionally NOT in this set: its sending is off.
 */
export const WEBHOOK_ALLOWED_MODELS = new Set<string>([]);

/**
 * The effective sender allow-list.
 *
 * Version 1 sends only while `LITEA_SERVER_EXECUTION_ENABLED=true` (the secret
 * is deleted today, so V1 delivery is PAUSED).
 *
 * Version 1.1 sends only while `V11_SERVER_EXECUTION_ENABLED=true` AND the
 * original Version 1 sender is off. The two legs share one interval, so they
 * are mutually exclusive by construction; both are absent by default.
 */
export function isModelAllowedToSend(model: string): boolean {
  if (WEBHOOK_ALLOWED_MODELS.has(model)) return true;
  const v1On = process.env['LITEA_SERVER_EXECUTION_ENABLED'] === "true";
  if (model === LITE_A_MODEL_VERSION) return v1On;
  if (model === V11_MODEL_VERSION) {
    return (
      process.env['V11_SERVER_EXECUTION_ENABLED'] === "true" &&
      !v1On &&
      !WEBHOOK_ALLOWED_MODELS.has(LITE_A_MODEL_VERSION)
    );
  }
  return false;
}


// ── Latency-critical delivery path ───────────────────────────────────────────
// The active model must reach the bot the instant the decision exists, so the
// endpoint list is cached (and pre-warmed before the boundary) and the first
// POST goes out before any database logging happens.

const ENDPOINT_CACHE_TTL_MS = 120_000;
const FAST_POST_TIMEOUT_MS = 3_500;
let endpointCache: { at: number; list: Endpoint[] } | null = null;

/** Warm the endpoint cache ahead of the boundary so send-time does zero DB reads. */
export async function primeWebhookEndpoints(
  supabase: SupabaseClient,
  force = false,
): Promise<Endpoint[]> {
  const now = Date.now();
  if (!force && endpointCache && now - endpointCache.at < ENDPOINT_CACHE_TTL_MS) {
    return endpointCache.list;
  }
  const { data } = await supabase
    .from("webhook_endpoints")
    .select("id,url,secret,events,is_active")
    .eq("is_active", true);
  endpointCache = { at: now, list: (data ?? []) as Endpoint[] };
  return endpointCache.list;
}

export interface FastDeliveryResult {
  delivered: number;
  attempted: number;
  latencyMs: number;
  sentAt: string | null;
  /**
   * Wall-clock ms of the EARLIEST actual `fetch()` invocation in this call,
   * captured after every awaited gate. Null when nothing was posted. This is
   * the HTTP invocation instant, not the bot's receipt or acknowledgement.
   */
  sendStartedAtMs: number | null;
  /** `sendStartedAtMs` minus the target open, when the caller supplies one. */
  sendStartOffsetMs: number | null;
  /** Logging + retries for failed endpoints; await it after the hot path. */
  settle: Promise<void>;
}

/** Optional per-call controls. Legacy callers pass nothing and are unchanged. */
export interface FastDeliveryOptions {
  /**
   * Re-evaluated immediately before every real POST. False cancels that
   * attempt; a cancelled attempt is terminal and is never revived.
   */
  guard?: () => Promise<boolean> | boolean;
  /**
   * Total automatic attempts per configured endpoint, including the first.
   * Version 1 passes 1: no background resend for any response, timeout,
   * exception or cancellation. Default keeps the legacy backoff behaviour.
   */
  maxAttempts?: number;
  /** Target interval open (ms). Used only to record the send-start offset. */
  targetOpenMs?: number;
  /**
   * Deliver ONLY when exactly one active endpoint is subscribed to the event.
   * The Version 1.1 combined stream sets this: its two legs share one interval
   * and can guarantee at most one bet only against a single destination. Zero
   * or several configured destinations cancel the send. Legacy callers omit it
   * and keep fan-out to every configured endpoint.
   */
  requireSingleEndpoint?: boolean;
}

/**
 * Read-only operator view of the destination list: how many ACTIVE endpoints
 * are subscribed to an event. No URL, secret or id ever leaves this function.
 */
export async function countActiveEndpointsForEvent(
  supabase: SupabaseClient,
  event: WebhookEvent,
): Promise<number> {
  const { data, error } = await supabase
    .from("webhook_endpoints")
    .select("events,is_active")
    .eq("is_active", true);
  if (error || !Array.isArray(data)) return 0;
  return (data as { events?: string[] }[]).filter((e) => e.events?.includes(event)).length;


/**
 * Send now, log later. The first attempt fires immediately with a short
 * timeout; delivery rows, endpoint bookkeeping and any permitted retries run
 * afterwards in `settle`.
 *
 * With `maxAttempts: 1` (the Version 1 path) `settle` is logging only: it can
 * never schedule a retransmission. Deadlines are never extended or reset —
 * the caller owns the original one.
 */
export async function deliverWebhookNow(
  supabase: SupabaseClient,
  event: WebhookEvent,
  payloadObj: Record<string, unknown>,
  options?: FastDeliveryOptions,
): Promise<FastDeliveryResult> {
  const guard = options?.guard;
  const maxAttempts = Math.max(1, options?.maxAttempts ?? BACKOFFS_MS.length);
  const targetOpenMs = options?.targetOpenMs ?? null;
  const noop: FastDeliveryResult = {
    delivered: 0,
    attempted: 0,
    latencyMs: 0,
    sentAt: null,
    sendStartedAtMs: null,
    sendStartOffsetMs: null,
    settle: Promise.resolve(),
  };
  if (!OUTBOUND_WEBHOOKS_ENABLED) return noop;
  const source = String(payloadObj.model ?? payloadObj.model_name ?? "");
  if (!isModelAllowedToSend(source)) return noop;
  const allowed = async () => {
    if (!OUTBOUND_WEBHOOKS_ENABLED) return false;
    if (!isModelAllowedToSend(source)) return false;
    return guard ? (await guard()) === true : true;
  };
  // The awaited guard (for Version 1: the durable claim-ownership read) is a
  // network round trip. It is checked per endpoint immediately before the
  // transport, which is the authoritative check; running it here as well only
  // adds latency and can go stale. Single-attempt callers therefore rely on
  // that final check alone. Legacy multi-attempt callers keep the early gate.
  if (maxAttempts > 1 && !(await allowed())) return noop;
  // Kill switch and allow-list are process-local and free, so they are still
  // evaluated up front (above) for every caller.

  const endpoints = (await primeWebhookEndpoints(supabase)).filter((e) =>
    e.events?.includes(event),
  );
  if (!endpoints.length) return noop;
  // Scoped, opt-in: several destinations would mean several bets for one
  // interval, so the combined stream refuses rather than fanning out.
  if (options?.requireSingleEndpoint && endpoints.length !== 1) return noop;


  const body = JSON.stringify({ event, ...payloadObj });
  const signatures = endpoints.map((ep) =>
    createHmac("sha256", ep.secret).update(body).digest("hex"),
  );

  const t0 = Date.now();
  const first = await Promise.all(
    endpoints.map(async (ep, i) => {
      // Per-attempt state, mutated at invocation, readable even if the fetch
      // promise rejects, aborts or never settles.
      const attemptStart: { startedAtMs: number | null } = { startedAtMs: null };
      const blank = {
        ep,
        i,
        status: null as number | null,
        ok: false,
        resBody: null as string | null,
        error: null as string | null,
        cancelled: false,
        startedAtMs: null as number | null,
      };
      // Immediately before the transport, not merely at intake.
      if (!(await allowed())) return { ...blank, cancelled: true, error: "cancelled_before_send" };
      try {
        const r = await postOnce(ep.url, body, signatures[i], event, FAST_POST_TIMEOUT_MS, (s) => {
          attemptStart.startedAtMs = s.startedAtMs;
          logAttemptStart(source, event, ep.id, 1, s.startedAtMs, targetOpenMs);
        });
        return {
          ...blank,
          status: r.status,
          ok: r.ok,
          resBody: r.body,
          startedAtMs: r.startedAtMs,
        };
      } catch (e) {
        // A thrown/aborted attempt DID start; keep its true invocation instant.
        return {
          ...blank,
          startedAtMs: attemptStart.startedAtMs,
          error: e instanceof Error ? e.message : String(e),
        };
      }
    }),
  );

  const latencyMs = Date.now() - t0;
  const delivered = first.filter((r) => r.ok).length;
  const starts = first
    .map((r) => r.startedAtMs)
    .filter((v): v is number => typeof v === "number");
  const sendStartedAtMs = starts.length ? Math.min(...starts) : null;
  const sendStartOffsetMs =
    sendStartedAtMs != null && targetOpenMs != null ? sendStartedAtMs - targetOpenMs : null;

  const payloadJson = JSON.parse(body);
  const settle = (async () => {
    await Promise.all(
      first.map(async (r) => {
        let lastStatus = r.status;
        // Start evidence was already emitted at invocation; this is the durable
        // copy of that same instant, on success AND on rejection/timeout. A
        // cancelled attempt never posted, so it stays null — never back-filled
        // with a response or settlement clock.
        const attemptOffsetMs =
          r.startedAtMs != null && targetOpenMs != null ? r.startedAtMs - targetOpenMs : null;
        await supabase.from("webhook_deliveries").insert({
          endpoint_id: r.ep.id,
          event,
          payload: payloadJson,
          status_code: r.status,
          response_body: r.resBody,
          error: r.error,
          attempt: 1,
          attempt_started_at: r.startedAtMs != null ? new Date(r.startedAtMs).toISOString() : null,
          attempt_start_offset_ms: attemptOffsetMs,
        });




        // A cancelled attempt never posted and is terminal: it must not be
        // revived here. An attempt that produced no HTTP status may still have
        // reached the bot, so it is left unresolved rather than repeated.
        const ambiguous = guard != null && !r.cancelled && r.status === null;
        if (maxAttempts > 1 && !r.ok && !r.cancelled && !ambiguous) {
          for (let attempt = 2; attempt <= Math.min(maxAttempts, BACKOFFS_MS.length); attempt++) {
            await new Promise((res) => setTimeout(res, BACKOFFS_MS[attempt - 1] ?? 2_000));
            // The kill switch, allow-list, original deadline and claim
            // ownership are re-checked before this retry actually posts.
            if (!(await allowed())) break;
            const retryStart: { startedAtMs: number | null } = { startedAtMs: null };
            try {
              const retry = await postOnce(
                r.ep.url,
                body,
                signatures[r.i],
                event,
                undefined,
                (s) => {
                  retryStart.startedAtMs = s.startedAtMs;
                  logAttemptStart(source, event, r.ep.id, attempt, s.startedAtMs, targetOpenMs);
                },
              );
              lastStatus = retry.status;
              await supabase.from("webhook_deliveries").insert({
                endpoint_id: r.ep.id,
                event,
                payload: payloadJson,
                status_code: retry.status,
                response_body: retry.body,
                attempt,
                attempt_started_at: new Date(retry.startedAtMs).toISOString(),
                attempt_start_offset_ms:
                  targetOpenMs != null ? retry.startedAtMs - targetOpenMs : null,
              });
              if (retry.ok) break;
              if (guard != null && retry.status === null) break;
            } catch (e) {
              await supabase.from("webhook_deliveries").insert({
                endpoint_id: r.ep.id,
                event,
                payload: payloadJson,
                error: e instanceof Error ? e.message : String(e),
                attempt,
                attempt_started_at:
                  retryStart.startedAtMs != null
                    ? new Date(retryStart.startedAtMs).toISOString()
                    : null,
                attempt_start_offset_ms:
                  retryStart.startedAtMs != null && targetOpenMs != null
                    ? retryStart.startedAtMs - targetOpenMs
                    : null,
              });
              if (guard != null) break;
            }

          }
        }


        await supabase
          .from("webhook_endpoints")
          .update({ last_delivery_at: new Date().toISOString(), last_status: lastStatus })
          .eq("id", r.ep.id);
      }),
    );
  })();

  return {
    delivered,
    attempted: endpoints.length,
    latencyMs,
    sentAt: new Date(t0).toISOString(),
    sendStartedAtMs,
    sendStartOffsetMs,
    settle,
  };
}



export async function deliverWebhook(
  supabase: SupabaseClient,
  event: WebhookEvent,
  payloadObj: Record<string, unknown>,
) {
  if (!OUTBOUND_WEBHOOKS_ENABLED) return { delivered: 0 };
  const source = String(payloadObj.model ?? payloadObj.model_name ?? "");
  if (!WEBHOOK_ALLOWED_MODELS.has(source)) return { delivered: 0 };

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

// ── B4x4 (a2-core-grid40-brake80) — ACTIVE directional webhook source ────────
// Emits ONLY for live, published (would_trade=true) rows. Backfilled rows,
// abstentions, counterfactuals, shadow signals and resolutions never emit.
export const B4X4_MODEL_ID = "B4x4";
export const B4X4_DECISION_POLICY_VERSION = "b4x4-v1";

export function buildB4x4WebhookPayload({ row }: { row: Record<string, any> }) {
  const targetTs = String(row.target_candle_ts);
  const startMs = new Date(targetTs).getTime();
  const startsAt = new Date(startMs).toISOString();
  const endsAt = new Date(startMs + TF_MS_15M).toISOString();
  const nowIso = new Date().toISOString();
  const direction = row.final_prediction as "GREEN" | "RED";
  // Bot contract (same as TD1-RC): GREEN → YES, RED → NO.
  const predictionLabel: "YES" | "NO" = direction === "GREEN" ? "YES" : "NO";
  const pGreen = row.a2_probability_green != null ? Number(row.a2_probability_green) : null;
  const confidence = pGreen == null
    ? 0
    : Math.round((predictionLabel === "YES" ? pGreen : 1 - pGreen) * 100);

  return {
    model: B4X4_MODEL_ID,
    model_name: "B4x4",
    model_version: "b4x4-v1",
    decision_policy_version: B4X4_DECISION_POLICY_VERSION,
    variant: row.variant ?? "a2-core-grid40-brake80",
    prospective_test_id: row.prospective_test_id ?? "B4X4_CORE_GRID40_BRAKE80_V1",
    model_artifact_sha256: null,
    model_fit_id: row.a2_model_fit_id ?? null,
    setup_type: null,

    // --- TD1-RC compatible core contract ---
    prediction: predictionLabel,
    confidence,
    decision: predictionLabel,
    trade: true,
    probability_green: pGreen,
    base_decision: row.raw_direction === "GREEN" ? "YES" : row.raw_direction === "RED" ? "NO" : null,
    override_reasons: [],

    // --- B4x4 specific audit fields ---
    direction_label: predictionLabel,
    raw_direction: row.raw_direction ?? null,
    a2_probability_green: pGreen,
    b4x4_confidence: row.confidence != null ? Number(row.confidence) : null,
    selected_route: row.selected_route ?? null,
    global_rank: row.global_rank != null ? Number(row.global_rank) : null,
    same_side_rank: row.same_side_rank != null ? Number(row.same_side_rank) : null,
    grid_cell: row.grid_cell ?? null,
    p_correct: row.p_correct != null ? Number(row.p_correct) : null,
    grid_quality_percentile: row.grid_quality_percentile != null
      ? Number(row.grid_quality_percentile) : null,
    daily_net_before: row.daily_net_before != null ? Number(row.daily_net_before) : null,
    intraday_brake_active: Boolean(row.intraday_brake_active),
    decision_reason: row.decision_reason ?? null,

    candle_starts_at: startsAt,
    candle_starts_at_mt: formatMountainTime(startsAt),
    candle_ends_at: endsAt,
    candle_ends_at_mt: formatMountainTime(endsAt),
    target_candle_close_at: endsAt,
    target_candle_ts: targetTs,

    dedupe_key: `BTC-USDT-15m-${startsAt}`,
    idempotency_key: `${row.source_prediction_id ?? row.id}:b4x4-v1`,
    prediction_id: row.source_prediction_id ?? row.id ?? null,
    b4x4_row_id: row.id ?? null,
    shadow_id: null,

    btc_price_at_prediction: null,
    market_condition: null,

    timing_status: row.timing_status ?? null,
    boundary_delta_ms: null,
    scored_at: null,

    sent_at: nowIso,
    sent_at_mt: formatMountainTime(nowIso),
    timezone: "America/Denver",
  };
}

// ── V6 (v6-r5 selective core router) — secondary directional webhook source ──
// Emits only for live, published GREEN/RED rows, and only when B4x4 has not
// published an opposing direction for the same target candle (B4x4 wins).
export const V6_MODEL_ID = "V6";
export const V6_DECISION_POLICY_VERSION = "v6-r5-selective-core-router";

export function buildV6WebhookPayload({ row }: { row: Record<string, any> }) {
  const targetTs = String(row.target_candle_ts);
  const startMs = new Date(targetTs).getTime();
  const startsAt = new Date(startMs).toISOString();
  const endsAt = new Date(startMs + TF_MS_15M).toISOString();
  const nowIso = new Date().toISOString();
  const direction = row.final_prediction as "GREEN" | "RED";
  const predictionLabel: "YES" | "NO" = direction === "GREEN" ? "YES" : "NO";
  const broad = row.broad_percentile != null ? Number(row.broad_percentile) : null;
  const anchor = row.anchor_percentile != null ? Number(row.anchor_percentile) : null;
  const strength = [broad, anchor]
    .filter((v): v is number => v != null && Number.isFinite(v))
    .reduce((best, v) => Math.max(best, Math.abs(v - 0.5)), 0);
  const confidence = Math.round((0.5 + strength) * 100);

  return {
    model: V6_MODEL_ID,
    model_name: "V6",
    model_version: row.model_version ?? "v6",
    decision_policy_version: V6_DECISION_POLICY_VERSION,
    variant: row.r5_router_version ?? "v6-r5",
    prospective_test_id: "V6_R5_SELECTIVE_CORE_ROUTER",
    model_artifact_sha256: row.model_artifact_sha256 ?? null,
    model_fit_id: row.fit_id ?? null,
    setup_type: null,

    prediction: predictionLabel,
    confidence,
    decision: predictionLabel,
    trade: true,
    probability_green: null,
    base_decision:
      row.base_v6_prediction === "GREEN" ? "YES" : row.base_v6_prediction === "RED" ? "NO" : null,
    override_reasons: [],

    direction_label: predictionLabel,
    raw_direction: row.base_v6_prediction ?? null,
    selected_route: row.r5_router_source ?? null,
    selected_component: row.selected_component ?? null,
    broad_percentile: broad,
    anchor_percentile: anchor,
    decision_reason: row.r5_router_reason ?? row.final_reason ?? null,
    b4x4_direction_at_send: row.b4x4_direction_at_send ?? null,

    candle_starts_at: startsAt,
    candle_ends_at: endsAt,
    target_candle_ts: targetTs,

    dedupe_key: `BTC-USDT-15m-${startsAt}-v6`,
    idempotency_key: `${row.prediction_id}:v6-r5`,
    prediction_id: row.prediction_id ?? null,
    v6_row_id: row.prediction_id ?? null,
    shadow_id: null,

    btc_price_at_prediction: null,
    market_condition: null,

    timing_status: row.timing_valid === false ? "LATE" : "ON_TIME",
    boundary_delta_ms: null,
    scored_at: null,

    sent_at: nowIso,
    sent_at_mt: formatMountainTime(nowIso),
    timezone: "America/Denver",
  };
}
