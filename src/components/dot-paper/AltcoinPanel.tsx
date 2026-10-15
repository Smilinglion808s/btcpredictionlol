import type { AltWorkerView } from "../../lib/dot-paper/alt-worker-view";

const t = (ms: number | null) => (ms == null ? "—" : new Date(ms).toISOString().slice(11, 19) + "Z");
const age = (ms: number | null) => (ms == null ? "—" : `${Math.round(ms / 1000)}s ago`);
const s = (v: unknown) => (v == null || v === "" ? "—" : String(v));

export function AltcoinPanel({ view }: { view: AltWorkerView }) {
  const p = view.paper;
  return (
    <section className="dot-panel" aria-label="Altcoin paper collector">
      <div className="dot-panel-title">
        <h2>Altcoin Paper · SOLUSDT · DOGEUSDT</h2>
        <span className={`dot-alt-badge dot-alt-${view.tone}`} data-testid="alt-label">{view.label}</span>
      </div>
      <p className="dot-muted" data-testid="alt-note">{view.note}</p>
      <dl className="dot-alt-grid">
        {view.symbols.map((x) => (
          <div key={x.symbol}>
            <dt>{x.symbol} <span className={`dot-alt-${x.tone}`}>{x.label}</span></dt>
            <dd>{s(x.bid)} / {s(x.ask)} · {t(x.quoteMs)} · {age(x.ageMs)}</dd>
          </div>
        ))}
        <div><dt>Connections / failures</dt><dd>{s(view.connects)} / {s(view.failures)}</dd></div>
        <div><dt>Last error</dt><dd>{s(view.lastError)}</dd></div>
      </dl>
      {p == null ? null : "reason" in p ? (
        <p className="dot-muted" data-testid="alt-paper-unavailable">{p.reason} — balance unknown.</p>
      ) : (
        <>
          <dl className="dot-alt-grid">
            <div><dt>Virtual balance (start)</dt><dd>${s(p.starting)}</dd></div>
            <div><dt>Cash</dt><dd>${s(p.cash)}</dd></div>
            <div><dt>Equity</dt><dd>${s(p.equity)}</dd></div>
            <div><dt>Used margin</dt><dd>${s(p.usedMargin)}</dd></div>
            <div><dt>Strategy</dt><dd className={p.strategy === "ENABLED" ? "dot-alt-mint" : "dot-alt-amber"}>{p.strategy}</dd></div>
            <div><dt>Trades</dt><dd>{s(p.tradeCount)}</dd></div>
          </dl>
          <p className="dot-muted">Open positions: {p.positions.length === 0 ? "none" : p.positions.map((x) => `${s(x.symbol)} ${s(x.side)} ${s(x.qty)} @ ${s(x.entry)} (uPnL ${s(x.unrealized_pnl)})`).join(" · ")}</p>
          <p className="dot-muted">Last trades: {p.trades.length === 0 ? "none" : p.trades.map((x) => `${s(x.symbol)} ${s(x.side ?? x.action)} ${s(x.price ?? x.exit_price)}`).join(" · ")}</p>
        </>
      )}
      <p className="dot-muted">Virtual paper only. No real orders; fills and size unverified; no profitability claim.</p>
    </section>
  );
}
