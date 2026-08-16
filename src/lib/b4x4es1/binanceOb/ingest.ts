// B4x4-ES1 Binance Order-Book R1 — signed-ingest processing (pure + injected IO).
//
// Every submitted observation is validated through `timing.ts` before anything
// is persisted. Timestamps are never clamped or rewritten: a row that misses
// the T-2s contract is rejected with its precise reason and audited.

import { BINANCE_OB_COLLECTOR_VERSION } from "./config";
import { COLLECTOR_REPORTABLE_EVENTS, isCollectorReportableEvent } from "./audit";
import { evaluateObservationTiming, type TimingReason } from "./timing";

export interface IngestObservation extends Record<string, unknown> {
  target_ts: string;
  market_kind: "SPOT" | "USD_M_PERP";
  sample_offset_seconds: number;
  collector_version?: string;
}

export interface IngestBody {
  collector_version: string;
  build_identifier?: string | null;
  observations?: IngestObservation[];
  health?: Record<string, unknown> | null;
  events?: Array<{ event: string; payload?: Record<string, unknown> }> | null;
}

export interface IngestRejection {
  target_ts: unknown;
  market_kind: unknown;
  sample_offset_seconds: unknown;
  reason: TimingReason | "DUPLICATE_IN_BATCH";
}

export interface IngestResult {
  received: number;
  accepted: number;
  rejected: number;
  duplicate: number;
  stored: number;
  rejected_by_reason: Record<string, number>;
  rejections: IngestRejection[];
  health_written: boolean;
  events_recorded: number;
  events_ignored: number;
}

export interface IngestDeps {
  /** Keys already present in the database, formatted by `observationKey`. */
  existingKeys(rows: IngestObservation[]): Promise<Set<string>>;
  insertObservations(rows: IngestObservation[]): Promise<number>;
  upsertHealth(row: Record<string, unknown>): Promise<void>;
  audit(event: string, payload: Record<string, unknown>, success?: boolean): Promise<void>;
}

export function observationKey(row: {
  target_ts: unknown;
  market_kind: unknown;
  sample_offset_seconds: unknown;
  collector_version?: unknown;
}): string {
  const version =
    typeof row.collector_version === "string" && row.collector_version.length > 0
      ? row.collector_version
      : BINANCE_OB_COLLECTOR_VERSION;
  return [
    new Date(String(row.target_ts)).toISOString(),
    String(row.market_kind),
    String(row.sample_offset_seconds),
    version,
  ].join("|");
}

const MAX_REJECTION_DETAIL = 40;

/**
 * Validate, de-duplicate and persist one collector batch.
 * Repeated identical batches are idempotent: the second call stores nothing and
 * reports every row as a duplicate.
 */
export async function processIngest(body: IngestBody, deps: IngestDeps): Promise<IngestResult> {
  const submitted = body.observations ?? [];
  const result: IngestResult = {
    received: submitted.length,
    accepted: 0,
    rejected: 0,
    duplicate: 0,
    stored: 0,
    rejected_by_reason: {},
    rejections: [],
    health_written: false,
    events_recorded: 0,
    events_ignored: 0,
  };

  const reject = (row: IngestObservation, reason: IngestRejection["reason"]) => {
    result.rejected++;
    result.rejected_by_reason[reason] = (result.rejected_by_reason[reason] ?? 0) + 1;
    if (result.rejections.length < MAX_REJECTION_DETAIL) {
      result.rejections.push({
        target_ts: row.target_ts,
        market_kind: row.market_kind,
        sample_offset_seconds: row.sample_offset_seconds,
        reason,
      });
    }
  };

  // 1. Timing validation — receive time is authoritative.
  const timingValid: IngestObservation[] = [];
  for (const row of submitted) {
    const verdict = evaluateObservationTiming(row);
    if (!verdict.eligible) {
      reject(row, verdict.reason);
      continue;
    }
    timingValid.push({
      ...row,
      collector_version: row.collector_version ?? body.collector_version,
    });
  }

  // 2. In-batch de-duplication.
  const seen = new Set<string>();
  const unique: IngestObservation[] = [];
  for (const row of timingValid) {
    const key = observationKey(row);
    if (seen.has(key)) {
      result.duplicate++;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }

  // 3. Database-level de-duplication (idempotent replays).
  let toInsert = unique;
  if (unique.length > 0) {
    const existing = await deps.existingKeys(unique);
    if (existing.size > 0) {
      toInsert = unique.filter((r) => {
        const dup = existing.has(observationKey(r));
        if (dup) result.duplicate++;
        return !dup;
      });
    }
  }

  result.accepted = unique.length;
  if (toInsert.length > 0) {
    result.stored = await deps.insertObservations(toInsert);
  }

  if (result.rejected > 0) {
    await deps.audit(
      "ingest-rejected-timing",
      {
        collector_version: body.collector_version,
        rejected: result.rejected,
        rejected_by_reason: result.rejected_by_reason,
        sample: result.rejections.slice(0, 10),
      },
      false,
    );
  }

  // 4. Collector health snapshot.
  if (body.health) {
    await deps.upsertHealth({
      ...body.health,
      collector_version: body.health.collector_version ?? body.collector_version,
      build_identifier: body.health.build_identifier ?? body.build_identifier ?? null,
    });
    result.health_written = true;
  }

  // 5. Collector-reported runtime state transitions.
  for (const e of body.events ?? []) {
    if (!isCollectorReportableEvent(e?.event)) {
      result.events_ignored++;
      continue;
    }
    await deps.audit(e.event, {
      ...(e.payload ?? {}),
      collector_version: body.collector_version,
      build_identifier: body.build_identifier ?? null,
    });
    result.events_recorded++;
  }

  return result;
}

export const INGEST_REPORTABLE_EVENTS = COLLECTOR_REPORTABLE_EVENTS;
