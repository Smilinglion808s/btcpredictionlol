// Standalone recording backend. Bundle the canonical readers; do not proxy the website.
import { createHmac } from 'node:crypto';
import { readV12Context } from './context.server';
import { publishV12Shadow } from './shadow.server';
import { ROUTES, validateSignal, type Route } from './contract';
import { V12_RECEIVER_BASE, isAuthorizedBettingEndpoint } from './receiver-destination';
import { recordRuntime } from './runtime.server';

export { readV12Context };
export const ADAPTER_REVISION = 'v12-edge-adapter-r2';
const RECEIVERS = V12_RECEIVER_BASE;
const encoder = new TextEncoder();

export async function verifyWorkerSignature(raw: string, timestamp: string | null, signature: string | null,
  secret: string, now: number): Promise<boolean> {
  if (!secret || !timestamp || !/^\d{13}$/.test(timestamp) || !signature || !/^[0-9a-f]{64}$/.test(signature) ||
      Math.abs(now - Number(timestamp)) > 10000) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['verify']);
  const bytes = Uint8Array.from(signature.match(/../g)!, h => parseInt(h,16));
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(`${timestamp}.${raw}`));
}

async function probeReceivers(sb: any, transport: typeof fetch) {
  const {data,error} = await sb.from('webhook_endpoints').select('secret,url,is_active').eq('is_active',true);
  if (error) throw error;
  const endpoints = (data ?? []).filter((e:any) => isAuthorizedBettingEndpoint(e.url));
  if (endpoints.length !== 1 || !endpoints[0].secret) throw new Error('SINGLE_BETTING_SECRET_UNAVAILABLE');
  const results = await Promise.all((Object.keys(ROUTES) as Route[]).map(async leg => {
    // Deliberately invalid signal. A signed 400 with this precise error proves
    // authentication and route reachability without recording a fabricated bet.
    const raw = JSON.stringify({mode:'shadow',kind:'V12_AUTHENTICATION_PROBE',leg});
    const signature = createHmac('sha256',endpoints[0].secret).update(raw).digest('hex');
    try {
      const response = await transport(RECEIVERS+ROUTES[leg].endpoint, {method:'POST',body:raw,redirect:'error',
        signal:AbortSignal.timeout(2500),headers:{'content-type':'application/json','x-btc15m-signature':'sha256='+signature}});
      const result = await response.json();
      return {leg,authenticated:response.status===400 && result.error==='ROUTE_POLICY_MISMATCH',status:response.status};
    } catch { return {leg,authenticated:false,status:null}; }
  }));
  return {all_authenticated:results.every(r=>r.authenticated),receivers:results,records_created:0};
}

type Dependencies = {
  secret: () => string;
  client: () => any;
  clock?: () => number;
  transport?: typeof fetch;
  readContext?: typeof readV12Context;
  publish?: typeof publishV12Shadow;
};

export function createAdapterHandler(deps: Dependencies) {
  const clock=deps.clock ?? Date.now;
  const reply=(status:number,body:Record<string,unknown>) => Response.json(
    {...body,adapter_revision:ADAPTER_REVISION,mode:'shadow',execution_enabled:false},
    {status,headers:{'cache-control':'no-store'}});
  return async(request:Request):Promise<Response> => {
    if (request.method!=='POST') return reply(405,{ok:false,error:'POST_REQUIRED'});
    if (Number(request.headers.get('content-length') || 0)>32768) return reply(413,{ok:false,error:'BODY_TOO_LARGE'});
    const raw=await request.text();
    if (encoder.encode(raw).length>32768) return reply(413,{ok:false,error:'BODY_TOO_LARGE'});
    if (!await verifyWorkerSignature(raw,request.headers.get('x-c85-timestamp'),request.headers.get('x-c85-signature'),deps.secret(),clock()))
      return reply(401,{ok:false,error:'INVALID_SIGNATURE'});
    let p:any;
    try { p=JSON.parse(raw); } catch { return reply(400,{ok:false,error:'INVALID_JSON'}); }
    if (!p || typeof p!=='object' || Array.isArray(p)) return reply(400,{ok:false,error:'INVALID_ENVELOPE'});
    const now=clock(),open=Date.parse(p.open);
    if (!['context','publish','probe','heartbeat'].includes(p.op) || typeof p.nonce!=='string' || p.nonce.length<8 || p.nonce.length>120 ||
        !Number.isFinite(open) || open%900000!==0 || now<open || now>=open+900000)
      return reply(400,{ok:false,error:'INVALID_CURRENT_INTERVAL'});
    try {
      const sb=deps.client();
      if (p.op!=='context') {
        const {error}=await sb.from('c85_request_nonces').insert({nonce:p.nonce,op:'v12-shadow.'+p.op,worker_id:'v12-shadow-worker'});
        if (error?.code==='23505') return reply(409,{ok:false,error:'REPLAYED'});
        if (error) throw new Error('NONCE_STORE_UNAVAILABLE');
      }
      if (p.op==='probe') return reply(200,{ok:true,...await probeReceivers(sb,deps.transport ?? fetch)});
      if (p.op==='heartbeat') return reply(200,{ok:true,...await recordRuntime(sb,p.status)});
      const context=await (deps.readContext ?? readV12Context)(sb,new Date(open).toISOString());
      if (p.op==='context') return reply(200,{ok:true,context,observed_at:new Date(clock()).toISOString()});
      const signal=p.signal;
      if (!context.ready || !signal || signal.market!==context.ticker || Date.parse(signal.candle_starts_at)!==open)
        throw new Error('CONTEXT_MISMATCH');
      if (signal.leg==='U') {
        if (!context.u_eligible) throw new Error('U_NOT_ELIGIBLE');
        signal.v11_eligibility=context.eligibility;
      } else {
        const v1=context.v1,t45=context.t45;
        if (!v1 || v1.features?.input_valid!==true) throw new Error('V1_INPUT_INVALID');
        if (signal.leg!=='V1' && signal.leg!=='T45R2') throw new Error('UNKNOWN_ROUTE');
        const side=signal.leg==='V1'?v1.final_side:t45?.side;
        if ((signal.leg==='T45R2' && (!t45 || t45.leg!=='T45R2' || t45.run_mode!=='LIVE_SHADOW' || t45.evidence?.trigger_signed!==true)) ||
            ![1,-1].includes(side) || signal.prediction!==(side===1?'YES':'NO')) throw new Error('COMMITTED_DIRECTION_MISMATCH');
        const offset=signal.leg==='V1'?v1.publication_offset_ms:t45?.decision_offset_ms;
        if (typeof offset!=='number' || Math.abs(Date.parse(signal.decision_at)-(open+offset))>1) throw new Error('DECISION_TIME_MISMATCH');
      }
      validateSignal(signal,signal.leg,clock());
      const result=await (deps.publish ?? publishV12Shadow)(sb,signal,clock());
      if (result.execution_enabled!==false) throw new Error('SHADOW_RECEIVER_CONTRACT_MISMATCH');
      return reply(200,{ok:true,...result});
    } catch(e) { return reply(400,{ok:false,error:e instanceof Error?e.message:'ADAPTER_ERROR'}); }
  };
}
