import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createAdapterHandler,verifyWorkerSignature} from './core.js';
import {createReceiver} from '../v12-shared/receiver.ts';
import {ROUTES,intervalKey,V12_VERSION} from '../../../src/lib/v12/contract.ts';

const open=Date.parse('2026-09-17T20:00:00Z'),ticker='KXBTC15M-26SEP171415-15';
const secret='test-worker-only',receiverSecret='test-receiver-only';
const receiverRoot='https://ruxndqfjfdbtdbkheuge.supabase.co/functions/v1/';
function request(body:any,now:number,overrides:Record<string,string>={}) {
  const raw=typeof body==='string'?body:JSON.stringify(body),timestamp=String(now);
  return new Request('https://example.invalid/adapter',{method:'POST',body:raw,headers:{
    'content-type':'application/json','x-c85-timestamp':timestamp,
    'x-c85-signature':createHmac('sha256',secret).update(timestamp+'.'+raw).digest('hex'),...overrides}});
}
function setup(leg:'V1'|'T45R2'|'U'='V1') {
  const offset=leg==='U'?120000:leg==='T45R2'?45000:5000,now=open+offset+1000;
  let nonceWrites=0,reads=0,writes=0;
  const nonces=new Set(),destinations:string[]=[];
  const eligibility={v1:{inputValid:true,reason:'CONFIDENCE_ABSTAIN',ordinaryFloorAllows:true,finalSide:0},
    t45:{finalized:true,finalSide:0},anyPriorClaim:false};
  const context:any={ready:true,ticker,open:new Date(open).toISOString(),u_eligible:leg==='U',eligibility,
    v1:{final_side:leg==='V1'?1:0,publication_offset_ms:5000,features:{input_valid:true}},
    t45:{side:leg==='T45R2'?1:0,leg:'T45R2',run_mode:'LIVE_SHADOW',decision_offset_ms:45000,evidence:{trigger_signed:true}}};
  const sb={from:(table:string)=>({
    insert:async(row:any)=>{assert.equal(table,'c85_request_nonces');nonceWrites++;
      if(nonces.has(row.nonce))return {error:{code:'23505'}};nonces.add(row.nonce);return {error:null};},
    select:()=>({eq:async()=>{assert.equal(table,'webhook_endpoints');return {data:[{url:receiverRoot+'place-trade',secret:receiverSecret,is_active:true}],error:null};}})
  })};
  const transport=async(url:any,init:any)=>{
    const target=String(url);destinations.push(target);
    const route=Object.keys(ROUTES).find(k=>target===receiverRoot+ROUTES[k as keyof typeof ROUTES].endpoint) as keyof typeof ROUTES;
    assert.ok(route,'outbound destination must be one of three fixed shadow receivers');
    const receiver=createReceiver(route,k=>({BTC15M_WEBHOOK_SECRET:receiverSecret,SUPABASE_URL:'https://database.invalid',SUPABASE_SERVICE_ROLE_KEY:'test-key'}[k]),
      async(u:any)=>{assert.equal(String(u),'https://database.invalid/rest/v1/rpc/record_v12_shadow_signal');writes++;return Response.json({status:'SHADOW_RECORDED',execution_enabled:false});},()=>now);
    return receiver(new Request(target,init));
  };
  const handler=createAdapterHandler({secret:()=>secret,client:()=>sb,clock:()=>now,transport,
    readContext:async()=>{reads++;return context;}});
  const signal:any={mode:'shadow',model_version:ROUTES[leg].model,combined_model_version:V12_VERSION,leg,
    execution_policy:ROUTES[leg].execution,stake_fraction_of_boise_day_opening_principal:ROUTES[leg].fraction,
    market:ticker,candle_starts_at:new Date(open).toISOString(),decision_at:new Date(open+offset).toISOString(),sent_at:new Date(now).toISOString(),
    interval_key:intervalKey(ticker,new Date(open).toISOString()),prediction:'YES',
    ...(leg==='U'?{checkpoint_seconds:120,limit_all_in:.7,u_source:'L',v11_eligibility:eligibility}:{}),};
  const envelope=(op:string,nonce='single-test-nonce')=>({op,open:new Date(open).toISOString(),nonce,signal});
  return {handler,now,context,signal,envelope,transport,destinations,counts:()=>({nonceWrites,reads,writes})};
}

