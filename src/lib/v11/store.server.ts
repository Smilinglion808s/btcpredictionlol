// Version 1.1 — persistence (server only).
//
// Writes ONLY to v11_* tables. Reads c85_targets / c85_outbox / t45_features
// strictly read-only: no statement here can mutate original V1 state, its
// checkpoints, its outbox or any other model's tables.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  V11_CONFIG_FINGERPRINT,
  V11_CONTEXT_TABLE,
  V11_DECISIONS_TABLE,
  V11_HEADS_TABLE,
  V11_SCORES_TABLE,
  V11_STATE_KEY,
  V11_STATE_TABLE,
  V11_FEATURE_ORDER_HASH,
  V11_T45_BASE_ORDER,
  V11_VOL_SOURCE,
  V1_MODEL_VERSION,
  v11EventKey,
} from "./config";
import type { V11Head, V11Scaler, V11TrainingRow } from "./head";
import type { V1LegSnapshot } from "./decision";

const V11_VECTORS_TABLE = "v11_vectors";

/**
 * SQL NULL is MISSING, never zero. `Number(null)` is 0 and `Number("")` is 0,
 * both of which would silently impute a value the model never observed.
 */
export function numOrNaN(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}
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
  const { data, error } = await sb
    .from(V11_CONTEXT_TABLE)
    .select("target_ts, ticker, input_valid, label, settlement_ts, feats")
    .eq("target_ts", targetTs)
    .maybeSingle();
  if (error) throw error;
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

/**
 * Live context for a target from the committed V1 row (read-only).
 *
 * A DB failure is NOT "no model row": it is raised so the caller records a read
 * failure instead of silently scoring the interval as missing.
 */
