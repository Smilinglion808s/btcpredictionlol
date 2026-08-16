export declare const COLLECTOR_EVENTS: Record<string, string>;
export declare const HEARTBEAT_INTERVAL_MS: number;
export declare class CollectorRuntime {
  constructor(opts: {
    marketKind: string;
    deploymentId?: string | null;
    collectorVersion: string;
    buildIdentifier?: string | null;
    sink: (event: string, payload: Record<string, unknown>) => void;
    now?: () => number;
  });
  startup(): void;
  connecting(url: string, opts?: { planned?: boolean }): void;
  snapshotSynchronized(lastUpdateId: number | null): void;
  ready(): void;
  sequenceGap(detail: unknown): void;
  resyncing(reason: string): void;
  plannedRollover(ageMs: number): void;
  unplannedDisconnect(reason: string): void;
  regionBlock(code: unknown, message: unknown): void;
  boundaryFinalized(targetTs: string | null, count: number): void;
  boundaryFailed(targetTs: string | null, error: unknown): void;
  ingestFailure(error: unknown): void;
  heartbeatStale(ageMs: number): void;
  healthRow(book: unknown, extra?: Record<string, unknown>): Record<string, any>;
}
