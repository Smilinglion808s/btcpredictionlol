import type { AltView } from "../../lib/dot-paper/altcoin-status";

const fmt = (n: number | null) => (n == null ? "—" : String(n));
const age = (ms: number | null) => (ms == null ? "—" : `${Math.round(ms / 1000)}s ago`);

export function AltcoinPanel({ view }: { view: AltView }) {
  return (
    <section className="dot-panel" aria-label="Altcoin paper collector">
      <div className="dot-panel-title">
        <h2>Altcoin Paper · SOLUSDT · DOGEUSDT</h2>
        <span className={`dot-alt-badge dot-alt-${view.tone}`} data-testid="alt-label">
          {view.label}
        </span>
      </div>
      <p className="dot-muted" data-testid="alt-note">{view.note}</p>
      <dl className="dot-alt-grid">
        <div><dt>Mode</dt><dd>{view.mode ?? "—"} · observe only</dd></div>
        <div><dt>Latest event</dt><dd>{view.lastEventMs == null ? "Not reported" : new Date(view.lastEventMs).toISOString().slice(11, 19) + "Z"}</dd></div>
        <div><dt>Age</dt><dd>{age(view.ageMs)}</dd></div>
        <div><dt>Connections</dt><dd>{fmt(view.connects)}</dd></div>
        <div><dt>Failures</dt><dd>{fmt(view.failures)}</dd></div>
        <div><dt>Last error</dt><dd>{view.lastError ?? "—"}</dd></div>
      </dl>
      <p className="dot-muted">Collector status only. No altcoin trades or profit are simulated here.</p>
    </section>
  );
}