test('unsigned, stale, tampered and unconfigured requests reach no database',async()=>{
  const t=setup(),p=t.envelope('context');
  assert.equal((await t.handler(request(p,t.now,{'x-c85-signature':''}))).status,401);
  assert.equal((await t.handler(request(p,t.now-10001))).status,401);
  assert.equal((await t.handler(request(p,t.now,{'x-c85-signature':'0'.repeat(64)}))).status,401);
  assert.equal(await verifyWorkerSignature('{}',String(t.now),'0'.repeat(64),'',t.now),false);
  assert.deepEqual(t.counts(),{nonceWrites:0,reads:0,writes:0});
});
test('signed context is read only; invalid envelopes and non-current intervals are refused',async()=>{
  const t=setup();assert.equal((await t.handler(request(t.envelope('context'),t.now))).status,200);
  for(const p of ['{',[],{...t.envelope('context'),open:new Date(open-900000).toISOString()},t.envelope('trade')])
    assert.equal((await t.handler(request(p,t.now))).status,400);
  assert.equal((await t.handler(request('a'.repeat(32769),t.now))).status,413);
  assert.deepEqual(t.counts(),{nonceWrites:0,reads:1,writes:0});
});
test('receiver probes authenticate all three destinations without writing fake signals',async()=>{
  const t=setup(),r=await t.handler(request(t.envelope('probe'),t.now)),body=await r.json();
  assert.equal(r.status,200);assert.equal(body.all_authenticated,true);assert.equal(body.records_created,0);
  assert.deepEqual(t.destinations,[receiverRoot+'v12-v1',receiverRoot+'v12-t45r2',receiverRoot+'v12-u']);
  assert.deepEqual(t.counts(),{nonceWrites:1,reads:0,writes:0});
  assert.equal((await t.handler(request(t.envelope('probe'),t.now))).status,409);
});
test('valid route signals use canonical publish and each independent receiver; duplicates stop before delivery',async()=>{
  const originalFetch=globalThis.fetch;
  try {for(const leg of ['V1','T45R2','U'] as const){
    const t=setup(leg);globalThis.fetch=t.transport as typeof fetch;
    const r=await t.handler(request(t.envelope('publish'),t.now)),body=await r.json();
    assert.equal(r.status,200,JSON.stringify(body));assert.equal(body.execution_enabled,false);
    assert.equal(body.status,'SHADOW_RECORDED');assert.equal(t.counts().writes,1);
    assert.deepEqual(t.destinations,[receiverRoot+ROUTES[leg].endpoint]);
    assert.equal((await t.handler(request(t.envelope('publish'),t.now))).status,409);
    assert.equal(t.counts().writes,1);
  }}finally{globalThis.fetch=originalFetch;}
});
test('forged direction, claimed U, stale signal, route substitution and live mode cannot publish',async()=>{
  const mutations=[(t:any)=>t.signal.prediction='NO',(t:any)=>t.context.u_eligible=false,
    (t:any)=>t.signal.sent_at=new Date(t.now-10001).toISOString(),(t:any)=>t.signal.leg='T45R2',
    (t:any)=>t.signal.mode='live',(t:any)=>t.context.eligibility.anyPriorClaim=true];
  for(let i=0;i<mutations.length;i++){
    const t=setup(i===0?'V1':'U');mutations[i](t);
    const response=await t.handler(request(t.envelope('publish'),t.now));
    assert.equal(response.status,400);assert.equal(t.counts().writes,0);assert.equal(t.destinations.length,0);
  }
});
