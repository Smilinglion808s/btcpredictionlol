// B4x4 server functions: dashboard stats, pending row, grid heatmap, CSV export.

import { createServerFn } from "@tanstack/react-start";
import { B4X4_ACTIVE_REVISIONS, B4X4_IMPLEMENTATION_REVISION, B4X4_MODEL_VERSION, B4X4_MODEL_VERSIONS, B4X4_VARIANT, B4X4_VARIANTS, b4x4LocalDate } from "./b4x4/config";
import { SHADOW_A_VARIANT, SHADOW_B_VARIANT } from "./b4x4/shadows";


async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const PAGE = 1000;

type Row = Record<string, unknown>;

async function pageAll(select: string): Promise<Row[]> {
  const sb = await admin();
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await sb
      .from("b4x4_predictions")
      .select(select)
      .in("model_version", B4X4_MODEL_VERSIONS)
      .in("variant", B4X4_VARIANTS)
      .order("target_candle_ts", { ascending: true })
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as Row[]));
    if (data.length < PAGE) break;
  }
  return out;
}

const OPERATIONAL = new Set([
  "ABSTAIN_A2_PROBABILITY_INVALID", "ABSTAIN_A2_TIMING_INVALID", "ABSTAIN_A2_LEAKAGE_INVALID",
  "ABSTAIN_SOURCE_HISTORY_INVALID", "ABSTAIN_WARMUP_SOURCE_HISTORY", "ABSTAIN_WARMUP_GRID_HISTORY",
  "ABSTAIN_GRID_REFERENCE_INVALID", "ABSTAIN_INTERNAL_ERROR",
]);

function emptyCounters() {
  return {
    model_version: B4X4_MODEL_VERSION,
    variant: B4X4_VARIANT,
    total_opportunities: 0,
    evaluable: 0,
    trades: 0, wins: 0, losses: 0, pushes: 0, pending: 0,
    net: 0, coverage: 0, win_rate: 0, max_drawdown: 0,
    green_wins: 0, green_losses: 0, red_wins: 0, red_losses: 0,
    core_only_net: 0, core_only_trades: 0,
    expansion_only_net: 0, expansion_only_trades: 0,
    core_and_expansion_trades: 0,
    base_no_brake_net: 0, base_no_brake_trades: 0,
    brake_avoided_losses: 0, brake_sacrificed_wins: 0, brake_incremental_net: 0,
    operational_abstains: 0, strategic_abstains: 0,
    block96_trades: 0, block96_wins: 0, block96_losses: 0, block96_net: 0,
    today_local_date: "", today_net: 0, today_trades: 0, brake_active_now: false,
    losing_days: 0, worst_day: 0,
    segment: "" as string,
    implementation_revision: null as string | null,
    last7: [] as Array<{ date: string; net: number; wins: number; losses: number; trades: number }>,
    last3: [] as Array<{ date: string; net: number; wins: number; losses: number; trades: number; win_rate: number }>,
    grid: [] as Array<{ cell: string; resolvedCount: number; wins: number; losses: number; pCorrect: number }>,
  };
}

