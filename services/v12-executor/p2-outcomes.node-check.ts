import test from 'node:test';
import assert from 'node:assert/strict';
import {collectP2Outcomes} from './p2-outcomes.ts';
import {createP2Observer} from '../../docs/v12-p2/observer-index.ts';
const now=Date.parse('2026-09-24T18:00:00Z');
const call=(market:string,open=now-900_000)=>({market,candle_starts_at:new Date(open).toISOString(),received_at:new Date(open+1000).toISOString()});
test('observes official outcomes for every accepted call, independent of fills',async()=>{
  const records:any[]=[];
  const result=await collectP2Outcomes({now:()=>now,pending:async()=>[call('KXBTC15M-A'),call('KXBTC15M-A'),call('KXBTC15M-B')],
    market:async ticker=>({ticker,result:ticker.endsWith('A')?'yes':'no'}),record:async(...args)=>{records.push(args);}});
  assert.equal(result.checked,2);assert.equal(result.resolved,2);assert.deepEqual(records.sort(),[['KXBTC15M-A','yes'],['KXBTC15M-B','no']]);
});
test('pending, mismatched, failed, and not-yet-closed markets cannot supply wins',async()=>{
  const recorded:string[]=[];
  const result=await collectP2Outcomes({now:()=>now,pending:async()=>['A','B','C','D'].map(k=>call('KXBTC15M-'+k,k==='D'?now:now-900_000)),
    market:async ticker=>{if(ticker.endsWith('A'))return {ticker,result:''};if(ticker.endsWith('B'))return {ticker:'WRONG',result:'yes'};throw Error('HTTP_503');},
    record:async ticker=>{recorded.push(ticker);}});
  assert.equal(result.checked,3);assert.equal(result.pending,1);assert.equal(result.errors.length,2);assert.deepEqual(recorded,[]);
});
test('observer rejects unauthorized requests before any network activity',async()=>{
  let calls=0;
  const handler=createP2Observer(k=>k==='SUPABASE_URL'?'https://example.invalid':k==='SUPABASE_SERVICE_ROLE_KEY'?'test-key':undefined,
    async()=>{calls++;throw Error('UNEXPECTED_NETWORK');});
  assert.equal((await handler(new Request('https://local',{method:'POST'}))).status,401);
  assert.equal((await handler(new Request('https://local'))).status,405);assert.equal(calls,0);
});
test('observer transport only reads market data and records outcome facts',async()=>{
  const paths:string[]=[];
  const handler=createP2Observer(k=>k==='SUPABASE_URL'?'https://example.invalid':k==='SUPABASE_SERVICE_ROLE_KEY'?'test-key':undefined,
    async(url,init)=>{
      const path=String(url);paths.push((init?.method||'GET')+' '+path);
      if(path.includes('/rest/v1/v12_p2_calls?'))return Response.json([call('KXBTC15M-A')]);
      if(path.includes('/trade-api/v2/markets/'))return Response.json({market:{ticker:'KXBTC15M-A',result:'yes'}});
      if(path.endsWith('/rpc/record_v12_p2_outcome'))return Response.json({recorded:1});
      throw Error('Unexpected endpoint');
    },()=>now);
  const reply=await handler(new Request('https://local',{method:'POST',headers:{authorization:'Bearer test-key'}}));
  assert.equal(reply.status,200);assert.equal(paths.length,3);
  assert.equal(paths.some(p=>p.includes('/orders')||p.includes('place-trade')),false);
});