export async function readLiveContext(
  sb: SupabaseClient,
  targetTs: string,
): Promise<(V11ContextRow & { runMode: string | null; lastReceiptNs: string | null; publicationOffsetMs: number | null }) | null> {
  const { data, error } = await sb
    .from("c85_targets")
    .select(
      "target_open_utc, ticker, features, run_mode, last_receipt_ns, publication_offset_ms",
    )
    .eq("model_version", V1_MODEL_VERSION)
    .eq("target_open_utc", targetTs)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const features = (data.features ?? {}) as Record<string, unknown>;
  const d60 = (features["direction60"] ?? null) as Record<string, number> | null;
  if (!d60) return null;
  const pubOff = data.publication_offset_ms;
  return {
    targetTs: new Date(data.target_open_utc as string).toISOString(),
    ticker: (data.ticker as string) ?? "",
    // Strictly `=== true`: the string "false" must never be coerced to true.
    inputValid: features["input_valid"] === true,
    label: null,
    settlementTs: null,
    feats: d60,
    runMode: (data.run_mode as string | null) ?? null,
    lastReceiptNs:
      data.last_receipt_ns === null || data.last_receipt_ns === undefined
        ? null
        : String(data.last_receipt_ns),
    publicationOffsetMs:
      pubOff === null || pubOff === undefined ? null : Number(pubOff),
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
  return (await readT45InputsTimed(sb, targetTs))?.feats ?? null;
}

/**
 * T45 inputs plus their ACTUAL persistence instant. `feature_cutoff_ts` is an
 * event-time boundary (exactly T+45s) and must never be read as "available at
 * 45000ms": `created_at` is the real receipt/persist time and is typically a
 * few hundred milliseconds later.
 */
export async function readT45InputsTimed(
  sb: SupabaseClient,
  targetTs: string,
): Promise<{ feats: Record<string, number>; persistedAt: string | null } | null> {
  const { data, error } = await sb
    .from("t45_features")
    .select(["target_ts", "created_at", ...V11_T45_BASE_ORDER].join(", "))
    .eq("feature_version", T45_FEATURE_VERSION)
    .eq("target_ts", targetTs)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const rec = data as unknown as Record<string, unknown>;
  const feats: Record<string, number> = {};
  // NULL stays NaN: a missing input must invalidate the row, not become 0.
  for (const n of V11_T45_BASE_ORDER) feats[n] = numOrNaN(rec[n]);
  return { feats, persistedAt: (rec.created_at as string | null) ?? null };
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
  const { data, error } = await sb
    .from(V11_CONTEXT_TABLE)
    .select("target_ts, feats")
    .lt("target_ts", targetTs)
    .order("target_ts", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as { feats: Record<string, number> }[];
  return rows.reverse().map((r) => numOrNaN(r.feats?.[V11_VOL_SOURCE]));
}

/**
 * The last 768 FINITE historical confidences, chronological.
 *
 * The rank clock counts FINITE confidences, not calendar opportunities: filter
 * out invalid/NULL scores FIRST, then take the newest 768. Truncating to 768
 * opportunities before filtering silently shortens the window whenever the
 * feed had gaps.
 */
export async function readPriorConfidences(
  sb: SupabaseClient,
  targetTs: string,
  limit = 768,
): Promise<number[]> {
  const { data, error } = await sb
    .from(V11_SCORES_TABLE)
    .select("target_ts, confidence")
    .lt("target_ts", targetTs)
    .eq("valid", true)
    .not("confidence", "is", null)
    .order("target_ts", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as { confidence: number | null }[];
  return rows
    .reverse()
    .map((r) => numOrNaN(r.confidence))
    .filter((v) => Number.isFinite(v));
}

/**
 * The last 768 OFFICIAL OPPORTUNITIES, chronological, invalid ones included.
 * `null` marks an observed-but-unscored opportunity. This is the availability
 * clock and is deliberately different from the rank clock above.
 */
export async function readPriorOpportunities(
  sb: SupabaseClient,
  targetTs: string,
  limit = 768,
): Promise<(number | null)[]> {
  const { data, error } = await sb
    .from(V11_SCORES_TABLE)
    .select("target_ts, confidence, valid")
    .lt("target_ts", targetTs)
    .order("target_ts", { ascending: false })
    .limit(limit);
  if (error) throw error;
  const rows = (data ?? []) as { confidence: number | null; valid: boolean }[];
  return rows.reverse().map((r) => {
    if (!r.valid) return null;
    const c = numOrNaN(r.confidence);
    return Number.isFinite(c) ? c : null;
  });
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

/**
 * Immutable read of the ORIGINAL V1 leg, including its send-claim state.
 * Throws on a DB failure — a failed read is never reported as "no V1 row".
 */
export async function readV1Snapshot(
  sb: SupabaseClient,
  targetTs: string,
): Promise<V1LegSnapshot> {
  const { data, error } = await sb
    .from("c85_targets")
    .select(
      "ticker, status, run_mode, final_side, features, gate_reasons, webhook_status, webhook_dedupe_key, publication_offset_ms, last_receipt_ns",
    )
    .eq("model_version", V1_MODEL_VERSION)
    .eq("target_open_utc", targetTs)
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    return {
      committed: false,
      status: null,
      runMode: null,
      inputValid: false,
      finalSide: null,
      reason: null,
      ordinaryFloorOpen: null,
      sendClaim: "none",
      publicationOffsetMs: null,
      lastReceiptNs: null,
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
  // `=== true` on both flags: JSON "false"/"0"/"" must not become true.
  const floorRaw = floor["ordinary_floor_allows"];
  return {
    committed: true,
    status: (data.status as string | null) ?? null,
    runMode: (data.run_mode as string | null) ?? null,
    inputValid: features["input_valid"] === true,
    finalSide:
      data.final_side === null || data.final_side === undefined
        ? null
        : Number(data.final_side),
    reason: (liteA["reason"] as string | null) ?? null,
    ordinaryFloorOpen:
      floorRaw === undefined || floorRaw === null ? null : floorRaw === true,
    sendClaim: claim,
    publicationOffsetMs:
      data.publication_offset_ms === null || data.publication_offset_ms === undefined
        ? null
        : Number(data.publication_offset_ms),
    lastReceiptNs:
      data.last_receipt_ns === null || data.last_receipt_ns === undefined
        ? null
        : String(data.last_receipt_ns),
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
    // A claim read failure is "unknown", which is never fallback-eligible.
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
  /** Event-time feature cutoff (always 45000ms) — NOT an availability claim. */
  eventCutoffOffsetMs: number;
  /** Measured offset at which the T45 inputs were actually persisted. */
  inputsPersistedOffsetMs: number | null;
  /** Measured offset at which this decision was produced. */
  decisionOffsetMs: number | null;
  publicationCeilingMs: number;
  withinPublicationCeiling: boolean | null;
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
    event_cutoff_offset_ms: rec.eventCutoffOffsetMs,
    inputs_persisted_offset_ms: rec.inputsPersistedOffsetMs,
    decision_offset_ms: rec.decisionOffsetMs,
    publication_ceiling_ms: rec.publicationCeilingMs,
    within_publication_ceiling: rec.withinPublicationCeiling,
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
    cutoffTs: data.cutoff_ts ? new Date(data.cutoff_ts as string).toISOString() : null,
    featureOrderHash: (data.feature_order_hash as string | null) ?? null,
    configFingerprint: (data.config_fingerprint as string | null) ?? null,
    maxTrainingSettlementTs: data.max_training_settlement_ts
      ? new Date(data.max_training_settlement_ts as string).toISOString()
      : null,
    quarantined: data.quarantined === true,
    quarantineReason: (data.quarantine_reason as string | null) ?? null,
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

/**
 * Upsert, not insert-and-ignore: a refit for an existing fit_date REPLACES the
 * head. Ignoring the duplicate silently kept stale heads alive after a data
 * correction.
 */
export async function writeHead(sb: SupabaseClient, head: V11Head): Promise<void> {
  const { error } = await sb.from(V11_HEADS_TABLE).upsert({
    fit_date: head.fitDate,
    cutoff_ts: head.cutoffTs,
    feature_order_hash: head.featureOrderHash ?? V11_FEATURE_ORDER_HASH,
    config_fingerprint: head.configFingerprint ?? V11_CONFIG_FINGERPRINT,
    max_training_settlement_ts: head.maxTrainingSettlementTs,
    quarantined: head.quarantined === true,
    quarantine_reason: head.quarantineReason ?? null,
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
  }, { onConflict: "fit_date" });
  if (error) throw error;
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
  /** Monotonic counter bumped by every committed observation. */
  stateVersion?: number | null;
}

export async function readState(sb: SupabaseClient): Promise<V11State> {
  const { data, error } = await sb
    .from(V11_STATE_TABLE)
    .select("last_processed_ts, last_fit_date, state_version")
    .eq("state_key", V11_STATE_KEY)
    .maybeSingle();
  if (error) throw error;
  const raw = (data?.last_processed_ts as string | null) ?? null;
  return {
    lastProcessedTs: raw ? new Date(raw).toISOString() : null,
    lastFitDate: (data?.last_fit_date as string | null) ?? null,
    stateVersion:
      data?.state_version === null || data?.state_version === undefined
        ? null
        : Number(data.state_version),
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

/**
 * ATOMIC ORDERED COMMIT.
 *
 * One database transaction under a single global Version 1.1 lock writes the
 * score, the decision and the checkpoint. Beyond atomicity it enforces the
 * ORDER requirements, which the caller cannot enforce from outside:
 *  - `expectedPrevTs` / `expectedStateVersion`: if the checkpoint moved while
 *    this observation was being computed, its rank/availability were derived
 *    from a state that no longer exists, so the commit is REJECTED as stale
 *    and the caller recomputes.
 *  - a later target can never skip an official opportunity that still has no
 *    decision (`PREDECESSOR_MISSING`).
 *  - a half-written pair from a crash is repaired into ONE canonical pair; the
 *    already-stored row always wins.
 *  - a fallback call is re-checked against the frozen V1 leg and its outbox
 *    INSIDE the transaction, so a V1 send that lands concurrently excludes it.
 */
export interface V11CommitOutcome {
  committed: boolean;
  duplicate: boolean;
  stale: boolean;
  gap: boolean;
  excluded: boolean;
  outOfOrder: boolean;
  repaired: boolean;
  reason: string | null;
  scoreWritten: boolean;
  decisionWritten: boolean;
  lastProcessedTs: string | null;
  stateVersion: number | null;
  firstMissingTs: string | null;
}

export async function commitObservation(
  sb: SupabaseClient,
  targetTs: string,
  score: Record<string, unknown>,
  decision: Record<string, unknown>,
  expected: {
    prevTs?: string | null;
    stateVersion?: number | null;
    allowBackfill?: boolean;
  } = {},
): Promise<V11CommitOutcome> {
  const { data, error } = await sb.rpc("v11_commit_observation", {
    p_target_ts: targetTs,
    p_score: score,
    p_decision: decision,
    p_expected_prev_ts: expected.prevTs ?? null,
    p_expected_state_version:
      expected.stateVersion === undefined ? null : expected.stateVersion,
    p_allow_backfill: expected.allowBackfill === true,
  });
  if (error) throw error;
  const r = (data ?? {}) as Record<string, unknown>;
  const lp = (r.last_processed_ts as string | null) ?? null;
  return {
    committed: r.committed === true,
    duplicate: r.duplicate === true,
    stale: r.stale === true,
    gap: r.gap === true,
    excluded: r.excluded === true,
    outOfOrder: r.out_of_order === true,
    repaired: r.repaired === true,
    reason: (r.reason as string | null) ?? null,
    scoreWritten: r.score_written === true,
    decisionWritten: r.decision_written === true,
    lastProcessedTs: lp ? new Date(lp).toISOString() : null,
    stateVersion:
      r.state_version === null || r.state_version === undefined
        ? null
        : Number(r.state_version),
    firstMissingTs: r.first_missing_ts
      ? new Date(r.first_missing_ts as string).toISOString()
      : null,
  };
}

/** Is a committed decision already present for this interval? */
export async function decisionExists(
  sb: SupabaseClient,
  targetTs: string,
): Promise<boolean> {
  const { data, error } = await sb
    .from(V11_DECISIONS_TABLE)
    .select("target_ts")
    .eq("target_ts", targetTs)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

/**
 * Official opportunities between the checkpoint and `targetTs` that have no
 * committed decision. A non-empty list means the chronological chain has holes
 * and must be recovered in order before this interval is treated as continuous.
 */
export async function readMissingPredecessors(
  sb: SupabaseClient,
  targetTs: string,
  limit = 96,
): Promise<string[]> {
  const state = await readState(sb);
  if (!state.lastProcessedTs) return [];
  const { data: ctx, error: ctxErr } = await sb
    .from(V11_CONTEXT_TABLE)
    .select("target_ts")
    .gt("target_ts", state.lastProcessedTs)
    .lt("target_ts", targetTs)
    .order("target_ts", { ascending: true })
    .limit(limit);
  if (ctxErr) throw ctxErr;
  const wanted = ((ctx ?? []) as { target_ts: string }[]).map((r) =>
    new Date(r.target_ts).toISOString(),
  );
  if (wanted.length === 0) return [];
  const { data: done, error: doneErr } = await sb
    .from(V11_DECISIONS_TABLE)
    .select("target_ts")
    .gt("target_ts", state.lastProcessedTs)
    .lt("target_ts", targetTs);
  if (doneErr) throw doneErr;
  const have = new Set(
    ((done ?? []) as { target_ts: string }[]).map((r) => new Date(r.target_ts).toISOString()),
  );
  return wanted.filter((ts) => !have.has(ts));
}