function aggregate(rows: Row[]) {
  const c = emptyCounters();
  const daily = new Map<string, { net: number; wins: number; losses: number; trades: number }>();
  let running = 0, peak = 0;

  for (const r of rows) {
    c.total_opportunities++;
    const reason = String(r.decision_reason ?? "");
    const traded = r.would_trade === true;
    if (!OPERATIONAL.has(reason)) c.evaluable++;
    if (!traded) {
      if (OPERATIONAL.has(reason)) c.operational_abstains++;
      else c.strategic_abstains++;
    }
    if (r.core_eligible === true) {
      c.core_only_trades++;
      c.core_only_net += Number(r.core_only_counterfactual_score ?? 0);
    }
    if (r.expansion_eligible === true) {
      c.expansion_only_trades++;
      c.expansion_only_net += Number(r.expansion_only_counterfactual_score ?? 0);
    }
    if (r.selected_route === "CORE_AND_EXPANSION") c.core_and_expansion_trades++;
    if (r.base_candidate === true) {
      c.base_no_brake_trades++;
      c.base_no_brake_net += Number(r.base_no_brake_counterfactual_score ?? 0);
    }
    if (r.brake_attribution_class === "AVOIDED_LOSS") c.brake_avoided_losses++;
    if (r.brake_attribution_class === "SACRIFICED_WIN") c.brake_sacrificed_wins++;
    c.brake_incremental_net += Number(r.brake_incremental_value ?? 0);

    if (!traded) continue;
    c.trades++;
    if (!r.resolved_at) { c.pending++; continue; }
    const score = Number(r.result_score ?? 0);
    const res = String(r.result ?? "");
    if (res === "WIN") c.wins++;
    else if (res === "LOSS") c.losses++;
    else c.pushes++;
    c.net += score;
    running += score;
    peak = Math.max(peak, running);
    c.max_drawdown = Math.max(c.max_drawdown, peak - running);
    if (r.final_prediction === "GREEN") { if (res === "WIN") c.green_wins++; else if (res === "LOSS") c.green_losses++; }
    if (r.final_prediction === "RED") { if (res === "WIN") c.red_wins++; else if (res === "LOSS") c.red_losses++; }

    const d = String(r.local_date ?? b4x4LocalDate(String(r.target_candle_ts)));
    const cur = daily.get(d) ?? { net: 0, wins: 0, losses: 0, trades: 0 };
    cur.net += score;
    cur.trades++;
    if (res === "WIN") cur.wins++;
    else if (res === "LOSS") cur.losses++;
    daily.set(d, cur);
  }

  c.coverage = c.evaluable ? (c.trades / c.evaluable) * 100 : 0;
  c.win_rate = c.wins + c.losses ? (c.wins / (c.wins + c.losses)) * 100 : 0;

  // Trailing 96-candle block (last 96 opportunities).
  for (const r of rows.slice(-96)) {
    if (r.would_trade !== true || !r.resolved_at) continue;
    c.block96_trades++;
    const res = String(r.result ?? "");
    if (res === "WIN") c.block96_wins++;
    else if (res === "LOSS") c.block96_losses++;
    c.block96_net += Number(r.result_score ?? 0);
  }

  const dates = [...daily.keys()].sort();
  c.last7 = dates.slice(-7).map((d) => ({ date: d, ...daily.get(d)! }));
  for (const d of dates) {
    const v = daily.get(d)!;
    if (v.net < 0) c.losing_days++;
    c.worst_day = Math.min(c.worst_day, v.net);
  }

  // Last 3 calendar days in the reporting timezone, including days with no trades.
  c.last3 = Array.from({ length: 3 }, (_, back) => {
    const key = b4x4LocalDate(new Date(Date.now() - back * 86400000).toISOString());
    const v = daily.get(key) ?? { net: 0, wins: 0, losses: 0, trades: 0 };
    const decided = v.wins + v.losses;
    return {
      date: key,
      net: v.net,
      wins: v.wins,
      losses: v.losses,
      trades: v.trades,
      win_rate: decided ? Math.round((v.wins / decided) * 10000) / 100 : 0,
    };
  });

  const today = b4x4LocalDate(new Date().toISOString());
  c.today_local_date = today;
  const todayStats = daily.get(today);
  c.today_net = todayStats?.net ?? 0;
  c.today_trades = todayStats?.trades ?? 0;
  c.brake_active_now = c.today_net <= -2;

  // Grid heatmap from the most recent prediction-time snapshot.
  for (let i = rows.length - 1; i >= 0; i--) {
    const snap = rows[i].grid_snapshot_json as
      | Array<{ globalQuartile: number; sameSideQuartile: number; resolvedCount: number; wins: number; losses: number; pCorrect: number }>
      | null;
    if (Array.isArray(snap) && snap.length === 16) {
      c.grid = snap.map((s) => ({
        cell: `G${s.globalQuartile + 1}-S${s.sameSideQuartile + 1}`,
        resolvedCount: s.resolvedCount,
        wins: s.wins,
        losses: s.losses,
        pCorrect: s.pCorrect,
      }));
      break;
    }
  }
  return c;
}

/**
 * Aggregate B4x4 performance for the dashboard panel.
 *
 * The headline is filtered to the current implementation revision only; every
 * pre-repair row is reported separately as a labeled historical segment and
 * never blended into the active forward test.
 */
