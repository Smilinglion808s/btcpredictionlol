// B4x4 — pure decision engine. No I/O, no clock reads, fully deterministic.
//
// B4x4 consumes the canonical prediction-time A2_Combined probability, ranks it
// against prior raw A2 predictions, scores it through a rolling 4x4 correctness
// grid, and publishes via the CORE / EXPANSION routes with an intraday loss
// brake. It never reverses the A2 direction.

import {
  BETA_PRIOR_ALPHA,
  BETA_PRIOR_BETA,
  CALIBRATION_PROMOTION_HISTORY_POOL,
  CALIBRATION_PROMOTION_HISTORY_WINDOW,
  CALIBRATION_PROMOTION_MIN_P_CORRECT,
  CALIBRATION_PROMOTION_MIN_Z_SCORE,
  CALIBRATION_PROMOTION_OUTCOME_DELAY_MS,
  CALIBRATION_PROMOTION_VERSION,
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
export type SelectedRoute =
  | "CORE"
  | "EXPANSION"
  | "CORE_AND_EXPANSION"
  | "CALIBRATION_PROMOTION"
  | "NONE";

export type CalibrationEligibilityReason =
  | "NOT_APPLICABLE_EXISTING_BASE_ROUTE"
  | "NOT_APPLICABLE_NOT_EVALUATED"
  | "HISTORY_NOT_READY"
  | "CURRENT_P_CORRECT_INVALID"
  | "CURRENT_P_CORRECT_BELOW_MIN"
  | "HISTORY_VARIANCE_INVALID"
  | "Z_SCORE_BELOW_MIN"
  | "PROMOTED_BEFORE_BRAKE"
  | "PROMOTED_AND_PUBLISHED"
  | "PROMOTED_BUT_BRAKE_VETOED";

export type DecisionReason =
  | "PUBLISH_CORE"
  | "PUBLISH_EXPANSION"
  | "PUBLISH_CORE_AND_EXPANSION"
  | "PUBLISH_CALIBRATION_PROMOTION"
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
  /** Run mode of the B4x4 row this source produced (calibration availability). */
  runMode?: "LIVE" | "BACKFILL" | null;
  operationalGapStatus?: string | null;
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
  // ---- prediction-time fields used by the calibration promotion pool ----
  /** Stored prediction-time grid probability of correctness. Never recomputed. */
  pCorrect?: number | null;
  gridCell?: string | null;
  gridWindowIntegrityPassed?: boolean | null;
  /** Frozen original B4x4 base decision (Core / Expansion eligibility). */
  baseCandidate?: boolean;
  /** 'LIVE' rows respect the resolver delay; 'BACKFILL' rows are already resolved. */
  runMode?: "LIVE" | "BACKFILL" | null;
  operationalGapStatus?: string | null;
  predictionId?: string | null;
}

