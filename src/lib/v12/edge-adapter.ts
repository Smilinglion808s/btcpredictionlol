// Standalone recording backend. Bundle the canonical readers; do not proxy the website.
import { createHmac } from 'node:crypto';
import { readV12Context, readV12EarlyContext, readV12UContext } from './context.server';
import { publishV12Shadow } from './shadow.server';
import { ROUTES, V12_VERSION, intervalKey, validateSignal, type Route } from './contract';
import { V12_RECEIVER_BASE, V12_SECRET_ENDPOINTS, isAuthorizedBettingEndpoint } from './receiver-destination';
import { recordRuntime } from './runtime.server';

export { readV12Context, readV12EarlyContext, readV12UContext };
export const ADAPTER_REVISION = 'v12-edge-adapter-r6-status-bridge';
const RECEIVERS = V12_RECEIVER_BASE;
const encoder = new TextEncoder();
const EARLY_LEGS = ['V1', 'T45R2'] as const;
type EarlyLeg = (typeof EARLY_LEGS)[number];

/**
 * Build a V1/T45R2 signal straight from the committed decision the adapter just
 * read. Direction, decision time and market all come from the authoritative row
 * — the worker cannot assert any of them — so a historical or non-current
 * decision can never be dispatched.
 */
function buildEarlySignal(leg: EarlyLeg, context: any, open: number, now: number) {
  const v1 = context.v1, t45 = context.t45;
  if (!v1 || v1.features?.input_valid !== true) return {leg, status: 'V1_INPUT_INVALID'} as const;
  if (leg === 'T45R2' && (!t45 || t45.leg !== 'T45R2' || t45.run_mode !== 'LIVE_SHADOW' ||
      t45.evidence?.trigger_signed !== true)) return {leg, status: 'NOT_COMMITTED'} as const;
  const side = leg === 'V1' ? v1.final_side : t45?.side;
  const offset = leg === 'V1' ? v1.publication_offset_ms : t45?.decision_offset_ms;
  if (![1, -1].includes(side) || typeof offset !== 'number') return {leg, status: 'NOT_COMMITTED'} as const;
  const decision = open + offset;
  if (now < decision) return {leg, status: 'NOT_COMMITTED'} as const;
  if (now - decision > 8000) return {leg, status: 'DECISION_EXPIRED'} as const;
  const r = ROUTES[leg];
  return {leg, status: 'READY', decision, signal: {mode: 'shadow', model_version: r.model,
    combined_model_version: V12_VERSION, leg, execution_policy: r.execution,
    stake_fraction_of_boise_day_opening_principal: r.fraction, market: context.ticker,
    candle_starts_at: new Date(open).toISOString(), decision_at: new Date(decision).toISOString(),
    sent_at: new Date(now).toISOString(), interval_key: intervalKey(context.ticker, new Date(open).toISOString()),
    prediction: side === 1 ? 'YES' : 'NO'} as Record<string, any>} as const;
}


export async function verifyWorkerSignature(raw: string, timestamp: string | null, signature: string | null,
  secret: string, now: number): Promise<boolean> {
  if (!secret || !timestamp || !/^\d{13}$/.test(timestamp) || !signature || !/^[0-9a-f]{64}$/.test(signature) ||
      Math.abs(now - Number(timestamp)) > 10000) return false;
  const key = await crypto.subtle.importKey('raw', encoder.encode(secret), {name:'HMAC',hash:'SHA-256'}, false, ['verify']);
  const bytes = Uint8Array.from(signature.match(/../g)!, h => parseInt(h,16));
  return crypto.subtle.verify('HMAC', key, bytes, encoder.encode(`${timestamp}.${raw}`));
}

