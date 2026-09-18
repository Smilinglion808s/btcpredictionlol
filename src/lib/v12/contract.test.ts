import test from 'node:test';
import assert from 'node:assert/strict';
import {budgetCents, boiseDay, intervalKey, uEligible, validateSignal, normalizeExecutionPolicy, V12_VERSION, ROUTES} from './contract.ts';
test('maker-first routes fall back to a taker; T45R2 stays taker only',()=>{
  assert.equal(ROUTES.V1.execution,'maker_then_taker');assert.equal(ROUTES.U.execution,'maker_then_taker');
  assert.equal(ROUTES.T45R2.execution,'taker_only');
});
test('legacy maker_only is a V1/U wire alias only and always normalizes forward',()=>{
  for(const route of ['V1','U'] as const){
    assert.equal(normalizeExecutionPolicy(route,'maker_only'),'maker_then_taker');
    assert.equal(normalizeExecutionPolicy(route,'maker_then_taker'),'maker_then_taker');
    // No arbitrary substitution, in either direction.
    for(const bad of ['taker_only','maker',null,undefined,'',{}])assert.equal(normalizeExecutionPolicy(route,bad),null);
  }
  assert.equal(normalizeExecutionPolicy('T45R2','taker_only'),'taker_only');
  for(const bad of ['maker_only','maker_then_taker'])assert.equal(normalizeExecutionPolicy('T45R2',bad),null);
});

test('route sizing uses one day opening and floors cents',()=>{
  assert.equal(budgetCents(100000,'V1'),4000);assert.equal(budgetCents(100000,'T45R2'),5000);assert.equal(budgetCents(100000,'U'),10000);
  assert.equal(budgetCents(100019,'U'),10001);assert.throws(()=>budgetCents(NaN,'U'));
});
test('Boise dates follow winter and summer offset',()=>{
  assert.equal(boiseDay(new Date('2026-01-02T06:30:00Z')),'2026-01-01');
  assert.equal(boiseDay(new Date('2026-07-02T06:30:00Z')),'2026-07-02');
});
const eligibility={v1:{inputValid:true,reason:'CONFIDENCE_ABSTAIN',ordinaryFloorAllows:true,finalSide:0},t45:{finalized:true,finalSide:0},anyPriorClaim:false};
test('U cannot rescue price rejects, bypass guard, precede fallback or add a second position',()=>{
  const {v1,t45}=eligibility;
  assert(uEligible(v1,t45,false));
  assert(!uEligible({...v1,reason:'PRICE_REJECTED'},t45,false));
  assert(!uEligible({...v1,ordinaryFloorAllows:false},t45,false));
  assert(!uEligible(v1,{...t45,finalized:false},false));
  assert(!uEligible(v1,{...t45,finalSide:1},false));assert(!uEligible(v1,t45,true));
});
test('endpoint route identity, signed freshness and U limits are mandatory',()=>{
  const open='2026-09-17T19:00:00Z',market='KXBTC15M-26SEP171515';
  const p={model_version:ROUTES.U.model,combined_model_version:V12_VERSION,leg:'U',execution_policy:'maker_only',stake_fraction_of_boise_day_opening_principal:.1,
    mode:'shadow',prediction:'YES',market,candle_starts_at:open,decision_at:'2026-09-17T19:02:00Z',sent_at:'2026-09-17T19:02:01Z',checkpoint_seconds:120,
    v11_eligibility:eligibility,limit_all_in:.72,u_source:'R',interval_key:intervalKey(market,open)};
  assert.equal(validateSignal(p,'U',Date.parse(p.sent_at)).route,'U');
  assert.throws(()=>validateSignal(p,'V1',Date.parse(p.sent_at)));
  assert.throws(()=>validateSignal({...p,mode:'live'},'U',Date.parse(p.sent_at)));
  assert.throws(()=>validateSignal(p,'U',Date.parse(p.sent_at)+6000));
});