export const getB4x4Stats = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await pageAll(
    "target_candle_ts, run_mode, would_trade, final_prediction, raw_direction, decision_reason, " +
    "selected_route, core_eligible, expansion_eligible, base_candidate, result, result_score, " +
    "resolved_at, local_date, intraday_brake_active, intraday_brake_veto_fired, " +
    "base_no_brake_counterfactual_score, core_only_counterfactual_score, " +
    "expansion_only_counterfactual_score, brake_attribution_class, brake_incremental_value, " +
    "grid_snapshot_json, grid_cell, p_correct, grid_quality_percentile, global_rank, same_side_rank, " +
    "implementation_revision, build_identifier, deploy_environment, " +
    "operational_gap_status, operational_gap_reason, revision_prospective_test_id, " +
    "revision_activated_at, webhook_eligible",
  );

  const ACTIVE_REVISIONS = new Set(B4X4_ACTIVE_REVISIONS);
  const isRepaired = (r: Row) => ACTIVE_REVISIONS.has(String(r.implementation_revision ?? ""));
  // Operational catch-up rows are audit artifacts: they are webhook-ineligible
  // and are excluded from LIVE performance AND coverage. BACKFILL rows are
  // likewise never part of the live forward test.
  const isLive = (r: Row) =>
    r.run_mode === "LIVE" && String(r.operational_gap_status ?? "NONE") !== "CATCHUP";
  const repaired = rows.filter((r) => isRepaired(r) && isLive(r));
  const legacy = rows.filter((r) => !isRepaired(r) && isLive(r));
  const catchup = rows.filter((r) => String(r.operational_gap_status ?? "NONE") === "CATCHUP");

  const c = aggregate(repaired);
  c.segment = "ACTIVE_REVISION";
  c.implementation_revision = B4X4_IMPLEMENTATION_REVISION;
  const historical = aggregate(legacy);
  historical.segment = "PRE_REPAIR_HISTORICAL";

  const lastBuild = [...repaired].reverse().find((r) => r.build_identifier != null);

  return {
    ...c,
    build_identifier: (lastBuild?.build_identifier as string | null) ?? null,
    deploy_environment: (lastBuild?.deploy_environment as string | null) ?? null,
    revision_prospective_test_id:
      (repaired[repaired.length - 1]?.revision_prospective_test_id as string | null) ?? null,
    revision_activated_at:
      (repaired[repaired.length - 1]?.revision_activated_at as string | null) ?? null,
    // Operational catch-up audit rows: reported, never scored, never webhooked.
    catchup: {
      rows: catchup.length,
      webhook_eligible: catchup.filter((r) => r.webhook_eligible === true).length,
      targets: catchup.map((r) => String(r.target_candle_ts)),
    },
    // Pre-repair rows are preserved and reported, but kept out of the headline.
    historical: {
      segment: historical.segment,
      total_opportunities: historical.total_opportunities,
      trades: historical.trades,
      wins: historical.wins,
      losses: historical.losses,
      pushes: historical.pushes,
      net: historical.net,
      win_rate: historical.win_rate,
      coverage: historical.coverage,
    },
  };
});


/** Most recent B4x4 row (its decision for the pending candle). */
export const getB4x4Pending = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data } = await sb
    .from("b4x4_predictions")
    .select(
      "target_candle_ts, run_mode, raw_direction, final_prediction, would_trade, decision_reason, " +
      "selected_route, global_rank, same_side_rank, grid_cell, p_correct, grid_quality_percentile, " +
      "a2_probability_green, confidence, daily_net_before, intraday_brake_active, resolved_at, result",
    )
    .in("model_version", B4X4_MODEL_VERSIONS)
    .order("target_candle_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as unknown as Record<string, string | number | boolean | null> | null) ?? null;
});

/** Audit-only shadow market-data coverage. Never affects B4x4 decisions. */
export const getB4x4ShadowCoverage = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data } = await sb
    .from("b4x4_shadow_market_data")
    .select("coverage_status, error_reason, flow_agrees_a2, flow_conflicts_a2, flow_strong_coherent")
    .order("target_candle_ts", { ascending: false })
    .limit(1000);
  const rows = (data ?? []) as unknown as Row[];
  return {
    rows: rows.length,
    ok: rows.filter((r) => r.coverage_status === "OK" || r.coverage_status === "CAPTURED_VALID").length,
    stale: rows.filter((r) => r.coverage_status === "CAPTURED_STALE").length,
    errored: rows.filter((r) => r.error_reason != null).length,
    flow_agreements: rows.filter((r) => r.flow_agrees_a2 === true).length,
    flow_conflicts: rows.filter((r) => r.flow_conflicts_a2 === true).length,
    strong_coherent: rows.filter((r) => r.flow_strong_coherent === true).length,
  };
});

