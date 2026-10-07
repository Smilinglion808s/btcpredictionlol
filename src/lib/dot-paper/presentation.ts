import type { DashboardSnapshot, DashboardTrade } from "./types";

export function money(
  value: string | null | undefined,
  signed = false,
): string {
  if (value == null || !/^-?\d+$/.test(value)) return "—";
  const micros = BigInt(value);
  const negative = micros < 0n;
  const absolute = negative ? -micros : micros;
  const cents = (absolute + 5_000n) / 10_000n;
  const whole = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const prefix =
    negative && micros !== 0n ? "−" : signed && micros > 0n ? "+" : "";
  if (absolute > 0n && cents === 0n)
    return `${negative ? "−" : signed ? "+" : ""}<0.01`;
  return `${prefix}${whole}.${(cents % 100n).toString().padStart(2, "0")}`;
}
export function quantity(value: string | null | undefined): string {
  if (value == null || !/^\d+$/.test(value)) return "—";
  const sats = BigInt(value);
  return `${sats / 100_000_000n}.${(sats % 100_000_000n).toString().padStart(8, "0")}`;
}
export function timestamp(ms: number | null | undefined, full = false): string {
  if (ms == null || !Number.isFinite(ms)) return "Not recorded";
  const date = new Date(ms);
  if (Number.isNaN(date.getTime())) return "Not recorded";
  return full
    ? `${date.toISOString().replace("T", " ").slice(0, 19)} UTC`
    : `${date.toISOString().slice(11, 19)} UTC`;
}
export function age(ms: number | null | undefined): string {
  if (ms == null || !Number.isFinite(ms)) return "No data";
  if (ms < 1000) return `${Math.max(0, Math.round(ms))} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  if (ms < 3_600_000)
    return `${Math.floor(ms / 60_000)}m ${Math.floor(ms / 1000) % 60}s`;
  return `${Math.floor(ms / 3_600_000)}h ${Math.floor(ms / 60_000) % 60}m`;
}
export const readable = (value?: string | null): string =>
  value
    ? value.replaceAll("_", " ").replaceAll("-", " ").toLowerCase()
    : "not available";
export const tone = (value: string | null | undefined) =>
  value && /^-?\d+$/.test(value)
    ? BigInt(value) < 0n
      ? "dot-negative"
      : BigInt(value) > 0n
        ? "dot-positive"
        : ""
    : "";
export function freshness(
  snapshot: DashboardSnapshot | undefined,
  elapsedMs = 0,
) {
  if (!snapshot) return { ageMs: null, isStale: false, snapshotStale: false };
  const ageMs =
    snapshot.feed.quote_age_ms == null
      ? null
      : snapshot.feed.quote_age_ms + Math.max(0, elapsedMs);
  return {
    ageMs,
    isStale:
      snapshot.feed.health === "STALE" ||
      (ageMs != null && ageMs > snapshot.feed.max_quote_age_ms),
    snapshotStale: elapsedMs > 20_000,
  };
}
/** Only the displayed trade facts are exported; never model inputs or hashes. */
export function tradeCsv(
  trades: DashboardTrade[],
  symbol: string,
  currency = "USD",
): string {
  const fields = [
    "trade_id",
    "asset",
    "quote_currency",
    "side",
    "outcome",
    "entry_at_utc",
    "exit_at_utc",
    "entry_price_quote",
    "exit_price_quote",
    "quantity_btc",
    "risk_budget_quote",
    "fees_quote",
    "funding_quote",
    "net_pnl_quote",
  ];
  const cell = (value: unknown) =>
    `"${String(value ?? "").replaceAll('"', '""')}"`;
  const decimal = (value: string | null | undefined) => {
    if (value == null) return "";
    const n = BigInt(value),
      a = n < 0n ? -n : n;
    return `${n < 0n ? "-" : ""}${a / 1_000_000n}.${(a % 1_000_000n).toString().padStart(6, "0")}`;
  };
  return [
    fields.join(","),
    ...trades.map((t) =>
      [
        /^[\s]*[=+@-]/.test(t.trade_id) ? `'${t.trade_id}` : t.trade_id,
        t.symbol ?? symbol,
        currency,
        t.side,
        t.outcome,
        timestamp(t.entry.fill_ms, true),
        timestamp(t.exit.fill_ms, true),
        decimal(t.entry.price_micros),
        decimal(t.exit.price_micros),
        quantity(t.entry.quantity_sats),
        decimal(t.risk_micros),
        decimal(t.fees_micros),
        decimal(t.carry_micros),
        decimal(t.net_pnl_micros),
      ]
        .map(cell)
        .join(","),
    ),
  ].join("\r\n");
}

/** Keep paginated older rows while refreshing the latest page; updates win by ID. */
export function mergeForwardPages<T extends { id: number }>(
  previous: { items: T[]; next_cursor: number | null } | undefined,
  incoming: { items: T[]; next_cursor: number | null },
) {
  if (!previous || previous.items.length === 0) return incoming;
  const previousOldest = Math.min(...previous.items.map((row) => row.id));
  const incomingOldest = incoming.items.length
    ? Math.min(...incoming.items.map((row) => row.id))
    : Infinity;
  const map = new Map(
    [...previous.items, ...incoming.items].map((row) => [row.id, row]),
  );
  return {
    items: [...map.values()].sort((a, b) => b.id - a.id),
    next_cursor:
      previousOldest < incomingOldest
        ? previous.next_cursor
        : incoming.next_cursor,
  };
}
