import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { runAiPredictionServer, resolvePredictionsServer } from "./prediction.server";
import { fetchAndUpsertOkxCandles } from "./okx.server";

export const runAiPrediction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => runAiPredictionServer(context.supabase));

export const resolvePredictions = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => resolvePredictionsServer(context.supabase));

/** Full manual cycle: fetch -> resolve -> run AI. */
export const runFullCycle = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    await fetchAndUpsertOkxCandles(context.supabase);
    const resolved = await resolvePredictionsServer(context.supabase);
    const prediction = await runAiPredictionServer(context.supabase);
    return { resolved, prediction };
  });

export const listPredictions = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("predictions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(500);
    if (error) throw error;
    return data ?? [];
  });

export const getLatestPrediction = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("predictions")
      .select("*")
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  });

type JsonValue = string | number | boolean | null | JsonValue[] | { [k: string]: JsonValue };

export const getPredictionStats = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase.rpc("prediction_stats");
    if (error) throw error;
    return (JSON.parse(JSON.stringify(data ?? {})) as JsonValue) as { [k: string]: JsonValue };
  });

const overrideSchema = z.object({
  id: z.string().uuid(),
  status: z.enum(["pending", "win", "loss", "push", "manual_review"]),
  notes: z.string().optional().nullable(),
});

export const overridePrediction = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => overrideSchema.parse(input))
  .handler(async ({ context, data }) => {
    const { error } = await context.supabase
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
