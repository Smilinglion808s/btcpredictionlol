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
  const { data, error } = await sb
    .from("model7_shadow")
    .select("variant, status, would_trade")
    .limit(50000);
  if (error) throw error;
  const rows = data ?? [];

  const blank = () => ({ total: 0, wins: 0, losses: 0, pushes: 0, pending: 0, win_rate: 0 });
  const out: Record<"A" | "B", ReturnType<typeof blank>> = { A: blank(), B: blank() };

  for (const r of rows as Array<{ variant: string; status: string; would_trade: boolean | null }>) {
    if (!r.would_trade) continue;
    if (r.variant !== "A" && r.variant !== "B") continue;
    const b = out[r.variant];
    b.total += 1;
    if (r.status === "win") b.wins += 1;
    else if (r.status === "loss") b.losses += 1;
    else if (r.status === "push") b.pushes += 1;
    else if (r.status === "pending") b.pending += 1;
  }
  for (const k of ["A", "B"] as const) {
    const b = out[k];
    const decided = b.wins + b.losses;
    b.win_rate = decided === 0 ? 0 : Math.round((b.wins / decided) * 10000) / 100;
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
    .limit(10);
  if (error) throw error;
  const rows = (data ?? []) as Array<{
    variant: string; candle_ts: string; probability_green: number | null;
    decision: string | null; would_trade: boolean | null; status: string;
  }>;
  if (rows.length === 0) return { candle_ts: null, A: null, B: null };
  const latestTs = rows[0].candle_ts;
  const forLatest = rows.filter((r) => r.candle_ts === latestTs);
  const pick = (v: "A" | "B") => forLatest.find((r) => r.variant === v) ?? null;
  return { candle_ts: latestTs, A: pick("A"), B: pick("B") };
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
