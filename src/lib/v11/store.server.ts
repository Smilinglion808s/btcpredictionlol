// Version 1.1 — persistence (server only).
//
// Writes ONLY to v11_* tables. Reads c85_targets / c85_outbox / t45_features
// strictly read-only: no statement here can mutate original V1 state, its
// checkpoints, its outbox or any other model's tables.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  V11_CONTEXT_TABLE,
  V11_DECISIONS_TABLE,
  V11_HEADS_TABLE,
  V11_SCORES_TABLE,
  V11_STATE_KEY,
  V11_STATE_TABLE,
  V11_T45_BASE_ORDER,
  V11_VOL_SOURCE,
  V1_MODEL_VERSION,
  v11EventKey,
} from "./config";
import type { V11Head, V11Scaler, V11TrainingRow } from "./head";
import type { V1LegSnapshot } from "./decision";

const V11_VECTORS_TABLE = "v11_vectors";
const T45_FEATURE_VERSION = "t45-features-r1";

export interface V11ContextRow {
  targetTs: string;
  ticker: string;
  inputValid: boolean;
  label: number | null;
  settlementTs: string | null;
  feats: Record<string, number>;
}

export async function readContextRow(
  sb: SupabaseClient,
  targetTs: string,
): Promise<V11ContextRow | null> {
  const { data } = await sb
    .from(V11_CONTEXT_TABLE)
    .select("target_ts, ticker, input_valid, label, settlement_ts, feats")
    .eq("target_ts", targetTs)
    .maybeSingle();
  if (!data) return null;
  return {
    targetTs: new Date(data.target_ts as string).toISOString(),
    ticker: (data.ticker as string) ?? "",
    inputValid: Boolean(data.input_valid),
    label: data.label === null || data.label === undefined ? null : Number(data.label),
    settlementTs: (data.settlement_ts as string | null) ?? null,
    feats: (data.feats ?? {}) as Record<string, number>,
  };
}

/** Live context for a target straight from the committed V1 row (read-only). */
export async function readLiveContext(
  sb: SupabaseClient,
  targetTs: string,
): Promise<V11ContextRow | null> {
  const { data } = await sb
    .from("c85_targets")
    .select("target_open_utc, ticker, input_valid, features")
    .eq("model_version", V1_MODEL_VERSION)
    .eq("target_open_utc", targetTs)
    .maybeSingle();
  if (!data) return null;
  const features = (data.features ?? {}) as Record<string, unknown>;
  const d60 = (features["direction60"] ?? null) as Record<string, number> | null;
  if (!d60) return null;
  return {
    targetTs: new Date(data.target_open_utc as string).toISOString(),
    ticker: (data.ticker as string) ?? "",
    inputValid: Boolean(data.input_valid),
    label: null,
    settlementTs: null,
    feats: d60,
  };
}

/** Persist (idempotently) the context row used for a target. */
export async function upsertContextRow(
  sb: SupabaseClient,
  row: V11ContextRow,
  source: string,
): Promise<void> {
  await sb.from(V11_CONTEXT_TABLE).upsert(
    {
      target_ts: row.targetTs,
      ticker: row.ticker,
      input_valid: row.inputValid,
      label: row.label,
      settlement_ts: row.settlementTs,
      feats: row.feats,
      source,
    },
    { onConflict: "target_ts" },
  );
}

/** T45 PriceFlow inputs for a target (read-only shared table). */
export async function readT45Inputs(
  sb: SupabaseClient,
  targetTs: string,
): Promise<Record<string, number> | null> {
  const { data } = await sb
    .from("t45_features")
    .select(["target_ts", ...V11_T45_BASE_ORDER].join(", "))
    .eq("feature_version", T45_FEATURE_VERSION)
    .eq("target_ts", targetTs)
    .maybeSingle();
  if (!data) return null;
  const out: Record<string, number> = {};
  for (const n of V11_T45_BASE_ORDER) out[n] = Number((data as Record<string, unknown>)[n]);
  return out;
}

/**
 * The previous 95 official-opportunity values of the volatility source, in
 * chronological order (the current row's own value is supplied separately).
 */
