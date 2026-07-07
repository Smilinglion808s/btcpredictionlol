import { createFileRoute } from "@tanstack/react-router";
import { buildKalshiEventTicker } from "@/lib/kalshi.server";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
} as const;

const TF_MS = 15 * 60 * 1000;

async function fetchCoinbaseTime() {
  const t0 = Date.now();
  const r = await fetch("https://api.exchange.coinbase.com/time", {
    cache: "no-store",
    headers: { accept: "application/json" },
  });
  const t1 = Date.now();
  if (!r.ok) throw new Error(`Coinbase time ${r.status}`);
  const json = (await r.json()) as { iso?: string; epoch?: number };
  const serverMs = Number.isFinite(json.epoch)
    ? Number(json.epoch) * 1000
    : new Date(json.iso ?? "").getTime();
  if (!Number.isFinite(serverMs)) throw new Error("Coinbase time invalid");
  return { serverMs, rttMs: t1 - t0 };
}

async function fetchKalshiCloseTime(nextCloseMs: number) {
  const candleStartIso = new Date(nextCloseMs - TF_MS).toISOString();
  const ticker = buildKalshiEventTicker(candleStartIso);
  const r = await fetch(`https://api.elections.kalshi.com/trade-api/v2/events/${ticker}`, {
    cache: "no-store",
    headers: { accept: "application/json", "user-agent": "Mozilla/5.0 (compatible; BTC15mDashboard/1.0)" },
  });
  if (!r.ok) throw new Error(`Kalshi event ${r.status}`);
  const json = (await r.json()) as { markets?: Array<{ close_time?: string }> };
  const closeMs = new Date(json.markets?.[0]?.close_time ?? "").getTime();
  if (!Number.isFinite(closeMs)) throw new Error("Kalshi close_time invalid");
  return { closeMs, ticker };
}

export const Route = createFileRoute("/api/public/timing/btc-15m")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        try {
          const coinbase = await fetchCoinbaseTime();
          const serverNowMs = coinbase.serverMs + coinbase.rttMs / 2;
          const utcNextCloseMs = Math.floor(serverNowMs / TF_MS) * TF_MS + TF_MS;
          let nextCloseMs = utcNextCloseMs;
          let kalshiTicker: string | null = null;
          let closeSource: "kalshi" | "coinbase_boundary" = "coinbase_boundary";

          try {
            const kalshi = await fetchKalshiCloseTime(utcNextCloseMs);
            nextCloseMs = kalshi.closeMs;
            kalshiTicker = kalshi.ticker;
            closeSource = "kalshi";
          } catch {
            // Coinbase time still anchors the 15m UTC candle boundary.
          }

          return new Response(JSON.stringify({
            server_now_ms: serverNowMs,
            next_close_ms: nextCloseMs,
            next_prediction_ms: nextCloseMs - 20_000,
            time_source: "coinbase",
            close_source: closeSource,
            kalshi_ticker: kalshiTicker,
          }), { headers: { "content-type": "application/json", ...CORS } });
        } catch (e) {
          return new Response(JSON.stringify({ error: e instanceof Error ? e.message : String(e) }), {
            status: 503,
            headers: { "content-type": "application/json", ...CORS },
          });
        }
      },
    },
  },
});