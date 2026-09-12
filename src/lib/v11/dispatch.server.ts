// Version 1.1 (combined) outbound delivery. DEFAULT OFF.
//
// Version 1.1 is ONE stream with two legs and at most one bet per interval:
//
//   leg "V1"    — the ORIGINAL lite-a-floor4-top10-r1 admitted call, delivered
//                 on its OWN existing early (T+5) commit path, with its exact
//                 gates, guard, transport ceiling, claim and target accounting.
//                 Only the outbound identity is re-labelled to the combined
//                 stream. No model math, timing or floor is touched.
//   leg "T45R2" — the CONTEXT69_NORM_38 fallback, delivered only from a
//                 successful, signed, on-time LIVE_SHADOW observation that was
//                 already committed atomically. Never from maintenance,
//                 recovery, replay or research.
//
// Both legs claim the SAME canonical per-interval key (the original V1 event
// key) in the SAME durable table, so the two legs are mutually exclusive by
// construction and no interval can produce two bets.
//
// Controls (all absent today; both must hold):
//   1. V11_SERVER_EXECUTION_ENABLED=true
//   2. ORIGINAL Version 1 delivery OFF (LITEA_SERVER_EXECUTION_ENABLED absent
//      and V1 not statically allow-listed)

import {
  C85_OUTBOX_TABLE,
  C85_TARGETS_TABLE,
  LITE_A_MODEL_VERSION,
} from "@/lib/c85/config";
import {
  WEBHOOK_ALLOWED_MODELS,
  deliverWebhookNow,
  formatMountainTime,
} from "@/lib/webhooks.server";
import { liteaDedupeKey } from "@/lib/litea/webhook.server";
import { LITEA_CLAIM_RPC } from "@/lib/litea/dispatch.server";
import {
  TF_MS,
  V1_LOW_CONFIDENCE_REASON,
  V11_CANDIDATE_VERSION,
  V11_CONFIG_FINGERPRINT,
  V11_DECISIONS_TABLE,
  V11_EVENT_CUTOFF_OFFSET_MS,
  V11_FALLBACK_MIN_RANK,
  V11_FEATURE_ORDER_HASH,
  V11_MODEL_NAME,
  V11_MODEL_VERSION,
  V11_POLICY_VERSION,
  V11_PUBLICATION_CEILING_MS,
  V11_REASONS,
  V11_RUN_MODES,
  V11_STAKE_FRACTION_OF_BOISE_OPEN,
} from "./config";


export const V11_EXECUTION_ENV = "V11_SERVER_EXECUTION_ENABLED";

/** The single server-side human switch for Version 1.1. Absent means OFF. */
export function v11ServerExecutionEnabled(): boolean {
  return process.env[V11_EXECUTION_ENV] === "true";
}

/**
 * Version 1.1 may only deliver while the ORIGINAL Version 1 sender is off.
 * Both legs own the same interval; two enabled senders could produce two bets.
 */
export function v1DeliveryDisabled(): boolean {
  return (
    process.env['LITEA_SERVER_EXECUTION_ENABLED'] !== "true" &&
    !WEBHOOK_ALLOWED_MODELS.has(LITE_A_MODEL_VERSION)
  );
}

/** True only when BOTH conditions of the manual cutover are satisfied. */
export function v11DeliveryArmed(): boolean {
  return v11ServerExecutionEnabled() && v1DeliveryDisabled();
}

/** Canonical per-interval key, shared by BOTH legs (see file header). */
export function v11EventDedupeKey(ticker: string, targetOpenUtc: string): string {
  return liteaDedupeKey(ticker, new Date(targetOpenUtc).toISOString());
}

function finite(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

// ── Leg 1: the ORIGINAL V1 call, re-labelled to the combined stream ──────────

/**
 * Re-label an already-built ORIGINAL V1 payload as the combined stream.
 *
 * The V1 payload is produced by the unchanged Version 1 builder from the
 * committed immutable record: side, probability, rank, strike, timing and the
 * canonical dedupe key are copied verbatim. Only the model identity, the leg
 * and the strategy metadata are added.
 */
export function relabelV1PayloadAsV11(
  payload: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...payload,
    model: V11_MODEL_VERSION,
    model_name: V11_MODEL_NAME,
    model_version: V11_MODEL_VERSION,
    combined_model_version: V11_MODEL_VERSION,
    candidate_version: V11_CANDIDATE_VERSION,
    decision_policy_version: V11_POLICY_VERSION,
    leg: "V1",
    source_model_version: LITE_A_MODEL_VERSION,
    stake_fraction_of_boise_day_opening_principal: V11_STAKE_FRACTION_OF_BOISE_OPEN,
    sizing_owner: "external-betting-bot",
  };
}

