// V6 server functions: stats card data, pending prediction, and CSV export.

import { createServerFn } from "@tanstack/react-start";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

const PAGE = 1000;

/** Visual-only cutoff: rows created at/before this are hidden from the stats card. */
async function v6VisualResetAt(): Promise<string | null> {
  const sb = await admin();
  const { data } = await sb
    .from("v6_visual_stats_reset")
    .select("reset_at")
    .eq("id", 1)
    .maybeSingle();
  return data?.reset_at ? new Date(String(data.reset_at)).toISOString() : null;
}

async function pageAllV6(select: string, sinceIso?: string | null): Promise<Array<Record<string, unknown>>> {
  const sb = await admin();
  const out: Array<Record<string, unknown>> = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb
      .from("v6_predictions")
      .select(select)
      .order("target_candle_ts", { ascending: true })
      .range(from, from + PAGE - 1);
    if (sinceIso) q = q.gt("prediction_created_at", sinceIso);
    const { data } = await q;
    if (!data || data.length === 0) break;
    out.push(...(data as unknown as Array<Record<string, unknown>>));
    if (data.length < PAGE) break;
  }
  return out;
}

/** Visual-only reset of the V6 stats card counters. CSV/history stay intact. */
export const resetV6VisualStats = createServerFn({ method: "POST" }).handler(async () => {
  const sb = await admin();
  const reset_at = new Date().toISOString();
  const { error } = await sb
    .from("v6_visual_stats_reset")
    .upsert({ id: 1, reset_at, reason: "user-ui-reset" }, { onConflict: "id" });
  if (error) throw error;
  return { ok: true, reset_at };
});

