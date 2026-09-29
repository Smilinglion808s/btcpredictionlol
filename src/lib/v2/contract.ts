// V2 Final R1 — pure wire contract.
//
// Recorded intents keep execution = 'OFF' (worker never places orders). Betting is
// done by the betting app after the site forwards the intent (see v2/forward.server.ts,
// gated by v2_forward_settings.enabled). Sizing below is sent as policy metadata.

export const V2_MODEL_VERSION = "v2-final-r1" as const;
export const V2_SLEEVES = ["v2-direction8-r1", "v2-fade8-r1", "v2-direction45-r1"] as const;
export type V2Sleeve = (typeof V2_SLEEVES)[number];
export const V2_CHECKPOINT_OF: Record<V2Sleeve, "T8" | "T45"> = {
  "v2-direction8-r1": "T8",
  "v2-fade8-r1": "T8",
  "v2-direction45-r1": "T45",
};
/** Priority: Direction8 > Fade8 > Direction45. Lower index wins the candle. */
export const V2_PRIORITY: readonly V2Sleeve[] = V2_SLEEVES;
export const V2_EXECUTION = "OFF" as const;
export const V2_INPUT_SOURCE = "binance_spot_btcusdt";
/** Lab labels are Binance INDEX direction proxies, not spot candle outcomes. */
export const V2_LABEL_SOURCE = "binance_index_direction_proxy";
export const INTERVAL_MS = 900_000;

export const V2_STAKE_POLICY = {
  fraction_of_entry_day_opening_principal: 0.04,
  day_reset: "America/Boise midnight",
  same_dollar_stake_all_day: true,
  rounding: "floor_cents",
  cap_usd: 200,
  p2: false,
  doubling: false,
} as const;

/** 4% of the Boise-day opening principal, floored to cents, capped at $200. */
export function v2StakeCents(openingPrincipalCents: number): number | null {
  if (!Number.isFinite(openingPrincipalCents) || openingPrincipalCents <= 0) return null;
  return Math.min(Math.floor(openingPrincipalCents * 0.04), 20_000);
}

export type V2Checkpoint = {
  candle_open: string;
  checkpoint: "T8" | "T45";
  sleeve: V2Sleeve;
  side: -1 | 0 | 1 | null;
  probability: number | null;
  eligible: boolean;
  features_ready: boolean;
  reason: string | null;
  decision_at: string;
  payload: Record<string, unknown>;
};

export function validateCheckpoint(c: any, nowMs: number): { ok: true; value: V2Checkpoint } | { ok: false; error: string } {
  if (!c || typeof c !== "object" || Array.isArray(c)) return { ok: false, error: "INVALID_CHECKPOINT" };
  const open = Date.parse(c.candle_open);
  if (!Number.isFinite(open) || open % INTERVAL_MS !== 0) return { ok: false, error: "INVALID_CANDLE_OPEN" };
  if (nowMs < open || nowMs >= open + INTERVAL_MS) return { ok: false, error: "NOT_CURRENT_INTERVAL" };
  if (!V2_SLEEVES.includes(c.sleeve)) return { ok: false, error: "UNKNOWN_SLEEVE" };
  if (c.checkpoint !== V2_CHECKPOINT_OF[c.sleeve as V2Sleeve]) return { ok: false, error: "CHECKPOINT_SLEEVE_MISMATCH" };
  if (c.side !== null && ![-1, 0, 1].includes(c.side)) return { ok: false, error: "INVALID_SIDE" };
  if (c.probability !== null && !(typeof c.probability === "number" && c.probability >= 0 && c.probability <= 1))
    return { ok: false, error: "INVALID_PROBABILITY" };
  if (typeof c.eligible !== "boolean" || typeof c.features_ready !== "boolean") return { ok: false, error: "INVALID_FLAGS" };
  if (c.eligible && (!c.features_ready || (c.side !== 1 && c.side !== -1))) return { ok: false, error: "ELIGIBLE_WITHOUT_SIDE" };
  const decided = Date.parse(c.decision_at);
  if (!Number.isFinite(decided) || decided < open || decided > nowMs + 2_000) return { ok: false, error: "INVALID_DECISION_AT" };
  if (c.eligible) {
    const sec = c.checkpoint === "T8" ? 8 : 45;
    if (decided < open + sec * 1000 || decided >= open + (sec + 1) * 1000) return { ok: false, error: "ELIGIBLE_OUTSIDE_WINDOW" };
  }
  if (c.reason != null && (typeof c.reason !== "string" || c.reason.length > 200)) return { ok: false, error: "INVALID_REASON" };
  const payload = c.payload ?? {};
  if (typeof payload !== "object" || Array.isArray(payload)) return { ok: false, error: "INVALID_PAYLOAD" };
  return {
    ok: true,
    value: {
      candle_open: new Date(open).toISOString(),
      checkpoint: c.checkpoint,
      sleeve: c.sleeve,
      side: c.side,
      probability: c.probability,
      eligible: c.eligible,
      features_ready: c.features_ready,
      reason: c.reason ?? null,
      decision_at: new Date(decided).toISOString(),
      payload,
    },
  };
}

