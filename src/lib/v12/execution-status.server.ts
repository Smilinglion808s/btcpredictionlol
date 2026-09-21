// Read-only betting status, fetched by the backend heartbeat outside dispatch.
import {createHmac} from 'node:crypto';
import {V12_RECEIVER_BASE,V12_SECRET_ENDPOINTS,isAuthorizedBettingEndpoint} from './receiver-destination';

export async function readUExecution(sb:any){
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