async function probeReceivers(sb: any, transport: typeof fetch, now: number) {
  const {data,error} = await sb.from('webhook_endpoints').select('secret,url,is_active').in('url',V12_SECRET_ENDPOINTS);
  if (error) throw error;
  const endpoints = (data ?? []).filter((e:any) => isAuthorizedBettingEndpoint(e.url));
  if (endpoints.length !== 1 || !endpoints[0].secret) throw new Error('SINGLE_BETTING_SECRET_UNAVAILABLE');
  const results = await Promise.all((Object.keys(ROUTES) as Route[]).map(async leg => {
    // Deliberately invalid signal. A signed 400 with this precise error proves
    // authentication and route reachability without recording a fabricated bet.
    const raw = JSON.stringify({mode:'shadow',kind:'V12_READINESS_PROBE',leg,sent_at:new Date(now).toISOString()});
    const signature = createHmac('sha256',endpoints[0].secret).update(raw).digest('hex');
    try {
      const response = await transport(RECEIVERS+ROUTES[leg].endpoint, {method:'POST',body:raw,redirect:'error',
        signal:AbortSignal.timeout(2500),headers:{'x-region':'us-west-1','content-type':'application/json','x-btc15m-signature':'sha256='+signature}});
      const result = await response.json();
      return {leg,authenticated:response.status===200 && result.kind==='V12_READINESS_PROBE',status:response.status,
        ready_for_activation:result.ready_for_activation===true,release_mode:result.mode??null,checks:result.checks??null};
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
  readEarlyContext?: typeof readV12EarlyContext;
  readUContext?: typeof readV12UContext;
  publish?: typeof publishV12Shadow;
  readExecution?: (sb:any)=>Promise<any>;
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
    if (!['context','early_dispatch','publish','probe','heartbeat'].includes(p.op) || typeof p.nonce!=='string' || p.nonce.length<8 || p.nonce.length>120 ||
        !Number.isFinite(open) || open%900000!==0 || now<open || now>=open+900000)
      return reply(400,{ok:false,error:'INVALID_CURRENT_INTERVAL'});
    try {
      const sb=deps.client();
      // `early_dispatch` is polled on the critical path, so it skips the nonce
      // write: its exactly-once guarantee is the durable interval/leg journal
      // claim in publishV12Shadow, which no replay can bypass.
      // U also uses the durable event claim, before any outbound delivery.
      const uPublish=p.op==='publish' && p.signal?.leg==='U';
      if (p.op!=='context' && p.op!=='early_dispatch' && !uPublish) {
        const {error}=await sb.from('c85_request_nonces').insert({nonce:p.nonce,op:'v12-shadow.'+p.op,worker_id:'v12-shadow-worker'});
        if (error?.code==='23505') return reply(409,{ok:false,error:'REPLAYED'});
        if (error) throw new Error('NONCE_STORE_UNAVAILABLE');
      }
      if (p.op==='probe') return reply(200,{ok:true,...await probeReceivers(sb,deps.transport ?? fetch,clock())});
      if (p.op==='heartbeat') return reply(200,{ok:true,...await recordRuntime(sb,p.status,deps.readExecution)});
      if (p.op==='early_dispatch') {
        const requested=Array.isArray(p.legs)?p.legs:EARLY_LEGS;
        const legs=EARLY_LEGS.filter(l=>requested.includes(l));
        if (!legs.length) return reply(400,{ok:false,error:'NO_EARLY_LEGS'});
        const readStarted=clock();
        const early=await (deps.readEarlyContext ?? readV12EarlyContext)(sb,new Date(open).toISOString());
        const contextReadMs=clock()-readStarted;
        if (!early.ready) return reply(200,{ok:true,context_ready:false,reason:(early as any).reason,
          dispatched:[],timings:{context_read_ms:contextReadMs}});
        const dispatched:any[]=[];
        for (const leg of legs) {
          const started=clock();
          const built=buildEarlySignal(leg,early,open,started);
          if (built.status!=='READY') { dispatched.push({leg,status:built.status}); continue; }
          try {
            validateSignal(built.signal,leg,clock());
            const published=await (deps.publish ?? publishV12Shadow)(sb,built.signal,clock());
            dispatched.push({leg,status:'DISPATCHED',receiver_status:published.status??null,
              receiver_mode:published.mode??null,decision_at:built.signal.decision_at,sent_at:built.signal.sent_at,
              decision_to_dispatch_ms:published.timings?.dispatch_at_ms == null ? null : published.timings.dispatch_at_ms-built.decision,
              decision_to_receipt_ms:published.received_at ? Date.parse(published.received_at)-built.decision : null,
              timings:published.timings??null});
          } catch(e) {
            dispatched.push({leg,status:'FAILED',error:e instanceof Error?e.message:'DISPATCH_ERROR'});
          }
        }
        return reply(200,{ok:true,context_ready:true,ticker:early.ticker,dispatched,
          timings:{context_read_ms:contextReadMs,total_ms:clock()-readStarted}});
      }

      const context:any=await (uPublish ? (deps.readUContext ?? readV12UContext) : (deps.readContext ?? readV12Context))(sb,new Date(open).toISOString());
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
      return reply(200,{ok:true,...result,receiver_mode:result.mode,
        receiver_execution_enabled:result.execution_enabled});
    } catch(e) { return reply(400,{ok:false,error:e instanceof Error?e.message:'ADAPTER_ERROR'}); }
  };
}
