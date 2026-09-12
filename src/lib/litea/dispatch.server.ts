// Version 1 (lite-a-floor4-top10-r1) server-side dispatch path — DEFAULT OFF.
//
// This is the second half of the prepared execution path. The worker may ask
// for an outbox entry (its own control, `LITEA_EXECUTION_ENABLED`); this module
// decides whether the backend honours that request, makes it durable, and hands
// the payload to the existing transport.
//
// Every one of these must be true before a single byte leaves the server:
//   1. LITEA_SERVER_EXECUTION_ENABLED=true            (absent today)
//   2. the model is sender-allow-listed                (derived from 1)
//   3. the persisted decision is LIVE, admitted (side ±1), input-valid,
//      scored by a real head, under this exact model identity
//   4. measured timing is finite, non-negative and the target candle is still
//      open. The 8-second transport deadline is the GOAL, checked against the
//      wire clock at intake AND again immediately before the send/retry — but
//      missing it no longer drops the signal: a late send still goes out until
//      the candle closes (the hard cap).
//   5. no entry for this event identity has already been sent
//
// The T45 sender, the C85 T+5s ceiling and every other model are untouched.

import {
  LITE_A_MODEL_VERSION,
  C85_OUTBOX_TABLE,
  C85_TARGETS_TABLE,
} from "@/lib/c85/config";
import { buildLiteAWebhookPayload, liteaDedupeKey } from "./webhook.server";
import { WEBHOOK_ALLOWED_MODELS } from "@/lib/webhooks.server";

/**
 * Version 1 has its own transport GOAL, deliberately separate from C85's
 * 5000 ms. The [T, T+5s) feature window is a model rule and is NOT retimed to
 * fit a transport number. 8000 ms is the documented target for the send — a
 * goal, not a drop: a decision that misses it is still sent, late, as long as
 * its target candle is still open. A human may change the goal via
 * LITEA_TRANSPORT_DEADLINE_MS before activation.
 */
export const LITEA_DEFAULT_TRANSPORT_DEADLINE_MS = 8_000;
const LITEA_MAX_TRANSPORT_DEADLINE_MS = 60_000;

export function liteaTransportDeadlineMs(): number {
  const raw = Number(process.env['LITEA_TRANSPORT_DEADLINE_MS']);
  if (!Number.isFinite(raw) || raw <= 0 || raw > LITEA_MAX_TRANSPORT_DEADLINE_MS) {
    return LITEA_DEFAULT_TRANSPORT_DEADLINE_MS;
  }
  return Math.floor(raw);
}

/**
 * The hard cap: the one moment a send is genuinely pointless, the close of
 * the 15-minute target candle. Until then a late send still goes out. A human
 * may lower it via LITEA_SEND_HARD_CAP_MS; it can never exceed the candle.
 */
export const LITEA_DEFAULT_SEND_HARD_CAP_MS = 900_000;
const LITEA_MAX_SEND_HARD_CAP_MS = 900_000;

export function liteaSendHardCapMs(): number {
  const raw = Number(process.env['LITEA_SEND_HARD_CAP_MS']);
  if (!Number.isFinite(raw) || raw <= 0 || raw > LITEA_MAX_SEND_HARD_CAP_MS) {
    return LITEA_DEFAULT_SEND_HARD_CAP_MS;
  }
  return Math.floor(raw);
}

/** The server-side human switch. Absent or anything but "true" means OFF. */
export function liteaServerExecutionEnabled(): boolean {
  return process.env['LITEA_SERVER_EXECUTION_ENABLED'] === "true";
}

/**
 * The allow-list as the Version 1 path sees it: the existing static set, plus
 * Version 1 itself only while the server control is on. The static set and
 * every other model are untouched.
 */
export function liteaEffectiveAllowlist(): ReadonlySet<string> {
  const models = new Set<string>(WEBHOOK_ALLOWED_MODELS);
  if (liteaServerExecutionEnabled()) models.add(LITE_A_MODEL_VERSION);
  return models;
}

export type LiteADispatchVerdict =
  | "EXECUTION_DISABLED"
  | "NOT_IN_ALLOWLIST"
  | "WRONG_MODEL_IDENTITY"
  | "NOT_LIVE"
  | "ABSTAIN"
  | "INPUT_INVALID"
  | "NO_HEAD"
  | "BAD_TARGET_IDENTITY"
  | "TIMING_UNAVAILABLE"
  | "EXPIRED"
  | "ALREADY_SENT"
  | "WOULD_SEND";

