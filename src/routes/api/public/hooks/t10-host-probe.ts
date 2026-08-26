// Temporary diagnostic: which Binance REST hosts are reachable from the edge.
import { createFileRoute } from "@tanstack/react-router";

const HOSTS = [
  "https://api.binance.com/api/v3/klines",
  "https://data-api.binance.vision/api/v3/klines",
  "https://api-gcp.binance.com/api/v3/klines",
  "https://api1.binance.com/api/v3/klines",
  "https://api2.binance.com/api/v3/klines",
  "https://api3.binance.com/api/v3/klines",
  "https://api4.binance.com/api/v3/klines",
  "https://fapi.binance.com/fapi/v1/klines",
  "https://fapi1.binance.com/fapi/v1/klines",
  "https://fapi2.binance.com/fapi/v1/klines",
];

export const Route = createFileRoute("/api/public/hooks/t10-host-probe")({
  server: {
    handlers: {
      GET: async () => {
        const results = await Promise.all(
          HOSTS.map(async (url) => {
            try {
              const res = await fetch(`${url}?symbol=BTCUSDT&interval=15m&limit=2`);
              const body = (await res.text()).slice(0, 120);
              return { url, status: res.status, body };
            } catch (e) {
              return { url, status: 0, body: String(e).slice(0, 120) };
            }
          }),
        );
        return Response.json({ results });
      },
    },
  },
});
