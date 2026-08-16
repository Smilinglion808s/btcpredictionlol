// Local order-book reconstruction for Binance Global Spot and USD-M Perpetual.
//
// Mirrors src/lib/b4x4es1/binanceOb/localBook.ts in the main repo. Continuity
// rules follow Binance's published contract exactly:
//   Spot: first applied event needs U <= lastUpdateId + 1 <= u; then
//         each next event must satisfy U === previous u + 1.
//   Perp: first applied event needs U <= lastUpdateId <= u; then
//         each next event must satisfy pu === previous u.
// Any violation marks the book out of sequence and forces a resync.

export class LocalOrderBook {
  constructor(marketKind) {
    this.marketKind = marketKind;
    this.bids = new Map();
    this.asks = new Map();
    this.initialized = false;
    this.sequenceOk = false;
    this.lastUpdateId = null;
    this.firstUpdateId = null;
    this.previousUpdateId = null;
    this.resyncGeneration = 0;
    this.awaitingFirstLive = false;
    this.updateCount = 0;
    this.buffer = [];
    // Rolling per-second flow accounting.
    this.bidAdded = 0;
    this.bidRemoved = 0;
    this.askAdded = 0;
    this.askRemoved = 0;
  }

  reset() {
    this.bids.clear();
    this.asks.clear();
    this.initialized = false;
    this.sequenceOk = false;
    this.lastUpdateId = null;
    this.buffer = [];
    this.awaitingFirstLive = false;
    this.resyncGeneration += 1;
  }

  applySnapshot(snapshot) {
    this.bids.clear();
    this.asks.clear();
    for (const [p, q] of snapshot.bids) this.#set(this.bids, p, q);
    for (const [p, q] of snapshot.asks) this.#set(this.asks, p, q);
    this.lastUpdateId = snapshot.lastUpdateId;
    this.initialized = true;
    this.sequenceOk = true;
    // Until one live event has been accepted, continuity is judged with
    // Binance's *first event* rule, not the running pu / U+1 rule.
    this.awaitingFirstLive = true;


    // Drain buffered diffs recorded while the snapshot was in flight.
    const buffered = this.buffer;
    this.buffer = [];
    let first = true;
    for (const ev of buffered) {
      if (this.marketKind === "SPOT") {
        if (ev.u <= snapshot.lastUpdateId) continue;
        if (first) {
          if (!(ev.U <= snapshot.lastUpdateId + 1 && snapshot.lastUpdateId + 1 <= ev.u)) {
            this.sequenceOk = false;
            return false;
          }
          first = false;
        }
      } else {
        if (ev.u < snapshot.lastUpdateId) continue;
        if (first) {
          if (!(ev.U <= snapshot.lastUpdateId && snapshot.lastUpdateId <= ev.u)) {
            this.sequenceOk = false;
            return false;
          }
          first = false;
        }
      }
      if (!this.#apply(ev, true)) return false;
    }
    return this.sequenceOk;
  }

  bufferEvent(ev) {
    this.buffer.push(ev);
    if (this.buffer.length > 5000) this.buffer.shift();
  }

  applyEvent(ev) {
    if (!this.initialized) {
      this.bufferEvent(ev);
      return true;
    }
    return this.#apply(ev, false);
  }

  #apply(ev, fromBuffer) {
    if (!fromBuffer && this.lastUpdateId != null) {
      if (this.awaitingFirstLive) {
        // First live event after a snapshot: Binance's entry rule applies. The
        // running pu / U+1 rule cannot hold here because no live event has been
        // applied on top of the snapshot yet — enforcing it caused spurious
        // sequence gaps and resync storms.
        if (this.marketKind === "SPOT") {
          if (ev.u <= this.lastUpdateId) return true; // fully stale, ignore
          if (!(ev.U <= this.lastUpdateId + 1 && this.lastUpdateId + 1 <= ev.u)) {
            this.sequenceOk = false;
            return false;
          }
        } else {
          if (ev.u < this.lastUpdateId) return true;
          if (!(ev.U <= this.lastUpdateId && this.lastUpdateId <= ev.u)) {
            this.sequenceOk = false;
            return false;
          }
        }
      } else if (this.marketKind === "SPOT") {
        if (ev.u <= this.lastUpdateId) return true; // stale, ignore
        if (ev.U !== this.lastUpdateId + 1) {
          this.sequenceOk = false;
          return false;
        }
      } else {
        if (ev.u < this.lastUpdateId) return true;
        if (ev.pu != null && ev.pu !== this.lastUpdateId) {
          this.sequenceOk = false;
          return false;
        }
      }
    }
    for (const [p, q] of ev.b) this.#track(this.bids, p, q, "bid");
    for (const [p, q] of ev.a) this.#track(this.asks, p, q, "ask");
    this.previousUpdateId = this.lastUpdateId;
    this.firstUpdateId = ev.U;
    this.lastUpdateId = ev.u;
    this.updateCount += 1;
    this.awaitingFirstLive = false;
    return true;
  }

  #track(side, priceStr, qtyStr, kind) {
    const price = Number(priceStr);
    const qty = Number(qtyStr);
    const prev = side.get(price) ?? 0;
    const delta = qty - prev;
    if (delta > 0) {
      if (kind === "bid") this.bidAdded += delta;
      else this.askAdded += delta;
    } else if (delta < 0) {
      if (kind === "bid") this.bidRemoved += -delta;
      else this.askRemoved += -delta;
    }
    this.#set(side, priceStr, qtyStr);
  }

  #set(side, priceStr, qtyStr) {
    const price = Number(priceStr);
    const qty = Number(qtyStr);
    if (!Number.isFinite(price)) return;
    if (!Number.isFinite(qty) || qty <= 0) side.delete(price);
    else side.set(price, qty);
  }

  /** Bids descending, asks ascending. */
  levels() {
    const bids = [...this.bids.entries()].sort((a, b) => b[0] - a[0]);
    const asks = [...this.asks.entries()].sort((a, b) => a[0] - b[0]);
    return { bids, asks };
  }

  /** Consume and reset the per-second flow counters. */
  drainFlow() {
    const flow = {
      bidAdded: this.bidAdded,
      bidRemoved: this.bidRemoved,
      askAdded: this.askAdded,
      askRemoved: this.askRemoved,
      updateCount: this.updateCount,
    };
    this.bidAdded = 0;
    this.bidRemoved = 0;
    this.askAdded = 0;
    this.askRemoved = 0;
    this.updateCount = 0;
    return flow;
  }
}
