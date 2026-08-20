// T45 PriceFlow Q37.5 — dashboard stats and CSV exports (server only).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  FEATURE_SCHEMA,
  MODEL_NAME,
  MODEL_VARIANT,
  MODEL_VERSION,
  PUBLICATION_MODE,
  T45PF_ACTIVATION_KEY,
  T45PF_CONFIG_HASH,
  T45PF_FEATURE_ORDER_HASH,
  T45PF_PREDICTIONS_TABLE,
  T45PF_RANK_THRESHOLD,
  T45PF_STREAM_KEY,
  boiseDate,
} from "./config";

type Row = Record<string, unknown>;

const PAGE = 1000;

async function pageAll(table: string, select: string, apply: (q: any) => any): Promise<Row[]> {
  const out: Row[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data, error } = await apply(
      (supabaseAdmin as any).from(table).select(select),
    ).range(offset, offset + PAGE - 1);
    if (error) throw new Error(`${table}:${error.message}`);
    const rows = (data ?? []) as Row[];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

export interface PFBucket {
  scheduled: number;
  evaluable: number;
  trades: number;
  wins: number;
  losses: number;
  pushes: number;
  abstains: number;
  unresolved: number;
  net: number;
  winRate: number | null;
  scheduledCoverage: number | null;
  evaluableCoverage: number | null;
  maxDrawdown: number;
  maxLossStreak: number;
  firstTs: string | null;
  lastTs: string | null;
}

export function pfBucket(rows: readonly Row[]): PFBucket {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let abstains = 0;
  let unresolved = 0;
  let evaluable = 0;
  let equity = 0;
  let peak = 0;
  let maxDd = 0;
  let streak = 0;
  let maxStreak = 0;
  const sorted = [...rows].sort((a, b) => String(a.target_ts).localeCompare(String(b.target_ts)));
  for (const r of sorted) {
    if (r.decision_valid === true) evaluable++;
    switch (r.active_result) {
      case "WIN":
        wins++;
        equity += 1;
        streak = 0;
        break;
      case "LOSS":
        losses++;
        equity -= 1;
        streak++;
        maxStreak = Math.max(maxStreak, streak);
        break;
      case "PUSH":
        pushes++;
        break;
      case "ABSTAIN":
        abstains++;
        break;
      default:
        unresolved++;
    }
    peak = Math.max(peak, equity);
    maxDd = Math.max(maxDd, peak - equity);
  }
  const trades = wins + losses + pushes;
  const decided = wins + losses;
  const ts = sorted.map((r) => String(r.target_ts));
  return {
    scheduled: rows.length,
    evaluable,
    trades,
    wins,
    losses,
    pushes,
    abstains,
    unresolved,
    net: wins - losses,
    winRate: decided > 0 ? (wins / decided) * 100 : null,
    scheduledCoverage: rows.length > 0 ? (trades / rows.length) * 100 : null,
    evaluableCoverage: evaluable > 0 ? (trades / evaluable) * 100 : null,
    maxDrawdown: maxDd,
    maxLossStreak: maxStreak,
    firstTs: ts[0] ?? null,
    lastTs: ts[ts.length - 1] ?? null,
  };
}

function byDay(rows: readonly Row[]): { date: string; net: number; wins: number; losses: number; trades: number }[] {
  const map = new Map<string, { net: number; wins: number; losses: number; trades: number }>();
  for (const r of rows) {
    const d = String(r.local_date ?? boiseDate(String(r.target_ts)));
    const e = map.get(d) ?? { net: 0, wins: 0, losses: 0, trades: 0 };
    if (r.active_result === "WIN") {
      e.wins++;
      e.net++;
      e.trades++;
    } else if (r.active_result === "LOSS") {
      e.losses++;
      e.net--;
      e.trades++;
    } else if (r.active_result === "PUSH") {
      e.trades++;
    }
    map.set(d, e);
  }
  return [...map.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([date, v]) => ({ date, ...v }));
}

function rolling7(days: { date: string; net: number }[]): { min: number | null; latest: number | null } {
  if (days.length === 0) return { min: null, latest: null };
  let min: number | null = null;
  let latest: number | null = null;
  for (let i = 0; i < days.length; i++) {
    const window = days.slice(Math.max(0, i - 6), i + 1);
    const net = window.reduce((a, d) => a + d.net, 0);
    if (i >= 6) min = min == null ? net : Math.min(min, net);
    latest = net;
  }
  return { min, latest };
}

export async function buildPriceFlowStats() {
  const [liveRows, backfillRows, healthRes, activationRes, legacyRows] = await Promise.all([
    pageAll(T45PF_PREDICTIONS_TABLE, "*", (q) =>
      q
        .eq("model_version", MODEL_VERSION)
        .eq("run_mode", "LIVE")
        .order("target_ts", { ascending: true }),
    ),
    pageAll(
      T45PF_PREDICTIONS_TABLE,
      "target_ts, local_date, decision_valid, active_result, packet_ready, timing_valid, unique_observations, fit_certified, rank_history_count",
      (q) =>
        q
          .eq("model_version", MODEL_VERSION)
          .eq("run_mode", "BACKFILL")
          .order("target_ts", { ascending: true }),
    ),
    (supabaseAdmin as any)
      .from("t45_collector_health")
      .select("*")
      .eq("stream_key", T45PF_STREAM_KEY)
      .maybeSingle(),
    (supabaseAdmin as any)
      .from("t45_pf_activation")
      .select("*")
      .eq("singleton_key", T45PF_ACTIVATION_KEY)
      .maybeSingle(),
    pageAll("t45_predictions", "target_ts, active_result", (q) =>
      q.eq("model_version", "t45-balanced-q375-r1").order("target_ts", { ascending: true }),
    ),
  ]);

  const health = (healthRes?.data ?? null) as Row | null;
  const activation = (activationRes?.data ?? null) as Row | null;
  const heartbeat = health?.last_heartbeat_at ? String(health.last_heartbeat_at) : null;
  const alive = heartbeat ? Date.now() - new Date(heartbeat).getTime() < 90_000 : false;

  const all = [...backfillRows, ...liveRows];
  const days = byDay(all);
  const liveDays = byDay(liveRows);

  const timingFailures = all.filter((r) => r.timing_valid === false).length;
  const packetFailures = all.filter((r) => r.packet_ready === false).length;
  const full45 = all.filter((r) => Number(r.unique_observations ?? 0) === 45).length;

  const legacy = pfBucket(
    legacyRows.map((r) => ({ ...r, decision_valid: r.active_result != null })),
  );

  return {
    modelName: MODEL_NAME,
    modelVersion: MODEL_VERSION,
    modelVariant: MODEL_VARIANT,
    featureSchema: FEATURE_SCHEMA,
    configHash: T45PF_CONFIG_HASH,
    featureOrderHash: T45PF_FEATURE_ORDER_HASH,
    rankThreshold: T45PF_RANK_THRESHOLD,
    publicationMode: PUBLICATION_MODE,
    activationMode: String(activation?.mode ?? PUBLICATION_MODE),
    webhooksEnabled: activation?.webhooks_enabled === true,
    live: pfBucket(liveRows),
    backfill: pfBucket(backfillRows),
    combined: pfBucket(all),
    packet: {
      streamKey: T45PF_STREAM_KEY,
      status: String(health?.status ?? "NO_DATA"),
      alive,
      lastHeartbeatAt: heartbeat,
      lastTargetTs: health?.last_target_ts ? String(health.last_target_ts) : null,
      lastTargetSeconds:
        health?.last_target_seconds == null ? null : Number(health.last_target_seconds),
      full45,
      timingFailures,
      packetFailures,
      coverage: all.length ? (full45 / all.length) * 100 : null,
    },
    readiness: {
      fitReady: all.some((r) => r.fit_certified === true),
      rankReady: all.some((r) => Number(r.rank_history_count ?? 0) >= 192),
      liveRows: liveRows.length,
      backfillRows: backfillRows.length,
    },
    daily: liveDays.slice(-14),
    dailyAll: days.slice(-30),
    rolling7: rolling7(days),
    negativeDays: days.filter((d) => d.net < 0).length,
    worstDay: days.reduce<{ date: string; net: number } | null>(
      (w, d) => (w == null || d.net < w.net ? { date: d.date, net: d.net } : w),
      null,
    ),
    legacyCounterfactual: {
      modelVersion: "t45-balanced-q375-r1",
      trades: legacy.trades,
      wins: legacy.wins,
      losses: legacy.losses,
      pushes: legacy.pushes,
      net: legacy.net,
      winRate: legacy.winRate,
    },
    webhookProof: {
      eligibleRows: all.filter((r) => r.webhook_eligible === true).length,
      sentRows: all.filter((r) => r.webhook_sent === true).length,
    },
  };
}

export async function loadPriceFlowPending(): Promise<Row | null> {
  const { data } = await (supabaseAdmin as any)
    .from(T45PF_PREDICTIONS_TABLE)
    .select("*")
    .eq("model_version", MODEL_VERSION)
    .eq("run_mode", "LIVE")
    .order("target_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Row | null) ?? null;
}

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: readonly Row[]): string {
  if (rows.length === 0) return "";
  const cols = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  const lines = [cols.join(",")];
  for (const r of rows) lines.push(cols.map((c) => csvEscape(r[c])).join(","));
  return lines.join("\n");
}

/** Every PriceFlow row, oldest first, with the feature snapshot flattened. */
export async function buildPriceFlowCsv(): Promise<{
  filename: string;
  csv: string;
  rows: number;
}> {
  const rows = await pageAll(T45PF_PREDICTIONS_TABLE, "*", (q) =>
    q.eq("model_version", MODEL_VERSION).order("target_ts", { ascending: true }),
  );
  const flat = rows.map((r) => {
    const { feature_values_json, ...rest } = r as Row & {
      feature_values_json?: Record<string, unknown> | null;
    };
    const out: Row = { ...rest };
    for (const [k, v] of Object.entries(feature_values_json ?? {})) out[`feature_${k}`] = v;
    return out;
  });
  return {
    filename: `t45_price_flow_q375_${new Date().toISOString().slice(0, 10)}.csv`,
    csv: toCsv(flat),
    rows: flat.length,
  };
}
