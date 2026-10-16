import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ageLabel,
  lamportsToSol,
  loadSolanaPaperFeed,
  pnlView,
  startRefresh,
  tokenQuantity,
  toneOf,
  tradeKey,
  traderSummaries,
  transportFresh,
  walletRows,
  walletTail,
  type SolanaPaperLoad,
  type SolanaPaperLoader,
  type SolanaPaperTrade,
} from "@/lib/solana-paper";

export const Route = createFileRoute("/_authenticated/solana-paper")({
  head: () => ({
    meta: [
      { title: "Solana Copy PnL | BTC 15m" },
      {
        name: "description",
        content: "Read-only paper PnL from our copied Solana entries and exits, grouped by trader.",
      },
      { property: "og:title", content: "Solana Copy PnL" },
      { property: "og:description", content: "Observed-only paper copies. No real orders or funds." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SolanaPaperPage,
});

const token = (t: SolanaPaperTrade) => t.symbol ?? t.name ?? "Unknown token";
const solText = (value: string | null, signed = false) => (value == null ? "—" : `${lamportsToSol(value, signed)} SOL`);
const timestamp = (value: string | null) => (value == null ? "Unavailable" : value);
const modeLabel = (mode: string) => mode.replaceAll("_", " ");

function Money({ value }: { value: string | null }) {
  return <span className={`font-mono ${toneOf(value)}`}>{solText(value, true)}</span>;
}

function Trade({ trade: t, load, now }: { trade: SolanaPaperTrade; load: SolanaPaperLoad; now: number }) {
  const p = pnlView(t, now, load);
  const sourceAgeUnknown =
    (load.state === "ready" && load.feed.upstream_age_unknown === true) ||
    t.valuation.source_event_age_known === false ||
    t.valuation.observed_at == null;
  return (
    <li className="space-y-3 p-4 text-sm sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-semibold">
          {token(t)}{" "}
          <span className="ml-2 font-mono text-muted-foreground" title={t.source_wallet}>
            {walletTail(t.source_wallet)}
          </span>
        </span>
        <span className="rounded border border-border px-2 py-0.5 text-xs uppercase">{t.position_status}</span>
      </div>
      <p className="break-all font-mono text-xs text-muted-foreground">
        <span className="font-sans">Mint: </span>
        {t.mint}
      </p>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <div>
          <dt className="text-xs text-muted-foreground">Acquired token quantity</dt>
          <dd className="mt-1 break-all font-mono">{tokenQuantity(t)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">All-in copied entry</dt>
          <dd className="mt-1 font-mono">{solText(t.entry_input_lamports)}</dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Realized copy PnL</dt>
          <dd className="mt-1">
            <Money value={t.position_status === "closed" ? p.lamports : null} />
          </dd>
        </div>
        <div>
          <dt className="text-xs text-muted-foreground">Open estimated PnL</dt>
          <dd className="mt-1">
            <Money value={t.position_status === "open" ? p.lamports : null} />
          </dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        {p.note}
        {p.lamports != null ? ` · ${p.pctText}` : ""}. Acquired amount is the recorded entry quantity, not a current
        holdings balance.
      </p>
      <dl className="grid gap-x-4 gap-y-1 text-xs text-muted-foreground sm:grid-cols-2">
        <div>
          <dt className="inline">Entry: </dt>
          <dd className="inline break-all font-mono">{timestamp(t.entry_at)}</dd>
        </div>
        <div>
          <dt className="inline">Exit: </dt>
          <dd className="inline break-all font-mono">{timestamp(t.exit_at)}</dd>
        </div>
      </dl>
      <p className="text-xs text-muted-foreground">
        Mark: {t.position_status === "closed" ? "historical realized result" : p.mark} · Source event age:{" "}
        {sourceAgeUnknown ? "unknown" : ageLabel(t.valuation.observed_at, now)}
        {t.valuation.quote_received_at != null
          ? ` · Quote received ${ageLabel(t.valuation.quote_received_at, now)} (1s maximum)`
          : ""}
      </p>
    </li>
  );
}

function SolanaPaperPage() {
  return <SolanaPaperView loader={loadSolanaPaperFeed} />;
}

export function SolanaPaperView({ loader }: { loader: SolanaPaperLoader }) {
  const [load, setLoad] = useState<SolanaPaperLoad | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setLoad(null);
    const stop = startRefresh(loader, setLoad);
    // Update the 1-second quote guard even between transport polls.
    const clock = setInterval(() => setNow(Date.now()), 250);
    return () => {
      stop();
      clearInterval(clock);
    };
  }, [loader]);

  const stale = load?.state === "ready" && !transportFresh(load, now);
  const fixedModel =
    load?.state === "ready" &&
    load.feed.accounting_mode === "fixed_notional_copy_pnl_v1" &&
    load.feed.entry_notional_lamports === "1000000000" &&
    load.feed.account === null;
  const feed =
    load?.state === "ready" && !stale && fixedModel && load.feed.evidence_kind !== "offline_synthetic"
      ? load.feed
      : null;
  const rows = feed && load ? traderSummaries(load, now) : [];
  const wallets = feed && load ? walletRows(load) : null;
  const heading =
    load == null
      ? "Loading…"
      : stale
        ? "Feed stale"
        : load.state === "error"
          ? "Feed offline or unavailable"
          : load.state === "not_started" || feed?.status === "not_started"
            ? "Pilot not running"
            : load.state === "ready" && load.feed.evidence_kind === "offline_synthetic"
              ? "Synthetic feed rejected"
              : !fixedModel
                ? "Copy model unavailable"
                : "No paper copies recorded yet";

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <Link to="/stats" className="text-sm text-muted-foreground hover:text-foreground">
        ← Back to dashboard
      </Link>
      <header className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Solana Copy PnL</h1>
        <span className="rounded-full border border-bull/40 bg-bull/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-bull">
          Paper only · Read only
        </span>
      </header>
      <p className="mt-3 text-sm">
        Tracking plan: 1 SOL per copied entry, with modeled costs. No shared balance or compounding.
      </p>
      <p className="mt-1 text-sm text-muted-foreground">
        PnL is from our copied entries and exits, never the source trader’s reported returns. No real orders or funds.
      </p>
      <p className="mt-2 text-xs text-muted-foreground">
        Observed-only coverage, not exhaustive. Finality is not verified. Source event age may be unknown; quote receipt
        time does not establish source freshness.
      </p>

      {feed && (
        <p className="mt-3 text-xs text-muted-foreground">
          Status: {feed.status} · Snapshot {ageLabel(feed.data_as_of, now)} ·{" "}
          {feed.coverage.summary ?? "Coverage details unavailable"}
          {feed.coverage.gap_count != null ? ` · ${feed.coverage.gap_count} known gaps` : ""}
        </p>
      )}

      {rows.length > 0 && (
        <section className="mt-7" aria-label="Our copied PnL by trader">
          <h2 className="text-lg font-semibold">Our copy PnL by trader</h2>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            {rows.map((row) => (
              <article key={row.wallet} className="rounded-lg border border-border bg-card/40 p-4">
                <h3 className="font-mono font-semibold" title={row.wallet}>
                  {walletTail(row.wallet)}
                </h3>
                <p className="mt-1 break-all font-mono text-xs text-muted-foreground">{row.wallet}</p>
                <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <dt className="text-xs text-muted-foreground">Realized</dt>
                    <dd className="mt-1">
                      <Money value={row.realizedLamports} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Open estimate</dt>
                    <dd className="mt-1">
                      <Money value={row.openLamports} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Total copy PnL</dt>
                    <dd className="mt-1">
                      <Money value={row.totalLamports} />
                    </dd>
                  </div>
                  <div>
                    <dt className="text-xs text-muted-foreground">Copied trades</dt>
                    <dd className="mt-1 font-mono">{row.tradeCount}</dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs text-muted-foreground">
                  {row.closedCount} closed · {row.openCount} open · {row.unresolvedCount} unresolved ·{" "}
                  {row.failedEntryCount} failed entries
                </p>
              </article>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted-foreground">
            — means unavailable or not yet established, not zero. Stale or unresolved positions prevent a complete
            total.
          </p>
        </section>
      )}

      {wallets != null && (
        <section className="mt-6" aria-label="Read-only trader roster">
          <h2 className="text-sm font-semibold">Trader roster</h2>
          {wallets.length === 0 ? (
            <p className="mt-2 text-xs text-muted-foreground">No traders exported.</p>
          ) : (
            <ul className="mt-2 flex flex-wrap gap-2">
              {wallets.map((w) => (
                <li key={w.wallet} className="rounded border border-border px-3 py-2 text-xs" title={w.wallet}>
                  <span className="font-mono">{walletTail(w.wallet)}</span> · {w.label || "Unlabelled"} ·{" "}
                  {modeLabel(w.mode)}
                  {w.polling_configured === false ? " · polling not configured" : ""}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="mt-7 rounded-lg border border-border bg-card/40" aria-label="Copied entry and exit history">
        {!feed || feed.trades.length === 0 ? (
          <div className="px-6 py-12 text-center" role="status">
            <p className="font-mono text-lg font-semibold">{heading}</p>
            <p className="mt-2 text-sm text-muted-foreground">
              {stale
                ? "The feed has not refreshed in time. Current values are unavailable, not zero."
                : load?.state === "error"
                  ? "The last request failed. Current values have been cleared."
                  : feed
                    ? "No copied entries are present in this observed snapshot. An empty snapshot can be a valid observation."
                    : "Copied trades will appear after a verified read-only feed is connected. No balance or results are invented."}
            </p>
          </div>
        ) : (
          <>
            <h2 className="border-b border-border px-5 py-3 text-sm font-semibold">Copied entries and exits</h2>
            <ul className="divide-y divide-border">
              {feed.trades.map((t) => (
                <Trade key={tradeKey(t)} trade={t} load={load!} now={now} />
              ))}
            </ul>
          </>
        )}
      </section>
      <p className="mt-4 text-xs text-muted-foreground">
        All-in entry includes modeled fees and slippage. Exit values are net of modeled costs. Fees are not subtracted
        twice; refundable rent is not a loss.
      </p>
    </div>
  );
}
