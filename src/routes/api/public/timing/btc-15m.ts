import { createFileRoute } from "@tanstack/react-router";
import { getBtc15mExchangeTiming } from "@/lib/timing.server";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
} as const;

export const Route = createFileRoute("/api/public/timing/btc-15m")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        try {
          const timing = await getBtc15mExchangeTiming();
          return new Response(JSON.stringify({
            server_now_ms: timing.serverNowMs,
            next_close_ms: timing.nextCloseMs,
            next_prediction_ms: timing.nextPredictionMs,
            time_source: timing.timeSource,
            close_source: timing.closeSource,
            kalshi_ticker: timing.kalshiTicker,
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