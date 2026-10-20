import { lamportsToSol, type HistoricalTrade } from "./solana-paper";

/** Presentation only: canonical timestamps and raw accounting remain untouched. */
export function boiseTime(value: string | null | undefined): string {
  if (!value || !Number.isFinite(Date.parse(value))) return "Unknown";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Boise",
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
    timeZoneName: "short",
  }).format(new Date(value));
}

export function shortMint(mint: string): string {
  return mint.length > 12 ? `${mint.slice(0, 4)}…${mint.slice(-4)}` : mint;
}

/** The historical contract has no entry market cap; never use a current mark. */
export function entryMarketCap(_trade: HistoricalTrade): string {
  return "Unknown";
}

export function realizedTradeDisplay(trade: HistoricalTrade): { value: string; label: string } {
  if (trade.position_status_at_cutoff === "unresolved")
    return { value: "Unresolved", label: "Realized unavailable" };
  if (trade.position_status_at_cutoff === "open")
    return { value: "Open", label: "Realized unavailable" };
  const raw = trade.realized_net_pnl_lamports;
  if (raw === null || !/^-?\d{1,60}$/.test(raw))
    return { value: "Unknown", label: "Realized PnL · SOL" };
  const sign = BigInt(raw);
  return {
    value: `${lamportsToSol(raw, true)} SOL`,
    label: sign > 0n ? "Realized gain" : sign < 0n ? "Realized loss" : "Realized · break-even",
  };
}

export function newestTrades(trades: readonly HistoricalTrade[]): HistoricalTrade[] {
  const stamp = (value: string) => {
    const parsed = Date.parse(value);
    return Number.isFinite(parsed) ? parsed : -Infinity;
  };
  return [...trades].sort((a, b) => stamp(b.entry_at) - stamp(a.entry_at));
}
