import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { runAiPredictionServer, resolvePredictionsServer } from "./prediction.server";
import { fetchAndUpsertOkxCandles } from "./okx.server";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const runAiPrediction = createServerFn({ method: "POST" }).handler(async () => {
  return runAiPredictionServer(await admin());
});

export const resolvePredictions = createServerFn({ method: "POST" }).handler(async () => {
  return resolvePredictionsServer(await admin());
});

export const listDailyArchives = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model_stats_archive")
    .select("*")
    .order("archived_at", { ascending: false })
    .limit(365);
  if (error) throw error;
  return data ?? [];
});


/** Full cycle: fetch -> resolve -> run AI. */
export const runFullCycle = createServerFn({ method: "POST" }).handler(async () => {
  const sb = await admin();
  await fetchAndUpsertOkxCandles(sb);
  const resolved = await resolvePredictionsServer(sb);
  const prediction = await runAiPredictionServer(sb);
  return { resolved, prediction };
});

export const listPredictions = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ modelVersion: z.string().optional().nullable() }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    let q = sb.from("predictions").select("*").order("created_at", { ascending: false }).limit(500);
    if (data.modelVersion) q = q.eq("model_version", data.modelVersion);
    const { data: rows, error } = await q;
    if (error) throw error;
    return rows ?? [];
  });

/** Union of live + archived predictions — used by the History CSV page so wipes don't lose data. */
export const listAllPredictionsForHistory = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const [live, arch] = await Promise.all([
    sb.from("predictions").select("*").order("created_at", { ascending: false }).limit(5000),
    sb.from("predictions_archive").select("*").order("created_at", { ascending: false }).limit(20000),
  ]);
  if (live.error) throw live.error;
  if (arch.error) throw arch.error;
  const seen = new Set<string>();
  const merged: typeof live.data = [];
  for (const row of [...(live.data ?? []), ...(arch.data ?? [])]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    merged.push(row);
  }
  return merged;
});

export const getLatestPrediction = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("predictions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
});

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export const getPredictionStats = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ modelVersion: z.string().optional().nullable() }).parse(input ?? {}),
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: row, error } = await sb.rpc("prediction_stats_filtered", {
      model_version_filter: data.modelVersion ?? undefined,
    });
    if (error) throw error;
    return (JSON.parse(JSON.stringify(row ?? {})) as JsonValue) as { [k: string]: JsonValue };
  });

/** List of every distinct model_version present across live + archive, newest activity first. */
export const listModelVersions = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const [live, arch] = await Promise.all([
    sb.from("predictions").select("model_version, created_at").order("created_at", { ascending: false }).limit(5000),
    sb.from("predictions_archive").select("model_version, created_at").order("created_at", { ascending: false }).limit(5000),
  ]);
  const map = new Map<string, string>();
  for (const r of [...(live.data ?? []), ...(arch.data ?? [])]) {
    const v = (r as any).model_version as string | null;
    if (!v) continue;
    const t = (r as any).created_at as string;
    if (!map.has(v) || t > (map.get(v) ?? "")) map.set(v, t);
  }
  return Array.from(map.entries())
    .sort((a, b) => (b[1] > a[1] ? 1 : -1))
    .map(([version, last_seen]) => ({ version, last_seen }));
});

