// B4x4-ES1 Binance Order-Book R1 — dashboard stats, health, CSV exports.
//
// Read-only reporting for a shadow-only subsystem.

import { createServerFn } from "@tanstack/react-start";
import {
  BINANCE_OB_POLICIES,
  BINANCE_OB_POLICY_VERSION,
  BINANCE_OB_VERSION,
  binanceObLocalDate,
  type BinanceObPolicyName,
} from "./b4x4es1/binanceOb/config";
import { cachedStats } from "./statsCache.server";

type Row = Record<string, unknown>;
/** Serializable projection returned over the server-fn boundary. */
type JsonRow = Record<string, string | number | boolean | null>;

function toJsonRows(rows: Row[]): JsonRow[] {
  return rows.map((r) => {
    const out: JsonRow = {};
    for (const [k, v] of Object.entries(r)) {
      out[k] =
        v == null
          ? null
          : typeof v === "string" || typeof v === "number" || typeof v === "boolean"
            ? v
            : JSON.stringify(v);
    }
    return out;
  });
}
const PAGE = 1000;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function pageAll(table: string, select: string, order: string): Promise<Row[]> {
  const sb = (await admin()) as unknown as {
    from: (t: string) => {
      select: (s: string) => {
        order: (
          c: string,
          o: { ascending: boolean },
        ) => { range: (a: number, b: number) => Promise<{ data: Row[] | null }> };
      };
    };
  };
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await sb
      .from(table)
      .select(select)
      .order(order, { ascending: true })
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as Row[]));
    if (data.length < PAGE) break;
  }
  return out;
}

export interface PolicyStat {
  policy_name: BinanceObPolicyName;
  targets: number;
  qualified: number;
  resolved: number;
  wins: number;
  losses: number;
  pushes: number;
  net: number;
  win_rate: number;
  coverage: number;
  green_calls: number;
  red_calls: number;
  top_abstain_reason: string | null;
}

function emptyStat(name: BinanceObPolicyName): PolicyStat {
  return {
    policy_name: name,
    targets: 0,
    qualified: 0,
    resolved: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    net: 0,
    win_rate: 0,
    coverage: 0,
    green_calls: 0,
    red_calls: 0,
    top_abstain_reason: null,
  };
}

/** Aggregate shadow performance for all six frozen policies. */
export const getBinanceObStats = createServerFn({ method: "GET" }).handler(async () =>
  cachedStats("binance-ob-stats", async () => {
    const rows = await pageAll(
      "b4x4_es1_binance_ob_policy_shadows",
      "target_ts, policy_name, qualified, qualification_reason, candidate_direction, result, result_score, resolved_at",
      "target_ts",
    );
    const stats = new Map<BinanceObPolicyName, PolicyStat>();
    const reasons = new Map<string, Map<string, number>>();
    for (const name of BINANCE_OB_POLICIES) {
      stats.set(name, emptyStat(name));
      reasons.set(name, new Map());
    }

    for (const r of rows) {
      const name = r.policy_name as BinanceObPolicyName;
      const s = stats.get(name);
      if (!s) continue;
      s.targets++;
      if (r.qualified === true) {
        s.qualified++;
        if (r.candidate_direction === "GREEN") s.green_calls++;
        if (r.candidate_direction === "RED") s.red_calls++;
      } else {
        const key = String(r.qualification_reason ?? "UNKNOWN");
        const m = reasons.get(name)!;
        m.set(key, (m.get(key) ?? 0) + 1);
      }
      if (r.resolved_at != null && r.candidate_direction != null) {
        s.resolved++;
        const res = String(r.result ?? "");
        if (res === "WIN") s.wins++;
        else if (res === "LOSS") s.losses++;
        else if (res === "PUSH") s.pushes++;
        s.net += Number(r.result_score ?? 0);
      }
    }

    const out: PolicyStat[] = [];
    for (const name of BINANCE_OB_POLICIES) {
      const s = stats.get(name)!;
      const evaluable = s.wins + s.losses;
      s.win_rate = evaluable > 0 ? (s.wins / evaluable) * 100 : 0;
      s.coverage = s.targets > 0 ? (s.qualified / s.targets) * 100 : 0;
      const m = reasons.get(name)!;
      let top: string | null = null;
      let best = 0;
      for (const [k, v] of m) {
        if (v > best) {
          best = v;
          top = k;
        }
      }
      s.top_abstain_reason = top;
      out.push(s);
    }

    const totalTargets = new Set(rows.map((r) => String(r.target_ts))).size;
    return {
      version: BINANCE_OB_VERSION,
      policy_version: BINANCE_OB_POLICY_VERSION,
      total_targets: totalTargets,
      policies: out,
      generated_at: new Date().toISOString(),
      local_date: binanceObLocalDate(new Date().toISOString()),
    };
  }),
);

/** Collector liveness and capture quality for the most recent boundaries. */
export const getBinanceObHealth = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { binanceObHealth } = await import("./b4x4es1/binanceOb/orchestrator.server");
  const collectors = await binanceObHealth(sb as never);
  const { data } = await sb
    .from("b4x4_es1_binance_ob_boundary_features")
    .select(
      "target_ts, market_kind, capture_status, ready, ready_reason, history_ready, history_valid_count, observation_count_60s, final_imbalance_10bps, abs_imbalance_percentile_96",
    )
    .eq("feature_version", BINANCE_OB_VERSION)
    .order("target_ts", { ascending: false })
    .limit(24);
  return {
    collectors,
    recent_boundaries: toJsonRows((data ?? []) as unknown as Row[]),
    generated_at: new Date().toISOString(),
  };
});

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(rows: Row[]): { csv: string; rows: number } {
  if (rows.length === 0) return { csv: "", rows: 0 };
  const columns = Object.keys(rows[0]!);
  const header = columns.join(",");
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(",")).join("\n");
  return { csv: `${header}\n${body}\n`, rows: rows.length };
}

/** Full boundary feature export (one row per target per market). */
export const exportBinanceObFeaturesCsv = createServerFn({ method: "GET" }).handler(async () =>
  toCsv(await pageAll("b4x4_es1_binance_ob_boundary_features", "*", "target_ts")),
);

/** Full shadow policy export (one row per target per policy). */
export const exportBinanceObPolicyCsv = createServerFn({ method: "GET" }).handler(async () =>
  toCsv(await pageAll("b4x4_es1_binance_ob_policy_shadows", "*", "target_ts")),
);

/** Raw one-second observation export, most recent targets first. */
export const exportBinanceObObservationsCsv = createServerFn({ method: "GET" })
  .inputValidator((input: { targets?: number } | undefined) => ({
    targets: Math.max(1, Math.min(input?.targets ?? 96, 384)),
  }))
  .handler(async ({ data }) => {
    const sb = await admin();
    const since = new Date(Date.now() - data.targets * 15 * 60 * 1000).toISOString();
    const out: Row[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data: page } = await sb
        .from("b4x4_es1_binance_ob_observations")
        .select("*")
        .gte("target_ts", since)
        .order("target_ts", { ascending: true })
        .order("sample_offset_seconds", { ascending: false })
        .range(from, from + PAGE - 1);
      if (!page || page.length === 0) break;
      out.push(...(page as unknown as Row[]));
      if (page.length < PAGE) break;
    }
    return toCsv(out);
  });