/**
 * Order-book shadow audit panel data (b4x4-ob-shadow-v1).
 * SHADOW ONLY — never used in B4x4 decisions.
 */
export const getB4x4ObShadowAudit = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data: preds } = await sb
    .from("b4x4_predictions")
    .select("id")
    .in("model_version", B4X4_MODEL_VERSIONS)
    .eq("run_mode", "LIVE")
    .limit(10000);
  const expected = (preds ?? []).length;

  const shadow: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await sb
      .from("b4x4_shadow_market_data")
      .select(
        "b4x4_prediction_id, capture_status, snapshot_age_ms, raw_direction_relationship, " +
        "flow_strong_coherent, b4x4_result_score, b4x4_result, b4x4_published",
      )
      .order("target_candle_ts", { ascending: true })
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    shadow.push(...(data as unknown as Row[]));
    if (data.length < PAGE) break;
  }

  const count = (s: string) => shadow.filter((r) => r.capture_status === s).length;
  const ages = shadow
    .map((r) => (r.snapshot_age_ms == null ? null : Number(r.snapshot_age_ms)))
    .filter((n): n is number => n != null && Number.isFinite(n))
    .sort((a, b) => a - b);

  const bucket = (pred: (r: Row) => boolean) => {
    const rows = shadow.filter((r) => pred(r) && r.b4x4_published === true && r.b4x4_result != null);
    const wins = rows.filter((r) => r.b4x4_result === "WIN").length;
    const losses = rows.filter((r) => r.b4x4_result === "LOSS").length;
    const net = rows.reduce((a, r) => a + Number(r.b4x4_result_score ?? 0), 0);
    return {
      observations: rows.length,
      wins,
      losses,
      net,
      win_rate: wins + losses ? (wins / (wins + losses)) * 100 : 0,
    };
  };

  return {
    shadow_version: "b4x4-ob-shadow-v1",
    shadow_only: true,
    expected_live_rows: expected,
    shadow_rows: shadow.length,
    missing_rows: Math.max(0, expected - shadow.length),
    captured_valid: count("CAPTURED_VALID"),
    captured_stale: count("CAPTURED_STALE"),
    captured_incomplete: count("CAPTURED_INCOMPLETE"),
    captured_sequence_gap: count("CAPTURED_SEQUENCE_GAP"),
    no_preboundary_snapshot: count("NO_PREBOUNDARY_SNAPSHOT"),
    collector_errors: count("COLLECTOR_ERROR"),
    historical_placeholders: count("HISTORICAL_NOT_CAPTURED"),
    median_age_ms: ages.length ? ages[Math.floor(ages.length / 2)] : null,
    max_age_ms: ages.length ? ages[ages.length - 1] : null,
    agree: bucket((r) => r.raw_direction_relationship === "AGREE"),
    conflict: bucket((r) => r.raw_direction_relationship === "CONFLICT"),
    neutral_count: shadow.filter((r) => r.raw_direction_relationship === "NEUTRAL").length,
    unavailable_count: shadow.filter((r) => r.raw_direction_relationship === "UNAVAILABLE").length,
    strong_coherent: bucket((r) => r.flow_strong_coherent === true),
  };
});

/** Insert placeholder shadow rows for prior LIVE predictions with no capture. */
export const backfillB4x4ShadowPlaceholders = createServerFn({ method: "POST" }).handler(async () => {
  const sb = await admin();
  const { backfillHistoricalPlaceholders } = await import("./b4x4/shadow/persist.server");
  return backfillHistoricalPlaceholders(sb);
});

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

async function loadShadowRows(): Promise<Row[]> {
  const sb = await admin();
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await sb
      .from("b4x4_shadow_market_data")
      .select("*")
      .order("target_candle_ts", { ascending: true })
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as Row[]));
    if (data.length < PAGE) break;
  }
  return out;
}

/** Dedicated order-book shadow export: every capture, quality, label and resolution field. */
export const exportB4x4ObShadowCsv = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await loadShadowRows();
  if (rows.length === 0) return { csv: "", rows: 0 };
  const columns = Object.keys(rows[0]);
  const header = columns.join(",");
  const body = rows.map((r) => columns.map((c) => csvEscape(r[c])).join(",")).join("\n");
  return { csv: `${header}\n${body}\n`, rows: rows.length };
});

