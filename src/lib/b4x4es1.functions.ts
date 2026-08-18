// B4x4-ES1 server functions: dashboard stats, pending row, CSV export.

import { createServerFn } from "@tanstack/react-start";
import { cachedStats, PENDING_TTL_MS } from "./statsCache.server";
import { ES1_MODEL_VERSION, ES1_ROW_MODEL_VERSIONS, ES1_VARIANT, es1LocalDate } from "./b4x4es1/config";

type Row = Record<string, unknown>;
const PAGE = 1000;

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

async function pageAll(select: string): Promise<Row[]> {
  const sb = await admin();
  const out: Row[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await sb
      .from("b4x4_es1_predictions")
      .select(select)
      .in("model_version", ES1_ROW_MODEL_VERSIONS)
      .order("target_candle_ts", { ascending: true })
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as Row[]));
    if (data.length < PAGE) break;
  }
  return out;
}

function aggregate(rows: Row[]) {
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

/** Live forward-test performance for the active ES1 model. */
export const getEs1Stats = createServerFn({ method: "GET" }).handler(async () =>
  cachedStats("b4x4-es1-stats", async () => {
    const rows = await pageAll(
      "target_candle_ts, run_mode, local_date, would_trade, final_prediction, hybrid_route, " +
        "decision_reason, result, result_score, resolved_at, b4_guard_attribution_class, " +
        "b4_guard_incremental_value, webhook_eligible, webhook_sent_at, operational_gap_status, " +
        "balanced_would_trade, balanced_final_prediction, balanced_decision_reason, " +
        "balanced_result, balanced_result_score, balanced_resolved_at, balanced_active, " +
        "balanced_agreement_tier, balanced_incremental_value, " +
        "dual_adaptive_would_trade, dual_adaptive_candidate_direction, " +
        "dual_adaptive_decision_reason, dual_adaptive_result, dual_adaptive_result_score, " +
        "dual_adaptive_resolved_at, dual_adaptive_influenced_decision, " +
        "dual_adaptive_spot_mode, dual_adaptive_perp_mode",
    );
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

    // ACTIVE MODEL: Binance Dual-Venue Adaptive R1, scored on its own terms
    // and only over boundaries at/after its activation.
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
    return {
      ...active,
      balanced,
      dual_adaptive: {
        ...dual,
        activated: dualRows.length > 0,
        fade_trades: fadeTrades,
        follow_trades: followTrades,
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
  }),
);


/** Most recent ES1 row — its decision for the pending candle. */
export const getEs1Pending = createServerFn({ method: "GET" }).handler(async () =>
  cachedStats("b4x4-es1-pending", async () => {
    const sb = await admin();
    const { data } = await sb
      .from("b4x4_es1_predictions")
      .select(
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
          "dual_adaptive_result, dual_adaptive_webhook_sent_at",
      )
      .in("model_version", ES1_ROW_MODEL_VERSIONS)
      .order("target_candle_ts", { ascending: false })
      .limit(1)
      .maybeSingle();
    return (data as unknown as Record<string, string | number | boolean | null> | null) ?? null;
    // Near-live TTL: the pending decision must surface within seconds of the
    // boundary run, not on the 150s stats cadence.
  }, Math.min(PENDING_TTL_MS, 5_000)),
);

function csvEscape(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Full ES1 CSV export — every tracked column plus explicit outcome flags. */
export const exportEs1Csv = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await pageAll("*");
  if (rows.length === 0) return { csv: "", rows: 0 };
  const { ES1_COMPACT_BINANCE_COLUMNS } = await import("./b4x4es1/binanceOb/exports");
  // Compact binance_ob_* block always present, always last, in a frozen order.
  const base = [
    ...Object.keys(rows[0]).filter(
      (c) => !(ES1_COMPACT_BINANCE_COLUMNS as readonly string[]).includes(c),
    ),
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
});
