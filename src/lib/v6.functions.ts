// V6 server functions: stats card data, pending prediction, and CSV export.

import { createServerFn } from "@tanstack/react-start";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const PAGE = 1000;

async function pageAllV6(select: string): Promise<Array<Record<string, unknown>>> {
  const sb = await admin();
  const out: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await sb
      .from("v6_predictions")
      .select(select)
      .order("target_candle_ts", { ascending: true })
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as Array<Record<string, unknown>>));
    if (data.length < PAGE) break;
  }
  return out;
}

/** Aggregate V6 performance. Adjusted net is the primary headline metric. */
export const getV6Stats = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await pageAllV6(
    "target_candle_ts, operational_status, final_prediction, base_v6_prediction, prediction_source, canonical_actual_direction, resolution_timestamp, final_raw_score, final_adjusted_score, saturation_veto_triggered, saturation_veto_raw_contribution, saturation_veto_adjusted_contribution, red_pickup_triggered, red_pickup_raw_contribution, red_pickup_adjusted_contribution, green_pickup_triggered, green_pickup_raw_contribution, green_pickup_adjusted_contribution, weak_broad_red_veto_triggered, weak_broad_red_veto_raw_contribution, weak_broad_red_veto_adjusted_contribution",
  );

  const c = {
    total: 0, resolved: 0, pending: 0,
    wins: 0, losses: 0, pushes: 0,
    strategic_abstains: 0, op_fails: 0,
    green_wins: 0, green_losses: 0, red_wins: 0, red_losses: 0,
    raw_net: 0, adjusted_net: 0,
    saturation_veto_count: 0, saturation_veto_raw: 0, saturation_veto_adjusted: 0,
    red_pickup_count: 0, red_pickup_raw: 0, red_pickup_adjusted: 0,
    green_pickup_count: 0, green_pickup_raw: 0, green_pickup_adjusted: 0,
    weak_red_veto_count: 0, weak_red_veto_raw: 0, weak_red_veto_adjusted: 0,
    current_loss_streak: 0, max_loss_streak: 0,
    max_adjusted_drawdown: 0,
    rolling96_predictions: 0, rolling96_coverage: 0, rolling96_adjusted_net: 0,
  };

  let peakAdj = 0;
  let cumAdj = 0;
  const window: Array<{ adj: number; directional: boolean }> = [];

  for (const r of rows) {
    c.total += 1;
    const opFail = String(r.operational_status) !== "OK";
    if (opFail) { c.op_fails += 1; continue; }
    if (r.final_prediction === "ABSTAIN") c.strategic_abstains += 1;
    if (r.saturation_veto_triggered) {
      c.saturation_veto_count += 1;
      c.saturation_veto_raw += Number(r.saturation_veto_raw_contribution ?? 0);
      c.saturation_veto_adjusted += Number(r.saturation_veto_adjusted_contribution ?? 0);
    }
    if (r.red_pickup_triggered) {
      c.red_pickup_count += 1;
      c.red_pickup_raw += Number(r.red_pickup_raw_contribution ?? 0);
      c.red_pickup_adjusted += Number(r.red_pickup_adjusted_contribution ?? 0);
    }
    if (r.green_pickup_triggered) {
      c.green_pickup_count += 1;
      c.green_pickup_raw += Number(r.green_pickup_raw_contribution ?? 0);
      c.green_pickup_adjusted += Number(r.green_pickup_adjusted_contribution ?? 0);
    }
    if (r.weak_broad_red_veto_triggered) {
      c.weak_red_veto_count += 1;
      c.weak_red_veto_raw += Number(r.weak_broad_red_veto_raw_contribution ?? 0);
      c.weak_red_veto_adjusted += Number(r.weak_broad_red_veto_adjusted_contribution ?? 0);
    }

    if (!r.resolution_timestamp) { c.pending += 1; continue; }
    c.resolved += 1;

    const actual = String(r.canonical_actual_direction ?? "");
    if (actual === "PUSH") { c.pushes += 1; continue; }

    const raw = Number(r.final_raw_score ?? 0);
    const adj = Number(r.final_adjusted_score ?? 0);
    c.raw_net += raw;
    c.adjusted_net += adj;
    cumAdj += adj;
    peakAdj = Math.max(peakAdj, cumAdj);
    c.max_adjusted_drawdown = Math.max(c.max_adjusted_drawdown, peakAdj - cumAdj);

    const directional = r.final_prediction === "GREEN" || r.final_prediction === "RED";
    if (directional) {
      const won = raw > 0;
      if (won) {
        c.wins += 1;
        if (r.final_prediction === "GREEN") c.green_wins += 1; else c.red_wins += 1;
        c.current_loss_streak = 0;
      } else {
        c.losses += 1;
        if (r.final_prediction === "GREEN") c.green_losses += 1; else c.red_losses += 1;
        c.current_loss_streak += 1;
        c.max_loss_streak = Math.max(c.max_loss_streak, c.current_loss_streak);
      }
    }
    window.push({ adj, directional });
    if (window.length > 96) window.shift();
  }

  const wl = c.wins + c.losses;
  const scored = c.resolved - c.pushes - c.pending;
  c.rolling96_predictions = window.length;
  c.rolling96_coverage = window.length
    ? Math.round((window.filter((w) => w.directional).length / window.length) * 10000) / 100
    : 0;
  c.rolling96_adjusted_net = Math.round(window.reduce((s, w) => s + w.adj, 0) * 100) / 100;

  return {
    ...c,
    raw_net: Math.round(c.raw_net * 100) / 100,
    adjusted_net: Math.round(c.adjusted_net * 100) / 100,
    max_adjusted_drawdown: Math.round(c.max_adjusted_drawdown * 100) / 100,
    win_rate: wl ? Math.round((c.wins / wl) * 10000) / 100 : 0,
    coverage: scored > 0 ? Math.round((wl / scored) * 10000) / 100 : 0,
    breakeven_win_rate: 55.5555556,
  };
});

/** Most recent V6 row (the pending target candle when unresolved). */
export const getV6Pending = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data } = await sb
    .from("v6_predictions")
    .select(
      "target_candle_ts, final_prediction, base_v6_prediction, prediction_source, abstain_status, abstain_reason, operational_status, operational_error, final_score, red_threshold, green_threshold, ridge_p_green, ridge_percentile, gb_p_green, gb_percentile, broad_score, broad_percentile, anchor_score, anchor_percentile, saturation_veto_triggered, red_pickup_triggered, green_pickup_triggered, weak_broad_red_veto_triggered, canonical_actual_direction, resolution_timestamp",
    )
    .order("target_candle_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
});

/** Complete V6 tracking CSV in the frozen template column order. */
export const exportV6Csv = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await pageAllV6("*");
  const { v6RowsToCsv } = await import("./v6/csv");
  return { csv: v6RowsToCsv(rows), rows: rows.length };
});
