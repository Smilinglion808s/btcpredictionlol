import {useEffect,useRef,useState} from 'react';
import type {createClient} from '../lib/standard-control/client';
import {fresh,type View} from '../lib/standard-control/contract';
import {readRun} from '../lib/standard-control/run-client';
import {runReads,runDisplay,sol,duration,sameBinding,type Binding,type RunResult} from '../lib/standard-control/run-view';

/** Authenticated sidecar read; cannot enable, renew or stop a run. */
export function StandardRunStatus({client,view}:{client:ReturnType<typeof createClient>;view:View}){
 // Sidecar responses also render independently of the parent timer.
 const clock={wall:Date.now(),mono:performance.now()};
 const currentBinding=():Binding|null=>{const v=client.snapshot();return fresh(v,Date.now(),performance.now())&&v.status?{auth:v.status.auth_session_id,runtime:v.status.runtime_session_id}:null;};
 const binding=fresh(view,clock.wall,clock.mono)&&view.status?{auth:view.status.auth_session_id,runtime:view.status.runtime_session_id}:null;
 const tracker=useRef(runReads());
 const [data,setData]=useState<{result:RunResult;received:number;binding:Binding}|null>(null);
 useEffect(()=>{
  tracker.current.bind(binding);setData(null);if(!binding)return;
  let closed=false,busy=false;
  const poll=async()=>{
   if(closed||busy||document.visibilityState!=='visible'||!sameBinding(binding,currentBinding()))return;
   busy=true;const ticket=tracker.current.begin();
   try{const result=await readRun();if(!closed&&tracker.current.accept(ticket,result,currentBinding()))setData({result,received:performance.now(),binding});}finally{busy=false;}
  };
  void poll();const timer=setInterval(()=>void poll(),2000);const visible=()=>void poll();document.addEventListener('visibilitychange',visible);
  return()=>{closed=true;clearInterval(timer);document.removeEventListener('visibilitychange',visible);tracker.current.bind(null);};
 },[binding?.auth,binding?.runtime]);
 const display=runDisplay(data&&sameBinding(data.binding,binding)?data.result:null,clock.wall,data?.received??null,clock.mono,!!binding);
 const run=display?.run,policy=run?.policy as Record<string,unknown>|undefined;
 const balance=run?.actual_balance as {lamports:unknown;received:{wall_ms:number}}|null|undefined;
 return <div className="grid gap-3 sm:grid-cols-2" aria-label="Authenticated run status">
  <div className="rounded-xl border border-slate-700 p-4"><p className="text-xs uppercase tracking-wide text-slate-400">Wallet balance</p><p className="mt-2 text-xl font-semibold">{balance&&typeof balance.lamports==='string'?sol(balance.lamports):'Unavailable'}</p><p className="mt-2 text-xs text-slate-400">{balance?`Last observed ${new Date(balance.received.wall_ms).toISOString()}. Not a fresh spendability guarantee.`:'No authenticated balance observation is available. Allocation is a limit, not proof of funds.'}</p></div>
  <div className="rounded-xl border border-slate-700 p-4"><p className="text-xs uppercase tracking-wide text-slate-400">Run & countdown</p><p className="mt-2 text-xl font-semibold">{!display?'Run status unavailable':display.expired?'Entry window expired':String(run?.state)}</p><p className="mt-2 text-sm">{display?.remaining!==null&&display?.remaining!==undefined?`${duration(display.remaining)} left in entry window`:'No current authenticated run countdown'}</p><p className="mt-2 text-xs text-slate-400">{display?'The countdown does not enable trading. OFF or expiry stops new entries; existing exposure follows the backend’s exit permission.':'Sign in and refresh backend status. Stale or mismatched run data is not displayed as current.'}</p></div>
  {run&&<div className="rounded-xl border border-slate-700 p-4 sm:col-span-2"><p className="font-semibold">Configured run limits</p><p className="mt-2 text-sm">Allocation {sol(policy?.allocation_lamports)} · Fixed buy {sol(policy?.entry_lamports)} · One position at a time</p><p className="mt-2 text-xs text-slate-400">Sale proceeds are reused without increasing the fixed buy size. Closing the page or logging out does not stop an authorized run. A server restart requires manual re-enable for new entries.</p><details className="mt-3 text-xs text-slate-400"><summary>Run details</summary><p className="mt-2 break-all">Run {String(run.run_id??'not authorized')} · observed {new Date(Number(run.observed_at_ms)).toISOString()} · exit permission {run.exit_permission?'allowed by backend':'not granted'}</p></details></div>}
 </div>;
}
