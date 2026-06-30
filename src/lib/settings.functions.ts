import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const getActiveSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("model_settings")
      .select("*")
      .eq("is_active", true)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (error) throw error;
    return data;
  });

export const listAllSettings = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("model_settings")
      .select("*")
      .order("updated_at", { ascending: false });
    if (error) throw error;
    return data ?? [];
  });

const updateSchema = z.object({
  id: z.string().uuid(),
  model_version: z.string().min(1),
  confidence_threshold: z.number().min(0).max(100),
  auto_run_enabled: z.boolean(),
  require_manual_approval: z.boolean(),
  indicator_weights: z.record(z.string(), z.number()),
  prompt_template: z.string().min(1),
  is_active: z.boolean(),
});

export const updateSettings = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) => updateSchema.parse(input))
  .handler(async ({ context, data }) => {
    if (data.is_active) {
      await context.supabase.from("model_settings").update({ is_active: false }).neq("id", data.id);
    }
    const { error } = await context.supabase
      .from("model_settings")
      .update({
        model_version: data.model_version,
        confidence_threshold: data.confidence_threshold,
        auto_run_enabled: data.auto_run_enabled,
        require_manual_approval: data.require_manual_approval,
        indicator_weights: data.indicator_weights,
        prompt_template: data.prompt_template,
        is_active: data.is_active,
      })
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const toggleAutoRun = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .inputValidator((input: unknown) =>
    z.object({ enabled: z.boolean() }).parse(input),
  )
  .handler(async ({ context, data }) => {
    const { data: active } = await context.supabase
      .from("model_settings")
      .select("id")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (!active) throw new Error("No active model settings");
    const { error } = await context.supabase
      .from("model_settings")
      .update({ auto_run_enabled: data.enabled })
      .eq("id", active.id);
    if (error) throw error;
    return { ok: true };
  });
