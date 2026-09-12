// Version 1.1 — prepared outbound delivery adapter. DEFAULT OFF.
//
// Nothing in this module can send today. It exists so that turning Version 1.1
// on is one explicit operator configuration step instead of an edit at go-live.
//
// Every one of these must hold before a byte leaves the server:
//   1. V11_SERVER_EXECUTION_ENABLED=true                      (absent today)
//   2. ORIGINAL Version 1 outbound delivery is OFF
//      (LITEA_SERVER_EXECUTION_ENABLED absent AND V1 not statically allowed)
//   3. the persisted decision is LIVE, leg T45R2, side ±1, rank >= 0.80
//   4. the frozen V1 leg was a genuine committed CONFIDENCE_ABSTAIN with the
//      ORIGINAL recorded floor open and no send claim of any kind
//   5. the decision is inside the 60s publication ceiling measured from open
//   6. the canonical PER-INTERVAL event key is still unclaimed
//
// The event key is deliberately the SAME key the original V1 leg uses, so the
// durable unique claim enforces one model bet per interval ACROSS BOTH LEGS:
// if V1 ever claims the interval, the fallback can never also claim it.
//
// The original V1 leg keeps its own T+5 path, guard, floor and timing. Nothing
// here reads, delays, retimes or amends it, and no historical, recovery or
// research row is ever eligible.

import { LITE_A_MODEL_VERSION } from "@/lib/c85/config";
import { WEBHOOK_ALLOWED_MODELS } from "@/lib/webhooks.server";
import { liteaDedupeKey } from "@/lib/litea/webhook.server";
import { formatMountainTime } from "@/lib/webhooks.server";
import {
  TF_MS,
  V11_CANDIDATE_VERSION,
  V11_FALLBACK_MIN_RANK,
  V11_MODEL_NAME,
  V11_MODEL_VERSION,
  V11_POLICY_VERSION,
  V11_PUBLICATION_CEILING_MS,
  V11_STAKE_FRACTION_OF_BOISE_OPEN,
} from "./config";

export const V11_EXECUTION_ENV = "V11_SERVER_EXECUTION_ENABLED";

/** The single server-side human switch for Version 1.1. Absent means OFF. */
export function v11ServerExecutionEnabled(): boolean {
  return process.env[V11_EXECUTION_ENV] === "true";
}

/**
 * Version 1.1 may only deliver while the ORIGINAL Version 1 sender is off.
 * Both legs share one interval; two enabled senders could produce two bets.
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

/** Canonical per-interval key, shared with the V1 leg (see file header). */
export function v11EventDedupeKey(ticker: string, targetOpenUtc: string): string {
  return liteaDedupeKey(ticker, new Date(targetOpenUtc).toISOString());
}

export type V11DispatchVerdict =
  | "EXECUTION_DISABLED"
  | "V1_DELIVERY_STILL_ENABLED"
  | "NOT_LIVE"
  | "NOT_FALLBACK_LEG"
  | "ABSTAIN"
  | "V1_LEG_NOT_EXCLUSIVE"
  | "BELOW_FALLBACK_RANK"
  | "BAD_TARGET_IDENTITY"
  | "EXPIRED"
  | "ALREADY_CLAIMED"
  | "WOULD_SEND";

/** The persisted v11_decisions row, as the adapter reads it. */
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
  v1_final_side?: unknown;
  v1_reason?: unknown;
  v1_floor_open?: unknown;
  v1_send_claim?: unknown;
  decision_offset_ms?: unknown;
}

export interface V11EvaluateOptions {
  nowMs: number;
  executionEnabled: boolean;
  v1DeliveryOff: boolean;
  ceilingMs?: number;
}

function finite(value: unknown): number | null {
  const n = typeof value === "string" ? Number(value) : (value as number);
  return typeof n === "number" && Number.isFinite(n) ? n : null;
}

/**
 * Pure verdict over the PERSISTED combined decision. No I/O and no clock of its
 * own, so intake and the pre-send re-check use the identical function.
 */
