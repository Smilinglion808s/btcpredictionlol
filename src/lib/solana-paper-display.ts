import {
  lamportsToSol,
  retainPaperHistory,
  type HistoricalTrade,
  type PaperHistory,
  type PaperMonitorLoad,
  type ScannerHealth,
} from "./solana-paper";

type HistorySession = Pick<ScannerHealth, "run_id" | "fixed_deadline_utc" | "exploratory_mode">;
export type HistoryCheckDisplay = {
  history: PaperHistory | null;
  verifiedSession: HistorySession | null;
  lastSuccessfulRead: number | null;
  outcome: "unchecked" | "accepted" | "unavailable" | "rejected";
};
export const emptyHistoryCheckDisplay: HistoryCheckDisplay = {
  history: null,
  verifiedSession: null,
  lastSuccessfulRead: null,
  outcome: "unchecked",
};
const matchesSession = (history: PaperHistory, session: HistorySession) =>
  (session.run_id === null || session.run_id === history.run_id) &&
  session.fixed_deadline_utc === history.evidence_fence.fixed_deadline_utc &&
  session.exploratory_mode === history.exploratory_mode;

/** Pure UI attribution: health transport never determines a report read outcome. */
export function historyCheckDisplay(
  previous: HistoryCheckDisplay,
  load: PaperMonitorLoad,
  reportResult?: PaperMonitorLoad,
): HistoryCheckDisplay {
  const verifiedSession =
    load.state === "ready" && load.health.state === "available"
      ? load.health.data
      : previous.verifiedSession;
  const invalidated = !!(
    previous.history && verifiedSession && !matchesSession(previous.history, verifiedSession)
  );
  const candidate = load.state === "ready" && load.history.state === "available"
    ? load.history.data : null;
  const accepted = candidate !== null &&
    (!verifiedSession || matchesSession(candidate, verifiedSession));
  const safeLoad: PaperMonitorLoad = load.state === "ready" && candidate && !accepted
    ? { ...load, history: { state: "unavailable" } } : load;
  const history = retainPaperHistory(invalidated ? null : previous.history, safeLoad);
  let lastSuccessfulRead = invalidated ? null : previous.lastSuccessfulRead;
  let outcome = invalidated ? "unchecked" as const : previous.outcome;
  if (reportResult) {
    outcome = reportResult.state !== "ready" || reportResult.history.state !== "available"
      ? "unavailable" : accepted ? "accepted" : "rejected";
  }
  if (accepted && history && load.state === "ready" && load.historyCheckedAt !== undefined) {
    // The retained cutoff may be newer than this same-session response; never replace it.
    const sameIdentity = candidate.run_id === history.run_id &&
      candidate.evidence_fence.fixed_deadline_utc === history.evidence_fence.fixed_deadline_utc &&
      candidate.exploratory_mode === history.exploratory_mode;
    if (sameIdentity) lastSuccessfulRead = load.historyCheckedAt;
  }
  return { history, verifiedSession, lastSuccessfulRead, outcome };
}

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
