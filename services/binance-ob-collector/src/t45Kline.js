// T45 Balanced — Binance Global Spot 1s kline capture.
//
// Runs inside the existing always-on collector process (Cloudflare Workers
// cannot hold a persistent WebSocket). It subscribes to
// `btcusdt@kline_1s`, keeps only FINAL bars whose open time falls in offsets
// 0..44 of a 15-minute UTC candle, and flushes each candle's 45 bars to the
// app immediately after offset 44 closes — well before T+60s.
//
// Binance Global only. Binance.US is never an acceptable substitute.

import { createHmac } from "node:crypto";
import WebSocket from "ws";

const WS_URL = "wss://stream.binance.com:9443/ws/btcusdt@kline_1s";
const WS_ALTERNATE_URL = "wss://stream.binance.com:443/ws/btcusdt@kline_1s";
const COLLECTOR_VERSION = "t45-kline-collector-r1";
const TF_MS = 15 * 60 * 1000;
const LAST_OFFSET_S = 44;
const EXPECTED = 45;
const HEARTBEAT_INTERVAL_MS = 5_000;

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};

export function createT45Collector({ ingestUrl, secret, buildIdentifier = null, log = console }) {
  if (!ingestUrl || !secret) {
    log.warn?.("[t45] disabled: T45_INGEST_URL / T45_INGEST_SECRET not configured");
    return { start() {}, stop() {} };
  }

  /** target_ts(ms) -> Map(offset -> sample) */
  const pending = new Map();
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
    deployment_id: buildIdentifier,
  };

  async function post(samples, extra = {}) {
    const body = JSON.stringify({
      collector_version: COLLECTOR_VERSION,
      build_identifier: buildIdentifier,
      samples,
      health: { ...health, ...extra },
    });
    const timestamp = String(Date.now());
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
    try {
      const res = await fetch(ingestUrl, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-t45-timestamp": timestamp,
          "x-t45-signature": signature,
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

  function flush(targetMs) {
    const bucket = pending.get(targetMs);
    if (!bucket) return;
    pending.delete(targetMs);
    const samples = [...bucket.values()].sort((a, b) => a.bar_open_ms - b.bar_open_ms);
    health.last_target_ts = new Date(targetMs).toISOString();
    health.last_target_seconds = samples.length;
    health.status = samples.length === EXPECTED ? "LIVE" : "PARTIAL";
    void post(samples);
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
      log.log?.(`[t45] connected ${url}`);
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
      heartbeat = setInterval(() => void post([]), HEARTBEAT_INTERVAL_MS);
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
