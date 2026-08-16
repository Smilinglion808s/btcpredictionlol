// B4x4-ES1 Binance Global order-book collector.
//
// Always-on external host. Maintains local depth books for Binance Global Spot
// and USD-M Perpetual BTCUSDT, samples one derived observation per integer
// second at offsets T-60s .. T-2s before each 15-minute UTC boundary, and
// pushes signed batches to the app's ingest endpoint.
//
// Shadow only. This service never emits a trading webhook.

import WebSocket from "ws";
import { createHmac } from "node:crypto";
import { LocalOrderBook } from "./localBook.js";
import { computeBookMetrics } from "./metrics.js";

const INGEST_URL = requireEnv("BINANCE_OB_INGEST_URL");
const INGEST_SECRET = requireEnv("BINANCE_OB_INGEST_SECRET");

const COLLECTOR_VERSION = "binance-ob-collector-r1";
const IMPLEMENTATION_REVISION = "binance-ob-r1";
const CONFIG_HASH = process.env.BINANCE_OB_CONFIG_HASH ?? "unset";
const FEATURE_SCHEMA_HASH = process.env.BINANCE_OB_FEATURE_SCHEMA_HASH ?? "unset";
const BUILD_IDENTIFIER = process.env.BINANCE_OB_BUILD_ID ?? null;

const VENUE = "BINANCE_GLOBAL";
const SYMBOL = "BTCUSDT";
const TF_MS = 15 * 60 * 1000;
const OBS_START_OFFSET_S = 60;
const OBS_END_OFFSET_S = 2;
const HEARTBEAT_INTERVAL_MS = 5000;
const SNAPSHOT_REFRESH_MS = 30 * 60 * 1000;

const SOURCES = {
  SPOT: {
    marketKind: "SPOT",
    wsUrl: "wss://stream.binance.com:9443/ws/btcusdt@depth@100ms",
    wsAlternateUrl: "wss://stream.binance.com:443/ws/btcusdt@depth@100ms",
    snapshotUrl: "https://api.binance.com/api/v3/depth?symbol=BTCUSDT&limit=5000",
    sourceWsUrlId: "binance-global-spot-btcusdt-depth-100ms",
  },
  USD_M_PERP: {
    marketKind: "USD_M_PERP",
    wsUrl: "wss://fstream.binance.com/public/ws/btcusdt@depth@100ms",
    wsAlternateUrl: null,
    snapshotUrl: "https://fapi.binance.com/fapi/v1/depth?symbol=BTCUSDT&limit=1000",
    sourceWsUrlId: "binance-global-usdm-btcusdt-depth-100ms",
  },
};

