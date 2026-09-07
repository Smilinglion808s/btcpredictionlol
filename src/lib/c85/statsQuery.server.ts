// C85 MULTI_META — dashboard aggregates.
//
// Reads c85_* only; nothing here can influence a decision.
//
// Counting rules (fixed, and deliberately not the same as "rows"):
//   * denominator for coverage = matched opportunities (every target the model
//     was asked about, abstains included);
//   * denominator for win rate = graded calls only (WIN + LOSS);
//   * abstains score 0 and are NEVER counted as wins;
//   * raw net = WIN +1 / LOSS -1 / ABSTAIN 0;
//   * drawdown is reported separately from raw net, on the call sequence.

import { createClient } from "@supabase/supabase-js";
import {
  C85_BANKROLL_DECIMAL_ODDS,
  C85_BANKROLL_PRINCIPAL_CENTS,
  C85_DISPLAY_NAME,
  C85_HEALTH_TABLE,
  C85_MODEL_VERSION,
  C85_TARGETS_TABLE,
  C85_VARIANT,
  boiseDate,
  stakeCents,
  winProfitCents,
} from "./config";

type Row = Record<string, unknown>;

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export interface C85DayStats {
  date: string;
  opportunities: number;
  calls: number;
  wins: number;
  losses: number;
  net: number;
  win_rate: number | null;
  coverage: number | null;
  bankroll_close_cents: number;
  bankroll_pnl_cents: number;
}

export interface C85Stats {
  model_version: string;
  display_name: string;
  variant: string;
  readiness: string;
  stage: string | null;
  blocking_reason: string | null;
  worker_id: string | null;
  build_sha: string | null;
  last_heartbeat_at: string | null;
  heartbeat_age_s: number | null;
  feed_freshness: Record<string, unknown> | null;
  model_as_of_utc: string | null;
  last_checkpoint_seq: number | null;
  checkpoint_age_s: number | null;
  progress: Record<string, unknown> | null;

  opportunities: number;
  calls: number;
  wins: number;
  losses: number;
  pushes: number;
  abstains: number;
  pending: number;
  win_rate: number | null;
  coverage: number | null;
  raw_net: number;
  max_drawdown: number;
  current_drawdown: number;

  live_opportunities: number;
  live_calls: number;
  backfill_rows: number;

  last_target_utc: string | null;
  next_target_utc: string | null;
  last_final_side: number | null;
  last_gate_reasons: string[] | null;
  last_publication_offset_ms: number | null;
  avg_publication_offset_ms: number | null;
  worst_publication_offset_ms: number | null;
  deadline_met_rate: number | null;
  signals_sent: number;
  signals_suppressed: number;
  signals_expired: number;
  last_dispatch_status: string | null;

  bankroll: {
    principal_cents: number;
    stake_cents: number;
    decimal_odds: number;
    today_close_cents: number;
    today_pnl_cents: number;
  };

  today: C85DayStats;
  daily: C85DayStats[];
}

const PAGE = 1000;

async function loadTargets(limit = 4000): Promise<Row[]> {
  const client = sb();
  const rows: Row[] = [];
  for (let from = 0; from < limit; from += PAGE) {
    const to = Math.min(from + PAGE, limit) - 1;
    const { data, error } = await client
      .from(C85_TARGETS_TABLE)
      .select(
        "target_open_utc, run_mode, status, final_side, gate_reasons, publication_offset_ms, deadline_met, webhook_status, structure_valid, core_valid, weak, admission_rank, filter_rank, probability_yes, probability_correct, proposal, base_side, extension",
      )
      .eq("model_version", C85_MODEL_VERSION)
      .order("target_open_utc", { ascending: false })
      .range(from, to);
    if (error) throw new Error(`c85_stats:${error.message}`);
    const batch = (data ?? []) as Row[];
    rows.push(...batch);
    if (batch.length < to - from + 1) break;
  }
  return rows;
}

async function loadSettlements(): Promise<Map<string, string>> {
  const client = sb();
  const { data } = await client
    .from("c85_settlements")
    .select("target_open_utc, outcome")
    .eq("model_version", C85_MODEL_VERSION)
    .order("target_open_utc", { ascending: false })
    .limit(4000);
  const map = new Map<string, string>();
  for (const r of (data ?? []) as Row[]) {
    const key = new Date(String(r.target_open_utc)).toISOString();
    if (!map.has(key)) map.set(key, String(r.outcome ?? ""));
  }
  return map;
}

