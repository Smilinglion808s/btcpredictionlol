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
  type VKey = "A" | "B" | "B2" | "B4_2" | "A2_Conflict" | "A2_MidBand" | "A2_Combined";
  const VKEYS: VKey[] = ["A", "B", "B2", "B4_2", "A2_Conflict", "A2_MidBand", "A2_Combined"];
  const out: Record<VKey, ReturnType<typeof blank>> = {
    A: blank(), B: blank(), B2: blank(), B4_2: blank(),
    A2_Conflict: blank(), A2_MidBand: blank(), A2_Combined: blank(),
  };
  const perVariantResolved: Record<VKey, Array<{ ts: string; status: string }>> = {
    A: [], B: [], B2: [], B4_2: [], A2_Conflict: [], A2_MidBand: [], A2_Combined: [],
  };

  const confPct = (p: number | null, decision: string | null) => {
    if (typeof p !== "number") return null;
    if (decision === "YES") return p * 100;
    if (decision === "NO") return (1 - p) * 100;
    return Math.max(p, 1 - p) * 100;
  };

  for (const r of typedRows) {

    if (!r.would_trade) continue;
    if (!(VKEYS as string[]).includes(r.variant)) continue;
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

  for (const k of VKEYS) {
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
      a2_filter_fired: r.a2_filter_fired ?? null,
      a2_filter_reason: r.a2_filter_reason ?? null,
      a2_probability_bucket: r.a2_probability_bucket ?? null,
      a2_variant_a_base_decision: r.a2_variant_a_base_decision ?? null,
      a2_variant_a_override_applied: r.a2_variant_a_override_applied ?? null,
      a2_variant_a_applied_override_reason: r.a2_variant_a_applied_override_reason ?? null,
      a2_variant_a_final_decision: r.a2_variant_a_final_decision ?? null,
      a2_counterfactual_result: r.a2_counterfactual_result ?? null,
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
    .limit(50);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    variant: string; candle_ts: string; probability_green: number | null;
    decision: string | null; would_trade: boolean | null; status: string;
  }>;
  if (rows.length === 0) return { candle_ts: null, A: null, B: null, B2: null, B4_2: null, A2_Conflict: null, A2_MidBand: null, A2_Combined: null };
  const latestTs = rows[0].candle_ts;
  const forLatest = rows.filter((r) => r.candle_ts === latestTs);
  type V = "A" | "B" | "B2" | "B4_2" | "A2_Conflict" | "A2_MidBand" | "A2_Combined";
  const pick = (v: V) => forLatest.find((r) => r.variant === v) ?? null;
  return {
    candle_ts: latestTs,
    A: pick("A"), B: pick("B"), B2: pick("B2"), B4_2: pick("B4_2"),
    A2_Conflict: pick("A2_Conflict"), A2_MidBand: pick("A2_MidBand"), A2_Combined: pick("A2_Combined"),
  };
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

/** Latest B4.2 shadow row shaped for the home page's current/upcoming cards. */
export const getVariantB4_2Latest = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model7_shadow")
    .select("id, candle_ts, decision, probability_green, status, resolved_at, created_at, prediction_id")
    .eq("variant", "B4_2")
    .order("candle_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return shapeB2Row(data, null);
});

/** Recent B4.2 shadow rows shaped for the home page's last-5-trades + last-result cards. */
export const listVariantB4_2Recent = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model7_shadow")
    .select("id, candle_ts, decision, probability_green, status, resolved_at, created_at, prediction_id")
    .eq("variant", "B4_2")
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

/** Latest A2 Conflict shadow row shaped for the home page's current/upcoming cards. */
export const getVariantA2ConflictLatest = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model7_shadow")
    .select("id, candle_ts, decision, probability_green, status, resolved_at, created_at, prediction_id")
    .eq("variant", "A2_Conflict")
    .order("candle_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return shapeB2Row(data, null);
});

/** Recent A2 Conflict shadow rows shaped for the home page's last-5-trades + last-result cards. */
export const listVariantA2ConflictRecent = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model7_shadow")
    .select("id, candle_ts, decision, probability_green, status, resolved_at, created_at, prediction_id")
    .eq("variant", "A2_Conflict")
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

// ---------- TD1-RC (Model 8 layer over A2_Combined) — active hero source ----------

function shapeTd1RcRow(r: any, prod: any | null): B2UiRow {
  const decision = r.external_final_decision as string | null;
  const wouldTrade = Boolean(r.would_trade);
  const p = Number(r.a2_probability_green ?? 0);
  const prediction: "YES" | "NO" | "NO CLEAR EDGE" =
    wouldTrade && decision === "YES" ? "YES"
    : wouldTrade && decision === "NO" ? "NO"
    : "NO CLEAR EDGE";
  const confidence =
    prediction === "YES" ? Math.round(p * 100)
    : prediction === "NO" ? Math.round((1 - p) * 100)
    : 0;
  // Row status: resolved rows carry `result` (WIN/LOSS/PUSH). Map to
  // shadow-row status codes used by the UI. TD1-RC skips (NO CLEAR EDGE)
  // are surfaced as "push" so the outcome column always reflects TD1-RC's call.
  const result = r.result as string | null;
  let status: string = "pending";
  if (prediction === "NO CLEAR EDGE") status = "push";
  else if (result === "WIN") status = "win";
  else if (result === "LOSS") status = "loss";
  else if (result === "PUSH") status = "push";

  return {
    id: r.id,
    candle_ts: r.candle_ts,
    prediction,
    confidence,
    status,
    resolved_at: r.resolved_at ?? null,
    created_at: r.created_at,
    actual_next_candle_open: prod?.actual_next_candle_open != null ? Number(prod.actual_next_candle_open) : null,
    actual_next_candle_close: prod?.actual_next_candle_close != null ? Number(prod.actual_next_candle_close) : null,
  };
}

/** Latest TD1-RC row shaped for the home page's current/upcoming cards. */
export const getTd1RcLatest = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model7_td1_rc_shadow")
    .select("id, candle_ts, external_final_decision, would_trade, a2_probability_green, result, resolved_at, created_at, prediction_id")
    .order("candle_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return shapeTd1RcRow(data, null);
});

