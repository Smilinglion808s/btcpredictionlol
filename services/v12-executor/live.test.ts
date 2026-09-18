import test from 'node:test';
import assert from 'node:assert/strict';
import {executeV12,executionReadiness,dayStart,confidencePercent} from './live.ts';
import {ROUTES,V12_VERSION,intervalKey,type Route} from '../../src/lib/v12/contract.ts';
import {createReceiver} from '../../supabase/functions/v12-shared/receiver.ts';
import {createHmac} from 'node:crypto';

const keys=await crypto.subtle.generateKey({name:'RSA-PSS',modulusLength:2048,publicExponent:new Uint8Array([1,0,1]),hash:'SHA-256'},true,['sign','verify']);
const pem='-----BEGIN PRIVATE KEY-----\n'+Buffer.from(await crypto.subtle.exportKey('pkcs8',keys.privateKey)).toString('base64')+'\n-----END PRIVATE KEY-----';
const env:Record<string,string>={SUPABASE_URL:'https://storage.test',SUPABASE_SERVICE_ROLE_KEY:'test-db-key',KALSHI_KEY_ID:'test-exchange-key',
  KALSHI_PRIVATE_KEY_PEM:pem,ENTRY_MAKER_WAIT_MS:'0',BTC15M_WEBHOOK_SECRET:'test-receiver-key'};
