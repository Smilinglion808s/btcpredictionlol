import { confirmedEmail } from "./confirmed-email";
/** LOCAL CANDIDATE ONLY. Never import this module into a browser bundle. */
export const APP = "https://btcpredictionlol.lovable.app";
export const ISSUER = "https://alevdzyisibxcvwoyrqb.supabase.co/auth/v1";
export const POLICY = "app-session-jwt-age300-v1";
const PREFIX = "/api/owner-control/";
export type Claims = {sub:string;session_id:string;iat:number;exp:number;aal:"aal1"|"aal2"};
export type Event = {subject:string;session_id:string;event_kind:"enrolled"|"revoked";policy_revision:string};
export interface Provider { verifiedClaims(token:string):Promise<unknown>; currentUser(token:string):Promise<unknown>; }
export interface Registry { insert(event:Event):Promise<void>; read(subject:string, sessionId:string):Promise<Event[]>; }
export interface Config { ownerSubject:string; policyRevision:typeof POLICY; minimumAal:"aal1"|"aal2"; }
export class SafeError extends Error { constructor(public code:string,public status=403){super(code);} }
function deny(code:string,status=403):never {throw new SafeError(code,status);}
const obj = (v:unknown):Record<string,unknown> => {if(!v||typeof v!=="object"||Array.isArray(v))return deny("AUTH_REQUIRED",401);return v as Record<string,unknown>;};
const uuid=(v:unknown):v is string=>typeof v==="string"&&/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const sec=(v:unknown):v is number=>Number.isSafeInteger(v)&&(v as number)>=0;
export function json(value:unknown,status=200):Response {return Response.json(value,{status,headers:{"Cache-Control":"no-store, private","Pragma":"no-cache","X-Content-Type-Options":"nosniff"}});}
export function safeFailure(error:unknown):Response {return error instanceof SafeError?json({error:{code:error.code}},error.status):json({error:{code:"REGISTRY_UNAVAILABLE"}},503);}
function origin(request:Request){
 const u=new URL(request.url),o=request.headers.get("Origin");
 if(u.origin!==APP||u.search||u.hash||(o!==null&&o!==APP)||(request.method!=="GET"&&o!==APP)||request.headers.get("Sec-Fetch-Site")==="cross-site")deny("ORIGIN_FORBIDDEN");
 return u;
}
export async function boundedBody(source:Request|Response,limit:number):Promise<Uint8Array>{
 const declared=source.headers.get("Content-Length");if(declared!==null&&(!/^\d+$/.test(declared)||Number(declared)>limit))deny("BODY_TOO_LARGE",413);
 if(!source.body)return new Uint8Array();const reader=source.body.getReader();const parts:Uint8Array[]=[];let n=0,chunks=0;
 const end=performance.now()+2000;
 try{for(;;){let timer:ReturnType<typeof setTimeout>|undefined;let result:ReadableStreamReadResult<Uint8Array>;try{result=await Promise.race([reader.read(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new SafeError("BODY_TIMEOUT",408)),Math.max(0,end-performance.now()));})]);}finally{clearTimeout(timer);}const {value,done}=result;if(done)break;n+=value.length;chunks++;if(n>limit||chunks>128)deny("BODY_TOO_LARGE",413);parts.push(value);}}
 finally{void reader.cancel().catch(()=>{});try{reader.releaseLock();}catch{/* Pending reader is canceled without blocking return. */}}
 const out=new Uint8Array(n);let at=0;for(const p of parts){out.set(p,at);at+=p.length;}return out;
}
function bearer(request:Request):string {const h=request.headers.get("Authorization");if(!h||h.length>8192||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(h))deny("AUTH_REQUIRED",401);return h.slice(7);}
function configValid(c:Config|undefined):c is Config{return !!c&&uuid(c.ownerSubject)&&c.policyRevision===POLICY&&(c.minimumAal==="aal1"||c.minimumAal==="aal2");}
export function createRegistryHandler(config?:Config,provider?:Provider,registry?:Registry,now:()=>number=()=>Math.floor(Date.now()/1000)){
 return async(request:Request):Promise<Response>=>{
  let writeAttempted=false;
  try{
   const u=origin(request), action=u.pathname.slice(PREFIX.length);
   if(!u.pathname.startsWith(PREFIX)||!(["session-evidence","enroll","revoke"].includes(action)))deny("NOT_FOUND",404);
   if((action==="session-evidence"&&request.method!=="GET")||(action!=="session-evidence"&&request.method!=="POST"))deny("METHOD_NOT_ALLOWED",405);
   if(!configValid(config)||!provider||!registry)deny("UNCONFIGURED",503);
   if(action!=="session-evidence"){
    if(request.headers.get("Content-Type")?.split(";",1)[0].trim().toLowerCase()!=="application/json"||request.headers.get("X-Owner-Control-Action")!==action)deny("ORIGIN_FORBIDDEN");
    const raw=await boundedBody(request,64);if(new TextDecoder("utf-8",{fatal:true}).decode(raw).trim()!=="{}")deny("INVALID_BODY",400);
   }else if(request.body!==null)deny("INVALID_BODY",400);
   const token=bearer(request), raw=obj(await provider.verifiedClaims(token)), started=now();
   if(!sec(started)||raw.iss!==ISSUER||raw.aud!=="authenticated"||raw.role!=="authenticated"||raw.is_anonymous!==false||!uuid(raw.sub)||!uuid(raw.session_id)||!sec(raw.iat)||!sec(raw.exp)||raw.iat>started||raw.iat>=raw.exp||raw.exp<=started||(raw.nbf!==undefined&&(!sec(raw.nbf)||raw.nbf>started))||(raw.aal!=="aal1"&&raw.aal!=="aal2")||(config.minimumAal==="aal2"&&raw.aal!=="aal2"))deny("AUTH_REQUIRED",401);
   const c=raw as unknown as Claims;
   if(c.sub!==config.ownerSubject)deny("OWNER_FORBIDDEN");
   if(action!=="revoke"&&started>=c.iat+300)deny("TOKEN_TOO_OLD",401);
   const user=obj(await provider.currentUser(token));
   if(user.id!==c.sub||user.is_anonymous!==false||!confirmedEmail(user.email_confirmed_at,now()*1000))deny("OWNER_FORBIDDEN");
   const beforeMutation=now();
   if(!sec(beforeMutation)||beforeMutation<started||beforeMutation-started>2||c.exp<=beforeMutation||(action!=="revoke"&&beforeMutation>=c.iat+300))deny("AUTH_REQUIRED",401);
   if(action!=="session-evidence"){writeAttempted=true;await registry.insert({subject:c.sub,session_id:c.session_id,event_kind:action==="revoke"?"revoked":"enrolled",policy_revision:POLICY});}
   const events=await registry.read(c.sub,c.session_id),finished=now();
   if(!sec(finished)||finished<started||finished-started>2||c.exp<=finished||(action!=="revoke"&&finished>=c.iat+300))deny("AUTH_REQUIRED",401);
   if(!Array.isArray(events)||events.length>2||events.some(e=>!e||e.subject!==c.sub||e.session_id!==c.session_id||!(e.event_kind==="enrolled"||e.event_kind==="revoked")||typeof e.policy_revision!=="string")||new Set(events.map(e=>e.event_kind)).size!==events.length)deny("REGISTRY_UNAVAILABLE",503);
   const revoked=events.some(e=>e.event_kind==="revoked");
   if(action==="revoke")return revoked?json({schema_version:1,revoked:true,scope:"current_provider_session",server_time:finished}):deny("REGISTRY_UNAVAILABLE",503);
   if(revoked)deny("APP_SESSION_REVOKED");
   if(!events.some(e=>e.event_kind==="enrolled"&&e.policy_revision===POLICY))deny("APP_SESSION_ENROLL_REQUIRED");
   if(action==="enroll")return json({schema_version:1,enrolled:true,scope:"current_provider_session",server_time:finished});
   return json({schema_version:1,subject:c.sub,session_id:c.session_id,active:true,observed_at:finished,valid_until:Math.min(c.exp,c.iat+300),policy_revision:POLICY,aal:c.aal,token_iat:c.iat,token_exp:c.exp});
  }catch(e){if(writeAttempted&&!(e instanceof SafeError&&e.code==="APP_SESSION_REVOKED"))return json({error:{code:"REGISTRY_RESULT_UNCERTAIN"}},503);return safeFailure(e);}
 };
}

