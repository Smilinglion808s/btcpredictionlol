// Execution policy only. It never creates a signal or changes the model side.
export type Side = 'yes' | 'no';
export type Mode = 'disabled' | 'shadow' | 'live';
// Preserve the exchange's explicit response separately from transport failures.
export class OrderHttpError extends Error {
  status: number;
  body: any;
  constructor(status: number, body: any) {
    super(`Kalshi order POST failed: ${status} ${JSON.stringify(body)}`);
    this.name = 'OrderHttpError'; this.status = status; this.body = body;
  }
}
export function isPostOnlyCrossRejection(error: unknown): error is OrderHttpError {
  if (!(error instanceof OrderHttpError) || error.status !== 400) return false;
  const e = error.body?.error;
  return !error.body?.order_id && !error.body?.order?.order_id && e?.code === 'invalid_order' &&
    typeof e.details === 'string' && e.details.trim().toLowerCase() === 'post only cross';
}
export interface Policy {
  version: string; mode: Mode; minOdds: number; feeReserve: number;
  slippage: number; makerImprovement: number; makerWaitMs: number;
  makerEnabled: boolean; maxEntryAgeMs: number; quoteMaxAgeMs: number;
  pollMs: number;
  // V1.2 requires an explicit route; these copies are not wired to a receiver.
  executionRoute?: 'maker_only' | 'taker_only' | 'maker_then_taker';
  // Distinct from feeReserve: the maker leg's assumed zero fee must never be
  // applied to an IOC taker order, which always reserves the taker allowance.
  makerFeeReserve?: number;
  admissionFeeReserve?: number;
  valueLimit?: number;
  knownAsk?: number;
  // Settle-bets selects its safe cancellation/reconciliation branch on version==='entry-controls-r1';
  // the V1.2 route overlay is carried separately here.
  strategyVersion?: string;
}
export function kindFeeReserve(p: Policy, kind: 'maker' | 'taker') {
  return kind === 'maker' ? (p.makerFeeReserve ?? p.feeReserve) : p.feeReserve;
}
export function reservedOrderCost(count: number, limit: number, reserve: number) {
  return count * limit + Math.ceil(count * reserve * 100 - 1e-9) / 100;
}

export function policyFromEnv(get: (name: string) => string | undefined): Policy {
  const num = (key: string, fallback: number) => {
    const text = get(key); const value = text === undefined ? fallback : Number(text);
    if (!Number.isFinite(value)) throw new Error(`Invalid ${key}`);
    return value;
  };
  const mode = get('ENTRY_POLICY_MODE') ?? 'disabled';
  if (!['disabled', 'shadow', 'live'].includes(mode)) throw new Error('Invalid ENTRY_POLICY_MODE');
  const p: Policy = {
    version: 'entry-controls-r1', mode: mode as Mode,
    minOdds: num('ENTRY_MIN_ODDS', num('RETRY_MIN_ODDS', 1.5)),
    // A conservative total entry-fee allowance, not a claim about actual fees.
    // Operator must verify it covers the series fee multiplier and rounding.
    feeReserve: num('ENTRY_FEE_RESERVE_PER_CONTRACT', .03),
    slippage: num('ENTRY_MAX_SLIPPAGE_CENTS', 1) / 100,
    makerImprovement: num('ENTRY_MAKER_IMPROVEMENT_CENTS', 1) / 100,
    makerWaitMs: num('ENTRY_MAKER_WAIT_MS', 1500),
    makerEnabled: get('ENTRY_MAKER_ENABLED') === 'true',
    maxEntryAgeMs: num('ENTRY_MAX_AGE_MS', 60000),
    quoteMaxAgeMs: num('ENTRY_QUOTE_MAX_AGE_MS', 1000),
    pollMs: num('ENTRY_BOOK_POLL_MS', 300),
  };
  if (p.minOdds <= 1 || p.feeReserve < 0 || p.feeReserve >= .25 ||
      p.slippage < 0 || p.slippage > .05 || p.makerImprovement < .01 ||
      p.makerImprovement > .10 || p.makerWaitMs < 0 || p.makerWaitMs > 5000 ||
      p.maxEntryAgeMs < 1000 || p.maxEntryAgeMs > 120000 ||
      p.quoteMaxAgeMs < 100 || p.quoteMaxAgeMs > 5000 || p.pollMs < 200)
    throw new Error('Entry policy outside supported bounds');
  return p;
}

