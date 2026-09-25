/** Separate outcome collection. Dependencies expose no order/cancellation API. */
export type PendingP2Call = Readonly<{market: string; candle_starts_at: string; received_at: string}>;
export type P2OutcomeDependencies = {
  now(): number;
  pending(): Promise<readonly PendingP2Call[]>;
  market(ticker: string): Promise<{ticker?: unknown; result?: unknown; close_time?: unknown}>;
  record(ticker: string, result: 'yes' | 'no'): Promise<unknown>;
};

export async function collectP2Outcomes(deps: P2OutcomeDependencies) {
  const now = deps.now();
  const pending = await deps.pending();
  const markets = [...new Set(pending.filter(row => {
    const open = Date.parse(row.candle_starts_at), received = Date.parse(row.received_at);
    return /^KXBTC15M-[A-Z0-9-]+$/.test(row.market) && Number.isFinite(open) &&
      Number.isFinite(received) && received <= now && open + 900_000 <= now;
  }).map(row => row.market))];
  const result = {checked: 0, resolved: 0, pending: 0, errors: [] as string[]};
  // Bounded concurrency; this collector never runs in the order submission path.
  for (let offset = 0; offset < markets.length; offset += 4) {
    await Promise.all(markets.slice(offset, offset + 4).map(async ticker => {
      result.checked++;
      try {
        const market = await deps.market(ticker);
        if (market.ticker !== ticker) throw Error('MARKET_ID_MISMATCH');
        if (market.result !== 'yes' && market.result !== 'no') {result.pending++; return;}
        await deps.record(ticker, market.result);
        result.resolved++;
      } catch (e) {
        result.errors.push(ticker + ': ' + (e instanceof Error ? e.message : 'OUTCOME_ERROR'));
      }
    }));
  }
  return result;
}
