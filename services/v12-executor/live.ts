// V1.2 receiver-owned execution. Called only after a durable LIVE_ACCEPTED receipt.
import {executeEntry} from './entry-engine.ts';
import {policyFromEnv, OrderHttpError, type Quote} from './entry-policy.ts';
import {routePolicy} from './route-policy.ts';
import {marketSource} from './market-source.ts';
import {boiseDay, V12_VERSION, ROUTES, type Route} from '../../src/lib/v12/contract.ts';

export const EXECUTOR_REVISION='v12-executor-r4';
type Get=(key:string)=>string|undefined;
type Receipt={id:string;status:string;mode:string;execution_enabled:boolean;budget_cents:number;boise_day:string;opening_balance:number};
export function confidencePercent(value:unknown):number {
  if(value===undefined || value===null)return 0;
  if(typeof value!=='number' || !Number.isFinite(value) || value<0 || value>1)throw Error('INVALID_PROBABILITY');
  return Math.round(value*100);
}
const enc=new TextEncoder();
const sleep=(ms:number)=>new Promise<void>(resolve=>setTimeout(resolve,ms));
export function dayStart(day:string):number {
  const midnight=Date.parse(day+'T00:00:00Z');let candidate=midnight;
  for(let i=0;i<3;i++){
    const name=new Intl.DateTimeFormat('en-US',{timeZone:'America/Boise',timeZoneName:'longOffset'}).formatToParts(candidate).find(p=>p.type==='timeZoneName')!.value;
    const m=name.match(/GMT([+-])(\d{2}):(\d{2})/);if(!m)throw Error('TIMEZONE_OFFSET_UNAVAILABLE');
    candidate=midnight-(m[1]==='-'?-1:1)*(Number(m[2])*60+Number(m[3]))*60000;
  }return candidate;
}
function client(get:Get,transport:typeof fetch,clock:()=>number){
  const base=get('SUPABASE_URL'),key=get('SUPABASE_SERVICE_ROLE_KEY')||get('KALSHI_SUPABASE_SERVICE_ROLE');
  if(!base||!key)throw Error('STORAGE_NOT_CONFIGURED');
  const headers={apikey:key,Authorization:'Bearer '+key,'content-type':'application/json'};
  const db=async(path:string,method='GET',body?:unknown)=>{
    const r=await transport(base+'/rest/v1/'+path,{method,headers:{...headers,Prefer:'return=representation'},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:AbortSignal.timeout(4000)});
    if(!r.ok){if(method==='POST'&&r.status===409)return null;throw Error('V12_STORAGE_HTTP_'+r.status);}
    return r.status===204?null:r.json();
  };
  let privateKey:CryptoKey|undefined;
  const host=get('KALSHI_BASE_URL')||'https://api.elections.kalshi.com';
  if(!['https://api.elections.kalshi.com','https://external-api.kalshi.com'].includes(host))throw Error('UNEXPECTED_EXCHANGE_HOST');
  const exchange=async(method:string,path:string,body?:Record<string,unknown>,params?:Record<string,string>,signal?:AbortSignal)=>{
    if(!privateKey){
      const pem=(get('KALSHI_PRIVATE_KEY_PEM')||'').replace(/\\n/g,'\n').replace(/-----[A-Z ]+-----/g,'').replace(/\s/g,'');
      privateKey=await crypto.subtle.importKey('pkcs8',Uint8Array.from(atob(pem),c=>c.charCodeAt(0)),{name:'RSA-PSS',hash:'SHA-256'},false,['sign']);
    }
    const ts=String(clock()),sig=await crypto.subtle.sign({name:'RSA-PSS',saltLength:32},privateKey,enc.encode(ts+method+path));
    const url=new URL(host+path);for(const [k,v]of Object.entries(params||{}))url.searchParams.set(k,v);
    const r=await transport(url.toString(),{method,headers:{'content-type':'application/json','KALSHI-ACCESS-KEY':get('KALSHI_KEY_ID')||'',
      'KALSHI-ACCESS-TIMESTAMP':ts,'KALSHI-ACCESS-SIGNATURE':btoa(String.fromCharCode(...new Uint8Array(sig)))},
      ...(body===undefined?{}:{body:JSON.stringify(body)}),signal:signal||AbortSignal.timeout(4000)});
    if(!r.ok){
      if(method==='POST'){let detail:any={};try{detail=await r.json();}catch{}throw new OrderHttpError(r.status,detail);}
      throw Object.assign(Error('V12_EXCHANGE_HTTP_'+r.status),{status:r.status});
    }return r.json();
  };
  const release=async()=>{
    const rows=await db('v12_release_config?version=eq.'+V12_VERSION+'&select=mode,live_enabled_at');
    if(rows?.length!==1||!['shadow','live'].includes(rows[0].mode))throw Error('RELEASE_CONFIG_UNAVAILABLE');return rows[0];
  };
  const pause=async()=>{
    const rows=await db('bot_config?id=eq.1&select=paused');
    if(rows?.length!==1||typeof rows[0].paused!=='boolean')throw Error('PAUSE_STATE_UNAVAILABLE');return rows[0].paused;
  };
  return {db,exchange,release,pause,host};
}

