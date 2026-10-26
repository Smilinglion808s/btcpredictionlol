import { StandardRunStatus } from "./standard-run-status";
import { StandardOnConfirmation } from "./standard-on-confirmation";
import { useEffect, useState, useSyncExternalStore } from "react";
import type { WalletLoginController } from "../lib/wallet-siws/controller";
import { WalletSessionStatus } from "../lib/wallet-siws/wallet-login-header";
import { createWalletBackend } from "../lib/wallet-siws/browser-transport";
import { parseSession, PUBLIC_ORIGIN, PUBLIC_URI, STATEMENT } from "../lib/wallet-siws/contract";
import { createClient, transport } from "../lib/standard-control/client";
import { fresh, canCommand } from "../lib/standard-control/contract";

const loginConfig={origin:PUBLIC_ORIGIN,uri:PUBLIC_URI,statement:STATEMENT,chainId:"solana:mainnet" as const} as const;
/** Mounted INSIDE the existing SIWS provider. No signer or trading-wallet key here. */
export function StandardBackendControls({controller}:{controller:WalletLoginController}) {
 const [client,setClient]=useState<ReturnType<typeof createClient>|null>(null);
 useEffect(()=>{
  const backend=createWalletBackend({origin:window.location.origin,isTopLevel:window.top===window});
  let store:Pick<Storage,"getItem"|"setItem">;
  try{store=window.sessionStorage}catch{store={getItem(){throw new Error()},setItem(){throw new Error()}}}
  const c=createClient({
   login:()=>{const s=controller.getSnapshot();return s.phase==="authenticated"&&s.session?{id:s.session.sessionId,expires:Date.parse(s.session.expiresAt)}:null;},
   readSession:async()=>parseSession(await backend.readSession(),loginConfig,Date.now()),
   send:transport(),store,
  });
  let reading=false;
  const refresh=async()=>{c.sync();if(reading)return;reading=true;try{await c.refresh()}finally{reading=false}};
  const off=controller.subscribe(()=>{c.sync();void refresh()});
  setClient(c);void refresh();
  const timer=setInterval(()=>{c.sync();if(document.visibilityState==="visible")void refresh()},2000);
  const visible=()=>{c.sync();if(document.visibilityState==="visible")void refresh()};
  document.addEventListener("visibilitychange",visible);
  return()=>{clearInterval(timer);off();document.removeEventListener("visibilitychange",visible);c.close()};
 },[controller]);
 return client?<Controls client={client}/>:<p>Backend state unavailable. No command sent.</p>;
}
function Controls({client}:{client:ReturnType<typeof createClient>}) {
 const v=useSyncExternalStore(client.subscribe,client.snapshot,client.snapshot);
 const [,setRenderTick]=useState(0);
 useEffect(()=>{const t=setInterval(()=>setRenderTick(tick=>tick+1),500);return()=>clearInterval(t)},[]);
 // Responses render between timer ticks: sample now, not the previous tick.
 const clock={wall:Date.now(),mono:performance.now()};
 const current=fresh(v,clock.wall,clock.mono),s=v.status;
 return <section aria-label="Backend trading controls" className="space-y-5 rounded-2xl border border-cyan-500/25 bg-slate-950/40 p-4 text-slate-100 sm:p-6">
  <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-xs font-semibold uppercase tracking-[0.2em] text-cyan-300">Solana copy desk</p><h2 className="mt-1 text-2xl font-semibold">Bot controls</h2><p className="mt-2 max-w-2xl text-sm text-slate-400">Your backend is the source of truth. Connecting a wallet or opening this page never starts trading.</p></div><span className="rounded-full border border-slate-600 px-3 py-1 text-xs">{current?s?.mode:"Status unavailable"}</span></div>
  <WalletSessionStatus/>
  <div role="status" aria-live="polite">
   <strong>{current?`Backend mode: ${s?.mode}`:s?`State stale or unavailable · last acknowledged ${s.mode}`:"Backend state unavailable"}</strong>
   {s&&<details className="mt-2 text-xs text-slate-400"><summary className="cursor-pointer">Session details</summary><p className="mt-2 break-all">Session {s.runtime_session_id} · version {s.version} · sampled {new Date(s.sampled_at_ms).toISOString()} · {s.dataset}</p></details>}
   <p>{current&&s?.entry_enabled?"Entries enabled by backend acknowledgment.":"No current acknowledgment that entries are enabled."}</p>
  </div>
  <div className="flex flex-wrap gap-2">
   <StandardOnConfirmation client={client}/>
   <button className="rounded-lg border border-rose-400/60 px-5 py-3 font-semibold text-rose-200 disabled:cursor-not-allowed disabled:opacity-40" type="button" disabled={!canCommand(v,"OFF",clock.wall,clock.mono)} onClick={()=>void client.command("OFF")}>Stop new entries (OFF)</button>
   <button className="rounded-lg border border-slate-600 px-4 py-3 text-sm" type="button" onClick={()=>void client.refresh()}>Refresh status</button>
  </div>
  <p className="rounded-lg border border-slate-700 bg-slate-900/50 p-3 text-sm text-slate-300">OFF stops new entries while existing exits and unresolved orders continue to be managed. OFF is not a sale. Signing out does not switch the backend OFF. Emergency HALT stops processing and requires separate authorized recovery; this panel does not clear it.</p>
  <p className="text-xs">Wallet login authenticates owner controls. It does not provide the bot signer or grant unattended signing. ON requires authenticated backend readiness, reviewed limits and explicit activation approval. No live-readiness claim is made here.</p>
  {!!s?.blockers.length&&<p>ON unavailable: {s.blockers.join(", ")}</p>}
  {v.error&&<p role="alert">{v.error}. A missing response is not an OFF acknowledgment.</p>}
  {!!s?.errors.length&&<p>Backend conditions: {s.errors.join(", ")}</p>}
  {v.diagnostic&&<details className="rounded-lg border border-slate-700 p-3 text-xs text-slate-400"><summary>Connection details</summary><p>HTTP: {v.diagnostic.httpStatus??"unavailable"} · Proxy: {v.diagnostic.proxyFailure??"not reported"} · Code: {v.diagnostic.publicCode??"not reported"} · Check: {v.diagnostic.category}</p><p>No account or authentication values are included. These details do not enable trading.</p></details>}
  <StandardRunStatus client={client} view={v}/>
  <details className="rounded-xl border border-slate-700 p-4" open={!s || !s.on_permitted}><summary className="cursor-pointer font-semibold">Before you can start</summary><ul className="mt-3 space-y-2 text-sm text-slate-300"><li>1. Sign in to owner controls with the approved wallet.</li><li>2. Confirm the dedicated bot wallet, backend connection and configured limits.</li><li>3. Review the backend's readiness and run status, then explicitly request ON.</li></ul><p className="mt-3 text-xs text-slate-400">The planned run uses fixed-size buys, one position at a time, and reuses sale proceeds without compounding. Required allocation, per-buy amount and cost limits must come from reviewed backend configuration. They are not set by this page.</p></details>
  <h3 className="border-t border-slate-700 pt-5 text-lg font-semibold">Current position</h3>
  {!current?<p>Current inventory unavailable. Last observed exposure, if shown below, remains unresolved until refreshed.</p>:!s?.positions.length?<p>No current position recorded in this backend session.</p>:null}
  {s?.positions.map(p=><div key={p.position_id} className="break-all rounded-xl border border-slate-700 p-4">
   <p>{p.state}{!current?" · last observed":""} · {p.mint}</p>
   <p>Position {p.position_id} · source …{p.source_wallet.slice(-4)}</p>
   <p>Raw units: {current&&p.units!==null?p.units:"unavailable"} · last accounted {p.last_accounted_units}{p.quarantined?" · QUARANTINED":""}</p>
  </div>)}
  <h3 className="border-t border-slate-700 pt-5 text-lg font-semibold">Buy / sell activity</h3>
  {!s?<p>Unavailable.</p>:<><p>{s.activity_total} recorded orders in this backend session{!current?" at last refresh":""}{s.activity_truncated?" · showing latest 20 journal entries":""}. A send acknowledgment is not a fill.</p>
   <ul className="mt-3 space-y-2">{!s.activity.length&&<li className="rounded-lg border border-dashed border-slate-700 p-4 text-sm text-slate-400">No recorded orders in this backend session.</li>}{s.activity.map(a=><li className="break-all rounded-lg border border-slate-700 p-3 text-sm" key={a.order_id}>{a.side} · {a.state} · {a.order_id} · receipt {a.receipt_status??"unavailable"} {a.commitment??""} · fee {a.network_fee_lamports??"unavailable"} lamports</li>)}</ul></>}
  {!!v.pending.length&&<div><h3>Unacknowledged commands</h3><p>No automatic retries. Rechecking sends the exact same command ID/version. A changed session needs review; it is never replayed into a new session.</p>
   {v.pending.map(p=><p key={p.command.command_id}>{p.command.action} · {p.command.command_id} <button type="button" disabled={v.busy||v.journalError||s?.runtime_session_id!==p.command.session_id||s?.auth_session_id!==p.authSession} onClick={()=>void client.retry(p.command.command_id)}>Recheck same command</button></p>)}
  </div>}
  <p className="text-xs">This panel is independent of the historical paper monitor below. Paper results are never substituted for backend balance, activity or exposure.</p>
 </section>;
}
