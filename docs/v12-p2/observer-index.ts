/** Operator-installed outcome observer. This function cannot place orders. */
import {collectP2Outcomes} from '../../services/v12-executor/p2-outcomes.ts';

export function createP2Observer(get: (key: string) => string | undefined,
  transport: typeof fetch = fetch, clock: () => number = Date.now) {
  return async (request: Request) => {
    const respond = (status: number, body: unknown) => new Response(JSON.stringify(body), {
      status, headers: {'content-type': 'application/json'},
    });
    if (request.method !== 'POST') return respond(405, {error: 'POST_REQUIRED'});
    const base = get('SUPABASE_URL'), key = get('SUPABASE_SERVICE_ROLE_KEY');
    if (!base || !key) return respond(503, {error: 'OBSERVER_NOT_CONFIGURED'});
    if (request.headers.get('authorization') !== 'Bearer ' + key) return respond(401, {error: 'UNAUTHORIZED'});
    const db = async (path: string, body?: unknown) => {
      const response = await transport(base + '/rest/v1/' + path, {
        method: body === undefined ? 'GET' : 'POST',
        headers: {apikey: key, authorization: 'Bearer ' + key, 'content-type': 'application/json'},
        ...(body === undefined ? {} : {body: JSON.stringify(body)}),
        signal: AbortSignal.timeout(4000),
      });
      if (!response.ok) throw Error('OUTCOME_DB_HTTP_' + response.status);
      return response.json();
    };
    try {
      const outcome = await collectP2Outcomes({
        now: clock,
        pending: () => db('v12_p2_calls?known_at=is.null&order=candle_starts_at.desc,signal_id.desc&limit=200&select=market,candle_starts_at,received_at'),
        market: async ticker => {
          const response = await transport('https://api.elections.kalshi.com/trade-api/v2/markets/' + encodeURIComponent(ticker), {
            method: 'GET', cache: 'no-store', signal: AbortSignal.timeout(2500),
          });
          if (!response.ok) throw Error('OUTCOME_MARKET_HTTP_' + response.status);
          const body = await response.json();
          return body.market ?? body;
        },
        record: (ticker, result) => db('rpc/record_v12_p2_outcome', {p_market: ticker, p_result: result}),
      });
      return respond(outcome.errors.length ? 503 : 200, outcome);
    } catch (e) {
      return respond(503, {error: e instanceof Error ? e.message : 'OBSERVER_FAILED'});
    }
  };
}

declare const Deno: {env: {get(key: string): string | undefined}; serve(handler: (req: Request) => Promise<Response>): void};
if (typeof Deno !== 'undefined') Deno.serve(createP2Observer(key => Deno.env.get(key)));