/** Recent TD1-RC rows shaped for the home page's last-5-trades + last-result cards. */
export const listTd1RcRecent = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model7_td1_rc_shadow")
    .select("id, candle_ts, external_final_decision, would_trade, a2_probability_green, a2_original_decision, result, resolved_at, created_at, prediction_id")
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
  return rows.map((r: any) => ({
    ...shapeTd1RcRow(r, prodMap.get(r.prediction_id) ?? null),
    a2_combined: (r.a2_original_decision as string | null) ?? null,
  }));
});


/** Aggregate stats for TD1-RC shadow (A2_Combined_TD1_RC variant). */
export const getTd1RcShadowStats = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const PAGE = 1000;
  const rows: any[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("model7_td1_rc_shadow")
      .select("external_final_decision, would_trade, result, resolved_at, candle_ts, td1_veto_fired, containment_veto_fired, skip_reason, a2_original_decision, a2_counterfactual_result")
      .order("candle_ts", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    const batch = data ?? [];
    rows.push(...batch);
    if (batch.length < PAGE) break;
    if (from > 100000) break;
  }
  const traded = rows.filter((r) => r.would_trade === true);
  const wins = traded.filter((r) => r.result === "WIN").length;
  const losses = traded.filter((r) => r.result === "LOSS").length;
  const pushes = traded.filter((r) => r.result === "PUSH").length;
  const pending = traded.filter((r) => !r.result).length;
  const total = traded.length;
  const win_rate = wins + losses === 0 ? 0 : Math.round((wins / (wins + losses)) * 10000) / 100;

  const sorted = traded
    .filter((r) => r.result === "WIN" || r.result === "LOSS")
    .sort((a, b) => ((b.resolved_at ?? b.candle_ts ?? "") > (a.resolved_at ?? a.candle_ts ?? "") ? 1 : -1));
  const lastN = (n: number) => {
    const slice = sorted.slice(0, n);
    const w = slice.filter((x) => x.result === "WIN").length;
    const l = slice.filter((x) => x.result === "LOSS").length;
    return w + l === 0 ? 0 : Math.round((w / (w + l)) * 10000) / 100;
  };

  // Skip breakdown for diagnostics
  const skips = rows.filter((r) => r.external_final_decision === "SKIP");
  const skipReasons: Record<string, number> = {};
  for (const s of skips) {
    const k = s.skip_reason ?? "UNKNOWN";
    skipReasons[k] = (skipReasons[k] ?? 0) + 1;
  }
  const td1Vetoes = rows.filter((r) => r.td1_veto_fired === true).length;
  const containmentVetoes = rows.filter((r) => r.containment_veto_fired === true).length;

  // A2 counterfactual comparison over resolved rows where we can compare
  const compared = rows.filter((r) => r.a2_counterfactual_result === "WIN" || r.a2_counterfactual_result === "LOSS");
  const a2WinsAlone = compared.filter((r) => r.a2_counterfactual_result === "WIN").length;
  const a2LossesAlone = compared.filter((r) => r.a2_counterfactual_result === "LOSS").length;
  const a2_baseline_win_rate = a2WinsAlone + a2LossesAlone === 0
    ? 0 : Math.round((a2WinsAlone / (a2WinsAlone + a2LossesAlone)) * 10000) / 100;

  return {
    total, wins, losses, pushes, pending, win_rate,
    last_10_win_rate: lastN(10), last_25_win_rate: lastN(25), last_50_win_rate: lastN(50),
    td1_vetoes: td1Vetoes,
    containment_vetoes: containmentVetoes,
    total_rows: rows.length,
    skip_breakdown: skipReasons,
    a2_baseline_win_rate,
    a2_baseline_wins: a2WinsAlone,
    a2_baseline_losses: a2LossesAlone,
  };
});

/** Training progress for TD1-RC: shows how many candles remain before the model is ready to make live predictions. */
export const getTd1RcTrainingProgress = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const BASE_VARIANT = "A2_Combined";
  const MIN_SIGNALS_FOR_FIRST_FIT = 108; // MIN_TRAINING_ROWS (100) + 8 prior buffer
  const FREEZE_COHORT_SIZE = 200;

  const { data: activeFit } = await sb
    .from("model7_td1_fits")
    .select("fit_id, promoted_at")
    .eq("base_variant", BASE_VARIANT)
    .eq("active", true)
    .maybeSingle();

  // Phase 1: no active fit yet — collecting resolved A2_Combined signals to train first fit.
  if (!activeFit) {
    const { count } = await sb
      .from("model7_shadow")
      .select("id", { count: "exact", head: true })
      .eq("variant", BASE_VARIANT)
      .in("status", ["win", "loss"])
      .in("decision", ["YES", "NO"])
      .not("probability_green", "is", null);
    const have = count ?? 0;
    const target = MIN_SIGNALS_FOR_FIRST_FIT;
    return {
      phase: "collecting_first_fit" as const,
      label: "Collecting signals for first TD1 fit",
      current: have,
      target,
      remaining: Math.max(0, target - have),
      percent: Math.min(100, Math.round((have / target) * 1000) / 10),
      ready: false,
      fit_id: null as string | null,
    };
  }

  const fit = activeFit as { fit_id: string; promoted_at: string };

  return {
    phase: "ready" as const,
    label: "TD1-RC live",
    current: MIN_SIGNALS_FOR_FIRST_FIT,
    target: MIN_SIGNALS_FOR_FIRST_FIT,
    remaining: 0,
    percent: 100,
    ready: true,
    fit_id: fit.fit_id,
  };

});

/** Latest TD1-RC shadow row for the current pending candle. */
export const getTd1RcShadowPending = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model7_td1_rc_shadow")
    .select("candle_ts, external_final_decision, would_trade, td1_predicted_loss_probability, td1_veto_fired, containment_veto_fired, skip_reason, a2_original_decision, td1_fit_id")
    .order("candle_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
});

/** Export TD1-RC shadow rows as CSV-ready records — full tracker payload.
 *  Includes every column on model7_td1_rc_shadow plus enrichment joins to the
 *  A2_Combined source row (model7_shadow) and the underlying prediction row
 *  (actual candle outcome, boundary timing, partial-candle audit). */
