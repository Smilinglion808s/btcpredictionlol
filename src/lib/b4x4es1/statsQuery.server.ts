// Runtime helpers for the ES1 dashboard server functions.
//
// These live outside b4x4es1.functions.ts on purpose: the server-function
// splitter keeps only imports and exported createServerFn declarations in a
// *.functions.ts module, so any module-scope helper there is dropped from the
// split bundle and throws ReferenceError at request time.

import { incrementalRows } from "../statsCache.server";
import { ES1_MODEL_VERSION, ES1_ROW_MODEL_VERSIONS, ES1_VARIANT, es1LocalDate } from "./config";

export type Row = Record<string, unknown>;
const PAGE = 1000;

export async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export async function pageAll(select: string, cacheKey?: string): Promise<Row[]> {
  const fetchRows = async (cursor: string | null) => {
    const sb = await admin();
    const out: Row[] = [];
    // Keyset pagination: offset ranges get progressively slower on the wide
    // `select *` export and a single failed page used to silently truncate the
    // dataset at the oldest 1000 rows.
    const key = (r: Row) => String(r.id ?? `${r.target_candle_ts}|${r.model_version}`);
    const seen = new Set<string>();
    let after = cursor;
    let strictlyAfter = cursor != null;
    for (;;) {
      let q = sb
        .from("b4x4_es1_predictions")
        .select(select)
        .in("model_version", ES1_ROW_MODEL_VERSIONS)
        .order("target_candle_ts", { ascending: true })
        .limit(PAGE);
      if (after) q = strictlyAfter ? q.gt("target_candle_ts", after) : q.gte("target_candle_ts", after);
      const { data, error } = await q;
      if (error) throw new Error(`ES1 export page failed after ${out.length} rows: ${error.message}`);
      if (!data || data.length === 0) break;
      const rows = data as unknown as Row[];
      let added = 0;
      for (const r of rows) {
        const k = key(r);
        if (seen.has(k)) continue;
        seen.add(k);
        out.push(r);
        added++;
      }
      const last = rows[rows.length - 1]?.target_candle_ts;
      if (rows.length < PAGE || !last) break;
      const nextCursor = new Date(String(last)).toISOString();
      // Re-fetch the boundary timestamp (ties across model_version) but never
      // stall: if a full page shared one timestamp, step past it.
      strictlyAfter = nextCursor === after || added === 0;
      after = nextCursor;
    }
    return out;
  };

  // Read-path only: immutable historical rows are reused from memory so the
  // stats card no longer rescans the full table on every cache miss.
  if (!cacheKey) return fetchRows(null);
  return incrementalRows<Row>(`es1:${cacheKey}`, fetchRows, {
    tsKey: "target_candle_ts",
    keyFn: (r: Row) => String(r.id ?? `${r.target_candle_ts}|${r.model_version}`),
  });
}

