import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { loadSolanaPaperFeed, num, signed, toneOf, walletTail, type SolanaPaperFeed, type SolanaPaperTrade } from "@/lib/solana-paper";

export const Route = createFileRoute("/_authenticated/solana-paper")({
  head: () => ({
    meta: [
      { title: "Solana Paper Trades | BTC 15m" },
      { name: "description", content: "Paper-only view of tracked Solana wallet buys and simulated PnL." },
      { property: "og:title", content: "Solana Paper Trades" },
      { property: "og:description", content: "Paper-only view of tracked Solana wallet buys and simulated PnL." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: SolanaPaperPage,
});

const token = (t: SolanaPaperTrade) => t.tokenSymbol ?? t.tokenName ?? "—";
const pnl = (t: SolanaPaperTrade) => (
  <span className={`font-mono ${toneOf(t.pnlSol ?? t.pnlPct)}`}>
    {signed(t.pnlSol, " SOL")}{t.pnlPct != null && <span className="ml-2 text-xs">({signed(t.pnlPct, "%", 2)})</span>}
  </span>
);

function SolanaPaperPage() {
  const [feed, setFeed] = useState<SolanaPaperFeed | null>(null);
  useEffect(() => {
    loadSolanaPaperFeed().then(setFeed).catch((e) => setFeed({ status: "error", message: String(e?.message ?? e) }));
  }, []);

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
      <Link to="/stats" className="text-sm text-muted-foreground hover:text-foreground">← Back to dashboard</Link>
      <header className="mt-4 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Solana Paper Trades</h1>
        <span className="rounded-full border border-bull/40 bg-bull/10 px-3 py-1 font-mono text-xs uppercase tracking-wider text-bull">Paper trading</span>
      </header>
      <p className="mt-2 text-sm text-muted-foreground">Simulated only. No real orders, wallets or funds.</p>

      <section className="mt-8 rounded-lg border border-border bg-card/40">
        {feed == null ? (
          <p className="p-8 text-center text-muted-foreground">Loading…</p>
        ) : feed.status === "not_running" ? (
          <div className="px-6 py-14 text-center">
            <p className="font-mono text-lg font-semibold">Pilot not running</p>
            <p className="mt-2 text-muted-foreground">Trades will appear here when the paper-trading feed is connected.</p>
          </div>
        ) : feed.status === "error" ? (
          <div className="px-6 py-14 text-center">
            <p className="font-mono text-lg font-semibold text-bear">Feed unavailable</p>
            <p className="mt-2 break-words text-muted-foreground">{feed.message}</p>
          </div>
        ) : feed.trades.length === 0 ? (
          <p className="px-6 py-14 text-center text-muted-foreground">No paper trades recorded yet.</p>
        ) : (
          <>
            <table className="hidden w-full text-sm md:table">
              <thead className="text-left text-xs uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border">
                  {["Wallet", "Token", "Bought (SOL)", "Token qty", "Paper PnL"].map((h) => <th key={h} className="px-5 py-3 font-medium">{h}</th>)}
                </tr>
              </thead>
              <tbody>
                {feed.trades.map((t) => (
                  <tr key={t.id} className="border-b border-border/50 last:border-0">
                    <td className="px-5 py-4 font-mono">{walletTail(t.wallet)}</td>
                    <td className="px-5 py-4">{token(t)}</td>
                    <td className="px-5 py-4 font-mono">{num(t.amountSol)}</td>
                    <td className="px-5 py-4 font-mono">{num(t.tokenQty, 2)}</td>
                    <td className="px-5 py-4">{pnl(t)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <ul className="divide-y divide-border md:hidden">
              {feed.trades.map((t) => (
                <li key={t.id} className="grid grid-cols-2 gap-x-4 gap-y-2 p-4 text-sm">
                  <span className="text-muted-foreground">Wallet</span><span className="text-right font-mono">{walletTail(t.wallet)}</span>
                  <span className="text-muted-foreground">Token</span><span className="text-right">{token(t)}</span>
                  <span className="text-muted-foreground">Bought</span><span className="text-right font-mono">{num(t.amountSol)} SOL</span>
                  <span className="text-muted-foreground">Qty</span><span className="text-right font-mono">{num(t.tokenQty, 2)}</span>
                  <span className="text-muted-foreground">Paper PnL</span><span className="text-right">{pnl(t)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}
