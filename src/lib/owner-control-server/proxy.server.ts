import {APP,SafeError,boundedBody,json,safeFailure} from "./owner-control.server";
const validPath=(m:string,p:string)=>(m==="GET"&&(["/api/control/session","/api/control/status"].includes(p)||/^\/api\/control\/commands\/[A-Za-z0-9_-]{1,240}$/.test(p)))||(m==="POST"&&p==="/api/control/commands");
export function createControlProxy(serviceOrigin?:string,send:typeof fetch=fetch){
 let pinned:string|undefined;try{const u=new URL(serviceOrigin??"");if(u.protocol==="https:"&&u.origin===serviceOrigin&&/^[a-z0-9-]+\.up\.railway\.app$/.test(u.hostname))pinned=u.origin;}catch{/* Default deny. */}
 return async(request:Request):Promise<Response>=>{
  let submitted=false;
  try{
   const u=new URL(request.url),o=request.headers.get("Origin");
   if(u.origin!==APP||u.search||u.hash||(o!==null&&o!==APP)||(request.method!=="GET"&&o!==APP)||request.headers.get("Sec-Fetch-Site")==="cross-site")throw new SafeError("ORIGIN_FORBIDDEN");
   if(!validPath(request.method,u.pathname))throw new SafeError("NOT_FOUND",404);
   if(!pinned)throw new SafeError("CONTROL_SERVICE_UNCONFIGURED",503);
   const auth=request.headers.get("Authorization");if(!auth||auth.length>8192||!/^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(auth))throw new SafeError("AUTH_REQUIRED",401);
   const headers=new Headers({Authorization:auth,Accept:"application/json",Origin:APP});let body:Uint8Array|undefined;
   if(request.method==="POST"){
    if(request.headers.get("Content-Type")?.split(";",1)[0].trim().toLowerCase()!=="application/json")throw new SafeError("JSON_CONTENT_TYPE_REQUIRED",415);
    const csrf=request.headers.get("X-CSRF-Token");if(!csrf||csrf.length>1024)throw new SafeError("CSRF_FORBIDDEN");
    body=await boundedBody(request,8192);if(!body.length)throw new SafeError("INVALID_BODY",400);
    headers.set("Content-Type","application/json");headers.set("X-CSRF-Token",csrf);
   }else if(request.body!==null)throw new SafeError("INVALID_BODY",400);
   submitted=request.method==="POST";
   const upstream=await send(pinned+u.pathname,{method:request.method,headers,body:body as BodyInit|undefined,redirect:"error",credentials:"omit",cache:"no-store",signal:AbortSignal.timeout(12000)});
   if(upstream.status<200||upstream.status>=600||upstream.status===204||(upstream.status>=300&&upstream.status<400)||upstream.headers.get("Content-Type")?.split(";",1)[0].trim().toLowerCase()!=="application/json")throw new SafeError("CONTROL_SERVICE_UNAVAILABLE",503);
   const bytes=await boundedBody(upstream,65536);
   // Never propagate headers/cookies/redirects/exception text from the service.
   let value:unknown;try{value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes));}catch{throw new SafeError("CONTROL_SERVICE_UNAVAILABLE",503);}
   return json(value,upstream.status);
  }catch(error){
   if(submitted)return json({error:{code:"CONTROL_RESULT_UNCERTAIN"}},503);
   if(error instanceof SafeError)return safeFailure(error);
   // A POST may have committed. Client must use same-id receipt lookup, never automatic replay.
   return json({error:{code:request.method==="POST"?"CONTROL_RESULT_UNCERTAIN":"CONTROL_SERVICE_UNAVAILABLE"}},503);
  }
 };
}