export function aggregate(rows: Row[]) {
  const daily = new Map<string, { net: number; wins: number; losses: number; trades: number }>();
  const c = {
    model_version: ES1_MODEL_VERSION,
    variant: ES1_VARIANT,
    total_opportunities: rows.length,
    /** rows that actually published a direction */
    published: 0,
    /** published rows with any resolved outcome (wins + losses + pushes) */
    resolved: 0,
    /** published rows with a directional (evaluable) outcome (wins + losses) */
    evaluable: 0,
    trades: 0,
    wins: 0,
    losses: 0,
    pushes: 0,
    pending: 0,
    net: 0,
    win_rate: 0,
    coverage: 0,
    max_drawdown: 0,
    green_wins: 0,
    green_losses: 0,
    red_wins: 0,
    red_losses: 0,
    price_route_trades: 0,
    ob_route_trades: 0,
    guard_avoided_losses: 0,
    guard_sacrificed_wins: 0,
    guard_incremental_net: 0,
    abstain_disagree: 0,
    abstain_confidence: 0,
    abstain_guard: 0,
    abstain_not_ready: 0,
    today_local_date: es1LocalDate(new Date().toISOString()),
    today_net: 0,
    today_trades: 0,
    last7: [] as Array<{ date: string; net: number; wins: number; losses: number; trades: number }>,
  };
  let running = 0;
  let peak = 0;

  for (const r of rows) {
    const reason = String(r.decision_reason ?? "");
    if (reason === "ABSTAIN_ES1_A2_DISAGREE") c.abstain_disagree++;
    else if (reason === "ABSTAIN_COMBINED_CONFIDENCE_BELOW_020") c.abstain_confidence++;
    else if (reason === "ABSTAIN_ES1_B4_PCORRECT_BELOW_045") c.abstain_guard++;
    else if (reason.startsWith("ABSTAIN")) c.abstain_not_ready++;

    if (r.b4_guard_attribution_class === "AVOIDED_LOSS") c.guard_avoided_losses++;
    if (r.b4_guard_attribution_class === "SACRIFICED_WIN") c.guard_sacrificed_wins++;
    c.guard_incremental_net += Number(r.b4_guard_incremental_value ?? 0);

    if (r.would_trade !== true) continue;
    c.trades++;
    c.published++;
    if (r.hybrid_route === "OB_DEPTH10_FADE") c.ob_route_trades++;
    else c.price_route_trades++;
    if (!r.resolved_at) {
      c.pending++;
      continue;
    }
    const res = String(r.result ?? "");
    const score = Number(r.result_score ?? 0);
    c.resolved++;
    if (res === "WIN") {
      c.wins++;
      c.evaluable++;
    } else if (res === "LOSS") {
      c.losses++;
      c.evaluable++;
    } else c.pushes++;
    c.net += score;
    running += score;
    peak = Math.max(peak, running);
    c.max_drawdown = Math.max(c.max_drawdown, peak - running);
    if (r.final_prediction === "GREEN") {
      if (res === "WIN") c.green_wins++;
      else if (res === "LOSS") c.green_losses++;
    } else if (r.final_prediction === "RED") {
      if (res === "WIN") c.red_wins++;
      else if (res === "LOSS") c.red_losses++;
    }
    const day = String(r.local_date ?? es1LocalDate(String(r.target_candle_ts)));
    const cur = daily.get(day) ?? { net: 0, wins: 0, losses: 0, trades: 0 };
    cur.net += score;
    cur.trades++;
    if (res === "WIN") cur.wins++;
    else if (res === "LOSS") cur.losses++;
    daily.set(day, cur);
  }

  c.win_rate = c.wins + c.losses ? (c.wins / (c.wins + c.losses)) * 100 : 0;
  c.coverage = c.total_opportunities ? (c.trades / c.total_opportunities) * 100 : 0;
  const today = daily.get(c.today_local_date);
  c.today_net = today?.net ?? 0;
  c.today_trades = today?.trades ?? 0;
  c.last7 = [...daily.keys()]
    .sort()
    .slice(-7)
    .map((d) => ({ date: d, ...daily.get(d)! }));
  return c;
}

export const ES1_STATS_SELECT =
  "id, model_version, target_candle_ts, run_mode, local_date, would_trade, final_prediction, hybrid_route, " +
  "decision_reason, result, result_score, resolved_at, b4_guard_attribution_class, " +
  "b4_guard_incremental_value, webhook_eligible, webhook_sent_at, operational_gap_status, " +
  "balanced_would_trade, balanced_final_prediction, balanced_decision_reason, " +
  "balanced_result, balanced_result_score, balanced_resolved_at, balanced_active, " +
  "balanced_agreement_tier, balanced_incremental_value, " +
  "dual_adaptive_would_trade, dual_adaptive_candidate_direction, " +
  "dual_adaptive_decision_reason, dual_adaptive_result, dual_adaptive_result_score, " +
  "dual_adaptive_resolved_at, dual_adaptive_influenced_decision, " +
  "dual_adaptive_spot_mode, dual_adaptive_perp_mode, " +
  "precision_activated, precision_would_trade, precision_candidate_direction, " +
  "precision_decision_reason, precision_result, precision_result_score, " +
  "precision_resolved_at, precision_sleeve, precision_balanced_route, " +
  "precision_balanced_would_trade, precision_balanced_direction, " +
  "precision_balanced_result, precision_balanced_result_score";

