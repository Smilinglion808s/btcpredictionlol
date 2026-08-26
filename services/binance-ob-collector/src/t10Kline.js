// T10 Bridge R1 — Binance Global Spot 1s kline capture.
//
// Runs inside the existing always-on collector process (Cloudflare Workers
// cannot hold a persistent WebSocket) on its OWN WebSocket connection, so it
// can never perturb the T30 or T45 capture paths. It subscribes to
// `btcusdt@kline_1s`, keeps only FINAL bars whose open time falls in offsets
// 0..9 of a 15-minute UTC candle, and flushes each candle's 10 bars to the
// app immediately after offset 9 closes, then triggers the T+10s decision.
//
// Binance Global only. Binance.US is never an acceptable substitute.

import { createHmac } from "node:crypto";
import WebSocket from "ws";

const WS_URL = "wss://stream.binance.com:9443/ws/btcusdt@kline_1s";
const WS_ALTERNATE_URL = "wss://stream.binance.com:443/ws/btcusdt@kline_1s";
const COLLECTOR_VERSION = "t10-kline-collector-r1";
const TF_MS = 15 * 60 * 1000;
const LAST_OFFSET_S = 9;
const EXPECTED = 10;
const HEARTBEAT_INTERVAL_MS = 5_000;
// The app's edge worker is geo-blocked from Binance REST (HTTP 403), so this
// always-on process owns the completed 15m technical history too.
const KLINE_REFRESH_MS = 60_000;
const KLINE_LIMIT = 80;
const SPOT_KLINE_URL = "https://api.binance.com/api/v3/klines";
const FUT_KLINE_URL = "https://fapi.binance.com/fapi/v1/klines";
let lastKlinePushMs = 0;

async function fetchVenueKlines(url, venue) {
  const qs = `symbol=BTCUSDT&interval=15m&limit=${KLINE_LIMIT}`;
  const res = await fetch(`${url}?${qs}`);
  if (!res.ok) throw new Error(`t10_kline_history_${venue}_${res.status}`);
  const rows = await res.json();
  const nowMs = Date.now();
  return rows
    // Only fully CLOSED candles may become technical inputs.
    .filter((k) => Number(k[6]) < nowMs)
    .map((k) => ({
      venue,
      open_ms: Number(k[0]),
      open: Number(k[1]),
      high: Number(k[2]),
      low: Number(k[3]),
      close: Number(k[4]),
      volume: Number(k[5]),
      quote_volume: Number(k[7]),
      trade_count: Number(k[8]),
      taker_buy_quote_volume: Number(k[10]),
    }));
}

