// B4x4-ES1 decision engine — pure, deterministic, frozen.
//
// First-match decision order (never reordered, never extended):
//   1 data/timing → 2 price readiness → 3 price direction → 4 OB fade / price
//   fallback → 5 A2 pin → 6 agreement → 7 rank readiness → 8 combined rank
//   → 9 B4 validity → 10 B4 pCorrect → 11 publish.

import {
  B4_GUARD_MIN_P_CORRECT,
  B4_READY_MIN_SOURCE_INDEX,
  COMBINED_CONFIDENCE_MIN,
  CONFIDENCE_RANK_WINDOW,
  GRID_OUTCOME_DELAY_MS,
  GRID_PRIOR_ALPHA,
  GRID_PRIOR_BETA,
  GRID_REFERENCE_WINDOW,
  GRID_TRAINING_WINDOW,
  GLOBAL_RANK_WINDOW,
  OB_ABS_IMBALANCE_PERCENTILE,
  OB_HISTORY_WINDOW,
  OB_MIN_HISTORY,
  SAME_SIDE_SOURCE_WINDOW,
} from "./config";
import { quantile } from "./priceHead";
import type { ActualDirection, Direction } from "./features";

export type { ActualDirection, Direction };

export type Es1Route = "PRICE_RIDGE8" | "OB_DEPTH10_FADE";

export interface Es1HistoryEntry {
  targetTs: string;
  /** Absolute raw-prediction index (>= 0 from the pinned raw epoch). */
  sourceIndex: number | null;
  direction: Direction;
  evidence: number;
  priceConfidence: number;
  a2Confidence: number | null;
  cell: string | null;
  /** Prediction-time pCorrect of that row (audit reference pool). */
  pCorrect: number | null;
  actualDirection: ActualDirection | null;
}

export interface ObSnapshot {
  targetTs: string;
  snapshotTs: string | null;
  captureStatus: string | null;
  bookComplete: boolean | null;
  depthImbalance10bps: number | null;
}

export interface Es1Input {
  targetTs: string;
  featureCutoffTs: string | null;
  latestSourceTs: string | null;
  featureVector: number[] | null;
  featureValues: Record<string, number> | null;
  featureVectorHash: string | null;
  featureValid: boolean;
  featureInvalidReason: string | null;
  /** Latest canonical source candle must equal target - 15m. */
  timingValid: boolean;
  timingInvalidReason: string | null;
  priceProbabilityGreen: number | null;
  priceFitId: string | null;
  a2ProbabilityGreen: number | null;
  a2RowId: string | null;
  a2PredictionId: string | null;
  /** Absolute raw source index for this target (null before the raw epoch). */
  sourceIndexAbsolute: number | null;
  obSnapshot: ObSnapshot | null;
  /** Prior valid absolute depth values, oldest → newest (max 96). */
  obHistory: Array<{ targetTs: string; absDepth: number }>;
}

export interface Es1Decision {
  // price head
  priceProbabilityGreen: number | null;
  priceDirection: Direction | null;
  priceConfidence: number | null;
  priceFitId: string | null;
  // order book
  obSnapshotTs: string | null;
  obCaptureStatus: string | null;
  obBookComplete: boolean | null;
  obDepthImbalance10bps: number | null;
  obAbsDepth: number | null;
  obHistoryCount: number;
  obHistoryStartTs: string | null;
  obHistoryEndTs: string | null;
  obHistoryCap: number | null;
  obAbsPercentile: number | null;
  obRouteQualified: boolean;
  obRouteRejectReason: string | null;
  // hybrid
  hybridDirection: Direction | null;
  hybridEvidence: number | null;
  hybridRoute: Es1Route | null;
  // A2
  a2ProbabilityGreen: number | null;
  a2Direction: Direction | null;
  a2Confidence: number | null;
  a2Agrees: boolean | null;
  // ranks
  priceConfidenceRank: number | null;
  priceRankHistoryCount: number;
  a2ConfidenceRank: number | null;
  a2RankHistoryCount: number;
  combinedConfidenceRank: number | null;
  combinedRankQualified: boolean | null;
  // B4 grid
  sourceIndexAbsolute: number | null;
  b4GlobalRank: number | null;
  b4GlobalHistoryCount: number;
  b4SameSideRank: number | null;
  b4SameSideInputCount: number;
  b4SameSideHistoryCount: number;
  b4GlobalQuartile: number | null;
  b4SameSideQuartile: number | null;
  b4Cell: string | null;
  b4TrainingStartIndex: number | null;
  b4TrainingEndIndex: number | null;
  b4ReferenceStartIndex: number | null;
  b4ReferenceEndIndex: number | null;
  b4CellWins: number | null;
  b4CellLosses: number | null;
  b4CellResolvedCount: number | null;
  b4PCorrect: number | null;
  b4QualityPercentile: number | null;
  b4ReferenceCount: number;
  b4Ready: boolean;
  b4NotReadyReason: string | null;
  b4GuardVetoFired: boolean;
  // outcome of the decision chain
  alignedCandidateBeforeB4: boolean;
  alignedCandidateDirection: Direction | null;
  withoutB4GuardWouldTrade: boolean;
  withoutB4GuardDirection: Direction | null;
  withoutB4GuardDecisionReason: string;
  finalPrediction: Direction | null;
  wouldTrade: boolean;
  decisionReason: string;
  dataValid: boolean;
  dataInvalidReason: string | null;
  /** History entry to append for downstream rows (null when no raw prediction). */
  historyEntry: Es1HistoryEntry | null;
}