export const ES1_PENDING_SELECT =
  "target_candle_ts, run_mode, final_prediction, would_trade, decision_reason, hybrid_route, " +
  "hybrid_direction, hybrid_evidence, price_direction, price_probability_green, " +
  "a2_direction, a2_agrees, combined_confidence_rank, b4_cell, b4_p_correct, b4_ready, " +
  "b4_guard_veto_fired, ob_route_qualified, ob_depth_imbalance_10bps, result, " +
  "result_score, resolved_at, webhook_sent_at, " +
  "balanced_final_prediction, balanced_would_trade, balanced_decision_reason, " +
  "balanced_vote_pattern, balanced_agreement_tier, balanced_green_vote_count, " +
  "balanced_red_vote_count, balanced_es1_vote, balanced_spot_depth_vote, " +
  "balanced_spot_ofi60_vote, balanced_perp_fade_vote, balanced_spot_ready, " +
  "balanced_perp_ready, balanced_spot_gate_reason, balanced_perp_gate_reason, " +
  "balanced_active, balanced_result, balanced_webhook_sent_at, " +
  "dual_adaptive_candidate_direction, dual_adaptive_would_trade, " +
  "dual_adaptive_decision_reason, dual_adaptive_detailed_reason, " +
  "dual_adaptive_venue_agreement, dual_adaptive_spot_mode, dual_adaptive_spot_direction, " +
  "dual_adaptive_perp_mode, dual_adaptive_perp_direction, dual_adaptive_spot_ready, " +
  "dual_adaptive_perp_ready, dual_adaptive_spot_ready_reason, " +
  "dual_adaptive_perp_ready_reason, dual_adaptive_influenced_decision, " +
  "dual_adaptive_result, dual_adaptive_webhook_sent_at, " +
  "precision_activated, precision_would_trade, precision_candidate_direction, " +
  "precision_decision_reason, precision_sleeve, precision_balanced_route, " +
  "precision_balanced_would_trade, precision_balanced_direction, " +
  "precision_spot_mode, precision_spot_direction, precision_perp_mode, " +
  "precision_perp_direction, precision_venue_agreement, precision_activity_guard_passed, " +
  "precision_spot_ready, precision_perp_ready, precision_technical_direction, " +
  "precision_technical_confidence, precision_prior_trend_age_candles, " +
  "precision_upper_wick_percentile_96, precision_result, precision_webhook_sent_at";