async function fetchPriorKlines() {
  try {
    const [spot, fut] = await Promise.all([
      fetchVenueKlines(SPOT_KLINE_URL, "SPOT"),
      fetchVenueKlines(FUT_KLINE_URL, "FUT"),
    ]);
    return [...spot, ...fut];
  } catch {
    return [];
  }
}

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function createT10Collector({
  ingestUrl,
  secret,
  boundaryUrl = null,
  buildIdentifier = null,
  log = console,
}) {
  if (!ingestUrl || !secret) {
    log.warn?.("[t10] disabled: T10_INGEST_URL / T10_INGEST_SECRET not configured");
    return { start() {}, stop() {} };
  }

  /** target_ts(ms) -> Map(offset -> sample) */
  const pending = new Map();
  /** target_ts(ms) already handed to the boundary hook — exactly once each. */
  const triggered = new Set();
  let ws = null;
  let heartbeat = null;
  let stopped = false;
  let useAlternate = false;
  const health = {
    status: "STARTING",
    reconnect_count: 0,
    consecutive_errors: 0,
    last_error_code: null,
    last_error_message: null,
    last_target_ts: null,
    last_target_seconds: null,
    last_boundary_target_ts: null,
    last_boundary_status: null,
    deployment_id: buildIdentifier,
  };

  function sign(body) {
    const timestamp = String(Date.now());
    return {
      timestamp,
      signature: createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex"),
    };
  }

  async function post(samples, extra = {}, priorKlines = []) {
    const body = JSON.stringify({
      collector_version: COLLECTOR_VERSION,
      build_identifier: buildIdentifier,
      samples,
      prior_klines: priorKlines,
      health: { ...health, ...extra },
    });
    const { timestamp, signature } = sign(body);
    try {
      const res = await fetch(ingestUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-t10-timestamp": timestamp,
          "x-t10-signature": signature,
        },
        body,
      });
      if (!res.ok) {
        health.consecutive_errors += 1;
        health.last_error_code = `HTTP_${res.status}`;
        health.last_error_message = (await res.text()).slice(0, 300);
      } else {
        health.consecutive_errors = 0;
        health.last_error_code = null;
        health.last_error_message = null;
      }
    } catch (error) {
      health.consecutive_errors += 1;
      health.last_error_code = "INGEST_FETCH_FAILED";
      health.last_error_message = String(error).slice(0, 300);
    }
  }

  /**
   * Trigger the app's T+10s decision the instant the finalized offset-29 bar has
   * been persisted. Cloudflare cron cannot be trusted to fire at a precise
   * second, so this always-on process owns the timing. The app hook is
   * idempotent, so an extra retry can never produce a second prediction.
   */
  async function triggerBoundary(targetMs) {
    if (!boundaryUrl || triggered.has(targetMs)) return;
    triggered.add(targetMs);
    for (const key of triggered) if (key < targetMs - 4 * TF_MS) triggered.delete(key);

    const targetTs = new Date(targetMs).toISOString();
    const body = JSON.stringify({ target_ts: targetTs, source: COLLECTOR_VERSION });
    const { timestamp, signature } = sign(body);
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await fetch(boundaryUrl, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "x-t10-timestamp": timestamp,
            "x-t10-signature": signature,
          },
          body,
        });
        health.last_boundary_target_ts = targetTs;
        health.last_boundary_status = `HTTP_${res.status}`;
        log.log?.(`[t10] boundary trigger ${targetTs} -> ${res.status}`);
        if (res.ok) return;
      } catch (error) {
        health.last_boundary_target_ts = targetTs;
        health.last_boundary_status = "FETCH_FAILED";
        health.last_error_message = String(error).slice(0, 300);
      }
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }

  function flush(targetMs) {
    const bucket = pending.get(targetMs);
    if (!bucket) return;
    pending.delete(targetMs);
    const samples = [...bucket.values()].sort((a, b) => a.bar_open_ms - b.bar_open_ms);
    health.last_target_ts = new Date(targetMs).toISOString();
    health.last_target_seconds = samples.length;
    health.status = samples.length === EXPECTED ? "LIVE" : "PARTIAL";
    // Persist first, then decide: the decision must never read a partial window.
    void post(samples).then(() => {
      if (samples.length === EXPECTED) return triggerBoundary(targetMs);
      return undefined;
    });
  }

  function onKline(k) {
    if (k.x !== true) return; // final bars only
    const openMs = Number(k.t);
    if (!Number.isFinite(openMs) || openMs % 1000 !== 0) return;
    const targetMs = Math.floor(openMs / TF_MS) * TF_MS;
    const offset = Math.round((openMs - targetMs) / 1000);
    if (offset < 0 || offset > LAST_OFFSET_S) return;

    let bucket = pending.get(targetMs);
    if (!bucket) {
      bucket = new Map();
      pending.set(targetMs, bucket);
    }
    bucket.set(offset, {
      bar_open_ms: openMs,
      open: num(k.o),
      high: num(k.h),
      low: num(k.l),
      close: num(k.c),
      volume: num(k.v),
      quote_volume: num(k.q),
      taker_buy_volume: num(k.V),
      taker_buy_quote_volume: num(k.Q),
      trade_count: num(k.n),
      is_final: true,
      received_at_ms: Date.now(),
    });

    if (offset === LAST_OFFSET_S) flush(targetMs);

    // Drop anything stale so an abandoned candle can never leak forward.
    for (const key of pending.keys()) {
      if (key < targetMs) {
        const stale = pending.get(key);
        pending.delete(key);
        if (stale && stale.size > 0) {
          void post([...stale.values()].sort((a, b) => a.bar_open_ms - b.bar_open_ms), {
            status: "PARTIAL",
          });
        }
      }
    }
  }

  function connect() {
    if (stopped) return;
    const url = useAlternate ? WS_ALTERNATE_URL : WS_URL;
    ws = new WebSocket(url);
    ws.on("open", () => {
      health.status = "LIVE";
      log.log?.(`[t10] connected ${url}`);
    });
    ws.on("message", (raw) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg?.k) onKline(msg.k);
      } catch {
        /* ignore malformed frames */
      }
    });
    ws.on("error", (error) => {
      health.last_error_code = "WS_ERROR";
      health.last_error_message = String(error).slice(0, 300);
    });
    ws.on("close", () => {
      if (stopped) return;
      health.status = "RECONNECTING";
      health.reconnect_count += 1;
      useAlternate = !useAlternate;
      setTimeout(connect, 1_000);
    });
  }

  return {
    start() {
      stopped = false;
      connect();
      heartbeat = setInterval(() => {
        void (async () => {
          const now = Date.now();
          let klines = [];
          if (now - lastKlinePushMs > KLINE_REFRESH_MS) {
            klines = await fetchPriorKlines();
            if (klines.length) lastKlinePushMs = now;
          }
          await post([], {}, klines);
        })();
      }, HEARTBEAT_INTERVAL_MS);
      // Push the technical history immediately on boot so the very next
      // boundary can score instead of abstaining.
      void (async () => {
        const klines = await fetchPriorKlines();
        if (klines.length) {
          lastKlinePushMs = Date.now();
          await post([], {}, klines);
        }
      })();
    },
    stop() {
      stopped = true;
      if (heartbeat) clearInterval(heartbeat);
      try {
        ws?.close();
      } catch {
        /* ignore */
      }
    },
  };
}
