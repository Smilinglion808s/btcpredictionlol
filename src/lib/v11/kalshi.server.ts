// Version 1.1 — native official resolver WITH settlement timing provenance.
//
// The shared `fetchKalshiResolution` returns only the outcome. Training needs
// to know WHEN the outcome became official, and market close is NOT proof of
// settlement: a market closes at the boundary and may settle later. So this
// resolver reports the venue's own settlement instant when the venue publishes
// one, and otherwise reports nothing — the caller then records the conservative
// first-observation time, tagged as such. Nothing is ever backdated.

import { buildKalshiEventTicker } from "@/lib/kalshi.server";

export type { KalshiMarket };

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
  /** Official finalized settlement instant (Kalshi market lifecycle). */
  settlement_ts?: string;
  settled_time?: string;
  settlement_timestamp?: string;
  /** Determination PRECEDES settlement — never used as a settlement time. */
  determination_time?: string;
  close_time?: string;
  settlement_value_dollars?: string;
}

const HEADERS = {
  accept: "application/json",
  "user-agent": "Mozilla/5.0 (compatible; BTC15mDashboard/1.0)",
};

/**
 * The venue's own settlement instant.
 *
 * `settlement_ts` is the field the official market/lifecycle documentation
 * publishes once a market is finalized, so it is read FIRST; the older
 * `settled_time` / `settlement_timestamp` spellings stay as compatibility
 * aliases. `determination_time` is deliberately NOT accepted: determination
 * precedes settlement in the official lifecycle, so using it would stamp an
 * outcome as official before it was.
 *
 * Every candidate is validated: it must be a real instant, not before the
 * market's close time, and not in the future relative to this observation.
 * Anything failing that is discarded, and the caller falls back to the
 * conservative observed time tagged as such. Nothing is backdated.
 */
export function nativeSettlementTsOf(
  m: KalshiMarket,
  observedAtMs: number = Date.now(),
): string | null {
  const closeMs = m.close_time ? Date.parse(m.close_time) : NaN;
  for (const raw of [m.settlement_ts, m.settled_time, m.settlement_timestamp]) {
    if (!raw) continue;
    const ms = Date.parse(raw);
    if (!Number.isFinite(ms) || ms <= 0) continue;
    if (ms < Date.UTC(2015, 0, 1)) continue; // sentinel epoch
    if (Number.isFinite(closeMs) && ms < closeMs - 60_000) continue; // before close
    if (ms > observedAtMs + 60_000) continue; // future relative to observation
    return new Date(ms).toISOString();
  }
  return null;
}

export function pick(
  markets: KalshiMarket[] | undefined,
  observedAtMs: number = Date.now(),
): V11NativeResolution | null {
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
    nativeSettlementTs: nativeSettlementTsOf(m, observedAtMs),
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
