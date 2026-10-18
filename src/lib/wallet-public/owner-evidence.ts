/** Display/public-account gate only. Never a replacement for server command authorization. */
export const SESSION_POLICY = 'app-session-jwt-age300-v1' as const;
export type OwnerEvidenceReader = () => Promise<unknown>;
export type OwnerPhase = 'unknown' | 'checking' | 'current' | 'expired' | 'unavailable' | 'revoked' | 'closed';
export type OwnerInvalidation = 'session_changed' | 'signed_out' | 'navigation' | 'revoked';
export interface OwnerView { readonly phase: OwnerPhase; readonly generation: number; readonly validUntil: number | null; }
export interface OwnerProjection {
 snapshot(): OwnerView;
 subscribe(listener: () => void): () => void;
 refresh(): Promise<OwnerView>;
 invalidate(reason?: OwnerInvalidation): OwnerView;
 close(): void;
}
export interface EvidenceAdapter {
 readonly available: boolean;
 readonly ownerApiAvailable?: boolean;
 transact<T>(work: (lease: { ownerRequest?: (request: { kind: 'session-evidence' }) => Promise<unknown> }) => Promise<T>): Promise<T>;
}
/** Existing adapter owns bearer transport and current-provider/session verification. No token escapes. */
export function ownerEvidenceReader(adapter: EvidenceAdapter): OwnerEvidenceReader {
 return async () => {
  if (adapter.available !== true || adapter.ownerApiAvailable !== true) throw new Error('OWNER_EVIDENCE_UNAVAILABLE');
  return adapter.transact(async lease => {
   if (typeof lease.ownerRequest !== 'function') throw new Error('OWNER_EVIDENCE_UNAVAILABLE');
   return lease.ownerRequest({ kind: 'session-evidence' });
  });
 };
}
const KEYS = ['schema_version','subject','session_id','active','observed_at','valid_until','policy_revision','aal','token_iat','token_exp'].sort();
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const integer = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
function parseEvidence(input: unknown, now: number): { binding: string; deadline: number } {
 if (!input || typeof input !== 'object' || Array.isArray(input) || ![Object.prototype,null].includes(Object.getPrototypeOf(input))) throw new Error('EVIDENCE');
 const d = Object.getOwnPropertyDescriptors(input);
 if (Reflect.ownKeys(input).length !== KEYS.length || Object.keys(d).sort().join('|') !== KEYS.join('|') || Object.values(d).some(p => !Object.hasOwn(p,'value'))) throw new Error('EVIDENCE');
 const v = Object.fromEntries(Object.entries(d).map(([k,p])=>[k,p.value]));
 if (v.schema_version !== 1 || v.active !== true || !uuid(v.subject) || !uuid(v.session_id) || v.policy_revision !== SESSION_POLICY || !['aal1','aal2'].includes(v.aal) || !integer(v.observed_at) || !integer(v.valid_until) || !integer(v.token_iat) || !integer(v.token_exp) || v.token_iat > now || v.token_exp <= now || v.token_iat >= v.token_exp || v.observed_at > now+2 || v.observed_at < now-10 || v.valid_until !== Math.min(v.token_exp,v.token_iat+300) || v.valid_until <= now || v.valid_until <= v.observed_at) throw new Error('EVIDENCE');
 // Use the existing server policy deadline, not an arbitrary UI timeout. Remote revocation can still occur between reads.
 return { binding: v.subject + '/' + v.session_id, deadline: v.valid_until };
}
export function createOwnerProjection(reader: OwnerEvidenceReader, options: { nowMs?: () => number; timeoutMs?: number } = {}): OwnerProjection {
 const nowMs=options.nowMs??Date.now;
 const timeoutMs=options.timeoutMs??10000;
 if (!Number.isSafeInteger(timeoutMs) || timeoutMs<1 || timeoutMs>30000) throw new Error('Invalid timeout');
 let phase: OwnerPhase='unknown', generation=0, epoch=0, closed=false, binding:string|null=null, deadline:number|null=null, lastMs:number|null=null;
 let active: Promise<OwnerView>|null=null, refreshing=false, clockFailed=false;
 const listeners=new Set<()=>void>();
 const view=():OwnerView=>Object.freeze({phase,generation,validUntil:phase==='current'?deadline:null});
 const emit=()=>{for(const listener of [...listeners]) { try{listener();}catch{/* A broken view cannot restore evidence. */} }};
 function clear(next:OwnerPhase) { epoch++; generation++; phase=next; binding=null; deadline=null; emit(); }
 function time():number|null {
  if(clockFailed)return null;
  let n:number; try{n=nowMs();}catch{clockFailed=true;if(!closed)clear('unavailable');return null;}
  if (!Number.isSafeInteger(n) || n<0 || (lastMs!==null&&n<lastMs)) { clockFailed=true;if(!closed)clear('unavailable'); return null; }
  lastMs=n; return Math.floor(n/1000);
 }
 function expire():void {
  if(closed)return;
  const n=time();
  if(n!==null&&deadline!==null&&n>=deadline)clear('expired');
 }
 const api:OwnerProjection={
  snapshot(){expire();return view();},
  subscribe(listener){if(closed)return()=>{};listeners.add(listener);expire();return()=>listeners.delete(listener);},
  refresh(){
   if(closed)return Promise.resolve(view());
   const before=epoch; const shouldExpire=deadline!==null;
   expire();
   // Expiry emits synchronously; a subscriber may revoke or close during that notification.
   if(closed || (epoch!==before && !(shouldExpire&&phase==='expired'&&epoch===before+1)))return Promise.resolve(view());
   if(active)return active;
   if(refreshing||clockFailed)return Promise.resolve(view());
   refreshing=true;
   const ticket=++epoch; phase='checking'; emit();
   if(closed||ticket!==epoch){refreshing=false;return Promise.resolve(view());}
   let timer:ReturnType<typeof setTimeout>|undefined;
   const work=(async()=>{
    try{
     const result=await Promise.race([Promise.resolve().then(()=>{if(closed||ticket!==epoch)throw new Error('STALE');return reader();}),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error('TIMEOUT')),timeoutMs);})]);
     if(closed||ticket!==epoch)return view();
     const n=time(); if(n===null||closed||ticket!==epoch)return view();
     // Preserve the old deadline during checking so an expired binding cannot be renewed silently.
     if(deadline!==null&&n>=deadline){clear('expired');return view();}
     const parsed=parseEvidence(result,n);
     if(closed||ticket!==epoch)return view();
     if(binding!==parsed.binding)generation++;
     binding=parsed.binding;deadline=parsed.deadline;phase='current';emit();return view();
    }catch{
     if(!closed&&ticket===epoch)clear('unavailable');
     return view();
    }finally{if(timer!==undefined)clearTimeout(timer);}
   })();
   active=work;void work.finally(()=>{if(active===work){active=null;refreshing=false;}});return work;
  },
  invalidate(reason='session_changed'){if(!closed)clear(reason==='revoked'?'revoked':'unknown');return view();},
  close(){if(closed)return;closed=true;clear('closed');listeners.clear();},
 };
 return api;
}