/** Pick the candle's single intent from eligible sleeves by priority. */
export function selectIntent(rows: { sleeve: V2Sleeve; eligible: boolean; side: number | null }[]): V2Sleeve | null {
  for (const s of V2_PRIORITY) if (rows.some((r) => r.sleeve === s && r.eligible && (r.side === 1 || r.side === -1))) return s;
  return null;
}

// ---------------------------------------------------------------- dashboard sleeve status
export type V2RecordRow = {
  checkpoint: string; sleeve: string; side: number | null; eligible: boolean;
  features_ready: boolean; reason: string | null; sleeve_name?: string | null;
};
export type V2SleeveStatus = { text: string; tone: "call" | "muted" | "bad" };

/** A T+8 row counts as a scored combined abstention only with the exact frozen shape. */
export const isScoredT8Abstain = (r: V2RecordRow) =>
  r.checkpoint === "T8" && !r.eligible && r.features_ready && r.reason == null && r.side === 0 && r.sleeve_name === "ABSTAIN";

/** Honest per-sleeve status from the recorded T+8/T+45 rows only (never inferred confidence). */
export function deriveSleeveStatus(rows: V2RecordRow[], msIntoCandle: number): Record<V2Sleeve, V2SleeveStatus> {
  const side = (s: number | null) => (s === 1 ? "UP" : "DOWN");
  const t8 = rows.find((r) => r.checkpoint === "T8" && r.eligible) ?? rows.find((r) => r.checkpoint === "T8");
  const t45 = rows.find((r) => r.checkpoint === "T45");
  const skip: V2SleeveStatus = { text: "skipped · earlier call", tone: "muted" };
  const noCall: V2SleeveStatus = { text: "no call", tone: "muted" };
  if (t8?.eligible && t8.sleeve === "v2-direction8-r1")
    return { "v2-direction8-r1": { text: `call ${side(t8.side)}`, tone: "call" }, "v2-fade8-r1": skip, "v2-direction45-r1": skip };
  if (t8?.eligible && t8.sleeve === "v2-fade8-r1")
    return { "v2-direction8-r1": { text: "abstained", tone: "muted" }, "v2-fade8-r1": { text: `call ${side(t8.side)}`, tone: "call" }, "v2-direction45-r1": skip };
  if (t8 && isScoredT8Abstain(t8)) {
    const d45: V2SleeveStatus = t45
      ? t45.eligible ? { text: `call ${side(t45.side)}`, tone: "call" }
        : { text: t45.reason ? `no call · ${t45.reason}` : "no call", tone: t45.reason ? "bad" : "muted" }
      : msIntoCandle < 46_000 ? { text: "waiting for 45s", tone: "muted" } : { text: "no 45s record", tone: "bad" };
    return { "v2-direction8-r1": noCall, "v2-fade8-r1": noCall, "v2-direction45-r1": d45 };
  }
  if (t8) {
    const f: V2SleeveStatus = { text: `failed · ${t8.reason ?? "not scored"}`, tone: "bad" };
    return { "v2-direction8-r1": f, "v2-fade8-r1": f, "v2-direction45-r1": { text: "blocked · 8s not scored", tone: "bad" } };
  }
  if (msIntoCandle < 9_000) {
    const w: V2SleeveStatus = { text: "waiting for 8s", tone: "muted" };
    return { "v2-direction8-r1": w, "v2-fade8-r1": w, "v2-direction45-r1": w };
  }
  const m: V2SleeveStatus = { text: "no 8s record", tone: "bad" };
  return { "v2-direction8-r1": m, "v2-fade8-r1": m, "v2-direction45-r1": { text: "blocked · 8s not scored", tone: "bad" } };
}

