// Version 1 (`lite-a-floor4-top10-r1`) — dashboard aggregates.
//
// Version-scoped by construction: every read filters on this model_version, so
// C85 and T45 rows are untouched and their cards keep their own numbers.
//
// Honesty rules baked into this module, not into the component:
//   * performance counts come ONLY from forward LIVE rows. Rows written in
//     RESEARCH/backfill mode are reconstructions of past intervals and are
//     reported separately as a record count — never as a track record.
//   * "Live shadow" requires ALL of: a fresh heartbeat, the worker reporting
//     scoring readiness, a daily model whose own validity window covers now,
//     and a fresh SCORED scheduled record. A scored record means the persisted
//     row itself carries the evidence: a finite probability, valid inputs, the
//     head identity it scored under, and boundary timing. Rows that merely
//     exist — MISSED, INPUT_UNAVAILABLE, FIT_UNAVAILABLE — never qualify.
//     Scored abstentions DO qualify; the model is not required to trade.
//   * absence of evidence is never treated as live. Fields the worker may not
//     write are read as unknown, not as success.
//   * abstains never count as wins, and the win-rate denominator is graded
//     calls only.

import { createClient } from "@supabase/supabase-js";
import { LITE_A_MODEL_VERSION, C85_HEALTH_TABLE, C85_TARGETS_TABLE } from "../c85/config";

type Row = Record<string, unknown>;

/** A heartbeat older than this means we cannot claim the worker is connected. */
const HEARTBEAT_STALE_S = 180;
/** A scored record older than this means the schedule is not currently running. */
const LIVE_DECISION_STALE_S = 40 * 60;

/**
 * Optional release pin. When set, a worker reporting a different build is not
 * allowed to read as live, however healthy it looks.
 */
const REQUIRED_BUILD_SHA = () => (process.env.LITEA_REQUIRED_BUILD_SHA ?? "").trim();

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export type LiteAPhase =
  | "PREPARING"
  | "WAITING_FOR_LIVE_DATA"
  | "RECORDING_ONLY"
  | "STALE"
  | "LIVE_SHADOW";

export interface LiteADecision {
  target_open_utc: string;
  run_mode: string;
  status: string;
  /** First engine gate reason, when present. Distinguishes the no-call causes. */
  engine_reason: string | null;
  gate_reasons: string[];
  final_side: number;
  probability_yes: number | null;
  admission_rank: number | null;
  scored: boolean;
  age_s: number;
}

export interface LiteAStats {
  model_version: string;
  phase: LiteAPhase;
  /** Short, user-facing sentence explaining the phase. Never a raw error. */
  phase_detail: string;
  execution_enabled: false;

  connected: boolean;
  heartbeat_age_s: number | null;
  worker_id: string | null;
  /** Worker-reported scoring readiness, when it reports one. */
  scoring_ready: boolean | null;
  head_cutoff_utc: string | null;
  head_current: boolean;

  latest: LiteADecision | null;
  latest_is_live: boolean;
  latest_scored_age_s: number | null;
  research_rows: number;

