// B4x4 — pure decision engine. No I/O, no clock reads, fully deterministic.
//
// B4x4 consumes the canonical prediction-time A2_Combined probability, ranks it
// against prior raw A2 predictions, scores it through a rolling 4x4 correctness
// grid, and publishes via the CORE / EXPANSION routes with an intraday loss
// brake. It never reverses the A2 direction.

import {
  BETA_PRIOR_ALPHA,
  BETA_PRIOR_BETA,
  CORE_GLOBAL_RANK_MIN,
  CORE_SAME_SIDE_RANK_MIN,
  EXPANSION_GRID_PERCENTILE_MIN,
  EXPANSION_P_CORRECT_MIN_EXCLUSIVE,
  GLOBAL_CONFIDENCE_LOOKBACK,
  GRID_QUARTILES,
  GRID_REFERENCE_LOOKBACK,
  GRID_TRAINING_LOOKBACK,
  INTRADAY_BRAKE_GRID_PERCENTILE_MIN,
  INTRADAY_BRAKE_P_CORRECT_MIN_EXCLUSIVE,
  INTRADAY_BRAKE_TRIGGER_NET,
  MIN_SOURCE_HISTORY,
  SAME_SIDE_CONFIDENCE_LOOKBACK,
  b4x4LocalDate,
} from "./config";

export type Direction = "GREEN" | "RED";
export type ActualDirection = "GREEN" | "RED" | "PUSH";
export type SelectedRoute = "CORE" | "EXPANSION" | "CORE_AND_EXPANSION" | "NONE";

export type DecisionReason =
  | "PUBLISH_CORE"
  | "PUBLISH_EXPANSION"
  | "PUBLISH_CORE_AND_EXPANSION"
  | "ABSTAIN_A2_PROBABILITY_INVALID"
  | "ABSTAIN_A2_TIMING_INVALID"
  | "ABSTAIN_A2_LEAKAGE_INVALID"
  | "ABSTAIN_SOURCE_HISTORY_INVALID"
  | "ABSTAIN_WARMUP_SOURCE_HISTORY"
  | "ABSTAIN_WARMUP_GRID_HISTORY"
  | "ABSTAIN_GRID_REFERENCE_INVALID"
  | "ABSTAIN_B4X4_GRID_HISTORY_INCOMPLETE"
  | "ABSTAIN_NO_ACTIVE_ROUTE"
  | "ABSTAIN_INTRADAY_BRAKE"
  | "ABSTAIN_INTERNAL_ERROR";

export const OPERATIONAL_ABSTAIN_REASONS = new Set<string>([
  "ABSTAIN_A2_PROBABILITY_INVALID",
  "ABSTAIN_A2_TIMING_INVALID",
  "ABSTAIN_A2_LEAKAGE_INVALID",
  "ABSTAIN_SOURCE_HISTORY_INVALID",
  "ABSTAIN_WARMUP_SOURCE_HISTORY",
  "ABSTAIN_WARMUP_GRID_HISTORY",
  "ABSTAIN_GRID_REFERENCE_INVALID",
  "ABSTAIN_B4X4_GRID_HISTORY_INCOMPLETE",
  "ABSTAIN_INTERNAL_ERROR",
]);


/** One canonical A2_Combined observation, ordered oldest → newest by caller. */
export interface SourceRow {
  candleTs: string;
  probabilityGreen: number | null;
  timingStatus: string | null;
  leakageCheckPassed: boolean | null;
  actualDirection: ActualDirection | null;
  /** Optional audit passthrough. */
  sourceRowId?: string | null;
  predictionId?: string | null;
  a2ModelFitId?: string | null;
  a2ProductionModelVersion?: string | null;
  createdAt?: string | null;
}

/** Prediction-time state carried forward for every valid prior source row. */
export interface HistoryEntry {
  candleTs: string;
  confidence: number;
  direction: Direction;
  globalRank: number | null;
  sameSideRank: number | null;
  globalQuartile: number | null;
  sameSideQuartile: number | null;
  qualityMean: number | null;
  actualDirection: ActualDirection | null;
  /** raw_direction === actual_direction (null when unresolved / PUSH). */
  correct: boolean | null;
}

