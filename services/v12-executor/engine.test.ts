import test from 'node:test';
import assert from 'node:assert/strict';
import {executeEntry,type Deps} from './entry-engine.ts';
import {OrderHttpError,type Policy} from './entry-policy.ts';
import {routeBudget,routePolicy} from './route-policy.ts';
import {ROUTES} from '../../src/lib/v12/contract.ts';

const base:Policy={version:'fixture',mode:'live',minOdds:1.5,feeReserve:.03,slippage:.01,makerImprovement:.01,
  makerWaitMs:1500,makerEnabled:true,maxEntryAgeMs:60000,quoteMaxAgeMs:1000,pollMs:300,executionRoute:'maker_only'};
function harness(outcome:'empty'|'partial'|'ambiguous'|'rejected'){
  let clock=1000,quantity=0;const submitted:any[]=[],saved:any[]=[];
  const d:Deps={now:()=>clock,sleep:async(ms)=>{clock+=ms;},id:()=> 'fixture-client-id',claim:async()=> 'fixture-row',
    preflight:async()=>({paused:false,stopped:false,budget:40}),
    ready:async()=>({bid:.54,ask:.56,askSize:1000,observedAt:clock,requestStartedAt:clock,source:'fixture'}),
    quote:async()=>({bid:.54,ask:.56,askSize:1000,observedAt:clock,requestStartedAt:clock,source:'fixture'}),
    save:async(_,p)=>{saved.push(p);},submit:async(body)=>{
      submitted.push(body);quantity=Number(body.count);
      if(outcome==='rejected')throw new OrderHttpError(400,{error:{code:'invalid_order',details:'post only cross'}});
      return {order:{order_id:'fixture-order'}};
    },read:async()=>({order:{status:outcome==='ambiguous'?'resting':'canceled',fill_count_fp:outcome==='partial'?'2.00':'0.00',
      remaining_count_fp:outcome==='ambiguous'?String(quantity):'0.00',maker_fill_cost_dollars:outcome==='partial'?'1.10':'0',
      taker_fill_cost_dollars:'0',maker_fees_dollars:'0',taker_fees_dollars:'0'}}),cancel:async()=>({order:{order_id:'fixture-order'}}),log:()=>{}};
  return {d,submitted,saved};
}
test('unfilled, partially filled and rejected makers never submit a taker',async()=>{
  for(const outcome of ['empty','partial','rejected'] as const){
    const h=harness(outcome),r=await executeEntry(h.d,{...base,feeReserve:0,admissionFeeReserve:.03},{ticker:'FIXTURE',side:'yes',target:0,received:1000});
    assert.equal(h.submitted.length,1);assert.equal(h.submitted[0].post_only,true);
    assert.equal(r.status,outcome==='partial'?'FILLED':outcome==='rejected'?'REJECTED_NO_FILL':'NO_FILL');
  }
});
test('ambiguous cancellation prevents replacement and preserves reconciliation state',async()=>{
  const h=harness('ambiguous'),r=await executeEntry(h.d,base,{ticker:'FIXTURE',side:'yes',target:0,received:1000});
  assert.equal(r.status,'RECONCILIATION_REQUIRED');assert.equal(h.submitted.length,1);
});
test('lost shared interval claim reaches no exchange request',async()=>{
  const h=harness('empty');h.d.claim=async()=>null;
  const r=await executeEntry(h.d,base,{ticker:'FIXTURE',side:'yes',target:0,received:1000});
  assert.equal(r.status,'CLAIM_REJECTED');assert.equal(h.submitted.length,0);
});
test('T45 is IOC only and never attempts maker',async()=>{
  const h=harness('empty');await executeEntry(h.d,{...base,executionRoute:'taker_only',makerEnabled:false},{ticker:'FIXTURE',side:'yes',target:0,received:1000});
  assert.equal(h.submitted.length,1);assert.equal(h.submitted[0].post_only,false);assert.equal(h.submitted[0].time_in_force,'immediate_or_cancel');
});
test('original U value limit is refreshed before submitting an order',async()=>{
  const h=harness('empty');const r=await executeEntry(h.d,{...base,valueLimit:.57,knownAsk:.56},{ticker:'FIXTURE',side:'yes',target:0,received:1000});
  assert.equal(r.status,'NO_FILL');assert.equal(h.submitted.length,0);
});
test('late U timing and Boise-day budget are route-bound',()=>{
  const open=Date.parse('2026-09-17T19:00:00Z'),decision=open+480000;
  const signal={leg:'U',model_version:ROUTES.U.model,execution_policy:'maker_only',candle_starts_at:new Date(open).toISOString(),
    decision_at:new Date(decision).toISOString(),checkpoint_seconds:480,limit_all_in:.8,known_ask:.7};
  // The signal still carries the legacy maker_only wire alias; the effective
  // route must be the normalized maker_then_taker policy.
  const p=routePolicy(base,signal,decision+1000);assert.equal(p.version,'entry-controls-r1');assert.equal(p.strategyVersion,'v12-original-u-4-5-10-r1');assert.equal(p.maxEntryAgeMs,485000);assert.equal(p.executionRoute,'maker_then_taker');

  // feeReserve is the taker reserve used by the IOC fallback; the maker leg and
  // the U admission check keep their own zero-fee reserves.
  assert.equal(p.feeReserve,base.feeReserve);
  const snap={boiseDay:'2026-09-17',openingEquityCents:100000};

  assert.equal(p.makerFeeReserve,0);assert.equal(p.admissionFeeReserve,0);
  assert.equal(routeBudget('V1',snap,decision,100000),40);assert.equal(routeBudget('T45R2',snap,decision,100000),50);assert.equal(routeBudget('U',snap,decision,100000),100);

  assert.throws(()=>routeBudget('U',null,decision,100000));assert.throws(()=>routePolicy(base,signal,decision+10001));
});
