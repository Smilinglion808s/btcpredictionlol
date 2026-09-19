/** Frozen V1.2 request. This module cannot place or dispatch an order. */
export const V12_VERSION = 'v12-original-u-4-5-10-r1';
export const ROUTES = {
  V1: { model: 'v12-v1-r1', fraction: 0.04, percent: 4, execution: 'maker_then_taker', endpoint: 'v12-v1' },
  T45R2: { model: 'v12-t45r2-r1', fraction: 0.05, percent: 5, execution: 'maker_then_taker', endpoint: 'v12-t45r2' },
  U: { model: 'v12-original-u-r1', fraction: 0.10, percent: 10, execution: 'maker_then_taker', endpoint: 'v12-u' },
} as const;
export type Route = keyof typeof ROUTES;
/**
 * Legacy sender values normalize to the receiver-owned execution policy.
 * V1/U accept maker_only; T45R2 accepts its former taker_only wire value.
 * Unknown substitutions remain a ROUTE_POLICY_MISMATCH.
 */
export const LEGACY_EXECUTION_ALIASES: Record<Route, readonly string[]> = {
  V1: ['maker_only'], T45R2: ['taker_only'], U: ['maker_only'],
};
export function normalizeExecutionPolicy(route: Route, value: unknown): 'maker_only' | 'taker_only' | 'maker_then_taker' | null {
  const locked = ROUTES[route]?.execution;
  if (!locked) return null;
  if (value === locked) return locked;
  return typeof value === 'string' && LEGACY_EXECUTION_ALIASES[route].includes(value) ? locked : null;
}

export const U_CHECKPOINTS = [120, 180, 300, 480, 600, 720] as const;
export function boiseDay(now: Date): string {
  if (!Number.isFinite(now.getTime())) throw new Error('INVALID_TIME');
  const parts = new Intl.DateTimeFormat('en-US', { timeZone: 'America/Boise', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const get = (key: string) => parts.find(p => p.type === key)!.value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
export function budgetCents(openingCents: number, route: Route): number {
  if (!Number.isSafeInteger(openingCents) || openingCents < 0) throw new Error('INVALID_DAY_OPENING');
  return Number(BigInt(openingCents) * BigInt(ROUTES[route].percent) / 100n);
}
/** Route-independent key: separate identities never authorize duplicate exposure. */
export function intervalKey(ticker: string, open: string): string {
  const n = Date.parse(open);
  if (!/^KXBTC15M-[A-Z0-9-]+$/.test(ticker) || !Number.isFinite(n) || n % 900000 !== 0) throw new Error('INVALID_MARKET_INTERVAL');
  return `v12:${ticker}:${new Date(n).toISOString()}`;
}
export function uEligible(v1: { inputValid: boolean; reason: string; ordinaryFloorAllows: boolean; finalSide: number },
                          t45: { finalized: boolean; finalSide: number }, anyPriorClaim: boolean): boolean {
  return v1.inputValid === true && v1.reason === 'CONFIDENCE_ABSTAIN' && v1.ordinaryFloorAllows === true &&
    v1.finalSide === 0 && t45.finalized === true && t45.finalSide === 0 && !anyPriorClaim;
}
export function validateSignal(p: Record<string, any>, route: Route, nowMs: number) {
  const r = ROUTES[route];
  const execution = normalizeExecutionPolicy(route, p.execution_policy);
  if (p.model_version !== r.model || p.combined_model_version !== V12_VERSION || p.leg !== route ||
      execution === null || p.stake_fraction_of_boise_day_opening_principal !== r.fraction)
    throw new Error('ROUTE_POLICY_MISMATCH');

  if (p.mode !== 'shadow' || !['YES', 'NO'].includes(p.prediction)) throw new Error('INVALID_SHADOW_SIGNAL');
  const open = Date.parse(p.candle_starts_at), decision = Date.parse(p.decision_at), sent = Date.parse(p.sent_at);
  if (![open, decision, sent, nowMs].every(Number.isFinite) || decision < open || sent < decision || sent > nowMs + 1000 ||
      nowMs - sent > 5000 || nowMs - decision > 10000 || nowMs >= open + 900000) throw new Error('STALE_SIGNAL');
  if (route === 'U') {
    if (!U_CHECKPOINTS.includes(p.checkpoint_seconds) || decision < open + p.checkpoint_seconds * 1000 ||
        decision > open + p.checkpoint_seconds * 1000 + 5000) throw new Error('U_CHECKPOINT_MISMATCH');
    if (!p.v11_eligibility || !uEligible(p.v11_eligibility.v1, p.v11_eligibility.t45, p.v11_eligibility.anyPriorClaim))
      throw new Error('U_NOT_ELIGIBLE');
    if (!Number.isFinite(p.limit_all_in) || p.limit_all_in <= 0 || p.limit_all_in >= 1 || !['L','R'].includes(p.u_source))
      throw new Error('U_LIMIT_MISSING');
  } else if (decision - open > 60000 || (route === 'T45R2' && decision - open < 45000)) {
    throw new Error('EARLY_ROUTE_WINDOW');
  }
  const key = intervalKey(p.market, p.candle_starts_at);
  if (p.interval_key !== key) throw new Error('INTERVAL_KEY_MISMATCH');
  // `execution` is the effective, normalized policy. Callers must use it and
  // never the wire value, so a legacy alias can never widen what is executed.
  return { key, route, policy: r, execution, legacyExecutionAlias: p.execution_policy !== execution,
    day: boiseDay(new Date(nowMs)) };

}