/**
 * Deliver function for the V1 leg, for use with the UNCHANGED
 * `dispatchLiteaDecision`. The V1 path keeps its own claim, ownership guard,
 * transport ceiling, single attempt and target/guard accounting; only the
 * bytes on the wire carry the combined identity.
 */
export function v11V1LegDeliver(
  supabase: Parameters<typeof deliverWebhookNow>[0],
  targetOpenMs: number,
) {
  return async (payload: Record<string, unknown>, guard: () => Promise<boolean>) => {
    const delivery = await deliverWebhookNow(
      supabase,
      "prediction.created",
      relabelV1PayloadAsV11(payload),
      {
        guard,
        maxAttempts: 1,
        targetOpenMs: Number.isFinite(targetOpenMs) ? targetOpenMs : undefined,
        // Combined stream: both legs must resolve to ONE destination, or the
        // at-most-one-bet property cannot be honoured. Fails closed.
        requireSingleEndpoint: true,
      },
    );
    void delivery.settle;
    return { delivered: delivery.delivered, sendStartedAtMs: delivery.sendStartedAtMs };
  };
}

/**
 * Claim wrapper for the combined route.
 *
 * The ORIGINAL dispatcher builds the durable outbox payload from the V1 record
 * and is NOT modified. When the interval is routed through Version 1.1 the
 * durable row must describe what actually goes on the wire, so the claim
 * payload is re-labelled with the same combined identity, leg and stake
 * metadata the transport sends. Key, target id, expiry, ownership and the V1
 * guard accounting are untouched.
 */
export function v11V1LegClaimRelabel<
  D extends { claim: (e: { payload: Record<string, unknown> } & Record<string, any>) => any },
>(deps: D): Pick<D, "claim"> {
  return {
    claim: ((entry: any) =>
      deps.claim({ ...entry, payload: relabelV1PayloadAsV11(entry.payload) })) as D["claim"],
  };
}


/** Live readers the V1-leg guard must use while routed through Version 1.1. */
export function v11V1LegGateReaders() {
  return {
    isEnabledNow: () => v11DeliveryArmed(),
    allowedNow: () => {
      const s = new Set<string>(WEBHOOK_ALLOWED_MODELS);
      if (v11DeliveryArmed()) s.add(LITE_A_MODEL_VERSION);
      return s as ReadonlySet<string>;
    },
  };
}

// ── Leg 2: the T45 R2 fallback ───────────────────────────────────────────────

export type V11DispatchVerdict =
  | "EXECUTION_DISABLED"
  | "V1_DELIVERY_STILL_ENABLED"
  | "NOT_LIVE_SHADOW"
  | "NOT_FALLBACK_LEG"
  | "REASON_MISMATCH"
  | "ABSTAIN"
  | "IDENTITY_MISMATCH"
  | "EVIDENCE_UNSIGNED"
  | "SCORE_INVALID"
  | "BELOW_ADMISSION_GATE"
  | "BELOW_FALLBACK_RANK"
  | "V1_LEG_NOT_EXCLUSIVE"
  | "BAD_TARGET_IDENTITY"
  | "TIMING_UNAVAILABLE"
  | "TIMING_INCOHERENT"
  | "LATE_COMMIT"
  | "EXPIRED"
  | "ALREADY_CLAIMED"
  | "WOULD_SEND";


