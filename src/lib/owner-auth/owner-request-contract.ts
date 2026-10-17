import { parseReceipt, parseSession, parseStatus, type Command, type ControlStatus, type Receipt, type Session } from './control-contract';
export const OWNER_API_POLICY_REVISION = 'app-session-jwt-age300-v1' as const;
export type SafeCommand = Omit<Command, 'action'> & { action: 'OFF' | 'PAUSE_ENTRIES' };
export type OwnerRequest =
 | { kind: 'session-evidence' }
 | { kind: 'enroll-current-session' }
 | { kind: 'revoke-current-session' }
 | { kind: 'control-session' }
 | { kind: 'control-status' }
 | { kind: 'control-receipt'; commandId: string }
 | { kind: 'control-command'; command: SafeCommand; csrfToken: string };
export type OwnerRequestKind = OwnerRequest['kind'];
export interface SessionEvidence { schema_version: 1; subject: string; session_id: string; active: true; observed_at: number; valid_until: number; policy_revision: typeof OWNER_API_POLICY_REVISION; aal: 'aal1' | 'aal2'; token_iat: number; token_exp: number; }
export interface EnrollReceipt { schema_version: 1; enrolled: true; scope: 'current_provider_session'; server_time: number; }
export interface RevokeReceipt { schema_version: 1; revoked: true; scope: 'current_provider_session'; server_time: number; }
export interface OwnerResultMap {
 'session-evidence': SessionEvidence;
 'enroll-current-session': EnrollReceipt;
 'revoke-current-session': RevokeReceipt;
 'control-session': Session;
 'control-status': ControlStatus;
 'control-receipt': Receipt;
 'control-command': Receipt;
}
export interface OwnerResponseContext { nowSeconds: number; subject: string; sessionId: string; tokenIat: number; tokenExp: number; }
export type OwnerErrorCode = 'UNCONFIGURED' | 'AUTH_REQUIRED' | 'TOKEN_TOO_OLD' | 'OWNER_FORBIDDEN' | 'APP_SESSION_REVOKED' | 'APP_SESSION_ENROLL_REQUIRED' | 'ORIGIN_FORBIDDEN' | 'REGISTRY_UNAVAILABLE' | 'REGISTRY_RESULT_UNCERTAIN' | 'CONTROL_SERVICE_UNCONFIGURED' | 'CONTROL_SERVICE_UNAVAILABLE' | 'CONTROL_RESULT_UNCERTAIN' | 'INVALID_REQUEST' | 'INVALID_RESPONSE' | 'STALE' | 'BLOCKED' | 'CSRF_REFRESH_REQUIRED' | 'CSRF_FORBIDDEN' | 'CLOSED' | 'TIMEOUT';
export class OwnerRequestError extends Error {
 constructor(readonly code: OwnerErrorCode, readonly outcome: 'not_sent' | 'rejected' | 'uncertain', readonly status: number | null = null) { super('Owner request not confirmed: ' + code); }
}
export interface OwnerRequestDescriptor { kind: OwnerRequestKind; path: string; method: 'GET' | 'POST'; headers: Readonly<Record<string, string>>; body?: string; mutation: boolean; requiresFreshJwt: boolean; }
const fail = (): never => { throw new OwnerRequestError('INVALID_REQUEST', 'not_sent'); };
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v)) return fail(); return v as Record<string, unknown>; }
function exact(v: Record<string, unknown>, keys: string[]) { if (Object.keys(v).sort().join(',') !== keys.sort().join(',')) fail(); }
const safeInteger = (v: unknown): v is number => Number.isSafeInteger(v) && (v as number) >= 0;
const uuid = (v: unknown): v is string => typeof v === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(v);
const label = (v: unknown, max = 240): v is string => typeof v === 'string' && v.length > 0 && v.length <= max && !/[\u0000-\u001f\u007f]/.test(v); // eslint-disable-line no-control-regex
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9_-]{1,240}$/.test(v);
export function describeOwnerRequest(input: unknown): OwnerRequestDescriptor {
 const v = object(input); const kind = v.kind;
 if (kind === 'control-command') {
  exact(v, ['kind', 'command', 'csrfToken']); const command = object(v.command);
  exact(command, ['command_id','expected_version','action','expires_at','expected_runtime_identity','expected_policy_hash','reason']);
  if (!id(command.command_id) || !safeInteger(command.expected_version) || !safeInteger(command.expires_at) || typeof command.action !== 'string' || !['OFF','PAUSE_ENTRIES'].includes(command.action) || !label(command.expected_runtime_identity) || !label(command.expected_policy_hash) || !label(command.reason,240) || typeof v.csrfToken !== 'string' || !/^[\x21-\x7e]{16,1024}$/.test(v.csrfToken)) return fail();
  const body = JSON.stringify(command); if (body.length > 8192) return fail();
  return { kind, path:'/api/control/commands', method:'POST', headers:{'Content-Type':'application/json','X-CSRF-Token':v.csrfToken}, body, mutation:true, requiresFreshJwt:true };
 }
 if (kind === 'control-receipt') { exact(v,['kind','commandId']); if (!id(v.commandId)) return fail(); return {kind,path:'/api/control/commands/'+v.commandId,method:'GET',headers:{},mutation:false,requiresFreshJwt:true}; }
 exact(v,['kind']);
 const paths = {'session-evidence':'/api/owner-control/session-evidence','enroll-current-session':'/api/owner-control/enroll','revoke-current-session':'/api/owner-control/revoke','control-session':'/api/control/session','control-status':'/api/control/status'} as const;
 if (typeof kind !== 'string' || !Object.hasOwn(paths,kind)) return fail();
 const k = kind as keyof typeof paths; const action = k === 'enroll-current-session' ? 'enroll' : k === 'revoke-current-session' ? 'revoke' : null;
 return {kind:k,path:paths[k],method:action?'POST':'GET',headers:action?{'Content-Type':'application/json','X-Owner-Control-Action':action}:{},...(action?{body:'{}'}:{}),mutation:action!==null,requiresFreshJwt:k!=='revoke-current-session'};
}
function responseObject(v: unknown, keys?: string[]): Record<string, unknown> {
 if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error('Response');
 const r=v as Record<string,unknown>; if(keys&&Object.keys(r).sort().join(',')!==keys.sort().join(','))throw new Error('Response');return r;
}
function currentTime(value: unknown, now: number): value is number { return safeInteger(value) && value <= now + 2 && value >= now - 10; }
export function parseOwnerResponse<K extends OwnerRequestKind>(kind: K, input: unknown, context: OwnerResponseContext): OwnerResultMap[K] {
 try {
  if (!safeInteger(context.nowSeconds) || !uuid(context.subject) || !uuid(context.sessionId) || !safeInteger(context.tokenIat) || !safeInteger(context.tokenExp) || context.tokenIat > context.nowSeconds || context.tokenExp <= context.nowSeconds || context.tokenIat >= context.tokenExp) throw new Error('Context');
  let result: OwnerResultMap[OwnerRequestKind];
  if (kind === 'session-evidence') {
   const v=responseObject(input,['schema_version','subject','session_id','active','observed_at','valid_until','policy_revision','aal','token_iat','token_exp']);
   if(v.schema_version!==1||v.subject!==context.subject||v.session_id!==context.sessionId||v.active!==true||!currentTime(v.observed_at,context.nowSeconds)||!safeInteger(v.valid_until)||v.valid_until!==Math.min(context.tokenExp,context.tokenIat+300)||v.valid_until<=context.nowSeconds||v.valid_until<=(v.observed_at as number)||v.policy_revision!==OWNER_API_POLICY_REVISION||typeof v.aal!=='string'||!['aal1','aal2'].includes(v.aal)||v.token_iat!==context.tokenIat||v.token_exp!==context.tokenExp)throw new Error('Evidence');
   result=v as unknown as SessionEvidence;
  } else if (kind==='enroll-current-session'||kind==='revoke-current-session') {
   const field=kind==='enroll-current-session'?'enrolled':'revoked'; const v=responseObject(input,['schema_version',field,'scope','server_time']);
   if(v.schema_version!==1||v[field]!==true||v.scope!=='current_provider_session'||!currentTime(v.server_time,context.nowSeconds))throw new Error('Receipt'); result=v as unknown as EnrollReceipt|RevokeReceipt;
  } else if(kind==='control-session') {
   const v=responseObject(input,['csrf_token','expires_at']); result=parseSession(v);
   if(!/^[\x21-\x7e]{16,1024}$/.test(result.csrf_token)||result.expires_at<=context.nowSeconds||result.expires_at>Math.min(context.tokenExp,context.tokenIat+300))throw new Error('Session');
  } else if(kind==='control-status') { result=parseStatus(input); if(!currentTime(result.server_time,context.nowSeconds)||result.live_capable!==false)throw new Error('Status'); }
  else if(kind==='control-receipt'||kind==='control-command') result=parseReceipt(input);
  else throw new Error('Kind');
  return Object.freeze(result) as OwnerResultMap[K];
 } catch { throw new OwnerRequestError('INVALID_RESPONSE','uncertain'); }
}
export interface OwnerSignOutResult { appRevocation:'confirmed'|'not_configured'|'rejected'|'uncertain'; providerSignOut:'confirmed'|'uncertain'|'not_attempted'; }
