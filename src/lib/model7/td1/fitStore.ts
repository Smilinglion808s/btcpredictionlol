// Load / promote TD1-RC fits.

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Td1Artifact } from "./decision";
import type { TrainResult } from "./trainer";

export async function loadActiveTd1Fit(
  supabase: SupabaseClient,
  baseVariant: string,
  targetBoundaryTs: string,
): Promise<Td1Artifact | null> {
  const { data } = await supabase
    .from("model7_td1_fits")
    .select("fit_id, base_variant, trained_through_candle_ts, feature_order_json, tree_artifact_json, artifact_sha256, promoted_at, active")
    .eq("base_variant", baseVariant)
    .eq("active", true)
    .maybeSingle();
  if (!data) return null;
  // Active fit may score only target boundaries strictly after promoted_at.
  if (data.promoted_at && new Date(data.promoted_at).getTime() >= new Date(targetBoundaryTs).getTime()) {
    return null;
  }
  return {
    schemaVersion: "1.0.0",
    fitId: data.fit_id as string,
    baseVariant: "A2_Combined",
    trainedThroughCandleTs: data.trained_through_candle_ts as string,
    featureOrder: data.feature_order_json as never,
    tree: data.tree_artifact_json as never,
    artifactSha256: data.artifact_sha256 as string,
  };
}

/** Atomically insert new fit and mark active for the given base_variant. */
export async function promoteTd1Fit(
  supabase: SupabaseClient,
  baseVariant: string,
  result: TrainResult,
  trainingRowCount: number,
): Promise<void> {
  // Deactivate current active, then insert new active.
  await supabase.from("model7_td1_fits")
    .update({ active: false })
    .eq("base_variant", baseVariant)
    .eq("active", true);
  const { error } = await supabase.from("model7_td1_fits").insert({
    fit_id: result.artifact.fitId,
    base_variant: baseVariant,
    trained_through_candle_ts: result.artifact.trainedThroughCandleTs,
    promoted_at: new Date().toISOString(),
    training_row_count: trainingRowCount,
    feature_order_json: [...result.artifact.featureOrder],
    tree_artifact_json: result.artifact.tree,
    artifact_sha256: result.artifact.artifactSha256,
    trainer_version: result.trainerVersion,
    active: true,
  } as never);
  if (error) throw new Error(`TD1_PROMOTE_FAILED:${error.message}`);
}
