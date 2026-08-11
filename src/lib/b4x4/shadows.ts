// B4x4 prospective policy shadows — REPORTING ONLY.
//
// Neither shadow may alter the active B4x4 decision, the active intraday
// brake, coverage, or any webhook. Each shadow keeps its own counterfactual
// Boise daily net and replays the frozen brake against that net alone.

import {
  BETA_PRIOR_ALPHA,
  BETA_PRIOR_BETA,
  INTRADAY_BRAKE_GRID_PERCENTILE_MIN,
  INTRADAY_BRAKE_P_CORRECT_MIN_EXCLUSIVE,
  INTRADAY_BRAKE_TRIGGER_NET,
  b4x4ShadowConfigHash,
} from "./config";
import {
  cellKey,
  hasValidRanks,
  type B4x4Decision,
  type Direction,
  type HistoryEntry,
} from "./engine";

export const SHADOW_A_VARIANT = "B4X4_SHORT_CELL_96_BETA8_T054";
export const SHADOW_B_VARIANT = "B4X4_EXP_ONLY_GRID_PCT_VETO_065_070";

export const SHADOW_A_PROSPECTIVE_TEST_ID = "B4X4_SHADOW_A_SHORT_CELL_96_T054";
export const SHADOW_B_PROSPECTIVE_TEST_ID = "B4X4_SHADOW_B_EXP_MARGINAL_065_070";

export const SHORT_CELL_SOURCE_WINDOW = 96;
export const SHORT_CELL_P_CORRECT_MIN_EXCLUSIVE = 0.54;
export const EXPANSION_MARGINAL_BAND_LOW = 0.65;
export const EXPANSION_MARGINAL_BAND_HIGH = 0.70;

export const SHADOW_A_CONFIG_HASH = b4x4ShadowConfigHash(SHADOW_A_VARIANT, {
  SHORT_CELL_SOURCE_WINDOW,
  SHORT_CELL_P_CORRECT_MIN_EXCLUSIVE,
  BETA_PRIOR_ALPHA,
  BETA_PRIOR_BETA,
});
export const SHADOW_B_CONFIG_HASH = b4x4ShadowConfigHash(SHADOW_B_VARIANT, {
  EXPANSION_MARGINAL_BAND_LOW,
  EXPANSION_MARGINAL_BAND_HIGH,
});

export interface ShadowDecision {
  shadowVariant: string;
  prospectiveTestId: string;
  configHash: string;
  /** gate inputs, prediction-time */
  gateInputs: Record<string, number | string | boolean | null>;
  baseRoute: string;
  gateFired: boolean;
  dailyNetBefore: number;
  brakeActive: boolean;
  brakeVetoFired: boolean;
  finalPrediction: Direction | null;
  wouldTrade: boolean;
  decisionReason: string;
}

/** Short-cell reliability statistics over the previous 96 source positions. */
export function shortCellStats(
  history: HistoryEntry[],
  iAbs: number,
  cell: string,
): { sourceWindowCount: number; resolvedCount: number; wins: number; losses: number; pCorrect: number } {
  const start = Math.max(0, iAbs - SHORT_CELL_SOURCE_WINDOW);
  const windowRows = history.slice(start, iAbs);
  let wins = 0;
  let losses = 0;
  for (const h of windowRows) {
    if (!hasValidRanks(h) || h.correct == null) continue;
    if (cellKey(h.globalQuartile!, h.sameSideQuartile!) !== cell) continue;
    if (h.correct) wins++;
    else losses++;
  }
  const resolvedCount = wins + losses;
  return {
    sourceWindowCount: windowRows.length,
    resolvedCount,
    wins,
    losses,
    pCorrect: (wins + BETA_PRIOR_ALPHA) / (resolvedCount + BETA_PRIOR_ALPHA + BETA_PRIOR_BETA),
  };
}

function applyFrozenBrake(
  d: B4x4Decision,
  dailyNetBefore: number,
): { brakeActive: boolean; publish: boolean } {
  const brakeActive = dailyNetBefore <= INTRADAY_BRAKE_TRIGGER_NET;
  const brakePasses =
    (d.gridQualityPercentile ?? -1) >= INTRADAY_BRAKE_GRID_PERCENTILE_MIN &&
    (d.pCorrect ?? 0) > INTRADAY_BRAKE_P_CORRECT_MIN_EXCLUSIVE;
  return { brakeActive, publish: brakeActive ? brakePasses : true };
}

/** True when the active engine never reached the routing stage. */
function operationalBlock(d: B4x4Decision): boolean {
  return (
    d.rawDirection == null ||
    d.gridQualityPercentile == null ||
    d.pCorrect == null ||
    !d.dataValid
  );
}

