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

export const listPredictions = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("predictions")
    .select("*")
    .order("created_at", { ascending: false })
    .limit(500);
  if (error) throw error;
  return data ?? [];
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

export const getPredictionStats = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb.rpc("prediction_stats");
  if (error) throw error;
  return (JSON.parse(JSON.stringify(data ?? {})) as JsonValue) as { [k: string]: JsonValue };
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
