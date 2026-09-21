import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {summarizeExecution} from './execution-status.ts';
import {createReceiver} from './receiver.ts';
test('correct predictions and acknowledgments never count as funded bets',()=>{
  const rows=[{execution_status:'NOT_SUBMITTED'},...Array.from({length:5},()=>({execution_status:'NOT_SUBMITTED',bet_history:{contracts:0,result:'cancelled'}}))];
  assert.deepEqual(summarizeExecution(rows),{received:6,filled:0,won:0,lost:0,pending:0,skipped:6,unresolved:0});
  rows.push({execution_status:'FILLED',bet_history:{contracts:2,result:'won'}});
  assert.equal(summarizeExecution(rows).won,1);assert.equal(summarizeExecution(rows).filled,1);
});
test('status authenticates, performs GETs only, and cannot invoke execution',async()=>{
  const now=Date.now(),secret='test-secret',calls:string[]=[];
  const handler=createReceiver('U',k=>({BTC15M_WEBHOOK_SECRET:secret,SUPABASE_URL:'https://db.invalid',SUPABASE_SERVICE_ROLE_KEY:'test'}[k]),
    async(url:any,init:any)=>{assert.equal(init.method??'GET','GET');calls.push(String(url));return Response.json([]);},()=>now,
    {execute:async()=>{throw Error('must never execute');}});
  const raw=JSON.stringify({kind:'V12_EXECUTION_STATUS',leg:'U',sent_at:new Date(now).toISOString()});
  const make=(sig:string)=>new Request('https://receiver.invalid',{method:'POST',body:raw,headers:{'x-btc15m-signature':sig}});
  assert.equal((await handler(make('bad'))).status,401);assert.equal(calls.length,0);
  const response=await handler(make('sha256='+createHmac('sha256',secret).update(raw).digest('hex')));
  assert.equal(response.status,200);assert.equal((await response.json()).filled,0);assert.equal(calls.length,1);
});
