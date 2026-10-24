import type { readRun } from './run-client';
export type RunResult = Awaited<ReturnType<typeof readRun>>;
export type Binding = {auth:string;runtime:string};
export const sameBinding=(a:Binding|null,b:Binding|null)=>!!a&&!!b&&a.auth===b.auth&&a.runtime===b.runtime;
/** Local read sequencing only; this object never sends control commands. */
export function runReads() {
 let generation=0,sequence=0,accepted=0,binding:Binding|null=null,lastObserved=-1;
 return {
  bind(next:Binding|null){if(!sameBinding(binding,next)){generation++;binding=next;lastObserved=-1;accepted=0;}},
  begin(){return {generation,sequence:++sequence,binding};},
  accept(ticket:{generation:number;sequence:number;binding:Binding|null},result:RunResult,current:Binding|null){
   if(ticket.generation!==generation||ticket.sequence<accepted||!sameBinding(ticket.binding,current)||!sameBinding(binding,current))return false;
   if(result.availability==='available'){
    if(result.run.runtime_session_id!==current?.runtime||Number(result.run.observed_at_ms)<lastObserved)return false;
    lastObserved=Number(result.run.observed_at_ms);
   }
   accepted=ticket.sequence;return true;
  },
 };
}
export function runDisplay(result:RunResult|null,now:number,receivedMono:number|null,mono:number,statusFresh:boolean){
 const run=result?.availability==='available'?result.run:null;
 if(!run||!statusFresh||receivedMono===null||mono<receivedMono||mono-receivedMono>5000||now<Number(run.observed_at_ms)||now-Number(run.observed_at_ms)>5000)return null;
 const end=typeof run.entries_until_ms==='number'?run.entries_until_ms:null;
 const remaining=end===null?null:Math.max(0,end-now);
 return {run,remaining,expired:end!==null&&now>=end};
}
export function sol(value:unknown){
 if(typeof value!=='string'||!/^(0|[1-9][0-9]*)$/.test(value))return 'Not configured';
 const n=BigInt(value),fraction=(n%1000000000n).toString().padStart(9,'0').replace(/0+$/,'');
 return `${n/1000000000n}${fraction?'.'+fraction:''} SOL`;
}
export function duration(ms:number){const seconds=Math.floor(ms/1000);return `${Math.floor(seconds/3600)}h ${Math.floor(seconds/60)%60}m ${seconds%60}s`;}
