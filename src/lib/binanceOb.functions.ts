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
type Any = Record<string, any>;
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

// ---------------------------------------------------------------------------
// Dedicated combined export: B4x4-ES1-Binance-OB.csv
// Same-target SPOT features + PERP features + all six policies + resolution.
// The 100 ms / one-second stream is deliberately excluded.
// ---------------------------------------------------------------------------

export const exportBinanceObCombinedCsv = createServerFn({ method: "GET" }).handler(async () => {
  const { buildCombinedRows, combinedColumns, rowsToCsv } = await import(
    "./b4x4es1/binanceOb/exports"
  );
  const { BINANCE_OB_OUTCOME_SOURCE } = await import("./b4x4es1/binanceOb/config");
  const [features, policies] = await Promise.all([
    pageAll("b4x4_es1_binance_ob_boundary_features", "*", "target_ts"),
    pageAll("b4x4_es1_binance_ob_policy_shadows", "*", "target_ts"),
  ]);
  const rows = buildCombinedRows({
    features,
    policies,
    localDate: binanceObLocalDate,
    outcomeSource: BINANCE_OB_OUTCOME_SOURCE,
    featureVersion: BINANCE_OB_VERSION,
    policyVersion: BINANCE_OB_POLICY_VERSION,
  });
  return { csv: rowsToCsv(combinedColumns(), rows), rows: rows.length };
});

// ---------------------------------------------------------------------------
// Dashboard reporting. Empty production data renders as zero / NOT_READY —
// never as a successful capture.
// ---------------------------------------------------------------------------

