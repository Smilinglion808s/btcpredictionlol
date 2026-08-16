// B4x4-ES1 Binance Order-Book R1 — runtime audit vocabulary (pure).
//
// Every runtime event is written through the existing `api_runs` convention as
// run_type = `binance-ob-<event>`. The collector pushes its own events to the
// ingest endpoint; the app writes finalization/watchdog/ingest events directly.

export const BINANCE_OB_AUDIT_EVENTS = [
  "collector-startup",
  "deployment-identity",
  "spot-ready",
  "futures-ready",
  "snapshot-sync",
  "sequence-gap",
  "resync",
  "planned-rollover",
  "unplanned-reconnect",
  "region-block",
  "connecting",
  "finalize-success",
  "finalize-failure",
  "heartbeat-stale",
  "database-failure",
  "ingest-failure",
  "boundary-batch-sent",
  "boundary-batch-failed",
  "ingest-rejected-timing",
  "watchdog-missing-boundary",
  "watchdog-run",
  "link-failed",
] as const;

export type BinanceObAuditEvent = (typeof BINANCE_OB_AUDIT_EVENTS)[number];

const EVENT_SET = new Set<string>(BINANCE_OB_AUDIT_EVENTS);

export function isBinanceObAuditEvent(value: unknown): value is BinanceObAuditEvent {
  return typeof value === "string" && EVENT_SET.has(value);
}

export function auditRunType(event: BinanceObAuditEvent): string {
  return `binance-ob-${event}`;
}

/** Events the collector is allowed to report through the signed ingest route. */
export const COLLECTOR_REPORTABLE_EVENTS: readonly BinanceObAuditEvent[] = [
  "collector-startup",
  "deployment-identity",
  "spot-ready",
  "futures-ready",
  "snapshot-sync",
  "sequence-gap",
  "resync",
  "planned-rollover",
  "unplanned-reconnect",
  "region-block",
  "heartbeat-stale",
  "ingest-failure",
  "boundary-batch-sent",
  "boundary-batch-failed",
  "connecting",
] as const;

const COLLECTOR_SET = new Set<string>(COLLECTOR_REPORTABLE_EVENTS);

export function isCollectorReportableEvent(value: unknown): value is BinanceObAuditEvent {
  return typeof value === "string" && COLLECTOR_SET.has(value);
}