/** Supplied existing SDK auth object must belong to the pinned issuer. Factory below enforces that. */
export function providerFromExistingSdk(auth:{getClaims(token:string):Promise<{data:{claims:unknown}|null;error:unknown}>;getUser(token:string):Promise<{data:{user:unknown}|null;error:unknown}>;}):Provider{
 return {async verifiedClaims(token){
   // This check narrows algorithms only. getClaims performs actual cryptographic verification.
   let h:Record<string,unknown>;try{
    const raw=atob(token.split(".")[0].replace(/-/g,"+").replace(/_/g,"/"));
    if(raw.length>1024||raw.includes("\\")||/[^\x20-\x7e]/.test(raw))deny("AUTH_REQUIRED",401);
    h=obj(JSON.parse(raw));
    if(!Object.keys(h).every(key=>[...raw.matchAll(new RegExp('"'+key+'"\\s*:',"g"))].length===1))deny("AUTH_REQUIRED",401);
   }catch{return deny("AUTH_REQUIRED",401);}
   if(!["ES256","RS256"].includes(String(h.alg))||typeof h.kid!=="string"||!/^[A-Za-z0-9_-]{1,240}$/.test(h.kid)||(h.typ!==undefined&&h.typ!=="JWT")||Object.keys(h).some(k=>!["alg","kid","typ"].includes(k)))deny("AUTH_REQUIRED",401);
   const {data,error}=await auth.getClaims(token);if(error||!data)deny("AUTH_REQUIRED",401);return data.claims;
 },async currentUser(token){const {data,error}=await auth.getUser(token);if(error||!data)deny("AUTH_REQUIRED",401);return data.user;}};
}