export function empiricalRank(previous: readonly number[], current: number): number | null {
  if (previous.length === 0) return null;
  let below = 0;
  for (const v of previous) if (v <= current) below++;
  return below / previous.length;
}

/** quartile = min(4, floor(rank * 4) + 1) */
export function quartileOf(rank: number): number {
  return Math.min(4, Math.floor(rank * 4) + 1);
}

export function cellKey(globalQuartile: number, sameSideQuartile: number): string {
  return `G${globalQuartile}-S${sameSideQuartile}`;
}

export function betaPCorrect(wins: number, resolvedCount: number): number {
  return (wins + GRID_PRIOR_ALPHA) / (resolvedCount + GRID_PRIOR_ALPHA + GRID_PRIOR_BETA);
}

export function scoreAgainst(
  direction: Direction | null,
  actual: ActualDirection | null,
): { result: "WIN" | "LOSS" | "PUSH" | null; score: number } {
  if (!direction || !actual) return { result: null, score: 0 };
  if (actual === "PUSH") return { result: "PUSH", score: 0 };
  return direction === actual ? { result: "WIN", score: 1 } : { result: "LOSS", score: -1 };
}

function emptyDecision(reason: string, dataInvalidReason: string | null): Es1Decision {
  return {
    priceProbabilityGreen: null,
    priceDirection: null,
    priceConfidence: null,
    priceFitId: null,
    obSnapshotTs: null,
    obCaptureStatus: null,
    obBookComplete: null,
    obDepthImbalance10bps: null,
    obAbsDepth: null,
    obHistoryCount: 0,
    obHistoryStartTs: null,
    obHistoryEndTs: null,
    obHistoryCap: null,
    obAbsPercentile: null,
    obRouteQualified: false,
    obRouteRejectReason: null,
    hybridDirection: null,
    hybridEvidence: null,
    hybridRoute: null,
    a2ProbabilityGreen: null,
    a2Direction: null,
    a2Confidence: null,
    a2Agrees: null,
    priceConfidenceRank: null,
    priceRankHistoryCount: 0,
    a2ConfidenceRank: null,
    a2RankHistoryCount: 0,
    combinedConfidenceRank: null,
    combinedRankQualified: null,
    sourceIndexAbsolute: null,
    b4GlobalRank: null,
    b4GlobalHistoryCount: 0,
    b4SameSideRank: null,
    b4SameSideInputCount: 0,
    b4SameSideHistoryCount: 0,
    b4GlobalQuartile: null,
    b4SameSideQuartile: null,
    b4Cell: null,
    b4TrainingStartIndex: null,
    b4TrainingEndIndex: null,
    b4ReferenceStartIndex: null,
    b4ReferenceEndIndex: null,
    b4CellWins: null,
    b4CellLosses: null,
    b4CellResolvedCount: null,
    b4PCorrect: null,
    b4QualityPercentile: null,
    b4ReferenceCount: 0,
    b4Ready: false,
    b4NotReadyReason: null,
    b4GuardVetoFired: false,
    alignedCandidateBeforeB4: false,
    alignedCandidateDirection: null,
    withoutB4GuardWouldTrade: false,
    withoutB4GuardDirection: null,
    withoutB4GuardDecisionReason: reason,
    finalPrediction: null,
    wouldTrade: false,
    decisionReason: reason,
    dataValid: dataInvalidReason == null,
    dataInvalidReason,
    historyEntry: null,
  };
}