export function evaluateV11Dispatch(
  row: V11DecisionRecord,
  o: V11EvaluateOptions,
): V11DispatchVerdict {
  if (!o.executionEnabled) return "EXECUTION_DISABLED";
  if (!o.v1DeliveryOff) return "V1_DELIVERY_STILL_ENABLED";
  if (String(row.run_mode) !== "LIVE") return "NOT_LIVE";
  if (String(row.leg) !== "T45R2") return "NOT_FALLBACK_LEG";

  const side = finite(row.side);
  if (side !== 1 && side !== -1) return "ABSTAIN";

  // The ORIGINAL recorded V1 leg must have left the interval free. These are
  // read from the frozen decision row; the fallback never re-derives them and
  // never bypasses the original floor.
  if (row.v1_final_side !== 0) return "V1_LEG_NOT_EXCLUSIVE";
  if (row.v1_floor_open !== true) return "V1_LEG_NOT_EXCLUSIVE";
  if (String(row.v1_reason) !== "CONFIDENCE_ABSTAIN") return "V1_LEG_NOT_EXCLUSIVE";
  if (String(row.v1_send_claim) !== "none") return "V1_LEG_NOT_EXCLUSIVE";

  const rank = finite(row.rank);
  if (rank === null || rank < V11_FALLBACK_MIN_RANK) return "BELOW_FALLBACK_RANK";

  const ticker = String(row.ticker ?? "");
  const openMs = new Date(String(row.target_ts)).getTime();
  if (!ticker || !Number.isFinite(openMs)) return "BAD_TARGET_IDENTITY";

  const ceiling = o.ceilingMs ?? V11_PUBLICATION_CEILING_MS;
  const age = o.nowMs - openMs;
  if (!Number.isFinite(age) || age < 0) return "BAD_TARGET_IDENTITY";
  if (age >= ceiling) return "EXPIRED";

  return "WOULD_SEND";
}

/**
 * Outbound payload. Same field names the existing bot endpoint already accepts,
 * plus Version 1.1 provenance and the SELECTED stake metadata. Sizing and
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
 * Durable exclusive claim first, then AT MOST ONE attempt per configured
 * endpoint, then the owner-conditional terminal write. No response, timeout,
 * exception or cancellation is ever resent, and no row is ever re-claimed.
 */
export async function dispatchV11Fallback(
  deps: V11DispatchDeps,
  row: V11DecisionRecord,
  args?: { ceilingMs?: number; owner?: string },
): Promise<V11DispatchResult> {
  const ceilingMs = args?.ceilingMs ?? V11_PUBLICATION_CEILING_MS;
  const executionEnabled = (deps.isEnabledNow ?? v11ServerExecutionEnabled)();
  const v1Off = (deps.v1OffNow ?? v1DeliveryDisabled)();

  const intake = evaluateV11Dispatch(row, {
    nowMs: deps.now(),
    executionEnabled,
    v1DeliveryOff: v1Off,
    ceilingMs,
  });
  if (intake !== "WOULD_SEND") return { verdict: intake, dedupeKey: null };

  const ticker = String(row.ticker);
  const openIso = new Date(String(row.target_ts)).toISOString();
  const openMs = new Date(openIso).getTime();
  const dedupeKey = v11EventDedupeKey(ticker, openIso);
  const payload = buildV11WebhookPayload(row);
  const owner = args?.owner ?? newV11DispatchOwner();

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
        nowMs: deps.now(),
        executionEnabled: (deps.isEnabledNow ?? v11ServerExecutionEnabled)(),
        v1DeliveryOff: (deps.v1OffNow ?? v1DeliveryDisabled)(),
        ceilingMs,
      }) === "WOULD_SEND"
    );
  };

  const preSend = evaluateV11Dispatch(row, {
    nowMs: deps.now(),
    executionEnabled,
    v1DeliveryOff: v1Off,
    ceilingMs,
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

  const delivery = await deps.deliver(payload, guard);
  const startedAt =
    typeof delivery.sendStartedAtMs === "number" && Number.isFinite(delivery.sendStartedAtMs)
      ? delivery.sendStartedAtMs
      : null;
  const status = delivery.delivered > 0 ? "SENT" : "FAILED";
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
    delivered: delivery.delivered,
    sendStartedAtMs: startedAt,
    settled: settled.applied,
  };
}