/** Aggregate V6 performance. Adjusted net is the primary headline metric. */
export const getV6Stats = createServerFn({ method: "GET" }).handler(async () => {
  const resetAt = await v6VisualResetAt();
  const rows = await pageAllV6(
    "target_candle_ts, operational_status, final_prediction, base_v6_prediction, prediction_source, canonical_actual_direction, resolution_timestamp, final_raw_score, final_adjusted_score, saturation_veto_triggered, saturation_veto_raw_contribution, saturation_veto_adjusted_contribution, red_pickup_triggered, red_pickup_raw_contribution, red_pickup_adjusted_contribution, green_pickup_triggered, green_pickup_raw_contribution, green_pickup_adjusted_contribution, weak_broad_red_veto_triggered, weak_broad_red_veto_raw_contribution, weak_broad_red_veto_adjusted_contribution, pre_inverter_prediction, pre_inverter_raw_score, pre_inverter_adjusted_score, regime_inverter_triggered, regime_inverter_raw_contribution, regime_inverter_adjusted_contribution, weak_red_veto_candidate, weak_red_recovery_triggered, weak_red_recovery_reason, weak_red_rsi_recovery_triggered, weak_red_roc4_recovery_triggered, weak_red_recovery_raw_contribution, weak_red_recovery_adjusted_contribution, weak_red_underlying_adjusted_score",
    resetAt,
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
    max_adjusted_drawdown: 0, max_raw_drawdown: 0,
    rolling96_predictions: 0, rolling96_coverage: 0, rolling96_adjusted_net: 0, rolling96_raw_net: 0,
    // Regime Inverter (V6-r1)
    inverter_trigger_count: 0, inverter_wins: 0, inverter_losses: 0,
    inverter_raw_contribution: 0, inverter_adjusted_contribution: 0,
    pre_inverter_raw_net: 0, pre_inverter_adjusted_net: 0,
    pre_inverter_directional: 0,
    // Weak-RED coverage recovery (V6-r2)
    weak_red_candidates: 0, weak_red_vetoed: 0, weak_red_restored: 0,
    weak_red_rsi_recoveries: 0, weak_red_rsi_wins: 0, weak_red_rsi_losses: 0,
    weak_red_rsi_adjusted: 0,
    weak_red_roc4_recoveries: 0, weak_red_roc4_wins: 0, weak_red_roc4_losses: 0,
    weak_red_roc4_adjusted: 0,
    weak_red_recovery_wins: 0, weak_red_recovery_losses: 0, weak_red_restored_scored: 0,
    weak_red_recovery_raw: 0, weak_red_recovery_adjusted: 0,
    rolling96_directional_predictions: 0, rolling96_valid_opportunities: 0,
  };

  // Last 3 calendar days (Mountain Time): win rate + net wins per day, raw scoring.
  const REPORT_TZ = "America/Denver";
  const dayKey = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: REPORT_TZ, year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(iso));
  const dayBuckets: Record<string, { wins: number; losses: number }> = {};

  let peakAdj = 0;
  let cumAdj = 0;
  let peakRaw = 0;
  let cumRaw = 0;
  const window: Array<{ adj: number; raw: number; directional: boolean }> = [];




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

    if (r.weak_red_veto_candidate) {
      c.weak_red_candidates += 1;
      if (r.weak_red_recovery_triggered) {
        c.weak_red_restored += 1;
        if (r.weak_red_rsi_recovery_triggered) c.weak_red_rsi_recoveries += 1;
        if (r.weak_red_roc4_recovery_triggered) c.weak_red_roc4_recoveries += 1;
      } else {
        c.weak_red_vetoed += 1;
      }
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
    cumRaw += raw;
    peakRaw = Math.max(peakRaw, cumRaw);
    c.max_raw_drawdown = Math.max(c.max_raw_drawdown, peakRaw - cumRaw);


    const directional = r.final_prediction === "GREEN" || r.final_prediction === "RED";
    if (directional) {
      const won = raw > 0;
      if (r.target_candle_ts) {
        const k = dayKey(String(r.target_candle_ts));
        dayBuckets[k] ??= { wins: 0, losses: 0 };
        if (won) dayBuckets[k].wins += 1; else dayBuckets[k].losses += 1;
      }
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


    // Regime Inverter accounting (counterfactual pre-inverter track).
    const preAdj = r.pre_inverter_adjusted_score == null ? adj : Number(r.pre_inverter_adjusted_score);
    const preRaw = r.pre_inverter_raw_score == null ? raw : Number(r.pre_inverter_raw_score);
    c.pre_inverter_adjusted_net += preAdj;
    c.pre_inverter_raw_net += preRaw;
    const preDirectional =
      r.pre_inverter_prediction == null
        ? directional
        : r.pre_inverter_prediction === "GREEN" || r.pre_inverter_prediction === "RED";
    if (preDirectional) c.pre_inverter_directional += 1;
    if (r.regime_inverter_triggered) {
      c.inverter_trigger_count += 1;
      if (raw > 0) c.inverter_wins += 1; else c.inverter_losses += 1;
      c.inverter_raw_contribution += Number(r.regime_inverter_raw_contribution ?? 0);
      c.inverter_adjusted_contribution += Number(r.regime_inverter_adjusted_contribution ?? 0);
    }

    if (r.weak_red_veto_candidate && r.weak_red_recovery_triggered) {
      const rRaw = Number(r.weak_red_recovery_raw_contribution ?? 0);
      const rAdj = Number(r.weak_red_recovery_adjusted_contribution ?? 0);
      c.weak_red_recovery_raw += rRaw;
      c.weak_red_recovery_adjusted += rAdj;
      c.weak_red_restored_scored += 1;
      const won = rRaw > 0;
      if (won) c.weak_red_recovery_wins += 1; else c.weak_red_recovery_losses += 1;
      if (r.weak_red_rsi_recovery_triggered) {
        c.weak_red_rsi_adjusted += rAdj;
        if (won) c.weak_red_rsi_wins += 1; else c.weak_red_rsi_losses += 1;
      } else if (r.weak_red_roc4_recovery_triggered) {
        c.weak_red_roc4_adjusted += rAdj;
        if (won) c.weak_red_roc4_wins += 1; else c.weak_red_roc4_losses += 1;
      }
    }

    window.push({ adj, raw, directional });
    if (window.length > 96) window.shift();
  }

  const wl = c.wins + c.losses;
  const scored = c.resolved - c.pushes - c.pending;
  c.rolling96_predictions = window.length;
  c.rolling96_valid_opportunities = window.length;
  c.rolling96_directional_predictions = window.filter((w) => w.directional).length;
  c.rolling96_coverage = window.length
    ? Math.round((c.rolling96_directional_predictions / window.length) * 10000) / 100
    : 0;
  c.rolling96_adjusted_net = Math.round(window.reduce((s, w) => s + w.adj, 0) * 100) / 100;
  c.rolling96_raw_net = Math.round(window.reduce((s, w) => s + w.raw, 0) * 100) / 100;

  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    ...c,
    raw_net: round2(c.raw_net),
    adjusted_net: round2(c.adjusted_net),
    max_adjusted_drawdown: round2(c.max_adjusted_drawdown),
    max_raw_drawdown: round2(c.max_raw_drawdown),
    win_rate: wl ? Math.round((c.wins / wl) * 10000) / 100 : 0,

    coverage: scored > 0 ? Math.round((wl / scored) * 10000) / 100 : 0,
    pre_inverter_coverage: scored > 0 ? Math.round((c.pre_inverter_directional / scored) * 10000) / 100 : 0,
    pre_inverter_adjusted_net: round2(c.pre_inverter_adjusted_net),
    pre_inverter_raw_net: round2(c.pre_inverter_raw_net),
    inverter_raw_contribution: round2(c.inverter_raw_contribution),
    inverter_adjusted_contribution: round2(c.inverter_adjusted_contribution),
    weak_red_recovery_raw: round2(c.weak_red_recovery_raw),
    weak_red_recovery_adjusted: round2(c.weak_red_recovery_adjusted),
    weak_red_rsi_adjusted: round2(c.weak_red_rsi_adjusted),
    weak_red_roc4_adjusted: round2(c.weak_red_roc4_adjusted),
    weak_red_rsi_threshold: 58,
    weak_red_roc4_threshold: 0.28,
    // Coverage: final directional predictions / valid opportunities.
    coverage_after_weak_red_recovery: scored > 0 ? Math.round((wl / scored) * 10000) / 100 : 0,
    coverage_before_weak_red_recovery:
      scored > 0 ? Math.round(((wl - c.weak_red_restored_scored) / scored) * 10000) / 100 : 0,
    coverage_added_by_weak_red_recovery:
      scored > 0 ? Math.round((c.weak_red_restored_scored / scored) * 10000) / 100 : 0,
    model_revision: "V6-r2-regime-inverter-red-recovery",
    breakeven_win_rate: 55.5555556,
  };
});

