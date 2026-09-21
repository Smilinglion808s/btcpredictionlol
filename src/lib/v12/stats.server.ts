// Aggregate-only predictor status. Never returns secrets or webhook payloads.
import {createHmac} from 'node:crypto';
import {V12_RECEIVER_BASE,V12_SECRET_ENDPOINTS,isAuthorizedBettingEndpoint} from './receiver-destination';
import {createClient} from '@supabase/supabase-js';
import {ROUTES,type Route,V12_VERSION} from './contract';

export async function buildV12Stats(){
  const sb=createClient(process.env.SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {auth:{persistSession:false,autoRefreshToken:false}});
  const executionPromise=readUExecution(sb);
  const [runtime,events]=await Promise.all([
    sb.from('v12_predictor_runtime').select('received_at,status').eq('worker_id','v12-shadow-worker').maybeSingle(),
    sb.from('v12_prediction_events').select('route,model_version,candle_starts_at,decision_at,prediction,delivery_status,acknowledged_at,receiver_status')
      .order('created_at',{ascending:false}).limit(1000),
  ]);
  if(runtime.error || events.error)throw new Error('V12_STATUS_UNAVAILABLE');
  const rows=events.data??[],times=[...new Set(rows.map(r=>r.candle_starts_at))];
  const labels=new Map<string,number>();
  const chunks=Array.from({length:Math.ceil(times.length/100)},(_,i)=>times.slice(i*100,(i+1)*100));
  const results=await Promise.all(chunks.map(ts=>sb.from('v11_context_rows').select('target_ts,label').in('target_ts',ts)));
  for(const result of results){
    if(result.error)throw new Error('V12_LABELS_UNAVAILABLE');
    for(const row of result.data??[])if(row.label===1 || row.label===-1)labels.set(new Date(row.target_ts).toISOString(),row.label);
  }
  const r=runtime.data,now=Date.now(),status=r?.status??{};
  const recent=!!r && now-Date.parse(r.received_at)<120000;
  const connected=recent && status.stage==='RECORDING' && now-Date.parse(status.last_context_at??'')<90000;
  const legs=Object.entries(ROUTES).map(([leg,policy])=>{
    const selected=rows.filter(row=>row.route===leg),acknowledged=selected.filter(row=>row.delivery_status==='ACKNOWLEDGED');
    let wins=0,losses=0;
    for(const row of selected){
      const label=labels.get(new Date(row.candle_starts_at).toISOString());
      if(label===undefined)continue;
      if((row.prediction==='YES'?1:-1)===label)wins++;else losses++;
    }
    return {leg,model:policy.model,endpoint:policy.endpoint,calls:selected.length,acknowledged:acknowledged.length,
      unconfirmed:selected.length-acknowledged.length,wins,losses,pending:selected.length-wins-losses,
      winRate:wins+losses?wins/(wins+losses):null,lastAcknowledgedAt:acknowledged[0]?.acknowledged_at??null,
      authenticated:recent && status.receiver_auth?.[leg as Route]===true};
  });
  return {modelVersion:V12_VERSION,state:connected?'CONNECTED':recent?'WAITING':'OFFLINE',receivedAt:r?.received_at??null,
    fitVersion:status.fit_version??null,fitExpiresAt:status.fit_expires_at??null,
    fitValid:Date.parse(status.fit_expires_at??'')>now,refreshStatus:status.refresh_status??null,
    refreshError:status.refresh_error??null,uEligible:status.u_eligible===true,uBlockReason:status.u_block_reason??null,
    earlyFeaturesReady:status.early_features_ready===true,trainingRows:status.training_rows??0,
    uExecution:await executionPromise,legs,windowLimit:1000,truncated:rows.length===1000,latest:rows[0]??null};
}

async function readUExecution(sb:any){
  try{
    const {data,error}=await sb.from('webhook_endpoints').select('url,secret').in('url',V12_SECRET_ENDPOINTS);
    const endpoints=(data??[]).filter((e:any)=>isAuthorizedBettingEndpoint(e.url));
    if(error||endpoints.length!==1||!endpoints[0].secret)return null;
    const raw=JSON.stringify({kind:'V12_EXECUTION_STATUS',leg:'U',sent_at:new Date().toISOString()});
    const signature=createHmac('sha256',endpoints[0].secret).update(raw).digest('hex');
    const response=await fetch(V12_RECEIVER_BASE+'v12-u',{method:'POST',body:raw,redirect:'error',
      signal:AbortSignal.timeout(3000),headers:{'content-type':'application/json','x-region':'us-west-1','x-btc15m-signature':'sha256='+signature}});
    if(!response.ok)return null;
    const r=await response.json();
    if(r.kind!=='V12_EXECUTION_STATUS'||r.route!=='U')return null;
    const keys=['received','filled','won','lost','pending','skipped','unresolved'];
    if(!keys.every(k=>Number.isSafeInteger(r[k])&&r[k]>=0))return null;
    return Object.fromEntries([...keys,'as_of','truncated'].map(k=>[k,r[k]]));
  }catch{return null;} // unavailable must never be displayed as zero fills
}
