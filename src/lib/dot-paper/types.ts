/** Shared wire format v1. Decimal-safe integers are strings; milliseconds are JS-safe integers. */
export type IntegerString = string;
export type PaperState =
  | "EMPTY"
  | "WAITING_FOR_DATA"
  | "RUNNING"
  | "PAUSED"
  | "STALE"
  | "CIRCUIT_BREAKER"
  | "ERROR";
export interface Page<T> {
  items: T[];
  next_cursor: number | null;
}
export interface PaperCall {
  id: number;
  call_id: string;
  strategy_version: string;
  risk_micros: IntegerString;
  action: "LONG" | "SHORT" | "EXIT" | "ABSTAIN";
  reason: string;
  strategy_action: string;
  decision_ms: number;
  bar_close_ms: number;
  received_ms: number;
  config_hash: string;
  artifact_hash: string;
  signal: Record<string, unknown>;
}
export interface PaperFill {
  price_micros: IntegerString;
  quantity_sats: IntegerString;
  notional_micros: IntegerString;
  fee_micros: IntegerString;
  exchange_ms: number;
  receipt_ms: number;
  decision_ms: number;
  fill_ms: number;
  event_ms: number;
  quote_sequence: IntegerString;
  latency_ms: number;
  bid_micros: IntegerString;
  ask_micros: IntegerString;
  slippage_bps: number;
}
export interface PaperPosition {
  position_id: string;
  call_id: string;
  side: "LONG" | "SHORT";
  opened_ms: number;
  entry: PaperFill;
  quantity_sats: IntegerString;
  stop_micros: IntegerString;
  target_micros: IntegerString;
  max_hold_ms: number;
  risk_micros: IntegerString;
  config_hash: string;
  artifact_hash: string;
}
export interface PaperTrade {
  id: number;
  trade_id: string;
  symbol: "BTCUSD" | "BTCUSDT";
  strategy_version: string;
  risk_micros: IntegerString;
  planned_stop_risk_micros: IntegerString;
  entry_notional_micros: IntegerString;
  position_id: string;
  side: "LONG" | "SHORT";
  entry: PaperFill;
  exit: PaperFill;
  closed_ms: number;
  exit_reason: string;
  gross_pnl_micros: IntegerString;
  fees_micros: IntegerString;
  carry_micros: IntegerString | null;
  net_pnl_micros: IntegerString | null;
  outcome: "WIN" | "LOSS" | "FLAT" | "PENDING";
  config_hash: string;
  artifact_hash: string;
}
export interface PaperAudit {
  id: number;
  at_ms: number;
  kind: string;
  reason: string;
  details: Record<string, unknown>;
}
export interface PaperSnapshot {
  schema_version: "dot-paper/v1";
  run_id: string;
  started_at_ms: number;
  provenance: "FORWARD" | "TEST";
  mode: "PAPER";
  caller: "DOT";
  symbol: "BTCUSD" | "BTCUSDT";
  server_ms: number;
  state: PaperState;
  running_requested: boolean;
  status_reason: string;
  strategy: {
    version: string;
    config_hash: string;
    strategy_hash: string;
    artifact_hash: string;
    validation: "EXPERIMENTAL_UNVALIDATED";
    config: Record<string, unknown>;
    calibration_venue: string;
    forward_venue: string;
    domain_shift: boolean;
  };
  feed: {
    source: string;
    enabled: boolean;
    rights_approved: boolean;
    health: "UNKNOWN" | "FRESH" | "STALE" | "DISCONNECTED" | "DISABLED";
    reason: string;
    exchange_ms: number | null;
    event_ms: number | null;
    receipt_ms: number | null;
    processed_ms: number | null;
    quote_age_ms: number | null;
    bid_micros: IntegerString | null;
    ask_micros: IntegerString | null;
    spread_bps: number | null;
    bar_close_ms: number | null;
    warmup_bars: number;
  };
  simulator: {
    health: "READY" | "BLOCKED" | "DEGRADED";
    reason: string;
    last_decision_ms: number | null;
    last_fill_ms: number | null;
  };
  account: {
    currency: "USD" | "USDT";
    initial_equity_micros: IntegerString;
    cash_micros: IntegerString;
    realized_gross_micros: IntegerString;
    realized_net_micros: IntegerString;
    fees_paid_micros: IntegerString;
    carry_paid_micros: IntegerString;
    unrealized_net_micros: IntegerString | null;
    equity_micros: IntegerString | null;
    equity_mark_ms: number | null;
    last_known_equity_micros: IntegerString | null;
    wins: number;
    losses: number;
    flats: number;
    closed_trades: number;
    win_rate_pct: number | null;
  };
  risk: {
    risk_bps: number;
    max_exposure_bps: number;
    daily_loss_limit_bps: number;
    circuit_breaker: boolean;
    daily_loss_micros: IntegerString | null;
    risk_budget_micros: IntegerString;
    max_notional_micros: IntegerString;
  };
  assumptions: {
    taker_fee_bps: number;
    slippage_bps: number;
    entry_latency_ms: number;
    exit_latency_ms: number;
    max_quote_age_ms: number;
    max_spread_bps: number;
    entry_timeout_ms: number;
    fill_model: string;
    carry_model: string;
  };
  gates: { name: string; ok: boolean; reason: string }[];
  position: PaperPosition | null;
  pending: {
    kind: "ENTRY" | "EXIT";
    side?: "LONG" | "SHORT";
    reason: string;
    decision_ms: number;
    eligible_ms: number;
    expires_ms: number | null;
  } | null;
  calls: Page<PaperCall>;
  trades: Page<PaperTrade>;
  audit: Page<PaperAudit>;
  equity: Page<{
    id: number;
    at_ms: number;
    equity_micros: IntegerString;
    mark_ms: number;
    source: "FORWARD_PAPER_MARK";
    config_hash: string;
  }>;
}
export interface PaperControl {
  action: "start" | "pause" | "reset_circuit_breaker";
  request_id: string;
}
export interface PaperError {
  code: string;
  message: string;
}