// ---------------------------------------------------------------- heartbeat
const BOOL_FIELDS = ["package_ok", "model_valid", "refit_required", "history_ready", "feed_connected", "feed_ready", "preopen_current", "prediction_ready"] as const;
const NUM_FIELDS = ["history_bars", "feed_age_ms", "feed_reconnects", "clock_skew_ms", "outbox_pending", "uptime_s"] as const;
const TIME_FIELDS = ["model_valid_until", "history_last_open", "preopen_target"] as const;
const SAFE_TEXT = /^[\w .:+\-()\/]{0,120}$/;
const ISO = /^\d{4}-\d{2}-\d{2}[T ][\d:.]+(Z|[+-]\d{2}:?\d{2})?$/;

/** Allowlisted operational heartbeat fields only. Never principal, cash, secrets or raw exceptions. */
export function sanitizeStatus(s: unknown): Record<string, unknown> {
  const src = s && typeof s === "object" && !Array.isArray(s) ? (s as Record<string, unknown>) : {};
  const out: Record<string, unknown> = {};
  if (src.mode === "shadow" || src.mode === "record") out.mode = src.mode;
  for (const k of BOOL_FIELDS) if (typeof src[k] === "boolean") out[k] = src[k];
  for (const k of NUM_FIELDS) {
    const v = src[k];
    if (typeof v === "number" && Number.isFinite(v) && Math.abs(v) < 1e12) out[k] = Math.round(v);
  }
  for (const k of TIME_FIELDS) {
    const v = src[k];
    if (typeof v === "string" && v.length <= 40 && ISO.test(v)) out[k] = v;
  }
  const lc = src.last_checkpoint as Record<string, unknown> | null | undefined;
  if (lc && typeof lc === "object" && !Array.isArray(lc)) {
    const r: Record<string, unknown> = {};
    if (typeof lc.candle_open === "string" && ISO.test(lc.candle_open)) r.candle_open = lc.candle_open;
    if (lc.checkpoint === "T8" || lc.checkpoint === "T45") r.checkpoint = lc.checkpoint;
    if (V2_SLEEVES.includes(lc.sleeve as V2Sleeve)) r.sleeve = lc.sleeve;
    if (typeof lc.eligible === "boolean") r.eligible = lc.eligible;
    if (typeof lc.reason === "string" && SAFE_TEXT.test(lc.reason)) r.reason = lc.reason;
    out.last_checkpoint = r;
  }
  if (Array.isArray(src.errors))
    out.errors = src.errors.filter((e): e is string => typeof e === "string" && SAFE_TEXT.test(e)).slice(0, 10);
  out.execution = V2_EXECUTION;
  return out;
}

/** Read at most `max` bytes; returns null if the body is larger. */
export async function readBounded(request: Request, max: number): Promise<string | null> {
  const len = Number(request.headers.get("content-length") ?? "0");
  if (Number.isFinite(len) && len > max) return null;
  if (!request.body) return "";
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) { await reader.cancel().catch(() => {}); return null; }
    chunks.push(value);
  }
  const buf = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) { buf.set(c, o); o += c.byteLength; }
  return new TextDecoder().decode(buf);
}
