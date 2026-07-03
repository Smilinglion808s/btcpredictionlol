import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";

async function admin() {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  return supabaseAdmin;
}

export const listModelArchives = createServerFn({ method: "GET" }).handler(async () => {
  const sb = await admin();
  const { data, error } = await sb
    .from("model_archives")
    .select("*")
    .order("archived_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
});

export const archiveActiveModel = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z.object({ notes: z.string().optional() }).parse(input ?? {})
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: active, error: aerr } = await sb
      .from("model_settings")
      .select("*")
      .eq("is_active", true)
      .limit(1)
      .maybeSingle();
    if (aerr) throw aerr;
    if (!active) throw new Error("No active model to archive");

    const { data: inserted, error } = await sb
      .from("model_archives")
      .insert({
        model_version: active.model_version,
        api_model_id: active.api_model_id,
        prompt_template: active.prompt_template,
        indicator_weights: active.indicator_weights ?? {},
        confidence_threshold: active.confidence_threshold,
        auto_run_enabled: active.auto_run_enabled,
        require_manual_approval: active.require_manual_approval,
        notes: data.notes ?? null,
      } as any)
      .select()
      .single();
    if (error) throw error;
    return inserted;
  });

export const createModelArchive = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        model_version: z.string().min(1),
        api_model_id: z.string().optional().nullable(),
        prompt_template: z.string().min(1),
        indicator_weights: z.record(z.string(), z.number()).optional(),
        confidence_threshold: z.number().optional().nullable(),
        auto_run_enabled: z.boolean().optional().nullable(),
        require_manual_approval: z.boolean().optional().nullable(),
        notes: z.string().optional().nullable(),
      })
      .parse(input)
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    const { data: inserted, error } = await sb
      .from("model_archives")
      .insert({
        model_version: data.model_version,
        api_model_id: data.api_model_id ?? null,
        prompt_template: data.prompt_template,
        indicator_weights: data.indicator_weights ?? {},
        confidence_threshold: data.confidence_threshold ?? null,
        auto_run_enabled: data.auto_run_enabled ?? null,
        require_manual_approval: data.require_manual_approval ?? null,
        notes: data.notes ?? null,
      } as any)
      .select()
      .single();
    if (error) throw error;
    return inserted;
  });

export const updateModelArchive = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) =>
    z
      .object({
        id: z.string().uuid(),
        model_version: z.string().min(1),
        api_model_id: z.string().optional().nullable(),
        prompt_template: z.string().min(1),
        notes: z.string().optional().nullable(),
      })
      .parse(input)
  )
  .handler(async ({ data }) => {
    const sb = await admin();
    const { error } = await sb
      .from("model_archives")
      .update({
        model_version: data.model_version,
        api_model_id: data.api_model_id ?? null,
        prompt_template: data.prompt_template,
        notes: data.notes ?? null,
      } as any)
      .eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });

export const deleteModelArchive = createServerFn({ method: "POST" })
  .inputValidator((input: unknown) => z.object({ id: z.string().uuid() }).parse(input))
  .handler(async ({ data }) => {
    const sb = await admin();
    const { error } = await sb.from("model_archives").delete().eq("id", data.id);
    if (error) throw error;
    return { ok: true };
  });
