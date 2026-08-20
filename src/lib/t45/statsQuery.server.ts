// T45 Balanced — dashboard stats, pending row and CSV exports (server only).

import { supabaseAdmin } from "@/integrations/supabase/client.server";
import {
  T45_CONFIG_HASH,
  T45_FREEZE_SHA256,
  T45_MODEL_NAME,
  T45_MODEL_VARIANT,
  T45_MODEL_VERSION,
  T45_R2_PRIOR_KEY,
  T45_RANK_THRESHOLD,
  T45_STREAM_KEY,
} from "./config";

type Row = Record<string, unknown>;

const PAGE = 1000;

async function pageAll(
  table: string,
  select: string,
  apply: (q: any) => any,
): Promise<Row[]> {
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

export interface T45Stats {
  modelName: string;
  modelVersion: string;
  modelVariant: string;
  configHash: string;
  freezeSha256: string;
  r2PriorKey: string;
  rankThreshold: number;
  mode: string;
  webhooksEnabled: boolean;
  live: T45Bucket;
  research: T45Bucket;
  collector: {
    streamKey: string;
    status: string;
    lastHeartbeatAt: string | null;
    lastTargetTs: string | null;
    lastTargetSeconds: number | null;
    alive: boolean;
  };
  blockers: string[];
}

export interface T45Bucket {
  rows: number;
  trades: number;
  wins: number;
  losses: number;
  pushes: number;
  abstains: number;
  unresolved: number;
  winRate: number | null;
  net: number;
  firstTs: string | null;
  lastTs: string | null;
}

function bucket(rows: readonly Row[]): T45Bucket {
  let wins = 0;
  let losses = 0;
  let pushes = 0;
  let abstains = 0;
  let unresolved = 0;
  for (const r of rows) {
    switch (r.active_result) {
      case "WIN":
        wins++;
        break;
      case "LOSS":
        losses++;
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
  }
  const trades = wins + losses + pushes;
  const decided = wins + losses;
  const ts = rows.map((r) => String(r.target_ts)).sort();
  return {
    rows: rows.length,
    trades,
    wins,
    losses,
    pushes,
    abstains,
    unresolved,
    winRate: decided > 0 ? (wins / decided) * 100 : null,
    net: wins - losses,
    firstTs: ts[0] ?? null,
    lastTs: ts[ts.length - 1] ?? null,
  };
}

export async function buildT45Stats(): Promise<T45Stats> {
  const [liveRows, researchRows, healthRes, activationRes] = await Promise.all([
    pageAll("t45_predictions", "target_ts, active_result", (q) =>
      q
        .eq("model_version", T45_MODEL_VERSION)
        .eq("run_mode", "LIVE")
        .order("target_ts", { ascending: true }),
    ),
    pageAll("t45_predictions", "target_ts, active_result", (q) =>
      q
        .eq("model_version", T45_MODEL_VERSION)
        .eq("run_mode", "BACKFILL")
        .order("target_ts", { ascending: true }),
    ),
    (supabaseAdmin as any)
      .from("t45_collector_health")
      .select("*")
      .eq("stream_key", T45_STREAM_KEY)
      .maybeSingle(),
    (supabaseAdmin as any)
      .from("t45_activation")
      .select("*")
      .eq("singleton_key", "T45_BALANCED")
      .maybeSingle(),
  ]);

  const health = (healthRes?.data ?? null) as Row | null;
  const activation = (activationRes?.data ?? null) as Row | null;
  const heartbeat = health?.last_heartbeat_at ? String(health.last_heartbeat_at) : null;
  const alive = heartbeat ? Date.now() - new Date(heartbeat).getTime() < 30_000 : false;

  const blockers: string[] = [];
  if (!alive) blockers.push("ONE_SECOND_COLLECTOR_NOT_LIVE");
  const liveBucket = bucket(liveRows);
  if (liveBucket.rows === 0) blockers.push("NO_OBSERVED_LIVE_CYCLE");
  blockers.push("CERTIFIED_LIVE_R2_PRIOR_UNAVAILABLE");
  if (activation?.webhooks_enabled !== true) blockers.push("PUBLICATION_DISABLED");

  return {
    modelName: T45_MODEL_NAME,
    modelVersion: T45_MODEL_VERSION,
    modelVariant: T45_MODEL_VARIANT,
    configHash: T45_CONFIG_HASH,
    freezeSha256: T45_FREEZE_SHA256,
    r2PriorKey: T45_R2_PRIOR_KEY,
    rankThreshold: T45_RANK_THRESHOLD,
    mode: String(activation?.mode ?? "SHADOW_ONLY"),
    webhooksEnabled: activation?.webhooks_enabled === true,
    live: liveBucket,
    research: bucket(researchRows),
    collector: {
      streamKey: T45_STREAM_KEY,
      status: String(health?.status ?? "NO_DATA"),
      lastHeartbeatAt: heartbeat,
      lastTargetTs: health?.last_target_ts ? String(health.last_target_ts) : null,
      lastTargetSeconds:
        health?.last_target_seconds == null ? null : Number(health.last_target_seconds),
      alive,
    },
    blockers,
  };
}

export async function loadT45Pending(): Promise<Record<string, string | number | boolean | null> | null> {
  const { data } = await (supabaseAdmin as any)
    .from("t45_predictions")
    .select("*")
    .eq("model_version", T45_MODEL_VERSION)
    .eq("run_mode", "LIVE")
    .order("target_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as Record<string, string | number | boolean | null> | null) ?? null;
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

/** Every T45 prediction row (research backfill + live), oldest first. */
export async function buildT45Csv(): Promise<{ filename: string; csv: string; rows: number }> {
  const rows = await pageAll("t45_predictions", "*", (q) =>
    q.eq("model_version", T45_MODEL_VERSION).order("target_ts", { ascending: true }),
  );
  return {
    filename: `t45_balanced_predictions_${new Date().toISOString().slice(0, 10)}.csv`,
    csv: toCsv(rows),
    rows: rows.length,
  };
}

/** Every tracked T45 feature row joined to its decision — full diagnostics. */
export async function buildT45FeaturesCsv(): Promise<{
  filename: string;
  csv: string;
  rows: number;
}> {
  const [features, preds] = await Promise.all([
    pageAll("t45_features", "*", (q) => q.order("target_ts", { ascending: true })),
    pageAll("t45_predictions", "*", (q) =>
      q.eq("model_version", T45_MODEL_VERSION).order("target_ts", { ascending: true }),
    ),
  ]);
  const byTs = new Map(
    preds.map((p) => [new Date(String(p.target_ts)).toISOString(), p]),
  );
  const merged = features.map((f) => {
    const ts = new Date(String(f.target_ts)).toISOString();
    const p = byTs.get(ts) ?? {};
    const out: Row = { target_ts: ts };
    for (const [k, v] of Object.entries(f)) if (k !== "id" && k !== "target_ts") out[k] = v;
    for (const [k, v] of Object.entries(p)) {
      if (k === "id" || k === "target_ts") continue;
      out[`decision_${k}`] = v;
    }
    return out;
  });
  return {
    filename: `t45_balanced_full_tracking_${new Date().toISOString().slice(0, 10)}.csv`,
    csv: toCsv(merged),
    rows: merged.length,
  };
}