export const exportTd1RcShadow = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();

  // Paginate to bypass PostgREST 1000-row cap.
  async function fetchAll<T>(build: (from: number, to: number) => Promise<{ data: T[] | null }>): Promise<T[]> {
    const PAGE = 1000;
    const out: T[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data } = await build(from, from + PAGE - 1);
      if (!data || data.length === 0) break;
      out.push(...data);
      if (data.length < PAGE) break;
    }
    return out;
  }

  const td1Rows = await fetchAll<any>((from, to) =>
    sb.from("model7_td1_rc_shadow").select("*").order("candle_ts", { ascending: false }).range(from, to) as any,
  );

  const predIds = Array.from(new Set(td1Rows.map((r) => r.prediction_id).filter(Boolean)));

  // Batch fetch enrichment sources.
  const chunk = <T,>(arr: T[], n: number): T[][] => {
    const out: T[][] = [];
    for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
    return out;
  };

  const a2Map = new Map<string, any>();
  const predMap = new Map<string, any>();
  for (const ids of chunk(predIds, 500)) {
    const [{ data: a2 }, { data: p }] = await Promise.all([
      sb.from("model7_shadow").select("*").eq("variant", "A2_Combined").in("prediction_id", ids),
      sb.from("predictions").select(
        "id, created_at, resolved_at, prediction, confidence, actual_direction, actual_next_candle_open, actual_next_candle_high, actual_next_candle_low, actual_next_candle_close, setup_type, market_condition, model_version, changed_by_partial, original_prediction_before_partial, partial_veto_active, partial_veto_tier, partial_veto_direction, partial_hard_override_fired, partial_fetch_source, partial_snapshot_present, partial_snapshot_failure_reason",
      ).in("id", ids),
    ]);
    for (const r of (a2 ?? [])) a2Map.set(r.prediction_id, r);
    for (const r of (p ?? [])) predMap.set(r.id, r);
  }

  return td1Rows.map((r: any) => {
    const a2 = a2Map.get(r.prediction_id) ?? null;
    const p = predMap.get(r.prediction_id) ?? null;
    return {
      // ---- TD1-RC row (full column set) ----
      td1_row_id: r.id,
      prediction_id: r.prediction_id,
      candle_ts: r.candle_ts,
      variant: r.variant,
      prospective_test_id: r.prospective_test_id,
      external_final_decision: r.external_final_decision,
      would_trade: r.would_trade,
      result: r.result,
      actual_direction: r.actual_direction,
      skip_reason: r.skip_reason,
      all_veto_reasons_json: r.all_veto_reasons_json ? JSON.stringify(r.all_veto_reasons_json) : "",
      shadow_error: r.shadow_error,
      // A2 source binding
      a2_source_variant: r.a2_source_variant,
      a2_source_row_id: r.a2_source_row_id,
      a2_original_decision: r.a2_original_decision,
      a2_probability_green: r.a2_probability_green,
      a2_model_fit_id: r.a2_model_fit_id,
      a2_counterfactual_result: r.a2_counterfactual_result,
      // TD1 model artifact + scoring
      td1_fit_id: r.td1_fit_id,
      td1_artifact_sha256: r.td1_artifact_sha256,
      td1_feature_vector_sha256: r.td1_feature_vector_sha256,
      td1_predicted_loss_probability: r.td1_predicted_loss_probability,
      td1_threshold: r.td1_threshold,
      td1_veto_fired: r.td1_veto_fired,
      td1_feature_cutoff_ts: r.td1_feature_cutoff_ts,
      td1_latest_source_candle_ts: r.td1_latest_source_candle_ts,
      feature_values_json: r.feature_values_json ? JSON.stringify(r.feature_values_json) : "",
      // Containment state
      containment_veto_fired: r.containment_veto_fired,
      containment_side: r.containment_side,
      containment_slots_before: r.containment_slots_before,
      containment_slots_after: r.containment_slots_after,
      containment_episode_armed_before: r.containment_episode_armed_before,
      containment_episode_armed_after: r.containment_episode_armed_after,
      // Timing / leakage on TD1-RC row
      timing_status: r.timing_status,
      leakage_check_passed: r.leakage_check_passed,
      created_at: r.created_at,
      updated_at: r.updated_at,
      resolved_at: r.resolved_at,

      // ---- A2_Combined source row enrichment ----
      a2_row_id: a2?.id ?? null,
      a2_base_decision: a2?.base_decision ?? null,
      a2_final_decision: a2?.decision ?? null,
      a2_logit: a2?.logit ?? null,
      a2_probability_bucket: a2?.a2_probability_bucket ?? null,
      a2_filter_fired: a2?.a2_filter_fired ?? null,
      a2_filter_reason: a2?.a2_filter_reason ?? null,
      a2_variant_a_base_decision: a2?.a2_variant_a_base_decision ?? null,
      a2_variant_a_override_applied: a2?.a2_variant_a_override_applied ?? null,
      a2_variant_a_applied_override_reason: a2?.a2_variant_a_applied_override_reason ?? null,
      a2_variant_a_final_decision: a2?.a2_variant_a_final_decision ?? null,
      a2_override_reasons_json: a2?.override_reasons_json ? JSON.stringify(a2.override_reasons_json) : "",
      a2_target_boundary_ts: a2?.target_boundary_ts ?? null,
      a2_score_not_before_ts: a2?.score_not_before_ts ?? null,
      a2_feature_cutoff_ts: a2?.feature_cutoff_ts ?? null,
      a2_latest_source_candle_ts: a2?.latest_source_candle_ts ?? null,
      a2_latest_source_event_ts: a2?.latest_source_event_ts ?? null,
      a2_previous_candle_ts: a2?.previous_candle_ts ?? null,
      a2_boundary_delta_ms: a2?.boundary_delta_ms ?? null,
      a2_scored_at: a2?.scored_at ?? null,
      a2_snapshot_ts: a2?.snapshot_ts ?? null,
      a2_prediction_row_created_at: a2?.prediction_row_created_at ?? null,
      a2_prediction_row_lead_ms: a2?.prediction_row_lead_ms ?? null,
      a2_timing_status: a2?.timing_status ?? null,
      a2_leakage_check_passed: a2?.leakage_check_passed ?? null,
      a2_leakage_block_reason: a2?.leakage_block_reason ?? null,
      a2_offending_features_json: a2?.offending_features_json ? JSON.stringify(a2.offending_features_json) : "",
      a2_history_candles_available: a2?.history_candles_available ?? null,
      a2_history_gap_encountered: a2?.history_gap_encountered ?? null,
      a2_missing_raw_numeric_fields_json: a2?.missing_raw_numeric_fields_json ? JSON.stringify(a2.missing_raw_numeric_fields_json) : "",
      a2_feature_vector_nonzero_count: a2?.feature_vector_nonzero_count ?? null,
      a2_feature_vector_sha256: a2?.feature_vector_sha256 ?? null,
      a2_model_artifact_sha256: a2?.model_artifact_sha256 ?? null,
      a2_warm_cache_hit: a2?.warm_cache_hit ?? null,
      a2_production_model_version: a2?.production_model_version ?? null,

      // ---- Prediction / actual outcome enrichment ----
      prediction_created_at: p?.created_at ?? null,
      prediction_resolved_at: p?.resolved_at ?? null,
      prediction_written_direction: p?.prediction ?? null,
      prediction_confidence: p?.confidence ?? null,
      prediction_model_version: p?.model_version ?? null,
      prediction_setup_type: p?.setup_type ?? null,
      prediction_market_condition: p?.market_condition ?? null,
      actual_direction_prediction: p?.actual_direction ?? null,
      actual_next_candle_open: p?.actual_next_candle_open ?? null,
      actual_next_candle_high: p?.actual_next_candle_high ?? null,
      actual_next_candle_low: p?.actual_next_candle_low ?? null,
      actual_next_candle_close: p?.actual_next_candle_close ?? null,
      changed_by_partial: p?.changed_by_partial ?? null,
      original_prediction_before_partial: p?.original_prediction_before_partial ?? null,
      partial_veto_active: p?.partial_veto_active ?? null,
      partial_veto_tier: p?.partial_veto_tier ?? null,
      partial_veto_direction: p?.partial_veto_direction ?? null,
      partial_hard_override_fired: p?.partial_hard_override_fired ?? null,
      partial_fetch_source: p?.partial_fetch_source ?? null,
      partial_snapshot_present: p?.partial_snapshot_present ?? null,
      partial_snapshot_failure_reason: p?.partial_snapshot_failure_reason ?? null,
    };
  });
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

