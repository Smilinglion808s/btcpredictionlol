// B4x4-ES1 Balanced Precision Stack R1 — frozen research Balanced Router base
// plus the two precision sleeves (trend-age Primary, upper-wick Rescue).
//
// This module is a pure, side-effect-free reimplementation of the research
// router used to produce `B4x4_ES1_Balanced_Precision_Oracle_224.json`. It is
// NOT wired into production decisioning; it exists so oracle parity can be
// established before any policy, schema or webhook change.
//
// Frozen identity — bump on any semantic change.
export const PRECISION_STACK_POLICY_ID = "b4x4-es1-balanced-precision-stack-r1";
export const PRECISION_STACK_ORACLE_ID = "b4x4-es1-balanced-precision-stack-r1-224";

/** Minimum |p_green − 0.5| for the technical fill leg. */
export const PRECISION_FILL_MIN_CONFIDENCE = 0.06;
/** Primary sleeve fires only on fresh trends. */
export const PRECISION_PRIMARY_MAX_TREND_AGE = 12;
/** Rescue sleeve requires a compressed upper-wick regime. */
export const PRECISION_RESCUE_MAX_WICK_PERCENTILE = 0.2;
/** Lookback used for the upper-wick percentile (prior candles, full window required). */
export const PRECISION_WICK_PERCENTILE_WINDOW = 96;

export type Direction = "GREEN" | "RED";
export type Outcome = Direction | "PUSH";

export interface PrecisionStackInputs {
  spotAdaptiveDirection: Direction | null;
  perpAdaptiveDirection: Direction | null;
  perpSignChangeCount60s: number | null;
  spotNormalizedOfi5s: number | null;
  technicalDirection: Direction | null;
  /** |p_green − 0.5|; null when no walk-forward technical fit exists yet. */
  technicalConfidence: number | null;
  priorTrendAgeCandles: number | null;
  /** Percentile rank of the prior candle's upper-wick share in the last 96 candles. */
  upperWickPercentile96: number | null;
}

export interface Leg {
  wouldTrade: boolean;
  direction: Direction | null;
}

export interface BalancedLeg extends Leg {
  dualAgree: boolean;
  activityGuardPassed: boolean;
  core: boolean;
  fill: boolean;
}

export interface PrecisionStackDecision {
  balanced: BalancedLeg;
  primary: Leg;
  rescue: Leg;
  combined: Leg;
}

function flip(d: Direction): Direction {
  return d === "GREEN" ? "RED" : "GREEN";
}

function signDirection(v: number | null): Direction | null {
  if (v === null || !Number.isFinite(v) || v === 0) return null;
  return v > 0 ? "GREEN" : "RED";
}

/**
 * Activity guard: the agreed venue direction is only tradable when the perp
 * book flipped sign at least twice in the last 60s, or the 5s spot OFI sign
 * confirms the agreed direction.
 */
export function evaluateActivityGuard(
  agreedDirection: Direction | null,
  perpSignChangeCount60s: number | null,
  spotNormalizedOfi5s: number | null,
): boolean {
  if (!agreedDirection) return false;
  if ((perpSignChangeCount60s ?? 0) >= 2) return true;
  return signDirection(spotNormalizedOfi5s) === agreedDirection;
}

/** Research Balanced Router: OB core on venue agreement, technical fill on disagreement. */
export function decideBalancedRouter(inp: PrecisionStackInputs): BalancedLeg {
  const spot = inp.spotAdaptiveDirection;
  const perp = inp.perpAdaptiveDirection;
  const dualAgree = spot !== null && perp !== null && spot === perp;
  const agreed = dualAgree ? spot : null;
  const activityGuardPassed = dualAgree
    ? evaluateActivityGuard(agreed, inp.perpSignChangeCount60s, inp.spotNormalizedOfi5s)
    : false;

  const core = dualAgree && activityGuardPassed;
  const fill =
    !dualAgree &&
    inp.technicalDirection !== null &&
    inp.technicalConfidence !== null &&
    Number.isFinite(inp.technicalConfidence) &&
    inp.technicalConfidence >= PRECISION_FILL_MIN_CONFIDENCE;

  const direction = core ? agreed : fill ? inp.technicalDirection : null;
  return {
    dualAgree,
    activityGuardPassed,
    core,
    fill,
    wouldTrade: direction !== null,
    direction,
  };
}

/** Balanced Router + the two frozen precision sleeves. */
export function decidePrecisionStack(inp: PrecisionStackInputs): PrecisionStackDecision {
  const balanced = decideBalancedRouter(inp);
  const age = inp.priorTrendAgeCandles;
  const wick = inp.upperWickPercentile96;

  const primaryFires =
    balanced.wouldTrade && age !== null && age < PRECISION_PRIMARY_MAX_TREND_AGE;
  const primary: Leg = {
    wouldTrade: primaryFires,
    direction: primaryFires ? balanced.direction : null,
  };

  const rescueFires =
    !primaryFires &&
    balanced.wouldTrade &&
    age !== null &&
    age >= PRECISION_PRIMARY_MAX_TREND_AGE &&
    wick !== null &&
    wick <= PRECISION_RESCUE_MAX_WICK_PERCENTILE;
  const rescue: Leg = {
    wouldTrade: rescueFires,
    direction: rescueFires && balanced.direction ? flip(balanced.direction) : null,
  };

  const combined: Leg = primaryFires ? primary : rescueFires ? rescue : { wouldTrade: false, direction: null };
  return { balanced, primary, rescue, combined };
}

/** +1 win, −1 loss, 0 push/no-trade. */
export function scoreLeg(leg: Leg, actual: Outcome | null): number {
  if (!leg.wouldTrade || !leg.direction || !actual || actual === "PUSH") return 0;
  return leg.direction === actual ? 1 : -1;
}

/**
 * Percentile rank of `current` within the trailing window of prior upper-wick
 * shares. Returns null until a full 96-candle window is available.
 */
export function upperWickPercentile(
  priorShares: readonly number[],
  current: number,
  window = PRECISION_WICK_PERCENTILE_WINDOW,
): number | null {
  if (priorShares.length < window) return null;
  const hist = priorShares.slice(priorShares.length - window);
  let le = 0;
  for (const v of hist) if (v <= current) le++;
  return le / hist.length;
}
