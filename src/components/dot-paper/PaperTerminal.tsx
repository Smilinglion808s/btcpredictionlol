import type { ReactNode } from "react";
import {
  ArrowDownRight,
  ArrowUpRight,
  Download,
  RefreshCw,
} from "lucide-react";
import type {
  DashboardSnapshot,
  DashboardTrade,
} from "../../lib/dot-paper/types";
import {
  freshness,
  money,
  quantity,
  timestamp,
  tone,
  tradeCsv,
} from "../../lib/dot-paper/presentation";
import "./terminal.css";

export interface PaperTerminalProps {
  view: "loading" | "locked" | "error" | "ready";
  snapshot?: DashboardSnapshot;
  elapsedMs?: number;
  now?: number;
  message?: string;
  refreshing?: boolean;
  pageBusy?: boolean;
  preview?: boolean;
  onRefresh: () => void;
  onLoadOlder?: () => void;
}
function Badge({
  children,
  kind = "neutral",
}: {
  children: ReactNode;
  kind?: "amber" | "mint" | "red" | "neutral";
}) {
  return <span className={`dot-badge ${kind}`}>{children}</span>;
}
function Metric({
  label,
  value,
  note,
  color = "",
  loading,
}: {
  label: string;
  value: string;
  note: string;
  color?: string;
  loading?: boolean;
}) {
  return (
    <div className="dot-metric">
      <div className="dot-kicker">{label}</div>
      <div className={`dot-metric-value ${color}`}>
        {loading ? (
          <span className="dot-loading" aria-label="Loading" />
        ) : (
          value
        )}
      </div>
      <div className="dot-muted">{note}</div>
    </div>
  );
}
function Side({ side }: { side: "LONG" | "SHORT" }) {
  return (
    <span
      className={`dot-side ${side === "LONG" ? "dot-positive" : "dot-amber"}`}
    >
      {side === "LONG" ? (
        <ArrowUpRight size={14} aria-hidden="true" />
      ) : (
        <ArrowDownRight size={14} aria-hidden="true" />
      )}
      {side}
    </span>
  );
}
function Trade({
  trade: t,
  symbol,
  currency,
}: {
  trade: DashboardTrade;
  symbol: string;
  currency: string;
}) {
  return (
    <details className="dot-trade">
      <summary>
        <span className="dot-trade-asset">
          <strong>{t.symbol ?? symbol}</strong>
          <Side side={t.side} />
        </span>
        <span className="dot-trade-time">
          {timestamp(t.exit.fill_ms, true)}
        </span>
        <Badge
          kind={
            t.outcome === "WIN"
              ? "mint"
              : t.outcome === "LOSS"
                ? "red"
                : t.outcome === "PENDING"
                  ? "amber"
                  : "neutral"
          }
        >
          {t.outcome === "PENDING" ? "UNSETTLED" : t.outcome}
        </Badge>
        <strong className={`dot-trade-net ${tone(t.net_pnl_micros)}`}>
          {money(t.net_pnl_micros, true)} <small>{currency}</small>
        </strong>
        <span className="dot-detail-label">
          Details <span aria-hidden="true">+</span>
        </span>
      </summary>
      <dl className="dot-trade-details">
        <div>
          <dt>Entry · UTC</dt>
          <dd>{timestamp(t.entry.fill_ms, true).replace(" UTC", "")}</dd>
          <dd className="dot-muted">
            {money(t.entry.price_micros)} {currency}
          </dd>
        </div>
        <div>
          <dt>Exit · UTC</dt>
          <dd>{timestamp(t.exit.fill_ms, true).replace(" UTC", "")}</dd>
          <dd className="dot-muted">
            {money(t.exit.price_micros)} {currency}
          </dd>
        </div>
        <div>
          <dt>Risk budget</dt>
          <dd>
            {money(t.risk_micros)} {currency}
          </dd>
        </div>
        <div>
          <dt>Fees</dt>
          <dd>
            {money(t.fees_micros)} {currency}
          </dd>
        </div>
        <div>
          <dt>Quantity</dt>
          <dd>{quantity(t.entry.quantity_sats)} BTC</dd>
        </div>
        <div>
          <dt>Funding / carry</dt>
          <dd>
            {t.carry_micros == null
              ? "Pending settlement"
              : `${money(t.carry_micros)} ${currency}`}
          </dd>
        </div>
      </dl>
    </details>
  );
}
export function PaperTerminal({
  view,
  snapshot,
  elapsedMs = 0,
  now = Date.now(),
  message,
  refreshing = false,
  pageBusy = false,
  preview = false,
  onRefresh,
  onLoadOlder,
}: PaperTerminalProps) {
  const s = view === "ready" ? snapshot : undefined;
  const currency = s?.account.currency ?? "USD";
  const { isStale, snapshotStale } = freshness(s, elapsedMs);
  const quoteUsable =
    !!s && !isStale && !snapshotStale && s.feed.health === "FRESH";
  const valueUsable = !!s && !snapshotStale && (!s.position || quoteUsable);
  const state = (() => {
    if (view === "loading") return "CONNECTING";
    if (view === "locked") return "NOT CONNECTED";
    if (view === "error" || !s) return "UNAVAILABLE";
    if (snapshotStale) return "CONNECTION LOST";
    if (s.state === "ERROR") return "UNAVAILABLE";
    if (s.state === "CIRCUIT_BREAKER") return "TRADING HALTED";
    if (s.observing && !s.trading_enabled)
      return quoteUsable ? "OBSERVING" : "WAITING FOR DATA";
    if (s.state === "STALE" || s.state === "WAITING_FOR_DATA")
      return "WAITING FOR DATA";
    if (!s.trading_enabled || s.state === "PAUSED") return "PAUSED";
    if (!quoteUsable || s.state !== "RUNNING") return "WAITING FOR DATA";
    return "PAPER TRADING";
  })();
  const statusTone =
    view === "error" || s?.state === "ERROR" || s?.state === "CIRCUIT_BREAKER"
      ? "red"
      : s?.trading_enabled && s.state === "RUNNING" && quoteUsable
        ? "mint"
        : "amber";
  const rows = s?.trades.items ?? [];
  const position = s?.position;
  const winRate =
    s?.account.win_rate_pct == null ||
    s.account.closed_trades === 0 ||
    s.account.wins + s.account.losses + s.account.flats === 0
      ? "—"
      : `${s.account.win_rate_pct.toFixed(1)}%`;
  const warning = snapshotStale
    ? "Connection lost. Showing the last received records."
    : s?.position && !quoteUsable
      ? "Market data is unavailable or stale. Current position value is hidden."
      : message;
  const exportRows = () => {
    if (!s || !rows.length) return;
    const url = URL.createObjectURL(
      new Blob(["\uFEFF" + tradeCsv(rows, s.symbol, currency)], {
        type: "text/csv;charset=utf-8",
      }),
    );
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `DOT-paper-trades-${new Date(now).toISOString().slice(0, 10)}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="dot-terminal">
      <div className="dot-desk">
        {preview && (
          <div className="dot-preview" role="note">
            DESIGN PREVIEW · Synthetic UI fixtures only. Not performance.
          </div>
        )}
        <header className="dot-titlebar">
          <div className="dot-brand">
            <div className="dot-mark" aria-hidden="true">
              {Array.from({ length: 9 }, (_, i) => (
                <span key={i} />
              ))}
            </div>
            <div>
              <div className="dot-wordmark">DOT</div>
              <h1>Paper trading</h1>
            </div>
          </div>
          <div className="dot-header-actions">
            <Badge kind="amber">PAPER</Badge>
            <Badge>{preview ? "PREVIEW" : "FORWARD"}</Badge>
            <button
              className="dot-icon-button"
              onClick={onRefresh}
              disabled={refreshing}
              aria-label="Refresh paper data"
            >
              <RefreshCw
                size={16}
                className={refreshing ? "dot-spin" : ""}
                aria-hidden="true"
              />
            </button>
          </div>
        </header>
        <div className="dot-status-line">
          <div className="dot-status-copy">
            <Badge kind={statusTone}>{state}</Badge>
            <span>
              {s
                ? s.trading_enabled
                  ? "Simulated trades only"
                  : "Trading disabled"
                : view === "loading"
                  ? "Verifying paper status…"
                  : "No verified data"}
            </span>
          </div>
          <span className="dot-model">
            Active model: <strong>{s?.model_version ?? "None"}</strong>
          </span>
        </div>
        {warning && (
          <p className="dot-notice" role="status">
            {warning}
          </p>
        )}
        <section className="dot-metrics" aria-label="Paper account summary">
          <Metric
            label="Balance"
            value={money(valueUsable ? s?.account.equity_micros : null)}
            note={
              s
                ? `${currency} · paper funds${!valueUsable ? " · value unavailable" : ""}`
                : "Awaiting verified account"
            }
            loading={view === "loading"}
          />
          <Metric
            label="Net P&L"
            value={money(s?.account.realized_net_micros, true)}
            color={tone(s?.account.realized_net_micros)}
            note="Closed trades · after costs"
            loading={view === "loading"}
          />
          <Metric
            label="Win rate"
            value={winRate}
            note={
              s
                ? `${s.account.closed_trades} closed ${s.account.closed_trades === 1 ? "trade" : "trades"} · ${s.account.wins}W / ${s.account.losses}L / ${s.account.flats} flat`
                : "No verified trades"
            }
            loading={view === "loading"}
          />
        </section>
        <section className="dot-panel" aria-label="Open position">
          <div className="dot-panel-title">
            <h2>Open position</h2>
            {position && <Badge kind="mint">OPEN</Badge>}
          </div>
          {position ? (
            <div className="dot-open-position">
              <div className="dot-position-heading">
                <strong>{s.symbol}</strong>
                <Side side={position.side} />
                <span
                  className={`dot-position-pnl ${tone(quoteUsable ? s.account.unrealized_net_micros : null)}`}
                >
                  {money(
                    quoteUsable ? s.account.unrealized_net_micros : null,
                    true,
                  )}{" "}
                  {currency}
                  <small>Unrealized net P&L</small>
                </span>
              </div>
              <dl className="dot-position-details">
                <div>
                  <dt>Entry</dt>
                  <dd>
                    {money(position.entry.price_micros)} {currency}
                  </dd>
                </div>
                <div>
                  <dt>Opened · UTC</dt>
                  <dd>
                    {timestamp(position.opened_ms, true).replace(" UTC", "")}
                  </dd>
                </div>
                <div>
                  <dt>Risk budget</dt>
                  <dd>
                    {money(position.risk_micros)} {currency}
                  </dd>
                </div>
                <div>
                  <dt>Entry fee</dt>
                  <dd>
                    {money(position.entry.fee_micros)} {currency}
                  </dd>
                </div>
              </dl>
            </div>
          ) : (
            <div className="dot-empty-position">
              <span className="dot-empty-marker" aria-hidden="true">
                ○
              </span>
              <p>
                {s ? "No open position" : "No verified position data"}
                {s?.pending && (
                  <small>
                    {s.pending === "ENTRY"
                      ? "Paper entry pending"
                      : "Paper exit pending"}
                  </small>
                )}
              </p>
            </div>
          )}
        </section>
        <section className="dot-panel dot-ledger" aria-label="Closed trades">
          <div className="dot-panel-title">
            <h2>
              Closed trades{" "}
              <span className="dot-count">
                {s ? s.account.closed_trades : "—"}
              </span>
            </h2>
            <button
              className="dot-text-button"
              onClick={exportRows}
              disabled={!rows.length}
            >
              <Download size={14} aria-hidden="true" />
              Export loaded
            </button>
          </div>
          {rows.length ? (
            <div>
              {rows.map((t) => (
                <Trade
                  key={t.trade_id}
                  trade={t}
                  symbol={s!.symbol}
                  currency={currency}
                />
              ))}
            </div>
          ) : (
            <div className="dot-empty-ledger">
              <span className="dot-ledger-mark" aria-hidden="true">
                [ — ]
              </span>
              <h3>
                {s
                  ? "No closed trades yet"
                  : view === "loading"
                    ? "Loading paper trades…"
                    : "Paper data unavailable"}
              </h3>
              <p>
                {s
                  ? "Trades and their results will appear here."
                  : "No verified paper records to display."}
              </p>
            </div>
          )}
          {s?.trades.next_cursor != null && (
            <div className="dot-load-older">
              <button
                className="dot-text-button"
                onClick={onLoadOlder}
                disabled={pageBusy || !onLoadOlder}
              >
                {pageBusy ? "Loading…" : "Load older trades"}
              </button>
            </div>
          )}
        </section>
        <footer className="dot-footer">
          <span>Simulated trades. No real orders.</span>
          <span>Win rate uses settled trades after costs.</span>
        </footer>
      </div>
    </div>
  );
}
