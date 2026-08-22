// T30 PriceFlow Balanced — deterministic walk-forward replay engine (pure).
//
// No I/O: the same ordered input list always produces byte-identical rows and
// the same stream hash. Used by the historical backtest, fit minting and the
// regression tests. Never touches T45 or any other model.

import { T30_REASONS, type T30Direction } from "./config";
import {
  fitT30Head,
  t30BlockIndex,
  t30BlockStart,
  t30Decide,
  t30FitCertified,
  t30Probability,
  t30Score,
  type T30Head,
  type T30PriorConfidence,
  type T30TrainingRow,
} from "./head";
import { sha256Hex } from "@/lib/t45pf/replay";

export interface T30ReplayInput {
  targetTs: string;
  /** Frozen-order feature vector, or null when the packet is unusable. */
  vector: number[] | null;
  /** Confirmed direction: 1 GREEN, -1 RED, 0 PUSH, null unknown. */
  actualDirection: number | null;
  invalidReason?: string | null;
}

export interface T30ReplayRow {
  index: number;
  targetTs: string;
  decisionValid: boolean;
  reason: string;
  probabilityGreen: number | null;
  confidence: number | null;
  longRank: number | null;
  longRankHistory: number;
  fastRank: number | null;
  fastRankHistory: number;
  gateLongReady: boolean;
  gateFastReady: boolean;
  gateLongPassed: boolean;
  gateFastPassed: boolean;
  baseDirection: T30Direction | null;
  modelDirection: T30Direction | null;
  modelWouldTrade: boolean;
  fitId: string | null;
  fitBlockIndex: number | null;
  fitTrainingRowCount: number | null;
  fitTrainingFingerprint: string | null;
  actualDirection: number | null;
  result: string | null;
  score: number | null;
}

export interface T30ReplayResult {
  rows: T30ReplayRow[];
  fits: T30Head[];
  predictionHash: string;
}

/**
 * Walk the ordered targets once. A block's head is fitted only from labelled
 * rows strictly before the block start, so no row is ever scored by a fit that
 * saw it. Rank history uses prior decided confidences only.
 */
export function replayT30(inputs: readonly T30ReplayInput[]): T30ReplayResult {
  const rows: T30ReplayRow[] = [];
  const fits: T30Head[] = [];
  const heads = new Map<number, T30Head | null>();
  const history: T30TrainingRow[] = [];
  const prior: T30PriorConfidence[] = [];

  inputs.forEach((input, index) => {
    const base = {
      index,
      targetTs: input.targetTs,
      probabilityGreen: null as number | null,
      confidence: null as number | null,
      longRank: null as number | null,
      longRankHistory: 0,
      fastRank: null as number | null,
      fastRankHistory: 0,
      gateLongReady: false,
      gateFastReady: false,
      gateLongPassed: false,
      gateFastPassed: false,
      baseDirection: null as T30Direction | null,
      modelDirection: null as T30Direction | null,
      modelWouldTrade: false,
      fitId: null as string | null,
      fitBlockIndex: null as number | null,
      fitTrainingRowCount: null as number | null,
      fitTrainingFingerprint: null as string | null,
      actualDirection: input.actualDirection,
    };

    const finish = (r: T30ReplayRow) => {
      rows.push(r);
      if (input.vector && input.actualDirection != null) {
        history.push({
          targetTs: input.targetTs,
          index,
          vector: input.vector,
          label: input.actualDirection,
        });
      }
    };

    if (!input.vector) {
      finish({
        ...base,
        decisionValid: false,
        reason: input.invalidReason ?? T30_REASONS.PACKET_NOT_READY,
        result: null,
        score: null,
      });
      return;
    }

    const blockStart = t30BlockStart(index);
    if (blockStart == null) {
      finish({
        ...base,
        decisionValid: false,
        reason: T30_REASONS.FIT_NOT_READY,
        result: null,
        score: null,
      });
      return;
    }

    if (!heads.has(blockStart)) {
      const head = fitT30Head(blockStart, history);
      heads.set(blockStart, head);
      if (head) fits.push(head);
    }
    const head = heads.get(blockStart) ?? null;
    if (!head || !t30FitCertified(head)) {
      finish({
        ...base,
        decisionValid: false,
        reason: T30_REASONS.FIT_NOT_READY,
        fitBlockIndex: t30BlockIndex(blockStart),
        result: null,
        score: null,
      });
      return;
    }

    const probability = t30Probability(head, input.vector);
    const decision = t30Decide(probability, prior);
    prior.push({ targetTs: input.targetTs, confidence: decision.confidence });

    const { result, score } = t30Score(
      decision.decisionValid ? decision.modelWouldTrade : null,
      decision.decisionValid ? decision.modelDirection : null,
      input.actualDirection,
    );

    finish({
      ...base,
      decisionValid: decision.decisionValid,
      reason: decision.reason,
      probabilityGreen: decision.probabilityGreen,
      confidence: decision.confidence,
      longRank: decision.longRank.rank,
      longRankHistory: decision.longRank.historyCount,
      fastRank: decision.fastRank.rank,
      fastRankHistory: decision.fastRank.historyCount,
      gateLongReady: decision.gateLongReady,
      gateFastReady: decision.gateFastReady,
      gateLongPassed: decision.gateLongPassed,
      gateFastPassed: decision.gateFastPassed,
      baseDirection: decision.baseDirection,
      modelDirection: decision.modelDirection,
      modelWouldTrade: decision.modelWouldTrade,
      fitId: `${blockStart}`,
      fitBlockIndex: head.blockIndex,
      fitTrainingRowCount: head.trainingRowCount,
      fitTrainingFingerprint: head.trainingFingerprint,
      result,
      score,
    });
  });

  const canonical = rows
    .map(
      (r) =>
        `${r.targetTs}|${r.probabilityGreen == null ? "" : r.probabilityGreen.toExponential(17)}|${
          r.longRank == null ? "" : r.longRank.toExponential(17)
        }|${r.fastRank == null ? "" : r.fastRank.toExponential(17)}|${
          r.modelDirection ?? ""
        }|${r.modelWouldTrade ? 1 : 0}|${r.reason}`,
    )
    .join("\n");

  return { rows, fits, predictionHash: sha256Hex(canonical) };
}
