// Independent V1.2 receiver. The database release gate is shadow until operator activation.
import {executionStatus} from './execution-status.ts';
import {validateSignal, type Route} from './contract.ts';
import {executeV12,executionReadiness,EXECUTOR_REVISION} from './executor.js';
export async function validSignature(raw: string, signature: string, secret: string) {
  if (!secret || !/^sha256=[0-9a-f]{64}$/.test(signature)) return false;
  const encoder=new TextEncoder();
  const key=await crypto.subtle.importKey('raw',encoder.encode(secret),{name:'HMAC',hash:'SHA-256'},false,['verify']);
  const bytes=Uint8Array.from(signature.slice(7).match(/../g)!,h=>parseInt(h,16));
  return crypto.subtle.verify('HMAC',key,bytes,encoder.encode(raw));
}
export function createReceiver(route:Route,get:(key:string)=>string|undefined,transport:typeof fetch=fetch,clock:()=>number=Date.now,
  options:{execute?:typeof executeV12;readiness?:typeof executionReadiness;schedule?:(task:Promise<unknown>)=>void}={}) {
  return async(req:Request):Promise<Response>=>{
    const reply=(status:number,body:unknown)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json'}});
    if(req.method!=='POST')return reply(405,{error:'POST_REQUIRED'});
    if(Number(req.headers.get('content-length')||0)>32768)return reply(413,{error:'BODY_TOO_LARGE'});
    const raw=await req.text();if(new TextEncoder().encode(raw).length>32768)return reply(413,{error:'BODY_TOO_LARGE'});
    if(!await validSignature(raw,req.headers.get('x-btc15m-signature')||'',get('BTC15M_WEBHOOK_SECRET')||''))return reply(401,{error:'INVALID_SIGNATURE'});
    let payload:Record<string,any>;
    try{
      payload=JSON.parse(raw);
      if(payload?.kind==='V12_READINESS_PROBE'){
        const sent=Date.parse(payload.sent_at);
        if(payload.leg!==route||!Number.isFinite(sent)||Math.abs(clock()-sent)>10000)throw Error('INVALID_PROBE');
        try{return reply(200,{kind:'V12_READINESS_PROBE',route,...await (options.readiness||executionReadiness)(get,transport,clock)});}
        catch{return reply(503,{error:'READINESS_UNAVAILABLE',revision:EXECUTOR_REVISION});}
      }
      validateSignal(payload,route,clock());
    }
    catch(e){return reply(400,{error:e instanceof Error?e.message:'INVALID_SIGNAL'});}
    const base=get('SUPABASE_URL'),key=get('SUPABASE_SERVICE_ROLE_KEY')||get('KALSHI_SUPABASE_SERVICE_ROLE');
    if(!base||!key)return reply(503,{error:'STORAGE_NOT_CONFIGURED'});
    const hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(raw))),b=>b.toString(16).padStart(2,'0')).join('');
    try{
      const result=await transport(base+'/rest/v1/rpc/record_v12_signal',{
        method:'POST',headers:{apikey:key,Authorization:'Bearer '+key,'content-type':'application/json'},
        body:JSON.stringify({p_payload:payload,p_hash:hash}),signal:AbortSignal.timeout(5000)});
      if(!result.ok)return reply(503,{error:'V12_RECORD_FAILED'});
      const receipt=await result.json();
      if(!['shadow','live'].includes(receipt.mode)||typeof receipt.execution_enabled!=='boolean')throw Error('INVALID_RECEIPT');
      if(receipt.execution_enabled){
        if(receipt.status!=='LIVE_ACCEPTED'||receipt.mode!=='live')throw Error('INVALID_LIVE_RECEIPT');
        const task=(options.execute||executeV12)(payload,receipt,get,transport,clock).catch(async()=>{
          // Keep the durable claim after an ambiguous failure; never retry an order here.
          await transport(base+'/rest/v1/v12_shadow_signals?id=eq.'+encodeURIComponent(receipt.id),{
            method:'PATCH',headers:{apikey:key,Authorization:'Bearer '+key,'content-type':'application/json'},
            body:JSON.stringify({execution_status:'RECONCILIATION_REQUIRED',execution_updated_at:new Date(clock()).toISOString()}),
            signal:AbortSignal.timeout(4000)}).catch(()=>{});
        });
        if(options.schedule)options.schedule(task);
        else if((globalThis as any).EdgeRuntime?.waitUntil)(globalThis as any).EdgeRuntime.waitUntil(task);
        else await task;
      }
      return reply(200,{...receipt,revision:EXECUTOR_REVISION});
    }catch{return reply(503,{error:'SHADOW_RECORD_FAILED'});}
  };
}