/** Aggregate stats for the Model 7 shadow variants (A frozen, B live-retrained). */
export const getModel7ShadowStats = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const PAGE = 1000;
  const rows: Array<any> = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("model7_shadow")
      .select("variant, status, would_trade, decision, probability_green, candle_ts, resolved_at")
      .eq("would_trade", true)
      .order("candle_ts", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    if (from > 100000) break; // safety
  }

  const typedRows = rows as Array<{
    variant: string;
    status: string;
    would_trade: boolean | null;
    decision: string | null;
    probability_green: number | null;
    candle_ts: string | null;
    resolved_at: string | null;
  }>;


  const blank = () => ({
    total: 0, wins: 0, losses: 0, pushes: 0, pending: 0, win_rate: 0,
    last_10_win_rate: 0, last_25_win_rate: 0, last_50_win_rate: 0,
    yes_total: 0, yes_wins: 0, yes_win_rate: 0,
    no_total: 0, no_wins: 0, no_win_rate: 0,
    avg_confidence: 0, avg_confidence_wins: 0, avg_confidence_losses: 0,
  });
  type VKey = "A" | "B" | "B2" | "B4_2";
  const out: Record<VKey, ReturnType<typeof blank>> = { A: blank(), B: blank(), B2: blank(), B4_2: blank() };
  const perVariantResolved: Record<VKey, Array<{ ts: string; status: string }>> = { A: [], B: [], B2: [], B4_2: [] };

  const confPct = (p: number | null, decision: string | null) => {
    if (typeof p !== "number") return null;
    if (decision === "YES") return p * 100;
    if (decision === "NO") return (1 - p) * 100;
    return Math.max(p, 1 - p) * 100;
  };

  for (const r of rows) {
    if (!r.would_trade) continue;
    if (r.variant !== "A" && r.variant !== "B" && r.variant !== "B2" && r.variant !== "B4_2") continue;
    const v = r.variant as VKey;
    const b = out[v];
    b.total += 1;
    if (r.status === "win") b.wins += 1;
    else if (r.status === "loss") b.losses += 1;
    else if (r.status === "push") b.pushes += 1;
    else if (r.status === "pending") b.pending += 1;

    const c = confPct(r.probability_green, r.decision);
    if (r.status === "win" || r.status === "loss") {
      if (c !== null) {
        b.avg_confidence += c;
        if (r.status === "win") b.avg_confidence_wins += c;
        else b.avg_confidence_losses += c;
      }
      if (r.decision === "YES") { b.yes_total += 1; if (r.status === "win") b.yes_wins += 1; }
      else if (r.decision === "NO") { b.no_total += 1; if (r.status === "win") b.no_wins += 1; }
      perVariantResolved[v].push({ ts: r.resolved_at ?? r.candle_ts ?? "", status: r.status });
    }
  }

  const wr = (w: number, l: number) => (w + l === 0 ? 0 : Math.round((w / (w + l)) * 10000) / 100);
  const avg = (sum: number, n: number) => (n === 0 ? 0 : Math.round((sum / n) * 100) / 100);

  for (const k of ["A", "B", "B2", "B4_2"] as const) {
    const b = out[k];
    const decided = b.wins + b.losses;
    b.win_rate = wr(b.wins, b.losses);
    b.yes_win_rate = wr(b.yes_wins, b.yes_total - b.yes_wins);
    b.no_win_rate = wr(b.no_wins, b.no_total - b.no_wins);
    b.avg_confidence = avg(b.avg_confidence, decided);
    b.avg_confidence_wins = avg(b.avg_confidence_wins, b.wins);
    b.avg_confidence_losses = avg(b.avg_confidence_losses, b.losses);

    const sorted = perVariantResolved[k].sort((a, z) => (z.ts > a.ts ? 1 : -1));
    for (const n of [10, 25, 50] as const) {
      const slice = sorted.slice(0, n);
      const w = slice.filter((x) => x.status === "win").length;
      const l = slice.filter((x) => x.status === "loss").length;
      (b as any)[`last_${n}_win_rate`] = wr(w, l);
    }
  }
  return out;
});


/** Export all Model 7 shadow rows joined with production prediction context. */
export const exportModel7Shadow = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data: shadow, error } = await sb
    .from("model7_shadow")
    .select("*")
    .order("candle_ts", { ascending: false })
    .limit(20000);
  if (error) throw error;
  const rows = shadow ?? [];
  const predIds = Array.from(new Set(rows.map((r: any) => r.prediction_id).filter(Boolean)));
  const predMap = new Map<string, any>();
  const chunk = 500;
  for (let i = 0; i < predIds.length; i += chunk) {
    const slice = predIds.slice(i, i + chunk);
    const [live, arch] = await Promise.all([
      sb.from("predictions").select("id, created_at, candle_ts, prediction, confidence, setup_type, status, market_condition, btc_price_at_prediction, actual_next_candle_close, agreement_gate_applied, final_trade_status, model_version").in("id", slice),
      sb.from("predictions_archive").select("id, created_at, candle_ts, prediction, confidence, setup_type, status, market_condition, btc_price_at_prediction, actual_next_candle_close, agreement_gate_applied, final_trade_status, model_version").in("id", slice),
    ]);
    for (const p of [...(live.data ?? []), ...(arch.data ?? [])]) {
      if (!predMap.has(p.id)) predMap.set(p.id, p);
    }
  }
  return rows.map((r: any) => {
    const p = predMap.get(r.prediction_id) ?? {};
    return {
      candle_ts: r.candle_ts,
      variant: r.variant,
      status: r.status,
      decision: r.decision,
      base_decision: r.base_decision,
      would_trade: r.would_trade,
      probability_green: r.probability_green,
      logit: r.logit,
      hard_no_override_fired: r.hard_no_override_fired,
      model_fit_id: r.model_fit_id,
      feature_vector_nonzero_count: r.feature_vector_nonzero_count,
      unknown_categories: r.unknown_categories ? JSON.stringify(r.unknown_categories) : "",
      actual_direction: r.actual_direction,
      resolved_at: r.resolved_at,
      shadow_error: r.shadow_error,
      created_at: r.created_at,
      prediction_id: r.prediction_id,
      boundary_delta_ms: r.boundary_delta_ms ?? null,
      timing_status: r.timing_status ?? null,
      leakage_check_passed: r.leakage_check_passed ?? null,
      prediction_row_lead_ms: r.prediction_row_lead_ms ?? null,
      latest_source_candle_ts: r.latest_source_candle_ts ?? null,
      feature_cutoff_ts: r.feature_cutoff_ts ?? null,
      leakage_block_reason: r.leakage_block_reason ?? null,
      production_model_version: r.production_model_version ?? p.model_version ?? null,
      prod_prediction: p.prediction ?? null,
      prod_confidence: p.confidence ?? null,
      prod_setup_type: p.setup_type ?? null,
      prod_status: p.status ?? null,
      prod_market_condition: p.market_condition ?? null,
      prod_agreement_gate_applied: p.agreement_gate_applied ?? null,
      prod_final_trade_status: p.final_trade_status ?? null,
      btc_price_at_prediction: p.btc_price_at_prediction ?? null,
      close_price: p.actual_next_candle_close ?? null,
      b4_2_guard_fired: r.b4_2_guard_fired ?? null,
      b4_2_guard_reason: r.b4_2_guard_reason ?? null,
      b4_2_edge_score_before: r.b4_2_edge_score_before ?? null,
      b4_2_cooldown_before: r.b4_2_cooldown_before ?? null,
      b4_2_date_mt: r.b4_2_date_mt ?? null,
      b4_2_policy_version: r.b4_2_policy_version ?? null,
      b4_2_last_two_no_results_json: r.b4_2_last_two_no_results_json
        ? JSON.stringify(r.b4_2_last_two_no_results_json) : "",
      b4_2_counterfactual_b2_result: r.b4_2_counterfactual_b2_result ?? null,
      b4_2_b2_would_have_won: r.b4_2_b2_would_have_won ?? null,
    };
  });
});

