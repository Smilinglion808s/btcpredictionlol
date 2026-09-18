// Dedicated V1.2 signal transport. Receiver-side release state owns execution.
import {createHmac,createHash} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ROUTES,validateSignal,type Route} from './contract';
import {V12_RECEIVER_BASE,V12_SECRET_ENDPOINTS,isAuthorizedBettingEndpoint} from './receiver-destination';

export async function publishV12Shadow(sb:SupabaseClient,payload:Record<string,any>,now=Date.now()){
  const started=Date.now();
  const route=payload.leg as Route;
  if(!Object.hasOwn(ROUTES,route)) throw new Error('UNKNOWN_ROUTE');
  validateSignal(payload,route,now);
  // Reuse only the secret of the single existing authorised betting receiver.
  const destination=V12_RECEIVER_BASE;
  // The legacy endpoint's active flag controls legacy sending, not this fixed
  // V1.2 destination. Reading its shared signing secret must not reactivate it.
  const {data,error}=await sb.from('webhook_endpoints').select('secret,url,is_active').in('url',V12_SECRET_ENDPOINTS);
  if(error)throw error;
  const endpoints=(data??[]).filter(e=>isAuthorizedBettingEndpoint(e.url));
  if(endpoints.length!==1 || !endpoints[0].secret)throw new Error('SINGLE_BETTING_SECRET_UNAVAILABLE');
  const raw=JSON.stringify(payload),signature=createHmac('sha256',endpoints[0].secret).update(raw).digest('hex');
  const eventKey=payload.interval_key+':'+route;
  const secretRead=Date.now();
  const {error:claimError}=await sb.from('v12_prediction_events').insert({event_key:eventKey,
    request_hash:createHash('sha256').update(raw).digest('hex'),route,model_version:payload.model_version,
    market:payload.market,candle_starts_at:payload.candle_starts_at,decision_at:payload.decision_at,
    prediction:payload.prediction,checkpoint_seconds:payload.checkpoint_seconds??null,u_source:payload.u_source??null});
  if(claimError)throw new Error(claimError.code==='23505'?'DELIVERY_ALREADY_ATTEMPTED':'DELIVERY_JOURNAL_UNAVAILABLE');
  const journalMs=Date.now()-secretRead, httpStarted=Date.now();
  try {
    const response=await fetch(destination+ROUTES[route].endpoint,{method:'POST',body:raw,redirect:'error',
      signal:AbortSignal.timeout(2500),headers:{'content-type':'application/json','x-btc15m-signature':'sha256='+signature,
        'x-v12-event-id':eventKey,'x-v12-model':ROUTES[route].model,'x-v12-leg':route}});
    if(!response.ok)throw new Error('SHADOW_RECEIVER_HTTP_'+response.status);
    const result=await response.json();
    if(typeof result.execution_enabled!=='boolean' || !['shadow','live'].includes(result.mode))
      throw new Error('SHADOW_RECEIVER_CONTRACT_MISMATCH');
    // Bounded durations only: no credentials, payloads or receiver bodies.
    const timings={secret_read_ms:secretRead-started,journal_ms:journalMs,http_ms:Date.now()-httpStarted,
      dispatch_at_ms:httpStarted};
    const {error}=await sb.from('v12_prediction_events').update({delivery_status:'ACKNOWLEDGED',
      acknowledged_at:new Date().toISOString(),receiver_status:typeof result.status==='string'?result.status:null,
      receiver_receipt_id:typeof result.id==='string'?result.id:null}).eq('event_key',eventKey);
    // A missing local receipt must not provoke a second outbound request.
    return {...result,event_key:eventKey,receipt_journaled:!error,timings};

  } catch(e) {
    const code=e instanceof Error && /^SHADOW_RECEIVER_[A-Z_0-9]+$/.test(e.message)?e.message:'DELIVERY_ACK_UNKNOWN';
    await sb.from('v12_prediction_events').update({delivery_status:'UNKNOWN',error_code:code}).eq('event_key',eventKey);
    throw new Error(code);
  }
}