/** AAS96 shadow stats — win/loss/push/pending + training progress. */
export const getAas96ShadowStats = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const PAGE = 1000;
  const counts = { pending: 0, win: 0, loss: 0, push: 0, skip: 0, total: 0 };
  for (let from = 0; ; from += PAGE) {
    const { data } = await sb
      .from("model7_aas96_shadow")
      .select("status, result, final_prediction")
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    for (const r of data as Array<{ status: string; result: string | null; final_prediction: string | null }>) {
      counts.total += 1;
      if (r.status === "pending") counts.pending += 1;
      else if (r.result === "win") counts.win += 1;
      else if (r.result === "loss") counts.loss += 1;
      else if (r.result === "push") counts.push += 1;
      else if (r.result === "skip" || r.final_prediction === "SKIP") counts.skip += 1;
    }
    if (data.length < PAGE) break;
  }
  const { data: state } = await sb.from("model7_aas96_state").select("resolved_directional_count").eq("id", 1).maybeSingle();
  const { data: fits } = await sb.from("model7_aas96_fits").select("fit_id, active, fitted_at").eq("active", true).order("fitted_at", { ascending: false }).limit(1);
  const trained = Number((state as { resolved_directional_count?: number } | null)?.resolved_directional_count ?? 0);
  const wl = counts.win + counts.loss;
  return {
    ...counts,
    win_rate: wl ? Math.round((counts.win / wl) * 10000) / 100 : 0,
    training_row_count: trained,
    training_target: 192,
    has_active_fit: (fits ?? []).length > 0,
    active_fit_id: (fits ?? [])[0]?.fit_id ?? null,
  };
});

export const getAas96ShadowPending = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model7_aas96_shadow")
    .select("candle_ts, final_prediction, baseline_prediction, published_prediction, published_abstain_reason, cleanup_veto_v1_fired, cleanup_veto_v1_reason, cleanup_veto_v1_conflict_subtype, layer_b_horizon_pattern, layer_b_h32_direction, layer_b_h64_direction, layer_b_h96_direction, layer_b_h192_direction, selected_layer, layer_a_final_direction, layer_b_final_direction, layer_a_prob_mean, armor_override_fired, armor_override_reason, eligibility_passed, skip_reason, fit_id, status")
    .order("candle_ts", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data ?? null;
});

/** Cleanup Veto V1 aggregate stats — baseline vs published w/ drawdown, streaks,
 *  coverage, retention, subtype + exact-pattern breakdown, and weekly rollup.
 *  wins − losses is the primary net-score metric; win-rate reported for context. */
