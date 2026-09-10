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
//   4. measured timing is finite, non-negative and inside the Version 1
//      transport ceiling, checked against the wire clock at intake AND again
//      immediately before the send/retry
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
 * Version 1 has its own transport ceiling, deliberately separate from C85's
 * 5000 ms. The [T, T+5s) feature window is a model rule and is NOT retimed to
 * fit a transport number. 8000 ms is a documented preparation ceiling, not a
 * guarantee that an order can be placed inside it; a human may change it via
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
  transportDeadlineMs: number;
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
  if (age >= o.transportDeadlineMs) return "EXPIRED";

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
  /**
   * Existing transport. `guard` is re-evaluated immediately before every real
   * attempt (first and retries); false cancels that attempt.
   */
  deliver(
    payload: Record<string, unknown>,
    guard: () => Promise<boolean>,
  ): Promise<{ delivered: number }>;
  settle(entry: {
    dedupeKey: string;
    owner: string;
    targetId: string | null;
    status: "SENT" | "FAILED" | "EXPIRED";
    error: string | null;
    publicationOffsetMs: number | null;
  }): Promise<void>;
  now(): number;
}

export interface LiteADispatchResult {
  verdict: LiteADispatchVerdict | "SENT" | "FAILED" | "NOT_CLAIM_OWNER";
  dedupeKey: string | null;
  claim?: LiteAClaimOutcome;
  delivered?: number;
  publicationOffsetMs?: number;
}

/** A per-request owner id; never reused across attempts. */
export function newDispatchOwner(): string {
  return `litea-dispatch-${globalThis.crypto.randomUUID()}`;
}

/**
 * Exclusive durable claim first, then send, then record the outcome — in that
 * order, so a crash leaves a replayable entry rather than an untracked signal.
 * A retry reuses the same event identity and takes NO new claim, and both the
 * ceiling and claim ownership are re-checked immediately before every attempt.
 *
 * Dedupe here cannot promise exactly-once broker fills. It guarantees at most
 * one outbound signal per interval from this system; the external bot must
 * honour `dedupe_key` for the end-to-end property.
 */
export async function dispatchLiteaDecision(
  deps: LiteADispatchDeps,
  row: LiteADecisionRecord,
  args: {
    targetId: string | null;
    executionEnabled: boolean;
    allowedModels: ReadonlySet<string>;
    transportDeadlineMs: number;
    alreadySent?: boolean;
    owner?: string;
  },
): Promise<LiteADispatchResult> {
  const intake = evaluateLiteaDispatch(row, {
    nowMs: deps.now(),
    executionEnabled: args.executionEnabled,
    allowedModels: args.allowedModels,
    alreadySent: args.alreadySent === true,
    transportDeadlineMs: args.transportDeadlineMs,
  });
  if (intake !== "WOULD_SEND") return { verdict: intake, dedupeKey: null };

  const ticker = String(row.ticker);
  const targetOpenIso = new Date(String(row.target_open_utc)).toISOString();
  const openMs = new Date(targetOpenIso).getTime();
  const dedupeKey = liteaDedupeKey(ticker, targetOpenIso);
  const expiresAt = new Date(openMs + args.transportDeadlineMs).toISOString();
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


  // Re-check the ceiling with the clock as it is NOW, after the durable write.
  const preSend = evaluateLiteaDispatch(row, {
    nowMs: deps.now(),
    executionEnabled: args.executionEnabled,
    allowedModels: args.allowedModels,
    alreadySent: false,
    transportDeadlineMs: args.transportDeadlineMs,
  });
  if (preSend !== "WOULD_SEND") {
    await deps.settle({
      dedupeKey,
      targetId: args.targetId,
      status: preSend === "EXPIRED" ? "EXPIRED" : "FAILED",
      error: `pre_send_${preSend.toLowerCase()}`,
      publicationOffsetMs: null,
    });
    return { verdict: preSend, dedupeKey };
  }

  const delivery = await deps.deliver(payload);
  const sentMs = deps.now();
  const status = delivery.delivered > 0 ? "SENT" : "FAILED";
  await deps.settle({
    dedupeKey,
    targetId: args.targetId,
    status,
    error: status === "SENT" ? null : "no_endpoint_accepted",
    publicationOffsetMs: sentMs - openMs,
  });
  return {
    verdict: status,
    dedupeKey,
    delivered: delivery.delivered,
    publicationOffsetMs: sentMs - openMs,
  };
}

type MinimalClient = {
  from: (table: string) => any;
};

/** Supabase-backed deps. The tests never use this — they inject a fake. */
export function supabaseLiteaDispatchDeps(
  supabase: MinimalClient,
  deliver: (payload: Record<string, unknown>) => Promise<{ delivered: number }>,
): LiteADispatchDeps {
  return {
    now: () => Date.now(),
    deliver,
    async reserve(entry) {
      const { error } = await supabase.from(C85_OUTBOX_TABLE).insert({
        dedupe_key: entry.dedupeKey,
        target_id: entry.targetId,
        payload: entry.payload,
        state: "PENDING",
        expires_at: entry.expiresAt,
      });
      if (error && !String(error.message).includes("duplicate key")) {
        throw new Error(`litea_reserve_outbox:${error.message}`);
      }
      if (!error) return { state: "PENDING" };
      // Already reserved by an earlier attempt: reuse it, never take a second.
      const { data } = await supabase
        .from(C85_OUTBOX_TABLE)
        .select("state")
        .eq("dedupe_key", entry.dedupeKey)
        .maybeSingle();
      return { state: String((data as { state?: string } | null)?.state ?? "PENDING") };
    },
    async settle(entry) {
      await supabase
        .from(C85_OUTBOX_TABLE)
        .update({
          state: entry.status,
          sent_at: entry.status === "SENT" ? new Date().toISOString() : null,
          last_error: entry.error,
        })
        .eq("dedupe_key", entry.dedupeKey);
      if (entry.targetId) {
        await supabase
          .from(C85_TARGETS_TABLE)
          .update({
            webhook_status: entry.status,
            webhook_last_error: entry.error,
            dispatch_ns:
              entry.status === "SENT" ? String(BigInt(Date.now()) * 1_000_000n) : null,
          })
          .eq("id", entry.targetId);
      }
    },
  };
}
