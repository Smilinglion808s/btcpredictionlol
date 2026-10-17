import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ageLabel,
  coverageLabel,
  historicalPositionLabel,
  lamportsToSol,
  loadSolanaPaperMonitor,
  loadSolanaPaperTokenSymbols,
  monitorTransportFresh,
  retainPaperHistory,
  scannerHeartbeatFresh,
  startMonitorRefresh,
  tokenQuantity,
  toneOf,
  walletTail,
  type HistoricalTrade,
  type PaperHistory,
  type PaperTokenSymbols,
  type PaperMonitorLoad,
  type PaperMonitorLoader,
} from "@/lib/solana-paper";

export const Route = createFileRoute("/_authenticated/solana-paper")({
  head: () => ({
    meta: [
      { title: "Solana Copy PnL | BTC 15m" },
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
    <span className={`font-mono ${toneOf(value)}`}>{value == null ? "—" : `${lamportsToSol(value, true)} SOL`}</span>
  );
}
function HistoricalPosition({ trade: t, symbol }: { trade: HistoricalTrade; symbol: string | null }) {
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
          Epoch {t.source_epoch_id} · {coverageLabel(t.coverage_class)}. Observed path only, not exhaustive coverage.
        </p>
      )}
      <p className="break-all font-semibold">Ticker: {symbol ?? "Unknown"}</p>
      <p className="text-xs text-muted-foreground">
        Source asset label from DEX Screener, not a verified token identity or profit claim. Mint identifies the asset.
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
      {t.unresolved_reason && <p className="text-xs text-muted-foreground">Unresolved: {label(t.unresolved_reason)}</p>}
      {t.source_coverage_gap_latched && (
        <p className="text-xs text-amber-500">
          Source coverage gap. The first source sale may have been missed; this is only the observed copy model.
        </p>
      )}
    </li>
  );
}
function SolanaPaperPage() {
  return <SolanaPaperView loader={loadSolanaPaperMonitor} />;
}
export function SolanaPaperView({ loader }: { loader: PaperMonitorLoader }) {
  const [load, setLoad] = useState<PaperMonitorLoad | null>(null);
  const [history, setHistory] = useState<PaperHistory | null>(null);
  const [tokenSymbols, setTokenSymbols] = useState<PaperTokenSymbols | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setLoad(null);
    setHistory(null);
    const stop = startMonitorRefresh(loader, (value) => {
      setLoad(value);
      setHistory((previous) => retainPaperHistory(previous, value));
    });
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => {
      stop();
      clearInterval(timer);
    };
  }, [loader]);
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
    load?.state === "ready" && freshTransport && load.health.state === "available" ? load.health.data : null;
  const source = health?.source_status;
  const heartbeatFresh = health ? scannerHeartbeatFresh(health, now) : false;
  const latestHistory =
    load?.state === "ready" && freshTransport && load.history.state === "available" ? load.history.data : null;
  const retained =
    history !== null &&
    (!latestHistory ||
      latestHistory.run_id !== history.run_id ||
      latestHistory.evidence_fence.evidence_cutoff_utc !== history.evidence_fence.evidence_cutoff_utc);
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
  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <Link to="/stats" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to dashboard
      </Link>
      <header className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Solana Copy PnL</h1>
        <span className="rounded-full border border-border px-3 py-1 font-mono text-xs uppercase tracking-wider">
          Paper only · Read only
        </span>
      </header>
      <p className="mt-3 text-sm">1 SOL per copied entry, with modeled costs. No balance or compounding.</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Results come from our simulated copies, never the source trader’s reported returns. No real orders or funds.
      </p>

      <section className="mt-6 rounded-lg border border-border bg-card/40 p-4 sm:p-5" aria-label="Scanner status">
        <h2 className="font-semibold" role="status">
          {scannerHeading}
        </h2>
        {health ? (
          <>
            {health.exploratory_mode && (
              <p className="mt-2 text-sm text-amber-500">
                Exploratory mode · gaps stay recorded. Fresh post-reconnect entries may be eligible; results are
                conditional on the path observed, not real-money performance.
              </p>
            )}
            <p className="mt-2 text-xs text-muted-foreground">
              Owner heartbeat: <span className="font-mono">{health.heartbeat_utc}</span> (
              {ageLabel(health.heartbeat_utc, now)}). Run ends:{" "}
              <span className="font-mono">{health.fixed_deadline_utc}</span>.
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Reporter: {label(health.reporter_status)}. An owner heartbeat does not prove a fresh source event or
              current PnL.
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
                  . Source-sale tracking reported {source.source_sale_tracking_active ? "active" : "inactive"}.{" "}
                  {source.stream_notification_count} stream notifications · {source.raw_lookup_parsed_count} parsed
                  lookups · {source.handoff_pending} queued.
                </p>
                {source.epoch_count !== null && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Active epoch: {source.active_epoch_id ?? "Unavailable"} · Eligible wallets:{" "}
                    {source.eligible_wallet_count ?? "Unavailable"} / {source.selected_wallet_count} · Connections:{" "}
                    {source.connection_count ?? "Unavailable"} · Disconnects: {source.disconnect_count ?? "Unavailable"}
                    . Gap count is per-wallet records, not outage count.
                  </p>
                )}
                {source.gap_reason_counts && Object.keys(source.gap_reason_counts).length > 0 && (
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
                    <dd className="break-all font-mono">{time(source.last_stream_receipt_at)}</dd>
                  </div>
                  <div>
                    <dt>Last enrichment ready</dt>
                    <dd className="break-all font-mono">{time(source.last_enrichment_ready_at)}</dd>
                  </div>
                  <div>
                    <dt>Last raw source block time (not receipt time)</dt>
                    <dd className="break-all font-mono">{time(source.last_source_block_time_at)}</dd>
                  </div>
                  <div>
                    <dt>Transport</dt>
                    <dd>Stream, not polling. No source timestamp is inferred from receipts.</dd>
                  </div>
                </dl>
                {source.gap_latched && (
                  <p className="mt-3 text-xs text-amber-500">
                    A source gap is latched and remains recorded. Entry eligibility is shown above; first-sale coverage
                    is not exhaustive. Historical results are only from the events observed.
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
                <summary className="cursor-pointer">Selected source wallets ({health.selected_wallets.length})</summary>
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
          Reports are generated no more often than every 10 minutes. Open estimates are valid only at the snapshot
          cutoff, not current or executable quotes. Fetching this page does not refresh their value.
        </p>
        {history ? (
          <>
            <div className="mt-3 rounded border border-border p-3 text-xs text-muted-foreground">
              <p>
                As of <span className="break-all font-mono">{history.evidence_fence.evidence_cutoff_utc}</span> (
                {ageLabel(history.evidence_fence.evidence_cutoff_utc, now)}). State at cutoff:{" "}
                {label(history.status_at_cutoff)}.
              </p>
              <p className="mt-1">
                Generated: <span className="break-all font-mono">{history.report_generated_at_utc}</span>. Published:{" "}
                <span className="break-all font-mono">{time(history.report_received_at_utc)}</span>.
              </p>
              <p className="mt-1 break-all font-mono">Run: {history.run_id}</p>
              {retained && (
                <p className="mt-2 text-amber-500">
                  Retained historical snapshot. The latest request did not confirm a newer report. The scanner may have
                  ended or become unavailable.
                </p>
              )}
            </div>
            {history.exploratory_mode && (
              <p className="mt-3 rounded border border-amber-500/40 p-3 text-sm text-amber-500">
                Exploratory historical results · conditional on observed paths, not verified real-money returns. Trader
                totals below may mix clean-observed and gap-affected cohorts. A clean-observed label means no known gap
                during that position, not complete source-trade coverage.
              </p>
            )}
            {history.trader_pnl_as_of.length === 0 ? (
              <p className="mt-4 text-sm text-muted-foreground">No trader summary rows exported at this cutoff.</p>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2">
                {history.trader_pnl_as_of.map((t) => (
                  <article key={t.source_wallet} className="rounded-lg border border-border bg-card/40 p-4">
                    <h3 className="font-mono font-semibold" title={t.source_wallet}>
                      Trader {walletTail(t.source_wallet)}
                    </h3>
                    <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{t.source_wallet}</p>
                    <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
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
                      <div>
                        <dt className="text-xs text-muted-foreground">
                          {history.exploratory_mode ? "Conditional total at cutoff" : "Total at cutoff"}
                        </dt>
                        <dd className="mt-1">
                          <Money value={t.total_net_pnl_lamports_at_cutoff} />
                        </dd>
                      </div>
                      <div>
                        <dt className="text-xs text-muted-foreground">Closed / open / unresolved</dt>
                        <dd className="mt-1 font-mono">
                          {t.closed_count} / {t.open_count} / {t.unresolved_count}
                        </dd>
                      </div>
                    </dl>
                    <p className="mt-3 text-xs text-muted-foreground">
                      {t.failed_entry_count} failed entries · {t.skipped_opportunity_count} skipped opportunities.
                      Modeled costs are already included.
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
              — means unresolved or unavailable, not zero. Totals come from the copy ledger, including failed-attempt
              costs, not a sum of the visible trade rows.
            </p>
            {history.source_epoch_pnl_as_of !== null && (
              <section className="mt-6" aria-label="Observed-path cohorts">
                <h3 className="font-semibold">Epoch and coverage cohorts · at cutoff</h3>
                <p className="mt-1 text-xs text-muted-foreground">
                  Separate authoritative ledger groups, including failed-attempt costs. Unresolved counts may include
                  pending inventory, not a completed copy. Not a new fully verified total.
                </p>
                {history.source_epoch_pnl_as_of.length === 0 ? (
                  <p className="mt-2 text-sm text-muted-foreground">No copy economics recorded in a cohort yet.</p>
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
                        <p className="mt-1 text-xs text-amber-500">{coverageLabel(t.coverage_class)}</p>
                        <dl className="mt-3 grid grid-cols-2 gap-2">
                          <div>
                            <dt className="text-xs text-muted-foreground">Realized at cutoff</dt>
                            <dd>
                              <Money value={t.realized_net_pnl_lamports} />
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">Open estimate at cutoff</dt>
                            <dd>
                              <Money value={t.open_net_pnl_lamports_at_cutoff} />
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">Conditional total at cutoff</dt>
                            <dd>
                              <Money value={t.total_net_pnl_lamports_at_cutoff} />
                            </dd>
                          </div>
                          <div>
                            <dt className="text-xs text-muted-foreground">Closed / open / unresolved</dt>
                            <dd>
                              {t.closed_count} / {t.open_count} / {t.unresolved_count}
                            </dd>
                          </div>
                        </dl>
                        <p className="mt-2 text-xs text-muted-foreground">
                          {t.failed_entry_count} failed entries. First source-sale coverage is not verified.
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
                        Epoch {e.source_epoch_id}: {e.opened_at}, slot barrier {e.barrier_slot}. Earlier history
                        coverage unknown.
                      </li>
                    ))}
                  </ul>
                </details>
              </section>
            )}
            <h3 className="mt-7 font-semibold">Copied positions and exits at cutoff</h3>
            <div className="mt-3 rounded-lg border border-border bg-card/40">
              {history.copied_trades_as_of === null ? (
                <p className="p-5 text-sm text-muted-foreground">Trade details were not exported.</p>
              ) : history.copied_trades_as_of.length === 0 ? (
                <p className="p-5 text-sm text-muted-foreground">
                  No copied entries committed by this cutoff. An empty report is a valid result, not a sample trade.
                </p>
              ) : (
                <ul className="divide-y divide-border">
                  {history.copied_trades_as_of.map((t) => (
                    <HistoricalPosition
                      key={`${t.position_id}:${t.source_wallet}:${t.mint}`}
                      trade={t}
                      symbol={tokenSymbols?.run_id === history.run_id ? (tokenSymbols.symbols[t.mint] ?? null) : null}
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
      <p className="mt-7 text-xs text-muted-foreground">
        Observed-only coverage, not every source trade. Finality is not verified. Source event age may be unknown.
        Read-only dashboard: no wallet connection, orders, or operator controls.
      </p>
    </div>
  );
}
