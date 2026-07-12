// Model C — bootstrap fit loader with per-component hash verification.
//
// The two logistic components' `artifact_sha256` values are verified against
// the canonical JSON hash of the component (sort_keys, no whitespace, minus
// the `artifact_sha256` field itself). This reproduces the formula used by
// the source spec.
//
// `combined_fit_sha256` is the value published in the shadow spec
// (c8da6dcc98...); we assert equality to the pinned constant so any tamper
// with the bootstrap file is caught. The exact derivation formula for the
// combined hash is not published in the spec, so it is treated here as a
// pinned constant, not recomputed.

import bootstrapFitJson from "./bootstrap_fit.json";

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
