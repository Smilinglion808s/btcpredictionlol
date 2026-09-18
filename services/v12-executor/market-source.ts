import {readBook, validateMarket} from './entry-policy.ts';
import type {Policy, Quote, Side} from './entry-policy.ts';
export function marketSource(get: (path: string) => Promise<any>, now: () => number,
                             sleep: (ms: number) => Promise<void>, ticker: string,
                             target: number, side: Side, p: Policy,
                             log: (event: any) => void) {
  const quote = async (): Promise<Quote> => {
    const started = now();
    const raw = await get(`/trade-api/v2/markets/${encodeURIComponent(ticker)}/orderbook`);
    return readBook(raw, side, started, now());
  };
  const ready = async (): Promise<Quote> => {
    let lastError = 'NO_MARKET'; let polls = 0;
    while (now() - target <= p.maxEntryAgeMs) {
      polls++; const started = now();
      try {
        // Direct metadata and executable book requested together. No waiting for
        // /markets list replicas to publish a non-placeholder quote.
        const [meta, q] = await Promise.all([
          get(`/trade-api/v2/markets/${encodeURIComponent(ticker)}`), quote()]);
        validateMarket(meta?.market ?? meta, ticker, target, now());
        if (now() - q.requestStartedAt > p.quoteMaxAgeMs) throw new Error('STALE_ORDERBOOK');
        log({type: 'market_source_ready', polls, at: now(), elapsed_ms: now() - started});
        return q;
      } catch (e) {
        lastError = String(e);
        // The transport respects rate limits; never retry through a ban/cooldown.
        if ((e as any)?.retryAfterMs || /IDENTITY_MISMATCH|WINDOW_MISMATCH|ALREADY_RESOLVED/.test(lastError)) throw e;
        if (polls === 1 || polls % 10 === 0) log({type: 'market_source_wait', polls, at: now(), error: lastError});
        await sleep(p.pollMs);
      }
    }
    throw new Error(`ENTRY_DEADLINE:${lastError}`);
  };
  return {quote, ready};
}