export async function executionReadiness(get:Get,transport:typeof fetch=fetch,clock:()=>number=Date.now){
  const c=client(get,transport,clock),day=boiseDay(new Date(clock()));
  const [release,paused,balances]=await Promise.all([c.release(),c.pause(),c.db('daily_balance?date=eq.'+day+'&select=balance_at_midnight')]);
  const checks={release_config:true,daily_opening:balances?.length===1&&Number(balances[0].balance_at_midnight)>0,
    bot_unpaused:paused===false,exchange_credentials:!!get('KALSHI_KEY_ID')&&!!get('KALSHI_PRIVATE_KEY_PEM'),exchange_authenticated:false,policy_valid:false};
  try{policyFromEnv(k=>k==='ENTRY_POLICY_MODE'?'live':get(k));checks.policy_valid=true;}catch{}
  if(checks.exchange_credentials){try{const cash=await c.exchange('GET','/trade-api/v2/portfolio/balance');checks.exchange_authenticated=Number.isFinite(cash.balance)&&cash.balance>=0;}catch{}}
  return {revision:EXECUTOR_REVISION,mode:release.mode,ready_for_activation:Object.values(checks).every(Boolean),checks,
    records_created:0,orders_submitted:0,execution_enabled:false};
}

export async function executeV12(signal:Record<string,any>,receipt:Receipt,get:Get,transport:typeof fetch=fetch,clock:()=>number=Date.now){
  if(receipt.status!=='LIVE_ACCEPTED'||receipt.mode!=='live'||receipt.execution_enabled!==true||
      !receipt.id||!Number.isSafeInteger(receipt.budget_cents)||receipt.budget_cents<=0)throw Error('LIVE_RECEIPT_REQUIRED');
  const c=client(get,transport,clock),target=Date.parse(signal.candle_starts_at),side=signal.prediction==='YES'?'yes':'no',ticker=signal.market;
  const route=signal.leg as Route,received=clock(),day=boiseDay(new Date(received));
  if(receipt.boise_day!==day)throw Error('DAY_OPENING_EXPIRED');
  // The receiver database owns this mode; the legacy ENTRY_POLICY_MODE cannot activate V1.2.
  const policy=routePolicy(policyFromEnv(k=>k==='ENTRY_POLICY_MODE'?'live':get(k)),signal,received);
  const maxDollars=Number(get('BET_SIZE_MAX_DOLLARS')||0);
  if(!Number.isFinite(maxDollars)||maxDollars<0)throw Error('INVALID_BUDGET_CAP');
  const baseBudget=Math.min(receipt.budget_cents/100,maxDollars>0?maxDollars:Infinity);
  const stopPct=Number(get('DAILY_STOP_LOSS_PCT')||0);
  if(!Number.isFinite(stopPct)||stopPct<0)throw Error('INVALID_STOP_LOSS');
  const activation=async()=>{
    const [release,paused]=await Promise.all([c.release(),c.pause()]);
    if(release.mode!=='live'||!release.live_enabled_at||Date.parse(signal.decision_at)<Date.parse(release.live_enabled_at)||
        boiseDay(new Date(clock()))!==day)throw Error('V12_LIVE_NOT_AUTHORIZED');
    return paused;
  };
  const stopped=async()=>{
    if(stopPct===0)return false;
    const rows=await c.db('bet_history?placed_at=gte.'+encodeURIComponent(new Date(dayStart(day)).toISOString())+'&result=in.(won,lost)&select=result,contracts,total_cost');
    if(!Array.isArray(rows))throw Error('STOP_LOSS_UNAVAILABLE');
    const net=rows.reduce((s:number,b:any)=>s+(b.result==='won'?Number(b.contracts):0)-Number(b.total_cost),0);
    if(!Number.isFinite(net)||!(Number(receipt.opening_balance)>0))throw Error('STOP_LOSS_UNAVAILABLE');
    return net<=-stopPct*Number(receipt.opening_balance);
  };
  const publicGet=async(path:string)=>{
    const r=await transport(c.host+path,{signal:AbortSignal.timeout(2500),cache:'no-store'});
    if(!r.ok)throw Object.assign(Error('MARKET_HTTP_'+r.status),{retryAfterMs:[418,429].includes(r.status)?30000:undefined});return r.json();
  };
  const log=(data:unknown)=>console.log(JSON.stringify({type:'v12_execution',revision:EXECUTOR_REVISION,receipt_id:receipt.id,leg:route,data}));
  const source=marketSource(publicGet,clock,sleep,ticker,target,side,policy,log);let quote:Quote|undefined;
  const sizing={policy_version:V12_VERSION,model_version:signal.model_version,fraction:ROUTES[route].fraction,
    balance_date:day,opening_balance:receipt.opening_balance,budget_dollars:baseBudget};
  const trace=await executeEntry({now:clock,sleep,id:()=>crypto.randomUUID(),
    ready:async()=>quote=await source.ready(),quote:async()=>quote=await source.quote(),
    claim:async()=>{
      // An independent existing bot claim is the final shared guard against legacy overlap.
      const rows=await c.db('bet_history','POST',{placed_at:new Date(clock()).toISOString(),candle_starts_at:signal.candle_starts_at,
        market:ticker,side,prediction:signal.prediction,confidence:confidencePercent(signal.probability),contracts:0,fill_price:0,odds:0,fee:0,
        total_cost:0,bet_size:0,result:'pending',order_id:null,maker_order_id:null,fill_type:null,model_version:signal.model_version,
        sent_at:signal.sent_at,webhook_received_at:new Date(received).toISOString(),seconds_after_open:Math.round((clock()-target)/1000),
        execution_trace:{policy,policy_version:'entry-controls-r1',execution_revision:EXECUTOR_REVISION,receipt_id:receipt.id,sizing,status:'CLAIMED'},order_attempts:[]});
      return rows?.[0]?.id||null;
    },
    preflight:async()=>{
      const [paused,stop,cash]=await Promise.all([activation(),stopped(),c.exchange('GET','/trade-api/v2/portfolio/balance')]);
      if(!Number.isSafeInteger(cash.balance)||cash.balance<0)throw Error('AVAILABLE_CASH_UNAVAILABLE');
      return {paused,stopped:stop,budget:Math.min(baseBudget,cash.balance/100)};
    },
    save:async(id,patch)=>{
      const rows=await c.db('bet_history?id=eq.'+id+'&select=id','PATCH',{...patch,execution_trace:{...patch.execution_trace,
        policy_version:'entry-controls-r1',execution_revision:EXECUTOR_REVISION,receipt_id:receipt.id,sizing}});
      if(rows?.length!==1||rows[0].id!==id)throw Error('DURABLE_ROW_NOT_FOUND');
    },
    beforeSubmit:async()=>{
      if(await activation())throw Error('BOT_PAUSED');
      if(clock()>target+policy.maxEntryAgeMs)throw Error('ENTRY_DEADLINE');
      // The engine validates/refetches the quote AFTER this network-bound gate check.
    },
    submit:async body=>{
      const shard=(get('EXCHANGE_INDEX')||'-1').trim().toLowerCase();
      return c.exchange('POST','/trade-api/v2/portfolio/events/orders',{...body,...(shard==='omit'?{}:{exchange_index:Number(shard)})});
    },
    read:(id,abort)=>c.exchange('GET','/trade-api/v2/portfolio/orders/'+encodeURIComponent(id),undefined,undefined,abort),
    cancel:(id,abort)=>c.exchange('DELETE','/trade-api/v2/portfolio/events/orders/'+encodeURIComponent(id),undefined,
      {market_ticker:ticker,...((get('EXCHANGE_INDEX')||'-1')==='omit'?{}:{exchange_index:get('EXCHANGE_INDEX')||'-1'})},abort),log,
  },policy,{ticker,side,target,received});
  await c.db('v12_shadow_signals?id=eq.'+receipt.id,'PATCH',{execution_status:trace.status,
    execution_updated_at:new Date(clock()).toISOString(),bet_id:trace.bet_id||null});
  return trace;
}