export const getAas96VetoStats = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const PAGE = 1000;
  type SubStat = { fired: number; avoided: number; sacrificed: number; net: number };
  type PatStat = { total: number; fired: number; avoided: number; sacrificed: number; net: number };
  type Wk = { week_start: string; fired: number; avoided_losses: number; sacrificed_wins: number; net_effect: number; baseline_net: number; published_net: number; net_score_delta: number; coverage_pct: number; baseline_max_drawdown: number; published_max_drawdown: number; _bw: number; _bl: number; _pw: number; _pl: number; _pa: number; _bcum: number; _bpeak: number; _bdd: number; _pcum: number; _ppeak: number; _pdd: number };

  const s = {
    total_resolved_directional: 0,
    evaluable: 0,
    non_evaluable: 0,
    fired: 0,
    baseline_wins: 0,
    baseline_losses: 0,
    published_wins: 0,
    published_losses: 0,
    published_abstains: 0,
    baseline_actionable: 0,
    published_actionable: 0,
    avoided_losses: 0,
    sacrificed_wins: 0,
    net_effect: 0,
    baseline_max_drawdown: 0,
    baseline_longest_losing_streak: 0,
    published_max_drawdown: 0,
    published_longest_losing_streak: 0,
    by_subtype: {} as Record<string, SubStat>,
    by_pattern: {} as Record<string, PatStat>,
    weekly: [] as Wk[],
  };

  // Load rows ordered by candle_ts ascending so streak / drawdown are chronological.
  const all: Array<Record<string, any>> = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await sb
      .from("model7_aas96_shadow")
      .select("candle_ts, actual_direction, baseline_prediction, published_prediction, cleanup_veto_v1_evaluable, cleanup_veto_v1_fired, cleanup_veto_v1_conflict_subtype, layer_b_horizon_pattern, baseline_would_win, baseline_would_lose, veto_avoided_loss, veto_sacrificed_win, veto_net_effect")
      .in("actual_direction", ["GREEN", "RED"])
      .order("candle_ts", { ascending: true })
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    all.push(...(data as Array<Record<string, any>>));
    if (data.length < PAGE) break;
  }

  // Cumulative net-score + drawdown / streak state.
  let bCum = 0, bPeak = 0, bDD = 0, bStreak = 0, bMaxStreak = 0;
  let pCum = 0, pPeak = 0, pDD = 0, pStreak = 0, pMaxStreak = 0;
  const weekMap = new Map<string, Wk>();
  const mondayIsoUtc = (iso: string): string => {
    const d = new Date(iso);
    const day = d.getUTCDay(); // 0..6, 0=Sun
    const back = (day + 6) % 7;
    const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - back));
    return monday.toISOString().slice(0, 10);
  };

  for (const r of all) {
    s.total_resolved_directional += 1;
    if (r.cleanup_veto_v1_evaluable) s.evaluable += 1; else s.non_evaluable += 1;

    // Baseline grading (counterfactual — never mutated after resolution).
    if (r.baseline_would_win || r.baseline_would_lose) {
      s.baseline_actionable += 1;
      const bDelta = r.baseline_would_win ? 1 : -1;
      if (r.baseline_would_win) { s.baseline_wins += 1; bStreak = 0; }
      else { s.baseline_losses += 1; bStreak += 1; if (bStreak > bMaxStreak) bMaxStreak = bStreak; }
      bCum += bDelta;
      if (bCum > bPeak) bPeak = bCum;
      const dd = bPeak - bCum;
      if (dd > bDD) bDD = dd;
    }

    // Published grading — ABSTAINs contribute zero to wins/losses/net.
    const pub = r.published_prediction as string | null;
    let pDelta = 0;
    if (pub === "GREEN" || pub === "RED") {
      s.published_actionable += 1;
      if (pub === r.actual_direction) { s.published_wins += 1; pDelta = 1; pStreak = 0; }
      else { s.published_losses += 1; pDelta = -1; pStreak += 1; if (pStreak > pMaxStreak) pMaxStreak = pStreak; }
    } else if (pub === "ABSTAIN") {
      s.published_abstains += 1;
    }
    pCum += pDelta;
    if (pCum > pPeak) pPeak = pCum;
    const pdd = pPeak - pCum;
    if (pdd > pDD) pDD = pdd;

    // Pattern + subtype breakdown.
    const pattern = String(r.layer_b_horizon_pattern ?? "unknown");
    const pat = (s.by_pattern[pattern] ||= { total: 0, fired: 0, avoided: 0, sacrificed: 0, net: 0 });
    pat.total += 1;

    if (r.cleanup_veto_v1_fired) {
      s.fired += 1;
      if (r.veto_avoided_loss) s.avoided_losses += 1;
      if (r.veto_sacrificed_win) s.sacrificed_wins += 1;
      s.net_effect += Number(r.veto_net_effect ?? 0);
      const stk = String(r.cleanup_veto_v1_conflict_subtype ?? "unknown");
      const b = (s.by_subtype[stk] ||= { fired: 0, avoided: 0, sacrificed: 0, net: 0 });
      b.fired += 1;
      if (r.veto_avoided_loss) b.avoided += 1;
      if (r.veto_sacrificed_win) b.sacrificed += 1;
      b.net += Number(r.veto_net_effect ?? 0);
      pat.fired += 1;
      if (r.veto_avoided_loss) pat.avoided += 1;
      if (r.veto_sacrificed_win) pat.sacrificed += 1;
      pat.net += Number(r.veto_net_effect ?? 0);
    }

    // Weekly rollup (ISO Monday, UTC).
    if (r.candle_ts) {
      const ws = mondayIsoUtc(String(r.candle_ts));
      let w = weekMap.get(ws);
      if (!w) {
        w = { week_start: ws, fired: 0, avoided_losses: 0, sacrificed_wins: 0, net_effect: 0, baseline_net: 0, published_net: 0, net_score_delta: 0, coverage_pct: 0, baseline_max_drawdown: 0, published_max_drawdown: 0, _bw: 0, _bl: 0, _pw: 0, _pl: 0, _pa: 0, _bcum: 0, _bpeak: 0, _bdd: 0, _pcum: 0, _ppeak: 0, _pdd: 0 };
        weekMap.set(ws, w);
      }
      if (r.baseline_would_win) { w._bw += 1; w._bcum += 1; }
      if (r.baseline_would_lose) { w._bl += 1; w._bcum -= 1; }
      if (w._bcum > w._bpeak) w._bpeak = w._bcum;
      if (w._bpeak - w._bcum > w._bdd) w._bdd = w._bpeak - w._bcum;
      if (pub === "GREEN" || pub === "RED") {
        if (pub === r.actual_direction) { w._pw += 1; w._pcum += 1; }
        else { w._pl += 1; w._pcum -= 1; }
      } else if (pub === "ABSTAIN") { w._pa += 1; }
      if (w._pcum > w._ppeak) w._ppeak = w._pcum;
      if (w._ppeak - w._pcum > w._pdd) w._pdd = w._ppeak - w._pcum;
      if (r.cleanup_veto_v1_fired) {
        w.fired += 1;
        if (r.veto_avoided_loss) w.avoided_losses += 1;
        if (r.veto_sacrificed_win) w.sacrificed_wins += 1;
        w.net_effect += Number(r.veto_net_effect ?? 0);
      }
    }
  }

  s.baseline_max_drawdown = bDD;
  s.baseline_longest_losing_streak = bMaxStreak;
  s.published_max_drawdown = pDD;
  s.published_longest_losing_streak = pMaxStreak;

  const weekly: Wk[] = Array.from(weekMap.values()).map((w) => {
    const tot = w._bw + w._bl; // baseline actionable per week = coverage denominator
    const pubAct = w._pw + w._pl;
    w.baseline_net = w._bw - w._bl;
    w.published_net = w._pw - w._pl;
    w.net_score_delta = w.published_net - w.baseline_net;
    w.coverage_pct = tot ? Math.round((pubAct / tot) * 10000) / 100 : 0;
    w.baseline_max_drawdown = w._bdd;
    w.published_max_drawdown = w._pdd;
    return w;
  }).sort((a, b) => a.week_start.localeCompare(b.week_start));

  const baselineNet = s.baseline_wins - s.baseline_losses;
  const publishedNet = s.published_wins - s.published_losses;
  const baseWL = s.baseline_actionable;
  const pubWL = s.published_actionable;
  const coverage = baseWL ? Math.round((pubWL / baseWL) * 10000) / 100 : 0;
  const retained = pubWL;
  return {
    ...s,
    baseline_net_score: baselineNet,
    published_net_score: publishedNet,
    net_score_improvement: publishedNet - baselineNet,
    baseline_win_rate: baseWL ? Math.round((s.baseline_wins / baseWL) * 10000) / 100 : 0,
    published_win_rate: pubWL ? Math.round((s.published_wins / pubWL) * 10000) / 100 : 0,
    fire_rate: s.total_resolved_directional
      ? Math.round((s.fired / s.total_resolved_directional) * 10000) / 100
      : 0,
    precision_when_fired: s.fired
      ? Math.round((s.avoided_losses / s.fired) * 10000) / 100
      : 0,
    avoided_per_sacrificed: s.sacrificed_wins
      ? Math.round((s.avoided_losses / s.sacrificed_wins) * 100) / 100
      : (s.avoided_losses > 0 ? Number.POSITIVE_INFINITY : 0),
    predictions_retained: retained,
    coverage_pct: coverage,
    weekly,
  };
});




