// AAS96 Layer B: adaptive expert ensemble with EMA reliability weighting.

import type { ExpertInputs } from "./featurize";

export const EXPERT_NAMES = [
  "legacy", "inverse_legacy",
  "ema_trend", "inverse_ema_trend",
  "partial_direction", "inverse_partial_direction",
  "m6_score", "inverse_m6_score",
  "conviction", "inverse_conviction",
  "original_pre_partial", "inverse_original_pre_partial",
  "engine_trend_conflict",
] as const;
export type ExpertName = typeof EXPERT_NAMES[number];

export const HORIZONS = [
  { candles: 32, alpha: 0.1 },
  { candles: 64, alpha: 0.2 },
  { candles: 96, alpha: 0.1 },
  { candles: 192, alpha: 0.1 },
] as const;

export type Dir = "GREEN" | "RED";

/** Expert reliability history: for each expert & each horizon we track the
 *  last-N (win-loss) history as a rolling list of {result: +1 win, -1 loss}. */
export type ExpertHistory = Record<ExpertName, Record<number, number[]>>;

export function emptyExpertHistory(): ExpertHistory {
  const h = {} as ExpertHistory;
  for (const n of EXPERT_NAMES) {
    h[n] = {};
    for (const H of HORIZONS) h[n][H.candles] = [];
  }
  return h;
}

/** Return the expert's current direction (+1 / -1) or null (missing → fallback). */
export function currentExpertDirection(
  name: ExpertName,
  inputs: ExpertInputs,
): 1 | -1 | null {
  const inverseOf = (v: 1 | -1 | null): 1 | -1 | null => (v == null ? null : (v === 1 ? -1 : 1));
  switch (name) {
    case "legacy": return inputs.legacy;
    case "inverse_legacy": return inverseOf(inputs.legacy);
    case "ema_trend": return inputs.ema_trend;
    case "inverse_ema_trend": return inverseOf(inputs.ema_trend);
    case "partial_direction": return inputs.partial_direction;
    case "inverse_partial_direction": return inverseOf(inputs.partial_direction);
    case "m6_score": return inputs.m6_score;
    case "inverse_m6_score": return inverseOf(inputs.m6_score);
    case "conviction": return inputs.conviction;
    case "inverse_conviction": return inverseOf(inputs.conviction);
    case "original_pre_partial": return inputs.original_pre_partial;
    case "inverse_original_pre_partial": return inverseOf(inputs.original_pre_partial);
    case "engine_trend_conflict": return inputs.engine_trend_conflict;
  }
}

/** Compute final Layer B direction from expert histories + current inputs. */
export function computeLayerB(
  history: ExpertHistory,
  inputs: ExpertInputs,
  fallback: Dir,
): {
  horizons: Record<number, Dir>;
  final: Dir;
} {
  const horizons: Record<number, Dir> = {} as Record<number, Dir>;

  for (const H of HORIZONS) {
    let score = 0;
    for (const name of EXPERT_NAMES) {
      let dir = currentExpertDirection(name, inputs);
      const usingFallback = dir == null;
      if (dir == null) dir = fallback === "GREEN" ? 1 : -1;
      const hist = history[name]?.[H.candles] ?? [];
      const net = hist.reduce((a, b) => a + b, 0); // +1 win, -1 loss
      const weight = usingFallback && hist.length === 0 ? 0 : Math.tanh(H.alpha * net);
      score += dir * weight;
    }
    horizons[H.candles] = score >= 0 ? "GREEN" : "RED";
  }

  // Majority-of-4, ties go to 192-candle direction.
  const dirs = HORIZONS.map((H) => horizons[H.candles]);
  const greens = dirs.filter((d) => d === "GREEN").length;
  let final: Dir;
  if (greens >= 3) final = "GREEN";
  else if (greens <= 1) final = "RED";
  else final = horizons[192];
  return { horizons, final };
}

/** Append expert results after a resolved directional candle. */
export function updateExpertHistory(
  history: ExpertHistory,
  inputs: ExpertInputs,
  actual: Dir,
  fallback: Dir,
): void {
  const actualPolar = actual === "GREEN" ? 1 : -1;
  for (const name of EXPERT_NAMES) {
    let dir = currentExpertDirection(name, inputs);
    if (dir == null) dir = fallback === "GREEN" ? 1 : -1;
    const result = dir === actualPolar ? 1 : -1;
    for (const H of HORIZONS) {
      const arr = history[name][H.candles];
      arr.push(result);
      if (arr.length > H.candles) arr.splice(0, arr.length - H.candles);
    }
  }
}