/** Shadow predictions on the current pending candle. */
export const getModel7ShadowPending = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model7_shadow")
    .select("variant, candle_ts, probability_green, decision, would_trade, status")
    .order("candle_ts", { ascending: false })
    .limit(20);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    variant: string; candle_ts: string; probability_green: number | null;
    decision: string | null; would_trade: boolean | null; status: string;
  }>;
  if (rows.length === 0) return { candle_ts: null, A: null, B: null, B2: null, B4_2: null };
  const latestTs = rows[0].candle_ts;
  const forLatest = rows.filter((r) => r.candle_ts === latestTs);
  const pick = (v: "A" | "B" | "B2" | "B4_2") => forLatest.find((r) => r.variant === v) ?? null;
  return { candle_ts: latestTs, A: pick("A"), B: pick("B"), B2: pick("B2"), B4_2: pick("B4_2") };
});


/** Aggregate stats for the Model C shadows. */
export const getModelCShadowStats = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model_c_shadow")
    .select("variant, status, trade, final_decision, ensemble_probability_green, candle_ts, resolved_at")
    .limit(50000);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    variant: string | null;
    status: string;
    trade: boolean | null;
    final_decision: string | null;
    ensemble_probability_green: number | null;
    candle_ts: string | null;
    resolved_at: string | null;
  }>;
  const blank = () => ({
    total: 0, wins: 0, losses: 0, pushes: 0, pending: 0, win_rate: 0,
    yes_total: 0, yes_wins: 0, no_total: 0, no_wins: 0,
  });
  const out = {
    dual_horizon: blank(),
    global_only: blank(),
  };
  for (const r of rows) {
    const variant = r.variant === "global_only" ? "global_only" : "dual_horizon";
    const b = out[variant];
    if (!r.trade) continue;
    b.total += 1;
    if (r.status === "win") b.wins += 1;
    else if (r.status === "loss") b.losses += 1;
    else if (r.status === "push") b.pushes += 1;
    else if (r.status === "warming_up" || r.status === "scored") b.pending += 1;
    if (r.status === "win" || r.status === "loss") {
      if (r.final_decision === "YES") { b.yes_total += 1; if (r.status === "win") b.yes_wins += 1; }
      else if (r.final_decision === "NO") { b.no_total += 1; if (r.status === "win") b.no_wins += 1; }
    }
  }
  for (const b of Object.values(out)) {
    const decided = b.wins + b.losses;
    b.win_rate = decided === 0 ? 0 : Math.round((b.wins / decided) * 10000) / 100;
  }
  return out;
});

