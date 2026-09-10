// Version 1 (lite-a-floor4-top10-r1) — outbound order payload contract.
//
// NOTHING in this file is wired into a live send path. It exists so the human
// activation step is a reviewed switch rather than an ad-hoc edit at go-live.
//
// Version 1 execution is HARD OFF and stays off:
//   1. the worker constructs no gateway client for this identity,
//   2. `C85_DISPATCH_FORBIDDEN_MODEL_VERSIONS` blocks any outbox row for it,
//   3. `WEBHOOK_ALLOWED_MODELS` does not contain it,
//   4. `liteaExecutionGate()` below defaults to disabled.
// All four must be changed deliberately by a human. None of them flips on a
// deploy, a restart or a default.

import { LITE_A_MODEL_VERSION } from "@/lib/c85/config";
import { formatMountainTime } from "@/lib/webhooks.server";

/** 15 minutes. */
const TF_MS = 15 * 60_000;

export const LITEA_WEBHOOK_MODEL_ID = LITE_A_MODEL_VERSION;
export const LITEA_DECISION_POLICY_VERSION = "lite-a-floor4-top10-r1/strike-fallbacks-free-r1";

export interface LiteAWebhookInputs {
  /** Kalshi contract this decision is about (suffixed, same-contract verified). */
  ticker: string;
  /** Interval open, ISO UTC. The decision is taken at open using [T, T+5s). */
  targetOpenUtc: string;
  /** +1 = YES/GREEN, -1 = NO/RED. 0 never produces a payload. */
  finalSide: 1 | -1;
  probabilityYes: number | null;
  admissionRank: number | null;
  /** Engine/guard status, e.g. ORDINARY_CALL or EXCEPTION_CALL. */
  status: string;
  /** Strike actually used, plus which source supplied it. */
  strike: number | null;
  strikeSource: string | null;
  strikeEstimated: boolean;
  /** Nanosecond timing already recorded on the decision row. */
  packetFreezeNs: string | null;
  decisionDurableNs: string | null;
  publicationOffsetMs: number | null;
}

/** Stable one-per-interval key. Retries and duplicate workers collapse onto it. */
export function liteaDedupeKey(ticker: string, targetOpenUtc: string): string {
  return `${LITE_A_MODEL_VERSION}:${ticker}:${new Date(targetOpenUtc).toISOString()}`;
}

/**
 * Build the payload in the shape the existing bot endpoint already accepts
 * (same field names as the active T45 sender), plus Version 1 provenance.
 *
 * Deliberately absent, because this project does not own them: fill price,
 * filled size, fees, order id, realised P/L. Those belong to the betting bot
 * and must be read from it, not inferred here.
 */
export function buildLiteAWebhookPayload(i: LiteAWebhookInputs) {
  const startMs = new Date(i.targetOpenUtc).getTime();
  const startsAt = new Date(startMs).toISOString();
  const endsAt = new Date(startMs + TF_MS).toISOString();
  const nowIso = new Date().toISOString();
  const label: "YES" | "NO" = i.finalSide === 1 ? "YES" : "NO";
  const p =
    i.probabilityYes != null && Number.isFinite(i.probabilityYes) ? i.probabilityYes : null;

  return {
    model: LITEA_WEBHOOK_MODEL_ID,
    model_name: "Version 1",
    model_version: LITE_A_MODEL_VERSION,
    decision_policy_version: LITEA_DECISION_POLICY_VERSION,

    prediction: label,
    confidence: p == null ? 0 : Math.round((label === "YES" ? p : 1 - p) * 100),
    trade: true,
    direction: i.finalSide === 1 ? "GREEN" : "RED",

    probability_yes: p,
    admission_rank: i.admissionRank,
    decision_status: i.status,

    market_ticker: i.ticker,
    strike: i.strike,
    strike_source: i.strikeSource,
    strike_estimated: i.strikeEstimated,

    candle_starts_at: startsAt,
    candle_starts_at_mt: formatMountainTime(startsAt),
    candle_ends_at: endsAt,
    target_candle_close_at: endsAt,

    dedupe_key: liteaDedupeKey(i.ticker, i.targetOpenUtc),
    packet_freeze_ns: i.packetFreezeNs,
    decision_durable_ns: i.decisionDurableNs,
    publication_offset_ms: i.publicationOffsetMs,

    sent_at: nowIso,
    sent_at_mt: formatMountainTime(nowIso),
    timezone: "America/Denver",
  };
}

export interface LiteAGateInputs {
  /** Row from the activation control the human would flip. */
  executionEnabled: boolean;
  /** Allow-list currently permitting outbound sends. */
  allowedModels: ReadonlySet<string>;
  runMode: string;
  finalSide: number;
  /** Hard T+5s publication ceiling, measured against the wire clock. */
  publicationOffsetMs: number | null;
  publicationDeadlineMs: number;
  alreadyDispatched: boolean;
}

export type LiteAGateVerdict =
  | "EXECUTION_DISABLED"
  | "NOT_IN_ALLOWLIST"
  | "NOT_LIVE"
  | "ABSTAIN"
  | "DEADLINE_MISSED"
  | "ALREADY_DISPATCHED"
  | "WOULD_SEND";

/**
 * Every condition a Version 1 order-generating send would have to satisfy.
 * With today's constants this returns EXECUTION_DISABLED for every input.
 */
export function liteaExecutionGate(i: LiteAGateInputs): LiteAGateVerdict {
  if (!i.executionEnabled) return "EXECUTION_DISABLED";
  if (!i.allowedModels.has(LITE_A_MODEL_VERSION)) return "NOT_IN_ALLOWLIST";
  if (i.runMode !== "LIVE") return "NOT_LIVE";
  if (i.finalSide !== 1 && i.finalSide !== -1) return "ABSTAIN";
  if (i.alreadyDispatched) return "ALREADY_DISPATCHED";
  // NaN fails every comparison, so `NaN >= deadline` is false and would have
  // slipped through. Timing must be present, finite and non-negative.
  if (
    i.publicationOffsetMs == null ||
    !Number.isFinite(i.publicationOffsetMs) ||
    i.publicationOffsetMs < 0 ||
    i.publicationOffsetMs >= i.publicationDeadlineMs
  ) {
    return "DEADLINE_MISSED";
  }
  return "WOULD_SEND";
}

/**
 * The single control a human would flip. Default OFF, and OFF whenever the
 * variable is absent — a fresh environment can never come up enabled.
 */
export function liteaExecutionEnabled(): boolean {
  return process.env['LITEA_EXECUTION_ENABLED'] === "true";
}
