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
export const LIVE_SOURCES: LiveSource[] = ["coinbase", "okx"];
export const sourceLabel = (s: LiveSource) => SOURCES[s].label;

export function useLiveCandles(source: LiveSource = "coinbase", refetchMs = 5000) {

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

export function useLiveSpotPrice(source: LiveSource = "coinbase", refetchMs = 3000) {
  return useQuery({
    queryKey: ["live-spot", source],
    queryFn: async (): Promise<number> => {
      if (source === "coinbase") {
        const r = await fetch("https://api.exchange.coinbase.com/products/BTC-USD/ticker", { cache: "no-store" });
        if (!r.ok) throw new Error(`Coinbase ${r.status}`);
        const j = (await r.json()) as { price: string };
        return Number(j.price);
      }
      const r = await fetch("https://www.okx.com/api/v5/market/ticker?instId=BTC-USDT", { cache: "no-store" });
      if (!r.ok) throw new Error(`OKX ${r.status}`);
      const j = (await r.json()) as { data: Array<{ last: string }> };
      return Number(j.data[0].last);
    },
    refetchInterval: refetchMs,
    refetchIntervalInBackground: false,
    staleTime: 0,
  });
}