/** The persisted `v11_decisions` row, exactly as the transaction stored it. */
export interface V11DecisionRecord {
  ticker?: unknown;
  target_ts?: unknown;
  run_mode?: unknown;
  leg?: unknown;
  side?: unknown;
  rank?: unknown;
  probability?: unknown;
  admission_gate?: unknown;
  reason?: unknown;
  v1_status?: unknown;
  v1_final_side?: unknown;
  v1_reason?: unknown;
  v1_floor_open?: unknown;
  v1_send_claim?: unknown;
  decision_offset_ms?: unknown;
  within_publication_ceiling?: unknown;
  strategy?: Record<string, unknown> | null;
  evidence?: Record<string, unknown> | null;
}

export interface V11EvaluateOptions {
  nowMs: number;
  executionEnabled: boolean;
  v1DeliveryOff: boolean;
  /** True elapsed ms from open to the DB transaction boundary, from the RPC. */
  commitOffsetMs: number | null;
  /** Mode the TRANSACTION actually persisted, from the RPC. */
  effectiveRunMode: string | null;
  ceilingMs?: number;
}

/**
 * Pure verdict over the PERSISTED decision plus the transaction's own report.
 * No I/O and no clock of its own, so intake and the pre-send re-check are the
 * identical function. Nothing here can rewrite a row, a head or a fingerprint.
 */