/** Browser-facing allowlist. Model rules, inputs and provenance hashes stay server-side. */
export type DashboardFill = Pick<
  PaperFill,
  "price_micros" | "quantity_sats" | "fee_micros" | "fill_ms"
>;
export interface DashboardTrade {
  id: number;
  trade_id: string;
  symbol?: "BTCUSD" | "BTCUSDT";
  side: "LONG" | "SHORT";
  entry: DashboardFill;
  exit: DashboardFill;
  risk_micros: string | null;
  fees_micros: string;
  carry_micros: string | null;
  net_pnl_micros: string | null;
  outcome: "WIN" | "LOSS" | "FLAT" | "PENDING";
}
export interface DashboardSnapshot {
  schema_version: "dot-paper/v1";
  run_id: string;
  provenance: "FORWARD" | "TEST";
  mode: "PAPER";
  symbol: "BTCUSD" | "BTCUSDT";
  server_ms: number;
  state: PaperState;
  trading_enabled: boolean;
  observing: boolean;
  model_version: string | null;
  feed: Pick<PaperSnapshot["feed"], "health" | "quote_age_ms"> & {
    max_quote_age_ms: number;
  };
  account: Pick<
    PaperSnapshot["account"],
    | "currency"
    | "cash_micros"
    | "equity_micros"
    | "realized_net_micros"
    | "unrealized_net_micros"
    | "wins"
    | "losses"
    | "flats"
    | "closed_trades"
    | "win_rate_pct"
  >;
  position: {
    position_id: string;
    side: "LONG" | "SHORT";
    opened_ms: number;
    entry: DashboardFill;
    risk_micros: string;
  } | null;
  pending: "ENTRY" | "EXIT" | null;
  trades: Page<DashboardTrade>;
}
