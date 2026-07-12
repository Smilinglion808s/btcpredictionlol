// Model C — scoring layer: DictVectorizer + StandardScaler + LogisticRegression.
//
// Given a component fit (feature_order + scaler + classifier) and a flattened
// feature map (numeric keys `name`, categorical keys `name=value`), compute
// P(GREEN) exactly the same way sklearn's Pipeline would:
//   scaled_i = (features[order[i]] ?? 0 - mean[i]) / scale[i]
//   z = sum(scaled_i * coef[i]) + intercept
//   p = 1 / (1 + exp(-z))                      # positive class = 1 (GREEN)
//
// Missing keys become 0 per DictVectorizer semantics. Unknown map keys are
// silently ignored (they aren't in feature_order).

import type { ModelCComponentFit } from "./fit";

export type FeatureMap = Record<string, number>;

export interface ScoreResult {
  probability_green: number;
  z: number;
  nonzero_features: number;
}

function sigmoid(z: number): number {
  if (z >= 0) {
    const e = Math.exp(-z);
    return 1 / (1 + e);
  }
  const e = Math.exp(z);
  return e / (1 + e);
}

export function scoreComponent(
  fit: ModelCComponentFit,
  features: FeatureMap,
): ScoreResult {
  const order = fit.feature_order;
  const mean = fit.scaler.mean;
  const scale = fit.scaler.scale;
  const coef = (fit.classifier.coefficients as number[]) ?? [];
  const intercept = (fit.classifier.intercept as number) ?? 0;

  let z = intercept;
  let nonzero = 0;
  for (let i = 0; i < order.length; i++) {
    const raw = features[order[i]];
    const v = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    if (v !== 0) nonzero++;
    const s = scale[i] === 0 ? 0 : (v - mean[i]) / scale[i];
    z += s * coef[i];
  }
  return {
    probability_green: sigmoid(z),
    z,
    nonzero_features: nonzero,
  };
}

/**
 * Cheap deterministic hash for a feature vector (post-lookup order values).
 * FNV-1a 64-bit expressed as 16-char hex. Good enough for lineage audit.
 */
export function featureVectorHash(
  fit: ModelCComponentFit,
  features: FeatureMap,
): string {
  const order = fit.feature_order;
  // FNV-1a 64
  let h1 = 0xcbf29ce4 >>> 0;
  let h2 = 0x84222325 >>> 0;
  const step = (byte: number) => {
    h1 ^= byte;
    // multiply by FNV prime 0x100000001b3
    const lo = (h1 * 0x1b3) >>> 0;
    const hi = (h2 * 0x1b3 + Math.floor((h1 * 0x1b3) / 0x100000000)) >>> 0;
    h1 = lo;
    h2 = hi;
  };
  for (let i = 0; i < order.length; i++) {
    const raw = features[order[i]];
    const v = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
    const s = v.toFixed(6);
    for (let j = 0; j < s.length; j++) step(s.charCodeAt(j) & 0xff);
    step(0x1f); // separator
  }
  const toHex = (n: number) => n.toString(16).padStart(8, "0");
  return toHex(h2) + toHex(h1);
}