/** Full AAS96 CSV export — every column, enriched with prediction fields. */
export const exportAas96Shadow = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const PAGE = 1000;
  const rows: Record<string, any>[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb
      .from("model7_aas96_shadow")
      .select("*")
      .order("candle_ts", { ascending: false })
      .range(from, from + PAGE - 1);
    if (error) throw error;
    if (!data || data.length === 0) break;
    rows.push(...(data as Record<string, any>[]));
    if (data.length < PAGE) break;
  }
  const predIds = Array.from(new Set(rows.map((r) => r.prediction_id as string).filter(Boolean)));
  const predMap = new Map<string, Record<string, any>>();
  const liveCols = "id, created_at, candle_ts, prediction, confidence, setup_type, status, market_condition, btc_price_at_prediction, actual_next_candle_open, actual_next_candle_close, actual_direction, trend, model_version, agreement_gate_applied, final_trade_status, bullish_score, bearish_score";
  const archCols = "id, created_at, candle_ts, prediction, confidence, setup_type, status, market_condition, btc_price_at_prediction, actual_next_candle_open, actual_next_candle_close, actual_direction, model_version, agreement_gate_applied, final_trade_status, bullish_score, bearish_score";
  for (let i = 0; i < predIds.length; i += 500) {
    const slice = predIds.slice(i, i + 500);
    const [live, arch] = await Promise.all([
      sb.from("predictions").select(liveCols).in("id", slice),
      sb.from("predictions_archive").select(archCols).in("id", slice),
    ]);
    for (const p of ([...(live.data ?? []), ...(arch.data ?? [])] as unknown as Record<string, any>[])) {
      if (!predMap.has(p.id as string)) predMap.set(p.id as string, p);
    }
  }

  return rows.map((r) => {
    const p = predMap.get(r.prediction_id as string) ?? {};
    return {
      id: r.id,
      created_at: r.created_at,
      updated_at: r.updated_at,
      target_candle_ts: r.target_candle_ts,
      input_candle_ts: r.input_candle_ts,
      continuity_delta_seconds: r.continuity_delta_seconds,
      continuity_gate_passed: r.continuity_gate_passed,
      snapshot_minutes_elapsed: r.snapshot_minutes_elapsed,
      snapshot_belongs_to_prior_candle: r.snapshot_belongs_to_prior_candle,
      usable_training_row: r.usable_training_row,
      active_abstain_rule: r.active_abstain_rule,
      last_training_at: r.last_training_at,
      next_retrain_at_count: r.next_retrain_at_count,
      candle_ts: r.candle_ts,
      variant: r.variant,
      status: r.status,
      final_prediction: r.final_prediction,
      selected_layer: r.selected_layer,
      layer_a_base_direction: r.layer_a_base_direction,
      layer_a_final_direction: r.layer_a_final_direction,
      layer_a_prob_l003: r.layer_a_prob_l003,
      layer_a_prob_l010: r.layer_a_prob_l010,
      layer_a_prob_mean: r.layer_a_prob_mean,
      armor_override_fired: r.armor_override_fired,
      armor_override_reason: r.armor_override_reason,
      layer_b_h32_direction: r.layer_b_h32_direction,
      layer_b_h64_direction: r.layer_b_h64_direction,
      layer_b_h96_direction: r.layer_b_h96_direction,
      layer_b_h192_direction: r.layer_b_h192_direction,
      layer_b_h32_score: r.layer_b_h32_score,
      layer_b_h64_score: r.layer_b_h64_score,
      layer_b_h96_score: r.layer_b_h96_score,
      layer_b_h192_score: r.layer_b_h192_score,
      layer_b_horizon_pattern: r.layer_b_horizon_pattern,
      layer_b_final_direction: r.layer_b_final_direction,
      layer_a_last96_net: r.layer_a_last96_net,
      layer_b_last96_net: r.layer_b_last96_net,
      baseline_prediction: r.baseline_prediction,
      baseline_abstain_reason: r.baseline_abstain_reason,
      published_prediction: r.published_prediction,
      published_abstain_reason: r.published_abstain_reason,
      cleanup_veto_v1_version: r.cleanup_veto_v1_version,
      cleanup_veto_v1_evaluable: r.cleanup_veto_v1_evaluable,
      cleanup_veto_v1_fired: r.cleanup_veto_v1_fired,
      cleanup_veto_v1_reason: r.cleanup_veto_v1_reason,
      cleanup_veto_v1_conflict_subtype: r.cleanup_veto_v1_conflict_subtype,
      baseline_would_win: r.baseline_would_win,
      baseline_would_lose: r.baseline_would_lose,
      veto_avoided_loss: r.veto_avoided_loss,
      veto_sacrificed_win: r.veto_sacrificed_win,
      veto_net_effect: r.veto_net_effect,
      selector_pre_override_selected_layer: r.selector_pre_override_selected_layer,
      selector_pre_override_prediction: r.selector_pre_override_prediction,
      selector_b_confirmation_v1_version: r.selector_b_confirmation_v1_version,
      selector_b_confirmation_v1_evaluable: r.selector_b_confirmation_v1_evaluable,
      selector_b_confirmation_v1_triggered: r.selector_b_confirmation_v1_triggered,
      selector_b_confirmation_v1_applied: r.selector_b_confirmation_v1_applied,
      selector_b_confirmation_v1_reason: r.selector_b_confirmation_v1_reason,
      selector_b_confirmation_v1_master_prediction: r.selector_b_confirmation_v1_master_prediction,
      selector_b_confirmation_v1_ema9: r.selector_b_confirmation_v1_ema9,
      selector_b_confirmation_v1_ema21: r.selector_b_confirmation_v1_ema21,
      selector_b_confirmation_v1_btc_price: r.selector_b_confirmation_v1_btc_price,
      selector_b_confirmation_v1_ema_separation: r.selector_b_confirmation_v1_ema_separation,
      selector_b_confirmation_v1_ema_separation_ratio: r.selector_b_confirmation_v1_ema_separation_ratio,
      selector_b_confirmation_v1_threshold: r.selector_b_confirmation_v1_threshold,
      selector_b_confirmation_v1_final_selected_layer: r.selector_b_confirmation_v1_final_selected_layer,
      selector_b_confirmation_v1_final_prediction: r.selector_b_confirmation_v1_final_prediction,
      selector_b_confirmation_v1_would_win: r.selector_b_confirmation_v1_would_win,
      selector_b_confirmation_v1_would_lose: r.selector_b_confirmation_v1_would_lose,
      selector_b_confirmation_v1_net_effect: r.selector_b_confirmation_v1_net_effect,
      eligibility_passed: r.eligibility_passed,
      skip_reason: r.skip_reason,
      shadow_error: r.shadow_error,
      training_row_count: r.training_row_count,
      fit_id: r.fit_id,
      feature_schema_hash: r.feature_schema_hash,
      input_feature_timestamp: r.input_feature_timestamp,
      input_candle_age_seconds: r.input_candle_age_seconds,
      actual_direction: r.actual_direction,
      result: r.result,
      resolved_at: r.resolved_at,
      prediction_id: r.prediction_id,
      prediction_created_at: (p as { created_at?: unknown }).created_at ?? null,
      prediction_yesno: (p as { prediction?: unknown }).prediction ?? null,
      prediction_confidence: (p as { confidence?: unknown }).confidence ?? null,
      setup_type: (p as { setup_type?: unknown }).setup_type ?? null,
      market_condition: (p as { market_condition?: unknown }).market_condition ?? null,
      trend: (p as { trend?: unknown }).trend ?? null,
      btc_price_at_prediction: (p as { btc_price_at_prediction?: unknown }).btc_price_at_prediction ?? null,
      actual_next_candle_open: (p as { actual_next_candle_open?: unknown }).actual_next_candle_open ?? null,
      actual_next_candle_close: (p as { actual_next_candle_close?: unknown }).actual_next_candle_close ?? null,
      prediction_final_status: (p as { status?: unknown }).status ?? null,
      final_trade_status: (p as { final_trade_status?: unknown }).final_trade_status ?? null,
      production_model_version: (p as { model_version?: unknown }).model_version ?? null,
      bullish_score: (p as { bullish_score?: unknown }).bullish_score ?? null,
      bearish_score: (p as { bearish_score?: unknown }).bearish_score ?? null,
    };
  });
});