function harness(route:Route,checkpoint=120){
  const open=Date.parse('2026-09-18T01:00:00Z'),offset=route==='V1'?5000:route==='T45R2'?47000:checkpoint*1000;
  let now=open+offset+250;
  const market='KXBTC15M-26SEP172115-15',signal:any={mode:'shadow',leg:route,combined_model_version:V12_VERSION,model_version:ROUTES[route].model,
    execution_policy:ROUTES[route].execution,stake_fraction_of_boise_day_opening_principal:ROUTES[route].fraction,prediction:'YES',
    market,candle_starts_at:new Date(open).toISOString(),decision_at:new Date(open+offset).toISOString(),sent_at:new Date(now).toISOString(),
    interval_key:intervalKey(market,new Date(open).toISOString()),
    ...(route==='U'?{probability:.8798966037814971,checkpoint_seconds:checkpoint,known_ask:.55,arrival_ask:.55,limit_all_in:.8,u_source:'L',
      v11_eligibility:{v1:{inputValid:true,reason:'CONFIDENCE_ABSTAIN',ordinaryFloorAllows:true,finalSide:0},t45:{finalized:true,finalSide:0},anyPriorClaim:false}}:{})};
  const receipt:any={id:'00000000-0000-0000-0000-000000000001',mode:'live',execution_enabled:true,status:'LIVE_ACCEPTED',
    budget_cents:ROUTES[route].percent*1000,boise_day:'2026-09-17',opening_balance:1000};
  const state={mode:'live',activated:new Date(open).toISOString(),paused:false,claim:true,cash:100000,
    releaseReads:0,pauseOnSecondRead:false,postTimeout:false,expiredBeforePost:false};
  const posts:any[]=[],patches:any[]=[],claims:any[]=[],calls:string[]=[];
  const transport:typeof fetch=async(input,init)=>{
    const u=new URL(String(input)),path=u.pathname;calls.push((init?.method||'GET')+' '+path);
    if(path.endsWith('/v12_release_config')){state.releaseReads++;if(state.pauseOnSecondRead&&state.releaseReads>1)state.paused=true;
      if(state.expiredBeforePost&&state.releaseReads>1)now+=2000;
      return Response.json([{mode:state.mode,live_enabled_at:state.activated}]);}
    if(path.endsWith('/bot_config'))return Response.json([{paused:state.paused}]);
    if(path.endsWith('/daily_balance'))return Response.json([{balance_at_midnight:'1000.00'}]);
    if(path.endsWith('/portfolio/balance'))return Response.json({balance:state.cash});
    if(path.endsWith('/rpc/record_v12_signal'))return Response.json(receipt);
    if(path.endsWith('/bet_history')){
      if(init?.method==='POST'){claims.push(JSON.parse(String(init.body)));assert.ok(Number.isInteger(claims.at(-1).confidence));return state.claim?Response.json([{id:'bet-fixture'}]):new Response('',{status:409});}
      if(init?.method==='PATCH'){patches.push(JSON.parse(String(init.body)));return Response.json([{id:'bet-fixture'}]);}
      return Response.json([]);
    }
    if(path.endsWith('/v12_shadow_signals')){patches.push(JSON.parse(String(init?.body)));return Response.json([{id:receipt.id}]);}
    if(path.endsWith('/orderbook'))return Response.json({orderbook_fp:{yes_dollars:[['0.53','1000']],no_dollars:[['0.45','1000']]}});
    if(path.endsWith('/markets/'+market))return Response.json({market:{ticker:market,market_type:'binary',status:'active',open_time:new Date(open).toISOString(),close_time:new Date(open+900000).toISOString()}});
    if(path.endsWith('/portfolio/events/orders')){
      const body=JSON.parse(String(init?.body));posts.push(body);if(state.postTimeout)throw Error('simulated lost order acknowledgement');
      return Response.json({order:{order_id:'order-fixture'}});
    }
    if(path.endsWith('/portfolio/orders/order-fixture')){
      const price=Number(posts[0].price);return Response.json({order:{status:'canceled',fill_count_fp:'2.00',remaining_count_fp:'0.00',
        maker_fill_cost_dollars:route==='T45R2'?'0':String(price*2),taker_fill_cost_dollars:route==='T45R2'?String(price*2):'0',maker_fees_dollars:'0',taker_fees_dollars:'0'}});
    }
    throw Error('Unexpected network '+path);
  };
  return {signal,receipt,state,posts,patches,claims,calls,transport,clock:()=>now};
}
for(const route of ['V1','T45R2','U'] as const){
  test(`${route} signed receiver to durable executor uses its exact route and budget`,async()=>{
    const h=harness(route);let pending:Promise<unknown>|undefined;
    const r=createReceiver(route,k=>env[k],h.transport,h.clock,{execute:executeV12,schedule:task=>{pending=task;}});
    const raw=JSON.stringify(h.signal),sig='sha256='+createHmac('sha256',env.BTC15M_WEBHOOK_SECRET).update(raw).digest('hex');
    const response=await r(new Request('https://receiver.test',{method:'POST',body:raw,headers:{'x-btc15m-signature':sig}}));
    assert.equal(response.status,200);assert.equal((await response.json()).execution_enabled,true);await pending;
    // The fixture fills 2 of the planned count, so a maker-first route submits a
    // capped IOC taker for the remainder; T45R2 stays a single taker order.
    const fallback=ROUTES[route].execution==='maker_then_taker';
    assert.equal(h.posts.length,fallback?2:1);
    assert.equal(h.posts[0].post_only,fallback);
    if(fallback)assert.equal(h.posts[1].post_only,false);
    assert.equal(h.claims.length,1);

    assert.equal(h.claims[0].model_version,ROUTES[route].model);
    assert.equal(h.patches.at(-1).execution_status,'FILLED');
    const intent=h.patches.find(x=>x.order_attempts?.[0]?.state==='INTENT');assert.ok(intent);
    assert.equal(intent.execution_trace.sizing.budget_dollars,ROUTES[route].percent*10);
    assert.ok(h.calls.indexOf('PATCH /rest/v1/bet_history')<h.calls.indexOf('POST /trade-api/v2/portfolio/events/orders'));
  });
}
test('shadow and duplicate receipts never start an executor or account request',async()=>{
  for(const status of ['SHADOW_RECORDED','DUPLICATE','DAY_OPENING_UNAVAILABLE','BEFORE_ACTIVATION']){
    const h=harness('V1');Object.assign(h.receipt,{mode:'shadow',execution_enabled:false,status});
    const r=createReceiver('V1',k=>env[k],h.transport,h.clock,{execute:async()=>{throw Error('executor must not start');}});
    const raw=JSON.stringify(h.signal);const response=await r(new Request('https://receiver.test',{method:'POST',body:raw,
      headers:{'x-btc15m-signature':'sha256='+createHmac('sha256',env.BTC15M_WEBHOOK_SECRET).update(raw).digest('hex')}}));
    assert.equal(response.status,200);assert.equal(h.calls.length,1);assert.equal(h.posts.length,0);
  }
});
test('release off, stale activation, pause, missing cash and lost claim all block order POST',async()=>{
  for(const variant of ['off','stale','pause','cash','claim','pauseDuring']){
    const h=harness('V1');
    if(variant==='off')h.state.mode='shadow';if(variant==='stale')h.state.activated=new Date(h.clock()+1).toISOString();
    if(variant==='pause')h.state.paused=true;if(variant==='cash')h.state.cash=NaN;if(variant==='claim')h.state.claim=false;
    if(variant==='pauseDuring')h.state.pauseOnSecondRead=true;if(variant==='quoteExpires')h.state.expiredBeforePost=true;
    const trace=await executeV12(h.signal,h.receipt,k=>env[k],h.transport,h.clock);
    assert.equal(h.posts.length,0,variant);assert.notEqual(trace.status,'FILLED');assert.notEqual(trace.status,'RECONCILIATION_REQUIRED',variant);
  }
});
test('lost exchange acknowledgement keeps durable intent and never retries',async()=>{
  const h=harness('V1');h.state.postTimeout=true;
  const trace=await executeV12(h.signal,h.receipt,k=>env[k],h.transport,h.clock);
  assert.equal(trace.status,'RECONCILIATION_REQUIRED');assert.equal(h.posts.length,1);
  assert.ok(h.patches.find(p=>p.order_attempts?.[0]?.state==='INTENT'));
});
test('all six U checkpoints reach the late-window executor without the old 60-second cutoff',async()=>{
  for(const checkpoint of [120,180,300,480,600,720]){
    const h=harness('U',checkpoint),r=await executeV12(h.signal,h.receipt,k=>env[k],h.transport,h.clock);
    assert.equal(r.status,'FILLED');
    // Maker first, then the capped IOC remainder for the partially filled plan.
    assert.equal(h.posts.length,2);assert.equal(h.posts[0].post_only,true);assert.equal(h.posts[1].post_only,false);

  }
});
test('readiness proves account authentication using GET only and creates no records',async()=>{
  const h=harness('V1');h.state.mode='shadow';
  const r=await executionReadiness(k=>env[k],h.transport,h.clock);
  assert.equal(r.ready_for_activation,true);assert.ok(h.calls.every(c=>c.startsWith('GET ')));
});
test('Boise midnight uses the correct side of both DST transitions',()=>{
  assert.equal(new Date(dayStart('2026-03-08')).toISOString(),'2026-03-08T07:00:00.000Z');
  assert.equal(new Date(dayStart('2026-11-01')).toISOString(),'2026-11-01T06:00:00.000Z');
  assert.equal(new Date(dayStart('2026-11-02')).toISOString(),'2026-11-02T07:00:00.000Z');
});

test('U probability is stored as integer percentage without changing the signal probability',()=>{
 assert.equal(confidencePercent(.8798966037814971),88); assert.equal(confidencePercent(undefined),0);
 for(const v of [-1,1.2,NaN,'0.88'])assert.throws(()=>confidencePercent(v));
});
test('a quote aged by gate reads refreshes before a bounded POST',async()=>{
 const h=harness('V1'); h.state.expiredBeforePost=true;
 const r=await executeV12(h.signal,h.receipt,k=>env[k],h.transport,h.clock);
 assert.ok(h.posts.length>0); assert.ok(r.events.some((e:any)=>e.type==='refresh_after_gate'));
});