/** Prediction-time calibration-promotion audit block. */
export interface CalibrationPromotion {
  version: string;
  historyWindow: number;
  historyPool: string;
  historyCount: number;
  historyReady: boolean;
  rawDirection: Direction | null;
  historyStartTs: string | null;
  historyEndTs: string | null;
  historyAsOfTs: string | null;
  historyWins: number | null;
  historyLosses: number | null;
  expectedWins: number | null;
  observedWinRate: number | null;
  expectedWinRate: number | null;
  variance: number | null;
  standardDeviation: number | null;
  residualWins: number | null;
  zScore: number | null;
  minPCorrect: number;
  minZScore: number;
  historyIdsHash: string | null;
  eligibilityReason: CalibrationEligibilityReason;
  conditionMet: boolean;
  candidateBeforeBrake: boolean;
  brakeVetoed: boolean;
  published: boolean;
  postCalibrationCandidate: boolean;
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
  calibration: CalibrationPromotion;
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

/** Empty (not-evaluated) calibration audit block. */
export function emptyCalibration(
  reason: CalibrationEligibilityReason = "NOT_APPLICABLE_NOT_EVALUATED",
): CalibrationPromotion {
  return {
    version: CALIBRATION_PROMOTION_VERSION,
    historyWindow: CALIBRATION_PROMOTION_HISTORY_WINDOW,
    historyPool: CALIBRATION_PROMOTION_HISTORY_POOL,
    historyCount: 0,
    historyReady: false,
    rawDirection: null,
    historyStartTs: null,
    historyEndTs: null,
    historyAsOfTs: null,
    historyWins: null,
    historyLosses: null,
    expectedWins: null,
    observedWinRate: null,
    expectedWinRate: null,
    variance: null,
    standardDeviation: null,
    residualWins: null,
    zScore: null,
    minPCorrect: CALIBRATION_PROMOTION_MIN_P_CORRECT,
    minZScore: CALIBRATION_PROMOTION_MIN_Z_SCORE,
    historyIdsHash: null,
    eligibilityReason: reason,
    conditionMet: false,
    candidateBeforeBrake: false,
    brakeVetoed: false,
    published: false,
    postCalibrationCandidate: false,
  };
}

/** Deterministic FNV-1a hash over the ordered promotion history identity. */
export function calibrationHistoryHash(entries: HistoryEntry[]): string {
  let h = 0x811c9dc5;
  const push = (s: string) => {
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 0x01000193) >>> 0;
    }
  };
  for (const e of entries) {
    push(
      [
        e.predictionId ?? "",
        e.candleTs,
        e.direction,
        e.actualDirection ?? "",
        String(e.pCorrect ?? ""),
      ].join("|") + ";",
    );
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

/**
 * Eligible same-direction no-active-route history for the promotion pool.
 * Only outcomes that were genuinely knowable at `decisionAsOfMs` are used.
 */
export function calibrationHistoryPool(
  history: HistoryEntry[],
  rawDirection: Direction,
  decisionAsOfMs: number,
): HistoryEntry[] {
  const out: HistoryEntry[] = [];
  for (let i = history.length - 1; i >= 0; i--) {
    const e = history[i]!;
    if (e.direction !== rawDirection) continue;
    if (e.baseCandidate !== false) continue;
    // legacy rows predate the integrity column; only an explicit false disqualifies
    if (e.gridWindowIntegrityPassed === false) continue;
    if (e.gridCell == null) continue;
    if (e.pCorrect == null || !Number.isFinite(e.pCorrect)) continue;
    if (e.actualDirection !== "GREEN" && e.actualDirection !== "RED") continue;
    if (e.operationalGapStatus === "CATCHUP") continue;
    // LIVE outcomes only become knowable after the production resolver delay;
    // BACKFILL rows are historical and already resolved when replayed.
    if (e.runMode !== "BACKFILL") {
      const availableAt =
        new Date(e.candleTs).getTime() + CALIBRATION_PROMOTION_OUTCOME_DELAY_MS;
      if (!(availableAt <= decisionAsOfMs)) continue;
    }
    out.push(e);
    if (out.length === CALIBRATION_PROMOTION_HISTORY_WINDOW) break;
  }
  return out.reverse();
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

/** Optional evaluation context (defaults reproduce the frozen replay exactly). */
export interface B4x4EvalOptions {
  /**
   * Instant the decision is taken. Defaults to the target candle timestamp,
   * which is when the live prediction is produced.
   */
  decisionAsOfMs?: number;
  /** Calibration promotion route master switch (activation boundary gate). */
  promotionEnabled?: boolean;
}

/**
 * Evaluate one source row against its strictly-earlier history.
 * `history` must be ordered oldest → newest and contain only valid prior rows.
 */
export function evaluateB4x4(
  row: SourceRow,
  history: HistoryEntry[],
  daily: DailyState,
  opts: B4x4EvalOptions = {},
): B4x4Decision {
  const decisionAsOfMs = opts.decisionAsOfMs ?? new Date(row.candleTs).getTime();
  const promotionEnabled = opts.promotionEnabled !== false;
  const localDate = daily.localDate || b4x4LocalDate(row.candleTs);
  const base: B4x4Decision = {
    probabilityGreen: row.probabilityGreen,
    rawDirection: null,
    confidence: null,
    dataValid: true,
    dataInvalidReason: null,
    sourceIndexAbsolute: history.length,
    globalRank: null,
    globalHistoryCount: 0,
    globalHistoryStartTs: null,
    globalHistoryEndTs: null,
    globalHistoryStartIndex: null,
    globalHistoryEndIndex: null,
    sameSideRank: null,
    sameSideHistoryCount: 0,
    sameSideHistoryStartTs: null,
    sameSideHistoryEndTs: null,
    sameSideInputSourceCount: 0,
    sameSideFilteredCount: 0,
    sameSideHistoryStartIndex: null,
    sameSideHistoryEndIndex: null,
    sameSideRawDirectionFilter: null,
    globalRankQuartile: null,
    sameSideRankQuartile: null,
    qualityMean: null,
    gridTrainingResolvedCount: 0,
    gridTrainingSourceCount: 0,
    gridTrainingStartIndex: null,
    gridTrainingEndIndex: null,
    gridTrainingStartTs: null,
    gridTrainingEndTs: null,
    gridWindowIntegrityPassed: null,
    gridWindowIntegrityReason: null,
    gridCell: null,
    gridCellResolvedCount: null,
    gridCellWins: null,
    gridCellLosses: null,
    pCorrect: null,
    gridReferenceCount: 0,
    gridReferenceSourceCount: 0,
    gridReferenceStartIndex: null,
    gridReferenceEndIndex: null,
    gridReferenceStartTs: null,
    gridReferenceEndTs: null,
    gridQualityPercentile: null,
    gridSnapshot: null,

    coreEligible: false,
    expansionEligible: false,
    baseCandidate: false,
    selectedRoute: "NONE",
    calibration: emptyCalibration(),
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
  // `history` MUST be the complete valid canonical source stream since the
  // frozen epoch, oldest → newest, so history.length is the absolute source
  // position i of the current row and every window below is absolute.
  const iAbs = history.length;
  // Global rank: previous 384 valid source positions [i-384, i).
  const globalStartIdx = Math.max(0, iAbs - GLOBAL_CONFIDENCE_LOOKBACK);
  const globalHistory = history.slice(globalStartIdx, iAbs);
  // Same-side rank: previous 768 valid source positions [i-768, i), THEN
  // filtered to this row's raw direction.
  const sameSideStartIdx = Math.max(0, iAbs - SAME_SIDE_CONFIDENCE_LOOKBACK);
  const sameSideWindow = history.slice(sameSideStartIdx, iAbs);
  const sameSideHistory = sameSideWindow.filter((h) => h.direction === rawDirection);

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
    predictionId: row.predictionId ?? null,
    runMode: row.runMode ?? null,
    operationalGapStatus: row.operationalGapStatus ?? null,
    pCorrect: null,
    gridCell: null,
    gridWindowIntegrityPassed: null,
    baseCandidate: false,
  };

  const withRanks: Partial<B4x4Decision> = {
    rawDirection,
    confidence,
    globalRank,
    globalHistoryCount: globalHistory.length,
    globalHistoryStartTs: globalHistory[0]?.candleTs ?? null,
    globalHistoryEndTs: globalHistory[globalHistory.length - 1]?.candleTs ?? null,
    globalHistoryStartIndex: globalHistory.length ? globalStartIdx : null,
    globalHistoryEndIndex: globalHistory.length ? iAbs - 1 : null,
    sameSideRank,
    sameSideHistoryCount: sameSideHistory.length,
    sameSideHistoryStartTs: sameSideHistory[0]?.candleTs ?? null,
    sameSideHistoryEndTs: sameSideHistory[sameSideHistory.length - 1]?.candleTs ?? null,
    sameSideInputSourceCount: sameSideWindow.length,
    sameSideFilteredCount: sameSideHistory.length,
    sameSideHistoryStartIndex: sameSideWindow.length ? sameSideStartIdx : null,
    sameSideHistoryEndIndex: sameSideWindow.length ? iAbs - 1 : null,
    sameSideRawDirectionFilter: rawDirection,
    globalRankQuartile: globalQuartile,
    sameSideRankQuartile: sameSideQuartile,
    qualityMean,
    historyEntry,
  };

  // ---- warmup: total prior valid source rows ----
  if (iAbs < MIN_SOURCE_HISTORY) {
    return abstain(withRanks, "ABSTAIN_WARMUP_SOURCE_HISTORY", base);
  }
  if (globalRank == null || sameSideRank == null || qualityMean == null) {
    return abstain(withRanks, "ABSTAIN_SOURCE_HISTORY_INVALID", base);
  }

  // ---- rolling 4x4 grid ----
  // Absolute training window [max(384, i - 768), i), filtered to resolved rows
  // for outcomes only. Beta(8,8) smooths; there is no cell-count gate.
  const i = iAbs;
  const trainStart = Math.max(GRID_REFERENCE_LOOKBACK, i - GRID_TRAINING_LOOKBACK);
  const trainingWindow = history.slice(trainStart, i);
  const trainingPool = trainingWindow.filter((h) => hasValidRanks(h) && h.correct != null);

  const cells = buildGrid(trainingPool);
  const key = cellKey(globalQuartile!, sameSideQuartile!);
  const cell = cells.get(key)!;
  const snapshot = gridSnapshotArray(cells);

  const expectedTrainingSources = i - trainStart;
  const integrityPassed = trainingWindow.length === expectedTrainingSources;
  const withGrid: Partial<B4x4Decision> = {
    ...withRanks,
    gridTrainingResolvedCount: trainingPool.length,
    gridTrainingSourceCount: trainingWindow.length,
    gridTrainingStartIndex: trainingWindow.length ? trainStart : null,
    gridTrainingEndIndex: trainingWindow.length ? i - 1 : null,
    gridTrainingStartTs: trainingWindow[0]?.candleTs ?? null,
    gridTrainingEndTs: trainingWindow[trainingWindow.length - 1]?.candleTs ?? null,
    gridWindowIntegrityPassed: integrityPassed,
    gridWindowIntegrityReason: integrityPassed
      ? null
      : `grid_training_source_count=${trainingWindow.length} expected=${expectedTrainingSources}`,
    gridCell: key,
    gridCellResolvedCount: cell.resolvedCount,
    gridCellWins: cell.wins,
    gridCellLosses: cell.losses,
    pCorrect: cell.pCorrect,
    gridSnapshot: snapshot,
  };

  if (!integrityPassed) {
    return abstain(withGrid, "ABSTAIN_B4X4_GRID_HISTORY_INCOMPLETE", base);
  }

  // ---- grid quality percentile ----
  // Reference rows are [max(384, i - 384), i) and INCLUDE unresolved rows.
  const refStart = Math.max(GRID_REFERENCE_LOOKBACK, i - GRID_REFERENCE_LOOKBACK);
  const referenceWindow = history.slice(refStart, i);
  const referencePool = referenceWindow.filter(hasValidRanks);
  const percentile = gridQualityPercentile(referencePool, cells, cell.pCorrect, qualityMean!);
  const withPercentile: Partial<B4x4Decision> = {
    ...withGrid,
    gridReferenceCount: referencePool.length,
    gridReferenceSourceCount: referenceWindow.length,
    gridReferenceStartIndex: referenceWindow.length ? refStart : null,
    gridReferenceEndIndex: referenceWindow.length ? i - 1 : null,
    gridReferenceStartTs: referenceWindow[0]?.candleTs ?? null,
    gridReferenceEndTs: referenceWindow[referenceWindow.length - 1]?.candleTs ?? null,
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
  let selectedRoute: SelectedRoute =
    coreEligible && expansionEligible ? "CORE_AND_EXPANSION"
      : coreEligible ? "CORE"
        : expansionEligible ? "EXPANSION"
          : "NONE";

  // The frozen prediction-time facts this row contributes to later pools.
  historyEntry.pCorrect = cell.pCorrect;
  historyEntry.gridCell = key;
  historyEntry.gridWindowIntegrityPassed = integrityPassed;
  historyEntry.baseCandidate = baseCandidate;

  // ---- calibration promotion (only when no base route exists) ----
  const calibration = emptyCalibration(
    baseCandidate ? "NOT_APPLICABLE_EXISTING_BASE_ROUTE" : "HISTORY_NOT_READY",
  );
  let promoted = false;

  if (!baseCandidate && promotionEnabled) {
    calibration.rawDirection = rawDirection;
    const pool = calibrationHistoryPool(history, rawDirection, decisionAsOfMs);
    calibration.historyCount = pool.length;
    calibration.historyStartTs = pool[0]?.candleTs ?? null;
    calibration.historyEndTs = pool[pool.length - 1]?.candleTs ?? null;
    calibration.historyAsOfTs = new Date(decisionAsOfMs).toISOString();
    calibration.historyIdsHash = pool.length ? calibrationHistoryHash(pool) : null;
    calibration.historyReady = pool.length === CALIBRATION_PROMOTION_HISTORY_WINDOW;

    if (!calibration.historyReady) {
      calibration.eligibilityReason = "HISTORY_NOT_READY";
    } else {
      let historyWins = 0;
      let expectedWins = 0;
      let variance = 0;
      for (const e of pool) {
        const p = e.pCorrect!;
        if (e.direction === e.actualDirection) historyWins++;
        expectedWins += p;
        variance += p * (1 - p);
      }
      const historyLosses = CALIBRATION_PROMOTION_HISTORY_WINDOW - historyWins;
      const standardDeviation = Math.sqrt(variance);
      const residualWins = historyWins - expectedWins;
      const zScore = residualWins / standardDeviation;
      calibration.historyWins = historyWins;
      calibration.historyLosses = historyLosses;
      calibration.expectedWins = expectedWins;
      calibration.variance = variance;
      calibration.standardDeviation = standardDeviation;
      calibration.residualWins = residualWins;
      calibration.observedWinRate = historyWins / CALIBRATION_PROMOTION_HISTORY_WINDOW;
      calibration.expectedWinRate = expectedWins / CALIBRATION_PROMOTION_HISTORY_WINDOW;
      calibration.zScore = Number.isFinite(zScore) ? zScore : null;

      const currentPCorrect = cell.pCorrect;
      if (!Number.isFinite(currentPCorrect)) {
        calibration.eligibilityReason = "CURRENT_P_CORRECT_INVALID";
      } else if (!(variance > 0) || !Number.isFinite(zScore)) {
        calibration.eligibilityReason = "HISTORY_VARIANCE_INVALID";
      } else if (currentPCorrect < CALIBRATION_PROMOTION_MIN_P_CORRECT) {
        calibration.eligibilityReason = "CURRENT_P_CORRECT_BELOW_MIN";
      } else if (zScore < CALIBRATION_PROMOTION_MIN_Z_SCORE) {
        calibration.eligibilityReason = "Z_SCORE_BELOW_MIN";
      } else {
        promoted = true;
        calibration.conditionMet = true;
        calibration.candidateBeforeBrake = true;
        calibration.postCalibrationCandidate = true;
        calibration.eligibilityReason = "PROMOTED_BEFORE_BRAKE";
        selectedRoute = "CALIBRATION_PROMOTION";
      }
    }
  }

  const withRoutes: Partial<B4x4Decision> = {
    ...withPercentile,
    coreEligible,
    expansionEligible,
    baseCandidate,
    selectedRoute,
    calibration,
  };

  if (!baseCandidate && !promoted) {
    return abstain(withRoutes, "ABSTAIN_NO_ACTIVE_ROUTE", base);
  }

  // ---- intraday brake ----
  const brakeActive = daily.dailyNetBefore <= INTRADAY_BRAKE_TRIGGER_NET;
  const brakePasses =
    percentile >= INTRADAY_BRAKE_GRID_PERCENTILE_MIN &&
    cell.pCorrect > INTRADAY_BRAKE_P_CORRECT_MIN_EXCLUSIVE;
  const publish = brakeActive ? brakePasses : true;

  if (!publish) {
    if (promoted) {
      calibration.brakeVetoed = true;
      calibration.eligibilityReason = "PROMOTED_BUT_BRAKE_VETOED";
    }
    return abstain(
      { ...withRoutes, intradayBrakeActive: true, intradayBrakeVetoFired: true },
      "ABSTAIN_INTRADAY_BRAKE",
      base,
    );
  }

  if (promoted) {
    calibration.published = true;
    calibration.eligibilityReason = "PROMOTED_AND_PUBLISHED";
  }

  const reason: DecisionReason =
    promoted ? "PUBLISH_CALIBRATION_PROMOTION"
      : selectedRoute === "CORE_AND_EXPANSION" ? "PUBLISH_CORE_AND_EXPANSION"
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
export function replayB4x4(
  rows: SourceRow[],
  opts: B4x4EvalOptions = {},
): ReplayResult[] {
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
    const decision = evaluateB4x4(row, history, daily, opts);
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
