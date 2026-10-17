import { ControlError, type Command, type Transport } from './control-contract';
import { OwnerRequestError, describeOwnerRequest, type OwnerRequest, type OwnerResultMap } from './owner-request-contract';
import type { OwnerAuthAdapter } from './owner-login';
/** DTO-only bridge. Raw bearer/session/SDK never leaves its locked adapter operation. */
export function createOwnerControlTransport(adapter: OwnerAuthAdapter): Transport {
 async function request<K extends OwnerRequest>(command: K): Promise<OwnerResultMap[K['kind']]> {
  try {
   describeOwnerRequest(command); // Reject malformed identity/command before SDK or token access.
   return await adapter.transact(async lease => {
    if (!lease.ownerRequest) throw new OwnerRequestError('UNCONFIGURED','not_sent');
    return lease.ownerRequest(command);
   });
  } catch (error) {
   if (error instanceof OwnerRequestError) {
    // An ambiguous POST remains reconcilable even if an untrusted error body names an auth error.
    if (command.kind === "control-command" && error.outcome === "uncertain") throw new ControlError("uncertain", "Command outcome is unconfirmed. Reconcile its existing command identity; do not automatically retry.");
    if (error.status===404 && command.kind==='control-receipt') throw error;
    if (['AUTH_REQUIRED','TOKEN_TOO_OLD','OWNER_FORBIDDEN','APP_SESSION_REVOKED','APP_SESSION_ENROLL_REQUIRED','ORIGIN_FORBIDDEN','CSRF_REFRESH_REQUIRED','CSRF_FORBIDDEN'].includes(error.code)) throw new ControlError('auth','Owner session or enrollment is not current. No control action is confirmed.');
    if(error.code==='STALE')throw new ControlError('stale','Control state changed. Refresh before another explicit command; no automatic replay.');
    if(error.code==='BLOCKED'||error.code==='INVALID_REQUEST')throw new ControlError('blocked','The control request was refused by a safety requirement.');
   }
   throw new ControlError(command.kind==='control-command'?'uncertain':'unavailable',command.kind==='control-command'?'Command outcome is unconfirmed. Reconcile its existing command identity; do not automatically retry.':'Owner control service unavailable. Controls remain locked.');
  }
 }
 return {
  session:()=>request({kind:'control-session'}),
  status:()=>request({kind:'control-status'}),
  command:(command:Command,csrfToken:string)=> {
   // Runtime validator refuses REQUEST_LIVE; type narrowing does not create permission.
   if(command.action!=='OFF'&&command.action!=='PAUSE_ENTRIES')return Promise.reject(new ControlError('blocked','Live activation is unavailable.'));
   return request({kind:'control-command',command:{...command,action:command.action},csrfToken});
  },
  receipt:async commandId=>{try{return await request({kind:'control-receipt',commandId});}catch(error){if(error instanceof OwnerRequestError&&error.status===404)return null;throw error;}},
 };
}