export interface Quote {
  bid: number; ask: number; askSize: number; observedAt: number;
  requestStartedAt: number; source: string;
}
export function readBook(raw: any, side: Side, started: number, received: number): Quote {
  const book = raw?.orderbook_fp;
  if (!book) throw new Error('ORDERBOOK_SCHEMA_UNAVAILABLE');
  const levels = (key: string): number[][] => {
    const data = book[key];
    if (!Array.isArray(data)) throw new Error('ORDERBOOK_SCHEMA_UNAVAILABLE');
    return data.map((x: any) => [Number(x[0]), Number(x[1])])
      .filter(x => x.every(Number.isFinite) && x[0] > 0 && x[0] < 1 && x[1] > 0)
      .sort((a, b) => b[0] - a[0]);
  };
  const same = levels(side === 'yes' ? 'yes_dollars' : 'no_dollars');
  const other = levels(side === 'yes' ? 'no_dollars' : 'yes_dollars');
  if (!same.length || !other.length) throw new Error('EMPTY_ORDERBOOK');
  const q = { bid: same[0][0], ask: Number((1 - other[0][0]).toFixed(4)),
    askSize: other[0][1], observedAt: received, requestStartedAt: started,
    source: 'kalshi_direct_orderbook' };
  if (q.bid >= q.ask) throw new Error('CROSSED_OR_LOCKED_ORDERBOOK');
  return q;
}
export function validateMarket(m: any, ticker: string, target: number, now: number) {
  if (!/^KXBTC15M-/.test(ticker) || m?.ticker !== ticker || m.market_type !== 'binary')
    throw new Error('MARKET_IDENTITY_MISMATCH');
  const close = Date.parse(m.close_time); const open = Date.parse(m.open_time);
  if (close !== target + 900000 || !Number.isFinite(open) || open > now || now >= close)
    throw new Error('MARKET_WINDOW_MISMATCH');
  if (!['active', 'open'].includes(m.status)) throw new Error('MARKET_NOT_ACTIVE');
  if (m.result === 'yes' || m.result === 'no') throw new Error('MARKET_ALREADY_RESOLVED');
}
const downCent = (x: number) => Math.floor((x + 1e-10) * 100) / 100;
export function firstCeiling(q: Quote, p: Policy) {
  return downCent(Math.min(.99, 1 / p.minOdds - (p.admissionFeeReserve ?? p.feeReserve), q.ask + p.slippage));
}
export function planOrder(q: Quote, p: Policy, kind: 'maker' | 'taker', budget: number,
                          ceiling: number, remaining: number, now: number) {
  if (now < q.observedAt || now - q.requestStartedAt > p.quoteMaxAgeMs)
    throw new Error('STALE_ORDERBOOK');
  if (p.valueLimit !== undefined) {
    if (!Number.isFinite(p.valueLimit) || !Number.isFinite(p.knownAsk)) throw new Error('INVALID_U_VALUE_LIMIT');
    const conservative = Math.max(p.knownAsk!, q.ask) + .01;
    if (conservative >= 1 || conservative + .07 * conservative * (1-conservative) > p.valueLimit + 1e-12) return null;
  }
  const reserve = kindFeeReserve(p, kind);
  const limit = downCent(Math.min(ceiling, kind === 'maker' ? q.ask - p.makerImprovement : q.ask + p.slippage));
  if (limit < .01 || (kind === 'taker' && q.ask > limit + 1e-9)) return null;
  // Count at worst authorized price plus this kind's fees; never round up beyond budget.
  let low=0, high=Math.floor(Math.min(remaining, budget/limit,
    kind === 'taker' ? q.askSize : Infinity) * 100 + 1e-8);
  while(low<high){
    const mid=Math.ceil((low+high)/2);
    if(reservedOrderCost(mid/100,limit,reserve)<=budget+1e-9)low=mid;else high=mid-1;
  }
  const count=low/100, maxCost=reservedOrderCost(count,limit,reserve);
  if (count < .01 || maxCost/count > 1 / p.minOdds + 1e-9) return null;
  return { kind, limit, count, maxCost,
    minimumOdds: count/maxCost, feeReserve: reserve, quote: q };
}

export function orderBody(ticker: string, side: Side, plan: NonNullable<ReturnType<typeof planOrder>>,
                          clientId: string, now: number, p: Policy, entryDeadline = Infinity) {
  return { ticker, client_order_id: clientId, side: side === 'yes' ? 'bid' : 'ask',
    count: plan.count.toFixed(2), price: (side === 'yes' ? plan.limit : 1 - plan.limit).toFixed(4),
    time_in_force: plan.kind === 'maker' ? 'good_till_canceled' : 'immediate_or_cancel',
    post_only: plan.kind === 'maker', self_trade_prevention_type: 'taker_at_cross',
    cancel_order_on_pause: true,
    ...(plan.kind === 'maker' ? {expiration_time: Math.min(Math.ceil((now + p.makerWaitMs) / 1000), Math.floor(entryDeadline / 1000))} : {}) };
}

export function orderState(raw: any, requested: number) {
  const o = raw?.order ?? raw;
  const fill = Number(o?.fill_count_fp ?? o?.fill_count);
  const remaining = Number(o?.remaining_count_fp ?? o?.remaining_count);
  if (!Number.isFinite(fill) || fill < 0 || fill > requested + 1e-6 ||
      !Number.isFinite(remaining) || remaining < 0) throw new Error('INVALID_ORDER_STATE');
  const terminal = ['executed', 'canceled', 'cancelled'].includes(o.status) && remaining === 0;
  const keys = ['maker_fill_cost_dollars', 'taker_fill_cost_dollars', 'maker_fees_dollars', 'taker_fees_dollars'];
  const hasCost = keys.every(k => o[k] !== undefined && Number.isFinite(Number(o[k])) && Number(o[k]) >= 0);
  return { fill, remaining, terminal, status: o.status,
    actualCost: hasCost ? keys.reduce((sum, k) => sum + Number(o[k]), 0) : null,
    fees: hasCost ? Number(o.maker_fees_dollars) + Number(o.taker_fees_dollars) : null };
}
