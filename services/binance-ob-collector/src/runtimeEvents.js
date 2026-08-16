// B4x4-ES1 Binance collector — runtime state machine and audit event emission.
//
// Every real state transition of the running collector goes through this class,
// so the audit vocabulary is exercised by the collector itself rather than only
// declared. `sink(event, payload)` delivers to the signed ingest endpoint.

export const COLLECTOR_EVENTS = {
  STARTUP: "collector-startup",
  DEPLOYMENT_IDENTITY: "deployment-identity",
  CONNECTING: "connecting",
  SNAPSHOT_SYNC: "snapshot-sync",
  SPOT_READY: "spot-ready",
  FUTURES_READY: "futures-ready",
  SEQUENCE_GAP: "sequence-gap",
  RESYNC: "resync",
  PLANNED_ROLLOVER: "planned-rollover",
  UNPLANNED_RECONNECT: "unplanned-reconnect",
  REGION_BLOCK: "region-block",
  BOUNDARY_BATCH_SENT: "boundary-batch-sent",
  BOUNDARY_BATCH_FAILED: "boundary-batch-failed",
  INGEST_FAILURE: "ingest-failure",
  HEARTBEAT_STALE: "heartbeat-stale",
};

export const HEARTBEAT_INTERVAL_MS = 5000;

export class CollectorRuntime {
  /**
   * @param {{ marketKind: string, deploymentId: string|null, collectorVersion: string,
   *           buildIdentifier: string|null, sink: (event: string, payload: object) => void,
   *           now?: () => number }} opts
   */
  constructor(opts) {
    this.marketKind = opts.marketKind;
    this.deploymentId = opts.deploymentId ?? null;
    this.collectorVersion = opts.collectorVersion;
    this.buildIdentifier = opts.buildIdentifier ?? null;
    this.sink = opts.sink;
    this.now = opts.now ?? (() => Date.now());

    this.status = "STARTING";
    this.lastEvent = null;
    this.lastEventAt = null;
    this.connectionStartedAt = null;
    this.reconnectCount = 0;
    this.resyncCount = 0;
    this.sequenceGapCount = 0;
    this.plannedRolloverCount = 0;
    this.snapshotSyncCount = 0;
    this.regionBlocked = false;
    this.consecutiveErrors = 0;
    this.lastErrorCode = null;
    this.lastErrorMessage = null;
    this.lastHeartbeatAt = null;
  }

  emit(event, payload = {}) {
    this.lastEvent = event;
    this.lastEventAt = new Date(this.now()).toISOString();
    this.sink(event, {
      market_kind: this.marketKind,
      deployment_id: this.deploymentId,
      collector_version: this.collectorVersion,
      build_identifier: this.buildIdentifier,
      at: this.lastEventAt,
      ...payload,
    });
  }

  startup() {
    this.emit(COLLECTOR_EVENTS.STARTUP, { status: this.status });
    this.emit(COLLECTOR_EVENTS.DEPLOYMENT_IDENTITY, {
      deployment_id: this.deploymentId,
      build_identifier: this.buildIdentifier,
      pid: typeof process !== "undefined" ? process.pid : null,
    });
  }

  connecting(url, { planned = false } = {}) {
    this.status = "CONNECTING";
    this.connectionStartedAt = new Date(this.now()).toISOString();
    this.emit(COLLECTOR_EVENTS.CONNECTING, { url, planned });
  }

  snapshotSynchronized(lastUpdateId) {
    this.snapshotSyncCount += 1;
    this.status = "SYNCHRONIZED";
    this.emit(COLLECTOR_EVENTS.SNAPSHOT_SYNC, { last_update_id: lastUpdateId ?? null });
  }

  ready() {
    this.status = "READY";
    this.emit(
      this.marketKind === "SPOT" ? COLLECTOR_EVENTS.SPOT_READY : COLLECTOR_EVENTS.FUTURES_READY,
      { connection_started_at: this.connectionStartedAt },
    );
  }

  sequenceGap(detail) {
    this.sequenceGapCount += 1;
    this.status = "SEQUENCE_GAP";
    this.emit(COLLECTOR_EVENTS.SEQUENCE_GAP, { detail: detail ?? null });
  }

  resyncing(reason) {
    this.resyncCount += 1;
    this.status = "RESYNCING";
    this.emit(COLLECTOR_EVENTS.RESYNC, { reason: reason ?? null });
  }

  plannedRollover(ageMs) {
    this.plannedRolloverCount += 1;
    this.emit(COLLECTOR_EVENTS.PLANNED_ROLLOVER, { connection_age_ms: ageMs ?? null });
  }

  unplannedDisconnect(reason) {
    this.reconnectCount += 1;
    this.status = "RECONNECTING";
    this.emit(COLLECTOR_EVENTS.UNPLANNED_RECONNECT, { reason: reason ?? null });
  }

  regionBlock(code, message) {
    this.regionBlocked = true;
    this.status = "REGION_BLOCKED";
    this.lastErrorCode = String(code ?? "451");
    this.lastErrorMessage = String(message ?? "Binance Global unreachable").slice(0, 400);
    this.emit(COLLECTOR_EVENTS.REGION_BLOCK, {
      code: this.lastErrorCode,
      message: this.lastErrorMessage,
    });
  }

  boundaryFinalized(targetTs, count) {
    this.emit(COLLECTOR_EVENTS.BOUNDARY_BATCH_SENT, {
      target_ts: targetTs,
      observation_count: count,
    });
  }

  boundaryFailed(targetTs, error) {
    this.emit(COLLECTOR_EVENTS.BOUNDARY_BATCH_FAILED, {
      target_ts: targetTs,
      error: String(error).slice(0, 400),
    });
  }

  ingestFailure(error) {
    this.consecutiveErrors += 1;
    this.lastErrorCode = "INGEST_FAILURE";
    this.lastErrorMessage = String(error).slice(0, 400);
    this.emit(COLLECTOR_EVENTS.INGEST_FAILURE, { error: this.lastErrorMessage });
  }

  heartbeatStale(ageMs) {
    this.emit(COLLECTOR_EVENTS.HEARTBEAT_STALE, { age_ms: ageMs });
  }

  /** Health row persisted at least every HEARTBEAT_INTERVAL_MS per market. */
  healthRow(book, extra = {}) {
    this.lastHeartbeatAt = new Date(this.now()).toISOString();
    return {
      market_kind: this.marketKind,
      collector_status: this.status,
      connection_started_at: this.connectionStartedAt,
      last_heartbeat_at: this.lastHeartbeatAt,
      heartbeat_interval_ms: HEARTBEAT_INTERVAL_MS,
      deployment_id: this.deploymentId,
      last_event: this.lastEvent,
      last_event_at: this.lastEventAt,
      resync_count: this.resyncCount,
      reconnect_count: this.reconnectCount,
      sequence_gap_count: this.sequenceGapCount,
      planned_rollover_count: this.plannedRolloverCount,
      snapshot_sync_count: this.snapshotSyncCount,
      region_blocked: this.regionBlocked,
      consecutive_error_count: this.consecutiveErrors,
      last_error_code: this.lastErrorCode,
      last_error_message: this.lastErrorMessage,
      collector_version: this.collectorVersion,
      build_identifier: this.buildIdentifier,
      last_update_id: book?.lastUpdateId ?? null,
      sequence_ok: book?.sequenceOk ?? false,
      local_book_initialized: book?.initialized ?? false,
      ...extra,
    };
  }
}
