// Signed worker adapter. It can read context and publish recording-only events.
import {createFileRoute} from '@tanstack/react-router';
import {verifyC85Signature} from '@/lib/c85/gateway.server';
import {claimNonce,serviceClient} from '@/lib/c85/ops.server';
import {readV12Context} from '@/lib/v12/context.server';
import {publishV12Shadow} from '@/lib/v12/shadow.server';
import {validateSignal} from '@/lib/v12/contract';

export const Route=createFileRoute('/api/public/hooks/v12-shadow')({server:{handlers:{
  POST:async({request})=>{
    const raw=await request.text();
    if(raw.length>32768)return new Response('Too large',{status:413});
    if(!verifyC85Signature(raw,request.headers.get('x-c85-timestamp'),request.headers.get('x-c85-signature'),10000))
      return new Response('Unauthorized',{status:401});
    let p:any;
    try{p=JSON.parse(raw);}catch{return new Response('Invalid JSON',{status:400});}
    if(!p || typeof p!=='object' || Array.isArray(p))return new Response('Invalid envelope',{status:400});
    const now=Date.now(),open=Date.parse(p.open);
    if(!['context','publish'].includes(p.op) || typeof p.nonce!=='string' || p.nonce.length<8 || p.nonce.length>120 ||
      !Number.isFinite(open) || open%900000!==0 || now<open || now>=open+900000)
      return new Response('Invalid current interval',{status:400});
    const sb=serviceClient();
    try{
      if(p.op==='publish' && !await claimNonce(sb,p.nonce,'v12-shadow.publish','v12-shadow-worker'))return new Response('Replayed',{status:409});
      const context=await readV12Context(sb,new Date(open).toISOString());
      if(p.op==='context')return Response.json({ok:true,context,observed_at:new Date().toISOString()});
      const signal=p.signal;
      if(!context.ready || !signal || signal.market!==context.ticker || Date.parse(signal.candle_starts_at)!==open)
        throw new Error('CONTEXT_MISMATCH');
      if(signal.leg==='U'){
        if(!context.u_eligible)throw new Error('U_NOT_ELIGIBLE');
        signal.v11_eligibility=context.eligibility;
      }else{
        const v1=context.v1,t45=context.t45;
        if(!v1 || v1.features?.input_valid!==true)throw new Error('V1_INPUT_INVALID');
        if(signal.leg!=='V1' && signal.leg!=='T45R2')throw new Error('UNKNOWN_ROUTE');
        const side=signal.leg==='V1'?v1.final_side:t45?.side;
        if((signal.leg==='T45R2' && (!t45 || t45.leg!=='T45R2' || t45.run_mode!=='LIVE_SHADOW' || t45.evidence?.trigger_signed!==true)) ||
          ![1,-1].includes(side) || signal.prediction!==(side===1?'YES':'NO'))throw new Error('COMMITTED_DIRECTION_MISMATCH');
        const offset=signal.leg==='V1'?v1.publication_offset_ms:t45?.decision_offset_ms;
        if(typeof offset!=='number' || Math.abs(Date.parse(signal.decision_at)-(open+offset))>1)throw new Error('DECISION_TIME_MISMATCH');
      }
      validateSignal(signal,signal.leg,Date.now());
      const result=await publishV12Shadow(sb,signal);
      return Response.json({ok:true,...result});
    }catch(e){return Response.json({ok:false,error:e instanceof Error?e.message:'ADAPTER_ERROR'},{status:400});}
  },
}}});
