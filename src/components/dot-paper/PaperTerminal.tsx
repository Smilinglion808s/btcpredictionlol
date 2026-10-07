import { useState, type ReactNode } from "react";
import {
  Activity,
  ArrowDownRight,
  ArrowUpRight,
  Check,
  Clock3,
  Cpu,
  Download,
  FileClock,
  Fingerprint,
  LockKeyhole,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Terminal,
  Wallet,
  Wifi,
  X,
} from "lucide-react";
import type {
  PaperAudit,
  PaperCall,
  PaperSnapshot,
  PaperTrade,
} from "../../lib/dot-paper/types";
import {
  age,
  freshness,
  money,
  quantity,
  readable,
  shortHash,
  timestamp,
  tone,
  tradeCsv,
} from "../../lib/dot-paper/presentation";
import "./terminal.css";

export interface PaperTerminalProps {
  view: "loading" | "locked" | "error" | "ready";
  snapshot?: PaperSnapshot;
  elapsedMs?: number;
  now?: number;
  message?: string;
  refreshing?: boolean;
  pageBusy?: boolean;
  preview?: boolean;
  onRefresh: () => void;
  onLoadOlder?: (kind: "trades" | "calls" | "audit") => void;
}

function Badge({
  children,
  kind = "neutral",
  dot = false,
}: {
  children: ReactNode;
  kind?: "amber" | "mint" | "red" | "neutral";
  dot?: boolean;
}) {
  return (
    <span className={`dot-badge ${kind}`}>
      {dot && <span className="dot-status-dot" aria-hidden="true" />}
      {children}
    </span>
  );
}
function Panel({
  index,
  title,
  aside,
  children,
  className = "",
}: {
  index: string;
  title: string;
  aside?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`dot-panel ${className}`} aria-label={title}>
      <div className="dot-panel-title">
        <h2>
          <span className="dot-panel-index" aria-hidden="true">
            {index}
          </span>
          {title}
        </h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
function Pair({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="dot-summary-line">
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}
function Metric({
  label,
  value,
  note,
  positive,
  loading,
}: {
  label: string;
  value: string;
  note: string;
  positive?: string;
  loading?: boolean;
}) {
  return (
    <div className="dot-metric">
      <div className="dot-kicker">{label}</div>
      <div className={`dot-metric-value dot-mono ${positive ?? ""}`}>
        {loading ? <div className="dot-loading" aria-label="Loading" /> : value}
      </div>
      <div className="dot-metric-note">{note}</div>
    </div>
  );
}
function reasonCopy(reason: string) {
  const reasons: Record<string, string> = {
    WARMUP:
      "Building the required completed-candle window. No entry until every data gate passes.",
    WEAK_FLOW:
      "Executed buy/sell flow is below the configured imbalance threshold. Staying flat.",
    LOW_PARTICIPATION:
      "Current market participation is too low relative to the reference window.",
    PRICE_NOT_CONFIRMED:
      "Price has not confirmed the direction of executed flow. No entry.",
    CHASE_FILTER:
      "The price move exceeded the chase limit. This setup was skipped.",
    FLOW_CONTINUATION:
      "Executed flow, participation, and price confirmation aligned with the frozen rules.",
    FLOW_REVERSAL: "Opposing flow met the configured exit condition.",
    MAX_HOLD: "The maximum holding period was reached.",
    HOLD: "The position is open and no configured exit condition has triggered.",
    INVALID_INPUT:
      "Required input failed validation. The simulator is blocked.",
    PAUSED: "Paper execution is paused. New entries are disabled.",
  };
  return (
    reasons[reason] ??
    `Recorded reason: ${readable(reason)}. See the decision tape for the original inputs.`
  );
}
function tradeRisk(trade: PaperTrade) {
  return (trade as PaperTrade & { risk_micros?: string }).risk_micros;
}
function tradeVersion(trade: PaperTrade) {
  return (trade as PaperTrade & { strategy_version?: string }).strategy_version;
}
function outcomeBadge(trade: PaperTrade) {
  return (
    <Badge
      kind={
        trade.outcome === "WIN"
          ? "mint"
          : trade.outcome === "LOSS"
            ? "red"
            : trade.outcome === "PENDING"
              ? "amber"
              : "neutral"
      }
    >
      {trade.outcome === "PENDING" ? "UNSETTLED" : trade.outcome}
    </Badge>
  );
}
function Side({ side }: { side: "LONG" | "SHORT" }) {
  return (
    <span
      className={`dot-flex ${side === "LONG" ? "dot-positive" : "dot-amber"}`}
      style={{ gap: 4 }}
    >
      {side === "LONG" ? (
        <ArrowUpRight size={12} />
      ) : (
        <ArrowDownRight size={12} />
      )}
      {side}
    </span>
  );
}
function EquityChart({
  records,
  currency,
}: {
  records: PaperSnapshot["equity"]["items"];
  currency: string;
}) {
  const points = [...records]
    .filter((point) => point.source === "FORWARD_PAPER_MARK")
    .sort((a, b) => a.at_ms - b.at_ms);
  if (points.length < 2) return null;
  const values = points.map((point) => BigInt(point.equity_micros));
  const low = values.reduce((a, b) => (a < b ? a : b)),
    high = values.reduce((a, b) => (a > b ? a : b));
  const range = high - low || 1_000_000n;
  const start = points[0].at_ms,
    end = points[points.length - 1].at_ms;
  const xy = points.map((point, i) => ({
    x: 10 + ((point.at_ms - start) / Math.max(1, end - start)) * 780,
    y:
      high === low
        ? 92
        : 165 - Number(((values[i] - low) * 140_000n) / range) / 1000,
  }));
  const segments: string[] = [];
  let segment = "";
  points.forEach((point, i) => {
    if (i && point.at_ms - points[i - 1].at_ms > 45_000) {
      if (segment) segments.push(segment);
      segment = "";
    }
    segment += `${xy[i].x},${xy[i].y} `;
  });
  if (segment) segments.push(segment);
  return (
    <>
      <svg
        className="dot-chart"
        viewBox="0 0 800 185"
        preserveAspectRatio="none"
        role="img"
        aria-label={`Latest ${points.length} persisted forward paper equity marks. ${money(points[points.length - 1].equity_micros)} ${currency}. Gaps over 45 seconds are not connected.`}
      >
        <title>Forward paper equity, recorded marks only</title>
        {segments.map((line, i) => (
          <polyline
            key={i}
            points={line}
            fill="none"
            stroke="var(--dot-mint)"
            strokeWidth="2"
            vectorEffect="non-scaling-stroke"
          />
        ))}
        {xy.map((p, i) => (
          <circle
            key={points[i].id}
            cx={p.x}
            cy={p.y}
            r={i === points.length - 1 ? 3 : 1.5}
            fill="var(--dot-mint)"
          />
        ))}
      </svg>
      <div className="dot-chart-axis">
        <span>{timestamp(start)}</span>
        <span>
          {points.length} recorded marks · {money(low.toString())}–
          {money(high.toString())} {currency}
        </span>
        <span>{timestamp(end)}</span>
      </div>
    </>
  );
}

function TradeRows({
  trades,
  symbol,
  currency,
}: {
  trades: PaperTrade[];
  symbol: string;
  currency: string;
}) {
  return (
    <>
      <div
        className="dot-table-wrap"
        role="region"
        aria-label="Trade ledger, scroll horizontally for all fields"
        tabIndex={0}
      >
        <table className="dot-table">
          <thead>
            <tr>
              {[
                "Trade / asset",
                "Side / result",
                "Entry → exit · UTC",
                `Entry / exit · ${currency}`,
                `Planned risk · ${currency}`,
                "Gross P&L",
                "Fees / funding",
                "Net P&L",
              ].map((h) => (
                <th scope="col" key={h}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {trades.map((t) => (
              <tr key={t.trade_id}>
                <td>
                  <strong title={t.trade_id}>
                    {t.trade_id.length > 16
                      ? t.trade_id.slice(0, 12)
                      : t.trade_id}
                  </strong>
                  <small>{symbol}</small>
                  <small title={t.config_hash}>
                    {tradeVersion(t) ?? shortHash(t.config_hash)}
                  </small>
                </td>
                <td>
                  <Side side={t.side} />
                  <div style={{ marginTop: 6 }}>{outcomeBadge(t)}</div>
                </td>
                <td>
                  <span title={timestamp(t.entry.fill_ms, true)}>
                    {timestamp(t.entry.fill_ms)}
                  </span>
                  <small title={timestamp(t.exit.fill_ms, true)}>
                    {timestamp(t.exit.fill_ms)}
                  </small>
                  <small>
                    {new Date(t.closed_ms).toISOString().slice(0, 10)}
                  </small>
                </td>
                <td className="numeric">
                  {money(t.entry.price_micros)}
                  <small>{money(t.exit.price_micros)}</small>
                  <small>{quantity(t.entry.quantity_sats)} BTC</small>
                </td>
                <td className="numeric">
                  {money(tradeRisk(t))}
                  <small>Budget at entry</small>
                  <small>
                    {money(t.entry_notional_micros ?? t.entry.notional_micros)}{" "}
                    notional
                  </small>
                </td>
                <td className={`numeric ${tone(t.gross_pnl_micros)}`}>
                  {money(t.gross_pnl_micros, true)}
                  <small>{readable(t.exit_reason)}</small>
                </td>
                <td className="numeric">
                  {money(t.fees_micros)}
                  <small>
                    {t.carry_micros == null
                      ? "Funding pending"
                      : `${money(t.carry_micros, true)} funding`}
                  </small>
                </td>
                <td className={`numeric ${tone(t.net_pnl_micros)}`}>
                  <strong>{money(t.net_pnl_micros, true)}</strong>
                  <small>
                    {t.net_pnl_micros == null
                      ? "Awaiting settlement"
                      : "After all costs"}
                  </small>
                  <details>
                    <summary>Audit</summary>
                    <small title={t.config_hash}>
                      Config {shortHash(t.config_hash)}
                    </small>
                    <small title={t.artifact_hash}>
                      Code {shortHash(t.artifact_hash)}
                    </small>
                    <small>Entry latency {t.entry.latency_ms} ms</small>
                    <small>Exit latency {t.exit.latency_ms} ms</small>
                  </details>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="dot-mobile-trades">
        {trades.map((t) => (
          <article className="dot-trade-card" key={t.trade_id}>
            <div className="dot-trade-card-top">
              <div className="dot-flex">
                <strong>{symbol}</strong>
                <Side side={t.side} />
              </div>
              {outcomeBadge(t)}
            </div>
            <dl>
              <div>
                <dt>Net P&L · {currency}</dt>
                <dd className={tone(t.net_pnl_micros)}>
                  {money(t.net_pnl_micros, true)}
                </dd>
              </div>
              <div>
                <dt>Planned risk budget · {currency}</dt>
                <dd>{money(tradeRisk(t))}</dd>
              </div>
              <div>
                <dt>Entry → exit · {currency}</dt>
                <dd>
                  {money(t.entry.price_micros)} → {money(t.exit.price_micros)}
                </dd>
              </div>
              <div>
                <dt>Gross / fees · {currency}</dt>
                <dd>
                  {money(t.gross_pnl_micros, true)} / {money(t.fees_micros)}
                </dd>
              </div>
              <div>
                <dt>Opened · UTC</dt>
                <dd>{timestamp(t.entry.fill_ms, true).replace(" UTC", "")}</dd>
              </div>
              <div>
                <dt>Closed · UTC</dt>
                <dd>{timestamp(t.exit.fill_ms, true).replace(" UTC", "")}</dd>
              </div>
            </dl>
            <details>
              <summary>Trade details & audit trail</summary>
              <p>
                Trade: {t.trade_id}
                <br />
                Quantity: {quantity(t.entry.quantity_sats)} BTC
                <br />
                Entry notional:{" "}
                {money(t.entry_notional_micros ?? t.entry.notional_micros)}{" "}
                {currency}
                <br />
                Planned stop risk: {money(t.planned_stop_risk_micros)}{" "}
                {currency}
                <br />
                Funding: {money(t.carry_micros, true)} {currency}{" "}
                {t.carry_micros == null ? "(pending)" : ""}
                <br />
                Exit: {readable(t.exit_reason)}
                <br />
                Strategy: {tradeVersion(t) ?? "See config hash"}
                <br />
                Config: {t.config_hash}
                <br />
                Code: {t.artifact_hash}
                <br />
                Entry / exit latency: {t.entry.latency_ms} / {t.exit.latency_ms}{" "}
                ms
              </p>
            </details>
          </article>
        ))}
      </div>
    </>
  );
}
function CallRows({ calls }: { calls: PaperCall[] }) {
  return (
    <div className="dot-call-list">
      {calls.map((c) => (
        <article className="dot-call" key={c.call_id}>
          <div>
            {timestamp(c.decision_ms)}
            <br />
            <small>{new Date(c.decision_ms).toISOString().slice(0, 10)}</small>
          </div>
          <div>
            <Badge
              kind={
                c.action === "ABSTAIN"
                  ? "neutral"
                  : c.action === "EXIT"
                    ? "amber"
                    : "mint"
              }
            >
              {c.action}
            </Badge>
          </div>
          <div>
            <strong>{readable(c.reason)}</strong>
            <p>{reasonCopy(c.reason)}</p>
            <details>
              <summary
                style={{
                  color: "var(--dot-amber)",
                  cursor: "pointer",
                  paddingTop: 8,
                }}
              >
                Decision inputs & provenance
              </summary>
              <pre className="dot-config">
                {JSON.stringify(
                  {
                    strategy_action: c.strategy_action,
                    bar_close: timestamp(c.bar_close_ms, true),
                    received: timestamp(c.received_ms, true),
                    config_hash: c.config_hash,
                    artifact_hash: c.artifact_hash,
                    signal: c.signal,
                  },
                  null,
                  2,
                )}
              </pre>
            </details>
          </div>
        </article>
      ))}
    </div>
  );
}
function AuditRows({ items }: { items: PaperAudit[] }) {
  return (
    <div className="dot-call-list">
      {items.map((item) => (
        <article className="dot-call" key={item.id}>
          <div>
            {timestamp(item.at_ms)}
            <br />
            <small>{new Date(item.at_ms).toISOString().slice(0, 10)}</small>
          </div>
          <div>
            <Badge>{readable(item.kind)}</Badge>
          </div>
          <div>
            {readable(item.reason)}
            <details>
              <summary
                style={{
                  color: "var(--dot-amber)",
                  cursor: "pointer",
                  paddingTop: 8,
                }}
              >
                Event details
              </summary>
              <pre className="dot-config">
                {JSON.stringify(item.details, null, 2)}
              </pre>
            </details>
          </div>
        </article>
      ))}
    </div>
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
  const [tab, setTab] = useState<"trades" | "calls" | "audit">("trades");
  const [filter, setFilter] = useState("ALL");
  const currency = snapshot?.account.currency ?? "QUOTE";
  const symbol = snapshot ? `BTC / ${currency}` : "BTC";
  const loaded = view === "ready" && !!snapshot;
  const s = loaded ? snapshot : undefined;
  const { ageMs, isStale, snapshotStale } = freshness(s, elapsedMs);
  const quoteUsable =
    !!s && !isStale && !snapshotStale && s.feed.health === "FRESH";
  const lastCall = s?.calls.items[0];
  const running = !!s?.running_requested;
  const state =
    view === "loading"
      ? "CONNECTING"
      : view === "locked"
        ? "NOT CONNECTED"
        : view === "error"
          ? "UNAVAILABLE"
          : snapshotStale
            ? "CONNECTION LOST"
            : isStale
              ? "STALE DATA"
              : (s?.state ?? "WAITING");
  const stateKind =
    view === "error" || s?.state === "ERROR" || s?.state === "CIRCUIT_BREAKER"
      ? "red"
      : s?.state === "RUNNING" && quoteUsable
        ? "mint"
        : "amber";
  const rows =
    s?.trades.items.filter((t) => filter === "ALL" || t.outcome === filter) ??
    [];
  const closed = s?.account.closed_trades ?? 0;
  const net = s?.account.realized_net_micros;
  const winRate =
    s?.account.win_rate_pct == null
      ? "—"
      : `${s.account.win_rate_pct.toFixed(1)}%`;
  const nextCursor = s?.[tab].next_cursor;
  const noRows =
    tab === "trades"
      ? rows.length === 0
      : tab === "calls"
        ? !s?.calls.items.length
        : !s?.audit.items.length;
  const exportRows = () => {
    if (!s || !rows.length) return;
    const blob = new Blob(["\uFEFF" + tradeCsv(rows, s.symbol, currency)], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob),
      anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `DOT-paper-loaded-trades-${new Date(now).toISOString().slice(0, 10)}.csv`;
    anchor.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="dot-terminal">
      <div className="dot-desk">
        {preview && (
          <div className="dot-preview" role="note">
            DESIGN PREVIEW · Synthetic UI fixtures only. These are not trades,
            market data, or performance results.
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
              <div className="dot-wordmark">
                DOT<span className="dot-amber">.</span>
              </div>
              <div className="dot-brand-note">PAPER TRADING TERMINAL</div>
            </div>
          </div>
          <div className="dot-titlebar-right">
            <Badge kind="amber">
              <ShieldCheck size={11} />
              FORWARD TEST ONLY
            </Badge>
            <div className="dot-clock">{timestamp(now)} / BTC ONLY</div>
          </div>
        </header>
        <div className="dot-intro">
          <div>
            <div className="dot-kicker">
              BTC Predictor Pro / Experimental desk 01
            </div>
            <h1>
              Live market.
              <br className="dot-mobile-break" /> <span>Paper capital.</span>
            </h1>
            <p>
              A timestamped, cost-aware record of what happens next. Every call,
              fill, and abstention stays on the tape.
            </p>
          </div>
          <div className="dot-actions">
            <button
              className={`dot-btn ${refreshing ? "dot-fetching" : ""}`}
              onClick={onRefresh}
              disabled={refreshing || view === "loading"}
              aria-label="Refresh paper trading status"
            >
              <RefreshCw size={13} />
              <span>Refresh</span>
            </button>
            <Badge kind="amber">
              <ShieldCheck size={12} />
              READ-ONLY PAPER DESK
            </Badge>
          </div>
        </div>
        <div aria-live="polite" aria-atomic="true">
          {view === "locked" && (
            <div className="dot-banner">
              <LockKeyhole size={15} />
              <div>
                <strong>Paper data is not connected.</strong>
                <p>
                  {message ||
                    "The isolated paper service must be configured before verified forward records can be displayed."}
                </p>
              </div>
            </div>
          )}
          {view === "error" && (
            <div className="dot-banner error">
              <Wifi size={15} />
              <div>
                <strong>Paper service unavailable.</strong>
                <p>
                  {message ||
                    "No account data could be verified. Refresh to try again. Missing data is never shown as zero performance."}
                </p>
              </div>
            </div>
          )}
          {(isStale || snapshotStale) && loaded && (
            <div className="dot-banner">
              <Clock3 size={15} />
              <div>
                <strong>
                  {snapshotStale
                    ? "Connection lost. Values below are the last received snapshot."
                    : "Market data is stale. New entries are blocked."}
                </strong>
                <p>
                  Unrealized P&L and equity are withheld until a fresh, valid
                  quote is available. Open-position exposure may still exist.
                </p>
              </div>
            </div>
          )}
          {s?.risk.circuit_breaker && (
            <div className="dot-banner error">
              <ShieldCheck size={15} />
              <div>
                <strong>Daily loss circuit breaker engaged.</strong>
                <p>
                  New entries are blocked. Open-position exits remain governed
                  by the simulator. Circuit-breaker changes are not available
                  from this read-only dashboard.
                </p>
              </div>
            </div>
          )}
          {message && view === "ready" && (
            <div className="dot-banner" role="status">
              <Terminal size={15} />
              <div>{message}</div>
            </div>
          )}
        </div>
        <div className="dot-board">
          <div className="dot-main">
            <Panel
              index="01"
              title="FORWARD BOOK"
              aside={
                <Badge kind={stateKind} dot>
                  {state}
                </Badge>
              }
            >
              {!loaded && (
                <div className="dot-locked">
                  {view === "loading" ? (
                    <RefreshCw size={16} />
                  ) : (
                    <LockKeyhole size={16} />
                  )}
                  <div>
                    <strong>
                      {view === "loading"
                        ? "Verifying paper status…"
                        : "Paper values are unavailable"}
                    </strong>
                    {view === "loading"
                      ? "Waiting for the read-only paper service."
                      : "No simulated activity is invented or backfilled."}
                  </div>
                </div>
              )}
              <div className="dot-metrics">
                <Metric
                  label={`Realized net · ${currency}`}
                  value={money(net, true)}
                  positive={tone(net)}
                  note="Closed trades, after costs"
                  loading={view === "loading"}
                />
                <Metric
                  label={`Paper equity · ${currency}`}
                  value={quoteUsable ? money(s?.account.equity_micros) : "—"}
                  note={
                    quoteUsable
                      ? "Marked to current quote"
                      : "Awaiting a valid live mark"
                  }
                  loading={view === "loading"}
                />
                <Metric
                  label="Closed trades"
                  value={loaded ? String(closed).padStart(2, "0") : "—"}
                  note={
                    loaded
                      ? `${s?.account.wins} wins / ${s?.account.losses} losses / ${s?.account.flats} flat`
                      : "Forward simulated fills only"
                  }
                  loading={view === "loading"}
                />
                <Metric
                  label="Net win rate"
                  value={winRate}
                  note={
                    closed ? "After fees & funding" : "No settled sample yet"
                  }
                  loading={view === "loading"}
                />
              </div>
              <div className="dot-plot">
                <div className="dot-plot-caption">
                  <span>FORWARD EQUITY / {currency}</span>
                  <span>NO HISTORICAL BACKTESTS</span>
                </div>
                {s && s.equity.items.length > 1 ? (
                  <EquityChart records={s.equity.items} currency={currency} />
                ) : (
                  <>
                    <div className="dot-chart-empty">
                      <div className="dot-empty-icon">
                        <Activity size={21} strokeWidth={1.3} />
                      </div>
                      <strong>
                        {!loaded
                          ? "Your forward record starts here."
                          : closed === 0
                            ? "A clean book. No closed trades yet."
                            : "Only verified forward marks belong here."}
                      </strong>
                      <p>
                        {!loaded
                          ? "Connect the paper service to view verified forward activity."
                          : closed === 0
                            ? "Performance begins with new, timestamped paper fills. Nothing is backfilled."
                            : "This view shows the latest account mark. At least two persisted forward marks are needed for an equity curve."}
                      </p>
                    </div>
                  </>
                )}
              </div>
              <div className="dot-book-footer">
                <span>
                  Gross{" "}
                  <strong className={tone(s?.account.realized_gross_micros)}>
                    {money(s?.account.realized_gross_micros, true)}
                  </strong>{" "}
                  · Fees {money(s?.account.fees_paid_micros)} · Funding{" "}
                  {money(s?.account.carry_paid_micros, true)}
                </span>
                <span>All amounts in {currency} · Paper only</span>
              </div>
            </Panel>
            <Panel
              index="02"
              title="OPEN EXPOSURE"
              aside={
                <span className="dot-kicker">
                  {loaded
                    ? s?.position
                      ? "01 POSITION"
                      : "00 POSITIONS"
                    : "NOT CONNECTED"}
                </span>
              }
            >
              {s?.position ? (
                <div className="dot-position">
                  <div className="dot-position-top">
                    <div className="dot-flex">
                      <strong>{symbol}</strong>
                      <Side side={s.position.side} />
                    </div>
                    <Badge kind="mint">SIMULATED</Badge>
                  </div>
                  <div className="dot-position-grid">
                    <div>
                      <span>UNREALIZED NET · {currency}</span>
                      <strong
                        className={
                          quoteUsable
                            ? tone(s.account.unrealized_net_micros)
                            : ""
                        }
                      >
                        {quoteUsable
                          ? money(s.account.unrealized_net_micros, true)
                          : "— stale mark"}
                      </strong>
                    </div>
                    <div>
                      <span>ENTRY / QUANTITY</span>
                      <strong>{money(s.position.entry.price_micros)}</strong>
                      <span>{quantity(s.position.quantity_sats)} BTC</span>
                    </div>
                    <div>
                      <span>STOP / TARGET</span>
                      <strong>{money(s.position.stop_micros)}</strong>
                      <span>{money(s.position.target_micros)} target</span>
                    </div>
                    <div>
                      <span>PLANNED RISK BUDGET · {currency}</span>
                      <strong>{money(s.position.risk_micros)}</strong>
                      <span>{timestamp(s.position.opened_ms)}</span>
                    </div>
                  </div>
                  <p className="dot-position-note">
                    Opened {timestamp(s.position.opened_ms, true)} · Config{" "}
                    {shortHash(s.position.config_hash)} · Unrealized net
                    includes modeled exit costs; funding treatment follows the
                    recorded cost model.
                  </p>
                </div>
              ) : (
                <div className="dot-empty-row">
                  <Wallet size={24} strokeWidth={1.2} />
                  <div>
                    <strong>
                      {loaded
                        ? "Flat. No open paper position."
                        : "No position data is available."}
                    </strong>
                    <p>
                      {loaded
                        ? "Capital remains unexposed until a valid forward setup passes the gates."
                        : "This view loads only the isolated synthetic paper account."}
                    </p>
                  </div>
                </div>
              )}
              {s?.pending && (
                <div className="dot-book-footer">
                  <span className="dot-amber">
                    PENDING {s.pending.kind} · {readable(s.pending.reason)}
                  </span>
                  <span>Eligible {timestamp(s.pending.eligible_ms)}</span>
                </div>
              )}
            </Panel>
            <Panel
              index="03"
              title="LATEST DECISION"
              aside={
                <span className="dot-kicker">
                  {lastCall ? timestamp(lastCall.decision_ms) : "NO CALL YET"}
                </span>
              }
            >
              <div className="dot-panel-body">
                <div className="dot-kicker">
                  Caller DOT / deterministic rules
                </div>
                <div className="dot-signal-head">
                  {lastCall
                    ? lastCall.action === "ABSTAIN"
                      ? "STAND BY_"
                      : `${lastCall.action}_`
                    : loaded
                      ? "WAITING FOR A SETUP_"
                      : "WAITING FOR PAPER DATA_"}
                </div>
                <p className="dot-signal-reason">
                  {lastCall
                    ? reasonCopy(lastCall.reason)
                    : loaded
                      ? "The next decision will include its timestamp, frozen configuration, and reason. Silence is not a trade."
                      : "The decision tape appears when the read-only paper service is connected."}
                </p>
                <ul className="dot-gates">
                  {s?.gates.length ? (
                    s.gates.map((gate, i) => (
                      <li key={`${gate.name}-${i}`}>
                        <span className={gate.ok ? "pass" : "fail"}>
                          {gate.ok ? <Check size={13} /> : <Pause size={12} />}
                        </span>
                        <span>
                          <strong
                            className={gate.ok ? "dot-positive" : "dot-amber"}
                          >
                            {readable(gate.name)}
                          </strong>{" "}
                          · {readable(gate.reason)}
                        </span>
                      </li>
                    ))
                  ) : (
                    <>
                      <li>
                        <Clock3 size={12} />
                        <span>
                          Fresh market data and a complete warmup window
                        </span>
                      </li>
                      <li>
                        <Fingerprint size={12} />
                        <span>
                          Frozen rules, versioned configuration, traceable calls
                        </span>
                      </li>
                      <li>
                        <ShieldCheck size={12} />
                        <span>Risk gates before every simulated entry</span>
                      </li>
                    </>
                  )}
                </ul>
              </div>
            </Panel>
          </div>
          <aside className="dot-aside" aria-label="Model and runtime details">
            <Panel
              index="A"
              title="MODEL ON DESK"
              aside={<Cpu size={14} className="dot-amber" />}
            >
              <div className="dot-panel-body">
                <div className="dot-kicker" style={{ marginBottom: 6 }}>
                  Configured candidate
                </div>
                <div className="dot-strategy-name">DOT / BTC</div>
                <p className="dot-strategy-version">
                  {s?.strategy.version ?? "VERSION NOT LOADED"}
                </p>
                <div className="dot-model-status">
                  <Badge kind="amber">
                    {loaded
                      ? "EXPERIMENTAL · UNVALIDATED"
                      : "RESEARCH / PAPER ONLY"}
                  </Badge>
                </div>
                <dl className="dot-summary">
                  <Pair label="Active trading model">
                    <span
                      className={
                        s?.state === "RUNNING" && quoteUsable
                          ? "dot-positive"
                          : "dot-amber"
                      }
                    >
                      {s?.state === "RUNNING" && quoteUsable
                        ? s.strategy.version
                        : "None · trading disabled"}
                    </span>
                  </Pair>
                  <Pair label="Run state">
                    {loaded
                      ? running
                        ? "Forward run requested"
                        : "Paused / observation only"
                      : "Not connected"}
                  </Pair>
                  <Pair label="Asset">{symbol} only</Pair>
                  <Pair label="Instrument">Spot · long / flat</Pair>
                  <Pair label="Config hash">
                    <span title={s?.strategy.config_hash}>
                      {shortHash(s?.strategy.config_hash)}
                    </span>
                  </Pair>
                  <Pair label="Code artifact">
                    <span title={s?.strategy.artifact_hash}>
                      {shortHash(s?.strategy.artifact_hash)}
                    </span>
                  </Pair>
                </dl>
                {s?.strategy.domain_shift && (
                  <p className="dot-strategy-note dot-amber">
                    Cross-venue experiment. Research inputs and forward venue
                    differ; this strategy is not validated.
                  </p>
                )}
                <p className="dot-strategy-note">
                  DOT is a deterministic, versioned rules engine. A
                  conversational model is not making tick-by-tick execution
                  decisions.
                </p>
              </div>
            </Panel>
            <Panel
              index="B"
              title="RISK ENVELOPE"
              aside={<ShieldCheck size={14} className="dot-amber" />}
            >
              <div className="dot-panel-body">
                <dl className="dot-summary">
                  <Pair label={`Risk budget · ${currency}`}>
                    {money(s?.risk.risk_budget_micros)}
                  </Pair>
                  <Pair label="Risk / trade">
                    {s ? `${s.risk.risk_bps / 100}%` : "—"}
                  </Pair>
                  <Pair label="Max exposure">
                    {s ? `${s.risk.max_exposure_bps / 100}% of equity` : "—"}
                  </Pair>
                  <Pair label="Daily loss limit">
                    {s ? `${s.risk.daily_loss_limit_bps / 100}%` : "—"}
                  </Pair>
                  <Pair label="Entry / exit latency">
                    {s
                      ? `${s.assumptions.entry_latency_ms} / ${s.assumptions.exit_latency_ms} ms`
                      : "—"}
                  </Pair>
                  <Pair label="Taker fee / slippage">
                    {s
                      ? `${s.assumptions.taker_fee_bps} / ${s.assumptions.slippage_bps} bps`
                      : "—"}
                  </Pair>
                </dl>
                <p className="dot-strategy-note">
                  Stops are simulated thresholds, not guaranteed fill prices.
                  Spread, latency, slippage, fees, and funding affect results.
                </p>
              </div>
            </Panel>
            <Panel
              index="C"
              title="SYSTEM HEALTH"
              aside={<Wifi size={14} className="dot-amber" />}
            >
              <div className="dot-panel-body dot-health-body">
                <div>
                  <div
                    className="dot-flex dot-between"
                    style={{ marginBottom: 14 }}
                  >
                    <span className="dot-kicker">Market feed</span>
                    <Badge kind={quoteUsable ? "mint" : "amber"} dot>
                      {loaded
                        ? isStale
                          ? "STALE"
                          : s?.feed.health
                        : "UNKNOWN"}
                    </Badge>
                  </div>
                  <div className="dot-feed">
                    <span>Source</span>
                    <span>{s?.feed.source ?? "Not verified"}</span>
                    <span>Quote age</span>
                    <span className={isStale ? "dot-amber" : ""}>
                      {age(ageMs)}
                    </span>
                    <span>Received · UTC</span>
                    <span>
                      {s?.feed.receipt_ms
                        ? timestamp(s.feed.receipt_ms).replace(" UTC", "")
                        : "—"}
                    </span>
                    <span>Warmup bars</span>
                    <span>{s?.feed.warmup_bars ?? "—"}</span>
                  </div>
                </div>
                <details style={{ marginTop: 12, fontSize: 10 }}>
                  <summary
                    style={{
                      cursor: "pointer",
                      color: "var(--dot-amber)",
                      minHeight: 36,
                    }}
                  >
                    Data timestamps
                  </summary>
                  <dl className="dot-summary">
                    <Pair label="Exchange">
                      {timestamp(s?.feed.exchange_ms, true)}
                    </Pair>
                    <Pair label="Event">
                      {timestamp(s?.feed.event_ms, true)}
                    </Pair>
                    <Pair label="Received">
                      {timestamp(s?.feed.receipt_ms, true)}
                    </Pair>
                    <Pair label="Processed">
                      {timestamp(s?.feed.processed_ms, true)}
                    </Pair>
                    <Pair label="Equity mark">
                      {timestamp(s?.account.equity_mark_ms, true)}
                    </Pair>
                  </dl>
                </details>
                <div
                  style={{
                    borderTop: "1px solid var(--dot-line)",
                    paddingTop: 14,
                    marginTop: 16,
                  }}
                >
                  <div
                    className="dot-flex dot-between"
                    style={{ marginBottom: 12 }}
                  >
                    <span className="dot-kicker">Simulator</span>
                    <Badge
                      kind={
                        s?.simulator.health === "READY" && !snapshotStale
                          ? "mint"
                          : "amber"
                      }
                    >
                      {snapshotStale
                        ? "UNREACHABLE"
                        : (s?.simulator.health ?? "NOT VERIFIED")}
                    </Badge>
                  </div>
                  <p className="dot-strategy-note" style={{ marginTop: 0 }}>
                    {s
                      ? readable(s.simulator.reason)
                      : "Requires the isolated paper service."}
                  </p>
                </div>
                <div className="dot-health-footer">
                  Updated {s ? timestamp(s.server_ms) : "—"} ·{" "}
                  {refreshing
                    ? "Refreshing…"
                    : loaded
                      ? s?.feed.health === "FRESH"
                        ? "Live refresh"
                        : "Auto-refresh 5s"
                      : "Waiting for service"}
                </div>
              </div>
            </Panel>
          </aside>
        </div>
        <section className="dot-panel dot-ledger" aria-label="Activity ledger">
          <div className="dot-ledger-head">
            <div
              className="dot-tabs"
              role="tablist"
              aria-label="Paper activity"
              onKeyDown={(event) => {
                const keys = ["trades", "calls", "audit"] as const;
                const index = keys.indexOf(tab);
                const next =
                  event.key === "ArrowRight"
                    ? keys[(index + 1) % keys.length]
                    : event.key === "ArrowLeft"
                      ? keys[(index + keys.length - 1) % keys.length]
                      : event.key === "Home"
                        ? keys[0]
                        : event.key === "End"
                          ? keys[keys.length - 1]
                          : null;
                if (next) {
                  event.preventDefault();
                  setTab(next);
                  document.getElementById(`dot-tab-${next}`)?.focus();
                }
              }}
            >
              <button
                role="tab"
                id="dot-tab-trades"
                tabIndex={tab === "trades" ? 0 : -1}
                aria-selected={tab === "trades"}
                aria-controls="dot-activity-panel"
                onClick={() => setTab("trades")}
              >
                Trade ledger
                <span className="dot-count">
                  {loaded ? s?.trades.items.length : "—"}
                </span>
              </button>
              <button
                role="tab"
                id="dot-tab-calls"
                tabIndex={tab === "calls" ? 0 : -1}
                aria-selected={tab === "calls"}
                aria-controls="dot-activity-panel"
                onClick={() => setTab("calls")}
              >
                Decision tape
                <span className="dot-count">
                  {loaded ? s?.calls.items.length : "—"}
                </span>
              </button>
              <button
                role="tab"
                id="dot-tab-audit"
                tabIndex={tab === "audit" ? 0 : -1}
                aria-selected={tab === "audit"}
                aria-controls="dot-activity-panel"
                onClick={() => setTab("audit")}
              >
                System log
              </button>
            </div>
            <button
              className="dot-btn small"
              onClick={exportRows}
              disabled={!rows.length || tab !== "trades"}
            >
              <Download size={12} />
              Export loaded rows
            </button>
          </div>
          <div
            id="dot-activity-panel"
            role="tabpanel"
            aria-labelledby={`dot-tab-${tab}`}
          >
            <div className="dot-ledger-toolbar">
              <div className="dot-flex">
                <Badge>{symbol}</Badge>
                {tab === "trades" && (
                  <>
                    <label className="dot-sr-only" htmlFor="dot-outcome">
                      Filter trade outcome
                    </label>
                    <select
                      id="dot-outcome"
                      className="dot-select"
                      value={filter}
                      onChange={(e) => setFilter(e.target.value)}
                    >
                      <option value="ALL">All outcomes</option>
                      <option value="WIN">Wins</option>
                      <option value="LOSS">Losses</option>
                      <option value="FLAT">Flat</option>
                      <option value="PENDING">Unsettled</option>
                    </select>
                  </>
                )}
              </div>
              <span className="dot-kicker">FORWARD RECORDS ONLY</span>
            </div>
            {noRows ? (
              <>
                <div className="dot-table-wrap" aria-hidden="true">
                  <table className="dot-table">
                    <thead>
                      <tr>
                        {(tab === "trades"
                          ? [
                              "Trade / asset",
                              "Side / result",
                              "Entry → exit · UTC",
                              "Entry / exit",
                              "Risk",
                              "Gross P&L",
                              "Fees",
                              "Net P&L",
                            ]
                          : [
                              "Timestamp · UTC",
                              "Action",
                              "Reason",
                              "Configuration",
                            ]
                        ).map((h) => (
                          <th key={h}>{h}</th>
                        ))}
                      </tr>
                    </thead>
                  </table>
                </div>
                <div className="dot-ledger-empty">
                  <div className="dot-empty-icon">
                    <FileClock size={21} strokeWidth={1.3} />
                  </div>
                  <strong>
                    {!loaded
                      ? "No verified paper records to display."
                      : filter !== "ALL" && tab === "trades"
                        ? "No loaded trades match this outcome."
                        : tab === "trades"
                          ? "The first trade hasn’t been written yet."
                          : tab === "calls"
                            ? "No forward decisions recorded yet."
                            : "No system events recorded yet."}
                  </strong>
                  <p>
                    {!loaded
                      ? "Connect the isolated paper runtime to load its forward-only record."
                      : tab === "trades"
                        ? "Every completed paper trade will appear here with its risk, timestamps, entry and exit, and net result after costs."
                        : "Only events actually recorded by this paper runtime appear here."}
                  </p>
                </div>
              </>
            ) : tab === "trades" ? (
              <TradeRows trades={rows} symbol={symbol} currency={currency} />
            ) : tab === "calls" ? (
              <CallRows calls={s?.calls.items ?? []} />
            ) : (
              <AuditRows items={s?.audit.items ?? []} />
            )}
          </div>
          <div className="dot-ledger-footer">
            <span>Append-only record · Latest first · UTC timestamps</span>
            {nextCursor != null ? (
              <button
                className="dot-btn small"
                disabled={pageBusy}
                onClick={() => onLoadOlder?.(tab)}
              >
                {pageBusy ? "Loading…" : "Load older records"}
              </button>
            ) : (
              <span>
                {loaded ? "End of loaded record" : "Paper data unavailable"}
              </span>
            )}
          </div>
        </section>
        <div className="dot-disclosures">
          <details className="dot-disclosure">
            <summary>
              <span className="dot-flex">
                <Fingerprint size={13} />
                Frozen configuration & provenance
              </span>
            </summary>
            <div className="dot-panel-body">
              <p>
                Every call and fill keeps its configuration and code hashes. A
                version change must never relabel prior trades.
              </p>
              {s ? (
                <pre className="dot-config">
                  {JSON.stringify(
                    {
                      strategy: s.strategy,
                      risk: s.risk,
                      assumptions: s.assumptions,
                    },
                    null,
                    2,
                  )}
                </pre>
              ) : (
                <p>
                  Model configuration appears after the paper runtime is
                  connected.
                </p>
              )}
            </div>
          </details>
          <details className="dot-disclosure">
            <summary>
              <span className="dot-flex">
                <ShieldCheck size={13} />
                How this paper record is measured
              </span>
            </summary>
            <div className="dot-panel-body">
              <ul>
                <li>
                  Only new forward calls and simulated fills are eligible. No
                  historical backtest trades are imported.
                </li>
                <li>
                  Win or loss comes from settled net P&L after trading fees and
                  funding. Pending costs leave a trade unsettled.
                </li>
                <li>
                  Quotes, decisions, received data, and fills have separate
                  timestamps. Stale marks are not shown as live equity.
                </li>
                <li>
                  Paper fills model costs; they cannot reproduce real exchange
                  queues, liquidity, or guaranteed stop prices.
                </li>
                <li>
                  BTC only in this release. Paper mode has no exchange
                  credentials, fund transfers, or real-order controls.
                </li>
              </ul>
            </div>
          </details>
        </div>
        <footer className="dot-bottom">
          <span>
            <strong>DOT // FORWARD TEST ONLY</strong> · Experimental simulation.
            Not investment advice.
          </span>
          <span>NO REAL FUNDS · NO EXCHANGE ORDERS</span>
        </footer>
      </div>
    </div>
  );
}