/** Full ES1 stats payload (active, balanced counterfactual, dual-adaptive, warmup). */
export async function buildEs1Stats() {
  const rows = await pageAll(ES1_STATS_SELECT, "stats");

  const live = rows.filter(
    (r) => r.run_mode === "LIVE" && String(r.operational_gap_status ?? "NONE") !== "CATCHUP",
  );
  const warm = rows.filter((r) => r.run_mode === "BACKFILL");
  const active = aggregate(live);
  const warmup = aggregate(warm);
  // Retained counterfactual: the balanced 4-vote decision.
  const balancedRows: Row[] = live.map((r) => ({
    ...r,
    would_trade: r.balanced_would_trade,
    final_prediction: r.balanced_final_prediction,
    decision_reason: r.balanced_decision_reason,
    result: r.balanced_result,
    result_score: r.balanced_result_score,
    resolved_at: r.balanced_resolved_at,
  }));
  const balanced = aggregate(balancedRows);

  // Retained counterfactual: Binance Dual-Venue Adaptive R1, scored on its own
  // terms and only over boundaries at/after its activation.
  const dualRows: Row[] = live
    .filter((r) => r.dual_adaptive_influenced_decision === true)
    .map((r) => ({
      ...r,
      would_trade: r.dual_adaptive_would_trade,
      final_prediction: r.dual_adaptive_candidate_direction,
      decision_reason: r.dual_adaptive_decision_reason,
      result: r.dual_adaptive_result,
      result_score: r.dual_adaptive_result_score,
      resolved_at: r.dual_adaptive_resolved_at,
    }));
  const dual = aggregate(dualRows);
  const traded = dualRows.filter((r) => r.would_trade === true);
  const fadeTrades = traded.filter((r) => r.dual_adaptive_spot_mode === "FADE").length;
  const followTrades = traded.filter((r) => r.dual_adaptive_spot_mode === "FOLLOW").length;

  // ACTIVE MODEL: Balanced Precision Stack R1, scored on its own terms and
  // only over boundaries at/after its activation.
  const precisionRows: Row[] = live
    .filter((r) => r.precision_activated === true)
    .map((r) => ({
      ...r,
      would_trade: r.precision_would_trade,
      final_prediction: r.precision_candidate_direction,
      decision_reason: r.precision_decision_reason,
      result: r.precision_result,
      result_score: r.precision_result_score,
      resolved_at: r.precision_resolved_at,
    }));
  const precision = aggregate(precisionRows);
  const precisionTraded = precisionRows.filter((r) => r.would_trade === true);
  const precisionBalanced = aggregate(
    precisionRows.map((r) => ({
      ...r,
      would_trade: r.precision_balanced_would_trade,
      final_prediction: r.precision_balanced_direction,
      result: r.precision_balanced_result,
      result_score: r.precision_balanced_result_score,
    })),
  );
  return {
    ...active,
    balanced,
    dual_adaptive: {
      ...dual,
      activated: dualRows.length > 0,
      fade_trades: fadeTrades,
      follow_trades: followTrades,
    },
    precision: {
      ...precision,
      activated: precisionRows.length > 0,
      primary_trades: precisionTraded.filter((r) => r.precision_sleeve === "PRIMARY").length,
      rescue_trades: precisionTraded.filter((r) => r.precision_sleeve === "RESCUE").length,
      core_route_trades: precisionTraded.filter((r) => r.precision_balanced_route === "OB_CORE").length,
      fill_route_trades: precisionTraded.filter(
        (r) => r.precision_balanced_route === "TECHNICAL_FILL",
      ).length,
      balanced_base_net: precisionBalanced.net,
      balanced_base_trades: precisionBalanced.trades,
      balanced_base_win_rate: precisionBalanced.win_rate,
    },
    warmup: {
      total_opportunities: warmup.total_opportunities,
      trades: warmup.trades,
      published: warmup.published,
      resolved: warmup.resolved,
      evaluable: warmup.evaluable,
      pushes: warmup.pushes,
      wins: warmup.wins,
      losses: warmup.losses,
      net: warmup.net,
      win_rate: warmup.win_rate,
      coverage: warmup.coverage,
    },
  };
}