export function evaluateV11Dispatch(
  row: V11DecisionRecord,
  o: V11EvaluateOptions,
): V11DispatchVerdict {
  if (!o.executionEnabled) return "EXECUTION_DISABLED";
  if (!o.v1DeliveryOff) return "V1_DELIVERY_STILL_ENABLED";

  // The transaction, not this process, decides what mode was stored. Both the
  // persisted row AND the RPC's own report must say LIVE_SHADOW.
  if (String(row.run_mode) !== V11_RUN_MODES.LIVE) return "NOT_LIVE_SHADOW";
  if (o.effectiveRunMode !== V11_RUN_MODES.LIVE) return "NOT_LIVE_SHADOW";

  if (String(row.leg) !== "T45R2") return "NOT_FALLBACK_LEG";
  // Exactly the fallback-call reason. No other admitted or abstained reason,
  // however directional the row looks, may be delivered.
  if (String(row.reason) !== V11_REASONS.FALLBACK_CALL) return "REASON_MISMATCH";
  const side = finite(row.side);
  if (side !== 1 && side !== -1) return "ABSTAIN";

  // Exact frozen identity, read from the immutable snapshot.
  const strategy = (row.strategy ?? {}) as Record<string, unknown>;
  const evidence = (row.evidence ?? {}) as Record<string, unknown>;
  if (
    String(strategy.model_version) !== V11_MODEL_VERSION ||
    String(strategy.candidate_version) !== V11_CANDIDATE_VERSION ||
    String(strategy.policy_version) !== V11_POLICY_VERSION
  ) {
    return "IDENTITY_MISMATCH";
  }
  if (
    String(evidence.feature_order_hash) !== V11_FEATURE_ORDER_HASH ||
    String(evidence.config_fingerprint) !== V11_CONFIG_FINGERPRINT
  ) {
    return "IDENTITY_MISMATCH";
  }

  // Genuine signed collector receipt for THIS observation. A fabricated or
  // maintenance-sourced snapshot never qualifies.
  if (evidence.trigger_signed !== true) return "EVIDENCE_UNSIGNED";
  if (String(evidence.run_mode) !== V11_RUN_MODES.LIVE) return "EVIDENCE_UNSIGNED";
  if (evidence.downgraded_by != null) return "EVIDENCE_UNSIGNED";
  const receivedAtMs = finite(evidence.trigger_received_at_ms);
  if (receivedAtMs === null) return "EVIDENCE_UNSIGNED";

  // Probabilities, ranks and gates are all unit-interval quantities. Anything
  // outside [0,1] is a corrupt row, not a confident call.
  const probability = finite(row.probability);
  const rank = finite(row.rank);
  const gate = finite(row.admission_gate);
  if (probability === null || rank === null || gate === null) return "SCORE_INVALID";
  const unit = (v: number) => v >= 0 && v <= 1;
  if (!unit(probability) || !unit(rank) || !unit(gate)) return "SCORE_INVALID";
  if (rank < gate) return "BELOW_ADMISSION_GATE";
  if (rank < V11_FALLBACK_MIN_RANK) return "BELOW_FALLBACK_RANK";

  // The ORIGINAL recorded V1 leg must have left the interval free. These come
  // from the frozen snapshot; the fallback never re-derives or bypasses them.
  if (String(row.v1_status ?? "") === "") return "V1_LEG_NOT_EXCLUSIVE";
  if (row.v1_final_side !== 0) return "V1_LEG_NOT_EXCLUSIVE";
  if (row.v1_floor_open !== true) return "V1_LEG_NOT_EXCLUSIVE";
  if (String(row.v1_reason) !== V1_LOW_CONFIDENCE_REASON) return "V1_LEG_NOT_EXCLUSIVE";
  if (String(row.v1_send_claim) !== "none") return "V1_LEG_NOT_EXCLUSIVE";
  if (String(evidence.v1_run_mode) !== "LIVE") return "V1_LEG_NOT_EXCLUSIVE";
  if (evidence.v1_read_failed === true) return "V1_LEG_NOT_EXCLUSIVE";

  const ticker = String(row.ticker ?? "");
  const openMs = new Date(String(row.target_ts)).getTime();
  if (!ticker || !Number.isFinite(openMs)) return "BAD_TARGET_IDENTITY";

  // ── Timing coherence ───────────────────────────────────────────────────────
  // The fallback exists only in the window [T+45s, T+60s). Every instant the
  // row reports must sit inside it and be ordered receipt <= decision <=
  // commit <= now, with no negative, future or contradictory value. A row that
  // cannot prove when it happened is not delivered.
  const ceiling = o.ceilingMs ?? V11_PUBLICATION_CEILING_MS;
  const decisionOffset = finite(row.decision_offset_ms);
  if (decisionOffset === null) return "TIMING_UNAVAILABLE";
  if (o.commitOffsetMs === null || !Number.isFinite(o.commitOffsetMs)) {
    return "TIMING_UNAVAILABLE";
  }
  const commitOffset = o.commitOffsetMs;
  if (commitOffset < 0 || decisionOffset < 0) return "TIMING_INCOHERENT";

  // The RPC's report and the stored evidence must describe the same commit.
  const storedCommitOffset = finite(evidence.commit_offset_ms);
  if (storedCommitOffset !== null && Math.abs(storedCommitOffset - commitOffset) > 250) {
    return "TIMING_INCOHERENT";
  }

  const receiptOffset = receivedAtMs - openMs;
  const age = o.nowMs - openMs;
  if (!Number.isFinite(age) || age < 0) return "BAD_TARGET_IDENTITY";

  const inWindow = (v: number) => v >= V11_EVENT_CUTOFF_OFFSET_MS && v < ceiling;
  if (!inWindow(receiptOffset) || !inWindow(decisionOffset) || !inWindow(commitOffset)) {
    // A commit past the ceiling is the ordinary "too late" case; anything
    // earlier than the T+45 cutoff is an impossible fallback.
    if (commitOffset >= ceiling || decisionOffset >= ceiling) return "LATE_COMMIT";
    return "TIMING_INCOHERENT";
  }
  if (receiptOffset > decisionOffset || decisionOffset > commitOffset) {
    return "TIMING_INCOHERENT";
  }
  if (age < commitOffset) return "TIMING_INCOHERENT"; // commit in the future
  if (row.within_publication_ceiling !== true) return "LATE_COMMIT";
  if (age >= ceiling) return "EXPIRED";

  return "WOULD_SEND";
}


/**
 * Fallback payload. Same field names the existing bot endpoint already accepts,
 * plus combined provenance and the SELECTED stake metadata. Sizing and
 * execution remain owned by the external betting bot.
 */
