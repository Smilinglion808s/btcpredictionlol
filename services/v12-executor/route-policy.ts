// Prepared executor adapter. Imported only by tests; not deployed or connected.
import {ROUTES,budgetCents,boiseDay,normalizeExecutionPolicy,type Route} from '../../src/lib/v12/contract.ts';
import type {Policy} from './entry-policy.ts';

export function routePolicy(base:Policy,signal:Record<string,any>,nowMs:number):Policy {
  const route=signal.leg as Route, locked=ROUTES[route],open=Date.parse(signal.candle_starts_at),decision=Date.parse(signal.decision_at);
  // Only the locked policy (or its accepted legacy wire alias) is honoured; the
  // executor always runs the normalized value, never the value on the wire.
  const execution=locked?normalizeExecutionPolicy(route,signal.execution_policy):null;
  if(!locked || signal.model_version!==locked.model || execution===null ||
    !Number.isFinite(open) || !Number.isFinite(decision) || decision<open || nowMs<decision || nowMs-decision>10000)
    throw new Error('INVALID_V12_EXECUTION_IDENTITY');
  const maker=execution!=='taker_only';
  if(route==='U'){
    if(![120,180,300,480,600,720].includes(signal.checkpoint_seconds) ||
      decision<open+signal.checkpoint_seconds*1000 || decision>open+signal.checkpoint_seconds*1000+5000 ||
      !Number.isFinite(signal.limit_all_in) || signal.limit_all_in<=0 || signal.limit_all_in>=1 ||
      !Number.isFinite(signal.known_ask) || signal.known_ask<=0 || signal.known_ask>=1)throw new Error('INVALID_U_CHECKPOINT');
  }else if(decision-open>60000 || (route==='T45R2' && decision-open<45000))throw new Error('INVALID_EARLY_WINDOW');
  return {...base,version:'entry-controls-r1',strategyVersion:'v12-original-u-4-5-10-r1',executionRoute:execution,makerEnabled:maker,
    // Maker fees are zero by the requested scenario and stay a distinct reserve.
    // feeReserve is the taker reserve: it sizes the IOC fallback and is never
    // assumed to be free just because the maker leg pays nothing.
    feeReserve:base.feeReserve,makerFeeReserve:0,admissionFeeReserve:route==='U'?0:base.feeReserve,
    minOdds:route==='U'?1/signal.limit_all_in:route==='T45R2'?1.4:1.5,
    maxEntryAgeMs:route==='U'?signal.checkpoint_seconds*1000+5000:60000,
    ...(route==='U'?{valueLimit:signal.limit_all_in,knownAsk:signal.known_ask}:{}),
  };
}


export function routeBudget(route:Route,snapshot:{boiseDay:string;openingEquityCents:number}|null,nowMs:number,availableCashCents:number){
  if(!snapshot || snapshot.boiseDay!==boiseDay(new Date(nowMs)))throw new Error('DAY_OPENING_UNAVAILABLE');
  if(!Number.isSafeInteger(availableCashCents) || availableCashCents<0)throw new Error('INVALID_AVAILABLE_CASH');
  return Math.min(budgetCents(snapshot.openingEquityCents,route),availableCashCents)/100;
}