function quantile(sorted: number[], q: number): number | null {
  if (sorted.length === 0) return null;
  const idx = (sorted.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return lo === hi ? sorted[lo]! : sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (idx - lo);
}

export const getBinanceObDashboard = createServerFn({ method: "GET" }).handler(async () =>
  cachedStats("binance-ob-dashboard", async () => {
    const sb = await admin();
    const { binanceObHealth } = await import("./b4x4es1/binanceOb/orchestrator.server");
    const { EXPECTED_OBSERVATIONS, HISTORY_WINDOW, HEARTBEAT_INTERVAL_MS } = await import(
      "./b4x4es1/binanceOb/config"
    );
    const { readActivation } = await import("./b4x4es1/binanceOb/store.server");

    const [collectors, activation] = await Promise.all([
      binanceObHealth(sb as never),
      readActivation(sb as never),
    ]);

    const { data: healthRows } = await sb
      .from("b4x4_es1_binance_ob_collector_health")
      .select("*");
    const now = Date.now();
    const markets = ["SPOT", "USD_M_PERP"] as const;
    const connection = markets.map((m) => {
      const h = (healthRows ?? []).find((r: Any) => r.market_kind === m) as Any | undefined;
      const c = collectors.find((x) => x.marketKind === m);
      const hb = h?.last_heartbeat_at ? new Date(h.last_heartbeat_at).getTime() : null;
      const conn = h?.connection_started_at ? new Date(h.connection_started_at).getTime() : null;
      return {
        market_kind: m,
        status: c?.status ?? "NOT_REPORTING",
        alive: c?.alive === true,
        deployment_id: h?.deployment_id ?? null,
        last_event: h?.last_event ?? null,
        last_event_at: h?.last_event_at ?? null,
        heartbeat_age_ms: hb == null ? null : now - hb,
        heartbeat_interval_ms: h?.heartbeat_interval_ms ?? HEARTBEAT_INTERVAL_MS,
        connection_age_ms: conn == null ? null : now - conn,
        resync_count: Number(h?.resync_count ?? 0),
        reconnect_count: Number(h?.reconnect_count ?? 0),
        sequence_gap_count: Number(h?.sequence_gap_count ?? 0),
        planned_rollover_count: Number(h?.planned_rollover_count ?? 0),
        snapshot_sync_count: Number(h?.snapshot_sync_count ?? 0),
        region_blocked: h?.region_blocked === true,
        last_error_message: h?.last_error_message ?? null,
      };
    });

    const features = (await pageAll(
      "b4x4_es1_binance_ob_boundary_features",
      "target_ts, market_kind, capture_status, ready, ready_reason, history_ready, history_valid_count, observation_count_60s, expected_observation_count_60s, watchdog_created, failure_reason, final_target_age_ms, receive_latency_p50_ms, sequence_ok, book_complete_10bps",
      "target_ts",
    )) as Any[];

    const perMarket = markets.map((m) => {
      const rows = features.filter((r) => r.market_kind === m);
      const last96 = rows.slice(-HISTORY_WINDOW);
      const ages: number[] = [];
      let observed = 0;
      let gaps = 0;
      let stale = 0;
      let missing = 0;
      let crossed = 0;
      let incomplete = 0;
      let resyncing = 0;
      for (const r of rows) {
        observed += Number(r.observation_count_60s ?? 0);
        const st = String(r.capture_status ?? "");
        if (st === "SEQUENCE_GAP") gaps++;
        else if (st === "STALE") stale++;
        else if (st === "NO_DATA") missing++;
        else if (st === "CROSSED_BOOK") crossed++;
        else if (st === "INCOMPLETE_BOOK") incomplete++;
        else if (st === "RESYNCING") resyncing++;
        const age = Number(r.final_target_age_ms ?? NaN);
        if (Number.isFinite(age)) ages.push(age);
      }
      ages.sort((a, b) => a - b);
      const ready = rows.filter((r) => r.ready === true).length;
      const ready96 = last96.filter((r) => r.ready === true).length;
      const historyValid = Number(rows[rows.length - 1]?.history_valid_count ?? 0);
      return {
        market_kind: m,
        boundaries: rows.length,
        ready,
        coverage_pct: rows.length > 0 ? (ready / rows.length) * 100 : 0,
        coverage_last96_pct: last96.length > 0 ? (ready96 / last96.length) * 100 : 0,
        expected_observations: rows.length * EXPECTED_OBSERVATIONS,
        actual_observations: observed,
        capture_age_p50_ms: quantile(ages, 0.5),
        capture_age_p90_ms: quantile(ages, 0.9),
        capture_age_p95_ms: quantile(ages, 0.95),
        capture_age_max_ms: ages.length > 0 ? ages[ages.length - 1]! : null,
        sequence_gaps: gaps,
        resyncing,
        stale,
        missing,
        crossed,
        incomplete,
        watchdog_rows: rows.filter((r) => r.watchdog_created === true).length,
        history_valid_count: historyValid,
        history_window: HISTORY_WINDOW,
        history_warmup_pct: Math.min(100, (historyValid / HISTORY_WINDOW) * 100),
        history_ready: rows[rows.length - 1]?.history_ready === true,
      };
    });

    const shadows = (await pageAll(
      "b4x4_es1_binance_ob_policy_shadows",
      "target_ts, policy_name, qualified, candidate_direction, result, result_score, resolved_at",
      "target_ts",
    )) as Any[];

    const summarize = (rows: Any[]) => {
      let opportunities = 0;
      let wouldTrade = 0;
      let resolved = 0;
      let wins = 0;
      let losses = 0;
      let pushes = 0;
      let net = 0;
      let equity = 0;
      let peak = 0;
      let maxDrawdown = 0;
      let streak = 0;
      let maxLossStreak = 0;
      const byDay = new Map<string, number>();
      for (const r of rows) {
        opportunities++;
        if (r.qualified === true && r.candidate_direction != null) wouldTrade++;
        if (r.resolved_at == null || r.candidate_direction == null) continue;
        resolved++;
        const res = String(r.result ?? "");
        const score = Number(r.result_score ?? 0);
        net += score;
        if (res === "WIN") {
          wins++;
          streak = 0;
        } else if (res === "LOSS") {
          losses++;
          streak++;
          maxLossStreak = Math.max(maxLossStreak, streak);
        } else if (res === "PUSH") pushes++;
        equity += score;
        peak = Math.max(peak, equity);
        maxDrawdown = Math.min(maxDrawdown, equity - peak);
        const day = binanceObLocalDate(String(r.target_ts));
        byDay.set(day, (byDay.get(day) ?? 0) + score);
      }
      let worstDay: { date: string; net: number } | null = null;
      for (const [date, v] of byDay) {
        if (!worstDay || v < worstDay.net) worstDay = { date, net: v };
      }
      const evaluable = wins + losses;
      return {
        opportunities,
        would_trade: wouldTrade,
        resolved,
        evaluable,
        wins,
        losses,
        pushes,
        net,
        win_rate: evaluable > 0 ? (wins / evaluable) * 100 : 0,
        coverage: opportunities > 0 ? (wouldTrade / opportunities) * 100 : 0,
        max_drawdown: maxDrawdown,
        max_loss_streak: maxLossStreak,
        worst_boise_day: worstDay,
      };
    };

    const byPolicy = BINANCE_OB_POLICIES.map((name) => ({
      policy_name: name,
      ...summarize(shadows.filter((r) => r.policy_name === name)),
    }));
    const follow = summarize(shadows.filter((r) => String(r.policy_name).includes("FOLLOW")));
    const fade = summarize(shadows.filter((r) => String(r.policy_name).includes("FADE")));
    const spotOnly = summarize(
      shadows.filter((r) => !String(r.policy_name).startsWith("SPOT_PERP")),
    );
    const spotPerp = summarize(
      shadows.filter((r) => String(r.policy_name).startsWith("SPOT_PERP")),
    );

    return {
      version: BINANCE_OB_VERSION,
      policy_version: BINANCE_OB_POLICY_VERSION,
      mode: activation.mode,
      selected_policy: activation.selected_policy,
      data_present: features.length > 0,
      connection,
      capture: perMarket,
      policies: byPolicy,
      follow_vs_fade: { follow, fade },
      spot_vs_spot_perp: { spot: spotOnly, spot_perp: spotPerp },
      generated_at: new Date().toISOString(),
    };
  }),
);
