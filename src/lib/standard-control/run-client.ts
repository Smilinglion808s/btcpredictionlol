import {readAgeProof,newReadId,READ_ID} from "./freshness";
import { RUN_PATH, parseRun } from "./run-contract";
/** One authenticated read; caller's existing session/poll lifecycle owns use. */
export async function readRun(send: typeof fetch = fetch, now: () => number = Date.now, timingOptions:{mono?:()=>number;nonce?:()=>string}={}) {
 const mono=timingOptions.mono??(()=>performance.now()),started=mono(),readId=(timingOptions.nonce??newReadId)();
 const controller=new AbortController();let timer:ReturnType<typeof setTimeout>|undefined;
 try {
  const operation=async()=>{
   const response=await send(RUN_PATH,{method:"GET",credentials:"same-origin",cache:"no-store",redirect:"error",signal:controller.signal,headers:{Accept:"application/json",[READ_ID]:readId}});
   if(response.status!==200) return {availability:"unavailable" as const,run:null,reason:response.status===401||response.status===403?"LOGIN_REQUIRED":"BACKEND_UNAVAILABLE"};
   if(!response.body) throw Error();
   const reader=response.body.getReader();let size=0;const chunks:Uint8Array[]=[];
   try {while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>65536||controller.signal.aborted)throw Error();chunks.push(value);}}
   catch(e){void reader.cancel();throw e;}finally{reader.releaseLock();}
   const data=new Uint8Array(size);let offset=0;for(const b of chunks){data.set(b,offset);offset+=b.length;}
   const value=JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(data));
   const timing=readAgeProof(response.headers,readId,started,mono(),"run");
   // Proxy already validates freshness; request-bound timing adds full RTT.
   // Raw timestamp is used here only for structural parsing, never restamped.
   return {availability:"available" as const,run:parseRun(value,value.observed_at_ms),reason:null,timing};
  };
  return await Promise.race([operation(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Error());},3000);})]);
 } catch {return {availability:"unavailable" as const,run:null,reason:"STALE_OR_UNAVAILABLE"};}
 finally{if(timer)clearTimeout(timer);controller.abort();}
}