/** Latest Model C shadow rows for the current pending candle. */
export const getModelCShadowPending = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model_c_shadow")
    .select("variant, candle_ts, ensemble_probability_green, global_probability_green, recent_probability_green, final_decision, trade, status")
    .order("candle_ts", { ascending: false })
    .limit(20);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    variant: string | null;
    candle_ts: string;
    ensemble_probability_green: number | null;
    global_probability_green: number | null;
    recent_probability_green: number | null;
    final_decision: string | null;
    trade: boolean | null;
    status: string;
  }>;
  if (rows.length === 0) return { candle_ts: null, dual_horizon: null, global_only: null };
  const latestTs = rows[0].candle_ts;
  const forLatest = rows.filter((r) => r.candle_ts === latestTs);
  return {
    candle_ts: latestTs,
    dual_horizon: forLatest.find((r) => (r.variant ?? "dual_horizon") === "dual_horizon") ?? null,
    global_only: forLatest.find((r) => r.variant === "global_only") ?? null,
  };
});

/** Export all Model C shadow rows for CSV download. */
export const exportModelCShadow = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model_c_shadow")
    .select("*")
    .order("candle_ts", { ascending: false })
    .limit(20000);
  if (error) throw error;
  return (data ?? []).map((r: any) => {
    const out: Record<string, string | number | boolean | null> = {};
    for (const [k, v] of Object.entries(r)) {
      if (v === null || v === undefined) out[k] = null;
      else if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") out[k] = v;
      else out[k] = JSON.stringify(v);
    }
    return out;
  });
});




// ---------------------------------------------------------------------------
// Variant B2 UI adapters — shape shadow rows to match the legacy prediction
// UI (prediction/confidence/status/candle_ts/actual_*) so the home page can
// render B2 without knowing about the shadow schema.
// ---------------------------------------------------------------------------

type B2UiRow = {
  id: string;
  candle_ts: string;
  prediction: "YES" | "NO" | "NO CLEAR EDGE";
  confidence: number;
  status: string;
  resolved_at: string | null;
  created_at: string;
  actual_next_candle_open: number | null;
  actual_next_candle_close: number | null;
};

function shapeB2Row(r: any, prod: any | null): B2UiRow {
  const decision = r.decision as string | null;
  const p = Number(r.probability_green ?? 0);
  const prediction: "YES" | "NO" | "NO CLEAR EDGE" =
    decision === "YES" ? "YES" : decision === "NO" ? "NO" : "NO CLEAR EDGE";
  const confidence =
    decision === "YES" ? Math.round(p * 100)
    : decision === "NO" ? Math.round((1 - p) * 100)
    : 0;
  return {
    id: r.id,
    candle_ts: r.candle_ts,
    prediction,
    confidence,
    status: r.status,
    resolved_at: r.resolved_at ?? null,
    created_at: r.created_at,
    actual_next_candle_open: prod?.actual_next_candle_open != null ? Number(prod.actual_next_candle_open) : null,
    actual_next_candle_close: prod?.actual_next_candle_close != null ? Number(prod.actual_next_candle_close) : null,
  };
}

/** Latest B2 shadow row shaped for the home page's current/upcoming cards. */
export const getVariantB2Latest = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model7_shadow")
    .select("id, candle_ts, decision, probability_green, status, resolved_at, created_at, prediction_id")
    .eq("variant", "B2")
    .order("candle_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return shapeB2Row(data, null);
});

/** Recent B2 shadow rows shaped for the home page's last-5-trades + last-result cards. */
export const listVariantB2Recent = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model7_shadow")
    .select("id, candle_ts, decision, probability_green, status, resolved_at, created_at, prediction_id")
    .eq("variant", "B2")
    .order("candle_ts", { ascending: false })
    .limit(50);
  if (error) throw error;
  const rows = data ?? [];
  const ids = Array.from(new Set(rows.map((r: any) => r.prediction_id).filter(Boolean)));
  const prodMap = new Map<string, any>();
  if (ids.length) {
    const [live, arch] = await Promise.all([
      sb.from("predictions").select("id, actual_next_candle_open, actual_next_candle_close").in("id", ids),
      sb.from("predictions_archive").select("id, actual_next_candle_open, actual_next_candle_close").in("id", ids),
    ]);
    for (const p of [...(live.data ?? []), ...(arch.data ?? [])]) {
      if (!prodMap.has(p.id)) prodMap.set(p.id, p);
    }
  }
  return rows.map((r: any) => shapeB2Row(r, prodMap.get(r.prediction_id) ?? null));
});






const overrideSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "win", "loss", "push", "manual_review"]),
  notes: z.string().optional().nullable(),
});

export const overridePrediction = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => overrideSchema.parse(input))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { error } = await sb
      .from("predictions")
      .update({
        status: data.status,
        notes: data.notes ?? null,
        resolved_at: data.status === "pending" ? null : new Date().toISOString(),
      })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