/** All reporting-only policy shadow rows (Shadow A and Shadow B). */
export async function loadPolicyShadowRows(): Promise<Row[]> {
  const sb = await admin();
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await sb
      .from("b4x4_policy_shadows")
      .select("*")
      .order("target_candle_ts", { ascending: true })
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as Row[]));
    if (data.length < PAGE) break;
  }
  return out;
}

/**
 * Dedicated B4x4 CSV export — every tracked column, plus the order-book shadow
 * join and both reporting-only policy shadows (Shadow A / Shadow B).
 */
export const exportB4x4Csv = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await pageAll("*");
  if (rows.length === 0) return { csv: "", rows: 0 };
  const columns = Object.keys(rows[0]);

  // Audit-only shadow data, LEFT-joined on b4x4_prediction_id.
  const shadowRows = await loadShadowRows();
  const shadowById = new Map<string, Row>();
  for (const s of shadowRows) {
    if (s.b4x4_prediction_id) shadowById.set(String(s.b4x4_prediction_id), s);
  }
  // Union of keys across all shadow rows so no tracked field is dropped.
  const shadowKeys = new Set<string>();
  for (const s of shadowRows) for (const k of Object.keys(s)) shadowKeys.add(k);
  const SHADOW_COLUMNS = [...shadowKeys];

  // Reporting-only policy shadows, LEFT-joined per prediction and variant.
  const policyRows = await loadPolicyShadowRows();
  const policyKeys = new Set<string>();
  for (const s of policyRows) for (const k of Object.keys(s)) policyKeys.add(k);
  const POLICY_COLUMNS = [...policyKeys];
  const policyByPred = new Map<string, Row>();
  for (const s of policyRows) {
    policyByPred.set(`${String(s.b4x4_prediction_id)}|${String(s.shadow_variant)}`, s);
  }

  const header = [
    ...columns.map((c) => `b4x4_${c}`),
    ...SHADOW_COLUMNS.map((c) => `b4x4_ob_${c}`),
    ...POLICY_COLUMNS.map((c) => `b4x4_shadow_a_${c}`),
    ...POLICY_COLUMNS.map((c) => `b4x4_shadow_b_${c}`),
  ].join(",");
  const body = rows
    .map((r) => {
      const s = shadowById.get(String(r.id)) ?? {};
      const a = policyByPred.get(`${String(r.id)}|${SHADOW_A_VARIANT}`) ?? {};
      const b = policyByPred.get(`${String(r.id)}|${SHADOW_B_VARIANT}`) ?? {};
      return [
        ...columns.map((col) => csvEscape(r[col])),
        ...SHADOW_COLUMNS.map((col) => csvEscape(s[col])),
        ...POLICY_COLUMNS.map((col) => csvEscape((a as Row)[col])),
        ...POLICY_COLUMNS.map((col) => csvEscape((b as Row)[col])),
      ].join(",");
    })
    .join("\n");
  return { csv: `${header}\n${body}\n`, rows: rows.length };
});




/** Recent B4x4 rows for the Stats page history table. */
export const listB4x4Recent = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data } = await sb
    .from("b4x4_predictions")
    .select(
      "id, target_candle_ts, final_prediction, raw_direction, would_trade, decision_reason, " +
      "selected_route, grid_cell, p_correct, a2_probability_green, confidence, result, resolved_at, actual_close",
    )
    .in("model_version", B4X4_MODEL_VERSIONS)
    .in("variant", B4X4_VARIANTS)
    .order("target_candle_ts", { ascending: false })
    .limit(50);
  return ((data ?? []) as unknown as Row[]).map((r) => ({
    id: String(r.id),
    candle_ts: String(r.target_candle_ts),
    prediction: r.would_trade === true ? String(r.final_prediction ?? "—") : "NO TRADE",
    raw_direction: (r.raw_direction as string | null) ?? null,
    grid_cell: (r.grid_cell as string | null) ?? null,
    p_correct: r.p_correct != null ? Number(r.p_correct) : null,
    route: (r.selected_route as string | null) ?? (r.decision_reason as string | null) ?? null,
    confidence: r.confidence != null ? Number(r.confidence) : null,
    actual_close: r.actual_close != null ? Number(r.actual_close) : null,
    status: r.resolved_at ? String(r.result ?? "—") : r.would_trade === true ? "PENDING" : "SKIPPED",
  }));
});