/** Model 6 predictions CSV — flattens indicators.telemetry_v1 + derives actual_direction from OHLC. */
export const exportModel6Predictions = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const PAGE = 1000;
  const cols =
    "id, created_at, candle_ts, model_version, prediction, confidence, setup_type, status, market_condition, btc_price_at_prediction, actual_next_candle_open, actual_next_candle_close, actual_direction, indicators, final_trade_status, bullish_score, bearish_score, agreement_gate_applied, agreement_gate_reason, resolved_at";
  const collect = async (table: "predictions" | "predictions_archive") => {
    const out: Record<string, any>[] = [];
    for (let from = 0; ; from += PAGE) {
      const { data, error } = await sb
        .from(table)
        .select(cols)
        .like("model_version", "6.%")
        .order("candle_ts", { ascending: false })
        .range(from, from + PAGE - 1);
      if (error) throw error;
      if (!data || data.length === 0) break;
      out.push(...(data as Record<string, any>[]));
      if (data.length < PAGE) break;
    }
    return out;
  };
  const [live, arch] = await Promise.all([collect("predictions"), collect("predictions_archive")]);
  const seen = new Set<string>();
  const rows: Record<string, any>[] = [];
  for (const r of [...live, ...arch]) {
    const id = String(r.id);
    if (seen.has(id)) continue;
    seen.add(id);
    rows.push(r);
  }

  return rows.map((r) => {
    const ind = (r.indicators ?? {}) as Record<string, any>;
    const t = (ind.telemetry_v1 ?? {}) as Record<string, any>;
    const nextOpen = r.actual_next_candle_open;
    const nextClose = r.actual_next_candle_close;
    let derived_actual_direction: string | null = null;
    if (nextOpen != null && nextClose != null) {
      const o = Number(nextOpen), c = Number(nextClose);
      derived_actual_direction = c > o ? "GREEN" : c < o ? "RED" : "DOJI";
    }
    const pred = String(r.prediction ?? "");
    const trendDir = t.trend_direction ?? null;
    const is_trend_continuation =
      trendDir === "UP" ? pred === "YES" : trendDir === "DOWN" ? pred === "NO" : false;
    const is_countertrend_trade =
      trendDir === "UP" ? pred === "NO" : trendDir === "DOWN" ? pred === "YES" : false;

    const trendScore = Number(t.trend_score ?? 0);
    const strScore = Number(t.structure_score ?? 0);
    const continuation_strength = is_trend_continuation ? Math.round(((trendScore + strScore) / 2) * 100) / 100 : 0;
    let reversal_strength = 0;
    if (is_countertrend_trade) {
      const evidence =
        (t.failed_breakout_up || t.failed_breakout_down ? 30 : 0) +
        (t.bullish_liquidity_sweep || t.bearish_liquidity_sweep ? 30 : 0) +
        (strScore * 0.4);
      reversal_strength = Math.max(0, Math.min(100, Math.round(evidence * 100) / 100));
    }

    return {
      id: r.id,
      created_at: r.created_at,
      candle_ts: r.candle_ts,
      model_version: r.model_version,
      prediction: r.prediction,
      confidence: r.confidence,
      setup_type: r.setup_type,
      status: r.status,
      resolved_at: r.resolved_at,
      market_condition: r.market_condition,
      btc_price_at_prediction: r.btc_price_at_prediction,
      final_trade_status: r.final_trade_status,
      agreement_gate_applied: r.agreement_gate_applied,
      agreement_gate_reason: r.agreement_gate_reason,
      bullish_score: r.bullish_score,
      bearish_score: r.bearish_score,
      // Ground truth
      actual_next_open: nextOpen,
      actual_next_close: nextClose,
      actual_direction: derived_actual_direction,   // derived from OHLC (authoritative)
      stored_actual_direction: r.actual_direction,  // legacy, for divergence audits
      // Telemetry v1
      telemetry_version: t.version ?? null,
      channel_low: t.channel_low ?? null,
      channel_high: t.channel_high ?? null,
      channel_width_pct: t.channel_width_pct ?? null,
      channel_position: t.channel_position ?? null,
      channel_position_numeric: t.channel_position_numeric ?? null,
      channel_fib_zone: t.channel_fib_zone ?? null,
      distance_to_upper_channel_pct: t.distance_to_upper_channel_pct ?? null,
      distance_to_lower_channel_pct: t.distance_to_lower_channel_pct ?? null,
      trend_direction: t.trend_direction ?? null,
      trend_strength: t.trend_strength ?? null,
      trend_slope: t.trend_slope ?? null,
      trend_age_candles: t.trend_age_candles ?? null,
      distance_from_fast_ema: t.distance_from_fast_ema ?? null,
      distance_from_slow_ema: t.distance_from_slow_ema ?? null,
      trend_score: t.trend_score ?? null,
      ema_score: t.ema_score ?? null,
      momentum_score: t.momentum_score ?? null,
      volatility_score: t.volatility_score ?? null,
      structure_score: t.structure_score ?? null,
      market_regime_score: t.market_regime_score ?? null,
      ema9: t.ema9 ?? null,
      ema21: t.ema21 ?? null,
      ema50: t.ema50 ?? null,
      atr_14: t.atr_14 ?? null,
      avg_range_20: t.avg_range_20 ?? null,
      close: t.close ?? null,
      volume_expansion: t.volume_expansion ?? null,
      same_color_streak: t.same_color_streak ?? null,
      higher_low_sequence: t.higher_low_sequence ?? null,
      lower_high_sequence: t.lower_high_sequence ?? null,
      failed_breakout_up: t.failed_breakout_up ?? null,
      failed_breakout_down: t.failed_breakout_down ?? null,
      bullish_liquidity_sweep: t.bullish_liquidity_sweep ?? null,
      bearish_liquidity_sweep: t.bearish_liquidity_sweep ?? null,
      // Router diagnostics
      is_trend_continuation,
      is_countertrend_trade,
      continuation_strength,
      reversal_strength,
    };
  });
});



