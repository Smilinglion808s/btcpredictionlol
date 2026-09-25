// Generated observer. Reads market outcomes; cannot place orders.
/** Separate outcome collection. Dependencies expose no order/cancellation API. */
                                                                                                      
                                     
                
                                               
                                                                                              
                                                                 
  

export async function collectP2Outcomes(deps                       ) {
  const now = deps.now();
  const pending = await deps.pending();
  const markets = [...new Set(pending.filter(row => {
    const open = Date.parse(row.candle_starts_at), received = Date.parse(row.received_at);
    return /^KXBTC15M-[A-Z0-9-]+$/.test(row.market) && Number.isFinite(open) &&
      Number.isFinite(received) && received <= now && open + 900_000 <= now;
  }).map(row => row.market))];
  const result = {checked: 0, resolved: 0, pending: 0, errors: []            };
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

/** Operator-installed outcome observer. This function cannot place orders. */


export function createP2Observer(get                                     ,
  transport               = fetch, clock               = Date.now) {
  return async (request         ) => {
    const respond = (status        , body         ) => new Response(JSON.stringify(body), {
      status, headers: {'content-type': 'application/json'},
    });
    if (request.method !== 'POST') return respond(405, {error: 'POST_REQUIRED'});
    const base = get('SUPABASE_URL'), key = get('SUPABASE_SERVICE_ROLE_KEY');
    if (!base || !key) return respond(503, {error: 'OBSERVER_NOT_CONFIGURED'});
    if (request.headers.get('authorization') !== 'Bearer ' + key) return respond(401, {error: 'UNAUTHORIZED'});
    const db = async (path        , body          ) => {
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

                                                                                                                             
if (typeof Deno !== 'undefined') Deno.serve(createP2Observer(key => Deno.env.get(key)));