export interface GridCell {
  globalQuartile: number;
  sameSideQuartile: number;
  resolvedCount: number;
  wins: number;
  losses: number;
  pCorrect: number;
}

export interface DailyState {
  localDate: string;
  dailyNetBefore: number;
  dailyResolvedTradeCountBefore: number;
}

export interface B4x4Decision {
  // source
  probabilityGreen: number | null;
  rawDirection: Direction | null;
  confidence: number | null;
  dataValid: boolean;
  dataInvalidReason: string | null;
  /** Absolute zero-based position among valid canonical source rows since epoch. */
  sourceIndexAbsolute: number;
  // ranks
  globalRank: number | null;
  globalHistoryCount: number;
  globalHistoryStartTs: string | null;
  globalHistoryEndTs: string | null;
  globalHistoryStartIndex: number | null;
  globalHistoryEndIndex: number | null;
  sameSideRank: number | null;
  sameSideHistoryCount: number;
  sameSideHistoryStartTs: string | null;
  sameSideHistoryEndTs: string | null;
  /** Source rows taken BEFORE the direction filter (expected 768 when mature). */
  sameSideInputSourceCount: number;
  sameSideFilteredCount: number;
  sameSideHistoryStartIndex: number | null;
  sameSideHistoryEndIndex: number | null;
  sameSideRawDirectionFilter: Direction | null;
  globalRankQuartile: number | null;
  sameSideRankQuartile: number | null;
  qualityMean: number | null;
  // grid
  gridTrainingResolvedCount: number;
  gridTrainingSourceCount: number;
  gridTrainingStartIndex: number | null;
  gridTrainingEndIndex: number | null;
  gridTrainingStartTs: string | null;
  gridTrainingEndTs: string | null;
  gridWindowIntegrityPassed: boolean | null;
  gridWindowIntegrityReason: string | null;
  gridCell: string | null;
  gridCellResolvedCount: number | null;
  gridCellWins: number | null;
  gridCellLosses: number | null;
  pCorrect: number | null;
  gridReferenceCount: number;
  gridReferenceSourceCount: number;
  gridReferenceStartIndex: number | null;
  gridReferenceEndIndex: number | null;
  gridReferenceStartTs: string | null;
  gridReferenceEndTs: string | null;
  gridQualityPercentile: number | null;
  gridSnapshot: GridCell[] | null;

  // decision
  coreEligible: boolean;
  expansionEligible: boolean;
  baseCandidate: boolean;
  selectedRoute: SelectedRoute;
  localDate: string;
  dailyNetBefore: number;
  dailyResolvedTradeCountBefore: number;
  intradayBrakeActive: boolean;
  intradayBrakeVetoFired: boolean;
  finalPrediction: Direction | null;
  wouldTrade: boolean;
  decisionReason: DecisionReason;
  /** history entry to append after this row is processed */
  historyEntry: HistoryEntry | null;
}

// ---------------------------------------------------------------- primitives

/** Right-inclusive empirical rank: count(v <= current) / n. */
export function empiricalRank(previous: number[], current: number): number | null {
  if (previous.length === 0) return null;
  let below = 0;
  for (const v of previous) if (v <= current) below++;
  return below / previous.length;
}

/** quartile(rank) = min(3, floor(rank * 4)) */
export function quartileOf(rank: number): number {
  return Math.min(GRID_QUARTILES - 1, Math.floor(rank * GRID_QUARTILES));
}

/** Beta-smoothed correctness: (wins + 8) / (count + 16). */
export function betaPCorrect(wins: number, resolvedCount: number): number {
  return (wins + BETA_PRIOR_ALPHA) / (resolvedCount + BETA_PRIOR_ALPHA + BETA_PRIOR_BETA);
}

