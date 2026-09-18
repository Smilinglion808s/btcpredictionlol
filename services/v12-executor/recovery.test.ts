import test from 'node:test';
import assert from 'node:assert/strict';
import {executeEntry} from './entry-engine.ts';
import {policyFromEnv} from './entry-policy.ts';
import {reconcileEntry} from '../../supabase/functions/settle-bets/entry-reconcile.ts';

async function run(v:string){
 let now=1000,reads=0,gate=0;const posts:any[]=[],saves:any[]=[];
 const quote=()=>({bid:.51,ask:.52,askSize:100,observedAt:now,requestStartedAt:now,source:'test'});
 const p={...policyFromEnv(()=>undefined),mode:'live' as const,executionRoute:'maker_then_taker' as const,makerFeeReserve:0};
 const trace=await executeEntry({now:()=>now,sleep:async n=>{now+=n},id:()=>String(posts.length),claim:async()=> 'bet',
  ready:async()=>quote(),quote:async()=>{if(v==='refreshFails'&&posts.length)throw Error('quote unavailable');return quote()},
  preflight:async()=>({paused:false,stopped:false,budget:5}),save:async(_,patch)=>{saves.push(patch)},
  beforeSubmit:async()=>{gate++;if(v==='fallbackExpired'&&gate===2)throw Error('ENTRY_DEADLINE');if(v==='refreshFails'&&gate===2)now+=1100;},
  submit:async b=>{posts.push(b);return {order:{order_id:'o'+posts.length}}},
  read:async id=>{reads++;if(v==='visibility'&&reads===1)throw Object.assign(Error('not found'),{status:404});
   if(v==='unknown')throw Object.assign(Error('not found'),{status:404});
   const fill=id==='o1'?0:1;return {order:{status:'canceled',fill_count_fp:String(fill),remaining_count_fp:'0',maker_fill_cost_dollars:'0',taker_fill_cost_dollars:String(fill*.53),maker_fees_dollars:'0',taker_fees_dollars:'0'}};},
  cancel:async()=>({}),log:()=>{}
 },p,{ticker:'TEST',side:'yes',target:0,received:1000});return {trace,posts,saves,reads};
}
test('terminal empty maker plus never-submitted fallback is cancelled, not permanently pending',async()=>{
 for(const v of ['fallbackExpired','refreshFails']){const h=await run(v);assert.equal(h.posts.length,1);assert.equal(h.trace.status,'NO_FILL');assert.equal(h.saves.at(-1).result,'cancelled');}
});
test('transient GET 404 retries only reads and a persistent 404 remains unresolved',async()=>{
 const h=await run('visibility');assert.equal(h.trace.status,'FILLED');assert.equal(h.posts.length,2);
 const u=await run('unknown');assert.equal(u.trace.status,'RECONCILIATION_REQUIRED');assert.equal(u.posts.length,1);assert.equal(u.reads,3);
});
const terminal={order:{ticker:'TEST',status:'canceled',fill_count_fp:'0',remaining_count_fp:'0',maker_fill_cost_dollars:'0',taker_fill_cost_dollars:'0',maker_fees_dollars:'0',taker_fees_dollars:'0'}};
test('r2 recorded pre-submit failure can reconcile confirmed cancelled maker; unknown submission cannot',async()=>{
 const bet:any={market:'TEST',order_id:'maker',contracts:0,execution_trace:{execution_revision:'v12-executor-r2',events:[{type:'error',message:'Error: PRE_SUBMIT_EXPIRED'}]},
 order_attempts:[{state:'TERMINAL',order_id:'maker'},{state:'INTENT'}]};
 const r=await reconcileEntry(bet,undefined,async()=>terminal);assert.equal(r.patch?.result,'cancelled');assert.equal(r.patch?.execution_trace.status,'NO_FILL');
 bet.order_attempts[1].submit_started_at=123;const u=await reconcileEntry(bet,undefined,async()=>terminal);assert.equal(u.patch,null);
});
test('plain unknown intent or no IDs never fabricates a cancellation',async()=>{
 for(const attempts of [[],[{state:'INTENT'}]]){const r=await reconcileEntry({order_attempts:attempts},undefined,async()=>terminal);assert.equal(r.patch,null);}
});
test('legacy explicit post-only rejection is a no-fill rather than unknown order',async()=>{
 const r=await reconcileEntry({order_attempts:[{state:'INTENT',submit_started_at:123}],execution_trace:{events:[{type:'error',message:'Error: Kalshi POST failed: 400 {"error":{"code":"invalid_order","details":"post only cross"}}'}]}},undefined,async()=>{throw Error('must not read')});
 assert.equal(r.patch?.result,'cancelled');
});
