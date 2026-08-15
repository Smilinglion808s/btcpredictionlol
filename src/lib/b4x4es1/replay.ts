// Deterministic ES1 replay: rebuilds the eligible feature stream, every fit,
// every raw row and every decision from the canonical inputs. The live path
// and the warmup/backfill path share this single implementation, so a live row
// and its replay are bit-identical.
//
// Frozen-oracle reconciled stream semantics:
//   * a target is eligible only when its features are valid (32 contiguous
//     prior candles inside a segment of >= 40 candles);
//   * PUSH targets (open == close) are excluded from the stream entirely —
//     they never receive an index, never train, and never enter history;
//   * the price head trains on every eligible row strictly before the block
//     boundary (no extra outcome-delay filter);
//   * prediction begins at eligible index 768 and the raw source index is
//     `eligibleIndex - 768`.

import { ES1_MIN_TRAIN_ROWS, OB_HISTORY_WINDOW } from "./config";
import type { FeatureRow } from "./features";
import { decideEs1, type Es1Decision, type Es1HistoryEntry, type ObSnapshot } from "./engine";
import { resolveEs1Fit } from "./fitArtifacts";
import {
  fitBoundaryFor,
  predictProbabilityGreen,
  trainingWindowFor,
  type Es1Fit,
  type TrainingRow,
} from "./priceHead";

export interface A2Row {
  targetTs: string;
  probabilityGreen: number;
  rowId: string | null;
  predictionId: string | null;
  modelFitId: string | null;
  productionModelVersion: string | null;
}

export interface ReplayInput {
  featureRows: readonly FeatureRow[];
  a2: ReadonlyMap<string, A2Row>;
  ob: ReadonlyMap<string, ObSnapshot>;
}

export interface ReplayRow {
  targetTs: string;
  /** Index inside the eligible feature stream. */
  eligibleIndex: number;
  featureRow: FeatureRow;
  a2: A2Row | null;
  fit: Es1Fit | null;
  decision: Es1Decision;
}

export interface ReplayResult {
  rows: ReplayRow[];
  fits: Es1Fit[];
}

/** The eligible ES1 feature stream: valid features, PUSH targets excluded. */
export function eligibleFeatureRows(rows: readonly FeatureRow[]): FeatureRow[] {
  return [...rows]
    .sort((a, b) => a.targetTs.localeCompare(b.targetTs))
    .filter((r) => r.valid && r.actualDirection != null && r.actualDirection !== "PUSH");
}

/** Full chronological replay over the canonical feature stream. */
export function replayEs1(input: ReplayInput): ReplayResult {
  const eligible = eligibleFeatureRows(input.featureRows);

  const trainingPool: TrainingRow[] = [];
  const fitsByBoundary = new Map<number, Es1Fit | null>();
  const fits: Es1Fit[] = [];
  const history: Es1HistoryEntry[] = [];
  const obHistory: Array<{ targetTs: string; absDepth: number }> = [];
  const out: ReplayRow[] = [];

  eligible.forEach((fr, eligibleIndex) => {
    const boundary = fitBoundaryFor(eligibleIndex);
    let fit: Es1Fit | null = null;
    if (boundary != null) {
      if (!fitsByBoundary.has(boundary)) {
        const { start, end } = trainingWindowFor(boundary);
        const trained = resolveEs1Fit(trainingPool.slice(start, end), boundary);
        fitsByBoundary.set(boundary, trained);
        if (trained) fits.push(trained);
      }
      fit = fitsByBoundary.get(boundary) ?? null;
    }

    const a2 = input.a2.get(fr.targetTs) ?? null;
    const priceProbability = fit ? predictProbabilityGreen(fit, fr.vector) : null;

    const decision = decideEs1(
      {
        targetTs: fr.targetTs,
        featureCutoffTs: fr.featureCutoffTs,
        latestSourceTs: fr.latestSourceTs,
        featureVector: fr.vector,
        featureValues: fr.values,
        featureVectorHash: fr.vectorHash || null,
        featureValid: true,
        featureInvalidReason: null,
        timingValid: true,
        timingInvalidReason: null,
        priceProbabilityGreen: priceProbability,
        priceFitId: fit?.fitId ?? null,
        a2ProbabilityGreen: a2?.probabilityGreen ?? null,
        a2RowId: a2?.rowId ?? null,
        a2PredictionId: a2?.predictionId ?? null,
        sourceIndexAbsolute: fit ? eligibleIndex - ES1_MIN_TRAIN_ROWS : null,
        obSnapshot: input.ob.get(fr.targetTs) ?? null,
        obHistory: obHistory.slice(-OB_HISTORY_WINDOW),
      },
      history,
    );

    if (decision.historyEntry) {
      decision.historyEntry.actualDirection = fr.actualDirection;
      history.push(decision.historyEntry);
    }

    const snap = input.ob.get(fr.targetTs);
    if (
      snap &&
      snap.bookComplete === true &&
      snap.depthImbalance10bps != null &&
      Number.isFinite(snap.depthImbalance10bps)
    ) {
      obHistory.push({ targetTs: fr.targetTs, absDepth: Math.abs(snap.depthImbalance10bps) });
    }

    trainingPool.push({
      targetTs: fr.targetTs,
      vector: fr.vector,
      label: fr.actualDirection === "GREEN" ? 1 : 0,
      index: eligibleIndex,
    });

    out.push({ targetTs: fr.targetTs, eligibleIndex, featureRow: fr, a2, fit, decision });
  });

  return { rows: out, fits };
}