export function cellKey(globalQuartile: number, sameSideQuartile: number): string {
  return `G${globalQuartile + 1}-S${sameSideQuartile + 1}`;
}

export function hasValidRanks(e: HistoryEntry): boolean {
  return (
    e.globalRank != null && e.sameSideRank != null &&
    e.globalQuartile != null && e.sameSideQuartile != null
  );
}

/** Build the full 16-cell grid from resolved, ranked training rows. */
export function buildGrid(training: HistoryEntry[]): Map<string, GridCell> {
  const cells = new Map<string, GridCell>();
  for (let g = 0; g < GRID_QUARTILES; g++) {
    for (let s = 0; s < GRID_QUARTILES; s++) {
      cells.set(cellKey(g, s), {
        globalQuartile: g, sameSideQuartile: s,
        resolvedCount: 0, wins: 0, losses: 0, pCorrect: betaPCorrect(0, 0),
      });
    }
  }
  for (const e of training) {
    if (!hasValidRanks(e) || e.correct == null) continue;
    const cell = cells.get(cellKey(e.globalQuartile!, e.sameSideQuartile!));
    if (!cell) continue;
    cell.resolvedCount++;
    if (e.correct) cell.wins++;
    else cell.losses++;
  }
  for (const cell of cells.values()) cell.pCorrect = betaPCorrect(cell.wins, cell.resolvedCount);
  return cells;
}

export function gridSnapshotArray(cells: Map<string, GridCell>): GridCell[] {
  return [...cells.values()].sort(
    (a, b) => a.globalQuartile - b.globalQuartile || a.sameSideQuartile - b.sameSideQuartile,
  );
}

/**
 * Grid quality percentile of the current prediction against the previous
 * GRID_REFERENCE_LOOKBACK ranked rows, scored with the CURRENT cell table.
 */
export function gridQualityPercentile(
  reference: HistoryEntry[],
  cells: Map<string, GridCell>,
  currentPCorrect: number,
  currentQualityMean: number,
): number | null {
  if (reference.length === 0) return null;
  let qualifying = 0;
  for (const e of reference) {
    const cell = cells.get(cellKey(e.globalQuartile!, e.sameSideQuartile!));
    const score = cell ? cell.pCorrect : betaPCorrect(0, 0);
    if (score < currentPCorrect) qualifying++;
    else if (score === currentPCorrect && (e.qualityMean ?? 0) <= currentQualityMean) qualifying++;
  }
  return qualifying / reference.length;
}

// ------------------------------------------------------------------ decision

function abstain(
  partial: Partial<B4x4Decision>,
  reason: DecisionReason,
  base: B4x4Decision,
): B4x4Decision {
  return { ...base, ...partial, finalPrediction: null, wouldTrade: false, decisionReason: reason };
}

/**
 * Evaluate one source row against its strictly-earlier history.
 * `history` must be ordered oldest → newest and contain only valid prior rows.
 */
