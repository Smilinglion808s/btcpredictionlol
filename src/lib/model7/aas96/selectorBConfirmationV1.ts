// AAS96 — Selector B Confirmation V1 (active selector override).
// Frozen rule: when Layer A and Layer B disagree, the master model agrees
// with Layer B, and |EMA9 - EMA21| / btcPrice >= threshold, actively select
// Layer B. Selector override only — never changes A/B outputs, never
// abstains, never reverses B's direction.

export const SELECTOR_B_CONFIRMATION_V1_VERSION = "1.0.0";
export const SELECTOR_B_CONFIRMATION_V1_THRESHOLD = 0.0001;
export const SELECTOR_B_CONFIRMATION_V1_REASON = "master_confirms_b_with_ema_separation";

export type Dir = "GREEN" | "RED";

export interface SelectorBConfirmationV1Result {
  version: string;
  threshold: number;
  evaluable: boolean;
  triggered: boolean;
  reason: string | null;
  emaSeparation: number | null;
  emaSeparationRatio: number | null;
}

function isDir(x: unknown): x is Dir {
  return x === "GREEN" || x === "RED";
}

function num(x: unknown): number | null {
  if (x == null) return null;
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : null;
}

export function evaluateSelectorBConfirmationV1(args: {
  layerAFinalDirection: unknown;
  layerBFinalDirection: unknown;
  masterPrediction: unknown; // GREEN | RED (mapped from YES/NO upstream)
  ema9: unknown;
  ema21: unknown;
  btcPrice: unknown;
}): SelectorBConfirmationV1Result {
  const aDir = isDir(args.layerAFinalDirection) ? args.layerAFinalDirection : null;
  const bDir = isDir(args.layerBFinalDirection) ? args.layerBFinalDirection : null;
  const master = isDir(args.masterPrediction) ? args.masterPrediction : null;
  const ema9 = num(args.ema9);
  const ema21 = num(args.ema21);
  const btc = num(args.btcPrice);

  const evaluable =
    aDir != null && bDir != null && master != null &&
    ema9 != null && ema21 != null && btc != null && btc > 0;

  if (!evaluable) {
    return {
      version: SELECTOR_B_CONFIRMATION_V1_VERSION,
      threshold: SELECTOR_B_CONFIRMATION_V1_THRESHOLD,
      evaluable: false,
      triggered: false,
      reason: null,
      emaSeparation: ema9 != null && ema21 != null ? Math.abs(ema9 - ema21) : null,
      emaSeparationRatio: null,
    };
  }

  const separation = Math.abs(ema9! - ema21!);
  const ratio = separation / btc!;
  const triggered =
    aDir !== bDir &&
    master === bDir &&
    ratio >= SELECTOR_B_CONFIRMATION_V1_THRESHOLD;

  return {
    version: SELECTOR_B_CONFIRMATION_V1_VERSION,
    threshold: SELECTOR_B_CONFIRMATION_V1_THRESHOLD,
    evaluable: true,
    triggered,
    reason: triggered ? SELECTOR_B_CONFIRMATION_V1_REASON : null,
    emaSeparation: separation,
    emaSeparationRatio: ratio,
  };
}

/** Map production YES/NO/NO CLEAR EDGE to Dir; anything else → null. */
export function masterPredictionToDir(x: unknown): Dir | null {
  if (x === "YES") return "GREEN";
  if (x === "NO") return "RED";
  return null;
}
