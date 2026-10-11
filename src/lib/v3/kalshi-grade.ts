// V3 dashboard grading against official finalized Kalshi KXBTC15M outcomes.
// Pure helpers + an injectable fetcher. Never infers a result: anything that is
// not a verified, finalized, identity-matched market stays PENDING.

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const BASE = "https://api.elections.kalshi.com/trade-api/v2";
export const KALSHI_RETRY_BASE_MS = 60_000;
export const KALSHI_RETRY_MAX_MS = 3_600_000;
export const KALSHI_BATCH = 12;

/** Market ticker for the KXBTC15M market closing at candle open + 15m (US Eastern). */
export function v3KalshiTicker(candleOpenMs: number): string {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York", year: "2-digit", month: "numeric", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  }).formatToParts(new Date(candleOpenMs + 900_000));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "";
  const hh = g("hour") === "24" ? "00" : g("hour").padStart(2, "0");
  const mi = g("minute").padStart(2, "0");
  return `KXBTC15M-${g("year")}${MONTHS[Number(g("month")) - 1]}${g("day").padStart(2, "0")}${hh}${mi}-${mi}`;
}

export type FinalOutcome = { result: "yes" | "no"; ticker: string; closeTime: string; settlementTs: string | null; expirationValue: string | null };

/** Returns a verified final outcome, or a reason string why it is not gradeable. */
export function validateKalshiMarket(m: any, candleOpenMs: number): FinalOutcome | string {
  if (!m || typeof m !== "object") return "MALFORMED";
  if (m.ticker !== v3KalshiTicker(candleOpenMs)) return "IDENTITY_MISMATCH";
  const close = typeof m.close_time === "string" ? Date.parse(m.close_time) : NaN;
  if (close !== candleOpenMs + 900_000) return "CLOSE_TIME_MISMATCH";
  if (m.status !== "finalized") return `NOT_FINALIZED:${String(m.status).slice(0, 24)}`;
  if (m.result !== "yes" && m.result !== "no") return "RESULT_INVALID";
  return {
    result: m.result, ticker: m.ticker, closeTime: m.close_time,
    settlementTs: typeof m.settlement_ts === "string" ? m.settlement_ts : null,
    expirationValue: m.expiration_value != null ? String(m.expiration_value) : null,
  };
}

/** +1 (UP) wins on yes, -1 (DOWN) wins on no. No outcome ⇒ pending. */
export function gradeV3(direction: number | null, outcome: { result: "yes" | "no" } | null): "W" | "L" | "P" {
  if (!outcome || (direction !== 1 && direction !== -1)) return "P";
  return (outcome.result === "yes" ? 1 : -1) === direction ? "W" : "L";
}

export type FetchResult = { ok: true; outcome: FinalOutcome; endpoint: string; raw: any } | { ok: false; reason: string; endpoint: string | null };

/** GET /markets/{ticker}, falling back to /historical/markets/{ticker} only on 404. */
export async function fetchV3KalshiOutcome(candleOpenMs: number, f: typeof fetch = fetch, timeoutMs = 4000): Promise<FetchResult> {
  const ticker = v3KalshiTicker(candleOpenMs);
  let last: string | null = null;
  for (const path of [`/markets/${ticker}`, `/historical/markets/${ticker}`]) {
    last = path.split("/")[1];
    try {
      const r = await f(`${BASE}${path}`, {
        headers: { accept: "application/json" }, redirect: "manual", signal: AbortSignal.timeout(timeoutMs),
      });
      if (r.status === 404) continue;
      if (!r.ok) return { ok: false, reason: `HTTP_${r.status}`, endpoint: last };
      const body: any = await r.json().catch(() => null);
      const v = validateKalshiMarket(body?.market, candleOpenMs);
      return typeof v === "string" ? { ok: false, reason: v, endpoint: last } : { ok: true, outcome: v, endpoint: last, raw: body.market };
    } catch (e) {
      return { ok: false, reason: (e as Error)?.name === "TimeoutError" ? "TIMEOUT" : "NETWORK", endpoint: last };
    }
  }
  return { ok: false, reason: "HTTP_404", endpoint: last };
}

export type CacheRow = { candle_open: string; final: boolean; attempts: number; next_retry_at: string | null; last_attempt_at: string | null };

/** Bounded, fair refresh selection: never-attempted (newest first), then least-recently attempted due rows. */
export function pickRefreshBatch(opens: number[], cache: Map<number, CacheRow>, nowMs: number, limit = KALSHI_BATCH): number[] {
  const due = opens.filter((t) => {
    if (t + 900_000 > nowMs) return false;
    const c = cache.get(t);
    return !c || (!c.final && (!c.next_retry_at || Date.parse(c.next_retry_at) <= nowMs));
  });
  const fresh = due.filter((t) => !cache.has(t)).sort((a, b) => b - a);
  const retry = due.filter((t) => cache.has(t))
    .sort((a, b) => Date.parse(cache.get(a)!.last_attempt_at ?? "0") - Date.parse(cache.get(b)!.last_attempt_at ?? "0") || b - a);
  return [...fresh, ...retry].slice(0, limit);
}

export const retryDelayMs = (attempts: number) => Math.min(KALSHI_RETRY_MAX_MS, KALSHI_RETRY_BASE_MS * 2 ** Math.min(attempts, 6));