export function evaluateB4x4(
  row: SourceRow,
  history: HistoryEntry[],
  daily: DailyState,
): B4x4Decision {
  const localDate = daily.localDate || b4x4LocalDate(row.candleTs);
  const base: B4x4Decision = {
    probabilityGreen: row.probabilityGreen,
    rawDirection: null,
    confidence: null,
    dataValid: true,
    dataInvalidReason: null,
    globalRank: null,
    globalHistoryCount: 0,
    globalHistoryStartTs: null,
    globalHistoryEndTs: null,
    sameSideRank: null,
    sameSideHistoryCount: 0,
    sameSideHistoryStartTs: null,
    sameSideHistoryEndTs: null,
    globalRankQuartile: null,
    sameSideRankQuartile: null,
    qualityMean: null,
    gridTrainingResolvedCount: 0,
    gridTrainingStartTs: null,
    gridTrainingEndTs: null,
    gridCell: null,
    gridCellResolvedCount: null,
    gridCellWins: null,
    gridCellLosses: null,
    pCorrect: null,
    gridReferenceCount: 0,
    gridQualityPercentile: null,
    gridSnapshot: null,
    coreEligible: false,
    expansionEligible: false,
    baseCandidate: false,
    selectedRoute: "NONE",
    localDate,
    dailyNetBefore: daily.dailyNetBefore,
    dailyResolvedTradeCountBefore: daily.dailyResolvedTradeCountBefore,
    intradayBrakeActive: daily.dailyNetBefore <= INTRADAY_BRAKE_TRIGGER_NET,
    intradayBrakeVetoFired: false,
    finalPrediction: null,
    wouldTrade: false,
    decisionReason: "ABSTAIN_INTERNAL_ERROR",
    historyEntry: null,
  };

  // ---- source validity (operational) ----
  const p = row.probabilityGreen;
  if (p == null || !Number.isFinite(p) || p < 0 || p > 1) {
    return abstain(
      { dataValid: false, dataInvalidReason: "a2_probability_invalid" },
      "ABSTAIN_A2_PROBABILITY_INVALID",
      base,
    );
  }
  if (row.timingStatus !== "ON_TIME") {
    return abstain(
      { dataValid: false, dataInvalidReason: `a2_timing_status=${row.timingStatus ?? "null"}` },
      "ABSTAIN_A2_TIMING_INVALID",
      base,
    );
  }
  if (row.leakageCheckPassed !== true) {
    return abstain(
      { dataValid: false, dataInvalidReason: "a2_leakage_check_failed" },
      "ABSTAIN_A2_LEAKAGE_INVALID",
      base,
    );
  }

  const confidence = Math.abs(p - 0.5);
  const rawDirection: Direction = p >= 0.5 ? "GREEN" : "RED";

  // ---- ranks (strictly earlier history only) ----
  // Global rank: previous 384 valid source rows.
  // Same-side rank: previous 768 valid source rows, THEN filtered to this
  // row's raw direction (not the previous 768 same-direction rows).
  const globalHistory = history.slice(-GLOBAL_CONFIDENCE_LOOKBACK);
  const sameSideHistory = history
    .slice(-SAME_SIDE_CONFIDENCE_LOOKBACK)
    .filter((h) => h.direction === rawDirection);


  const globalRank = empiricalRank(globalHistory.map((h) => h.confidence), confidence);
  const sameSideRank = empiricalRank(sameSideHistory.map((h) => h.confidence), confidence);
  const globalQuartile = globalRank == null ? null : quartileOf(globalRank);
  const sameSideQuartile = sameSideRank == null ? null : quartileOf(sameSideRank);
  const qualityMean =
    globalRank == null || sameSideRank == null ? null : (globalRank + sameSideRank) / 2;

  const historyEntry: HistoryEntry = {
    candleTs: row.candleTs,
    confidence,
    direction: rawDirection,
    globalRank,
    sameSideRank,
    globalQuartile,
    sameSideQuartile,
    qualityMean,
    actualDirection: row.actualDirection,
    correct:
      row.actualDirection === "GREEN" || row.actualDirection === "RED"
        ? rawDirection === row.actualDirection
        : null,
  };

  const withRanks: Partial<B4x4Decision> = {
    rawDirection,
    confidence,
    globalRank,
    globalHistoryCount: globalHistory.length,
    globalHistoryStartTs: globalHistory[0]?.candleTs ?? null,
    globalHistoryEndTs: globalHistory[globalHistory.length - 1]?.candleTs ?? null,
    sameSideRank,
    sameSideHistoryCount: sameSideHistory.length,
    sameSideHistoryStartTs: sameSideHistory[0]?.candleTs ?? null,
    sameSideHistoryEndTs: sameSideHistory[sameSideHistory.length - 1]?.candleTs ?? null,
    globalRankQuartile: globalQuartile,
    sameSideRankQuartile: sameSideQuartile,
    qualityMean,
    historyEntry,
  };

  // ---- warmup: total prior valid source rows ----
  if (history.length < MIN_SOURCE_HISTORY) {
    return abstain(withRanks, "ABSTAIN_WARMUP_SOURCE_HISTORY", base);
  }
  if (globalRank == null || sameSideRank == null || qualityMean == null) {
    return abstain(withRanks, "ABSTAIN_SOURCE_HISTORY_INVALID", base);
  }

  // ---- rolling 4x4 grid ----
  // Grid training rows are [max(384, i - 768), i) filtered to resolved rows.
  // There is no minimum resolved-count or cell-count gate; Beta(8,8) smooths.
  const i = history.length;
  const trainStart = Math.max(GRID_REFERENCE_LOOKBACK, i - GRID_TRAINING_LOOKBACK);
  const trainingPool = history
    .slice(trainStart, i)
    .filter((h) => hasValidRanks(h) && h.correct != null);

  const cells = buildGrid(trainingPool);
  const key = cellKey(globalQuartile!, sameSideQuartile!);
  const cell = cells.get(key)!;
  const snapshot = gridSnapshotArray(cells);

  const withGrid: Partial<B4x4Decision> = {
    ...withRanks,
    gridTrainingResolvedCount: trainingPool.length,
    gridTrainingStartTs: trainingPool[0]?.candleTs ?? null,
    gridTrainingEndTs: trainingPool[trainingPool.length - 1]?.candleTs ?? null,
    gridCell: key,
    gridCellResolvedCount: cell.resolvedCount,
    gridCellWins: cell.wins,
    gridCellLosses: cell.losses,
    pCorrect: cell.pCorrect,
    gridSnapshot: snapshot,
  };

  // ---- grid quality percentile ----
  // Reference rows are [max(384, i - 384), i) and INCLUDE unresolved rows.
  const refStart = Math.max(GRID_REFERENCE_LOOKBACK, i - GRID_REFERENCE_LOOKBACK);
  const referencePool = history.slice(refStart, i).filter(hasValidRanks);
  const percentile = gridQualityPercentile(referencePool, cells, cell.pCorrect, qualityMean!);
  const withPercentile: Partial<B4x4Decision> = {
    ...withGrid,
    gridReferenceCount: referencePool.length,
    gridQualityPercentile: percentile,
  };
  if (percentile == null) {
    return abstain(withPercentile, "ABSTAIN_GRID_REFERENCE_INVALID", base);
  }


  // ---- routes ----
  const coreEligible = globalRank! >= CORE_GLOBAL_RANK_MIN && sameSideRank! >= CORE_SAME_SIDE_RANK_MIN;
  const expansionEligible =
    percentile >= EXPANSION_GRID_PERCENTILE_MIN && cell.pCorrect > EXPANSION_P_CORRECT_MIN_EXCLUSIVE;
  const baseCandidate = coreEligible || expansionEligible;
  const selectedRoute: SelectedRoute =
    coreEligible && expansionEligible ? "CORE_AND_EXPANSION"
      : coreEligible ? "CORE"
        : expansionEligible ? "EXPANSION"
          : "NONE";

  const withRoutes: Partial<B4x4Decision> = {
    ...withPercentile,
    coreEligible,
    expansionEligible,
    baseCandidate,
    selectedRoute,
  };

  if (!baseCandidate) return abstain(withRoutes, "ABSTAIN_NO_ACTIVE_ROUTE", base);

  // ---- intraday brake ----
  const brakeActive = daily.dailyNetBefore <= INTRADAY_BRAKE_TRIGGER_NET;
  const brakePasses =
    percentile >= INTRADAY_BRAKE_GRID_PERCENTILE_MIN &&
    cell.pCorrect > INTRADAY_BRAKE_P_CORRECT_MIN_EXCLUSIVE;
  const publish = brakeActive ? brakePasses : true;

  if (!publish) {
    return abstain(
      { ...withRoutes, intradayBrakeActive: true, intradayBrakeVetoFired: true },
      "ABSTAIN_INTRADAY_BRAKE",
      base,
    );
  }

  const reason: DecisionReason =
    selectedRoute === "CORE_AND_EXPANSION" ? "PUBLISH_CORE_AND_EXPANSION"
      : selectedRoute === "CORE" ? "PUBLISH_CORE"
        : "PUBLISH_EXPANSION";

  return {
    ...base,
    ...withRoutes,
    intradayBrakeActive: brakeActive,
    intradayBrakeVetoFired: false,
    finalPrediction: rawDirection,
    wouldTrade: true,
    decisionReason: reason,
  };
}

