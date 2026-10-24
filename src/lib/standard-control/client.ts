import {parseStatus,canCommand,STATUS_PATH,COMMAND_PATH,type View,type Command,type Pending} from "./contract";
const JOURNAL = "standard-control-pending-v1";
export class BackendError extends Error {constructor(readonly code:string){super(code)}}
/** Same-origin cookie transport; no bearer, wallet address, signer or URL input. */
export function transport(send:typeof fetch=fetch) {
 return async (path:typeof STATUS_PATH|typeof COMMAND_PATH,body?:Command,csrf?:string) => {
  const abort=new AbortController(), timer=setTimeout(()=>abort.abort(),4000);
  const bounded=<T,>(operation:Promise<T>)=>new Promise<T>((resolve,reject)=>{
   const stop=()=>{cleanup();reject(new Error("Deadline"))};
   const cleanup=()=>abort.signal.removeEventListener("abort",stop);
   abort.signal.addEventListener("abort",stop,{once:true});
   operation.then(v=>{cleanup();resolve(v)},e=>{cleanup();reject(e)});
   if(abort.signal.aborted)stop();
  });
  try {
   if((path!==STATUS_PATH&&path!==COMMAND_PATH)||(path===STATUS_PATH&&body!==undefined)||(path===COMMAND_PATH&&body===undefined))throw new BackendError("INVALID_REQUEST");
   const headers:Record<string,string>={Accept:"application/json"};
   if(body){if(!csrf || !/^[a-f0-9]{64}$/.test(csrf))throw new BackendError("SESSION_UNAVAILABLE");headers["Content-Type"]="application/json";headers["X-CSRF-Token"]=csrf;}
   const r=await bounded(send(path,{method:body?"POST":"GET",headers,body:body?JSON.stringify(body):undefined,credentials:"same-origin",cache:"no-store",redirect:"error",signal:abort.signal}));
   if(r.status!==200)throw new BackendError(r.status===401||r.status===403?"REQUEST_REFUSED":body?"RESULT_UNCERTAIN":"SERVICE_UNAVAILABLE");
   if(r.headers.get("Content-Type")?.split(";",1)[0]!=="application/json")throw new Error();
   const reader=r.body?.getReader();if(!reader)throw new Error();let size=0;const parts:Uint8Array[]=[];
   try {for(;;){const p=await bounded(reader.read());if(p.done)break;size+=p.value.length;if(size>65536)throw new Error();parts.push(p.value)}}catch(e){void reader.cancel().catch(()=>{});throw e}finally{reader.releaseLock()}
   const bytes=new Uint8Array(size);let offset=0;for(const part of parts){bytes.set(part,offset);offset+=part.length;}
   return parseStatus(JSON.parse(new TextDecoder("utf-8",{fatal:true}).decode(bytes)));
  }catch(e){if(e instanceof BackendError)throw e;throw new BackendError(body?"RESULT_UNCERTAIN":"SERVICE_UNAVAILABLE")}finally{clearTimeout(timer)}
 };
}
/** No automatic mutation retry. Only pending command metadata goes to sessionStorage,
 * never cookies/CSRF. Runtime session and command IDs survive reload/uncertain reply.
 * login/session readers reuse the existing SIWS controller and backend port.
 */
