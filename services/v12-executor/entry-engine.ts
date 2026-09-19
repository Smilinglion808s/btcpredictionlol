import {firstCeiling, oddsCeiling, planOrder, orderBody, orderState, isPostOnlyCrossRejection, kindFeeReserve, reservedOrderCost} from './entry-policy.ts';
import type {Policy, Quote, Side} from './entry-policy.ts';

export interface Deps {
  now(): number; sleep(ms: number): Promise<void>; id(): string;
  claim(): Promise<string | null>; preflight(): Promise<{paused: boolean; stopped: boolean; budget: number}>;
  ready(): Promise<Quote>; quote(): Promise<Quote>;
  save(id: string, patch: any): Promise<void>;
  beforeSubmit?(): Promise<void>;
  submit(body: any): Promise<any>; read(id: string, signal?: AbortSignal): Promise<any>;
  cancel(id: string, signal?: AbortSignal): Promise<any>;
  log(value: any): void;
}
export async function executeEntry(d: Deps, p: Policy, input: {ticker: string; side: Side; target: number; received: number}) {
  const trace: any = {policy: p, revision: 'maker-then-taker-r1', target: input.target, received_at: input.received,
    status: 'STARTING', events: []};
  const attempts: any[] = []; let row: string | null = null; let submitted = false;
  let writeReserveMs = 100;
  let totalFill = 0, spent = 0, fees = 0, actualKnown = true;
  const event = (type: string, data: any = {}) => trace.events.push({type, at: d.now(), ...data});
  const save = async (patch: any = {}) => {
    if (row) {
      const started = d.now();
      await d.save(row, {execution_trace: structuredClone(trace),
        order_attempts: structuredClone(attempts), ...patch});
      event('durable_save_complete', {elapsed_ms:d.now()-started, attempts:attempts.length});
    }
  };
  const allowed = () => {
    if (d.now() < input.target || d.now() - input.target > p.maxEntryAgeMs)
      throw new Error('ENTRY_DEADLINE');
  };
  const readyTask = async () => { const q = await d.ready(); event('market_ready', {quote: q}); return q; };
  if (p.mode === 'disabled') { trace.status = 'DISABLED'; d.log(trace); return trace; }
  if (!['maker_only','taker_only','maker_then_taker'].includes(p.executionRoute ?? '')) throw new Error('V12_EXECUTION_ROUTE_REQUIRED');
  const ready = readyTask(); ready.catch(() => {});
  try {
    const preflight = d.preflight(); preflight.catch(() => {});
    if (p.mode === 'live') {
      const started = d.now();
      row = await d.claim();
      trace.bet_id = row;
      const elapsed = d.now()-started;
      // This request's observed database round trip is a planning estimate,
      // never permission to use an old quote. The post-save hard check remains.
      writeReserveMs = Math.max(100, Math.min(p.quoteMaxAgeMs, elapsed+50));
      event('claim_complete', {claimed: !!row, elapsed_ms:elapsed, write_reserve_ms:writeReserveMs});
      // The essential duplicate guard: no order is reachable after a lost claim.
      if (!row) { trace.status = 'CLAIM_REJECTED'; d.log(trace); return trace; }
    }
    const checks = await preflight; event('preflight_complete', checks);
    if (checks.paused || checks.stopped || !Number.isFinite(checks.budget) || checks.budget <= 0) {
      trace.status = 'PREFLIGHT_BLOCKED'; await save({result: 'cancelled'}); d.log(trace); return trace;
    }
    let q = await ready; allowed();
    if (d.now() - q.requestStartedAt > p.quoteMaxAgeMs) q = await d.quote();
    const initialCeiling = firstCeiling(q, p);
    const kinds: ('maker' | 'taker')[] = p.executionRoute === 'taker_only' ? ['taker'] :
      p.executionRoute === 'maker_then_taker' ? ['maker', 'taker'] : ['maker'];
    // Sizing uses the FIRST leg's own reserve so maker quantities are unchanged
    // by the existence of a fallback; the IOC leg re-plans against the budget
    // actually left over, with the taker reserve applied.
    const desired = Math.floor(checks.budget / (initialCeiling + kindFeeReserve(p, kinds[0])));
    trace.initial_ceiling = initialCeiling; trace.budget = checks.budget; trace.desired_count = desired;
    let remaining = desired; let budget = checks.budget;
    if (p.mode === 'shadow') {
      trace.status = 'SHADOW_PLAN'; trace.plans = kinds.map(k => planOrder(q, p, k, budget, initialCeiling, remaining, d.now()));
      d.log(trace); return trace; // No claims, ledger updates, order POSTs or cancels.
    }
    for (const kind of kinds) {
      allowed();
      if (attempts.length) {
        const again = await d.preflight();
        if (again.paused || again.stopped) {event('fallback_preflight_blocked'); break;}
        // The fallback can never exceed what a fresh preflight still allows.
        const capped = Math.max(0, Math.min(budget, again.budget));
        event('fallback_budget_refreshed', {previous_budget: budget, preflight_budget: again.budget, budget: capped});
        budget = capped;
        if (!Number.isFinite(budget) || budget <= 0) {event('fallback_budget_exhausted'); break;}
        q = await d.quote();
      }
      // This point is reachable only after the prior maker is terminal/accounted
      // or explicitly rejected. Reprice from the fresh book, retaining the odds,
      // fee, quantity and remaining-cash bounds. U retains its original ceiling.
      const reprice = kind==='taker' && attempts.length>0 && p.repriceTakerFallback===true && p.valueLimit===undefined;
      const ceiling = reprice ? oddsCeiling(p) : initialCeiling;
      if(reprice) event('fallback_price_refreshed', {initial_ceiling:initialCeiling, price_ceiling:ceiling,
        quote:q, minimum_odds:p.minOdds, remaining_budget:budget, remaining_count:remaining});
      let plan = planOrder(q, p, kind, budget, ceiling, remaining, d.now());
      // Never submitted means never rejected: a price or size abstention on the
      // maker leg ends the attempt instead of promoting it to a taker.
      if (!plan) { event('price_or_size_abstention', {kind, quote: q, price_ceiling:ceiling,
        minimum_odds:p.minOdds, available_odds_before_fees:1/q.ask,
        fee_reserve_per_contract:kindFeeReserve(p,kind), remaining_budget:budget, remaining_count:remaining}); break; }

      // A quote collected in parallel with the claim can already be old enough
      // that saving an intent will expire it. Refresh BEFORE that first save,
      // retaining the original ceiling and never increasing the planned count.
      // One refresh only; unexpectedly slow writes still use the existing
      // refresh-after-save path and the same hard quote-age/deadline checks.
      if (!attempts.length && d.now()-q.requestStartedAt+writeReserveMs > p.quoteMaxAgeMs) {
        event('refresh_before_intent', {quote_age_ms:d.now()-q.requestStartedAt,
          write_reserve_ms:writeReserveMs});
        q = await d.quote(); allowed();
        const fresh = planOrder(q, p, kind, budget, ceiling, Math.min(remaining, plan.count), d.now());
        if (!fresh) {event('pre_intent_price_or_size_abstention', {kind, quote:q}); break;}
        plan = fresh;
      }
      const clientId = d.id();
      const a: any = {kind, client_order_id: clientId, plan, state: 'INTENT', created_at: d.now()};
      attempts.push(a); event('order_intent', {kind, client_order_id: clientId});
      await save({market: input.ticker, bet_size: checks.budget}); // durable before touching exchange
      allowed();
      if (d.now() - q.requestStartedAt > p.quoteMaxAgeMs) {
        // One refresh/replan/save only: do not chase prices or loop on slow storage.
        event('stale_after_save', {refresh_attempt: 1});
        q = await d.quote(); allowed();
        const refreshed = planOrder(q, p, kind, budget, ceiling, Math.min(remaining, plan.count), d.now());
        if (!refreshed) {
          a.state = 'NOT_SUBMITTED_PRICE_OR_SIZE';
          event('refresh_price_or_size_abstention', {kind, quote: q}); await save(); break;
        }
        plan = refreshed; a.plan = plan; a.replanned_at = d.now();
        event('intent_refreshed', {kind, quote: q, limit: plan.limit, count: plan.count});
        await save(); allowed(); // exact revised price/quantity must be durable before POST
        if (d.now() - q.requestStartedAt > p.quoteMaxAgeMs) {
          a.state = 'NOT_SUBMITTED_STALE'; event('refresh_stale_after_save'); await save(); break;
        }
      }
      if (d.beforeSubmit) await d.beforeSubmit();
      allowed();
      // Storage/gate round trips can age a quote. One bounded refresh here,
      // after the authorization read, retains the original price/cash caps.
      if (d.now() - q.requestStartedAt > p.quoteMaxAgeMs) {
        event('refresh_after_gate');
        q = await d.quote(); allowed();
        const fresh = planOrder(q, p, kind, budget, ceiling, Math.min(remaining, plan.count), d.now());
        if (!fresh) {
          a.state = 'NOT_SUBMITTED_PRICE_OR_SIZE';
          event('post_gate_price_or_size_abstention', {kind, quote:q}); await save(); break;
        }
        const changed = fresh.limit !== plan.limit || fresh.count !== plan.count;
        plan = fresh;
        // An unchanged durable limit/quantity needs no new blocking write.
        if (changed) { a.plan=plan; a.replanned_at=d.now(); await save(); allowed(); }
      }
      if (d.now() - q.requestStartedAt > p.quoteMaxAgeMs) throw new Error('PRE_SUBMIT_EXPIRED');
      a.submit_started_at = d.now(); const previouslySubmitted: boolean = submitted; submitted = true;
      let raw: any;
      try {
        raw = await d.submit(orderBody(input.ticker, input.side, plan, clientId, d.now(), p, input.target + p.maxEntryAgeMs));
      } catch (error) {
        a.response_received_at = d.now();
        // ONLY this observed, structured maker-only rejection proves non-acceptance.
        // Timeouts, 5xx, other 400s and missing success IDs remain ambiguous.
        if (kind !== 'maker' || !isPostOnlyCrossRejection(error)) throw error;
        submitted = previouslySubmitted;
        a.state = 'REJECTED';
        a.rejection = {http_status: error.status, code: error.body.error.code, details: error.body.error.details};
        event('order_rejected', {kind, ...a.rejection, elapsed_ms: a.response_received_at - a.submit_started_at});
        await save(); // durable rejection before considering the existing capped taker alternative
        continue;
      }
      const order = raw?.order ?? raw;
      a.response_received_at = d.now(); a.order_id = order?.order_id;
      if (!a.order_id) throw new Error('ORDER_RESPONSE_MISSING_ID');
      a.state = 'ACCEPTED'; event('order_response', {kind, order_id: a.order_id, elapsed_ms: a.response_received_at - a.submit_started_at});
      await save({order_id: a.order_id,
        ...(kind === 'maker' ? {maker_order_id: a.order_id} : {}),
        placed_at: new Date(a.response_received_at).toISOString(),
        seconds_after_open: Math.round((a.response_received_at - input.target) / 1000)});
      if (kind === 'maker') await d.sleep(Math.max(0, a.submit_started_at + p.makerWaitMs - d.now()));
      let rawState: any;
      // Venue reads can briefly return 404 after a successful POST. Retry GET
      // only, bounded to three reads. Never interpret 404 as no fill.
      for (let check=0; check<3; check++) {
        try { rawState=await d.read(a.order_id); break; }
        catch (e) {
          if ((e as any)?.status!==404 || check===2) throw e;
          event('order_read_visibility_retry', {order_id:a.order_id,check:check+1});
          await d.sleep(150*(check+1));
        }
      }
      let state = orderState(rawState, plan.count);
      if (!state.terminal) {
        a.observation = state;
        const cancelStarted = d.now();
        const confirmationDeadline = Math.min(cancelStarted + 2000, input.target + p.maxEntryAgeMs);
        let confirmationBlocked = false; let cancelNotFound = false;
        event('cancel_requested', {order_id: a.order_id, status:state.status, fill:state.fill,
          remaining:state.remaining, confirmation_deadline:confirmationDeadline});
        try {
          // Keep cleanup possible even if the entry deadline was reached while
          // reading the order. Cleanup never authorizes a later replacement.
          const timeout = confirmationDeadline > d.now() ? confirmationDeadline - d.now() : 2000;
          const rawCancel = await d.cancel(a.order_id, AbortSignal.timeout(Math.ceil(timeout)));
          const cancel = rawCancel?.order ?? rawCancel;
          event('cancel_response', {order_id:a.order_id, elapsed_ms:d.now()-cancelStarted,
            response_order_id:cancel?.order_id ?? null, reduced_by:cancel?.reduced_by ?? null,
            venue_ts_ms:cancel?.ts_ms ?? null});
        } catch (e) {
          const httpStatus = (e as any)?.status;
          confirmationBlocked = httpStatus === 418 || httpStatus === 429;
          // 404 on the documented cancel path is NOT proof of cancellation: the
          // order may simply have auto-expired first. It only becomes a resolved
          // expiry race once an authoritative GET reports a terminal state.
          cancelNotFound = httpStatus === 404;
          event('cancel_error', {order_id:a.order_id, elapsed_ms:d.now()-cancelStarted,
            http_status:httpStatus ?? null, error:String(e)});
        }

        // A cancel ACK is not a terminal state. Allow propagation before the
        // existing capped fallback; never POST a replacement on uncertain state.
        // Budget includes cancel HTTP time; at most 8 GETs, spaced 250ms apart.
        for (let check = 1; !confirmationBlocked && check <= 8 && d.now() < confirmationDeadline; check++) {
          const checkStarted = d.now();
          try {
            const signal = AbortSignal.timeout(Math.max(1, Math.ceil(confirmationDeadline - checkStarted)));
            state = orderState(await d.read(a.order_id, signal), plan.count);
            a.observation = state;
            event('cancel_confirmation', {order_id:a.order_id, check,
              request_started_at:checkStarted, elapsed_ms:d.now()-checkStarted,
              status:state.status, fill:state.fill, remaining:state.remaining, terminal:state.terminal});
            if (state.terminal) break;
          } catch (e) {
            const httpStatus = (e as any)?.status;
            event('cancel_confirmation_error', {order_id:a.order_id, check,
              request_started_at:checkStarted, elapsed_ms:d.now()-checkStarted,
              http_status:httpStatus ?? null, error:String(e)});
            if ((httpStatus >= 400 && httpStatus < 500) ||
                ['AbortError','TimeoutError'].includes((e as any)?.name)) break;
          }
          const left = confirmationDeadline - d.now();
          if (check < 8 && left > 0) await d.sleep(Math.min(250, left));
        }
        if (cancelNotFound) {
          a.cancel_classification = state.terminal
            ? (['canceled','cancelled','expired'].includes(String(state.status)) ? 'CANCEL_404_EXPIRY_RACE_RESOLVED'
              : 'CANCEL_404_RESOLVED_' + String(state.status).toUpperCase())
            : 'CANCEL_404_UNRESOLVED';
          event('cancel_404_classified', {order_id:a.order_id, classification:a.cancel_classification,
            status:state.status ?? null, terminal:state.terminal});
        }
        if (!state.terminal) event('cancel_confirmation_unresolved', {order_id:a.order_id,
          elapsed_ms:d.now()-cancelStarted, deadline_reached:d.now() >= confirmationDeadline});
      }

      if (!state.terminal) { a.state = 'UNRESOLVED'; a.observation = state; throw new Error('ORDER_NOT_TERMINAL'); }
      a.state = 'TERMINAL'; a.observation = state; a.reconciled_at = d.now();
      totalFill += state.fill; remaining = Math.max(0, desired - totalFill);
      // Missing venue cost figures are charged at this leg's own reserved price,
      // never treated as free, so the fallback can only spend what is left.
      const reservedCost = reservedOrderCost(state.fill,plan.limit,plan.feeReserve ?? kindFeeReserve(p, kind));
      if (state.actualCost !== null && state.actualCost > reservedCost + .0001)
        throw new Error('FEE_OR_PRICE_RESERVE_EXCEEDED');
      const cost = state.actualCost ?? reservedCost;
      actualKnown = actualKnown && state.actualCost !== null;
      spent += cost; fees += state.fees ?? 0; budget = Math.max(0, checks.budget - spent);
      a.accounted = true;

      event('order_terminal', {kind, ...state, remaining, remaining_budget: budget});
      await save({contracts: totalFill,
        ...(actualKnown ? {total_cost: Number(spent.toFixed(2)), fee: Number(fees.toFixed(4)),
          fill_price: totalFill ? Number((spent / totalFill).toFixed(4)) : 0,
          odds: spent ? Number((totalFill / spent).toFixed(2)) : 0} : {}),
        ...(totalFill ? {filled_at: new Date(d.now()).toISOString(), fill_confirmed_by: 'poll'} : {})});
      if (remaining < .01) break;
      if (d.now() >= input.target + p.maxEntryAgeMs) {event('fallback_deadline_reached'); break;}
    }
    trace.status = totalFill > 0 ? 'FILLED' : attempts.some(a => a.order_id) ? 'NO_FILL' :
      attempts.some(a => a.state === 'REJECTED') ? 'REJECTED_NO_FILL' :
      attempts.some(a => String(a.state).startsWith('NOT_SUBMITTED')) ? 'NOT_SUBMITTED' : 'NO_FILL';
    trace.filled_count = totalFill; trace.cost_is_actual = actualKnown;
    trace.cost_or_reserved_cost = spent;
    await save({result: totalFill > 0 ? 'pending' : 'cancelled'});
  } catch (e) {
    // A previously submitted maker that is now terminal does not make an
    // unsubmitted fallback ambiguous. Preserve genuine lost POST responses.
    for (const a of attempts) if (a.state==='INTENT' && !a.submit_started_at && !a.order_id) a.state='NOT_SUBMITTED_ERROR';
    const unresolved = attempts.some(a => a.submit_started_at && !(a.state==='REJECTED' || (a.state==='TERMINAL' && a.accounted===true)));
    trace.status = unresolved ? 'RECONCILIATION_REQUIRED' : totalFill>0 ? 'FILLED' : attempts.some(a=>a.order_id) ? 'NO_FILL' : 'NOT_SUBMITTED';
    trace.filled_count=totalFill; trace.cost_is_actual=actualKnown; trace.cost_or_reserved_cost=spent;
    event('error', {message: String(e)});
    try { await save(unresolved ? {} : {result: totalFill>0 ? 'pending' : 'cancelled'}); } catch (saveError) {event('save_error', {message: String(saveError)});}
  }
  d.log(trace); return trace;
}