function requireEnv(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[collector] missing required env ${name}`);
    process.exit(1);
  }
  return v;
}

function log(...args) {
  console.log(new Date().toISOString(), ...args);
}

class MarketCollector {
  constructor(source) {
    this.source = source;
    this.book = new LocalOrderBook(source.marketKind);
    this.ws = null;
    this.useAlternate = false;
    this.status = "STARTING";
    this.lastEventTs = null;
    this.lastReceivedAt = null;
    this.reconnectCount = 0;
    this.resyncCount = 0;
    this.consecutiveErrors = 0;
    this.lastErrorCode = null;
    this.lastErrorMessage = null;
    this.connectionStartedAt = null;
    this.lastSnapshotAt = 0;
    this.pending = [];
    this.regionBlocked = false;
  }

  connect() {
    const url = this.useAlternate && this.source.wsAlternateUrl
      ? this.source.wsAlternateUrl
      : this.source.wsUrl;
    log(`[${this.source.marketKind}] connecting ${url}`);
    this.connectionStartedAt = new Date().toISOString();
    const ws = new WebSocket(url);
    this.ws = ws;

    ws.on("open", () => {
      this.status = "RESYNCING";
      this.consecutiveErrors = 0;
      this.book.reset();
      void this.loadSnapshot();
    });

    ws.on("message", (raw) => {
      this.lastReceivedAt = new Date().toISOString();
      let ev;
      try {
        ev = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (!ev || ev.e !== "depthUpdate") return;
      this.lastEventTs = new Date(ev.E).toISOString();
      const ok = this.book.applyEvent(ev);
      if (!ok) {
        this.status = "SEQUENCE_GAP";
        this.resyncCount += 1;
        this.book.reset();
        void this.loadSnapshot();
        return;
      }
      if (this.book.initialized && this.book.sequenceOk) this.status = "HEALTHY";
    });

    ws.on("close", () => {
      this.status = "RECONNECTING";
      this.reconnectCount += 1;
      this.useAlternate = !this.useAlternate;
      setTimeout(() => this.connect(), Math.min(30_000, 1000 * (this.consecutiveErrors + 1)));
    });

    ws.on("error", (err) => {
      this.consecutiveErrors += 1;
      this.lastErrorCode = err?.code ?? "WS_ERROR";
      this.lastErrorMessage = String(err?.message ?? err).slice(0, 400);
      if (/451|403/.test(this.lastErrorMessage)) {
        this.regionBlocked = true;
        this.status = "REGION_BLOCKED";
      }
      log(`[${this.source.marketKind}] ws error`, this.lastErrorMessage);
      try {
        ws.close();
      } catch {
        /* already closing */
      }
    });
  }

  async loadSnapshot() {
    try {
      const res = await fetch(this.source.snapshotUrl);
      if (res.status === 451 || res.status === 403) {
        this.regionBlocked = true;
        this.status = "REGION_BLOCKED";
        this.lastErrorCode = String(res.status);
        this.lastErrorMessage = "Binance Global unreachable from this host";
        return;
      }
      if (!res.ok) throw new Error(`snapshot ${res.status}`);
      const snap = await res.json();
      const ok = this.book.applySnapshot(snap);
      this.lastSnapshotAt = Date.now();
      this.status = ok ? "HEALTHY" : "RESYNCING";
      if (!ok) {
        this.resyncCount += 1;
        setTimeout(() => this.loadSnapshot(), 1000);
      }
    } catch (err) {
      this.consecutiveErrors += 1;
      this.lastErrorCode = "SNAPSHOT_ERROR";
      this.lastErrorMessage = String(err).slice(0, 400);
      setTimeout(() => this.loadSnapshot(), 1500);
    }
  }

  captureStatus() {
    if (this.regionBlocked) return "REGION_BLOCKED";
    if (!this.book.initialized) return "NO_DATA";
    if (!this.book.sequenceOk) return "SEQUENCE_GAP";
    if (this.status === "RESYNCING") return "RESYNCING";
    if (this.status !== "HEALTHY") return "COLLECTOR_ERROR";
    return "FRESH";
  }

  /** Build one observation row for `targetMs` at integer offset `offset`. */
  sample(targetMs, offset) {
    const now = Date.now();
    const { bids, asks } = this.book.levels();
    const m = computeBookMetrics(bids, asks);
    const flow = this.book.drainFlow();
    const band = (d) => m.bands[d] ?? {};
    const total10 = band(10).totalDepthBtc ?? 0;
    const ofi =
      total10 > 0
        ? (flow.bidAdded - flow.bidRemoved - (flow.askAdded - flow.askRemoved)) / total10
        : null;

    const eventMs = this.lastEventTs ? new Date(this.lastEventTs).getTime() : null;
    const recvMs = this.lastReceivedAt ? new Date(this.lastReceivedAt).getTime() : null;
    const complete = (band(10).bidDepthBtc ?? 0) > 0 && (band(10).askDepthBtc ?? 0) > 0;

    let capture = this.captureStatus();
    if (capture === "FRESH" && m.crossed) capture = "CROSSED_BOOK";
    if (capture === "FRESH" && !complete) capture = "INCOMPLETE_BOOK";

    return {
      target_ts: new Date(targetMs).toISOString(),
      market_kind: this.source.marketKind,
      venue: VENUE,
      symbol: SYMBOL,
      sample_offset_seconds: offset,
      sample_ts: new Date(now).toISOString(),
      feature_cutoff_ts: new Date(targetMs - OBS_END_OFFSET_S * 1000).toISOString(),

      exchange_event_ts: this.lastEventTs,
      received_at: this.lastReceivedAt,
      exchange_to_receive_ms: eventMs != null && recvMs != null ? recvMs - eventMs : null,
      target_age_ms: eventMs != null ? targetMs - eventMs : null,

      first_update_id: this.book.firstUpdateId,
      last_update_id: this.book.lastUpdateId,
      previous_update_id: this.book.previousUpdateId,
      sequence_ok: this.book.sequenceOk,
      local_book_initialized: this.book.initialized,
      book_complete_10bps: complete,
      resync_generation: this.book.resyncGeneration,
      update_count_1s: flow.updateCount,

      best_bid: m.bestBid,
      best_bid_qty_btc: m.bestBidQtyBtc,
      best_ask: m.bestAsk,
      best_ask_qty_btc: m.bestAskQtyBtc,
      mid_price: m.midPrice,
      spread_bps: m.spreadBps,
      microprice: m.microprice,
      microprice_displacement_bps: m.micropriceDisplacementBps,

      bid_depth_btc_1bps: band(1).bidDepthBtc ?? null,
      ask_depth_btc_1bps: band(1).askDepthBtc ?? null,
      total_depth_btc_1bps: band(1).totalDepthBtc ?? null,
      imbalance_1bps: band(1).imbalance ?? null,
      bid_depth_btc_2bps: band(2).bidDepthBtc ?? null,
      ask_depth_btc_2bps: band(2).askDepthBtc ?? null,
      total_depth_btc_2bps: band(2).totalDepthBtc ?? null,
      imbalance_2bps: band(2).imbalance ?? null,
      bid_depth_btc_5bps: band(5).bidDepthBtc ?? null,
      ask_depth_btc_5bps: band(5).askDepthBtc ?? null,
      total_depth_btc_5bps: band(5).totalDepthBtc ?? null,
      imbalance_5bps: band(5).imbalance ?? null,
      bid_depth_btc_10bps: band(10).bidDepthBtc ?? null,
      ask_depth_btc_10bps: band(10).askDepthBtc ?? null,
      total_depth_btc_10bps: band(10).totalDepthBtc ?? null,
      bid_depth_usd_10bps: band(10).bidDepthUsd ?? null,
      ask_depth_usd_10bps: band(10).askDepthUsd ?? null,
      total_depth_usd_10bps: band(10).totalDepthUsd ?? null,
      imbalance_10bps: band(10).imbalance ?? null,
      abs_imbalance_10bps: band(10).imbalance == null ? null : Math.abs(band(10).imbalance),

      bid_added_btc_1s: flow.bidAdded,
      bid_removed_btc_1s: flow.bidRemoved,
      ask_added_btc_1s: flow.askAdded,
      ask_removed_btc_1s: flow.askRemoved,
      normalized_ofi_1s: ofi,

      capture_status: capture,
      capture_reason: capture === "FRESH" ? null : `${this.status}:${this.lastErrorCode ?? ""}`,
      source_ws_url_id: this.source.sourceWsUrlId,
      collector_version: COLLECTOR_VERSION,
      implementation_revision: IMPLEMENTATION_REVISION,
      build_identifier: BUILD_IDENTIFIER,
      config_hash: CONFIG_HASH,
      feature_schema_hash: FEATURE_SCHEMA_HASH,
    };
  }

  healthRow() {
    return {
      market_kind: this.source.marketKind,
      venue: VENUE,
      symbol: SYMBOL,
      collector_status: this.status,
      connection_started_at: this.connectionStartedAt,
      last_heartbeat_at: new Date().toISOString(),
      last_exchange_event_ts: this.lastEventTs,
      last_received_at: this.lastReceivedAt,
      last_update_id: this.book.lastUpdateId,
      sequence_ok: this.book.sequenceOk,
      local_book_initialized: this.book.initialized,
      resync_count: this.resyncCount,
      reconnect_count: this.reconnectCount,
      consecutive_error_count: this.consecutiveErrors,
      last_error_code: this.lastErrorCode,
      last_error_message: this.lastErrorMessage,
      collector_version: COLLECTOR_VERSION,
      build_identifier: BUILD_IDENTIFIER,
      config_hash: CONFIG_HASH,
    };
  }
}

async function post(body) {
  const raw = JSON.stringify(body);
  const ts = String(Date.now());
  const signature = createHmac("sha256", INGEST_SECRET).update(`${ts}.${raw}`).digest("hex");
  const res = await fetch(INGEST_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-binance-ob-timestamp": ts,
      "x-binance-ob-signature": signature,
    },
    body: raw,
  });
  if (!res.ok) {
    log("[ingest] failed", res.status, (await res.text()).slice(0, 300));
    return false;
  }
  return true;
}

async function main() {
  const collectors = Object.values(SOURCES).map((s) => new MarketCollector(s));
  for (const c of collectors) c.connect();

  // Periodic snapshot refresh keeps long-lived books from drifting.
  setInterval(() => {
    for (const c of collectors) {
      if (Date.now() - c.lastSnapshotAt > SNAPSHOT_REFRESH_MS) void c.loadSnapshot();
    }
  }, 60_000);

  // Heartbeat.
  setInterval(() => {
    for (const c of collectors) {
      void post({
        collector_version: COLLECTOR_VERSION,
        build_identifier: BUILD_IDENTIFIER,
        observations: [],
        health: c.healthRow(),
      }).catch(() => {});
    }
  }, HEARTBEAT_INTERVAL_MS);

  // One-second sampling loop, aligned to wall-clock seconds.
  let buffered = [];
  const tick = () => {
    const now = Date.now();
    const nextBoundary = Math.ceil(now / TF_MS) * TF_MS;
    const offset = Math.round((nextBoundary - now) / 1000);
    if (offset <= OBS_START_OFFSET_S && offset >= OBS_END_OFFSET_S) {
      for (const c of collectors) buffered.push(c.sample(nextBoundary, offset));
    }
    // Flush right after the final sample so the app has the row before T.
    if (offset === OBS_END_OFFSET_S && buffered.length > 0) {
      const batch = buffered;
      buffered = [];
      void post({
        collector_version: COLLECTOR_VERSION,
        build_identifier: BUILD_IDENTIFIER,
        observations: batch,
        health: null,
      }).catch((e) => log("[ingest] error", String(e)));
    }
    // Mid-window partial flush keeps batches small and bounds loss on crash.
    if (buffered.length >= 60) {
      const batch = buffered;
      buffered = [];
      void post({
        collector_version: COLLECTOR_VERSION,
        build_identifier: BUILD_IDENTIFIER,
        observations: batch,
        health: null,
      }).catch(() => {});
    }
    const drift = Date.now() % 1000;
    setTimeout(tick, 1000 - drift);
  };
  setTimeout(tick, 1000 - (Date.now() % 1000));

  log("[collector] started", { ingest: INGEST_URL, version: COLLECTOR_VERSION });
}

main().catch((e) => {
  console.error("[collector] fatal", e);
  process.exit(1);
});
