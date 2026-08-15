// ES1 price-head fit artifacts and their certification.
//
// Provenance, in strict resolution order:
//
//   1. sklearn-frozen      — bundled immutable JSON artifact produced offline by
//                            the sklearn oracle. Used only when the recomputed
//                            training-window fingerprint matches exactly.
//   2. ts-lbfgs-certified  — artifact minted by the pinned TypeScript L-BFGS
//                            fitter (`certifiedFit.ts` + `lbfgs.ts`), which
//                            reproduces the oracle's numerical path. Either
//                            replayed from a previously persisted mint whose
//                            window fingerprint matches, or minted here.
//   3. irls-shadow         — legacy Newton/IRLS solve. Always computed as a
//                            shadow, NEVER certified, NEVER publishable.
//
// Only 1 and 2 are certified; an uncertified fit makes the decision engine
// abstain with ABSTAIN_ES1_CERTIFIED_ARTIFACT_NOT_READY and suppresses the
// webhook.
//
// The bundled JSON is authoritative: a persisted mint can never override a
// boundary that has a frozen artifact, and no runtime path writes to the JSON.

import { createHash } from "crypto";
import {
  ES1_PRICE_SPEC,
  ES1_SCALER,
  ES1_LOGISTIC_C,
  ES1_MODEL_VERSION,
  es1FeatureSchemaHash,
  sha256,
} from "./config";
import { trainEs1Fit, type Es1Fit, type Es1FitSource, type TrainingRow } from "./priceHead";
import { CERTIFIED_FITTER_CODE_HASH } from "./certifiedFit";
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

/** A previously minted, persisted artifact (from `b4x4_es1_fits`). */
export interface MintedFitArtifact extends FrozenFitArtifact {
  modelVersion: string;
  featureSchemaHash: string;
  fitSource: Es1FitSource;
  artifactSha256: string;
}

const ARTIFACTS = new Map<number, FrozenFitArtifact>(
  (frozenFits as { fits: FrozenFitArtifact[] }).fits.map((f) => [f.boundary, f]),
);

/** Composite artifact identity: model version + feature schema + boundary. */
export function es1ArtifactKey(boundary: number): string {
  return `${ES1_MODEL_VERSION}|${es1FeatureSchemaHash()}|${boundary}`;
}

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

/**
 * Canonical payload hash of a fit artifact: only the numbers that change
 * inference, plus the identity triple and the window fingerprint. Solver
 * telemetry (iterations, timing) is deliberately excluded so an identical fit
 * always hashes identically regardless of how it was produced.
 */
export function canonicalArtifactHash(a: {
  boundary: number;
  windowFingerprint: string;
  center: readonly number[];
  scale: readonly number[];
  coefficients: readonly number[];
  intercept: number;
}): string {
  return sha256({
    model_version: ES1_MODEL_VERSION,
    feature_schema_hash: es1FeatureSchemaHash(),
    specification: ES1_PRICE_SPEC,
    scaler: ES1_SCALER,
    C: ES1_LOGISTIC_C,
    boundary: a.boundary,
    window_fingerprint: a.windowFingerprint,
    center: [...a.center],
    scale: [...a.scale],
    coefficients: [...a.coefficients],
    intercept: a.intercept,
  });
}

function fitFromArtifact(a: FrozenFitArtifact, source: Es1FitSource): Es1Fit {
  const artifactSha256 = canonicalArtifactHash(a);
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
    solver: source === "sklearn-frozen" ? "sklearn-lbfgs-frozen" : "ts-lbfgs",
    converged: true,
    iterations: 0,
    gradientNorm: 0,
    C: ES1_LOGISTIC_C,
    fitSource: source,
    priceFitCertified: true,
    windowFingerprint: a.windowFingerprint,
  };
}

export interface ResolveOptions {
  /** Persisted mints keyed by boundary, loaded from `b4x4_es1_fits`. */
  mintedArtifacts?: ReadonlyMap<number, MintedFitArtifact>;
}

export interface ResolvedEs1Fit {
  /** The fit the engine should use (certified or not — the engine gates). */
  fit: Es1Fit;
  source: Es1FitSource;
  certified: boolean;
  windowFingerprint: string;
  /** IRLS shadow solve of the same window, for diagnostics only. */
  shadow: Es1Fit | null;
  /** Freshly minted this call (caller should persist it). */
  minted: boolean;
  certifiedFitterCodeHash: string;
}

