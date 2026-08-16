// B4x4-ES1 Binance Order-Book R1 — pure local order-book reconstruction.
//
// Implements Binance's documented snapshot+buffer rules for Spot and the
// `pu === previous u` continuity rule for USD-M perpetual futures. This module
// is intentionally free of I/O so the collector service and the repository test
// suite exercise exactly the same logic.

import type { MarketKind } from "./config";
import type { DepthDiffEvent, DepthSnapshot, PriceLevel } from "./types";

export type BookState =
  | "CONNECTING"
  | "BUFFERING"
  | "SNAPSHOT_SYNC"
  | "READY"
  | "GAP_DETECTED"
  | "STALE"
  | "ERROR"
  | "RESYNCING";

export interface ApplyResult {
  applied: boolean;
  /** Set when the book had to be invalidated and must be rebuilt from REST. */
  invalidated: boolean;
  reason?: string;
}

export interface SnapshotResult {
  ok: boolean;
  /** True when the snapshot is too old and a newer one must be fetched. */
  refetch: boolean;
  reason?: string;
}

export class LocalOrderBook {
  readonly marketKind: MarketKind;

  private bids = new Map<number, number>();
  private asks = new Map<number, number>();
  private buffer: DepthDiffEvent[] = [];

  state: BookState = "CONNECTING";
  initialized = false;
  lastUpdateId: number | null = null;
  firstUpdateIdApplied: number | null = null;
  previousUpdateId: number | null = null;
  resyncGeneration = 0;
  sequenceOk = false;
  /** Wall-clock ms of the last applied event's receive time. */
  lastReceivedAtMs: number | null = null;
  lastExchangeEventMs: number | null = null;
  /** Set when the current book was seeded from an isolated REST response. */
  restFallback = false;

  constructor(marketKind: MarketKind) {
    this.marketKind = marketKind;
  }

  /** Buffer a diff event received before the snapshot has been applied. */
  bufferEvent(event: DepthDiffEvent): void {
    this.state = "BUFFERING";
    this.buffer.push(event);
  }

  get bufferedCount(): number {
    return this.buffer.length;
  }

  /**
   * Apply a REST snapshot and drain the buffer per Binance's rules.
   *
   * Spot:  drop buffered events with `u <= lastUpdateId`; the first applied
   *        event must satisfy `U <= lastUpdateId + 1 <= u`.
   * Perp:  same entry condition; continuity afterwards is `pu === previous u`.
   */
  applySnapshot(snapshot: DepthSnapshot, receivedAtMs: number): SnapshotResult {
    this.state = "SNAPSHOT_SYNC";
    this.bids = new Map();
    this.asks = new Map();
    for (const [p, q] of snapshot.bids) this.setLevel("bid", Number(p), Number(q));
    for (const [p, q] of snapshot.asks) this.setLevel("ask", Number(p), Number(q));

    const usable = this.buffer.filter((e) => e.u > snapshot.lastUpdateId);
    this.buffer = [];

    if (usable.length > 0) {
      const first = usable[0]!;
      // The snapshot must overlap the first usable event; otherwise it is stale.
      if (!(first.U <= snapshot.lastUpdateId + 1 && snapshot.lastUpdateId + 1 <= first.u)) {
        this.initialized = false;
        this.sequenceOk = false;
        this.state = "RESYNCING";
        return { ok: false, refetch: true, reason: "SNAPSHOT_NO_OVERLAP" };
      }
    }

    this.initialized = true;
    this.sequenceOk = true;
    this.restFallback = usable.length === 0;
    this.lastUpdateId = snapshot.lastUpdateId;
    this.previousUpdateId = null;
    this.firstUpdateIdApplied = null;
    this.lastReceivedAtMs = receivedAtMs;
    this.state = "READY";

    for (const event of usable) {
      const res = this.applyEvent(event, receivedAtMs);
      if (res.invalidated) return { ok: false, refetch: true, reason: res.reason };
    }
    return { ok: true, refetch: false };
  }

  /** Apply one diff event. Buffers instead when the book is not initialized. */
  applyEvent(event: DepthDiffEvent, receivedAtMs: number): ApplyResult {
    if (!this.initialized) {
      this.bufferEvent(event);
      return { applied: false, invalidated: false, reason: "BUFFERED" };
    }
    const local = this.lastUpdateId!;

    if (event.u <= local && this.firstUpdateIdApplied !== null) {
      // Already-seen update; ignore without invalidating.
      return { applied: false, invalidated: false, reason: "STALE_EVENT" };
    }

    if (this.marketKind === "USD_M_PERP") {
      if (this.firstUpdateIdApplied === null) {
        if (!(event.U <= local + 1 && local + 1 <= event.u) && event.u <= local) {
          return { applied: false, invalidated: false, reason: "STALE_EVENT" };
        }
      } else if (event.pu !== this.lastUpdateId) {
        return this.invalidate("FUTURES_PU_MISMATCH");
      }
    } else {
      // Spot: a later event may never start beyond localUpdateId + 1.
      if (this.firstUpdateIdApplied !== null && event.U > local + 1) {
        return this.invalidate("SPOT_SEQUENCE_GAP");
      }
    }

    for (const [p, q] of event.b) this.setLevel("bid", Number(p), Number(q));
    for (const [p, q] of event.a) this.setLevel("ask", Number(p), Number(q));

    this.previousUpdateId = this.lastUpdateId;
    this.firstUpdateIdApplied ??= event.U;
    this.lastUpdateId = event.u;
    this.lastReceivedAtMs = receivedAtMs;
    this.lastExchangeEventMs = event.E;
    this.sequenceOk = true;
    this.restFallback = false;
    this.state = "READY";
    return { applied: true, invalidated: false };
  }

  private invalidate(reason: string): ApplyResult {
    this.initialized = false;
    this.sequenceOk = false;
    this.state = "GAP_DETECTED";
    this.resyncGeneration += 1;
    this.buffer = [];
    this.bids = new Map();
    this.asks = new Map();
    return { applied: false, invalidated: true, reason };
  }

  /** Explicitly drop the book (stale feed, reconnect, planned rollover). */
  reset(reason: string): void {
    this.invalidate(reason);
    this.state = "RESYNCING";
  }

  private setLevel(side: "bid" | "ask", price: number, qty: number): void {
    const book = side === "bid" ? this.bids : this.asks;
    if (!Number.isFinite(price) || !Number.isFinite(qty)) return;
    // Absolute quantities; zero deletes the level.
    if (qty === 0) book.delete(price);
    else book.set(price, qty);
  }

  /** Descending bid levels. */
  bidLevels(): PriceLevel[] {
    return [...this.bids.entries()].sort((a, b) => b[0] - a[0]) as PriceLevel[];
  }

  /** Ascending ask levels. */
  askLevels(): PriceLevel[] {
    return [...this.asks.entries()].sort((a, b) => a[0] - b[0]) as PriceLevel[];
  }

  get levelCount(): { bids: number; asks: number } {
    return { bids: this.bids.size, asks: this.asks.size };
  }
}
