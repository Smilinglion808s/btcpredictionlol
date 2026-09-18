import test from 'node:test';
import assert from 'node:assert/strict';
import {executeEntry} from './entry-engine.ts';
import {OrderHttpError,planOrder,reservedOrderCost,type Policy} from './entry-policy.ts';
const policy:Policy={version:'entry-controls-r1',mode:'live',minOdds:1.5,feeReserve:.03,makerFeeReserve:0,
  admissionFeeReserve:.03,slippage:.01,makerImprovement:.01,makerWaitMs:1500,makerEnabled:true,
  maxEntryAgeMs:60000,quoteMaxAgeMs:1000,pollMs:300,executionRoute:'maker_then_taker'};
async function run(variant='empty'){
  let now=1000,checks=0,reads=0;const posts:any[]=[],saved:any[]=[];
  const quote=()=>({bid:.54,ask:variant==='price'&&posts.length?.8:.56,askSize:1000,observedAt:now,requestStartedAt:now,source:'test'});
  const trace=await executeEntry({now:()=>now,sleep:async ms=>{now+=ms},id:()=>`client-${posts.length}`,claim:async()=> 'bet',
    ready:async()=>quote(),quote:async()=>quote(),preflight:async()=>{
      checks++;return {paused:variant==='pause'&&checks>1,stopped:false,budget:checks>1?(variant==='cash'?0:variant==='smallCash'?.5:40):40};},
    save:async(_,p)=>{saved.push(p)},submit:async body=>{
      posts.push(body);if(variant==='timeout')throw Error('lost response');
      if(variant==='rejected'&&body.post_only)throw new OrderHttpError(400,{error:{code:'invalid_order',details:'post only cross'}});
      return {order:{order_id:`order-${posts.length}`}};},
    read:async id=>{
      reads++;const i=Number(id.split('-')[1])-1,b=posts[i],maker=b.post_only;
      if(maker&&(variant==='unknown'||(variant==='404'&&reads<3)))return {order:{status:'resting',fill_count_fp:'0',remaining_count_fp:b.count}};
      const fill=maker?(variant==='partial'?2:variant==='full'?Number(b.count):0):Number(b.count);
      if(variant==='deadline'&&maker)now=60001;
      const cost=fill*Number(b.price),fee=maker?0:Math.ceil(fill*.0175*100-1e-9)/100;
      return {order:{status:'canceled',fill_count_fp:String(fill),remaining_count_fp:'0',
        maker_fill_cost_dollars:maker?String(cost):'0',taker_fill_cost_dollars:maker?'0':String(cost),
        maker_fees_dollars:'0',taker_fees_dollars:String(fee)}};
    },cancel:async()=>{if(variant==='404')throw Object.assign(Error('not found'),{status:404});return {};},log:()=>{}
  },policy,{ticker:'TEST',side:'yes',target:0,received:1000});
  return {trace,posts,saved};
}
test('empty maker and explicit post-only rejection reach one capped IOC',async()=>{
  for(const v of ['empty','rejected']){const h=await run(v);assert.equal(h.posts.length,2);assert.equal(h.posts[0].post_only,true);
    assert.equal(h.posts[1].post_only,false);assert.equal(h.posts[1].time_in_force,'immediate_or_cancel');assert.equal(h.trace.status,'FILLED');
    assert.ok(h.trace.cost_or_reserved_cost<=40);}
});
test('partial maker only replaces unfilled remainder with remaining cash',async()=>{
  const h=await run('partial');assert.equal(h.posts.length,2);
  assert.ok(Number(h.posts[1].count)<=Number(h.posts[0].count)-2);assert.ok(h.trace.cost_or_reserved_cost<=40);
  const small=await run('smallCash');assert.equal(small.posts.length,2);
  assert.ok(reservedOrderCost(Number(small.posts[1].count),Number(small.posts[1].price),.03)<=.5+1e-9);
});
test('full fill, ambiguous submission/cancel, price, deadline, pause, cash stop fallback',async()=>{
  for(const v of ['full','timeout','unknown','price','deadline','pause','cash']){
    const h=await run(v);assert.equal(h.posts.length,1,v);
    if(['timeout','unknown'].includes(v))assert.equal(h.trace.status,'RECONCILIATION_REQUIRED');
  }
});
test('404 does not authorize IOC until a subsequent GET confirms terminal state',async()=>{
  const h=await run('404');assert.equal(h.posts.length,2);
  const events=h.trace.events;assert.ok(events.some((e:any)=>e.type==='cancel_confirmation'&&!e.terminal));
  const terminal=events.findIndex((e:any)=>e.type==='cancel_confirmation'&&e.terminal);
  assert.ok(terminal>=0&&terminal<events.findIndex((e:any)=>e.type==='order_intent'&&e.kind==='taker'));
});
test('fractional taker fee rounding stays inside cash and odds bounds',()=>{
  const q={bid:.5,ask:.51,askSize:100,observedAt:1000,requestStartedAt:1000,source:'test'};
  for(const budget of [.01,.02,.5,4.72]){
    const p=planOrder(q,policy,'taker',budget,.53,8,1000);
    if(p){assert.ok(p.maxCost<=budget+1e-9);assert.ok(p.minimumOdds>=policy.minOdds);assert.equal(p.maxCost,reservedOrderCost(p.count,p.limit,.03));}
  }
});