export function buildV11WebhookPayload(row: V11DecisionRecord) {
  const startMs = new Date(String(row.target_ts)).getTime();
  const startsAt = new Date(startMs).toISOString();
  const endsAt = new Date(startMs + TF_MS).toISOString();
  const nowIso = new Date().toISOString();
  const side = finite(row.side) === 1 ? 1 : -1;
  const label: "YES" | "NO" = side === 1 ? "YES" : "NO";
  const p = finite(row.probability);

  return {
    model: V11_MODEL_VERSION,
    model_name: V11_MODEL_NAME,
    model_version: V11_MODEL_VERSION,
    combined_model_version: V11_MODEL_VERSION,
    candidate_version: V11_CANDIDATE_VERSION,
    decision_policy_version: V11_POLICY_VERSION,
    leg: "T45R2",

    prediction: label,
    confidence: p == null ? 0 : Math.round((label === "YES" ? p : 1 - p) * 100),
    trade: true,
    direction: side === 1 ? "GREEN" : "RED",

    probability_yes: p,
    admission_rank: finite(row.rank),
    admission_gate: finite(row.admission_gate),
    decision_status: String(row.reason ?? ""),

    market_ticker: String(row.ticker ?? ""),
    candle_starts_at: startsAt,
    candle_starts_at_mt: formatMountainTime(startsAt),
    candle_ends_at: endsAt,
    target_candle_close_at: endsAt,

    // Strategy metadata only — the external bot sizes and executes.
    stake_fraction_of_boise_day_opening_principal: V11_STAKE_FRACTION_OF_BOISE_OPEN,
    sizing_owner: "external-betting-bot",

    dedupe_key: v11EventDedupeKey(String(row.ticker ?? ""), String(row.target_ts)),
    decision_offset_ms: finite(row.decision_offset_ms),
    sent_at: nowIso,
    sent_at_mt: formatMountainTime(nowIso),
    timezone: "America/Denver",
  };
}

export type V11ClaimOutcome =
  | "CLAIMED"
  | "HELD_BY_OTHER"
  | "ALREADY_SENT"
  | "TERMINAL"
  | "AMBIGUOUS"
  | "UNAVAILABLE";

export interface V11DispatchDeps {
  claim(entry: {
    dedupeKey: string;
    owner: string;
    payload: Record<string, unknown>;
    expiresAt: string;
  }): Promise<{ outcome: V11ClaimOutcome }>;
  ownsClaim(dedupeKey: string, owner: string): Promise<boolean>;
  deliver(
    payload: Record<string, unknown>,
    guard: () => Promise<boolean>,
  ): Promise<{ delivered: number; sendStartedAtMs?: number | null }>;
  settle(entry: {
    dedupeKey: string;
    owner: string;
    status: "SENT" | "FAILED" | "EXPIRED";
    error: string | null;
    sendStartedAtMs?: number | null;
  }): Promise<{ applied: boolean }>;
  isEnabledNow?(): boolean;
  v1OffNow?(): boolean;
  now(): number;
}

export interface V11DispatchResult {
  verdict: V11DispatchVerdict | "SENT" | "FAILED" | "NOT_CLAIM_OWNER" | "OWNER_LOST";
  dedupeKey: string | null;
  claim?: V11ClaimOutcome;
  delivered?: number;
  sendStartedAtMs?: number | null;
  settled?: boolean;
}

export function newV11DispatchOwner(): string {
  return `v11-dispatch-${globalThis.crypto.randomUUID()}`;
}

/**
 * Durable exclusive claim on the CANONICAL interval key first, then AT MOST ONE
 * attempt per configured endpoint, then the owner-conditional terminal write.
 * No response, timeout, exception or cancellation is ever resent, and no entry
 * is ever re-claimed. The V1 target row and its guard accounting are NOT
 * touched by this leg.
 */
