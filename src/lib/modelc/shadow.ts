// Model C — Dual Horizon Net-Win Ensemble (SHADOW skeleton).
//
// This is the WIRING SKELETON only. It provisions the pipeline so a row lands
// in public.model_c_shadow for every production prediction. Featurization,
// dual-component scoring, blending, override registry, and retraining will be
// added in follow-up passes.
//
// Isolation policy (identical to Model 7 shadow): every call is wrapped in
// try/catch and NEVER blocks the production insert or resolver loop.

import type { SupabaseClient } from "@supabase/supabase-js";

const TF_MS = 15 * 60 * 1000;
const SCORE_NOT_BEFORE_DELAY_MS = 1500;

export const MODEL_C_MODEL_ID = "model_c_dual_horizon_v1";
export const MODEL_C_DECISION_POLICY_VERSION =
  "model-c-v1-global50-recent50-cutoff052-hardno3";

export interface ModelCPredictionRow {
  id: string;
  candle_ts: string;
  created_at?: string | null;
  model_version?: string | null;
}

/**
 * Fire-and-forget from the production engine. Always resolves; never throws.
 * Inserts a single skeleton row per prediction so downstream tooling
 * (UI cards, exports, nightly audits) can begin wiring against real rows.
 */
export async function runModelCShadowForPrediction(
  supabase: SupabaseClient,
  predictionRow: ModelCPredictionRow,
): Promise<void> {
  try {
    const targetMs = new Date(predictionRow.candle_ts).getTime();
    const boundaryIso = new Date(targetMs).toISOString();
    const featureCutoffIso = new Date(targetMs - 1).toISOString();

    const createdAtIso = predictionRow.created_at ?? null;
    const createdAtMs = createdAtIso ? new Date(createdAtIso).getTime() : NaN;
    const predictionRowLeadMs = Number.isFinite(createdAtMs)
      ? targetMs - createdAtMs
      : null;

    await supabase.from("model_c_shadow").insert({
      prediction_id: predictionRow.id,
      candle_ts: predictionRow.candle_ts,
      target_boundary_ts: boundaryIso,
      feature_cutoff_ts: featureCutoffIso,
      prediction_row_created_at: createdAtIso,
      prediction_row_lead_ms: predictionRowLeadMs,
      production_model_version: predictionRow.model_version ?? null,
      status: "warming_up",
      timing_status: "warming_up",
      leakage_check_passed: null,
      fit_id: "skeleton_no_fit",
      shadow_error:
        "skeleton_wiring_only: featurization + dual-horizon scoring not yet implemented",
      override_reasons_json: [
        { id: "upstream_no_clear_edge", fired: false, applied: false, note: "removed per registry" },
        { id: "trending_expansion", fired: false, applied: false, note: "not evaluated (skeleton)" },
        { id: "failed_breakout_down", fired: false, applied: false, note: "not evaluated (skeleton)" },
      ],
    } as never);
    // Reference to keep TF_MS/delay constants live for the follow-up scorer.
    void TF_MS; void SCORE_NOT_BEFORE_DELAY_MS;
  } catch (e) {
    try {
      await supabase.from("api_runs").insert({
        run_type: "model_c_shadow_error",
        response_payload: {
          error: e instanceof Error ? e.message : String(e),
          prediction_id: predictionRow.id,
        },
        success: false,
        error_message: e instanceof Error ? e.message : String(e),
      });
    } catch { /* ignore */ }
  }
}

/**
 * Resolve Model C shadow rows for a prediction once actual_direction is known.
 * Skeleton: marks the row resolved so audits can see coverage; scoring
 * comparisons come once the scorer is wired.
 */
export async function resolveModelCShadowRowsFor(
  supabase: SupabaseClient,
  predictionId: string,
  actualDirection: "GREEN" | "RED" | "DOJI" | null,
): Promise<void> {
  if (!actualDirection || (actualDirection !== "GREEN" && actualDirection !== "RED")) return;
  try {
    await supabase
      .from("model_c_shadow")
      .update({
        actual_direction: actualDirection,
        resolved_at: new Date().toISOString(),
      } as never)
      .eq("prediction_id", predictionId)
      .is("actual_direction", null);
  } catch { /* never block resolver */ }
}
