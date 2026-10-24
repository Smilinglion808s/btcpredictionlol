/** Read-only RunPolicy09 projection. Never grants ON or renews a run/session. */
export const RUN_PATH = "/api/standard-control/run";
const KEYS = "schema runtime_session_id run_id state started_ms entries_until_ms exits_until_ms observed_at_ms entries_authorized exit_permission login_required_for_commands logout_stops_run restart_requires_manual_on policy allocation_is_balance_proof fixed_size reuse_sale_proceeds actual_balance cash_anchor authorized_cash_lamports reserved_cash_lamports available_policy_cash_lamports remaining_fee_lamports remaining_rent_lamports cumulative_buy_lamports cumulative_sell_lamports fees_lamports rent_paid_lamports rent_refunded_lamports last_stop live_ready".split(" ");
const POLICY = "allocation_lamports entry_lamports exposure_basis_cap_lamports cumulative_fee_cap_lamports cumulative_rent_cap_lamports exit_management_ms".split(" ");
function object(v: unknown): Record<string, unknown> { if (!v || typeof v !== "object" || Array.isArray(v)) throw Error("Invalid run projection"); return v as Record<string, unknown>; }
function exact(v: Record<string, unknown>, keys: string[]) { if (Object.keys(v).sort().join() !== [...keys].sort().join()) throw Error("Invalid run shape"); }
function integer(v: unknown) { if (!Number.isSafeInteger(v) || (v as number) < 0) throw Error("Invalid time"); }
function money(v: unknown) { if (v !== null && (typeof v !== "string" || !/^(0|[1-9][0-9]*)$/.test(v))) throw Error("Invalid atomic amount"); }
function label(v: unknown, nullable = false) { if (!(nullable && v === null) && (typeof v !== "string" || !v.length || v.length > 256)) throw Error("Invalid identity"); }
function stamp(v: unknown) { const d=object(v); exact(d,["wall_ms","mono_ns","domain"]); integer(d.wall_ms); integer(d.mono_ns); label(d.domain); }
function balance(v: unknown, anchor: boolean) {
 if (v === null) return;
 const d=object(v);exact(d,anchor?["authorized_cash_lamports","observed_lamports","received"]:["lamports","received"]);
 for(const k of Object.keys(d)) if(k.endsWith("lamports")) money(d[k]);
 stamp(d.received);
}
export function parseRun(value: unknown, now: number = Date.now()) {
 const d=object(value);exact(d,KEYS);
 if (d.schema!=="standard-bot-run/1" || !["ON","OFF","HALTED","REVOKED","EXPIRED","NOT_AUTHORIZED"].includes(String(d.state))) throw Error("Unsupported run");
 label(d.runtime_session_id);label(d.run_id,true);label(d.last_stop,true);
 integer(now);integer(d.observed_at_ms);
 if ((d.observed_at_ms as number)>now || now-(d.observed_at_ms as number)>5000) throw Error("Stale run projection");
 for(const k of ["started_ms","entries_until_ms","exits_until_ms"]) if(d[k]!==null) integer(d[k]);
 if ((d.run_id===null)!==(d.started_ms===null) || (d.run_id===null)!==(d.entries_until_ms===null) || (d.run_id===null)!==(d.exits_until_ms===null)) throw Error("Invalid run times");
 if(d.run_id!==null && ((d.entries_until_ms as number)-(d.started_ms as number)!==86400000 || (d.exits_until_ms as number)<(d.entries_until_ms as number))) throw Error("Invalid run period");
 for(const k of ["entries_authorized","exit_permission"]) if(typeof d[k]!=="boolean") throw Error("Invalid permission");
 if(d.entries_authorized!==(d.state==="ON")) throw Error("Invalid ON projection");
 for(const k of ["login_required_for_commands","restart_requires_manual_on","fixed_size","reuse_sale_proceeds"]) if(d[k]!==true) throw Error("Unsupported semantics");
 for(const k of ["logout_stops_run","allocation_is_balance_proof","live_ready"]) if(d[k]!==false) throw Error("Unsupported semantics");
 const policy=object(d.policy);exact(policy,POLICY);
 for(const k of POLICY) if(k.endsWith("lamports")) money(policy[k]); else if(policy[k]!==null) integer(policy[k]);
 for(const k of KEYS) if(k.endsWith("lamports")) money(d[k]);
 balance(d.actual_balance,false);balance(d.cash_anchor,true);
 return structuredClone(d);
}
