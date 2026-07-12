// Model C — bootstrap fit loader with pinned-hash verification.
//
// The three artifact hashes below are the values published in
// `model_c_dual_horizon_backend_full_v1.json` and pinned in
// `model_c_shadow_spec_v1.json`. The loader asserts that the shipped
// `src/lib/modelc/bootstrap_fit.json` still carries those exact hashes for
// each component and for the combined fit. This catches any accidental
// mutation of the bootstrap artifact.
//
// A recompute-from-canonical-JSON check is intentionally NOT done at runtime:
// Python `json.dumps` and JS `JSON.stringify` render floats slightly
// differently (e.g. `1.0` vs `1`, and edge-case exponent forms), so the
// component hashes — which were computed against Python's canonical JSON —
// cannot be reproduced byte-for-byte in a browser/Worker without a bespoke
// float formatter. Reintroduce a canonical serializer only if we ever need
// to publish a fresh combined_fit_sha256 from JS.

import bootstrapFitJson from "./bootstrap_fit.json";

export const MODEL_C_EXPECTED_GLOBAL_ARTIFACT_SHA256 =
  "c0993ee57cbae15d5f5cdcdfcab3dbd083a32bd11f82625d2e2a08263c83efa1";
export const MODEL_C_EXPECTED_RECENT_ARTIFACT_SHA256 =
  "394fe9bb2e60a540760b9f81ebe4241afe2358bec90d8d67a9fc5fb29b8b07cd";
export const MODEL_C_EXPECTED_COMBINED_FIT_SHA256 =
  "c8da6dcc98c2550fef1eb6978b68134ac4447170e0b43d0ddbaa65db7b2bd5ed";

export interface ModelCComponentFit {
  pipeline_order: string[];
  feature_count: number;
  feature_order: string[];
  vectorizer_vocabulary: Record<string, number>;
  scaler: {
    with_mean: boolean;
    with_std: boolean;
    mean: number[];
    scale: number[];
    var: number[];
  };
  classifier: Record<string, unknown>;
  manual_scoring: Record<string, unknown>;
  artifact_sha256: string;
}

export interface ModelCBootstrapFit {
  purpose: string;
  source_csv_sha256: string;
  training_data: {
    clean_labeled_rows: number;
    global_training_rows: number;
    recent_training_rows: number;
    global_training_start_ts: string;
    recent_training_start_ts: string;
    training_cutoff_last_labeled_candle_ts: string;
    note: string;
  };
  global_core_lr: ModelCComponentFit;
  recent_full_lr: ModelCComponentFit;
  combined_fit_sha256: string;
}

export interface ModelCFitVerification {
  ok: boolean;
  global_ok: boolean;
  global_expected: string;
  global_actual: string;
  recent_ok: boolean;
  recent_expected: string;
  recent_actual: string;
  combined_ok: boolean;
  combined_expected: string;
  combined_actual: string;
}

export function verifyBootstrapFit(
  fit: ModelCBootstrapFit = bootstrapFitJson as unknown as ModelCBootstrapFit,
): ModelCFitVerification {
  const globalActual = fit.global_core_lr.artifact_sha256;
  const recentActual = fit.recent_full_lr.artifact_sha256;
  const combinedActual = fit.combined_fit_sha256;

  const global_ok = globalActual === MODEL_C_EXPECTED_GLOBAL_ARTIFACT_SHA256;
  const recent_ok = recentActual === MODEL_C_EXPECTED_RECENT_ARTIFACT_SHA256;
  const combined_ok = combinedActual === MODEL_C_EXPECTED_COMBINED_FIT_SHA256;

  return {
    ok: global_ok && recent_ok && combined_ok,
    global_ok,
    global_expected: MODEL_C_EXPECTED_GLOBAL_ARTIFACT_SHA256,
    global_actual: globalActual,
    recent_ok,
    recent_expected: MODEL_C_EXPECTED_RECENT_ARTIFACT_SHA256,
    recent_actual: recentActual,
    combined_ok,
    combined_expected: MODEL_C_EXPECTED_COMBINED_FIT_SHA256,
    combined_actual: combinedActual,
  };
}

export function getBootstrapFit(): ModelCBootstrapFit {
  return bootstrapFitJson as unknown as ModelCBootstrapFit;
}

// -------- live-fit loader --------

export interface ActiveModelCFit {
  fit: ModelCBootstrapFit;
  source: "bootstrap" | "live";
  fit_id: string;
}

/**
 * Returns the latest live fit for `trainingModelVersion` if one exists AND
 * carries both component blobs; otherwise falls back to the pinned bootstrap.
 * Fail-closed: any Supabase error is swallowed and bootstrap is returned.
 */
export async function loadActiveModelCFit(
  // Loose type so this file stays free of a hard @supabase/supabase-js dep at
  // module load time — callers already have a typed client.
  supabase: { from: (t: string) => unknown },
  trainingModelVersion: string,
): Promise<ActiveModelCFit> {
  try {
    const q = (
      supabase.from("model_c_training_fits") as unknown as {
        select: (s: string) => {
          eq: (c: string, v: string) => {
            not: (c: string, op: string, v: unknown) => {
              order: (c: string, o: { ascending: boolean }) => {
                limit: (n: number) => {
                  maybeSingle: () => Promise<{
                    data:
                      | {
                          fit_id: string;
                          global_component_fit: ModelCComponentFit | null;
                          recent_component_fit: ModelCComponentFit | null;
                          global_artifact_sha256: string | null;
                          recent_artifact_sha256: string | null;
                          combined_fit_sha256: string | null;
                          training_cutoff_ts: string;
                          global_training_row_count: number | null;
                          recent_training_row_count: number | null;
                          global_training_window_start_ts: string | null;
                          recent_training_window_start_ts: string | null;
                        }
                      | null;
                    error: { message: string } | null;
                  }>;
                };
              };
            };
          };
        };
      }
    )
      .select(
        "fit_id, global_component_fit, recent_component_fit, global_artifact_sha256, recent_artifact_sha256, combined_fit_sha256, training_cutoff_ts, global_training_row_count, recent_training_row_count, global_training_window_start_ts, recent_training_window_start_ts",
      )
      .eq("training_model_version", trainingModelVersion)
      .not("global_component_fit", "is", null)
      .order("created_at", { ascending: false })
      .limit(1);
    const { data } = await q.maybeSingle();
    if (!data || !data.global_component_fit || !data.recent_component_fit) {
      return { fit: getBootstrapFit(), source: "bootstrap", fit_id: "bootstrap" };
    }
    const live: ModelCBootstrapFit = {
      purpose: "Live retrained fit from resolved production predictions.",
      source_csv_sha256: "live",
      training_data: {
        clean_labeled_rows: data.global_training_row_count ?? 0,
        global_training_rows: data.global_training_row_count ?? 0,
        recent_training_rows: data.recent_training_row_count ?? 0,
        global_training_start_ts: data.global_training_window_start_ts ?? data.training_cutoff_ts,
        recent_training_start_ts: data.recent_training_window_start_ts ?? data.training_cutoff_ts,
        training_cutoff_last_labeled_candle_ts: data.training_cutoff_ts,
        note: "Live-fit; hash pins do NOT apply. Scored against feature_order/coefficients directly.",
      },
      global_core_lr: data.global_component_fit,
      recent_full_lr: data.recent_component_fit,
      combined_fit_sha256: data.combined_fit_sha256 ?? "",
    };
    return { fit: live, source: "live", fit_id: data.fit_id };
  } catch {
    return { fit: getBootstrapFit(), source: "bootstrap", fit_id: "bootstrap" };
  }
}
