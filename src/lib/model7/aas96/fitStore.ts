// AAS96 fit store — load/save Layer A dual-lambda fits plus scaler + Layer B history.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Scaler } from "./preprocess";
import type { LogisticFit } from "./logistic";
import type { ExpertHistory } from "./layerB";
import { emptyExpertHistory } from "./layerB";

export interface AAS96Artifact {
  fitId: string;
  trainingRowCount: number;
  featureNames: string[];
  featureSchemaHash: string;
  scaler: Scaler;
  fitL003: LogisticFit;
  fitL010: LogisticFit;
  expertHistory: ExpertHistory;
  fittedAt: string;
}

export async function loadActiveAas96Fit(sb: SupabaseClient): Promise<AAS96Artifact | null> {
  const { data } = await sb
    .from("model7_aas96_fits")
    .select("*")
    .eq("active", true)
    .order("fitted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return {
    fitId: data.fit_id as string,
    trainingRowCount: data.training_row_count as number,
    featureNames: (data.feature_names as string[]) ?? [],
    featureSchemaHash: data.feature_schema_hash as string,
    scaler: data.scaler_json as Scaler,
    fitL003: {
      intercept: Number(data.intercept_l003),
      coef: data.coef_l003 as number[],
      lambda: 0.03,
      iterations: 0,
      finalLoss: 0,
      converged: true,
    },
    fitL010: {
      intercept: Number(data.intercept_l010),
      coef: data.coef_l010 as number[],
      lambda: 0.10,
      iterations: 0,
      finalLoss: 0,
      converged: true,
    },
    expertHistory: (data.layer_b_expert_history_json as ExpertHistory | null) ?? emptyExpertHistory(),
    fittedAt: data.fitted_at as string,
  };
}

export async function saveAas96Fit(
  sb: SupabaseClient,
  artifact: Omit<AAS96Artifact, "fitId" | "fittedAt"> & { fittedAt?: string },
): Promise<string> {
  // Deactivate previous active fits.
  await sb.from("model7_aas96_fits").update({ active: false } as never).eq("active", true);
  const { data, error } = await sb.from("model7_aas96_fits").insert({
    training_row_count: artifact.trainingRowCount,
    feature_names: artifact.featureNames,
    feature_schema_hash: artifact.featureSchemaHash,
    scaler_json: artifact.scaler as unknown,
    categorical_vocab_json: artifact.scaler.categoricals as unknown,
    intercept_l003: artifact.fitL003.intercept,
    intercept_l010: artifact.fitL010.intercept,
    coef_l003: artifact.fitL003.coef,
    coef_l010: artifact.fitL010.coef,
    layer_b_expert_history_json: artifact.expertHistory as unknown,
    active: true,
  } as never).select("fit_id").single();
  if (error) throw error;
  return (data as { fit_id: string }).fit_id;
}

export async function updateActiveExpertHistory(sb: SupabaseClient, history: ExpertHistory): Promise<void> {
  await sb.from("model7_aas96_fits")
    .update({ layer_b_expert_history_json: history as unknown } as never)
    .eq("active", true);
}