export interface LiteADecisionRecord {
  model_version?: unknown;
  ticker?: unknown;
  target_open_utc?: unknown;
  run_mode?: unknown;
  status?: unknown;
  final_side?: unknown;
  probability_yes?: unknown;
  admission_rank?: unknown;
  publication_offset_ms?: unknown;
  packet_freeze_ns?: unknown;
  decision_durable_ns?: unknown;
  features?: Record<string, unknown> | null;
}

export interface LiteAEvaluateOptions {
  nowMs: number;
  executionEnabled: boolean;
  allowedModels: ReadonlySet<string>;
  alreadySent: boolean;
  /** The send GOAL (8000 ms). Recorded and aimed for; never a drop. */
  transportDeadlineMs: number;
  /** The hard cap: candle close. At or past it the signal is EXPIRED. */
  hardCapMs: number;
}

function finiteNumber(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Pure verdict over the PERSISTED decision. No I/O, no clock of its own — the
 * caller supplies the wire clock so intake and pre-send use the same function.
 */
export function evaluateLiteaDispatch(
  row: LiteADecisionRecord,
  o: LiteAEvaluateOptions,
): LiteADispatchVerdict {
  if (!o.executionEnabled) return "EXECUTION_DISABLED";
  if (!o.allowedModels.has(LITE_A_MODEL_VERSION)) return "NOT_IN_ALLOWLIST";
  if (String(row.model_version) !== LITE_A_MODEL_VERSION) return "WRONG_MODEL_IDENTITY";
  if (String(row.run_mode) !== "LIVE") return "NOT_LIVE";

  const side = finiteNumber(row.final_side);
  if (side !== 1 && side !== -1) return "ABSTAIN";

  const features = (row.features ?? {}) as Record<string, unknown>;
  if (features.input_valid !== true) return "INPUT_INVALID";
  const head = (features.lite_a ?? {}) as Record<string, unknown>;
  if (!head.head_id) return "NO_HEAD";

  const ticker = typeof row.ticker === "string" ? row.ticker : "";
  const openMs = new Date(String(row.target_open_utc)).getTime();
  if (!ticker || !Number.isFinite(openMs)) return "BAD_TARGET_IDENTITY";

  // NaN never satisfies a comparison, so it is rejected explicitly rather than
  // slipping through a `>= deadline` test that is false for NaN.
  const offset = finiteNumber(row.publication_offset_ms);
  if (offset === null || offset < 0) return "TIMING_UNAVAILABLE";

  const age = o.nowMs - openMs;
  if (!Number.isFinite(age) || age < 0) return "TIMING_UNAVAILABLE";
  // Past the 8s goal the signal is late, not dead: it still sends. Only a
  // closed target candle expires it.
  if (age >= o.hardCapMs) return "EXPIRED";

  if (o.alreadySent) return "ALREADY_SENT";
  return "WOULD_SEND";
}

/** The delivered payload is rebuilt from the persisted decision, never from the wire. */
export function liteaPayloadFromRecord(row: LiteADecisionRecord) {
  const features = (row.features ?? {}) as Record<string, unknown>;
  const policy = (features.strike_policy ?? {}) as Record<string, unknown>;
  return buildLiteAWebhookPayload({
    ticker: String(row.ticker),
    targetOpenUtc: new Date(String(row.target_open_utc)).toISOString(),
    finalSide: finiteNumber(row.final_side) === 1 ? 1 : -1,
    probabilityYes: finiteNumber(row.probability_yes),
    admissionRank: finiteNumber(row.admission_rank),
    status: String(row.status ?? ""),
    strike: finiteNumber(policy.value ?? policy.strike),
    strikeSource: policy.source == null ? null : String(policy.source),
    strikeEstimated: policy.estimated === true,
    packetFreezeNs: row.packet_freeze_ns == null ? null : String(row.packet_freeze_ns),
    decisionDurableNs: row.decision_durable_ns == null ? null : String(row.decision_durable_ns),
    publicationOffsetMs: finiteNumber(row.publication_offset_ms),
  });
}

/**
 * Outcome of the exclusive durable claim on one event identity.
 *
 * Only `CLAIMED` entitles the caller to deliver. Merely observing a PENDING
 * row does not: a competing request that finds a live claim held by someone
 * else, a terminal entry, or an ambiguous one (a claim that lapsed after an
 * attempt may already have reached the bot) gets no attempt at all.
 */
export type LiteAClaimOutcome =
  | "CLAIMED"
  | "HELD_BY_OTHER"
  | "ALREADY_SENT"
  | "TERMINAL"
  | "AMBIGUOUS"
  | "UNAVAILABLE";

/** Everything this path touches, injectable so tests use an in-process receiver. */
export interface LiteADispatchDeps {
  /**
   * Atomically create-or-take the exclusive claim for `dedupeKey`. Must be a
   * single durable operation: two concurrent callers cannot both get CLAIMED.
   */
  claim(entry: {
    dedupeKey: string;
    owner: string;
    targetId: string | null;
    payload: Record<string, unknown>;
    expiresAt: string;
  }): Promise<{ outcome: LiteAClaimOutcome }>;
  /** True only while THIS owner still holds an unexpired claim on the key. */
  ownsClaim(dedupeKey: string, owner: string): Promise<boolean>;
  /** Live kill-switch / allow-list readers; default to the real environment. */
  isEnabledNow?(): boolean;
  allowedNow?(): ReadonlySet<string>;
  /**
   * Existing transport. `guard` is re-evaluated immediately before the single
   * attempt this path allows per configured endpoint; false cancels it. No
   * Version 1 response, timeout, exception or cancellation is ever resent.
   *
   * `sendStartedAtMs` is the instant `fetch()` was actually invoked (after all
   * gates), never the acknowledgement time.
   */
  deliver(
    payload: Record<string, unknown>,
    guard: () => Promise<boolean>,
  ): Promise<{ delivered: number; sendStartedAtMs?: number | null }>;
  /**
   * Terminal write, conditional on this owner AND a still-PENDING row.
   * `applied` is false when the condition matched nothing or the write errored;
   * the caller must then NOT treat the signal as recorded-sent.
   */
  settle(entry: {
    dedupeKey: string;
    owner: string;
    targetId: string | null;
    status: "SENT" | "FAILED" | "EXPIRED";
    error: string | null;
    publicationOffsetMs: number | null;
    /** HTTP invocation instant of the attempt, when one was actually made. */
    sendStartedAtMs?: number | null;
  }): Promise<{ applied: boolean }>;
  now(): number;
}



export interface LiteADispatchResult {
  verdict:
    | LiteADispatchVerdict
    | "SENT"
    | "FAILED"
    | "NOT_CLAIM_OWNER"
    | "OWNER_LOST";
  dedupeKey: string | null;
  claim?: LiteAClaimOutcome;
  delivered?: number;
  publicationOffsetMs?: number;
  /** HTTP invocation instant (ms) of the single attempt, if one was made. */
  sendStartedAtMs?: number | null;
  /** `sendStartedAtMs` measured from the target interval open. */
  sendStartOffsetMs?: number | null;
  /** False when the owner-and-PENDING conditional terminal write matched nothing. */
  settled?: boolean;
}

/** A per-request owner id; never reused across attempts. */
export function newDispatchOwner(): string {
  return `litea-dispatch-${globalThis.crypto.randomUUID()}`;
}

/**
 * Exclusive durable claim first, then ONE attempt per configured endpoint,
 * then the conditional terminal write — in that order, so a crash leaves an
 * inspectable entry rather than an untracked signal.
 *
 * What this actually gives: one exclusive dispatch operation per event
 * identity, and at most one automatic attempt per configured endpoint. It is
 * NOT a claim of a single global signal (several endpoints may be configured)
 * and NOT exactly-once broker execution — the external bot must honour
 * `dedupe_key` for anything end-to-end. An unresolved or ambiguous response is
 * recorded conservatively and never replayed or re-claimed.
 */

export async function dispatchLiteaDecision(
  deps: LiteADispatchDeps,
  row: LiteADecisionRecord,
  args: {
    targetId: string | null;
    executionEnabled: boolean;
    allowedModels: ReadonlySet<string>;
    transportDeadlineMs: number;
    /** Hard cap (candle close). Defaults to the 15-minute candle length. */
    hardCapMs?: number;
    alreadySent?: boolean;
    owner?: string;
  },
): Promise<LiteADispatchResult> {
  const hardCapMs = args.hardCapMs ?? LITEA_DEFAULT_SEND_HARD_CAP_MS;
  const intake = evaluateLiteaDispatch(row, {
    nowMs: deps.now(),
    executionEnabled: args.executionEnabled,
    allowedModels: args.allowedModels,
    alreadySent: args.alreadySent === true,
    transportDeadlineMs: args.transportDeadlineMs,
    hardCapMs,
  });
  if (intake !== "WOULD_SEND") return { verdict: intake, dedupeKey: null };

  const ticker = String(row.ticker);
  const targetOpenIso = new Date(String(row.target_open_utc)).toISOString();
  const openMs = new Date(targetOpenIso).getTime();
  const dedupeKey = liteaDedupeKey(ticker, targetOpenIso);
  // Ownership must outlive a slow send: the claim expires at the hard cap
  // (candle close), not at the 8-second goal.
  const expiresAt = new Date(openMs + hardCapMs).toISOString();
  const payload = liteaPayloadFromRecord(row);
  const owner = args.owner ?? newDispatchOwner();

  const claimed = await deps.claim({
    dedupeKey,
    owner,
    targetId: args.targetId,
    payload,
    expiresAt,
  });
  if (claimed.outcome === "ALREADY_SENT") {
    return { verdict: "ALREADY_SENT", dedupeKey, claim: claimed.outcome };
  }
  if (claimed.outcome !== "CLAIMED") {
    return { verdict: "NOT_CLAIM_OWNER", dedupeKey, claim: claimed.outcome };
  }

  /**
   * Re-evaluated immediately before the single real attempt this path allows
   * per endpoint. Ownership is read FIRST, because that read is the only
   * awaited network gap here; the kill switch, allow-list and hard cap are
   * then evaluated against the clock as it is after that wait, with nothing
   * awaited between them and the transport. Any ownership error fails closed.
   */
  const guard = async (): Promise<boolean> => {
    let owns = false;
    try {
      owns = await deps.ownsClaim(dedupeKey, owner);
    } catch {
      return false;
    }
    if (!owns) return false;
    return (
      evaluateLiteaDispatch(row, {
        nowMs: deps.now(),
        executionEnabled: (deps.isEnabledNow ?? liteaServerExecutionEnabled)(),
        allowedModels: (deps.allowedNow ?? liteaEffectiveAllowlist)(),
        alreadySent: false,
        transportDeadlineMs: args.transportDeadlineMs,
        hardCapMs,
      }) === "WOULD_SEND"
    );
  };

  // Re-check the hard cap with the clock as it is NOW, after the durable write.
  const preSend = evaluateLiteaDispatch(row, {
    nowMs: deps.now(),
    executionEnabled: args.executionEnabled,
    allowedModels: args.allowedModels,
    alreadySent: false,
    transportDeadlineMs: args.transportDeadlineMs,
    hardCapMs,
  });
  if (preSend !== "WOULD_SEND") {
    const settled = await deps.settle({
      dedupeKey,
      owner,
      targetId: args.targetId,
      status: preSend === "EXPIRED" ? "EXPIRED" : "FAILED",
      error: `pre_send_${preSend.toLowerCase()}`,
      publicationOffsetMs: null,
    });
    return { verdict: preSend, dedupeKey, claim: claimed.outcome, settled: settled.applied };
  }

  const delivery = await deps.deliver(payload, guard);
  const sentMs = deps.now();
  const sendStartedAtMs =
    typeof delivery.sendStartedAtMs === "number" && Number.isFinite(delivery.sendStartedAtMs)
      ? delivery.sendStartedAtMs
      : null;
  const status = delivery.delivered > 0 ? "SENT" : "FAILED";
  const settled = await deps.settle({
    dedupeKey,
    owner,
    targetId: args.targetId,
    status,
    error: status === "SENT" ? null : "no_endpoint_accepted",
    // Offset of the actual HTTP invocation when we have one; otherwise the
    // post-attempt clock. Never presented as the bot's receipt time.
    publicationOffsetMs: (sendStartedAtMs ?? sentMs) - openMs,
    sendStartedAtMs,
  });
  return {
    // The claim was lost or already terminal: the outcome is NOT recorded as
    // ours, and no target row was amended on our behalf.
    verdict: settled.applied ? status : "OWNER_LOST",
    dedupeKey,
    claim: claimed.outcome,
    delivered: delivery.delivered,
    publicationOffsetMs: (sendStartedAtMs ?? sentMs) - openMs,
    sendStartedAtMs,
    sendStartOffsetMs: sendStartedAtMs == null ? null : sendStartedAtMs - openMs,
    settled: settled.applied,
  };
}


type MinimalClient = {
  from: (table: string) => any;
  rpc: (name: string, args: Record<string, unknown>) => PromiseLike<{ data: any; error: any }>;
};

/** The claim RPC prepared in supabase/prepared/. NOT applied in production yet. */
export const LITEA_CLAIM_RPC = "c85_litea_claim_outbox";

const CLAIM_OUTCOMES: ReadonlySet<string> = new Set([
  "CLAIMED",
  "HELD_BY_OTHER",
  "ALREADY_SENT",
  "TERMINAL",
  "AMBIGUOUS",
  "UNAVAILABLE",
]);

/** Supabase-backed deps. The tests never use this — they inject a fake. */
export function supabaseLiteaDispatchDeps(
  supabase: MinimalClient,
  deliver: (
    payload: Record<string, unknown>,
    guard: () => Promise<boolean>,
  ) => Promise<{ delivered: number }>,
): LiteADispatchDeps {
  return {
    now: () => Date.now(),
    deliver,
    async claim(entry) {
      // One atomic durable statement decides ownership. Anything unexpected —
      // including the RPC not being installed — is treated as "not ours", so
      // nothing is delivered.
      const { data, error } = await supabase.rpc(LITEA_CLAIM_RPC, {
        p_dedupe_key: entry.dedupeKey,
        p_owner: entry.owner,
        p_target_id: entry.targetId,
        p_payload: entry.payload,
        p_expires_at: entry.expiresAt,
      });
      if (error) return { outcome: "UNAVAILABLE" };
      const outcome = String((data as { outcome?: string } | null)?.outcome ?? "UNAVAILABLE");
      return {
        outcome: (CLAIM_OUTCOMES.has(outcome) ? outcome : "UNAVAILABLE") as LiteAClaimOutcome,
      };
    },
    async ownsClaim(dedupeKey, owner) {
      const { data, error } = await supabase
        .from(C85_OUTBOX_TABLE)
        .select("state,claim_owner,claim_expires_at")
        .eq("dedupe_key", dedupeKey)
        .maybeSingle();
      if (error || !data) return false;
      const row = data as {
        state?: string;
        claim_owner?: string;
        claim_expires_at?: string;
      };
      if (row.state !== "PENDING" || row.claim_owner !== owner) return false;
      const until = new Date(String(row.claim_expires_at)).getTime();
      return Number.isFinite(until) && until > Date.now();
    },
    async settle(entry) {
      // Conditional on BOTH this owner and a still-PENDING row, and the
      // affected rows are inspected: a lost claim writes nothing anywhere.
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
      const applied = !error && Array.isArray(data) && data.length > 0;
      // Only the owner of the terminal write may amend the version-scoped
      // target row, so a failed/zero-row update can never mark it sent.
      if (applied && entry.targetId) {
        // dispatch_ns carries the instant `fetch()` was invoked. If that instant
        // is genuinely unknown (no attempt was made) it stays NULL — it is never
        // substituted with a response or settlement clock. Note this column is
        // NOT immutable: the live `c85_commit_decision` path can overwrite it
        // from an ACK body. The per-delivery `webhook_deliveries.attempt_started_at`
        // / `attempt_start_offset_ms` columns are the authoritative record.
        const startMs =
          typeof entry.sendStartedAtMs === "number" && Number.isFinite(entry.sendStartedAtMs)
            ? entry.sendStartedAtMs
            : null;
        await supabase
          .from(C85_TARGETS_TABLE)
          .update({
            webhook_status: entry.status,
            webhook_last_error: entry.error,
            dispatch_ns:
              entry.status === "SENT" && startMs != null
                ? String(BigInt(Math.round(startMs)) * 1_000_000n)
                : null,
          })
          .eq("id", entry.targetId)
          .eq("model_version", LITE_A_MODEL_VERSION);
      }

      return { applied };
    },

  };
}