/** Resolve the fit for one block boundary. Returns null when untrainable. */
export function resolveEs1FitDetailed(
  rows: readonly TrainingRow[],
  boundary: number,
  opts: ResolveOptions = {},
): ResolvedEs1Fit | null {
  if (rows.length === 0) return null;
  const fingerprint = trainingWindowFingerprint(rows);
  // The IRLS shadow is diagnostics-only and expensive. It is computed lazily so
  // a boundary that resolves to a certified artifact never pays for it.
  let shadowCache: Es1Fit | null | undefined;
  const shadowFit = (): Es1Fit | null => {
    if (shadowCache !== undefined) return shadowCache;
    const raw = trainEs1Fit(rows, boundary, "irls");
    shadowCache = raw
      ? {
          ...raw,
          fitSource: "irls-shadow" as const,
          priceFitCertified: false,
          windowFingerprint: fingerprint,
        }
      : null;
    return shadowCache;
  };


  // 1. bundled sklearn artifact (JSON is authoritative)
  const frozen = ARTIFACTS.get(boundary);
  if (
    frozen &&
    rows.length === frozen.trainingRowCount &&
    fingerprint === frozen.windowFingerprint
  ) {
    return {
      fit: fitFromArtifact(frozen, "sklearn-frozen"),
      source: "sklearn-frozen",
      certified: true,
      windowFingerprint: fingerprint,
      shadow,
      minted: false,
      certifiedFitterCodeHash: CERTIFIED_FITTER_CODE_HASH,
    };
  }

  // 2. previously persisted certified mint for the exact same window
  const persisted = opts.mintedArtifacts?.get(boundary);
  if (
    !frozen &&
    persisted &&
    persisted.modelVersion === ES1_MODEL_VERSION &&
    persisted.featureSchemaHash === es1FeatureSchemaHash() &&
    persisted.fitSource === "ts-lbfgs-certified" &&
    persisted.trainingRowCount === rows.length &&
    persisted.windowFingerprint === fingerprint &&
    canonicalArtifactHash(persisted) === persisted.artifactSha256
  ) {
    return {
      fit: fitFromArtifact(persisted, "ts-lbfgs-certified"),
      source: "ts-lbfgs-certified",
      certified: true,
      windowFingerprint: fingerprint,
      shadow,
      minted: false,
      certifiedFitterCodeHash: CERTIFIED_FITTER_CODE_HASH,
    };
  }

  // 3. mint with the pinned TypeScript L-BFGS fitter
  const minted = trainEs1Fit(rows, boundary, "lbfgs");
  if (minted && certifiedMintIsValid(minted, rows, boundary)) {
    return {
      // Canonicalise so a mint and its later replay from storage are identical.
      fit: fitFromArtifact(
        {
          boundary,
          trainingRowCount: minted.trainingRowCount,
          trainingStartTs: minted.trainingStartTs,
          trainingEndTs: minted.trainingEndTs,
          trainingStartIndex: minted.trainingStartIndex,
          trainingEndIndex: minted.trainingEndIndex,
          windowFingerprint: fingerprint,
          center: minted.scaler.center,
          scale: minted.scaler.scale,
          coefficients: minted.coefficients,
          intercept: minted.intercept,
        },
        "ts-lbfgs-certified",
      ),
      source: "ts-lbfgs-certified",
      certified: true,
      windowFingerprint: fingerprint,
      shadow,
      minted: true,
      certifiedFitterCodeHash: CERTIFIED_FITTER_CODE_HASH,
    };
  }

  // 4. uncertified IRLS shadow — the engine will abstain on this
  if (!shadow) return null;
  return {
    fit: shadow,
    source: "irls-shadow",
    certified: false,
    windowFingerprint: fingerprint,
    shadow,
    minted: false,
    certifiedFitterCodeHash: CERTIFIED_FITTER_CODE_HASH,
  };
}

/**
 * Runtime validation of a freshly minted certified fit. This is NOT parity
 * certification (that happens in CI against the sklearn oracle): it checks the
 * invariants that must hold for every live mint.
 */
function certifiedMintIsValid(
  fit: Es1Fit,
  rows: readonly TrainingRow[],
  boundary: number,
): boolean {
  if (!fit.converged) return false;
  if (!Number.isFinite(fit.intercept)) return false;
  if (!fit.coefficients.every((c) => Number.isFinite(c))) return false;
  if (!(fit.gradientNorm <= 1e-3)) return false;
  if (!fit.scaler.scale.every((s) => Number.isFinite(s) && s > 0)) return false;
  if (!fit.scaler.center.every((c) => Number.isFinite(c))) return false;
  if (fit.trainingRowCount !== rows.length) return false;
  if (fit.blockIndex !== boundary) return false;
  // Determinism: an identical re-solve must produce an identical artifact.
  const repeat = trainEs1Fit(rows, boundary, "lbfgs");
  return repeat != null && repeat.artifactSha256 === fit.artifactSha256;
}

/** Back-compat wrapper used by the replay loop. */
export function resolveEs1Fit(
  rows: readonly TrainingRow[],
  boundary: number,
  opts: ResolveOptions = {},
): Es1Fit | null {
  return resolveEs1FitDetailed(rows, boundary, opts)?.fit ?? null;
}

export function frozenFitCount(): number {
  return ARTIFACTS.size;
}

export function frozenBoundaries(): number[] {
  return [...ARTIFACTS.keys()].sort((a, b) => a - b);
}
