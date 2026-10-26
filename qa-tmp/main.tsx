import { createRoot } from "react-dom/client";
import { useState } from "react";
import { StandardOnConfirmation } from "../src/components/standard-on-confirmation";
function make(){
 let ls=new Set<()=>void>();const st:any={calls:0,frozen:false,patch:{} as any};
 const build=()=>({status:{auth_session_id:"a1",runtime_session_id:"r1",version:1,sampled_at_ms:Date.now(),auth_expires_at_ms:Date.now()+600000,valid_for_ms:5000,on_permitted:true,...st.patch.status},receivedMono:performance.now(),connection:"ready",error:null,pending:[],busy:false,journalError:false,timing:null,...st.patch.view});
 let v=build();
 const c:any={subscribe:(f:()=>void)=>{ls.add(f);return()=>ls.delete(f)},snapshot:()=>v,sync:()=>{},command:async()=>{st.calls++},
  fresh:()=>{v=build();ls.forEach(f=>f())},silent:(p:any)=>{st.patch=p;v=build()},set:(p:any)=>{st.patch=p;v=build();ls.forEach(f=>f())},st};
 return c;}
function App(){const [c,setC]=useState(()=>make());const [on,setOn]=useState(true);(window as any).qa={get c(){return c},replace:()=>setC(make()),unmount:()=>setOn(false)};
 return <div className="p-4 text-white"><div className="flex flex-wrap gap-2">{on&&<StandardOnConfirmation client={c}/>}</div></div>}
createRoot(document.getElementById("r")!).render(<App/>);