function emptyDay(date: string): C85DayStats {
  return {
    date,
    opportunities: 0,
    calls: 0,
    wins: 0,
    losses: 0,
    net: 0,
    win_rate: null,
    coverage: null,
    bankroll_close_cents: C85_BANKROLL_PRINCIPAL_CENTS,
    bankroll_pnl_cents: 0,
  };
}

/** Daily-reset bankroll: every day starts from principal, 4% flat stake. */
function applyBankroll(day: C85DayStats, sequence: ("WIN" | "LOSS")[]): void {
  let cents = C85_BANKROLL_PRINCIPAL_CENTS;
  for (const outcome of sequence) {
    const stake = stakeCents(cents);
    cents += outcome === "WIN" ? winProfitCents(stake) : -stake;
  }
  day.bankroll_close_cents = cents;
  day.bankroll_pnl_cents = cents - C85_BANKROLL_PRINCIPAL_CENTS;
}

export async function buildC85Stats(): Promise<C85Stats> {
  const client = sb();
  const [rows, settlements, healthRes] = await Promise.all([
    loadTargets(),
    loadSettlements(),
    client
      .from(C85_HEALTH_TABLE)
      .select("*")
      .eq("model_version", C85_MODEL_VERSION)
      .order("last_heartbeat_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const health = (healthRes.data ?? null) as Row | null;

  let opportunities = 0;
  let calls = 0;
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let abstains = 0;
  let pending = 0;
  let liveOpportunities = 0;
  let liveCalls = 0;
  let backfillRows = 0;
  let signalsSent = 0;
  let signalsSuppressed = 0;
  let signalsExpired = 0;

  const offsets: number[] = [];
  let deadlineChecked = 0;
  let deadlineMet = 0;

  const byDay = new Map<string, C85DayStats>();
  const daySequence = new Map<string, ("WIN" | "LOSS")[]>();
  // Oldest first for the drawdown walk.
  const chronological = [...rows].reverse();
  const callOutcomes: number[] = [];

  for (const r of chronological) {
    const iso = new Date(String(r.target_open_utc)).toISOString();
    const side = Number(r.final_side ?? 0);
    const outcome = settlements.get(iso) ?? null;
    const runMode = String(r.run_mode ?? "");
    const date = boiseDate(iso);
    const day = byDay.get(date) ?? emptyDay(date);
    byDay.set(date, day);
    const seq = daySequence.get(date) ?? [];
    daySequence.set(date, seq);

    opportunities += 1;
    day.opportunities += 1;
    if (runMode === "LIVE") liveOpportunities += 1;
    else backfillRows += 1;

    const status = String(r.webhook_status ?? "");
    if (status === "SENT") signalsSent += 1;
    else if (status === "SUPPRESSED") signalsSuppressed += 1;
    else if (status === "EXPIRED") signalsExpired += 1;

    const offset = r.publication_offset_ms;
    if (offset != null && Number.isFinite(Number(offset))) offsets.push(Number(offset));
    if (r.deadline_met != null) {
      deadlineChecked += 1;
      if (r.deadline_met === true) deadlineMet += 1;
    }

    if (side === 0) {
      abstains += 1;
      continue; // abstains score zero and never enter the win-rate denominator
    }

    calls += 1;
    day.calls += 1;
    if (runMode === "LIVE") liveCalls += 1;

    if (outcome === "WIN") {
      wins += 1;
      day.wins += 1;
      day.net += 1;
      callOutcomes.push(1);
      seq.push("WIN");
    } else if (outcome === "LOSS") {
      losses += 1;
      day.losses += 1;
      day.net -= 1;
      callOutcomes.push(-1);
      seq.push("LOSS");
    } else if (outcome === "PUSH") {
      pushes += 1;
    } else {
      pending += 1;
    }
  }

  // Drawdown on the raw-net equity curve, reported separately from raw net.
  let equity = 0;
  let peak = 0;
  let maxDrawdown = 0;
  for (const step of callOutcomes) {
    equity += step;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDrawdown) maxDrawdown = dd;
  }
  const currentDrawdown = peak - equity;

  for (const [date, day] of byDay) {
    const graded = day.wins + day.losses;
    day.win_rate = graded > 0 ? day.wins / graded : null;
    day.coverage = day.opportunities > 0 ? day.calls / day.opportunities : null;
    applyBankroll(day, daySequence.get(date) ?? []);
  }

  const daily = [...byDay.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 14);
  const todayDate = boiseDate(new Date().toISOString());
  const today = byDay.get(todayDate) ?? emptyDay(todayDate);

  const graded = wins + losses;
  const newest = rows[0] ?? null;
  const heartbeatAt = health?.last_heartbeat_at ? new Date(String(health.last_heartbeat_at)) : null;
  const checkpointRes = await client
    .from("c85_state_checkpoints")
    .select("checkpoint_seq, as_of_utc")
    .eq("model_version", C85_MODEL_VERSION)
    .order("checkpoint_seq", { ascending: false })
    .limit(1)
    .maybeSingle();
  const checkpoint = (checkpointRes.data ?? null) as Row | null;

  return {
    model_version: C85_MODEL_VERSION,
    display_name: C85_DISPLAY_NAME,
    variant: C85_VARIANT,
    readiness: String(health?.readiness ?? "BLOCKED"),
    stage: (health?.stage as string) ?? null,
    blocking_reason: (health?.blocking_reason as string) ?? "worker_not_deployed",
    worker_id: (health?.worker_id as string) ?? null,
    build_sha: (health?.build_sha as string) ?? null,
    last_heartbeat_at: heartbeatAt?.toISOString() ?? null,
    heartbeat_age_s: heartbeatAt ? Math.round((Date.now() - heartbeatAt.getTime()) / 1000) : null,
    feed_freshness: (health?.feed_freshness as Record<string, unknown>) ?? null,
    model_as_of_utc: (health?.model_as_of_utc as string) ?? null,
    last_checkpoint_seq: checkpoint ? Number(checkpoint.checkpoint_seq) : null,
    checkpoint_age_s: checkpoint?.as_of_utc
      ? Math.round((Date.now() - new Date(String(checkpoint.as_of_utc)).getTime()) / 1000)
      : null,
    progress: (health?.progress as Record<string, unknown>) ?? null,

    opportunities,
    calls,
    wins,
    losses,
    pushes,
    abstains,
    pending,
    win_rate: graded > 0 ? wins / graded : null,
    coverage: opportunities > 0 ? calls / opportunities : null,
    raw_net: wins - losses,
    max_drawdown: maxDrawdown,
    current_drawdown: currentDrawdown,

    live_opportunities: liveOpportunities,
    live_calls: liveCalls,
    backfill_rows: backfillRows,

    last_target_utc: newest ? new Date(String(newest.target_open_utc)).toISOString() : null,
    next_target_utc: (health?.next_target_utc as string) ?? null,
    last_final_side: newest ? Number(newest.final_side ?? 0) : null,
    last_gate_reasons: (newest?.gate_reasons as string[]) ?? null,
    last_publication_offset_ms:
      newest?.publication_offset_ms == null ? null : Number(newest.publication_offset_ms),
    avg_publication_offset_ms: offsets.length
      ? offsets.reduce((a, b) => a + b, 0) / offsets.length
      : null,
    worst_publication_offset_ms: offsets.length ? Math.max(...offsets) : null,
    deadline_met_rate: deadlineChecked > 0 ? deadlineMet / deadlineChecked : null,
    signals_sent: signalsSent,
    signals_suppressed: signalsSuppressed,
    signals_expired: signalsExpired,
    last_dispatch_status: (newest?.webhook_status as string) ?? null,

    bankroll: {
      principal_cents: C85_BANKROLL_PRINCIPAL_CENTS,
      stake_cents: stakeCents(C85_BANKROLL_PRINCIPAL_CENTS),
      decimal_odds: C85_BANKROLL_DECIMAL_ODDS,
      today_close_cents: today.bankroll_close_cents,
      today_pnl_cents: today.bankroll_pnl_cents,
    },

    today,
    daily,
  };
}

/** Newest row — the decision for the most recent target. */
export async function loadC85Pending(): Promise<Row | null> {
  const { data } = await sb()
    .from(C85_TARGETS_TABLE)
    .select("*")
    .eq("model_version", C85_MODEL_VERSION)
    .order("target_open_utc", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Row) ?? null;
}