/** a96-r1 stats: totals, wins, losses, abstains, override + agreement veto counts,
 *  active fit episode state. Reads from a96_predictions + a96_fit_state. */
export const getA96Stats = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const PAGE = 1000;
  const c = { total: 0, resolved: 0, wins: 0, losses: 0, pushes: 0, abstains: 0, pending: 0, overrides: 0, agreement_vetoes: 0 };
  for (let from = 0; ; from += PAGE) {
    const { data } = await sb
      .from("a96_predictions")
      .select("resolved_at,result_score,final_prediction,fit_selector_override_fired,agreement_veto_fired,actual_direction")
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    for (const r of data as Array<Record<string, unknown>>) {
      c.total += 1;
      if (r.fit_selector_override_fired) c.overrides += 1;
      if (r.agreement_veto_fired) c.agreement_vetoes += 1;
      if (r.resolved_at) {
        c.resolved += 1;
        if (r.final_prediction === "ABSTAIN") c.abstains += 1;
        else if (r.actual_direction === "PUSH") c.pushes += 1;
        else if (r.result_score === 1) c.wins += 1;
        else if (r.result_score === -1) c.losses += 1;
      } else {
        c.pending += 1;
      }
    }
    if (data.length < PAGE) break;
  }
  const { data: active } = await sb
    .from("a96_fit_state")
    .select("fit_episode_id, artifact_fit_id, comparable_resolved_count, layer_a_wins, layer_a_losses, layer_a_net, layer_b_wins, layer_b_losses, layer_b_net, activated_at")
    .eq("is_active", true).maybeSingle();
  const wl = c.wins + c.losses;
  return {
    ...c,
    win_rate: wl ? Math.round((c.wins / wl) * 10000) / 100 : 0,
    active_episode: active ?? null,
  };
});

export const getA96Pending = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data } = await sb
    .from("a96_predictions")
    .select("target_candle_ts, final_prediction, selected_layer, base_selected_layer, layer_a_direction, layer_b_direction, decision_reason, fit_selector_override_fired, agreement_veto_fired, distance_from_4_candle_low_bps, mean_2_candle_body_to_range, target_open, fit_resolved_count_at_prediction, layer_a_net_at_prediction, layer_b_net_at_prediction, resolved_at")
    .order("target_candle_ts", { ascending: false })
    .limit(1).maybeSingle();
  return data ?? null;
});

/** Full a96_predictions CSV export (joins source prediction OHLC for auditability). */
export const exportA96Csv = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const PAGE = 1000;
  const out: Array<Record<string, any>> = [];
  for (let from = 0; ; from += PAGE) {
    const { data } = await sb
      .from("a96_predictions")
      .select("*")
      .order("target_candle_ts", { ascending: false })
      .range(from, from + PAGE - 1);
    if (!data || data.length === 0) break;
    for (const r of data as Array<Record<string, unknown>>) out.push(r);
    if (data.length < PAGE) break;
  }
  return out;
});