/** Most recent V6 row (the pending target candle when unresolved). */
export const getV6Pending = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data } = await sb
    .from("v6_predictions")
    .select(
      "target_candle_ts, final_prediction, base_v6_prediction, prediction_source, abstain_status, abstain_reason, operational_status, operational_error, final_score, red_threshold, green_threshold, ridge_p_green, ridge_percentile, gb_p_green, gb_percentile, broad_score, broad_percentile, anchor_score, anchor_percentile, saturation_veto_triggered, red_pickup_triggered, green_pickup_triggered, weak_broad_red_veto_triggered, canonical_actual_direction, resolution_timestamp, model_revision, original_v6_base_prediction, pre_inverter_prediction, pre_inverter_prediction_source, final_prediction_source, regime_inverter_ready, regime_inverter_active, regime_inverter_triggered, regime_inverter_history_count, regime_inverter_last20_wins, regime_inverter_last20_losses, regime_inverter_last20_adjusted_net, regime_inverter_activation_threshold",
    )
    .order("target_candle_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data ?? null;
});

/** Live Regime Inverter state (rolling shadow window) for the stats panel. */
export const getV6RegimeInverter = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data } = await sb
    .from("v6_regime_inverter_state")
    .select("*")
    .eq("model_version", "V6")
    .maybeSingle();
  return (data as Record<string, string | number | boolean | null> | null) ?? null;
});

/** Rebuild the rolling shadow window from canonical resolved history. */
export const rebuildV6RegimeInverter = createServerFn({ method: "POST" }).handler(async () => {
  const sb = await admin();
  const { rebuildInverterState } = await import("./v6/regimeInverterStore");
  const state = await rebuildInverterState(sb);
  return {
    ready: state.summary.ready,
    active: state.summary.active,
    count: state.summary.count,
    wins: state.summary.wins,
    losses: state.summary.losses,
    adjusted_net: state.summary.adjustedNet,
  };
});

/** Complete V6 tracking CSV in the frozen template column order. */
export const exportV6Csv = createServerFn({ method: "GET" }).handler(async () => {
  const rows = await pageAllV6("*");
  const { v6RowsToCsv } = await import("./v6/csv");
  return { csv: v6RowsToCsv(rows), rows: rows.length };
});

/** V6 warmup / readiness state for the stats card. */
export const getV6Warmup = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data } = await sb
    .from("v6_warmup_state")
    .select("*")
    .eq("model_version", "V6")
    .maybeSingle();
  return (data as Record<string, string | number | boolean | null> | null) ?? null;
});