export function evaluateShadowA(
  d: B4x4Decision,
  history: HistoryEntry[],
  dailyNetBefore: number,
): ShadowDecision {
  const iAbs = d.sourceIndexAbsolute;
  const stats = d.gridCell
    ? shortCellStats(history, iAbs, d.gridCell)
    : { sourceWindowCount: 0, resolvedCount: 0, wins: 0, losses: 0, pCorrect: 0 };
  const gateInputs: ShadowDecision["gateInputs"] = {
    short_cell_source_window_count: stats.sourceWindowCount,
    short_cell_resolved_count: stats.resolvedCount,
    short_cell_wins: stats.wins,
    short_cell_losses: stats.losses,
    short_cell_p_correct: stats.pCorrect,
    grid_cell: d.gridCell,
    selected_route: d.selectedRoute,
  };
  const shell: ShadowDecision = {
    shadowVariant: SHADOW_A_VARIANT,
    prospectiveTestId: SHADOW_A_PROSPECTIVE_TEST_ID,
    configHash: SHADOW_A_CONFIG_HASH,
    gateInputs,
    baseRoute: d.selectedRoute,
    gateFired: false,
    dailyNetBefore,
    brakeActive: dailyNetBefore <= INTRADAY_BRAKE_TRIGGER_NET,
    brakeVetoFired: false,
    finalPrediction: null,
    wouldTrade: false,
    decisionReason: d.decisionReason,
  };
  if (operationalBlock(d)) return shell;

  const expansionOnly = d.expansionEligible && !d.coreEligible;
  let candidate = d.coreEligible || d.expansionEligible;
  if (expansionOnly) {
    candidate = stats.pCorrect > SHORT_CELL_P_CORRECT_MIN_EXCLUSIVE;
    if (!candidate) {
      return { ...shell, gateFired: true, decisionReason: "ABSTAIN_SHADOW_SHORT_CELL_RELIABILITY" };
    }
  }
  if (!candidate) return { ...shell, decisionReason: "ABSTAIN_NO_ACTIVE_ROUTE" };

  const { brakeActive, publish } = applyFrozenBrake(d, dailyNetBefore);
  if (!publish) {
    return { ...shell, brakeActive, brakeVetoFired: true, decisionReason: "ABSTAIN_INTRADAY_BRAKE" };
  }
  return {
    ...shell,
    brakeActive,
    finalPrediction: d.rawDirection,
    wouldTrade: true,
    decisionReason:
      d.selectedRoute === "CORE_AND_EXPANSION"
        ? "PUBLISH_CORE_AND_EXPANSION"
        : d.selectedRoute === "CORE"
          ? "PUBLISH_CORE"
          : "PUBLISH_EXPANSION",
  };
}

export function evaluateShadowB(d: B4x4Decision, dailyNetBefore: number): ShadowDecision {
  const pct = d.gridQualityPercentile;
  const shell: ShadowDecision = {
    shadowVariant: SHADOW_B_VARIANT,
    prospectiveTestId: SHADOW_B_PROSPECTIVE_TEST_ID,
    configHash: SHADOW_B_CONFIG_HASH,
    gateInputs: {
      grid_quality_percentile: pct,
      core_eligible: d.coreEligible,
      expansion_eligible: d.expansionEligible,
      selected_route: d.selectedRoute,
      band_low: EXPANSION_MARGINAL_BAND_LOW,
      band_high: EXPANSION_MARGINAL_BAND_HIGH,
    },
    baseRoute: d.selectedRoute,
    gateFired: false,
    dailyNetBefore,
    brakeActive: dailyNetBefore <= INTRADAY_BRAKE_TRIGGER_NET,
    brakeVetoFired: false,
    finalPrediction: null,
    wouldTrade: false,
    decisionReason: d.decisionReason,
  };
  if (operationalBlock(d)) return shell;

  const candidate = d.coreEligible || d.expansionEligible;
  if (!candidate) return { ...shell, decisionReason: "ABSTAIN_NO_ACTIVE_ROUTE" };

  const expansionOnly = d.expansionEligible && !d.coreEligible;
  if (
    expansionOnly &&
    pct != null &&
    pct >= EXPANSION_MARGINAL_BAND_LOW &&
    pct < EXPANSION_MARGINAL_BAND_HIGH
  ) {
    return { ...shell, gateFired: true, decisionReason: "ABSTAIN_SHADOW_EXPANSION_MARGINAL_BAND" };
  }

  const { brakeActive, publish } = applyFrozenBrake(d, dailyNetBefore);
  if (!publish) {
    return { ...shell, brakeActive, brakeVetoFired: true, decisionReason: "ABSTAIN_INTRADAY_BRAKE" };
  }
  return {
    ...shell,
    brakeActive,
    finalPrediction: d.rawDirection,
    wouldTrade: true,
    decisionReason:
      d.selectedRoute === "CORE_AND_EXPANSION"
        ? "PUBLISH_CORE_AND_EXPANSION"
        : d.selectedRoute === "CORE"
          ? "PUBLISH_CORE"
          : "PUBLISH_EXPANSION",
  };
}

/** Shadow rows may never emit a webhook. */
export const SHADOW_WEBHOOK_ELIGIBLE = false as const;
