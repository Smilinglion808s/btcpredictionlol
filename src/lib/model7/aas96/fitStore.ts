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

export interface LayerBHistoryEpisode {
  historyEpisodeId: string;
  artifactFitId: string;
  isActive: boolean;
  resolvedCount: number;
  historyPayload: ExpertHistory;
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
  const fitId = (data as { fit_id: string }).fit_id;
  // Seed the Layer B history episode for this fit with the trained history.
  try {
    await ensureLayerBEpisodeSeeded(sb, fitId, artifact.expertHistory);
  } catch { /* non-fatal */ }
  return fitId;
}

/** Get or mint the Layer B history episode for a specific artifact fit id. */
export async function getOrMintLayerBEpisode(
  sb: SupabaseClient,
  artifactFitId: string,
): Promise<LayerBHistoryEpisode | null> {
  const { data, error } = await sb.rpc("get_or_mint_aas96_layer_b_episode", {
    p_artifact_fit_id: artifactFitId,
  });
  if (error || !data) return null;
  const rows = data as Array<{
    history_episode_id: string;
    artifact_fit_id: string;
    is_active: boolean;
    resolved_count: number;
    history_payload: ExpertHistory | null;
  }>;
  const row = Array.isArray(rows) ? rows[0] : rows;
  if (!row) return null;
  return {
    historyEpisodeId: row.history_episode_id,
    artifactFitId: row.artifact_fit_id,
    isActive: row.is_active,
    resolvedCount: row.resolved_count,
    historyPayload: (row.history_payload && Object.keys(row.history_payload).length > 0)
      ? row.history_payload
      : emptyExpertHistory(),
  };
}

/** After first minting, if payload is empty, seed with trained history. */
async function ensureLayerBEpisodeSeeded(
  sb: SupabaseClient,
  artifactFitId: string,
  seed: ExpertHistory,
): Promise<void> {
  const ep = await getOrMintLayerBEpisode(sb, artifactFitId);
  if (!ep) return;
  const isEmpty = Object.keys(ep.historyPayload ?? {}).length === 0;
  if (isEmpty) {
    await sb
      .from("model7_aas96_layer_b_history_episodes")
      .update({ history_payload: seed as unknown, updated_at: new Date().toISOString() } as never)
      .eq("history_episode_id", ep.historyEpisodeId);
  }
}

/** Fetch an episode by id (for resolution path). */
export async function loadLayerBEpisodeById(
  sb: SupabaseClient,
  historyEpisodeId: string,
): Promise<LayerBHistoryEpisode | null> {
  const { data } = await sb
    .from("model7_aas96_layer_b_history_episodes")
    .select("history_episode_id, artifact_fit_id, is_active, resolved_count, history_payload")
    .eq("history_episode_id", historyEpisodeId)
    .maybeSingle();
  if (!data) return null;
  return {
    historyEpisodeId: data.history_episode_id as string,
    artifactFitId: data.artifact_fit_id as string,
    isActive: data.is_active as boolean,
    resolvedCount: data.resolved_count as number,
    historyPayload: (data.history_payload as ExpertHistory | null) ?? emptyExpertHistory(),
  };
}

/** Idempotently apply an outcome to the prediction's owning episode. */
export async function applyLayerBHistory(
  sb: SupabaseClient,
  predictionId: string,
  historyEpisodeId: string,
  actual: "GREEN" | "RED",
  newHistoryPayload: ExpertHistory,
): Promise<{ ok: boolean; idempotent?: boolean; error?: string }> {
  const { data, error } = await sb.rpc("apply_aas96_layer_b_history", {
    p_prediction_id: predictionId,
    p_history_episode_id: historyEpisodeId,
    p_actual_direction: actual,
    p_new_history_payload: newHistoryPayload as unknown,
  });
  if (error) return { ok: false, error: error.message };
  const r = data as { ok: boolean; idempotent?: boolean } | null;
  return { ok: !!r?.ok, idempotent: r?.idempotent };
}

/**
 * Legacy helper — retained for back-compat but should NOT be used for
 * per-prediction history updates. Episode-based updates are the correct path.
 * Kept only so callers importing the symbol keep compiling.
 */
export async function updateActiveExpertHistory(_sb: SupabaseClient, _history: ExpertHistory): Promise<void> {
  // Intentional no-op: history now lives on per-fit episodes.
}
