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
  const out: Record<"A" | "B" | "combined", ReturnType<typeof blank>> = {
    A: blank(), B: blank(), combined: blank(),
  };

  for (const r of rows as Array<{ variant: string; status: string; would_trade: boolean | null }>) {
    if (!r.would_trade) continue; // only rows the model would actually trade
    const buckets: Array<"A" | "B" | "combined"> = [];
    if (r.variant === "A" || r.variant === "B") buckets.push(r.variant, "combined");
    else buckets.push("combined");
    for (const k of buckets) {
      const b = out[k];
      b.total += 1;
      if (r.status === "win") b.wins += 1;
      else if (r.status === "loss") b.losses += 1;
      else if (r.status === "push") b.pushes += 1;
      else if (r.status === "pending") b.pending += 1;
    }
  }
  for (const k of ["A", "B", "combined"] as const) {
    const b = out[k];
    const decided = b.wins + b.losses;
    b.win_rate = decided === 0 ? 0 : Math.round((b.wins / decided) * 10000) / 100;
  }
  return out;
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
