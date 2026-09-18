import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {createReceiver,validSignature} from './receiver.ts';
import {V12_VERSION,ROUTES,intervalKey} from './contract.ts';
const secret='isolated-test-secret-not-production';
const signature=(raw:string)=>'sha256='+createHmac('sha256',secret).update(raw).digest('hex');
test('HMAC fails closed for empty secrets and tampering',async()=>{
  assert(await validSignature('{}',signature('{}'),secret));
  assert(!await validSignature('{"a":1}',signature('{}'),secret));
  assert(!await validSignature('{}',signature('{}'),''));
});
test('valid signed route records only to shadow RPC; invalid signatures never call storage',async()=>{
  const now=Date.parse('2026-09-17T19:02:01Z');
  const route='U';
  let requests=0;
  const receiver=createReceiver(route,key=>key==='BTC15M_WEBHOOK_SECRET'?secret:undefined,async()=>{requests++;throw Error('unexpected network');});
  const unauth=await receiver(new Request('https://local/v12-u',{method:'POST',body:'{}'}));
  assert.equal(unauth.status,401);assert.equal(requests,0);
  const invalid=await receiver(new Request('https://local/v12-u',{method:'POST',headers:{'x-btc15m-signature':signature('{}')},body:'{}'}));
  assert.equal(invalid.status,400);assert.equal(requests,0);
  assert.equal((await receiver(new Request('https://local/v12-u'))).status,405);
  const p={model_version:ROUTES.U.model,combined_model_version:V12_VERSION,leg:'U',execution_policy:'maker_only',stake_fraction_of_boise_day_opening_principal:.1,
    mode:'shadow',prediction:'YES',market:'KXBTC15M-26SEP171515',candle_starts_at:'2026-09-17T19:00:00Z',decision_at:'2026-09-17T19:02:00Z',sent_at:'2026-09-17T19:02:01Z',checkpoint_seconds:120,
    v11_eligibility:{v1:{inputValid:true,reason:'CONFIDENCE_ABSTAIN',ordinaryFloorAllows:true,finalSide:0},t45:{finalized:true,finalSide:0},anyPriorClaim:false},limit_all_in:.72,u_source:'R',interval_key:intervalKey('KXBTC15M-26SEP171515','2026-09-17T19:00:00Z')};
  const env:Record<string,string>={BTC15M_WEBHOOK_SECRET:secret,SUPABASE_URL:'https://storage.test',SUPABASE_SERVICE_ROLE_KEY:'test-role'};
  const accepted=createReceiver('U',k=>env[k],async(url,options)=>{
    requests++;assert.equal(url,'https://storage.test/rest/v1/rpc/record_v12_signal');
    assert.equal(JSON.parse(options!.body as string).p_payload.leg,'U');
    return new Response(JSON.stringify({status:'SHADOW_RECORDED',budget_cents:10000,mode:'shadow',execution_enabled:false}));
  },()=>now);
  const raw=JSON.stringify(p);const response=await accepted(new Request('https://local/v12-u',{method:'POST',headers:{'x-btc15m-signature':signature(raw)},body:raw}));
  assert.equal(response.status,200);assert.equal(requests,1);assert.equal((await response.json()).execution_enabled,false);
});
