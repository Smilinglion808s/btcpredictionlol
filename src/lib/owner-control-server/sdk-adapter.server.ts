import { isPublicProjectKey } from "./public-project-key";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ISSUER,SafeError,boundedBody,providerFromExistingSdk,type Registry,type Event } from "./owner-control.server";
const TABLE="owner_control_session_events";
/** Existing service-role client remains inside this Lovable server. Never forward it to Python. */
export function registryFromExistingAdmin(getAdmin:()=>SupabaseClient):Registry{
 function pinnedAdmin(){const admin=getAdmin();if((admin as unknown as {supabaseUrl?:unknown}).supabaseUrl!==ISSUER.slice(0,-8))throw new SafeError("REGISTRY_UNCONFIGURED",503);return admin;}
 return {
  async insert(event:Event){
   const {error}=await pinnedAdmin().from(TABLE).upsert(event,{onConflict:"subject,session_id,event_kind",ignoreDuplicates:true}).abortSignal(AbortSignal.timeout(2000));
   if(error)throw new SafeError("REGISTRY_UNAVAILABLE",503);
  },
  async read(subject:string,sessionId:string){
   const {data,error}=await pinnedAdmin().from(TABLE).select("subject,session_id,event_kind,policy_revision").eq("subject",subject).eq("session_id",sessionId).limit(3).abortSignal(AbortSignal.timeout(2000));
   if(error||!data)throw new SafeError("REGISTRY_UNAVAILABLE",503);
   return data as Event[];
  }
 };
}
/** Public API key only. This constructor performs no fetch until a route is used. */
export function createPinnedProvider(publicKey:string){
 if(!isPublicProjectKey(publicKey))throw new SafeError("UNCONFIGURED",503);
 const pinnedFetch:typeof fetch=async(input,init)=>{
  const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);
  if(![ISSUER+"/user",ISSUER+"/.well-known/jwks.json"].includes(url.href)||(init?.method??"GET")!=="GET")throw new SafeError("PROVIDER_TARGET_FORBIDDEN",503);
  const r=await fetch(input,{...init,redirect:"error",credentials:"omit",cache:"no-store",signal:AbortSignal.timeout(2000)});
  const bytes=await boundedBody(r,65536);return new Response(bytes as BodyInit,{status:r.status,headers:{"Content-Type":r.headers.get("Content-Type")??""}});
 };
 const client=createClient(ISSUER.slice(0,-8),publicKey,{auth:{persistSession:false,autoRefreshToken:false,detectSessionInUrl:false},global:{fetch:pinnedFetch}});
 return providerFromExistingSdk(client.auth);
}
