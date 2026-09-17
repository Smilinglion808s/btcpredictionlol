// Dedicated recording-only transport. Never uses place-trade or configurable arbitrary URLs.
import {createHmac} from 'node:crypto';
import type {SupabaseClient} from '@supabase/supabase-js';
import {ROUTES,validateSignal,type Route} from './contract';
import {V12_RECEIVER_BASE,isAuthorizedBettingEndpoint} from './receiver-destination';

export async function publishV12Shadow(sb:SupabaseClient,payload:Record<string,any>,now=Date.now()){
  const route=payload.leg as Route;
  if(!Object.hasOwn(ROUTES,route)) throw new Error('UNKNOWN_ROUTE');
  validateSignal(payload,route,now);
  // Reuse only the secret of the single existing authorised betting receiver.
  const destination=V12_RECEIVER_BASE;
  const {data,error}=await sb.from('webhook_endpoints').select('secret,url,is_active').eq('is_active',true);
  if(error)throw error;
  const endpoints=(data??[]).filter(e=>isAuthorizedBettingEndpoint(e.url));
  if(endpoints.length!==1 || !endpoints[0].secret)throw new Error('SINGLE_BETTING_SECRET_UNAVAILABLE');
  const raw=JSON.stringify(payload),signature=createHmac('sha256',endpoints[0].secret).update(raw).digest('hex');
  const response=await fetch(destination+ROUTES[route].endpoint,{method:'POST',body:raw,redirect:'error',
    signal:AbortSignal.timeout(2500),headers:{'content-type':'application/json','x-btc15m-signature':'sha256='+signature}});
  if(!response.ok)throw new Error('SHADOW_RECEIVER_HTTP_'+response.status);
  const result=await response.json();
  if(result.execution_enabled!==false)throw new Error('SHADOW_RECEIVER_CONTRACT_MISMATCH');
  return result;
}