  /** Forward LIVE shadow only. */
  live: {
    opportunities: number;
    scored: number;
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

const SELECT_COLUMNS = [
  "target_open_utc",
  "ticker",
  "run_mode",
  "status",
  "gate_reasons",
  "final_side",
  "probability_yes",
  "admission_rank",
  "binance_complete",
  "anchor_valid",
  "features",
  "target_open_ns",
  "compute_complete_ns",
].join(", ");

async function loadRows(): Promise<Row[]> {
  const { data, error } = await sb()
    .from(C85_TARGETS_TABLE)
    .select(SELECT_COLUMNS)
    .eq("model_version", LITE_A_MODEL_VERSION)
    .order("target_open_utc", { ascending: false })
    .limit(2000);
  if (error) throw new Error(`litea_stats:${error.message}`);
  return (data ?? []) as unknown as Row[];
}

/**
 * Official labels are keyed by ticker + target: a same-time row from another
 * market or another model can never grade this model's call. The worker
 * writes the venue's official `label` (±1); rows without a valid label are
 * not evidence and leave the call pending.
 */
async function loadSettlements(): Promise<Map<string, number>> {
  const { data } = await sb()
    .from("c85_settlements")
    .select("target_open_utc, ticker, label")
    .eq("model_version", LITE_A_MODEL_VERSION)
    .order("target_open_utc", { ascending: false })
    .limit(2000);
  const map = new Map<string, number>();
  for (const r of (data ?? []) as Row[]) {
    const label = Number(r.label);
    if (label !== 1 && label !== -1) continue; // absent/invalid — stays pending
    const key = `${String(r.ticker ?? "")}@${new Date(String(r.target_open_utc)).toISOString()}`;
    if (!map.has(key)) map.set(key, label);
  }
  return map;
}

function ageSeconds(iso: unknown): number | null {
  if (!iso) return null;
  const t = new Date(String(iso)).getTime();
  return Number.isFinite(t) ? Math.round((Date.now() - t) / 1000) : null;
}

function engineReason(row: Row): string | null {
  const reasons = Array.isArray(row.gate_reasons) ? (row.gate_reasons as unknown[]) : [];
  const first = reasons.length ? String(reasons[0]) : null;
  return first && first.length ? first : null;
}

/**
 * A genuinely SCORED scheduled record, judged only from what the row itself
 * persists: a finite probability, inputs the worker marked valid, the head
 * identity the engine scored under, and boundary timing. Anything missing is
 * unknown, and unknown is not scored.
 */
function isScored(row: Row): boolean {
  if (String(row.run_mode ?? "") !== "LIVE") return false;

  const p = row.probability_yes;
  if (p == null || !Number.isFinite(Number(p))) return false;

  const features = (row.features ?? null) as Row | null;
  const liteA = (features?.lite_a ?? null) as Row | null;
  if (!features || !liteA) return false;

  // Inputs the engine itself accepted for this interval.
  if (features.input_valid !== true) return false;
  if (row.binance_complete !== true) return false;

  // Head identity it scored under — the engine records `head_id` with the score.
  const headId = liteA.head_id ?? null;
  if (headId == null || String(headId).length === 0) return false;

  // Gate reasons that mean "no score was produced" disqualify regardless.
  const reason = engineReason(row);
  if (reason && ["INPUT_UNAVAILABLE", "FIT_UNAVAILABLE", "MISSED"].includes(reason)) return false;
  if (["INPUT_UNAVAILABLE", "FIT_UNAVAILABLE", "MISSED"].includes(String(row.status ?? "")))
    return false;

  // Boundary timing evidence.
  if (row.target_open_ns == null || row.compute_complete_ns == null) return false;

  return true;
}

function toDecision(row: Row): LiteADecision {
  const iso = new Date(String(row.target_open_utc)).toISOString();
  return {
    target_open_utc: iso,
    run_mode: String(row.run_mode ?? "RESEARCH"),
    status: String(row.status ?? "UNKNOWN"),
    engine_reason: engineReason(row),
    gate_reasons: Array.isArray(row.gate_reasons) ? (row.gate_reasons as string[]) : [],
    final_side: Number(row.final_side ?? 0),
    probability_yes: row.probability_yes == null ? null : Number(row.probability_yes),
    admission_rank: row.admission_rank == null ? null : Number(row.admission_rank),
    scored: isScored(row),
    age_s: ageSeconds(iso) ?? 0,
  };
}

/** UTC date a daily head must carry to still be valid right now. */
function todayUtc(): string {
  return new Date().toISOString().slice(0, 10);
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

  // The worker's own progress report. `model_as_of_utc` is not a field this
  // worker writes, so the head is read from the heartbeat's head inventory and
  // only falls back to a column if one actually exists.
  const progress = (health?.progress ?? null) as Row | null;
  const heads = (progress?.heads ?? null) as Row | null;
  const headCutoff =
    (heads?.latest_fit_cutoff as string | null) ?? (health?.model_as_of_utc as string | null) ?? null;
  const headCurrent = headCutoff != null && String(headCutoff).slice(0, 10) === todayUtc();

  const scoringRaw = progress?.scoring == null ? null : String(progress.scoring);
  const scoringReady = scoringRaw == null ? null : scoringRaw === "LOGGING_READY";

  const requiredBuild = REQUIRED_BUILD_SHA();
  const reportedBuild = String(progress?.build_sha ?? health?.build_sha ?? "");
  const buildOk = requiredBuild.length === 0 || reportedBuild === requiredBuild;

  const liveRows = rows.filter((r) => String(r.run_mode ?? "") === "LIVE");
  const researchRows = rows.length - liveRows.length;
  const scoredRows = liveRows.filter(isScored);

  const live = {
    opportunities: liveRows.length,
    scored: scoredRows.length,
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
    const reason = engineReason(r);
    if (status === "ORDINARY_CALL") live.ordinary_calls += 1;
    else if (status === "HIGH_CONFIDENCE_EXCEPTION") live.exception_calls += 1;
    else if (status === "DAILY_FLOOR_ABSTAIN") live.floor_holds += 1;
    else if (
      status === "INPUT_UNAVAILABLE" ||
      reason === "INPUT_UNAVAILABLE" ||
      reason === "FIT_UNAVAILABLE"
    )
      live.unavailable += 1;
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

  const newestScored = scoredRows[0] ?? null;
  const newestScoredAge = newestScored ? ageSeconds(newestScored.target_open_utc) : null;
  const scoringRecently = newestScoredAge != null && newestScoredAge <= LIVE_DECISION_STALE_S;

  let phase: LiteAPhase;
  let detail: string;
  if (!connected) {
    phase = "PREPARING";
    detail = "Not connected yet — the model is not making live predictions.";
  } else if (!buildOk) {
    phase = "RECORDING_ONLY";
    detail = "Connected, but the running version does not match the approved release.";
  } else if (scoringReady === false || !headCurrent) {
    phase = "RECORDING_ONLY";
    detail = !headCurrent
      ? "Connected and logging intervals, but today's daily model is not in place yet."
      : "Connected and logging intervals, but it cannot make a prediction right now.";
  } else if (scoringRecently) {
    phase = "LIVE_SHADOW";
    detail =
      "Predicting at the start of each 15-minute interval, from that interval's first 5 seconds. No money is at stake.";
  } else if (scoredRows.length > 0) {
    phase = "STALE";
    detail = "Connected, but no prediction has been made in the last few intervals.";
  } else {
    phase = "WAITING_FOR_LIVE_DATA";
    detail = "Ready. Waiting for the next 15-minute interval to make its first prediction.";
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
    scoring_ready: scoringReady,
    head_cutoff_utc: headCutoff,
    head_current: headCurrent,
    latest: latestRow ? toDecision(latestRow) : null,
    latest_is_live: latestRow ? String(latestRow.run_mode ?? "") === "LIVE" : false,
    latest_scored_age_s: newestScoredAge,
    research_rows: researchRows,
    live,
  };
}
