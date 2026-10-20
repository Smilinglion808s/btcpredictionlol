import {
  SolanaWalletSessionProvider,
  SolanaWalletHeader,
  WalletSolanaControls,
} from "@/components/solana-wallet-session";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { RefreshCw } from "lucide-react";
import {
  boiseTime,
  entryMarketCap,
  newestTrades,
  realizedTradeDisplay,
  shortMint,
} from "@/lib/solana-paper-display";
import {
  ageLabel,
  coverageLabel,
  historicalPositionLabel,
  lamportsToSol,
  loadSolanaPaperMonitor,
  loadSolanaPaperHistoryMonitor,
  loadSolanaPaperTokenSymbols,
  monitorTransportFresh,
  retainPaperHistory,
  scannerHeartbeatFresh,
  startIndependentMonitorRefresh,
  tokenQuantity,
  toneOf,
  walletTail,
  type CapacityInfo,
  type HistoricalTrade,
  type PaperHistory,
  type PaperTokenSymbols,
  type PaperMonitorLoad,
  type PaperMonitorLoader,
} from "@/lib/solana-paper";

export const Route = createFileRoute("/_authenticated/solana-paper")({
  head: () => ({
    meta: [
      { title: "Solana Paper Copy Desk | BTC Predictor Pro" },
      { property: "og:title", content: "Solana Paper Copy Desk | BTC Predictor Pro" },
      {
        property: "og:description",
        content:
          "Historical simulated Solana copy trades, realized SOL results and observed-path evidence.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      {
        name: "description",
        content: "Read-only scanner status and historical PnL from our fixed-1-SOL paper copies.",
      },
    ],
  }),
  component: SolanaPaperPage,
});
const label = (v: string) => v.replaceAll("_", " ");
const time = (value: string | null) => value ?? "Unavailable";
function Money({ value }: { value: string | null }) {
  return (
    <span className={`font-mono ${toneOf(value)}`}>
      {value == null ? "Unknown" : `${lamportsToSol(value, true)} SOL`}
    </span>
  );
}
function PressureSummary({
  pressure,
  observedAt,
  historical = false,
}: {
  pressure: CapacityInfo | null;
  observedAt: string;
  historical?: boolean;
}) {
  return (
    <section
      className="mt-3 rounded border border-border p-3 text-xs"
      aria-label={historical ? "Historical source pressure" : "Scanner source pressure"}
    >
      <h3 className="font-semibold">
        {historical ? "Source pressure at historical cutoff" : "Source pressure · scanner sample"}
      </h3>
      {pressure?.capacity_policy && pressure.capacity_wallets ? (
        <>
          <p className="mt-1 text-muted-foreground">
            {historical ? "Recorded as of" : "Scanner report at"}{" "}
            <span className="break-all font-mono">{observedAt}</span>.
            {historical
              ? " Historical only, not current entry eligibility."
              : " Reported state only; heartbeat and eligibility checks still apply."}
          </p>
          <p className="mt-2">
            Unenriched source signatures:{" "}
            <span className="font-mono">{pressure.capacity_unenriched_sources}</span> (global unique
            count).
          </p>
          <p className="mt-1 text-muted-foreground">
            These source outcomes are unknown, not proven non-trades. Raw receipts stay retained.
            Per-wallet matches may overlap and must not be added together.
          </p>
          <p className="mt-1 text-amber-500">
            Capacity rejects new enrichment work for an affected wallet. Its fresh entries require a
            real reconnect and fresh observation barrier; waiting alone does not clear the gap.
            Existing gap and conditional-result labels remain.
          </p>
          <details className="mt-3">
            <summary className="cursor-pointer">
              Per-wallet unenriched matches and entry state ({pressure.capacity_wallets.length})
            </summary>
            <ul className="mt-2 space-y-2">
              {pressure.capacity_wallets.map((row) => (
                <li key={row.source_wallet} className="rounded border border-border p-2">
                  <p className="break-all font-mono">{row.source_wallet}</p>
                  <p className="mt-1">
                    Unenriched matches:{" "}
                    <span className="font-mono">{row.unenriched_source_count}</span> · Entries:{" "}
                    {row.entry_paused ? "paused" : "not paused; other eligibility checks apply"} ·
                    Reason: {label(row.pause_reason)}
                  </p>
                </li>
              ))}
            </ul>
          </details>
        </>
      ) : (
        <p className="mt-1 text-muted-foreground">
          Pressure counts and per-wallet pause details were not supplied for this run. Unavailable
          does not mean zero.
        </p>
      )}
    </section>
  );
}
function HistoricalPosition({
  trade: t,
  symbol,
}: {
  trade: HistoricalTrade;
  symbol: string | null;
}) {
  return (
    <li className="space-y-3 p-4 text-sm sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono font-semibold" title={t.source_wallet}>
          Trader {walletTail(t.source_wallet)}
        </span>
        <span className="rounded border border-border px-2 py-0.5 text-xs uppercase">
          {historicalPositionLabel(t)} at cutoff
        </span>
      </div>
      {t.coverage_class !== null && (
        <p className="text-xs text-amber-500">
          Epoch {t.source_epoch_id} · {coverageLabel(t.coverage_class)}. Observed path only, not
          exhaustive coverage.
        </p>
      )}
      <p className="break-all font-semibold">Ticker: {symbol ?? "Unknown"}</p>
      <p className="text-xs text-muted-foreground">
        Source asset label from DEX Screener, not a verified token identity or profit claim. Mint
        identifies the asset.
      </p>
      <p className="break-all font-mono text-xs text-muted-foreground">Mint: {t.mint}</p>
      <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Entry notional</dt>
          <dd className="mt-1 font-mono">1 SOL</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Recorded entry tokens</dt>
          <dd className="mt-1 break-all font-mono">{tokenQuantity(t)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Realized at cutoff</dt>
          <dd className="mt-1">
            <Money value={t.realized_net_pnl_lamports} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Open estimate at cutoff</dt>
          <dd className="mt-1">
            <Money value={t.open_net_pnl_lamports_at_cutoff} />
          </dd>
        </div>
      </dl>
      <dl className="grid gap-1 text-xs text-muted-foreground sm:grid-cols-2">
        <div>
          <dt className="inline">Paper entry: </dt>
          <dd className="inline break-all font-mono">{time(t.entry_at)}</dd>
        </div>
        <div>
          <dt className="inline">Paper exit: </dt>
          <dd className="inline break-all font-mono">{time(t.exit_at)}</dd>
        </div>
      </dl>
      {t.unresolved_reason && (
        <p className="text-xs text-muted-foreground">Unresolved: {label(t.unresolved_reason)}</p>
      )}
      {t.source_coverage_gap_latched && (
        <p className="text-xs text-amber-500">
          Source coverage gap. The first source sale may have been missed; this is only the observed
          copy model.
        </p>
      )}
    </li>
  );
}

function BriefPosition({ trade: t, symbol }: { trade: HistoricalTrade; symbol: string | null }) {
  const realized = realizedTradeDisplay(t);
  return (
    <li>
      <details className="sr-trade">
        <summary>
          <span className="sr-token-icon" aria-hidden="true">
            {symbol ? symbol.slice(0, 1).toUpperCase() : "?"}
          </span>
          <span className="sr-trade-identity">
            <strong>
              {symbol ?? "Unknown"} <span className="sr-chip sr-chip-paper">Paper</span>
            </strong>
            <small>
              Wallet {walletTail(t.source_wallet)} · Mint {shortMint(t.mint)}
            </small>
            <time dateTime={t.entry_at}>{boiseTime(t.entry_at)}</time>
            <span className="sr-trade-state">
              {label(t.position_status_at_cutoff)}
              {t.source_coverage_gap_latched ? " · Coverage gap" : ""}
            </span>
          </span>
          <span className="sr-entry-cap">
            <small>Entry market cap</small>
            <strong>{entryMarketCap(t)}</strong>
          </span>
          <span className="sr-trade-value">
            <strong>{realized.value}</strong>
            <small>{realized.label}</small>
            <span className="sr-open-label">Details +</span>
          </span>
        </summary>
        <div className="sr-row-detail">
          <p className="sr-address">Copied source wallet: {t.source_wallet}</p>
          <p className="sr-address">Mint: {t.mint}</p>
          <p>Ticker is unverified metadata. The mint identifies the asset.</p>
          <p>
            Entry market cap: Unknown — not supplied in the historical report. Current valuations
            are not entry values.
          </p>
          <dl>
            <div>
              <dt>Paper entry · Boise</dt>
              <dd>{boiseTime(t.entry_at)}</dd>
            </div>
            <div>
              <dt>Paper exit · Boise</dt>
              <dd>{boiseTime(t.exit_at)}</dd>
            </div>
            <div>
              <dt>Canonical entry UTC</dt>
              <dd>{time(t.entry_at)}</dd>
            </div>
            <div>
              <dt>Canonical exit UTC</dt>
              <dd>{time(t.exit_at)}</dd>
            </div>
            <div>
              <dt>Entry notional</dt>
              <dd>1 SOL · simulated</dd>
            </div>
            <div>
              <dt>Recorded tokens</dt>
              <dd>{tokenQuantity(t)}</dd>
            </div>
            <div>
              <dt>{realized.label}</dt>
              <dd>{realized.value}</dd>
            </div>
          </dl>
          <p>Historical paper simulation, not an actual transaction receipt.</p>
          {t.coverage_class !== null && (
            <p>
              Epoch {t.source_epoch_id} · {coverageLabel(t.coverage_class)}. Not exhaustive
              coverage.
            </p>
          )}
          {t.unresolved_reason && (
            <p className="sr-warning">Unresolved: {label(t.unresolved_reason)}</p>
          )}
          {t.source_coverage_gap_latched && (
            <p className="sr-warning">
              First source sale may be missing. Observed copy model only.
            </p>
          )}
        </div>
      </details>
    </li>
  );
}

function SolanaPaperPage() {
  return (
    <SolanaWalletSessionProvider>
      <SolanaPaperBody />
    </SolanaWalletSessionProvider>
  );
}
function SolanaPaperBody() {
  return (
    <SolanaPaperView
      loader={loadSolanaPaperMonitor}
      historyLoader={loadSolanaPaperHistoryMonitor}
    />
  );
}
export function SolanaPaperView({
  loader,
  historyLoader = loader,
}: {
  loader: PaperMonitorLoader;
  historyLoader?: PaperMonitorLoader;
}) {
  const [load, setLoad] = useState<PaperMonitorLoad | null>(null);
  const [history, setHistory] = useState<PaperHistory | null>(null);
  const [tokenSymbols, setTokenSymbols] = useState<PaperTokenSymbols | null>(null);
  const refreshRef = useRef<(() => void) | null>(null);
  const [historyPending, setHistoryPending] = useState(false);
  const [historyReadUnavailable, setHistoryReadUnavailable] = useState(false);
  const [lastSuccessfulRead, setLastSuccessfulRead] = useState<number | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setLoad(null);
    setHistory(null);
    setLastSuccessfulRead(null);
    setHistoryReadUnavailable(false);
    const stop = startIndependentMonitorRefresh(
      loader,
      historyLoader,
      (value) => {
        setLoad(value);
        setHistory((previous) => retainPaperHistory(previous, value));
        if (
          value.state === "ready" &&
          value.history.state === "available" &&
          value.historyCheckedAt !== undefined
        ) {
          setLastSuccessfulRead(value.historyCheckedAt);
        }
      },
      {
        historyIntervalMs: 180_000,
        onHistoryPending: setHistoryPending,
        onHistoryResult: (value) =>
          setHistoryReadUnavailable(value.state !== "ready" || value.history.state !== "available"),
      },
    );
    refreshRef.current = stop.refreshHistory;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      refreshRef.current = null;
      stop();
      clearInterval(timer);
    };
  }, [loader, historyLoader]);
  // Metadata is independent of the five-second monitor loop. Retry on the next committed report.
  const symbolReportKey =
    history && (history.copied_trades_as_of?.length ?? 0) > 0
      ? `${history.run_id}:${history.evidence_fence.evidence_cutoff_utc}`
      : null;
  useEffect(() => {
    if (!symbolReportKey) {
      setTokenSymbols(null);
      return;
    }
    const controller = new AbortController();
    let cancelled = false;
    void loadSolanaPaperTokenSymbols(controller.signal).then((value) => {
      if (!cancelled) setTokenSymbols(value);
    });
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [symbolReportKey]);
  const freshTransport = monitorTransportFresh(load, now);
  const health =
    load?.state === "ready" && freshTransport && load.health.state === "available"
      ? load.health.data
      : null;
  const source = health?.source_status;
  const heartbeatFresh = health ? scannerHeartbeatFresh(health, now) : false;
  const latestHistory =
    load?.state === "ready" && freshTransport && load.history.state === "available"
      ? load.history.data
      : null;
  const retained =
    history !== null &&
    (!latestHistory ||
      latestHistory.run_id !== history.run_id ||
      latestHistory.evidence_fence.evidence_cutoff_utc !==
        history.evidence_fence.evidence_cutoff_utc);
  const scannerHeading =
    load == null
      ? "Loading scanner status…"
      : load.state === "not_started"
        ? "Pilot not running"
        : !freshTransport || !health
          ? "Scanner status unavailable"
          : health.status === "stopped"
            ? "Scanner stopped"
            : now >= Date.parse(health.fixed_deadline_utc)
              ? "Test ended · deadline reached"
              : heartbeatFresh
                ? `Owner heartbeat received · ${label(health.status)}`
                : "Awaiting fresh heartbeat";
  const rows = history?.trader_pnl_as_of ?? [];
  const sumMoney = (key: "realized_net_pnl_lamports" | "open_net_pnl_lamports_at_cutoff") => {
    if (!history || rows.length === 0 || rows.some((row) => row[key] === null)) return null;
    return rows.reduce((sum, row) => sum + BigInt(row[key] ?? "0"), 0n).toString();
  };
  const sumCount = (key: "closed_count" | "open_count" | "unresolved_count") =>
    !history || rows.length === 0
      ? null
      : rows.reduce((sum, row) => sum + BigInt(row[key]), 0n).toString();
  const closedCount = sumCount("closed_count");
  const unresolvedCount = sumCount("unresolved_count");
  const openCount = sumCount("open_count");
  const gapAffected = rows.some((row) => row.source_coverage_gap_latched);
  const entriesLabel = !source
    ? "Entry state unknown"
    : source.new_entries_paused
      ? "Entries paused"
      : source.partially_paused
        ? "Some entries paused"
        : "Entry checks apply";
  return (
    <div className="solana-retro">
      <div className="sr-shell">
        <div className="sr-topline">
          <Link to="/stats" className="sr-back">
            ← Dashboard
          </Link>
          <span className="sr-eyebrow">SOLANA / COPY DESK</span>
          <SolanaWalletHeader />
        </div>
        <header className="sr-desk-header">
          <div>
            <span className="sr-eyebrow">OBSERVED PATH / SIMULATED COPIES</span>
            <h1>
              Solana Copy Desk<span aria-hidden="true"> /</span>
            </h1>
          </div>
          <span className="sr-chip sr-chip-paper">Paper · 1 SOL / entry</span>
        </header>

        <section className="sr-status-strip" aria-label="Scanner summary">
          <div>
            <span className="sr-status-dot" aria-hidden="true" />
            <strong role="status">{scannerHeading}</strong>
          </div>
          <span>{entriesLabel}</span>
          <span>LIVE unavailable · default OFF</span>
        </section>
        {source?.gap_latched && (
          <p className="sr-notice">Source gaps recorded. Results cover observed events only.</p>
        )}
        {!health && (
          <p className="sr-note">
            Current scanner state is unknown. Historical results below are not a live status.
          </p>
        )}

        <div className="sr-data-grid">
          <section className="sr-panel" aria-labelledby="sr-trades-title">
            <div className="sr-panel-heading">
              <div>
                <span className="sr-eyebrow">THE LEDGER</span>
                <h2 id="sr-trades-title">Recent Trades</h2>
              </div>
              <Button
                variant="outline"
                className="sr-refresh"
                disabled={historyPending}
                onClick={() => refreshRef.current?.()}
              >
                <RefreshCw aria-hidden="true" size={16} />
                {historyPending ? "Checking…" : "Refresh"}
              </Button>
            </div>
            {historyReadUnavailable && !historyPending && !retained && (
              <p className="sr-notice">Report check unavailable. No successful read or fresh evidence is established.</p>
            )}
            <div className="sr-check-meta" role="status">
              <p>
                Last updated · successful report check:{" "}
                {lastSuccessfulRead === null
                  ? "Not yet available"
                  : boiseTime(new Date(lastSuccessfulRead).toISOString())}
              </p>
              <p>
                Snapshot cutoff:{" "}
                {history ? boiseTime(history.evidence_fence.evidence_cutoff_utc) : "Unknown"} ·
                Historical age:{" "}
                {history ? ageLabel(history.evidence_fence.evidence_cutoff_utc, now) : "Unknown"}
              </p>
              <p>
                Checks every 3 minutes; reports no more often than every 10 minutes. A successful
                check may return the same historical evidence.
              </p>
            </div>
            {retained && (
              <p className="sr-notice">
                Report check unavailable or rejected. Retained historical rows — not current
                evidence.
              </p>
            )}
            {history && now - Date.parse(history.evidence_fence.evidence_cutoff_utc) >= 600_000 && (
              <p className="sr-note">
                Historical snapshot is at least 10 minutes old; not live trade evidence.
              </p>
            )}
            <p className="sr-panel-note">
              Paper simulations, not transaction receipts. Tickers are unverified; mint is identity.
            </p>
            {!history || history.copied_trades_as_of === null ? (
              <div className="sr-empty">
                <span aria-hidden="true">↗</span>
                <h3>Waiting for trade details</h3>
                <p>No verified trade rows are available.</p>
              </div>
            ) : history.copied_trades_as_of.length === 0 ? (
              <div className="sr-empty">
                <span aria-hidden="true">↗</span>
                <h3>No copied entries yet</h3>
                <p>No entries committed by this cutoff.</p>
              </div>
            ) : (
              <ul className="sr-trades">
                {newestTrades(history.copied_trades_as_of).map((trade) => (
                  <BriefPosition
                    key={`${trade.position_id}:${trade.source_wallet}:${trade.mint}`}
                    trade={trade}
                    symbol={
                      tokenSymbols?.run_id === history.run_id
                        ? (tokenSymbols.symbols[trade.mint] ?? null)
                        : null
                    }
                  />
                ))}
              </ul>
            )}
          </section>
          <section className="sr-results" aria-labelledby="sr-results-title">
            <div className="sr-section-heading">
              <div>
                <span className="sr-eyebrow">THE SNAPSHOT</span>
                <h2 id="sr-results-title">Paper summary</h2>
              </div>
              <div className="sr-snapshot-meta">
                {history ? (
                  <>
                    <span>
                      {retained ? "Retained snapshot" : "Historical snapshot"} ·{" "}
                      {ageLabel(history.evidence_fence.evidence_cutoff_utc, now)}
                    </span>
                    <time dateTime={history.evidence_fence.evidence_cutoff_utc}>
                      {history.evidence_fence.evidence_cutoff_utc}
                    </time>
                  </>
                ) : (
                  <span>No verified snapshot yet</span>
                )}
              </div>
            </div>
            {retained && (
              <p className="sr-notice">
                Latest request did not confirm a newer report. These values are retained, not
                current.
              </p>
            )}
            <div className="sr-metrics">
              <article className="sr-metric sr-metric-featured">
                <span className="sr-eyebrow">Realized net</span>
                <strong>
                  <Money value={sumMoney("realized_net_pnl_lamports")} />
                </strong>
                <small>Copy ledger · at cutoff</small>
              </article>
              <article className="sr-metric">
                <span className="sr-eyebrow">Open estimate</span>
                <strong>
                  <Money value={sumMoney("open_net_pnl_lamports_at_cutoff")} />
                </strong>
                <small>
                  {openCount === null ? "Open count unavailable" : `${openCount} open at cutoff`} ·
                  Not a live quote
                </small>
              </article>
              <article className="sr-metric">
                <span className="sr-eyebrow">Closed copies</span>
                <strong>{closedCount ?? "—"}</strong>
                <small>At the report cutoff</small>
              </article>
              <article className="sr-metric">
                <span className="sr-eyebrow">Unresolved</span>
                <strong
                  className={
                    unresolvedCount !== null && unresolvedCount !== "0" ? "sr-warning" : undefined
                  }
                >
                  {unresolvedCount ?? "—"}
                </strong>
                <small>Unknown is never zero</small>
              </article>
            </div>
            <p className="sr-note">
              {history?.exploratory_mode || gapAffected
                ? "Conditional, observed-path results. "
                : "Simulated copy results. "}
              No real funds. No funded balance. — means unavailable or unresolved. Observed events
              only. Finality is not verified; source event age may be unknown.
            </p>
          </section>

          <details className="sr-disclosure sr-wallet-disclosure">
            <summary>
              <strong>Wallet performance</strong>
              <span className="sr-summary-hint">Conditional ledger totals</span>
            </summary>
            <section aria-labelledby="sr-wallets-title">
              <div className="sr-panel-heading">
                <div>
                  <span className="sr-eyebrow">SOURCE WATCHLIST</span>
                  <h2 id="sr-wallets-title">Wallet performance</h2>
                </div>
                <span className="sr-chip">{history ? rows.length : "—"} WALLETS</span>
              </div>
              <p className="sr-panel-note">Our modeled copies, not the source wallet's returns.</p>
              {rows.length === 0 ? (
                <div className="sr-empty">
                  <span aria-hidden="true">◎</span>
                  <h3>No wallet report yet</h3>
                  <p>Unknown values stay unknown.</p>
                </div>
              ) : (
                <ul className="sr-wallets">
                  {rows.map((row, index) => (
                    <li key={row.source_wallet}>
                      <details>
                        <summary>
                          <span className="sr-wallet-index" aria-hidden="true">
                            {String(index + 1).padStart(2, "0")}
                          </span>
                          <span className="sr-wallet-name">
                            <strong title={row.source_wallet}>
                              Wallet {walletTail(row.source_wallet)}
                            </strong>
                            <small>
                              {row.closed_count} closed · {row.open_count} open
                              {row.unresolved_count > 0
                                ? ` · ${row.unresolved_count} unresolved`
                                : ""}
                              {row.source_coverage_gap_latched ? " · Coverage gap" : ""}
                            </small>
                          </span>
                          <span className="sr-wallet-value">
                            <Money value={row.total_net_pnl_lamports_at_cutoff} />
                            <small>Conditional total</small>
                          </span>
                        </summary>
                        <div className="sr-row-detail">
                          <p className="sr-address">{row.source_wallet}</p>
                          <dl>
                            <div>
                              <dt>Realized net</dt>
                              <dd>
                                <Money value={row.realized_net_pnl_lamports} />
                              </dd>
                            </div>
                            <div>
                              <dt>Open estimate</dt>
                              <dd>
                                <Money value={row.open_net_pnl_lamports_at_cutoff} />
                              </dd>
                            </div>
                          </dl>
                          <p>
                            {row.failed_entry_count} failed entries ·{" "}
                            {row.skipped_opportunity_count} skipped. Modeled costs included.
                          </p>
                          {row.source_coverage_gap_latched && (
                            <p className="sr-warning">
                              Observed path only. The first source sale may be missing.
                            </p>
                          )}
                        </div>
                      </details>
                    </li>
                  ))}
                </ul>
              )}
            </section>
          </details>
        </div>

        <details id="solana-live-panel" className="sr-disclosure sr-live-disclosure">
          <summary>
            <span>
              <span className="sr-eyebrow">SEPARATE FROM PAPER</span>
              <strong>Owner & live controls</strong>
            </span>
            <span className="sr-chip">LIVE unavailable · default OFF</span>
          </summary>
          <div className="sr-disclosure-body">
            <WalletSolanaControls />
          </div>
        </details>
        <details className="sr-disclosure sr-diagnostics">
          <summary>
            <span>
              <span className="sr-eyebrow">DEEPER LOOK</span>
              <strong>Full report & diagnostics</strong>
            </span>
            <span className="sr-summary-hint">Scanner · coverage · methodology</span>
          </summary>
          <div className="sr-disclosure-body">
            <section
              className="mt-6 rounded-lg border border-border bg-card/40 p-4 sm:p-5"
              aria-label="Scanner status"
            >
              <h2 className="font-semibold" role="status">
                {scannerHeading}
              </h2>
              {health ? (
                <>
                  {health.exploratory_mode && (
                    <p className="mt-2 text-sm text-amber-500">
                      Exploratory mode · gaps stay recorded. Fresh post-reconnect entries may be
                      eligible; results are conditional on the path observed, not real-money
                      performance.
                    </p>
                  )}
                  <p className="mt-2 text-xs text-muted-foreground">
                    Owner heartbeat: <span className="font-mono">{health.heartbeat_utc}</span> (
                    {ageLabel(health.heartbeat_utc, now)}). Run ends:{" "}
                    <span className="font-mono">{health.fixed_deadline_utc}</span>.
                  </p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Reporter: {label(health.reporter_status)}. An owner heartbeat does not prove a
                    fresh source event or current PnL.
                  </p>
                  {source ? (
                    <>
                      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
                        <div>
                          <dt className="text-xs text-muted-foreground">Stream state reported</dt>
                          <dd>{label(source.stream_state)}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Selected / acknowledged</dt>
                          <dd className="font-mono">
                            {source.selected_wallet_count} / {source.acknowledged_wallet_count}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Baselines recorded</dt>
                          <dd className="font-mono">{source.baseline_complete_count}</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">Known source gaps</dt>
                          <dd className="font-mono">{source.gap_count}</dd>
                        </div>
                      </dl>
                      <p className="mt-3 text-xs text-muted-foreground">
                        New entries:{" "}
                        {source.new_entries_paused
                          ? "paused"
                          : source.partially_paused
                            ? "partially paused; only eligible wallets may enter"
                            : "not operator-paused; eligibility checks still apply"}
                        . Source-sale tracking reported{" "}
                        {source.source_sale_tracking_active ? "active" : "inactive"}.{" "}
                        {source.stream_notification_count} stream notifications ·{" "}
                        {source.raw_lookup_parsed_count} parsed lookups · {source.handoff_pending}{" "}
                        queued.
                      </p>
                      {source.epoch_count !== null && (
                        <p className="mt-2 text-xs text-muted-foreground">
                          Active epoch: {source.active_epoch_id ?? "Unavailable"} · Eligible
                          wallets: {source.eligible_wallet_count ?? "Unavailable"} /{" "}
                          {source.selected_wallet_count} · Connections:{" "}
                          {source.connection_count ?? "Unavailable"} · Disconnects:{" "}
                          {source.disconnect_count ?? "Unavailable"}. Gap count is per-wallet
                          records, not outage count.
                        </p>
                      )}
                      <PressureSummary pressure={source} observedAt={health.heartbeat_utc} />
                      {source.gap_reason_counts &&
                        Object.keys(source.gap_reason_counts).length > 0 && (
                          <details className="mt-2 text-xs text-muted-foreground">
                            <summary className="cursor-pointer">Retained gap reasons</summary>
                            <ul>
                              {Object.entries(source.gap_reason_counts).map(([reason, n]) => (
                                <li key={reason}>
                                  {label(reason)}: {n}
                                </li>
                              ))}
                            </ul>
                          </details>
                        )}
                      <dl className="mt-3 grid gap-2 text-xs text-muted-foreground sm:grid-cols-2">
                        <div>
                          <dt>Last stream receipt</dt>
                          <dd className="break-all font-mono">
                            {time(source.last_stream_receipt_at)}
                          </dd>
                        </div>
                        <div>
                          <dt>Last enrichment ready</dt>
                          <dd className="break-all font-mono">
                            {time(source.last_enrichment_ready_at)}
                          </dd>
                        </div>
                        <div>
                          <dt>Last raw source block time (not receipt time)</dt>
                          <dd className="break-all font-mono">
                            {time(source.last_source_block_time_at)}
                          </dd>
                        </div>
                        <div>
                          <dt>Transport</dt>
                          <dd>
                            Stream, not polling. No source timestamp is inferred from receipts.
                          </dd>
                        </div>
                      </dl>
                      {source.gap_latched && (
                        <p className="mt-3 text-xs text-amber-500">
                          A source gap is latched and remains recorded. Entry eligibility is shown
                          above; first-sale coverage is not exhaustive. Historical results are only
                          from the events observed.
                        </p>
                      )}
                    </>
                  ) : (
                    <p className="mt-3 text-sm text-muted-foreground">
                      Source details unavailable. No stream health is inferred.
                    </p>
                  )}
                  {health.selected_wallets && (
                    <details className="mt-4 text-xs text-muted-foreground">
                      <summary className="cursor-pointer">
                        Selected source wallets ({health.selected_wallets.length})
                      </summary>
                      <ul className="mt-2 space-y-1">
                        {health.selected_wallets.map((w) => (
                          <li key={w} className="break-all font-mono">
                            {w}
                          </li>
                        ))}
                      </ul>
                    </details>
                  )}
                </>
              ) : (
                <p className="mt-2 text-sm text-muted-foreground">
                  {load?.state === "not_started"
                    ? "The verified paper feed is not connected yet."
                    : "No current scanner state is established. Unavailable does not mean zero activity."}
                </p>
              )}
            </section>

            <section className="mt-7" aria-label="Historical copy PnL">
              <h2 className="text-lg font-semibold">Our copy PnL · Historical snapshot</h2>
              <p className="mt-1 text-xs text-muted-foreground">
                History is checked on opening this page, then three minutes after each completed
                check, separately from scanner status. Reports are generated no more often than
                every 10 minutes. Open estimates are valid only at the snapshot cutoff, not current
                or executable quotes. A successful check may return the same report and never
                advances its evidence cutoff. Fetching this page does not refresh its valuation.
              </p>
              {history ? (
                <>
                  <div className="mt-3 rounded border border-border p-3 text-xs text-muted-foreground">
                    <p>
                      As of{" "}
                      <span className="break-all font-mono">
                        {history.evidence_fence.evidence_cutoff_utc}
                      </span>{" "}
                      ({ageLabel(history.evidence_fence.evidence_cutoff_utc, now)}
                      ). State at cutoff: {label(history.status_at_cutoff)}.
                    </p>
                    <p className="mt-1">
                      Generated:{" "}
                      <span className="break-all font-mono">{history.report_generated_at_utc}</span>
                      . Published:{" "}
                      <span className="break-all font-mono">
                        {time(history.report_received_at_utc)}
                      </span>
                      .
                    </p>
                    <p className="mt-1 break-all font-mono">Run: {history.run_id}</p>
                    {load?.state === "ready" && load.historyCheckedAt !== undefined && (
                      <p className="mt-1">
                        Report last checked:{" "}
                        <span className="font-mono">
                          {new Date(load.historyCheckedAt).toISOString()}
                        </span>
                        . This does not change its cutoff.
                      </p>
                    )}
                    {retained && (
                      <p className="mt-2 text-amber-500">
                        Retained historical snapshot. The latest request did not confirm a newer
                        report. The scanner may have ended or become unavailable.
                      </p>
                    )}
                  </div>
                  {history.exploratory_mode && (
                    <p className="mt-3 rounded border border-amber-500/40 p-3 text-sm text-amber-500">
                      Exploratory historical results · conditional on observed paths, not verified
                      real-money returns. Trader totals below may mix clean-observed and
                      gap-affected cohorts. A clean-observed label means no known gap during that
                      position, not complete source-trade coverage.
                    </p>
                  )}
                  <PressureSummary
                    pressure={history.pressure_snapshot_as_of}
                    observedAt={
                      history.pressure_snapshot_as_of?.observed_at_utc ??
                      history.evidence_fence.evidence_cutoff_utc
                    }
                    historical
                  />
                  {history.trader_pnl_as_of.length === 0 ? (
                    <p className="mt-4 text-sm text-muted-foreground">
                      No trader summary rows exported at this cutoff.
                    </p>
                  ) : (
                    <div className="mt-4 grid gap-3 sm:grid-cols-2">
                      {history.trader_pnl_as_of.map((t) => (
                        <article
                          key={t.source_wallet}
                          className="rounded-lg border border-border bg-card/40 p-4"
                        >
                          <h3 className="font-mono font-semibold" title={t.source_wallet}>
                            Trader {walletTail(t.source_wallet)}
                          </h3>
                          <p className="mt-1 break-all font-mono text-xs text-muted-foreground">
                            {t.source_wallet}
                          </p>
                          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                            <div>
                              <dt className="text-xs text-muted-foreground">Realized at cutoff</dt>
                              <dd className="mt-1">
                                <Money value={t.realized_net_pnl_lamports} />
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">
                                Open estimate at cutoff
                              </dt>
                              <dd className="mt-1">
                                <Money value={t.open_net_pnl_lamports_at_cutoff} />
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">
                                {history.exploratory_mode
                                  ? "Conditional total at cutoff"
                                  : "Total at cutoff"}
                              </dt>
                              <dd className="mt-1">
                                <Money value={t.total_net_pnl_lamports_at_cutoff} />
                              </dd>
                            </div>
                            <div>
                              <dt className="text-xs text-muted-foreground">
                                Closed / open / unresolved
                              </dt>
                              <dd className="mt-1 font-mono">
                                {t.closed_count} / {t.open_count} / {t.unresolved_count}
                              </dd>
                            </div>
                          </dl>
                          <p className="mt-3 text-xs text-muted-foreground">
                            {t.failed_entry_count} failed entries · {t.skipped_opportunity_count}{" "}
                            skipped opportunities. Modeled costs are already included.
                          </p>
                          {t.source_coverage_gap_latched && (
                            <p className="mt-2 text-xs text-amber-500">
                              Coverage gap: observed model only, first source sale may be missing.
                            </p>
                          )}
                          {Object.keys(t.skipped_reasons).length > 0 && (
                            <details className="mt-2 text-xs text-muted-foreground">
                              <summary className="cursor-pointer">Skipped reasons</summary>
                              <ul className="mt-1 space-y-1">
                                {Object.entries(t.skipped_reasons).map(([reason, n]) => (
                                  <li key={reason}>
                                    {label(reason)}: {n}
                                  </li>
                                ))}
                              </ul>
                            </details>
                          )}
                        </article>
                      ))}
                    </div>
                  )}
                  <p className="mt-3 text-xs text-muted-foreground">
                    — means unresolved or unavailable, not zero. Totals come from the copy ledger,
                    including failed-attempt costs, not a sum of the visible trade rows.
                  </p>
                  {history.source_epoch_pnl_as_of !== null && (
                    <section className="mt-6" aria-label="Observed-path cohorts">
                      <h3 className="font-semibold">Epoch and coverage cohorts · at cutoff</h3>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Separate authoritative ledger groups, including failed-attempt costs.
                        Unresolved counts may include pending inventory, not a completed copy. Not a
                        new fully verified total.
                      </p>
                      {history.source_epoch_pnl_as_of.length === 0 ? (
                        <p className="mt-2 text-sm text-muted-foreground">
                          No copy economics recorded in a cohort yet.
                        </p>
                      ) : (
                        <div className="mt-3 grid gap-3 sm:grid-cols-2">
                          {history.source_epoch_pnl_as_of.map((t) => (
                            <article
                              key={`${t.source_wallet}:${t.source_epoch_id}:${t.coverage_class}`}
                              className="rounded border border-border p-3 text-sm"
                            >
                              <h4 className="font-mono" title={t.source_wallet}>
                                Trader {walletTail(t.source_wallet)} · Epoch {t.source_epoch_id}
                              </h4>
                              <p className="mt-1 text-xs text-amber-500">
                                {coverageLabel(t.coverage_class)}
                              </p>
                              <dl className="mt-3 grid grid-cols-2 gap-2">
                                <div>
                                  <dt className="text-xs text-muted-foreground">
                                    Realized at cutoff
                                  </dt>
                                  <dd>
                                    <Money value={t.realized_net_pnl_lamports} />
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-xs text-muted-foreground">
                                    Open estimate at cutoff
                                  </dt>
                                  <dd>
                                    <Money value={t.open_net_pnl_lamports_at_cutoff} />
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-xs text-muted-foreground">
                                    Conditional total at cutoff
                                  </dt>
                                  <dd>
                                    <Money value={t.total_net_pnl_lamports_at_cutoff} />
                                  </dd>
                                </div>
                                <div>
                                  <dt className="text-xs text-muted-foreground">
                                    Closed / open / unresolved
                                  </dt>
                                  <dd>
                                    {t.closed_count} / {t.open_count} / {t.unresolved_count}
                                  </dd>
                                </div>
                              </dl>
                              <p className="mt-2 text-xs text-muted-foreground">
                                {t.failed_entry_count} failed entries. First source-sale coverage is
                                not verified.
                              </p>
                            </article>
                          ))}
                        </div>
                      )}
                      <details className="mt-3 text-xs text-muted-foreground">
                        <summary className="cursor-pointer">
                          Recorded observation epochs ({history.source_epochs?.length ?? 0})
                        </summary>
                        <ul className="mt-2 space-y-1">
                          {history.source_epochs?.map((e) => (
                            <li key={e.source_epoch_id}>
                              Epoch {e.source_epoch_id}: {e.opened_at}, slot barrier{" "}
                              {e.barrier_slot}. Earlier history coverage unknown.
                            </li>
                          ))}
                        </ul>
                      </details>
                    </section>
                  )}
                  <h3 className="mt-7 font-semibold">Copied positions and exits at cutoff</h3>
                  <div className="mt-3 rounded-lg border border-border bg-card/40">
                    {history.copied_trades_as_of === null ? (
                      <p className="p-5 text-sm text-muted-foreground">
                        Trade details were not exported.
                      </p>
                    ) : history.copied_trades_as_of.length === 0 ? (
                      <p className="p-5 text-sm text-muted-foreground">
                        No copied entries committed by this cutoff. An empty report is a valid
                        result, not a sample trade.
                      </p>
                    ) : (
                      <ul className="divide-y divide-border">
                        {history.copied_trades_as_of.map((t) => (
                          <HistoricalPosition
                            key={`${t.position_id}:${t.source_wallet}:${t.mint}`}
                            trade={t}
                            symbol={
                              tokenSymbols?.run_id === history.run_id
                                ? (tokenSymbols.symbols[t.mint] ?? null)
                                : null
                            }
                          />
                        ))}
                      </ul>
                    )}
                  </div>
                </>
              ) : (
                <p className="mt-4 rounded-lg border border-border p-6 text-sm text-muted-foreground">
                  {load?.state === "ready" && load.history.state === "waiting"
                    ? "Waiting for the first committed historical report."
                    : "No verified historical copy report is available yet."}{" "}
                  No balance, trades, or PnL have been invented.
                </p>
              )}
            </section>
          </div>
        </details>
        <footer className="sr-footer">
          <span>SOLANA COPY DESK / PAPER LAB</span>
          <span>Historical estimates. Not executable quotes.</span>
        </footer>
      </div>
    </div>
  );
}