/**
 * Evaluate one target. `history` is the ordered stream of prior RAW ES1 rows
 * (oldest → newest, strictly before this target).
 */
export function decideEs1(input: Es1Input, history: readonly Es1HistoryEntry[]): Es1Decision {
  // ---- 1. canonical data + timing ----
  if (!input.timingValid || !input.featureValid || !input.featureVector) {
    return emptyDecision(
      "ABSTAIN_DATA_OR_TIMING_INVALID",
      input.timingInvalidReason ?? input.featureInvalidReason ?? "invalid",
    );
  }

  const d = emptyDecision("ABSTAIN_ES1_PRICE_NOT_READY", null);

  // ---- 2/3. price head ----
  const p = input.priceProbabilityGreen;
  if (p == null || !Number.isFinite(p) || !input.priceFitId) {
    return d;
  }
  d.priceProbabilityGreen = p;
  d.priceDirection = p >= 0.5 ? "GREEN" : "RED";
  d.priceConfidence = Math.abs(p - 0.5);
  d.priceFitId = input.priceFitId;

  // ---- 4. order-book fade route or price fallback ----
  const snap = input.obSnapshot;
  d.obSnapshotTs = snap?.snapshotTs ?? null;
  d.obCaptureStatus = snap?.captureStatus ?? null;
  d.obBookComplete = snap?.bookComplete ?? null;
  d.obDepthImbalance10bps = snap?.depthImbalance10bps ?? null;
  const history96 = input.obHistory.slice(-OB_HISTORY_WINDOW);
  d.obHistoryCount = history96.length;
  d.obHistoryStartTs = history96[0]?.targetTs ?? null;
  d.obHistoryEndTs = history96[history96.length - 1]?.targetTs ?? null;

  const depth = snap?.depthImbalance10bps;
  const snapshotValid =
    snap != null &&
    snap.bookComplete === true &&
    depth != null &&
    Number.isFinite(depth) &&
    snap.snapshotTs != null &&
    new Date(snap.snapshotTs).getTime() <= new Date(input.targetTs).getTime() - 1;

  if (!snapshotValid) {
    d.obRouteRejectReason = snap == null ? "NO_SNAPSHOT" : "SNAPSHOT_INVALID";
  } else {
    const absDepth = Math.abs(depth!);
    d.obAbsDepth = absDepth;
    if (history96.length < OB_MIN_HISTORY) {
      d.obRouteRejectReason = "INSUFFICIENT_OB_HISTORY";
    } else {
      const values = history96
        .map((h) => h.absDepth)
        .slice()
        .sort((a, b) => a - b);
      const cap = quantile(values, OB_ABS_IMBALANCE_PERCENTILE);
      d.obHistoryCap = cap;
      d.obAbsPercentile = empiricalRank(values, absDepth);
      if (absDepth <= cap) d.obRouteQualified = true;
      else d.obRouteRejectReason = "ABOVE_P60_CAP";
    }
  }

  if (d.obRouteQualified) {
    d.hybridDirection = (d.obDepthImbalance10bps as number) >= 0 ? "RED" : "GREEN";
    d.hybridEvidence = 1 - (d.obAbsPercentile as number);
    d.hybridRoute = "OB_DEPTH10_FADE";
  } else {
    d.hybridDirection = d.priceDirection;
    d.hybridEvidence = d.priceConfidence;
    d.hybridRoute = "PRICE_RIDGE8";
  }

  // ---- ES1 B4 grid inputs (computed for every raw row, guard applied later) ----
  d.sourceIndexAbsolute = input.sourceIndexAbsolute;
  const idx = input.sourceIndexAbsolute;
  const indexed = history.filter((h) => h.sourceIndex != null);
  if (idx != null) {
    const globalHistory = indexed
      .filter((h) => h.sourceIndex! >= idx - GLOBAL_RANK_WINDOW && h.sourceIndex! < idx)
      .map((h) => h.evidence)
      .filter((v) => Number.isFinite(v));
    d.b4GlobalHistoryCount = globalHistory.length;
    d.b4GlobalRank = empiricalRank(globalHistory, d.hybridEvidence!);

    const prior768 = indexed.filter(
      (h) => h.sourceIndex! >= idx - SAME_SIDE_SOURCE_WINDOW && h.sourceIndex! < idx,
    );
    d.b4SameSideInputCount = prior768.length;
    const sameSide = prior768
      .filter((h) => h.direction === d.hybridDirection)
      .map((h) => h.evidence)
      .filter((v) => Number.isFinite(v));
    d.b4SameSideHistoryCount = sameSide.length;
    d.b4SameSideRank = empiricalRank(sameSide, d.hybridEvidence!);

    if (d.b4GlobalRank != null && d.b4SameSideRank != null) {
      d.b4GlobalQuartile = quartileOf(d.b4GlobalRank);
      d.b4SameSideQuartile = quartileOf(d.b4SameSideRank);
      d.b4Cell = cellKey(d.b4GlobalQuartile, d.b4SameSideQuartile);

      const trainStart = Math.max(GLOBAL_RANK_WINDOW, idx - GRID_TRAINING_WINDOW);
      const refStart = Math.max(GLOBAL_RANK_WINDOW, idx - GRID_REFERENCE_WINDOW);
      d.b4TrainingStartIndex = trainStart;
      d.b4TrainingEndIndex = idx;
      d.b4ReferenceStartIndex = refStart;
      d.b4ReferenceEndIndex = idx;

      const currentMs = new Date(input.targetTs).getTime();
      const available = (h: Es1HistoryEntry) =>
        new Date(h.targetTs).getTime() + GRID_OUTCOME_DELAY_MS <= currentMs;
      let wins = 0;
      let losses = 0;
      for (const h of indexed) {
        if (h.sourceIndex! < trainStart || h.sourceIndex! >= idx) continue;
        if (h.cell !== d.b4Cell) continue;
        if (h.actualDirection !== "GREEN" && h.actualDirection !== "RED") continue;
        if (!available(h)) continue;
        if (h.direction === h.actualDirection) wins++;
        else losses++;
      }
      d.b4CellWins = wins;
      d.b4CellLosses = losses;
      d.b4CellResolvedCount = wins + losses;
      d.b4PCorrect = betaPCorrect(wins, wins + losses);

      const reference = indexed
        .filter((h) => h.sourceIndex! >= refStart && h.sourceIndex! < idx)
        .map((h) => h.pCorrect)
        .filter((v): v is number => v != null && Number.isFinite(v));
      d.b4ReferenceCount = reference.length;
      d.b4QualityPercentile = empiricalRank(reference, d.b4PCorrect);
    }
  }

  d.b4Ready =
    idx != null &&
    idx >= B4_READY_MIN_SOURCE_INDEX &&
    d.b4GlobalRank != null &&
    d.b4SameSideRank != null &&
    d.b4Cell != null &&
    d.b4PCorrect != null &&
    Number.isFinite(d.b4PCorrect) &&
    d.b4ReferenceCount >= 1;
  if (!d.b4Ready) {
    d.b4NotReadyReason =
      idx == null
        ? "BEFORE_RAW_EPOCH"
        : idx < B4_READY_MIN_SOURCE_INDEX
          ? "SOURCE_INDEX_IMMATURE"
          : d.b4GlobalRank == null || d.b4SameSideRank == null
            ? "RANK_UNAVAILABLE"
            : d.b4PCorrect == null
              ? "PCORRECT_UNAVAILABLE"
              : "REFERENCE_EMPTY";
  }

  // Raw row is recorded regardless of what happens from step 5 onward.
  d.historyEntry = {
    targetTs: input.targetTs,
    sourceIndex: input.sourceIndexAbsolute,
    direction: d.hybridDirection!,
    evidence: d.hybridEvidence!,
    priceConfidence: d.priceConfidence!,
    a2Confidence: null,
    cell: d.b4Cell,
    pCorrect: d.b4PCorrect,
    actualDirection: null,
  };

  // ---- 5. pinned A2 probability ----
  const a2 = input.a2ProbabilityGreen;
  if (a2 == null || !Number.isFinite(a2) || a2 < 0 || a2 > 1) {
    d.decisionReason = "ABSTAIN_A2_MISSING_OR_INVALID";
    d.withoutB4GuardDecisionReason = d.decisionReason;
    return d;
  }
  d.a2ProbabilityGreen = a2;
  d.a2Direction = a2 >= 0.5 ? "GREEN" : "RED";
  d.a2Confidence = Math.abs(a2 - 0.5);
  d.historyEntry.a2Confidence = d.a2Confidence;
  d.a2Agrees = d.a2Direction === d.hybridDirection;

  // ---- 6. agreement ----
  if (!d.a2Agrees) {
    d.decisionReason = "ABSTAIN_ES1_A2_DISAGREE";
    d.withoutB4GuardDecisionReason = d.decisionReason;
    return d;
  }

  // ---- 7. causal confidence ranks ----
  // Frozen semantics: only RAW ES1 rows (sourceIndex != null, i.e. at or after
  // the raw epoch) enter the window; take the previous max 384 such rows, drop
  // non-finite values inside that bounded window, and allow partial history.
  const rankWindow = indexed.slice(-CONFIDENCE_RANK_WINDOW);
  const priceHistory = rankWindow
    .map((h) => h.priceConfidence)
    .filter((v): v is number => v != null && Number.isFinite(v));
  const a2History = rankWindow
    .map((h) => h.a2Confidence)
    .filter((v): v is number => v != null && Number.isFinite(v));
  d.priceRankHistoryCount = priceHistory.length;
  d.a2RankHistoryCount = a2History.length;
  d.priceConfidenceRank = empiricalRank(priceHistory, d.priceConfidence!);
  d.a2ConfidenceRank = empiricalRank(a2History, d.a2Confidence);
  if (d.priceConfidenceRank == null || d.a2ConfidenceRank == null) {
    d.decisionReason = "ABSTAIN_CONFIDENCE_RANK_NOT_READY";
    d.withoutB4GuardDecisionReason = d.decisionReason;
    return d;
  }
  d.combinedConfidenceRank = (d.priceConfidenceRank + d.a2ConfidenceRank) / 2;

  // ---- 8. combined confidence rank floor ----
  d.combinedRankQualified = d.combinedConfidenceRank >= COMBINED_CONFIDENCE_MIN;
  if (!d.combinedRankQualified) {
    d.decisionReason = "ABSTAIN_COMBINED_CONFIDENCE_BELOW_020";
    d.withoutB4GuardDecisionReason = d.decisionReason;
    return d;
  }

  // Aligned candidate before the ES1 B4 guard.
  d.alignedCandidateBeforeB4 = true;
  d.alignedCandidateDirection = d.hybridDirection;
  d.withoutB4GuardWouldTrade = true;
  d.withoutB4GuardDirection = d.hybridDirection;
  d.withoutB4GuardDecisionReason =
    d.hybridRoute === "OB_DEPTH10_FADE"
      ? "PUBLISH_ES1_ALIGNED_OB_FADE"
      : "PUBLISH_ES1_ALIGNED_PRICE";

  // ---- 9. mature B4 state expected but inputs invalid ----
  if (idx != null && idx >= B4_READY_MIN_SOURCE_INDEX && !d.b4Ready) {
    d.decisionReason = "ABSTAIN_ES1_B4_GUARD_INVALID";
    return d;
  }

  // ---- 10. B4 correctness veto (veto-only, never flips direction) ----
  if (d.b4Ready && (d.b4PCorrect as number) < B4_GUARD_MIN_P_CORRECT) {
    d.b4GuardVetoFired = true;
    d.decisionReason = "ABSTAIN_ES1_B4_PCORRECT_BELOW_045";
    return d;
  }

  // ---- 11. publish ----
  d.finalPrediction = d.hybridDirection;
  d.wouldTrade = true;
  d.decisionReason = d.withoutB4GuardDecisionReason;
  return d;
}

export type GuardAttributionClass =
  | "AVOIDED_LOSS"
  | "SACRIFICED_WIN"
  | "PUSH_NO_VALUE"
  | "NO_INCREMENTAL_CHANGE";

/** Incremental value of the ES1 B4 guard for a resolved row. */
export function guardAttribution(
  vetoFired: boolean,
  counterfactualWouldTrade: boolean,
  counterfactualScore: number | null,
  actual: ActualDirection | null,
): { klass: GuardAttributionClass; value: number } {
  if (!vetoFired || !counterfactualWouldTrade) {
    return { klass: "NO_INCREMENTAL_CHANGE", value: 0 };
  }
  if (actual === "PUSH" || counterfactualScore === 0) return { klass: "PUSH_NO_VALUE", value: 0 };
  if (counterfactualScore === -1) return { klass: "AVOIDED_LOSS", value: 1 };
  if (counterfactualScore === 1) return { klass: "SACRIFICED_WIN", value: -1 };
  return { klass: "NO_INCREMENTAL_CHANGE", value: 0 };
}
