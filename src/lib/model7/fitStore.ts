// Loads the frozen v1.1 model as a ModelFit, and provides a Variant B fit
// loader (latest fit from public.model7_training_fits).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ModelFit } from "./scorer";
import { FROZEN_MODEL_FIT_ID } from "./config";
// Bundled at build time — small enough (~2300 lines of JSON).
import frozen from "./frozen_v1_1.json" with { type: "json" };

let cachedFrozen: ModelFit | null = null;

export function loadFrozenModel(): ModelFit {
  if (cachedFrozen) return cachedFrozen;
  const m = (frozen as unknown as {
    model: {
      feature_order: string[];
      feature_means: number[];
      feature_scales: number[];
      coefficients: number[];
      intercept: number;
    };
  }).model;

  // Derive categorical vocab from feature_order: any "<col>=<val>" key.
  const vocab: Record<string, string[]> = {};
  for (const name of m.feature_order) {
    const idx = name.indexOf("=");
    if (idx < 0) continue;
    const col = name.slice(0, idx);
    const val = name.slice(idx + 1);
    (vocab[col] ||= []).push(val);
  }

  cachedFrozen = {
    model_fit_id: FROZEN_MODEL_FIT_ID,
    feature_order: m.feature_order,
    feature_means: m.feature_means,
    feature_scales: m.feature_scales,
    coefficients: m.coefficients,
    intercept: m.intercept,
    categorical_vocab: vocab,
  };
  return cachedFrozen;
}

export async function loadLatestVariantBFit(
  supabase: SupabaseClient,
  trainingModelVersion: string,
): Promise<ModelFit | null> {
  const { data, error } = await supabase
    .from("model7_training_fits")
    .select("*")
    .eq("variant", "B")
    .eq("training_model_version", trainingModelVersion)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return {
    model_fit_id: data.model_fit_id as string,
    feature_order: data.feature_order as string[],
    feature_means: data.feature_means as number[],
    feature_scales: data.feature_scales as number[],
    coefficients: data.coefficients as number[],
    intercept: Number(data.intercept),
    categorical_vocab: (data.categorical_vocab as Record<string, string[]>) ?? {},
  };
}