// ------------------------------------------------------- chronological replay

export interface ReplayResult {
  row: SourceRow;
  decision: B4x4Decision;
  /** WIN / LOSS / PUSH once the source row resolved; null when unresolved. */
  result: "WIN" | "LOSS" | "PUSH" | null;
  resultScore: number;
  baseNoBrakeScore: number;
  coreOnlyScore: number;
  expansionOnlyScore: number;
}

export function scoreAgainst(
  direction: Direction | null,
  actual: ActualDirection | null,
): { result: "WIN" | "LOSS" | "PUSH" | null; score: number } {
  if (direction == null) return { result: null, score: 0 };
  if (actual == null) return { result: null, score: 0 };
  if (actual === "PUSH") return { result: "PUSH", score: 0 };
  const win = direction === actual;
  return { result: win ? "WIN" : "LOSS", score: win ? 1 : -1 };
}

/**
 * Replay B4x4 chronologically over ordered source rows. Used by the historical
 * backfill and by tests; identical decision path to the live orchestrator.
 */
export function replayB4x4(rows: SourceRow[]): ReplayResult[] {
  const history: HistoryEntry[] = [];
  const results: ReplayResult[] = [];
  // Published + resolved outcomes per local date, used for the intraday brake.
  const dailyNet = new Map<string, number>();
  const dailyTrades = new Map<string, number>();

  for (const row of rows) {
    const localDate = b4x4LocalDate(row.candleTs);
    const daily: DailyState = {
      localDate,
      dailyNetBefore: dailyNet.get(localDate) ?? 0,
      dailyResolvedTradeCountBefore: dailyTrades.get(localDate) ?? 0,
    };
    const decision = evaluateB4x4(row, history, daily);
    if (decision.historyEntry) history.push(decision.historyEntry);

    const actual = row.actualDirection;
    const final = scoreAgainst(decision.finalPrediction, actual);
    const baseNoBrake = scoreAgainst(decision.baseCandidate ? decision.rawDirection : null, actual);
    const coreOnly = scoreAgainst(decision.coreEligible ? decision.rawDirection : null, actual);
    const expansionOnly = scoreAgainst(
      decision.expansionEligible ? decision.rawDirection : null,
      actual,
    );

    if (decision.wouldTrade && final.result != null) {
      dailyNet.set(localDate, (dailyNet.get(localDate) ?? 0) + final.score);
      dailyTrades.set(localDate, (dailyTrades.get(localDate) ?? 0) + 1);
    }

    results.push({
      row,
      decision,
      result: final.result,
      resultScore: final.score,
      baseNoBrakeScore: baseNoBrake.score,
      coreOnlyScore: coreOnly.score,
      expansionOnlyScore: expansionOnly.score,
    });
  }
  return results;
}

/** Brake attribution for a resolved row. */
export function brakeAttribution(
  wouldTrade: boolean,
  brakeVetoFired: boolean,
  baseWouldTradeDirection: Direction | null,
  actual: ActualDirection | null,
): { klass: "AVOIDED_LOSS" | "SACRIFICED_WIN" | "NO_INCREMENTAL_CHANGE"; value: number } {
  if (wouldTrade || !brakeVetoFired || baseWouldTradeDirection == null || actual == null ||
      actual === "PUSH") {
    return { klass: "NO_INCREMENTAL_CHANGE", value: 0 };
  }
  return baseWouldTradeDirection === actual
    ? { klass: "SACRIFICED_WIN", value: -1 }
    : { klass: "AVOIDED_LOSS", value: 1 };
}
