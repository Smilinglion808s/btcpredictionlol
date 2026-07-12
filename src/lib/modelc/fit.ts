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

// Canonical JSON serialization (Python json.dumps sort_keys=True,
// separators=(',',':') equivalent). Keys sorted lexicographically at every
// level; no whitespace.
function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return "[" + value.map(canonicalJsonStringify).join(",") + "]";
  }
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj).sort();
  return (
    "{" +
    keys
      .map((k) => JSON.stringify(k) + ":" + canonicalJsonStringify(obj[k]))
      .join(",") +
    "}"
  );
}

async function sha256Hex(s: string): Promise<string> {
  const bytes = new TextEncoder().encode(s);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeComponentArtifactSha256(
  component: ModelCComponentFit,
): Promise<string> {
  const { artifact_sha256: _drop, ...rest } = component;
  return sha256Hex(canonicalJsonStringify(rest));
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

export async function verifyBootstrapFit(
  fit: ModelCBootstrapFit = bootstrapFitJson as unknown as ModelCBootstrapFit,
): Promise<ModelCFitVerification> {
  const globalActual = await computeComponentArtifactSha256(fit.global_core_lr);
  const recentActual = await computeComponentArtifactSha256(fit.recent_full_lr);
  const combinedActual = fit.combined_fit_sha256;

  const global_ok = globalActual === fit.global_core_lr.artifact_sha256;
  const recent_ok = recentActual === fit.recent_full_lr.artifact_sha256;
  const combined_ok = combinedActual === MODEL_C_EXPECTED_COMBINED_FIT_SHA256;

  return {
    ok: global_ok && recent_ok && combined_ok,
    global_ok,
    global_expected: fit.global_core_lr.artifact_sha256,
    global_actual: globalActual,
    recent_ok,
    recent_expected: fit.recent_full_lr.artifact_sha256,
    recent_actual: recentActual,
    combined_ok,
    combined_expected: MODEL_C_EXPECTED_COMBINED_FIT_SHA256,
    combined_actual: combinedActual,
  };
}

export function getBootstrapFit(): ModelCBootstrapFit {
  return bootstrapFitJson as unknown as ModelCBootstrapFit;
}