export async function dispatchV11Fallback(
  deps: V11DispatchDeps,
  row: V11DecisionRecord,
  args: {
    commitOffsetMs: number | null;
    effectiveRunMode: string | null;
    ceilingMs?: number;
    owner?: string;
  },
): Promise<V11DispatchResult> {
  const ceilingMs = args.ceilingMs ?? V11_PUBLICATION_CEILING_MS;
  const enabledNow = deps.isEnabledNow ?? v11ServerExecutionEnabled;
  const v1OffNow = deps.v1OffNow ?? v1DeliveryDisabled;
  const base = {
    commitOffsetMs: args.commitOffsetMs,
    effectiveRunMode: args.effectiveRunMode,
    ceilingMs,
  };

  const intake = evaluateV11Dispatch(row, {
    ...base,
    nowMs: deps.now(),
    executionEnabled: enabledNow(),
    v1DeliveryOff: v1OffNow(),
  });
  if (intake !== "WOULD_SEND") return { verdict: intake, dedupeKey: null };

  const ticker = String(row.ticker);
  const openIso = new Date(String(row.target_ts)).toISOString();
  const openMs = new Date(openIso).getTime();
  const dedupeKey = v11EventDedupeKey(ticker, openIso);
  const payload = buildV11WebhookPayload(row);
  const owner = args.owner ?? newV11DispatchOwner();

  const claimed = await deps.claim({
    dedupeKey,
    owner,
    payload,
    expiresAt: new Date(openMs + ceilingMs).toISOString(),
  });
  if (claimed.outcome === "ALREADY_SENT") {
    return { verdict: "ALREADY_CLAIMED", dedupeKey, claim: claimed.outcome };
  }
  if (claimed.outcome !== "CLAIMED") {
    return { verdict: "NOT_CLAIM_OWNER", dedupeKey, claim: claimed.outcome };
  }

  /** Re-evaluated immediately before the single real attempt. Fails closed. */
  const guard = async (): Promise<boolean> => {
    let owns = false;
    try {
      owns = await deps.ownsClaim(dedupeKey, owner);
    } catch {
      return false;
    }
    if (!owns) return false;
    return (
      evaluateV11Dispatch(row, {
        ...base,
        nowMs: deps.now(),
        executionEnabled: enabledNow(),
        v1DeliveryOff: v1OffNow(),
      }) === "WOULD_SEND"
    );
  };

  const preSend = evaluateV11Dispatch(row, {
    ...base,
    nowMs: deps.now(),
    executionEnabled: enabledNow(),
    v1DeliveryOff: v1OffNow(),
  });
  if (preSend !== "WOULD_SEND") {
    const settled = await deps.settle({
      dedupeKey,
      owner,
      status: preSend === "EXPIRED" ? "EXPIRED" : "FAILED",
      error: `pre_send_${preSend.toLowerCase()}`,
    });
    return { verdict: preSend, dedupeKey, claim: claimed.outcome, settled: settled.applied };
  }

  let delivered = 0;
  let startedAt: number | null = null;
  try {
    const delivery = await deps.deliver(payload, guard);
    delivered = delivery.delivered;
    startedAt =
      typeof delivery.sendStartedAtMs === "number" && Number.isFinite(delivery.sendStartedAtMs)
        ? delivery.sendStartedAtMs
        : null;
  } catch {
    delivered = 0;
  }
  const status = delivered > 0 ? "SENT" : "FAILED";
  const settled = await deps.settle({
    dedupeKey,
    owner,
    status,
    error: status === "SENT" ? null : "no_endpoint_accepted",
    sendStartedAtMs: startedAt,
  });
  return {
    verdict: settled.applied ? status : "OWNER_LOST",
    dedupeKey,
    claim: claimed.outcome,
    delivered,
    sendStartedAtMs: startedAt,
    settled: settled.applied,
  };
}

type MinimalClient = {
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
};

const CLAIM_OUTCOMES: ReadonlySet<string> = new Set([
  "CLAIMED",
  "HELD_BY_OTHER",
  "ALREADY_SENT",
  "TERMINAL",
  "AMBIGUOUS",
  "UNAVAILABLE",
]);

export interface V11ClaimSource {
  ticker: string;
  targetOpenIso: string;
}

/**
 * Resolve the REAL same-interval original V1 decision row that this fallback
 * is attached to.
 *
 * `c85_outbox.target_id` is NOT NULL with a FK to `c85_targets(id)`, so a claim
 * without it can never be inserted. The link is a provenance link only: the
 * fallback settles the outbox row and nothing else, and original V1 stats count
 * calls from `c85_targets.final_side` (±1), never from outbox rows — so an
 * abstained V1 target linked here is still not counted as a V1 call.
 *
 * Re-read at the claim seam and validated independently of in-memory state:
 * exact model/ticker/open, LIVE, input_valid, CONFIDENCE_ABSTAIN, ordinary
 * floor open, final_side 0. Anything else returns null and the claim fails
 * closed.
 */