export async function readVolHistory(
  sb: SupabaseClient,
  targetTs: string,
  limit = 95,
): Promise<number[]> {
  const { data } = await sb
    .from(V11_CONTEXT_TABLE)
    .select("target_ts, feats")
    .lt("target_ts", targetTs)
    .order("target_ts", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as { feats: Record<string, number> }[];
  return rows
    .reverse()
    .map((r) => Number(r.feats?.[V11_VOL_SOURCE]))
    .map((v) => (Number.isFinite(v) ? v : NaN));
}

/**
 * Prior scores over the previous official opportunities, chronological.
 * `null` marks an observed-but-invalid opportunity (needed for availability).
 */
export async function readPriorScores(
  sb: SupabaseClient,
  targetTs: string,
  limit = 768,
): Promise<{ confidence: number | null }[]> {
  const { data } = await sb
    .from(V11_SCORES_TABLE)
    .select("target_ts, confidence")
    .lt("target_ts", targetTs)
    .order("target_ts", { ascending: false })
    .limit(limit);
  const rows = (data ?? []) as { confidence: number | null }[];
  return rows
    .reverse()
    .map((r) => ({
      confidence:
        r.confidence === null || !Number.isFinite(Number(r.confidence))
          ? null
          : Number(r.confidence),
    }));
}

export interface V11ScoreRecord {
  targetTs: string;
  ticker: string;
  headDate: string | null;
  probability: number | null;
  confidence: number | null;
  rank: number | null;
  rankHistory: number;
  availability: number | null;
  admissionGate: number | null;
  valid: boolean;
  reason: string;
}

/** Append-only: a score is written exactly once per official opportunity. */
export async function appendScore(
  sb: SupabaseClient,
  rec: V11ScoreRecord,
): Promise<"inserted" | "exists"> {
  const { error } = await sb.from(V11_SCORES_TABLE).insert({
    target_ts: rec.targetTs,
    ticker: rec.ticker,
    head_date: rec.headDate,
    probability: rec.probability,
    confidence: rec.confidence,
    rank: rec.rank,
    rank_history: rec.rankHistory,
    availability: rec.availability,
    admission_gate: rec.admissionGate,
    valid: rec.valid,
    reason: rec.reason,
  });
  if (error) {
    if (error.code === "23505") return "exists";
    throw error;
  }
  return "inserted";
}

export async function scoreExists(
  sb: SupabaseClient,
  targetTs: string,
): Promise<boolean> {
  const { data } = await sb
    .from(V11_SCORES_TABLE)
    .select("target_ts")
    .eq("target_ts", targetTs)
    .maybeSingle();
  return Boolean(data);
}

/** Immutable read of the ORIGINAL V1 leg, including its send-claim state. */
export async function readV1Snapshot(
  sb: SupabaseClient,
  targetTs: string,
): Promise<V1LegSnapshot> {
  const { data, error } = await sb
    .from("c85_targets")
    .select(
      "ticker, status, input_valid, final_side, features, gate_reasons, webhook_status, webhook_dedupe_key",
    )
    .eq("model_version", V1_MODEL_VERSION)
    .eq("target_open_utc", targetTs)
    .maybeSingle();
  if (error) {
    return {
      committed: false,
      status: null,
      inputValid: false,
      finalSide: null,
      reason: null,
      ordinaryFloorOpen: null,
      sendClaim: "unknown",
    };
  }
  if (!data) {
    return {
      committed: false,
      status: null,
      inputValid: false,
      finalSide: null,
      reason: null,
      ordinaryFloorOpen: null,
      sendClaim: "none",
    };
  }
  const features = (data.features ?? {}) as Record<string, unknown>;
  const liteA = (features["lite_a"] ?? {}) as Record<string, unknown>;
  const floor = (features["daily_floor"] ?? {}) as Record<string, unknown>;
  const claim = await readV1SendClaim(
    sb,
    (data.ticker as string) ?? "",
    targetTs,
    (data.webhook_status as string | null) ?? null,
    (data.webhook_dedupe_key as string | null) ?? null,
  );
  return {
    committed: true,
    status: (data.status as string | null) ?? null,
    inputValid: Boolean(data.input_valid),
    finalSide:
      data.final_side === null || data.final_side === undefined
        ? null
        : Number(data.final_side),
    reason: (liteA["reason"] as string | null) ?? null,
    ordinaryFloorOpen:
      floor["ordinary_floor_allows"] === undefined
        ? null
        : Boolean(floor["ordinary_floor_allows"]),
    sendClaim: claim,
  };
}

/**
 * Cross-leg exclusion. A different v11 outbox key does NOT guarantee
 * exclusivity, so the shared canonical V1 claim is consulted directly: any
 * claim row, any non-null webhook status, or a read failure blocks fallback.
 */
export async function readV1SendClaim(
  sb: SupabaseClient,
  ticker: string,
  targetTs: string,
  webhookStatus: string | null,
  dedupeKey: string | null,
): Promise<V1LegSnapshot["sendClaim"]> {
  if (webhookStatus) {
    const s = webhookStatus.toUpperCase();
    if (s === "SENT" || s === "DELIVERED") return "sent";
    if (s === "PENDING" || s === "CLAIMED" || s === "IN_FLIGHT") return "claimed";
    return "failed";
  }
  const key = dedupeKey ?? `${V1_MODEL_VERSION}:${ticker}:${new Date(targetTs).toISOString()}`;
  const { data, error } = await sb
    .from("c85_outbox")
    .select("dedupe_key, status")
    .eq("dedupe_key", key)
    .limit(1);
  if (error) return "unknown";
  const rows = (data ?? []) as { status: string | null }[];
  if (rows.length === 0) return "none";
  const s = (rows[0].status ?? "").toUpperCase();
  if (s === "SENT" || s === "DELIVERED") return "sent";
  if (s === "FAILED" || s === "ERROR" || s === "EXPIRED") return "failed";
  return "claimed";
}

export interface V11DecisionRecord {
  targetTs: string;
  ticker: string;
  leg: string | null;
  side: number;
  reason: string;
  probability: number | null;
  rank: number | null;
  admissionGate: number | null;
  headDate: string | null;
  v1Status: string | null;
  v1Reason: string | null;
  v1FinalSide: number | null;
  v1FloorOpen: boolean | null;
  v1SendClaim: string;
  strategy: Record<string, unknown>;
}

/** Append-only, one row per interval; duplicates are refused by the PK. */
export async function insertDecision(
  sb: SupabaseClient,
  rec: V11DecisionRecord,
): Promise<"inserted" | "exists"> {
  const { error } = await sb.from(V11_DECISIONS_TABLE).insert({
    target_ts: rec.targetTs,
    ticker: rec.ticker,
    event_key: v11EventKey(rec.ticker, rec.targetTs),
    leg: rec.leg,
    side: rec.side,
    reason: rec.reason,
    probability: rec.probability,
    rank: rec.rank,
    admission_gate: rec.admissionGate,
    head_date: rec.headDate,
    v1_status: rec.v1Status,
    v1_reason: rec.v1Reason,
    v1_final_side: rec.v1FinalSide,
    v1_floor_open: rec.v1FloorOpen,
    v1_send_claim: rec.v1SendClaim,
    strategy: rec.strategy,
    dispatch_enabled: false,
  });
  if (error) {
    if (error.code === "23505") return "exists";
    throw error;
  }
  return "inserted";
}

export async function readHeadForDate(
  sb: SupabaseClient,
  fitDate: string,
): Promise<V11Head | null> {
  const { data } = await sb
    .from(V11_HEADS_TABLE)
    .select("*")
    .eq("fit_date", fitDate)
    .maybeSingle();
  if (!data) return null;
  return {
    fitDate: data.fit_date as string,
    expiresAt: new Date(data.expires_at as string).toISOString(),
    scaler: data.scaler as V11Scaler,
    coefficients: data.coefficients as number[],
    intercept: Number(data.intercept),
    trainingRowCount: Number(data.training_rows),
    trainingStartTs: data.training_start_ts as string,
    trainingEndTs: data.training_end_ts as string,
    trainingFingerprint: data.training_fingerprint as string,
    converged: Boolean(data.converged),
    iterations: Number(data.iterations),
    gradientNorm: Number(data.gradient_norm),
  };
}

export async function writeHead(sb: SupabaseClient, head: V11Head): Promise<void> {
  const { error } = await sb.from(V11_HEADS_TABLE).insert({
    fit_date: head.fitDate,
    expires_at: head.expiresAt,
    scaler: head.scaler,
    coefficients: head.coefficients,
    intercept: head.intercept,
    training_rows: head.trainingRowCount,
    training_start_ts: head.trainingStartTs,
    training_end_ts: head.trainingEndTs,
    training_fingerprint: head.trainingFingerprint,
    converged: head.converged,
    iterations: head.iterations,
    gradient_norm: head.gradientNorm,
  });
  if (error && error.code !== "23505") throw error;
}

/** Training rows for a fit: materialised 80-input vectors with Kalshi labels. */
export async function readTrainingRows(
  sb: SupabaseClient,
  fromTs: string,
  toTs: string,
): Promise<V11TrainingRow[]> {
  const out: V11TrainingRow[] = [];
  const page = 1000;
  for (let offset = 0; ; offset += page) {
    const { data, error } = await sb
      .from(V11_VECTORS_TABLE)
      .select("target_ts, vector, label, settlement_ts")
      .eq("valid", true)
      .gte("target_ts", fromTs)
      .lt("target_ts", toTs)
      .not("label", "is", null)
      .order("target_ts", { ascending: true })
      .range(offset, offset + page - 1);
    if (error) throw error;
    const rows = (data ?? []) as {
      target_ts: string;
      vector: number[];
      label: number;
      settlement_ts: string | null;
    }[];
    for (const r of rows) {
      if (!r.settlement_ts) continue;
      out.push({
        targetTs: new Date(r.target_ts).toISOString(),
        vector: r.vector,
        label: Number(r.label),
        settlementTs: new Date(r.settlement_ts).toISOString(),
      });
    }
    if (rows.length < page) break;
  }
  return out;
}

export async function upsertVector(
  sb: SupabaseClient,
  row: {
    targetTs: string;
    vector: number[] | null;
    vol: number | null;
    valid: boolean;
    missing: string[];
    label: number | null;
    settlementTs: string | null;
  },
): Promise<void> {
  const { error } = await sb.from(V11_VECTORS_TABLE).upsert(
    {
      target_ts: row.targetTs,
      vector: row.vector,
      vol: row.vol,
      valid: row.valid,
      missing: row.missing,
      label: row.label,
      settlement_ts: row.settlementTs,
    },
    { onConflict: "target_ts" },
  );
  if (error) throw error;
}

export interface V11State {
  lastProcessedTs: string | null;
  lastFitDate: string | null;
}

export async function readState(sb: SupabaseClient): Promise<V11State> {
  const { data } = await sb
    .from(V11_STATE_TABLE)
    .select("last_processed_ts, last_fit_date")
    .eq("state_key", V11_STATE_KEY)
    .maybeSingle();
  return {
    lastProcessedTs: (data?.last_processed_ts as string | null) ?? null,
    lastFitDate: (data?.last_fit_date as string | null) ?? null,
  };
}

/** Durable checkpoint; never moves backwards. */
export async function advanceState(
  sb: SupabaseClient,
  patch: Partial<V11State>,
): Promise<void> {
  const current = await readState(sb);
  const next = {
    state_key: V11_STATE_KEY,
    last_processed_ts:
      patch.lastProcessedTs &&
      (!current.lastProcessedTs ||
        Date.parse(patch.lastProcessedTs) > Date.parse(current.lastProcessedTs))
        ? patch.lastProcessedTs
        : current.lastProcessedTs,
    last_fit_date: patch.lastFitDate ?? current.lastFitDate,
    updated_at: new Date().toISOString(),
  };
  const { error } = await sb
    .from(V11_STATE_TABLE)
    .upsert(next, { onConflict: "state_key" });
  if (error) throw error;
}
