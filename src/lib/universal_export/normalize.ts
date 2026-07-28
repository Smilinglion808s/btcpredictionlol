// Universal export — normalization + canonical scoring.
// Pure functions. No IO. No model logic.

export type CanonicalDirection = "GREEN" | "RED" | "PUSH" | null;
export type NormalizedPrediction = "GREEN" | "RED" | "ABSTAIN" | null;
export type OutputClass = "DIRECTIONAL" | "ABSTAIN" | "UNAVAILABLE";
export type CanonicalScore = 1 | -1 | 0 | null;

/**
 * Map any raw model output to the canonical three-value space.
 *   YES / GREEN               -> GREEN
 *   NO  / RED                 -> RED
 *   SKIP / ABSTAIN / NO CLEAR EDGE -> ABSTAIN
 * Everything else (including null/undefined) -> null (missing).
 */
export function normalizePrediction(raw: unknown): NormalizedPrediction {
  if (raw === null || raw === undefined) return null;
  const s = String(raw).trim().toUpperCase();
  if (!s) return null;
  if (s === "YES" || s === "GREEN" || s === "BULL" || s === "BULLISH" || s === "LONG") return "GREEN";
  if (s === "NO" || s === "RED" || s === "BEAR" || s === "BEARISH" || s === "SHORT") return "RED";
  if (
    s === "SKIP" ||
    s === "ABSTAIN" ||
    s === "NO CLEAR EDGE" ||
    s === "NO_CLEAR_EDGE" ||
    s === "NCE" ||
    s === "PASS"
  )
    return "ABSTAIN";
  return null;
}

export function outputClassFor(pred: NormalizedPrediction): OutputClass {
  if (pred === "GREEN" || pred === "RED") return "DIRECTIONAL";
  if (pred === "ABSTAIN") return "ABSTAIN";
  return "UNAVAILABLE";
}

/**
 * Derive candle direction strictly from OHLC. Never nearest, never inferred
 * from an upstream direction field.
 */
export function directionFromOhlc(open: unknown, close: unknown): CanonicalDirection {
  const o = Number(open);
  const c = Number(close);
  if (!Number.isFinite(o) || !Number.isFinite(c)) return null;
  if (c > o) return "GREEN";
  if (c < o) return "RED";
  return "PUSH";
}

/**
 * Canonical scoring table (§3):
 *   canonical GREEN/RED × correct pred  -> +1
 *   canonical GREEN/RED × opposite pred -> -1
 *   canonical GREEN/RED × ABSTAIN       ->  0
 *   canonical PUSH                      -> null   (excluded from grading)
 *   canonical invalid / missing         -> null
 *   pred missing                        -> null
 */
export function canonicalScore(
  pred: NormalizedPrediction,
  canonicalDir: CanonicalDirection,
  canonicalValid: boolean,
): CanonicalScore {
  if (!canonicalValid) return null;
  if (canonicalDir === null || canonicalDir === "PUSH") return null;
  if (pred === null) return null;
  if (pred === "ABSTAIN") return 0;
  return pred === canonicalDir ? 1 : -1;
}