export async function resolveV1SourceTargetId(
  supabase: MinimalClient,
  source: V11ClaimSource,
): Promise<string | null> {
  const { data, error } = await supabase
    .from(C85_TARGETS_TABLE)
    .select("id,model_version,ticker,target_open_utc,run_mode,final_side,features")
    .eq("model_version", LITE_A_MODEL_VERSION)
    .eq("ticker", source.ticker)
    .eq("target_open_utc", source.targetOpenIso)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as Record<string, any>;
  if (String(row['model_version']) !== LITE_A_MODEL_VERSION) return null;
  if (String(row['ticker']) !== source.ticker) return null;
  const openMs = new Date(String(row['target_open_utc'])).getTime();
  if (openMs !== new Date(source.targetOpenIso).getTime()) return null;
  if (String(row['run_mode']) !== "LIVE") return null;
  if (Number(row['final_side']) !== 0) return null;
  const features = (row['features'] ?? {}) as Record<string, any>;
  if (features['input_valid'] !== true) return null;
  if (String((features['lite_a'] ?? {})['reason']) !== V1_LOW_CONFIDENCE_REASON) return null;
  if ((features['daily_floor'] ?? {})['ordinary_floor_allows'] !== true) return null;
  const id = row['id'];
  return typeof id === "string" && id.length > 0 ? id : null;
}

/**
 * Real Supabase deps for the fallback leg.
 *
 * Claiming uses the SAME atomic RPC and the SAME canonical key as the original
 * V1 leg, so a V1 claim for the interval excludes the fallback and vice versa.
 * Settling writes ONLY the shared outbox entry: the V1 target row, its
 * webhook_status and its guard accounting are never amended by this leg.
 */
export function supabaseV11DispatchDeps(
  supabase: MinimalClient,
  deliver: V11DispatchDeps["deliver"],
  source: V11ClaimSource,
): V11DispatchDeps {
  return {
    now: () => Date.now(),
    deliver,
    isEnabledNow: () => v11ServerExecutionEnabled(),
    v1OffNow: () => v1DeliveryDisabled(),
    async claim(entry) {
      // NOT NULL + FK: no target id, no claim. Never send p_target_id null.
      const targetId = await resolveV1SourceTargetId(supabase, source);
      if (!targetId) return { outcome: "UNAVAILABLE" };
      const { data, error } = await supabase.rpc(LITEA_CLAIM_RPC, {
        p_dedupe_key: entry.dedupeKey,
        p_owner: entry.owner,
        p_target_id: targetId,
        p_payload: entry.payload,
        p_expires_at: entry.expiresAt,
      });
      if (error) return { outcome: "UNAVAILABLE" };
      const outcome = String((data as { outcome?: string } | null)?.outcome ?? "UNAVAILABLE");
      return {
        outcome: (CLAIM_OUTCOMES.has(outcome) ? outcome : "UNAVAILABLE") as V11ClaimOutcome,
      };
    },
    async ownsClaim(dedupeKey, owner) {
      const { data, error } = await supabase
        .from(C85_OUTBOX_TABLE)
        .select("state,claim_owner,claim_expires_at")
        .eq("dedupe_key", dedupeKey)
        .maybeSingle();
      if (error || !data) return false;
      const row = data as { state?: string; claim_owner?: string; claim_expires_at?: string };
      if (row.state !== "PENDING" || row.claim_owner !== owner) return false;
      const until = new Date(String(row.claim_expires_at)).getTime();
      return Number.isFinite(until) && until > Date.now();
    },
    async settle(entry) {
      const { data, error } = await supabase
        .from(C85_OUTBOX_TABLE)
        .update({
          state: entry.status,
          sent_at: entry.status === "SENT" ? new Date().toISOString() : null,
          last_error: entry.error,
          claim_owner: null,
        })
        .eq("dedupe_key", entry.dedupeKey)
        .eq("claim_owner", entry.owner)
        .eq("state", "PENDING")
        .select("dedupe_key");
      return { applied: !error && Array.isArray(data) && data.length > 0 };
    },
  };
}

/**
 * Production entry point for the fallback leg: called ONLY by the signed T+45
 * collector hook, and only after the atomic observation commit succeeded.
 *
 * With the controls absent this returns EXECUTION_DISABLED before any claim,
 * any read and any byte on the wire.
 */
