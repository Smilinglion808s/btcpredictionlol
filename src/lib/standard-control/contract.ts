/** Dedicated DTO; legacy synthetic control DTOs and paper totals are never inputs. */
export const SCHEMA = "solana-backend-control/1";
export const STATUS_PATH = "/api/standard-control/status";
export const COMMAND_PATH = "/api/standard-control/commands";
const codes = ["CONTROL_PERMISSION_REQUIRED","NON_PRODUCTION_DATASET", "ACTIVATION_REVIEW_REQUIRED", "BACKEND_NOT_READY", "HALTED", "WINDOW_EXPIRED", "FEED_UNAVAILABLE", "QUARANTINED", "ENGINE_HALTED", "UNRESOLVED_ORDER", "FAILED_ORDER_RETAINED"];
export function record(value: unknown, keys: string[]): Record<string, any> {
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== [...keys].sort().join()) throw new Error("Invalid response");
  return value as Record<string, any>;
}
function str(v: unknown, max=128): string { if (typeof v !== "string" || !v.length || v.length>max || !/^[\x20-\x7e]+$/.test(v)) throw new Error("Invalid text"); return v; }
function num(v: unknown): number { if (!Number.isSafeInteger(v) || (v as number) < 0) throw new Error("Invalid number"); return v as number; }
function bool(v: unknown): boolean { if (typeof v !== "boolean") throw new Error("Invalid flag"); return v; }
function choice<T extends string>(v: unknown, values: T[]): T { if (!values.includes(v as T)) throw new Error("Invalid enum"); return v as T; }
function units(v: unknown): string | null { if (v === null) return null; if (typeof v !== "string" || !/^(0|[1-9][0-9]{0,39})$/.test(v)) throw new Error("Invalid units"); return v; }
function list<T>(v: unknown, max: number, read: (x: unknown) => T): T[] { if (!Array.isArray(v) || v.length > max) throw new Error("Invalid list"); return v.map(read); }
export function parseStatus(input: unknown) {
  const v = record(input, ["schema","runtime_session_id","auth_session_id","auth_expires_at_ms","sampled_at_ms","valid_for_ms","acknowledged","version","mode","entry_enabled","on_permitted","blockers","dataset","live_ready","positions","activity","activity_total","activity_truncated","pending_orders","errors","command","balance"]);
  if (v.schema !== SCHEMA || v.acknowledged !== true || v.live_ready !== false || v.valid_for_ms !== 5000) throw new Error("Invalid schema");
  const blockers = list(v.blockers, 10, x => choice(x,codes));
  const mode = choice(v.mode,["OFF","ON","HALTED"] as const as ("OFF"|"ON"|"HALTED")[]);
  const entry = bool(v.entry_enabled), permitted = bool(v.on_permitted);
  const dataset = choice(v.dataset,["offline_synthetic","supplied_chain_evidence"]);
  if ((entry && mode !== "ON") || (permitted && (blockers.length || dataset !== "supplied_chain_evidence" || mode === "HALTED"))) throw new Error("Inconsistent state");
  const balance = record(v.balance,["availability","lamports","observed_at_ms","reason"]);
  if (balance.availability !== "unavailable" || balance.lamports !== null || balance.observed_at_ms !== null || balance.reason !== "NOT_EXPOSED_BY_RUNTIME") throw new Error("Unsupported balance evidence");
  const positions = list(v.positions, 32, x => {
    const p = record(x,["position_id","mint","source_wallet","state","quarantined","last_accounted_units","units"]);
    const state = choice(p.state,["INTENT","ENTRY_PENDING","HELD","EXIT_PENDING","QUARANTINED"]);
    const q = bool(p.quarantined), u = units(p.units), last = units(p.last_accounted_units);
    if (last === null || ((q || ["ENTRY_PENDING","EXIT_PENDING","QUARANTINED"].includes(state)) && u !== null)) throw new Error("Unknown inventory must remain null");
    return {position_id:str(p.position_id,512),mint:str(p.mint),source_wallet:str(p.source_wallet),state,quarantined:q,units:u,last_accounted_units:last};
  });
  const activity = list(v.activity,20,x => {
    const a = record(x,["order_id","position_id","side","state","created_at_ms","receipt_status","commitment","acquired_units","consumed_units","network_fee_lamports","rent_paid_lamports","rent_refund_lamports"]);
    const state = choice(a.state,["PREPARED","SUBMITTING","UNKNOWN","QUARANTINED","CANCELED","NOT_LANDED","SUCCESS","FAILED"]);
    const receipt = a.receipt_status === null ? null : choice(a.receipt_status,["success","failed"]);
    const commitment = a.commitment === null ? null : choice(a.commitment,["confirmed","finalized"]);
    const effects = {acquired_units:units(a.acquired_units),consumed_units:units(a.consumed_units),network_fee_lamports:units(a.network_fee_lamports),rent_paid_lamports:units(a.rent_paid_lamports),rent_refund_lamports:units(a.rent_refund_lamports)};
    if (receipt === null ? commitment !== null || Object.values(effects).some(x=>x!==null) : commitment === null || Object.values(effects).some(x=>x===null) || (receipt === "success" ? state !== "SUCCESS" : state !== "FAILED")) throw new Error("Inconsistent receipt");
    return {order_id:str(a.order_id,512),position_id:str(a.position_id,512),side:choice(a.side,["BUY","SELL"]),state,created_at_ms:num(a.created_at_ms),receipt_status:receipt,commitment,...effects};
  });
  let command = null;
  if (v.command !== null) { const c = record(v.command,["command_id","phase","duplicate"]); command = {command_id:str(c.command_id),phase:choice(c.phase,["applied","interrupted","failed","pending"]),duplicate:bool(c.duplicate)}; }
  const total = num(v.activity_total), truncated = bool(v.activity_truncated);
  if (total < activity.length || truncated !== (total > activity.length)) throw new Error("Activity coverage mismatch");
  return {schema:SCHEMA,runtime_session_id:str(v.runtime_session_id),auth_session_id:str(v.auth_session_id),auth_expires_at_ms:num(v.auth_expires_at_ms),sampled_at_ms:num(v.sampled_at_ms),valid_for_ms:5000,acknowledged:true,version:num(v.version),mode,entry_enabled:entry,on_permitted:permitted,blockers,dataset,live_ready:false,positions,activity,activity_total:total,activity_truncated:truncated,pending_orders:num(v.pending_orders),errors:list(v.errors,10,x=>choice(x,codes)),command,balance:{availability:"unavailable",lamports:null,observed_at_ms:null,reason:"NOT_EXPOSED_BY_RUNTIME"}};
}
export type Status = ReturnType<typeof parseStatus>;
export interface Command {command_id:string; session_id:string; expected_version:number; action:"ON"|"OFF"}
export type StatusDiagnostic = Readonly<{httpStatus:number|null;proxyFailure:string|null;publicCode:string|null;category:"HTTP_ERROR"|"TRANSPORT"|"TIMEOUT"|"CONTENT_TYPE"|"BODY"|"DTO"|"GENERATION_CHANGED"|"SESSION_MISMATCH"|"EXPIRY_MISMATCH"|"SESSION_EXPIRED"|"FUTURE_TIMESTAMP"|"STALE_TIMESTAMP"|"UNKNOWN"}>;
export interface View {diagnostic?:StatusDiagnostic|null;status:Status|null; receivedMono:number|null; connection:"signed_out"|"loading"|"ready"|"unavailable"; error:string|null; pending:Pending[]; busy:boolean; journalError:boolean}
export interface Pending {authSession:string; command:Command}
export function fresh(v:View,wall:number,mono:number):boolean {
 const s=v.status;
 return !!s && v.connection==="ready" && v.receivedMono!==null && mono>=v.receivedMono && mono-v.receivedMono<=s.valid_for_ms && wall>=s.sampled_at_ms && wall-s.sampled_at_ms<=s.valid_for_ms && wall<s.auth_expires_at_ms;
}
export function canCommand(v:View,action:"ON"|"OFF",wall:number,mono:number):boolean {
 if (v.journalError || !v.status || v.connection==="signed_out") return false;
 if (action==="OFF") return wall<v.status.auth_expires_at_ms; // Restrictive command allowed with stale status/pending ON; server version still checked.
 return fresh(v,wall,mono) && !v.busy && !v.pending.length && v.status.on_permitted;
}
