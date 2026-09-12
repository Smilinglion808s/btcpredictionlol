// Version 1.1 — native official resolver WITH settlement timing provenance.
//
// The shared `fetchKalshiResolution` returns only the outcome. Training needs
// to know WHEN the outcome became official, and market close is NOT proof of
// settlement: a market closes at the boundary and may settle later. So this
// resolver reports the venue's own settlement instant when the venue publishes
// one, and otherwise reports nothing — the caller then records the conservative
// first-observation time, tagged as such. Nothing is ever backdated.

import { buildKalshiEventTicker } from "@/lib/kalshi.server";

export interface V11NativeResolution {
  result: "YES" | "NO";
  ticker: string;
  /** Venue-published settlement instant, or null when the venue gives none. */
  nativeSettlementTs: string | null;
  settlementValue: number | null;
}

interface KalshiMarket {
  ticker?: string;
  status?: string;
  result?: string;
  market_type?: string;
  title?: string;
  settled_time?: string;
  settlement_timestamp?: string;
  determination_time?: string;
  settlement_value_dollars?: string;
}

const HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (compatible; BTC15mDashboard/1.0)",
};

/** Only a real, sane instant counts; sentinel epochs are not settlement times. */
function nativeTs(m: KalshiMarket): string | null {
  for (const raw of [m.settled_time, m.settlement_timestamp, m.determination_time]) {
    if (!raw) continue;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    if (ms < Date.UTC(2015, 0, 1)) continue;
    return new Date(ms).toISOString();
  }
  return null;
}

function pick(markets: KalshiMarket[] | undefined): V11NativeResolution | null {
  const list = markets ?? [];
  const m =
    list.find((x) => x.market_type === "binary" && /up in next 15/i.test(x.title ?? "")) ??
    list[0];
  if (!m) return null;
  if (m.status !== "finalized" && m.status !== "settled") return null;
  const raw = (m.result ?? "").toLowerCase();
  if (raw !== "yes" && raw !== "no") return null;
  return {
    result: raw === "yes" ? "YES" : "NO",
    ticker: m.ticker ?? "",
    nativeSettlementTs: nativeTs(m),
    settlementValue: m.settlement_value_dollars
      ? Number(m.settlement_value_dollars)
      : null,
  };
}

export async function fetchV11NativeResolution(
  candleTsUtc: string,
): Promise<V11NativeResolution | null> {
  const eventTicker = buildKalshiEventTicker(candleTsUtc);
  const urls = [
    `https://api.elections.kalshi.com/trade-api/v2/events/${eventTicker}`,
    `https://api.elections.kalshi.com/trade-api/v2/markets?event_ticker=${eventTicker}`,
  ];
  for (let i = 0; i < 2; i++) {
    for (const url of urls) {
      try {
        const r = await fetch(url, { headers: HEADERS });
        if (!r.ok) continue;
        const json = (await r.json()) as { markets?: KalshiMarket[] };
        const hit = pick(json.markets);
        if (hit) return hit;
      } catch {
        // try the next source
      }
    }
    await new Promise((res) => setTimeout(res, 300 * (i + 1)));
  }
  return null;
}
