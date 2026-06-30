// Kalshi resolver for BTC 15m up/down markets.
// Source of truth for prediction grading: the KXBTC15M binary market that
// closes at the same instant as our 15m candle. Kalshi settles using the
// average of the last 60 seconds of CF Benchmarks' BRTI before each
// boundary — which is exactly what we are betting on.

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

// Build the Kalshi event ticker for a given candle start (UTC ISO string).
// close_time = candle_ts + 15m. Ticker uses US Eastern (America/New_York).
export function buildKalshiEventTicker(candleTsUtc: string): string {
  const closeMs = new Date(candleTsUtc).getTime() + 15 * 60 * 1000;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    year: "2-digit",
    month: "numeric",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(new Date(closeMs));
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const yy = get("year");
  let mm = get("month");
  if (mm.length === 1) mm = "0" + mm;
  const dd = get("day");
  let hh = get("hour");
  if (hh === "24") hh = "00";
  if (hh.length === 1) hh = "0" + hh;
  const mi = get("minute");
  const monIdx = parseInt(mm, 10) - 1;
  return `KXBTC15M-${yy}${MONTHS[monIdx]}${dd}${hh}${mi}`;
}

export type KalshiResolution = {
  result: "YES" | "NO";
  settlement_value?: number;
  ticker: string;
};

interface KalshiMarket {
  ticker: string;
  status: string;
  result?: string;
  market_type?: string;
  settlement_value_dollars?: string;
  title?: string;
}

interface KalshiEventResponse {
  markets?: KalshiMarket[];
}

// Fetch the resolved up/down result for the candle. Returns null when the
// market has not finalized yet, or when Kalshi is unreachable.
export async function fetchKalshiResolution(candleTsUtc: string): Promise<KalshiResolution | null> {
  const eventTicker = buildKalshiEventTicker(candleTsUtc);
  const url = `https://api.elections.kalshi.com/trade-api/v2/events/${eventTicker}`;
  for (let i = 0; i < 3; i++) {
    try {
      const r = await fetch(url, { headers: { accept: "application/json" } });
      if (r.ok) {
        const json = (await r.json()) as KalshiEventResponse;
        // The up/down market is a binary with title "BTC price up in next 15 mins?".
        // There is exactly one such market per event.
        const market = (json.markets ?? []).find(
          (m) => m.market_type === "binary" && /up in next 15/i.test(m.title ?? ""),
        ) ?? (json.markets ?? [])[0];
        if (!market) return null;
        if (market.status !== "finalized" && market.status !== "settled") return null;
        const raw = (market.result ?? "").toLowerCase();
        if (raw !== "yes" && raw !== "no") return null;
        return {
          result: raw === "yes" ? "YES" : "NO",
          settlement_value: market.settlement_value_dollars
            ? Number(market.settlement_value_dollars)
            : undefined,
          ticker: market.ticker,
        };
      }
    } catch {
      // retry
    }
    await new Promise((res) => setTimeout(res, 400 * (i + 1)));
  }
  return null;
}