/** Most recent ES1 row — its decision for the pending candle. */
export async function loadEs1Pending() {
  const sb = await admin();
  const { data } = await sb
    .from("b4x4_es1_predictions")
    .select(ES1_PENDING_SELECT)
    .in("model_version", ES1_ROW_MODEL_VERSIONS)
    .order("target_candle_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as unknown as Record<string, string | number | boolean | null> | null) ?? null;
}

/**
 * Newest-first, deterministic offset pagination over the full ES1 table.
 * Returns rows chronologically (target_candle_ts ASC, id ASC).
 * Reporting-only: no writes, no model/resolver/webhook calls.
 */
export async function fetchEs1RowsChronological(
  opts: { select?: string; from?: string; to?: string; liveOnly?: boolean } = {},
): Promise<Row[]> {
  const select = opts.select ?? "*";
  const sb = await admin();
  const rows = await fetchAllDescThenChronological(async (offset, limit) => {
    let q = sb
      .from("b4x4_es1_predictions")
      .select(select)
      .in("model_version", ES1_ROW_MODEL_VERSIONS)
      .order("target_candle_ts", { ascending: false })
      .order("id", { ascending: false })
      .range(offset, offset + limit - 1);
    if (opts.from) q = q.gte("target_candle_ts", opts.from);
    if (opts.to) q = q.lte("target_candle_ts", opts.to);
    if (opts.liveOnly) q = q.eq("run_mode", "LIVE");
    const { data, error } = await q;
    if (error) throw new Error(`ES1 export page at offset ${offset} failed: ${error.message}`);
    return (data ?? []) as unknown as Row[];
  }, ES1_EXPORT_PAGE_SIZE);
  return sortChronological(rows);
}

/** Full ES1 CSV export — every current column plus explicit outcome flags. */
export async function buildEs1Csv() {
  const rows = await fetchEs1RowsChronological();
  if (rows.length === 0) return { csv: "", rows: 0 };
  const { ES1_COMPACT_BINANCE_COLUMNS } = await import("./binanceOb/exports");
  // Compact binance_ob_* block always present, always last, in a frozen order.
  const all = unionColumns(rows);
  const base = [
    ...all.filter((c) => !(ES1_COMPACT_BINANCE_COLUMNS as readonly string[]).includes(c)),
    ...ES1_COMPACT_BINANCE_COLUMNS,
  ];
  const derived = [
    "is_published",
    "is_resolved",
    "is_resolved_evaluable",
    "is_win",
    "is_loss",
    "is_push",
  ];
  const columns = [...base, ...derived];
  const flag = (r: Row, col: string): boolean => {
    const published = r.would_trade === true;
    const res = String(r.result ?? "");
    const resolved = published && r.resolved_at != null;
    switch (col) {
      case "is_published":
        return published;
      case "is_resolved":
        return resolved;
      case "is_resolved_evaluable":
        return resolved && (res === "WIN" || res === "LOSS");
      case "is_win":
        return resolved && res === "WIN";
      case "is_loss":
        return resolved && res === "LOSS";
      default:
        return resolved && res === "PUSH";
    }
  };
  const header = columns.join(",");
  const body = rows
    .map((r) =>
      columns
        .map((col) => (derived.includes(col) ? String(flag(r, col)) : csvEscape(r[col])))
        .join(","),
    )
    .join("\n");
  return { csv: `${header}\n${body}\n`, rows: rows.length };
}

/**
 * Latest-24-hours export: LIVE, non-CATCHUP rows from the newest LIVE target
 * back 24 hours. Reports staleness and per-precision non-null counts.
 */
export async function buildEs1Last24hCsv() {
  const sb = await admin();
  const { data: newest } = await sb
    .from("b4x4_es1_predictions")
    .select("target_candle_ts")
    .in("model_version", ES1_ROW_MODEL_VERSIONS)
    .eq("run_mode", "LIVE")
    .order("target_candle_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  const newestTs = (newest as { target_candle_ts?: string } | null)?.target_candle_ts;
  if (!newestTs) {
    return { csv: "", rows: 0, stale: true, newest_target: null, cutoff: null, precision_non_null_counts: {} };
  }
  const latest = new Date(newestTs).getTime();
  const cutoff = new Date(latest - 24 * 60 * 60 * 1000).toISOString();
  const all = await fetchEs1RowsChronological({
    from: cutoff,
    to: new Date(latest).toISOString(),
    liveOnly: true,
  });
  const rows = all.filter(isLiveNonCatchup);
  const columns = unionColumns(rows);
  const staleMs = Date.now() - latest;
  return {
    csv: toCsv(rows, columns),
    rows: rows.length,
    newest_target: new Date(latest).toISOString(),
    cutoff,
    stale: staleMs > 30 * 60 * 1000,
    stale_minutes: Math.round(staleMs / 60000),
    coverage: boundaryCoverage(rows),
    precision_non_null_counts: precisionNonNullCounts(rows),
    sleeve_counts: countBy(rows, "precision_sleeve"),
    direction_counts: countBy(rows, "precision_candidate_direction"),
    result_counts: countBy(rows, "precision_result"),
    webhook_eligible: rows.filter((r) => r.precision_webhook_eligible === true).length,
    webhook_sent: rows.filter((r) => r.precision_webhook_sent_at != null).length,
  };
}

