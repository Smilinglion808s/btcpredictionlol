// B4x4-ES1 Binance Order-Book R1 — persistence layer (server only).
//
// Every write is idempotent and backed by a database uniqueness constraint.
// Nothing in this module may block, delay or fail an ES1 prediction.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BINANCE_OB_COLLECTOR_VERSION,
  BINANCE_OB_VERSION,
  HISTORY_WINDOW,
  binanceObConfigHash,
  type BinanceObPolicyName,
  type MarketKind,
} from "./config";
import type { BoundaryHistory } from "./features";
import type { ObservationRow } from "./types";

export const OBSERVATIONS_TABLE = "b4x4_es1_binance_ob_observations";
export const FEATURES_TABLE = "b4x4_es1_binance_ob_boundary_features";
export const POLICY_TABLE = "b4x4_es1_binance_ob_policy_shadows";
export const HEALTH_TABLE = "b4x4_es1_binance_ob_collector_health";
export const ACTIVATION_TABLE = "b4x4_es1_binance_ob_activation";

type Row = Record<string, unknown>;

export async function upsertObservations(
  sb: SupabaseClient,
  rows: ObservationRow[],
): Promise<number> {
  if (rows.length === 0) return 0;
  const { error } = await sb.from(OBSERVATIONS_TABLE).upsert(rows as never, {
    onConflict: "target_ts,market_kind,sample_offset_seconds,collector_version",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(`binance_ob_observation_upsert:${error.message}`);
  return rows.length;
}

export async function loadObservations(
  sb: SupabaseClient,
  targetTs: string,
  marketKind: MarketKind,
): Promise<ObservationRow[]> {
  const { data, error } = await sb
    .from(OBSERVATIONS_TABLE)
    .select("*")
    .eq("target_ts", targetTs)
    .eq("market_kind", marketKind)
    .eq("collector_version", BINANCE_OB_COLLECTOR_VERSION)
    .order("sample_offset_seconds", { ascending: false });
  if (error) throw new Error(`binance_ob_observation_load:${error.message}`);
  return (data ?? []) as unknown as ObservationRow[];
}

/**
 * Strictly past-only percentile history: the previous `HISTORY_WINDOW` valid
 * same-market boundary rows. The current target is never included.
 */
export async function loadBoundaryHistory(
  sb: SupabaseClient,
  targetTs: string,
  marketKind: MarketKind,
): Promise<BoundaryHistory> {
  const { data, error } = await sb
    .from(FEATURES_TABLE)
    .select("final_abs_imbalance_10bps, final_total_depth_btc_10bps, final_spread_bps")
    .eq("market_kind", marketKind)
    .eq("feature_version", BINANCE_OB_VERSION)
    .eq("ready", true)
    .lt("target_ts", targetTs)
    .order("target_ts", { ascending: false })
    .limit(HISTORY_WINDOW);
  if (error) throw new Error(`binance_ob_history_load:${error.message}`);
  const rows = ((data ?? []) as Row[]).reverse();
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const absImbalance: number[] = [];
  const totalDepth: number[] = [];
  const spread: number[] = [];
  for (const r of rows) {
    const a = num(r.final_abs_imbalance_10bps);
    const d = num(r.final_total_depth_btc_10bps);
    const s = num(r.final_spread_bps);
    if (a == null || d == null || s == null) continue;
    absImbalance.push(a);
    totalDepth.push(d);
    spread.push(s);
  }
  return { absImbalance, totalDepth, spread };
}

export async function getBoundaryFeature(
  sb: SupabaseClient,
  targetTs: string,
  marketKind: MarketKind,
): Promise<Row | null> {
  const { data } = await sb
    .from(FEATURES_TABLE)
    .select("*")
    .eq("target_ts", targetTs)
    .eq("market_kind", marketKind)
    .eq("feature_version", BINANCE_OB_VERSION)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

/** Prediction-time rows are immutable: existing rows are never overwritten. */
export async function insertBoundaryFeature(sb: SupabaseClient, row: Row): Promise<Row | null> {
  const { data, error } = await sb
    .from(FEATURES_TABLE)
    .upsert(row as never, {
      onConflict: "target_ts,market_kind,feature_version",
      ignoreDuplicates: true,
    })
    .select("*")
    .maybeSingle();
  if (error) throw new Error(`binance_ob_feature_upsert:${error.message}`);
  if (data) return data as Row;
  return getBoundaryFeature(sb, String(row.target_ts), row.market_kind as MarketKind);
}

export async function insertPolicyShadows(sb: SupabaseClient, rows: Row[]): Promise<number> {
  if (rows.length === 0) return 0;
  // webhook_eligible is enforced false in code as well as in the database.
  const safe = rows.map((r) => ({ ...r, webhook_eligible: false }));
  const { error } = await sb.from(POLICY_TABLE).upsert(safe as never, {
    onConflict: "target_ts,policy_name,policy_version",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(`binance_ob_policy_upsert:${error.message}`);
  return safe.length;
}

export async function upsertCollectorHealth(sb: SupabaseClient, row: Row): Promise<void> {
  const { error } = await sb
    .from(HEALTH_TABLE)
    .upsert({ ...row, updated_at: new Date().toISOString() } as never, {
      onConflict: "market_kind",
    });
  if (error) throw new Error(`binance_ob_health_upsert:${error.message}`);
}

export async function readCollectorHealth(sb: SupabaseClient): Promise<Row[]> {
  const { data } = await sb.from(HEALTH_TABLE).select("*");
  return (data ?? []) as Row[];
}

export interface ActivationRecord {
  mode: "SHADOW_ONLY" | "ACTIVE";
  selected_policy: BinanceObPolicyName | null;
  policy_version: string | null;
  activation_target_ts: string | null;
  config_hash: string | null;
  approved_at: string | null;
  approval_note: string | null;
}

export async function readActivation(sb: SupabaseClient): Promise<ActivationRecord> {
  const { data } = await sb
    .from(ACTIVATION_TABLE)
    .select("*")
    .eq("singleton_key", "B4X4_ES1_BINANCE_OB")
    .maybeSingle();
  const r = (data ?? {}) as Row;
  return {
    mode: (r.mode as ActivationRecord["mode"]) ?? "SHADOW_ONLY",
    selected_policy: (r.selected_policy as BinanceObPolicyName | null) ?? null,
    policy_version: (r.policy_version as string | null) ?? null,
    activation_target_ts: (r.activation_target_ts as string | null) ?? null,
    config_hash: (r.config_hash as string | null) ?? null,
    approved_at: (r.approved_at as string | null) ?? null,
    approval_note: (r.approval_note as string | null) ?? null,
  };
}

/** Runtime audit trail; reuses the existing `api_runs` convention. */
export async function auditBinanceOb(
  sb: SupabaseClient,
  event: string,
  payload: Row,
  success = true,
): Promise<void> {
  try {
    await sb.from("api_runs").insert({
      run_type: `binance-ob-${event}`,
      response_payload: { ...payload, config_hash: binanceObConfigHash() },
      success,
      error_message: success ? null : String(payload.error ?? event),
    } as never);
  } catch {
    /* auditing must never block capture or prediction */
  }
}