export function createClient(options:{login:()=>{id:string;expires:number}|null;readSession:()=>Promise<{session_id:string;csrf_token:string;expires_at:number}>;send:ReturnType<typeof transport>;store:Pick<Storage,"getItem"|"setItem">;wall?:()=>number;mono?:()=>number;id?:()=>string}) {
 const wall=options.wall??Date.now,mono=options.mono??(()=>performance.now()),id=options.id??(()=>crypto.randomUUID());
 let closed=false,epoch=0,binding:string|null=null;
 let view:View={status:null,receivedMono:null,connection:"signed_out",error:null,pending:[],busy:false,journalError:false};
 const listeners=new Set<()=>void>();
 const emit=(patch:Partial<View>)=>{view={...view,...patch};for(const fn of listeners)fn()};
 try{const raw=options.store.getItem(JOURNAL);if(raw){const rows=JSON.parse(raw);if(!Array.isArray(rows)||rows.length>16)throw new Error();for(const r of rows){if(!r||Object.keys(r).sort().join()!=="authSession,command"||typeof r.authSession!=="string"||!r.command||Object.keys(r.command).sort().join()!=="action,command_id,expected_version,session_id"||!["ON","OFF"].includes(r.command.action)||typeof r.command.command_id!=="string"||r.command.command_id.length>128||typeof r.command.session_id!=="string"||!Number.isSafeInteger(r.command.expected_version)||r.command.expected_version<0)throw new Error();}view.pending=rows;}}catch{view.journalError=true;view.error="COMMAND_JOURNAL_UNAVAILABLE"}
 function persist(rows:Pending[]){try{options.store.setItem(JOURNAL,JSON.stringify(rows));emit({pending:rows});return true}catch{emit({journalError:true,error:"COMMAND_JOURNAL_UNAVAILABLE"});return false}}
 function sync(){const session=options.login();const next=session&&session.expires>wall()?session.id:null;if(next!==binding){binding=next;epoch++;emit({status:null,receivedMono:null,connection:next?"loading":"signed_out",busy:false,error:null});}return binding;}
 function accept(s:ReturnType<typeof parseStatus>,auth:string,ticket:number){
  if(closed||ticket!==epoch||sync()!==auth||ticket!==epoch)throw new BackendError("SESSION_CHANGED");
  const login=options.login();if(!login||s.auth_session_id!==auth||s.auth_expires_at_ms>login.expires||s.sampled_at_ms>wall()||wall()-s.sampled_at_ms>5000||s.auth_expires_at_ms<=wall())throw new Error();
  if(view.status?.runtime_session_id===s.runtime_session_id && (s.version<view.status.version||s.sampled_at_ms<view.status.sampled_at_ms))return;
  emit({status:s,receivedMono:mono(),connection:"ready",error:null});
 }
 async function refresh(){const auth=sync(),ticket=epoch;if(!auth||closed)return;try{accept(await options.send(STATUS_PATH),auth,ticket)}catch{if(!closed&&ticket===epoch)emit({connection:"unavailable",error:"STATUS_UNAVAILABLE"})}}
 async function dispatch(p:Pending){const auth=sync(),ticket=epoch;if(!auth||auth!==p.authSession||closed)return;
  emit({busy:true,error:null});
  try{const session=await options.readSession();if(closed||ticket!==epoch||sync()!==auth||ticket!==epoch||session.session_id!==auth||session.expires_at*1000<=wall())throw new BackendError("SESSION_CHANGED");
   // A runtime change requires review, never replay into a new runtime.
   if(view.status?.runtime_session_id!==p.command.session_id)throw new BackendError("RUNTIME_CHANGED");
   const result=await options.send(COMMAND_PATH,p.command,session.csrf_token);
   if(result.command?.command_id!==p.command.command_id)throw new Error();
   accept(result,auth,ticket);
   if(!closed&&ticket===epoch){
    if(result.command.phase!=="pending")persist(view.pending.filter(x=>x.command.command_id!==p.command.command_id));
    if(result.command.phase!=="applied")emit({error:"COMMAND_NOT_APPLIED"});
   }
  }catch(e){if(!closed&&ticket===epoch)emit({error:e instanceof BackendError?e.code:"RESULT_UNCERTAIN"})}finally{if(!closed&&ticket===epoch)emit({busy:false})}
 }
 return {snapshot:()=>view,subscribe:(fn:()=>void)=>{listeners.add(fn);return()=>{listeners.delete(fn)}},sync,refresh,
  async command(action:"ON"|"OFF"){const auth=sync();const status=view.status;if(!auth||!status||closed||!canCommand(view,action,wall(),mono())||view.pending.length>=16)return;
   const p:Pending={authSession:auth,command:{command_id:id(),session_id:status.runtime_session_id,expected_version:status.version,action}};
   if(persist([...view.pending,p]))await dispatch(p);
  },
  async retry(commandId:string){sync();const p=view.pending.find(x=>x.command.command_id===commandId);if(!p||closed||view.busy||view.journalError)return;
   // ON retry must still meet current readiness and freshness. No new ID/version.
   if(p.command.action==="ON"&&(!view.status?.on_permitted||view.connection!=="ready"||wall()-view.status.sampled_at_ms>5000))return;
   await dispatch(p);
  },
  close(){closed=true;epoch++;listeners.clear();}
 };
}
