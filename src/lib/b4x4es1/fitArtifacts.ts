// Frozen ES1 price-head fit artifacts.
//
// Every rolling fit through the reconciled checkpoint is generated once with
// scikit-learn (LogisticRegression C=0.01, lbfgs, RobustScaler(10,90),
// day-balanced weights) and persisted here with its exact training window
// fingerprint. TypeScript only performs inference from these artifacts, so a
// live row and the approved research row are bit-identical.
//
// An artifact is used only when the recomputed training window fingerprint
// matches exactly. Blocks with no matching artifact fall back to the in-repo
// IRLS solver and are tagged `irls-fallback`.

import { createHash } from "crypto";
import { ES1_PRICE_SPEC, ES1_SCALER, ES1_LOGISTIC_C, es1FeatureSchemaHash, sha256 } from "./config";
import { trainEs1Fit, type Es1Fit, type TrainingRow } from "./priceHead";
import frozenFits from "./frozen-fits.json";

export interface FrozenFitArtifact {
  boundary: number;
  trainingRowCount: number;
  trainingStartTs: string;
  trainingEndTs: string;
  trainingStartIndex: number;
  trainingEndIndex: number;
  windowFingerprint: string;
  center: number[];
  scale: number[];
  coefficients: number[];
  intercept: number;
}

const ARTIFACTS = new Map<number, FrozenFitArtifact>(
  (frozenFits as { fits: FrozenFitArtifact[] }).fits.map((f) => [f.boundary, f]),
);

/** Deterministic fingerprint of an exact training window. */
export function trainingWindowFingerprint(rows: readonly TrainingRow[]): string {
  const h = createHash("sha256");
  for (const r of rows) {
    h.update(r.targetTs);
    h.update("|");
    h.update(String(r.index));
    h.update("|");
    h.update(String(r.label));
    h.update("|");
    h.update(r.vector.map((v) => v.toFixed(12)).join(","));
    h.update(";");
  }
  return h.digest("hex");
}

function fitFromArtifact(a: FrozenFitArtifact): Es1Fit {
  const artifact = {
    specification: ES1_PRICE_SPEC,
    scaler: ES1_SCALER,
    source: "sklearn-frozen",
    center: a.center,
    scale: a.scale,
    coefficients: a.coefficients,
    intercept: a.intercept,
    training_start_ts: a.trainingStartTs,
    training_end_ts: a.trainingEndTs,
    training_row_count: a.trainingRowCount,
    block_index: a.boundary,
    window_fingerprint: a.windowFingerprint,
  };
  const artifactSha256 = sha256(artifact);
  return {
    fitId: `es1-fit-${String(a.boundary).padStart(5, "0")}-${artifactSha256.slice(0, 12)}`,
    artifactSha256,
    featureSchemaHash: es1FeatureSchemaHash(),
    specification: ES1_PRICE_SPEC,
    scalerName: ES1_SCALER,
    scaler: { center: a.center, scale: a.scale },
    coefficients: a.coefficients,
    intercept: a.intercept,
    trainingRowCount: a.trainingRowCount,
    trainingStartTs: a.trainingStartTs,
    trainingEndTs: a.trainingEndTs,
    trainingStartIndex: a.trainingStartIndex,
    trainingEndIndex: a.trainingEndIndex,
    blockIndex: a.boundary,
    solver: "sklearn-lbfgs-frozen",
    converged: true,
    iterations: 0,
    gradientNorm: 0,
    C: ES1_LOGISTIC_C,
    fitSource: "sklearn-frozen",
  };
}

/**
 * Resolve the fit for one block boundary: frozen sklearn artifact when the
 * training window matches byte-for-byte, IRLS fallback otherwise.
 */
export function resolveEs1Fit(rows: readonly TrainingRow[], boundary: number): Es1Fit | null {
  const artifact = ARTIFACTS.get(boundary);
  if (artifact && rows.length === artifact.trainingRowCount) {
    if (trainingWindowFingerprint(rows) === artifact.windowFingerprint) {
      return fitFromArtifact(artifact);
    }
  }
  const trained = trainEs1Fit(rows, boundary);
  if (!trained) return null;
  return { ...trained, fitSource: "irls-fallback" };
}

export function frozenFitCount(): number {
  return ARTIFACTS.size;
}
