// Isolated PostgreSQL tests. No production connection or exchange client exists here.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
const {PGlite}=await import(process.env.V12_PGLITE_MODULE||'@electric-sql/pglite');
const db=new PGlite();
await db.exec(`create role anon;create role authenticated;create role service_role bypassrls;
create table public.bet_history(id uuid default gen_random_uuid(),market text,candle_starts_at text);
create table public.daily_balance(date date primary key,balance_at_midnight numeric);`);
await db.exec('grant select on public.daily_balance,public.bet_history to service_role');
await db.exec(await readFile(new URL('../../docs/v12_receiver_schema.sql',import.meta.url),'utf8'));
await db.exec(await readFile(new URL('../../docs/v12_receiver_release.sql',import.meta.url),'utf8'));
await db.exec("insert into daily_balance values((clock_timestamp() at time zone 'America/Boise')::date,1000.99)");
const version='v12-original-u-4-5-10-r1';let sequence=0;
async function payload(route='V1',key){
  const stamp=(await db.query("select clock_timestamp() as t")).rows[0].t.toISOString();
  return {mode:'shadow',combined_model_version:version,leg:route,model_version:{V1:'v12-v1-r1',T45R2:'v12-t45r2-r1',U:'v12-original-u-r1'}[route],
    stake_fraction_of_boise_day_opening_principal:{V1:.04,T45R2:.05,U:.1}[route],execution_policy:route==='T45R2'?'taker_only':'maker_only',
    market:'KXBTC15M-TEST-'+(++sequence),interval_key:key||'isolated-interval-'+sequence,prediction:'YES',
    candle_starts_at:stamp,decision_at:stamp,sent_at:stamp};
}
async function record(p,hash=String(sequence).padStart(64,'0')){
  await db.exec('set role service_role');
  try{return (await db.query('select record_v12_signal($1::jsonb,$2) as receipt',[JSON.stringify(p),hash])).rows[0].receipt;}
  finally{await db.exec('reset role');}
}
test('migration leaves execution shadow and records all three exact cent budgets',async()=>{
  assert.equal((await db.query('select mode from v12_release_config')).rows[0].mode,'shadow');
  for(const [route,budget]of [['V1',4003],['T45R2',5004],['U',10009]]){
    const r=await record(await payload(route));assert.equal(r.mode,'shadow');assert.equal(r.execution_enabled,false);
    assert.equal(r.status,'SHADOW_RECORDED');assert.equal(r.budget_cents,budget);
  }
});
test('duplicates and competing legs cannot win a second interval claim',async()=>{
  const p=await payload(),r=await record(p),same=await record(p);
  assert.equal(same.status,'DUPLICATE');assert.equal(same.id,r.id);
  assert.equal((await record(await payload('T45R2',p.interval_key))).status,'INTERVAL_ALREADY_CLAIMED');
});
test('missing opening records a nonexecuting receipt without taking an interval claim',async()=>{
  await db.exec('delete from daily_balance');const p=await payload(),r=await record(p);
  assert.equal(r.status,'DAY_OPENING_UNAVAILABLE');assert.equal(r.execution_enabled,false);
  assert.equal((await db.query('select count(*) n from v12_shadow_claims where interval_key=$1',[p.interval_key])).rows[0].n,0);
  await db.exec("insert into daily_balance values((clock_timestamp() at time zone 'America/Boise')::date,1000)");
});
test('activation boundary refuses older decisions; only new decisions can be live',async()=>{
  const old=await payload();await db.exec("update v12_release_config set mode='live'");
  assert.equal((await record(old)).status,'BEFORE_ACTIVATION');
  const current=await payload('U'),r=await record(current);assert.equal(r.status,'LIVE_ACCEPTED');assert.equal(r.execution_enabled,true);
  const activation=(await db.query('select live_enabled_at from v12_release_config')).rows[0].live_enabled_at;
  await db.exec("update v12_release_config set mode='live'");
  assert.equal((await db.query('select live_enabled_at from v12_release_config')).rows[0].live_enabled_at.getTime(),activation.getTime());
  await db.exec("update v12_release_config set mode='shadow'");
  assert.equal((await db.query('select live_enabled_at from v12_release_config')).rows[0].live_enabled_at,null);
});
test('policy substitution and preexisting actual bet both fail closed',async()=>{
  const p=await payload();p.model_version='v11-original-confidence-rank80-4';await assert.rejects(()=>record(p),/INVALID_V12_POLICY/);
  const p2=await payload();await db.query('insert into bet_history(market,candle_starts_at) values($1,$2)',[p2.market,p2.candle_starts_at]);
  assert.equal((await record(p2)).status,'EXISTING_LEG_RECORD');
});
test('anonymous roles have no execution RPC access',async()=>{
  const rights=(await db.query("select has_function_privilege('anon','public.record_v12_signal(jsonb,text)','EXECUTE') a,has_function_privilege('authenticated','public.record_v12_signal(jsonb,text)','EXECUTE') u,has_function_privilege('service_role','public.record_v12_signal(jsonb,text)','EXECUTE') s")).rows[0];
  assert.deepEqual(rights,{a:false,u:false,s:true});
});
test.after(()=>db.close());
