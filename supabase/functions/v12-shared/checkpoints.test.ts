import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createReceiver} from './receiver.ts';
import {intervalKey, ROUTES, V12_VERSION, U_CHECKPOINTS} from './contract.ts';

const secret='offline-checkpoint-test-only';
const open=Date.parse('2026-09-17T20:00:00Z');
const market='KXBTC15M-26SEP171615-15';
const eligibility={v1:{inputValid:true,reason:'CONFIDENCE_ABSTAIN',ordinaryFloorAllows:true,finalSide:0},
  t45:{finalized:true,finalSide:0},anyPriorClaim:false};

for(const second of U_CHECKPOINTS){
  for(const expired of [false,true]){
    test(`U ${second}s checkpoint ${expired?'rejects a late decision':'accepts a timely signed recording'}`,async()=>{
      const decision=open+second*1000+(expired?5001:1000),now=decision+100;
      let writes=0;
      const payload={mode:'shadow',leg:'U',model_version:ROUTES.U.model,combined_model_version:V12_VERSION,
        execution_policy:ROUTES.U.execution,stake_fraction_of_boise_day_opening_principal:ROUTES.U.fraction,
        market,prediction:'YES',candle_starts_at:new Date(open).toISOString(),decision_at:new Date(decision).toISOString(),
        sent_at:new Date(now).toISOString(),interval_key:intervalKey(market,new Date(open).toISOString()),
        checkpoint_seconds:second,v11_eligibility:eligibility,limit_all_in:.65,u_source:second<480?'R':'L'};
      const receiver=createReceiver('U',k=>({BTC15M_WEBHOOK_SECRET:secret,SUPABASE_URL:'https://mock.invalid',
        SUPABASE_SERVICE_ROLE_KEY:'test'}[k]),async(url)=>{
          assert.equal(url,'https://mock.invalid/rest/v1/rpc/record_v12_signal');writes++;
          return Response.json({id:'00000000-0000-0000-0000-000000000001',status:'DAY_OPENING_UNAVAILABLE',mode:'shadow',execution_enabled:false});
        },()=>now);
      const raw=JSON.stringify(payload);
      const response=await receiver(new Request('https://mock.invalid/v12-u',{method:'POST',body:raw,
        headers:{'x-btc15m-signature':'sha256='+createHmac('sha256',secret).update(raw).digest('hex')}}));
      assert.equal(response.status,expired?400:200);
      assert.equal(writes,expired?0:1);
      if(!expired){const body=await response.json();assert.equal(body.execution_enabled,false);
        assert.equal(body.status,'DAY_OPENING_UNAVAILABLE');assert.ok(body.id);}
    });
  }
}
