// Version 1 (`lite-a-floor4-top10-r1`) — dashboard aggregates.
//
// Version-scoped by construction: every read filters on this model_version, so
// C85 and T45 rows are untouched and their cards keep their own numbers.
//
// Honesty rules baked into this module, not into the component:
//   * performance counts come ONLY from forward LIVE shadow rows. Rows written
//     in RESEARCH/backfill mode are reconstructions of past boundaries and are
//     reported separately as a record count — never as a track record.
//   * "Live shadow" requires BOTH a recent worker heartbeat AND a recent
//     scheduled LIVE decision. A fresh daily head, a saved research row, or a
//     successful frontend deploy do not qualify.
//   * abstains never count as wins, and the win-rate denominator is graded
//     calls only.

import { createClient } from "@supabase/supabase-js";
import { LITE_A_MODEL_VERSION, C85_HEALTH_TABLE, C85_TARGETS_TABLE } from "../c85/config";

type Row = Record<string, unknown>;

/** A heartbeat older than this means we cannot claim the worker is connected. */
const HEARTBEAT_STALE_S = 180;
/** A LIVE decision older than this means the schedule is not currently running. */
const LIVE_DECISION_STALE_S = 40 * 60;

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type LiteAPhase = "PREPARING" | "WAITING_FOR_LIVE_DATA" | "LIVE_SHADOW";

export interface LiteADecision {
  target_open_utc: string;
  run_mode: string;
  status: string;
  gate_reasons: string[];
  final_side: number;
  probability_yes: number | null;
  admission_rank: number | null;
  age_s: number;
}

export interface LiteAStats {
  model_version: string;
  phase: LiteAPhase;
  /** Short, user-facing sentence explaining the phase. Never a stack trace. */
  phase_detail: string;
  execution_enabled: false;

  connected: boolean;
  heartbeat_age_s: number | null;
  worker_id: string | null;
  head_cutoff_utc: string | null;
  head_age_s: number | null;

  latest: LiteADecision | null;
  latest_is_live: boolean;
  research_rows: number;

  /** Forward LIVE shadow only. */
  live: {
    opportunities: number;
    calls: number;
    ordinary_calls: number;
    exception_calls: number;
    floor_holds: number;
    confidence_abstains: number;
    unavailable: number;
    wins: number;
    losses: number;
    pending: number;
    win_rate: number | null;
  };
}

async function loadRows(): Promise<Row[]> {
  const { data, error } = await sb()
    .from(C85_TARGETS_TABLE)
    .select(
      "target_open_utc, run_mode, status, gate_reasons, final_side, probability_yes, admission_rank",
    )
    .eq("model_version", LITE_A_MODEL_VERSION)
    .order("target_open_utc", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`litea_stats:${error.message}`);
  return (data ?? []) as Row[];
}

async function loadSettlements(): Promise<Map<string, string>> {
  const { data } = await sb()
    .from("c85_settlements")
    .select("target_open_utc, outcome")
    .eq("model_version", LITE_A_MODEL_VERSION)
    .order("target_open_utc", { ascending: false })
    .limit(2000);
  const map = new Map<string, string>();
  for (const r of (data ?? []) as Row[]) {
    const key = new Date(String(r.target_open_utc)).toISOString();
    if (!map.has(key)) map.set(key, String(r.outcome ?? ""));
  }
  return map;
}

function ageSeconds(iso: unknown): number | null {
  if (!iso) return null;
  const t = new Date(String(iso)).getTime();
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 1000) : null;
}

function toDecision(row: Row): LiteADecision {
  const iso = new Date(String(row.target_open_utc)).toISOString();
  return {
    target_open_utc: iso,
    run_mode: String(row.run_mode ?? "RESEARCH"),
    status: String(row.status ?? "UNKNOWN"),
    gate_reasons: Array.isArray(row.gate_reasons) ? (row.gate_reasons as string[]) : [],
    final_side: Number(row.final_side ?? 0),
    probability_yes: row.probability_yes == null ? null : Number(row.probability_yes),
    admission_rank: row.admission_rank == null ? null : Number(row.admission_rank),
    age_s: ageSeconds(iso) ?? 0,
  };
}

export async function buildLiteAStats(): Promise<LiteAStats> {
  const [rows, settlements, healthRes] = await Promise.all([
    loadRows(),
    loadSettlements(),
    sb()
      .from(C85_HEALTH_TABLE)
      .select("*")
      .eq("model_version", LITE_A_MODEL_VERSION)
      .order("last_heartbeat_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const health = (healthRes.data ?? null) as Row | null;

  const heartbeatAge = ageSeconds(health?.last_heartbeat_at);
  const connected = heartbeatAge != null && heartbeatAge <= HEARTBEAT_STALE_S;

  const liveRows = rows.filter((r) => String(r.run_mode ?? "") === "LIVE");
  const researchRows = rows.length - liveRows.length;

  const live = {
    opportunities: liveRows.length,
    calls: 0,
    ordinary_calls: 0,
    exception_calls: 0,
    floor_holds: 0,
    confidence_abstains: 0,
    unavailable: 0,
    wins: 0,
    losses: 0,
    pending: 0,
    win_rate: null as number | null,
  };

  for (const r of liveRows) {
    const status = String(r.status ?? "");
    if (status === "ORDINARY_CALL") live.ordinary_calls += 1;
    else if (status === "HIGH_CONFIDENCE_EXCEPTION") live.exception_calls += 1;
    else if (status === "DAILY_FLOOR_ABSTAIN") live.floor_holds += 1;
    else if (status === "INPUT_UNAVAILABLE") live.unavailable += 1;
    else live.confidence_abstains += 1;

    if (Number(r.final_side ?? 0) === 0) continue;
    live.calls += 1;
    const outcome = settlements.get(new Date(String(r.target_open_utc)).toISOString()) ?? null;
    if (outcome === "WIN") live.wins += 1;
    else if (outcome === "LOSS") live.losses += 1;
    else if (outcome !== "PUSH") live.pending += 1;
  }
  const graded = live.wins + live.losses;
  live.win_rate = graded > 0 ? live.wins / graded : null;

  const newestLive = liveRows[0] ?? null;
  const newestLiveAge = newestLive ? ageSeconds(newestLive.target_open_utc) : null;
  const scheduleRunning = newestLiveAge != null && newestLiveAge <= LIVE_DECISION_STALE_S;

  let phase: LiteAPhase;
  let detail: string;
  if (connected && scheduleRunning) {
    phase = "LIVE_SHADOW";
    detail = "Recording every 15-minute close as it happens. No money is at stake.";
  } else if (connected) {
    phase = "WAITING_FOR_LIVE_DATA";
    detail = "Connected. Waiting for the first scheduled 15-minute close to record.";
  } else {
    phase = "PREPARING";
    detail = "Not connected yet — the model is not recording live closes.";
  }

  const latestRow = rows[0] ?? null;

  return {
    model_version: LITE_A_MODEL_VERSION,
    phase,
    phase_detail: detail,
    execution_enabled: false,
    connected,
    heartbeat_age_s: heartbeatAge,
    worker_id: (health?.worker_id as string) ?? null,
    head_cutoff_utc: (health?.model_as_of_utc as string) ?? null,
    head_age_s: ageSeconds(health?.model_as_of_utc),
    latest: latestRow ? toDecision(latestRow) : null,
    latest_is_live: latestRow ? String(latestRow.run_mode ?? "") === "LIVE" : false,
    research_rows: researchRows,
    live,
  };
}
