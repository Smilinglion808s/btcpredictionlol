// T30 PriceFlow Balanced — dashboard aggregates, pending row and CSV export.
//
// Reads t30_* only. Nothing here can influence a decision.

import { createClient } from "@supabase/supabase-js";
import {
  T30_ACTIVATION_KEY,
  T30_ACTIVATION_TABLE,
  T30_CONFIG_HASH,
  T30_FEATURE_ORDER,
  T30_FEATURE_ORDER_HASH,
  T30_MODEL_NAME,
  T30_MODEL_VARIANT,
  T30_MODEL_VERSION,
  T30_PREDICTIONS_TABLE,
  T30_SHADOWS_TABLE,
  boiseDate,
} from "./config";

type Row = Record<string, unknown>;

function sb() {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const PAGE = 1000;

async function countRows(filter: (q: any) => any): Promise<number> {
  const { count, error } = await filter(
    sb()
      .from(T30_PREDICTIONS_TABLE)
      .select("target_ts", { count: "exact", head: true })
      .eq("model_version", T30_MODEL_VERSION)
      .eq("run_mode", "LIVE"),
  );
  if (error) throw new Error(`t30_stats:${error.message}`);
  return count ?? 0;
}

export interface T30Stats {
  model_name: string;
  model_version: string;
  model_variant: string;
  config_hash: string;
  feature_order_hash: string;
  mode: string;
  webhooks_enabled: boolean;
  total_rows: number;
  decided: number;
  traded: number;
  wins: number;
  losses: number;
  pushes: number;
  abstains: number;
  pending: number;
  win_rate: number | null;
  net_units: number;
  packet_ready_rate: number | null;
  last_target_ts: string | null;
  last_decision_reason: string | null;
  last_latency_ms: number | null;
  last_decision_offset_ms: number | null;
  last_webhook_sent: boolean | null;
  last_webhook_sent_at: string | null;
  last_webhook_latency_ms: number | null;
  last_webhook_offset_ms: number | null;
  today: {
    date: string;
    traded: number;
    wins: number;
    losses: number;
    net_units: number;
    win_rate: number | null;
  };
  daily: {
    date: string;
    traded: number;
    wins: number;
    losses: number;
    net: number;
    win_rate: number | null;
  }[];
  shadows: {
    policy: string;
    traded: number;
    wins: number;
    losses: number;
    win_rate: number | null;
  }[];
}

export async function buildT30Stats(): Promise<T30Stats> {
  const client = sb();
  const [{ data: activation }, total, traded, wins, losses, pushes, abstains, pending, packetReady] =
    await Promise.all([
      client
        .from(T30_ACTIVATION_TABLE)
        .select("mode, webhooks_enabled")
        .eq("singleton_key", T30_ACTIVATION_KEY)
        .maybeSingle(),
      countRows((q: any) => q),
      countRows((q: any) => q.eq("model_would_trade", true)),
      countRows((q: any) => q.eq("result", "WIN")),
      countRows((q: any) => q.eq("result", "LOSS")),
      countRows((q: any) => q.eq("result", "PUSH")),
      countRows((q: any) => q.eq("result", "ABSTAIN")),
      countRows((q: any) => q.is("resolved_at", null)),
      countRows((q: any) => q.eq("packet_ready", true)),
    ]);

  const decided = wins + losses + pushes + abstains;
  const graded = wins + losses;

  const { data: last } = await client
    .from(T30_PREDICTIONS_TABLE)
    .select(
      "target_ts, decision_reason, decision_latency_ms, decision_offset_ms, webhook_sent, webhook_sent_at, webhook_latency_ms, webhook_offset_ms",
    )
    .eq("model_version", T30_MODEL_VERSION)
    .eq("run_mode", "LIVE")
    .order("target_ts", { ascending: false })
    .limit(1)
    .maybeSingle();

  // Today (America/Boise) — small bounded window.
  const since = new Date(Date.now() - 16 * 24 * 3600_000).toISOString();
  const { data: recent } = await client
    .from(T30_PREDICTIONS_TABLE)
    .select("target_ts, result")
    .eq("model_version", T30_MODEL_VERSION)
    .eq("run_mode", "LIVE")
    .gte("target_ts", since)
    .order("target_ts", { ascending: true });
  const todayKey = boiseDate(new Date().toISOString());
  let tW = 0;
  let tL = 0;
  let tT = 0;
  const dayMap = new Map<string, { traded: number; wins: number; losses: number }>();
  for (const r of (recent ?? []) as Row[]) {
    const day = boiseDate(String(r.target_ts));
    const isToday = day === todayKey;
    const agg = dayMap.get(day) ?? { traded: 0, wins: 0, losses: 0 };
    if (r.result === "WIN") {
      agg.wins++;
      agg.traded++;
      if (isToday) {
        tW++;
        tT++;
      }
    } else if (r.result === "LOSS") {
      agg.losses++;
      agg.traded++;
      if (isToday) {
        tL++;
        tT++;
      }
    } else if (r.result === "PUSH") {
      agg.traded++;
      if (isToday) tT++;
    } else continue;
    dayMap.set(day, agg);
  }

  const { data: shadowRows } = await client
    .from(T30_SHADOWS_TABLE)
    .select("policy, result")
    .eq("run_mode", "LIVE")
    .not("result", "is", null)
    .limit(20000);
  const byPolicy = new Map<string, { traded: number; wins: number; losses: number }>();
  for (const r of (shadowRows ?? []) as Row[]) {
    const key = String(r.policy);
    const agg = byPolicy.get(key) ?? { traded: 0, wins: 0, losses: 0 };
    if (r.result === "WIN") {
      agg.wins++;
      agg.traded++;
    } else if (r.result === "LOSS") {
      agg.losses++;
      agg.traded++;
    } else if (r.result === "PUSH") agg.traded++;
    byPolicy.set(key, agg);
  }

  return {
    model_name: T30_MODEL_NAME,
    model_version: T30_MODEL_VERSION,
    model_variant: T30_MODEL_VARIANT,
    config_hash: T30_CONFIG_HASH,
    feature_order_hash: T30_FEATURE_ORDER_HASH,
    mode: String(activation?.mode ?? "SHADOW_ONLY"),
    webhooks_enabled: activation?.webhooks_enabled === true,
    total_rows: total,
    decided,
    traded,
    wins,
    losses,
    pushes,
    abstains,
    pending,
    win_rate: graded ? (wins / graded) * 100 : null,
    net_units: wins - losses,
    packet_ready_rate: total ? (packetReady / total) * 100 : null,
    last_target_ts: last ? String(last.target_ts) : null,
    last_decision_reason: last ? ((last.decision_reason as string | null) ?? null) : null,
    last_latency_ms: last ? ((last.decision_latency_ms as number | null) ?? null) : null,
    last_decision_offset_ms: last ? ((last.decision_offset_ms as number | null) ?? null) : null,
    last_webhook_sent: last ? ((last.webhook_sent as boolean | null) ?? null) : null,
    last_webhook_sent_at: last?.webhook_sent_at ? String(last.webhook_sent_at) : null,
    last_webhook_latency_ms: last ? ((last.webhook_latency_ms as number | null) ?? null) : null,
    last_webhook_offset_ms: last ? ((last.webhook_offset_ms as number | null) ?? null) : null,
    today: {
      date: todayKey,
      traded: tT,
      wins: tW,
      losses: tL,
      net_units: tW - tL,
      win_rate: tW + tL ? (tW / (tW + tL)) * 100 : null,
    },
    daily: [...dayMap.entries()]
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(-14)
      .map(([date, a]) => ({
        date,
        traded: a.traded,
        wins: a.wins,
        losses: a.losses,
        net: a.wins - a.losses,
        win_rate: a.wins + a.losses ? (a.wins / (a.wins + a.losses)) * 100 : null,
      })),
    shadows: [...byPolicy.entries()]
      .map(([policy, a]) => ({
        policy,
        traded: a.traded,
        wins: a.wins,
        losses: a.losses,
        win_rate: a.wins + a.losses ? (a.wins / (a.wins + a.losses)) * 100 : null,
      }))
      .sort((a, b) => a.policy.localeCompare(b.policy)),
  };
}

export async function loadT30Pending(): Promise<Record<string, string | number | boolean | null> | null> {
  const { data } = await sb()
    .from(T30_PREDICTIONS_TABLE)
    .select(
      "target_ts, decided_at, decision_reason, decision_valid, model_would_trade, model_direction, probability_green, confidence, long_rank, fast_rank, packet_ready, packet_reason, seconds_present, fit_id, fit_certified, decision_latency_ms, decision_offset_ms, webhook_sent, webhook_sent_at, webhook_latency_ms, webhook_offset_ms, within_publish_deadline, result, resolved_at",
    )
    .eq("model_version", T30_MODEL_VERSION)
    .eq("run_mode", "LIVE")
    .order("target_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Record<string, string | number | boolean | null> | null) ?? null;
}

export const CSV_COLUMNS = [
  "target_ts",
  "run_mode",
  "trigger_kind",
  "decided_at",
  "decision_latency_ms",
  "decision_offset_ms",
  "webhook_sent",
  "webhook_sent_at",
  "webhook_latency_ms",
  "webhook_offset_ms",
  "within_publish_deadline",
  "packet_ready",
  "packet_reason",
  "seconds_present",
  "first_offset_s",
  "last_offset_s",
  "spot_complete",
  "feature_complete",
  "fit_id",
  "fit_block_index",
  "fit_certified",
  "probability_green",
  "confidence",
  "base_direction",
  "long_rank",
  "long_rank_history",
  "fast_rank",
  "fast_rank_history",
  "gate_long_ready",
  "gate_fast_ready",
  "gate_long_passed",
  "gate_fast_passed",
  "model_direction",
  "model_would_trade",
  "decision_valid",
  "decision_reason",
  "spot_open",
  "actual_open",
  "actual_high",
  "actual_low",
  "actual_close",
  "actual_direction",
  "outcome_source",
  "resolved_at",
  "result",
  "score",
  "decimal_odds",
  "odds_units",
];

function csvCell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "number" ? String(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Full-history CSV: audit fields plus every frozen feature, newest-first paged. */
export async function buildT30Csv(): Promise<{ filename: string; csv: string; rows: number }> {
  const client = sb();
  const header = [...CSV_COLUMNS, ...T30_FEATURE_ORDER];
  const lines: string[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await client
      .from(T30_PREDICTIONS_TABLE)
      .select([...CSV_COLUMNS, "features"].join(", "))
      .eq("model_version", T30_MODEL_VERSION)
      .order("target_ts", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw new Error(`t30_csv:${error.message}`);
    const rows = (data ?? []) as unknown as Row[];
    for (const r of rows) {
      const feat = (r.features ?? {}) as Row;
      lines.push(
        [
          ...CSV_COLUMNS.map((c) => csvCell(r[c])),
          ...T30_FEATURE_ORDER.map((f) => csvCell(feat[f])),
        ].join(","),
      );
    }
    if (rows.length < PAGE) break;
  }
  lines.reverse();
  return {
    filename: `t30-priceflow-balanced-${new Date().toISOString().slice(0, 10)}.csv`,
    csv: [header.join(","), ...lines].join("\n"),
    rows: lines.length,
  };
}
