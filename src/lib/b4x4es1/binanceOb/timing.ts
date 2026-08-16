// B4x4-ES1 Binance Order-Book R1 — strict T-2s timing eligibility (pure).
//
// An observation belongs to target T only when every one of these holds:
//   feature_cutoff_ts   == T - 2s
//   sample_ts           <= T - 2s          (cutoff, inclusive)
//   sample_ts           >= T - 60s         (window start, inclusive)
//   received_at         <= T - 2s          (collector receive time, inclusive)
//   exchange_event_ts   <  T
//
// A message received between T-2s and T is NEVER eligible for target T even if
// its exchange event timestamp is older than the cutoff. Receive time governs.

import { OBS_END_OFFSET_S, OBS_START_OFFSET_S, TF_MS } from "./config";

export const CUTOFF_OFFSET_MS = OBS_END_OFFSET_S * 1000;
export const WINDOW_START_OFFSET_MS = OBS_START_OFFSET_S * 1000;
/**
 * The collector fires each sample a few milliseconds early so that sample_ts
 * and received_at stay at or before the T-2s cutoff. That lead placed the
 * T-60s sample marginally before the window start and silently dropped it,
 * which is why every boundary held 58 rows instead of 59. Data earlier than
 * the window start can never be leakage, so a bounded lead is accepted here.
 * The T-2s cutoff itself is unchanged and remains strict.
 */
export const WINDOW_START_LEAD_TOLERANCE_MS = 250;

export type TimingReason =
  | "OK"
  | "TARGET_TS_INVALID"
  | "TARGET_NOT_15M_BOUNDARY"
  | "SAMPLE_TS_INVALID"
  | "SAMPLE_AFTER_CUTOFF"
  | "SAMPLE_BEFORE_WINDOW_START"
  | "CUTOFF_TS_MISMATCH"
  | "RECEIVED_AT_MISSING"
  | "RECEIVED_AT_INVALID"
  | "RECEIVED_AFTER_CUTOFF"
  | "EXCHANGE_EVENT_TS_MISSING"
  | "EXCHANGE_EVENT_TS_INVALID"
  | "EXCHANGE_EVENT_NOT_BEFORE_TARGET"
  | "OFFSET_OUT_OF_RANGE"
  | "OFFSET_INCONSISTENT_WITH_SAMPLE_TS";

export interface TimingCandidate {
  target_ts?: unknown;
  sample_ts?: unknown;
  feature_cutoff_ts?: unknown;
  received_at?: unknown;
  exchange_event_ts?: unknown;
  sample_offset_seconds?: unknown;
}

export interface TimingVerdict {
  eligible: boolean;
  reason: TimingReason;
  targetMs: number | null;
  cutoffMs: number | null;
  cutoffTs: string | null;
}

function ms(v: unknown): number | null {
  if (typeof v !== "string" && typeof v !== "number") return null;
  const t = new Date(v).getTime();
  return Number.isFinite(t) ? t : null;
}

export function featureCutoffMs(targetMs: number): number {
  return targetMs - CUTOFF_OFFSET_MS;
}

export function featureCutoffTs(targetTs: string): string {
  return new Date(featureCutoffMs(new Date(targetTs).getTime())).toISOString();
}

/** Full timing verdict for one candidate observation row. */
export function evaluateObservationTiming(row: TimingCandidate): TimingVerdict {
  const targetMs = ms(row.target_ts);
  const fail = (reason: TimingReason, cutoff: number | null = null): TimingVerdict => ({
    eligible: false,
    reason,
    targetMs,
    cutoffMs: cutoff,
    cutoffTs: cutoff == null ? null : new Date(cutoff).toISOString(),
  });

  if (targetMs == null) return fail("TARGET_TS_INVALID");
  if (targetMs % TF_MS !== 0) return fail("TARGET_NOT_15M_BOUNDARY");
  const cutoffMs = featureCutoffMs(targetMs);
  const windowStartMs = targetMs - WINDOW_START_OFFSET_MS;

  const sampleMs = ms(row.sample_ts);
  if (sampleMs == null) return fail("SAMPLE_TS_INVALID", cutoffMs);
  if (sampleMs > cutoffMs) return fail("SAMPLE_AFTER_CUTOFF", cutoffMs);
  if (sampleMs < windowStartMs) return fail("SAMPLE_BEFORE_WINDOW_START", cutoffMs);

  if (row.feature_cutoff_ts != null) {
    const declared = ms(row.feature_cutoff_ts);
    if (declared !== cutoffMs) return fail("CUTOFF_TS_MISMATCH", cutoffMs);
  }

  if (row.received_at == null) return fail("RECEIVED_AT_MISSING", cutoffMs);
  const recvMs = ms(row.received_at);
  if (recvMs == null) return fail("RECEIVED_AT_INVALID", cutoffMs);
  // Receive-time is authoritative: T-1s arrival is excluded regardless of the
  // exchange event timestamp it carries.
  if (recvMs > cutoffMs) return fail("RECEIVED_AFTER_CUTOFF", cutoffMs);

  if (row.exchange_event_ts == null) return fail("EXCHANGE_EVENT_TS_MISSING", cutoffMs);
  const eventMs = ms(row.exchange_event_ts);
  if (eventMs == null) return fail("EXCHANGE_EVENT_TS_INVALID", cutoffMs);
  if (eventMs >= targetMs) return fail("EXCHANGE_EVENT_NOT_BEFORE_TARGET", cutoffMs);

  const offset = row.sample_offset_seconds;
  if (typeof offset === "number") {
    if (!Number.isInteger(offset) || offset < OBS_END_OFFSET_S || offset > OBS_START_OFFSET_S) {
      return fail("OFFSET_OUT_OF_RANGE", cutoffMs);
    }
    if (Math.round((targetMs - sampleMs) / 1000) !== offset) {
      return fail("OFFSET_INCONSISTENT_WITH_SAMPLE_TS", cutoffMs);
    }
  }

  return {
    eligible: true,
    reason: "OK",
    targetMs,
    cutoffMs,
    cutoffTs: new Date(cutoffMs).toISOString(),
  };
}

export interface TimingPartition<T> {
  accepted: T[];
  rejected: Array<{ row: T; reason: TimingReason }>;
  rejectedByReason: Record<string, number>;
}

/** Split a submitted batch into DB-insertable rows and audited rejections. */
export function partitionByTiming<T extends TimingCandidate>(rows: readonly T[]): TimingPartition<T> {
  const accepted: T[] = [];
  const rejected: Array<{ row: T; reason: TimingReason }> = [];
  const rejectedByReason: Record<string, number> = {};
  for (const row of rows) {
    const verdict = evaluateObservationTiming(row);
    if (verdict.eligible) accepted.push(row);
    else {
      rejected.push({ row, reason: verdict.reason });
      rejectedByReason[verdict.reason] = (rejectedByReason[verdict.reason] ?? 0) + 1;
    }
  }
  return { accepted, rejected, rejectedByReason };
}
