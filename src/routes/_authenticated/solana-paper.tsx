import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ageLabel, lamportsToSol, loadSolanaPaperFeed, pnlView, rawToDecimal, toneOf, tradeKey, walletTail,
  type SolanaPaperLoad, type SolanaPaperTrade,
} from "@/lib/solana-paper";

export const Route = createFileRoute("/_authenticated/solana-paper")({
  head: () => ({
    meta: [
      { title: "Solana Paper Trades | BTC 15m" },
      { name: "description", content: "Paper-only view of tracked Solana wallet buys and estimated paper PnL." },
      { property: "og:title", content: "Solana Paper Trades" },
      { property: "og:description", content: "Paper-only view of tracked Solana wallet buys and estimated paper PnL." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SolanaPaperPage,
});

const token = (t: SolanaPaperTrade) => t.symbol ?? t.name ?? walletTail(t.mint);
const qty = (t: SolanaPaperTrade) => rawToDecimal(t.acquired_tokens_raw, t.decimals, 4);

function Pnl({ t }: { t: SolanaPaperTrade }) {
  const p = pnlView(t);
  return (
    <span className={`font-mono ${toneOf(p.lamports)}`}>
      {p.lamports == null ? "—" : `${lamportsToSol(p.lamports, true)} SOL`}
      {p.lamports != null && <span className="ml-2 text-xs">({p.pctText})</span>}
    </span>
  );
}
function Mark({ t, now }: { t: SolanaPaperTrade; now: number }) {
  const v = t.valuation, p = pnlView(t);
  const cls = v.mark_status === "fresh" && v.pricing_mode !== "unavailable" ? "text-muted-foreground" : "text-warn";
  return <span className={`text-xs ${cls}`}>{v.pricing_mode === "unavailable" ? "unavailable" : v.mark_status} · {ageLabel(v.observed_at, now)} · {p.note}</span>;
}

function SolanaPaperPage() {
  const [load, setLoad] = useState<SolanaPaperLoad | null>(null);
  const [now] = useState(() => Date.now());
  useEffect(() => {
    loadSolanaPaperFeed().then(setLoad).catch((e) => setLoad({ state: "error", message: String(e?.message ?? e) }));
  }, []);
  const feed = load?.state === "ready" ? load.feed : null;

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <Link to="/stats" className="text-sm text-muted-foreground hover:text-foreground">← Back to dashboard</Link>
      <header className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Solana Paper Trades</h1>
        <span className="rounded-full border border-bull/40 bg-bull/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-bull">Paper trading</span>
      </header>
      <p className="mt-2 text-sm text-muted-foreground">Simulated trades only. No real orders or funds.</p>
      {feed && (
        <p className="mt-1 text-xs text-muted-foreground">
          {feed.evidence_kind === "offline_synthetic" ? "Synthetic test data — not observed results." : "Fills and costs are modeled; PnL is an estimate, not the source wallet's result."}
          {" "}Status: {feed.status} · data {ageLabel(feed.data_as_of, now)}{feed.coverage.gap_count != null ? ` · ${feed.coverage.gap_count} gaps` : ""}
        </p>
      )}

      <section className="mt-8 rounded-lg border border-border bg-card/40">
        {load == null ? (
          <p className="p-8 text-center text-muted-foreground">Loading…</p>
        ) : load.state === "not_started" ? (
          <div className="px-6 py-14 text-center">
            <p className="font-mono text-lg font-semibold">Pilot not running</p>
            <p className="mt-2 text-muted-foreground">Trades will appear here when the paper-trading feed is connected.</p>
          </div>
        ) : load.state === "error" ? (
          <div className="px-6 py-14 text-center">
            <p className="font-mono text-lg font-semibold text-bear">Feed unavailable</p>
            <p className="mt-2 break-words text-muted-foreground">{load.message}</p>
          </div>
        ) : load.feed.trades.length === 0 ? (
          <p className="px-6 py-14 text-center text-muted-foreground">No paper trades recorded yet.</p>
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border">
                  {["Wallet", "Token", "Bought (SOL)", "Token qty", "Estimated paper PnL"].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {load.feed.trades.map((t) => (
                  <tr key={tradeKey(t)} className="border-b border-border/50 last:border-0 align-top">
                    <td className="px-5 py-4 font-mono">{walletTail(t.source_wallet)}</td>
                    <td className="px-5 py-4">{token(t)}</td>
                    <td className="px-5 py-4 font-mono">{lamportsToSol(t.entry_input_lamports)}</td>
                    <td className="px-5 py-4 font-mono">{qty(t)}</td>
                    <td className="px-5 py-4"><div><Pnl t={t} /></div><Mark t={t} now={now} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-border md:hidden">
              {load.feed.trades.map((t) => (
                <li key={tradeKey(t)} className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-sm">
                  <span className="text-muted-foreground">Wallet</span><span className="text-right font-mono">{walletTail(t.source_wallet)}</span>
                  <span className="text-muted-foreground">Token</span><span className="text-right">{token(t)}</span>
                  <span className="text-muted-foreground">Bought</span><span className="text-right font-mono">{lamportsToSol(t.entry_input_lamports)} SOL</span>
                  <span className="text-muted-foreground">Qty</span><span className="text-right font-mono">{qty(t)}</span>
                  <span className="text-muted-foreground">Est. paper PnL</span><span className="text-right"><Pnl t={t} /></span>
                  <span className="col-span-2 text-right"><Mark t={t} now={now} /></span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
