// Deterministic ES1 replay: rebuilds every fit, every raw row and every
// decision from the canonical inputs. The live path and the warmup/backfill
// path share this single implementation, so a live row and its replay are
// bit-identical.

import {
  ES1_RAW_PREDICTION_EPOCH_TS,
  GRID_OUTCOME_DELAY_MS,
  OB_HISTORY_WINDOW,
} from "./config";
import type { FeatureRow } from "./features";
import { decideEs1, type Es1Decision, type Es1HistoryEntry, type ObSnapshot } from "./engine";
import {
  fitBoundaryFor,
  predictProbabilityGreen,
  trainEs1Fit,
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
  featureRow: FeatureRow;
  a2: A2Row | null;
  fit: Es1Fit | null;
  decision: Es1Decision;
}

export interface ReplayResult {
  rows: ReplayRow[];
  fits: Es1Fit[];
}

/** Full chronological replay over the canonical feature stream. */
export function replayEs1(input: ReplayInput): ReplayResult {
  const rawEpochMs = new Date(ES1_RAW_PREDICTION_EPOCH_TS).getTime();
  const rows = [...input.featureRows].sort((a, b) => a.targetTs.localeCompare(b.targetTs));

  const trainingPool: TrainingRow[] = [];
  const fitsByBoundary = new Map<number, Es1Fit | null>();
  const fits: Es1Fit[] = [];
  const history: Es1HistoryEntry[] = [];
  const obHistory: Array<{ targetTs: string; absDepth: number }> = [];
  const out: ReplayRow[] = [];
  let rawIndex = 0;

  for (const fr of rows) {
    const targetMs = new Date(fr.targetTs).getTime();

    // Training rows only become usable once their outcome is knowable.
    const usable = trainingPool.filter(
      (t) => new Date(t.targetTs).getTime() + GRID_OUTCOME_DELAY_MS <= targetMs,
    );
    const boundary = fitBoundaryFor(usable.length);
    let fit: Es1Fit | null = null;
    if (boundary != null) {
      if (!fitsByBoundary.has(boundary)) {
        const { start, end } = trainingWindowFor(boundary);
        const trained = trainEs1Fit(usable.slice(start, end), boundary);
        fitsByBoundary.set(boundary, trained);
        if (trained) fits.push(trained);
      }
      fit = fitsByBoundary.get(boundary) ?? null;
    }

    const a2 = input.a2.get(fr.targetTs) ?? null;
    const priceProbability =
      fit && fr.valid ? predictProbabilityGreen(fit, fr.vector) : null;

    const decision = decideEs1(
      {
        targetTs: fr.targetTs,
        featureCutoffTs: fr.featureCutoffTs,
        latestSourceTs: fr.latestSourceTs,
        featureVector: fr.valid ? fr.vector : null,
        featureValues: fr.values,
        featureVectorHash: fr.vectorHash || null,
        featureValid: fr.valid,
        featureInvalidReason: fr.invalidReason,
        timingValid: true,
        timingInvalidReason: null,
        priceProbabilityGreen: priceProbability,
        priceFitId: fit?.fitId ?? null,
        a2ProbabilityGreen: a2?.probabilityGreen ?? null,
        a2RowId: a2?.rowId ?? null,
        a2PredictionId: a2?.predictionId ?? null,
        sourceIndexAbsolute: targetMs >= rawEpochMs ? rawIndex : null,
        obSnapshot: input.ob.get(fr.targetTs) ?? null,
        obHistory: obHistory.slice(-OB_HISTORY_WINDOW),
      },
      history,
    );

    if (decision.historyEntry) {
      if (targetMs >= rawEpochMs) rawIndex++;
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

    if (fr.valid && fr.actualDirection && fr.actualDirection !== "PUSH") {
      trainingPool.push({
        targetTs: fr.targetTs,
        vector: fr.vector,
        label: fr.actualDirection === "GREEN" ? 1 : 0,
        index: trainingPool.length,
      });
    }

    out.push({ targetTs: fr.targetTs, featureRow: fr, a2, fit, decision });
  }

  return { rows: out, fits };
}
