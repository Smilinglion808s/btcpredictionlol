import {createRegistryHandler,type Config,json} from "./owner-control.server";
import {createControlProxy} from "./proxy.server";
import {createPinnedProvider,registryFromExistingAdmin} from "./sdk-adapter.server";
import type {SupabaseClient} from "@supabase/supabase-js";
/** Intercept BEFORE importing the ordinary app/error telemetry. No request logging. */
export function createOwnerControlRouter(options?:{config:Config;publicKey:string;serviceOrigin:string;getExistingAdmin:()=>SupabaseClient}){
 let evidence=createRegistryHandler(),proxy=createControlProxy();
 if(options){try{
  evidence=createRegistryHandler(options.config,createPinnedProvider(options.publicKey),registryFromExistingAdmin(options.getExistingAdmin));
  proxy=createControlProxy(options.serviceOrigin);
 }catch{/* Default deny, never log key/error. */}}
 return (request:Request):Promise<Response>|null=>{
  const path=new URL(request.url).pathname;
  if(path==="/api/control"||path.startsWith("/api/control/"))return proxy(request);
  if(path==="/api/owner-control"||path.startsWith("/api/owner-control/")){
   if(!["/api/owner-control/session-evidence","/api/owner-control/enroll","/api/owner-control/revoke"].includes(path))return Promise.resolve(json({error:{code:"NOT_FOUND"}},404));
   return evidence(request);
  }
  return null;
 };
}
