import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

export interface LiveCandle {
  candle_ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

const SOURCES = {
  binance: {
    label: "Binance",
    url: "https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=15m&limit=120",
    parse: (raw: unknown): LiveCandle[] => {
      const arr = raw as Array<Array<string | number>>;
      return arr.map((k) => ({
        candle_ts: new Date(Number(k[0])).toISOString(),
        open: Number(k[1]),
        high: Number(k[2]),
        low: Number(k[3]),
        close: Number(k[4]),
        volume: Number(k[5]),
      }));
    },
  },
  coinbase: {
    label: "Coinbase",
    url: "https://api.exchange.coinbase.com/products/BTC-USD/candles?granularity=900",
    parse: (raw: unknown): LiveCandle[] => {
      const arr = raw as Array<[number, number, number, number, number, number]>;
      // Coinbase returns [time, low, high, open, close, volume] in seconds, newest first
      return arr
        .slice()
        .reverse()
        .map((k) => ({
          candle_ts: new Date(k[0] * 1000).toISOString(),
          low: k[1],
          high: k[2],
          open: k[3],
          close: k[4],
          volume: k[5],
        }));
    },
  },
  okx: {
    label: "OKX",
    url: "https://www.okx.com/api/v5/market/candles?instId=BTC-USDT&bar=15m&limit=120",
    parse: (raw: unknown): LiveCandle[] => {
      const r = raw as { data: string[][] };
      return r.data
        .slice()
        .reverse()
        .map((k) => ({
          candle_ts: new Date(Number(k[0])).toISOString(),
          open: Number(k[1]),
          high: Number(k[2]),
          low: Number(k[3]),
          close: Number(k[4]),
          volume: Number(k[5]),
        }));
    },
  },
} as const;

export type LiveSource = keyof typeof SOURCES;
export const LIVE_SOURCES: LiveSource[] = ["binance", "coinbase", "okx"];
export const sourceLabel = (s: LiveSource) => SOURCES[s].label;

export function useLiveCandles(source: LiveSource = "binance", refetchMs = 5000) {
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);

  const q = useQuery({
    queryKey: ["live-candles", source],
    queryFn: async () => {
      const cfg = SOURCES[source];
      const res = await fetch(cfg.url, { cache: "no-store" });
      if (!res.ok) throw new Error(`${cfg.label} ${res.status}`);
      const json = await res.json();
      return cfg.parse(json);
    },
    refetchInterval: refetchMs,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });

  useEffect(() => {
    if (q.dataUpdatedAt) setLastUpdated(q.dataUpdatedAt);
  }, [q.dataUpdatedAt]);

  return { ...q, lastUpdated };
}