export async function dispatchV11FallbackFromCommit(
  supabase: MinimalClient,
  row: V11DecisionRecord,
  commit: { commitOffsetMs: number | null; effectiveRunMode: string | null },
): Promise<V11DispatchResult> {
  // Cheap, process-local refusal first: no I/O at all while disabled.
  if (!v11DeliveryArmed()) {
    return {
      verdict: v11ServerExecutionEnabled() ? "V1_DELIVERY_STILL_ENABLED" : "EXECUTION_DISABLED",
      dedupeKey: null,
    };
  }
  const openMs = new Date(String(row.target_ts)).getTime();
  const deps = supabaseV11DispatchDeps(
    supabase,
    async (payload, guard) => {
      const delivery = await deliverWebhookNow(
        supabase as never,
        "prediction.created",
        payload,
        {
          guard,
          maxAttempts: 1,
          targetOpenMs: Number.isFinite(openMs) ? openMs : undefined,
          // One destination for the combined stream, or nothing at all.
          requireSingleEndpoint: true,

        },
      );
      void delivery.settle;
      return { delivered: delivery.delivered, sendStartedAtMs: delivery.sendStartedAtMs };
    },
    {
      ticker: String(row.ticker ?? ""),
      targetOpenIso: Number.isFinite(openMs)
        ? new Date(openMs).toISOString()
        : String(row.target_ts ?? ""),
    },
  );
  return dispatchV11Fallback(deps, row, {
    commitOffsetMs: commit.commitOffsetMs,
    effectiveRunMode: commit.effectiveRunMode,
  });
}

export type V11ObservationDispatchResult = Omit<V11DispatchResult, "verdict"> & {
  verdict:
    | V11DispatchResult["verdict"]
    | "SKIPPED_UNSIGNED"
    | "NO_FRESH_COMMIT"
    | "NO_PERSISTED_RECORD";
};

/**
 * The ONE production seam for the fallback leg.
 *
 * Called by the signed T+45 collector hook immediately after the atomic
 * observation commit. It refuses anything that is not a freshly committed,
 * signed, on-time LIVE_SHADOW directional fallback, and it re-reads the row
 * the transaction actually persisted rather than trusting in-memory state.
 * Maintenance, watchdog recovery, replay and research can never reach it.
 */
export async function dispatchV11FallbackForObservation(
  supabase: MinimalClient,
  targetTs: string,
  observation: {
    commit?: {
      committed?: boolean;
      decisionWritten?: boolean;
      effectiveRunMode?: string | null;
      commitOffsetMs?: number | null;
    } | null;
    decisionLeg?: string | null;
    side?: number | null;
  } | null,
  opts: { signed: boolean },
): Promise<V11ObservationDispatchResult> {
  if (!opts.signed) return { verdict: "SKIPPED_UNSIGNED", dedupeKey: null };
  if (!v11DeliveryArmed()) {
    return {
      verdict: v11ServerExecutionEnabled() ? "V1_DELIVERY_STILL_ENABLED" : "EXECUTION_DISABLED",
      dedupeKey: null,
    };
  }
  const commit = observation?.commit ?? null;
  if (!commit?.committed || commit.decisionWritten !== true) {
    return { verdict: "NO_FRESH_COMMIT", dedupeKey: null };
  }
  if (commit.effectiveRunMode !== V11_RUN_MODES.LIVE) {
    return { verdict: "NOT_LIVE_SHADOW", dedupeKey: null };
  }
  if (observation?.decisionLeg !== "T45R2") return { verdict: "NOT_FALLBACK_LEG", dedupeKey: null };
  if (observation?.side !== 1 && observation?.side !== -1) {
    return { verdict: "ABSTAIN", dedupeKey: null };
  }

  const { data, error } = await supabase
    .from(V11_DECISIONS_TABLE)
    .select("*")
    .eq("target_ts", new Date(targetTs).toISOString())
    .maybeSingle();
  if (error || !data) return { verdict: "NO_PERSISTED_RECORD", dedupeKey: null };

  return dispatchV11FallbackFromCommit(supabase, data as V11DecisionRecord, {
    commitOffsetMs: commit.commitOffsetMs ?? null,
    effectiveRunMode: commit.effectiveRunMode ?? null,
  });
}
