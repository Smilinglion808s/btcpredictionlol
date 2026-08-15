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
import { resolveEs1FitDetailed, type MintedFitArtifact, type ResolvedEs1Fit } from "./fitArtifacts";
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
  /** Certified artifacts previously minted and persisted, keyed by boundary. */
  mintedArtifacts?: ReadonlyMap<number, MintedFitArtifact>;
}

/** Rolling FNV-1a (64-bit) checksum of the decision-state history stream. */
function rollHistoryChecksum(prev: string, entry: string): string {
  let h = BigInt("0x" + prev);
  for (let i = 0; i < entry.length; i++) {
    h ^= BigInt(entry.charCodeAt(i));
    h = (h * 1099511628211n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, "0");
}
const HISTORY_CHECKSUM_SEED = "cbf29ce484222325";

export interface ReplayRow {
  targetTs: string;
  /** Index inside the eligible feature stream. */
  eligibleIndex: number;
  featureRow: FeatureRow;
  a2: A2Row | null;
  fit: Es1Fit | null;
  /** Provenance/certification of the fit used for this row. */
  resolvedFit: ResolvedEs1Fit | null;
  /** Independently verifiable checksum of the rolling history at decision time. */
  historyChecksum: string;
  historyCount: number;
  /** Rolling decision state was rebuilt contiguously from the canonical stream. */
  decisionStateCertified: boolean;
  decision: Es1Decision;
}

export interface ReplayResult {
  rows: ReplayRow[];
  fits: Es1Fit[];
  /** Every resolved fit with provenance, in boundary order. */
  resolvedFits: ResolvedEs1Fit[];
}

/**
 * The eligible ES1 feature stream: valid features, PUSH targets excluded.
 * A still-unresolved tail target (no candle yet) is provisionally eligible so
 * the live path can score it; it contributes no training row and no history
 * entry until it resolves.
 */
export function eligibleFeatureRows(rows: readonly FeatureRow[]): FeatureRow[] {
  const sorted = [...rows]
    .sort((a, b) => a.targetTs.localeCompare(b.targetTs))
    .filter((r) => r.valid && r.actualDirection !== "PUSH");
  // A missing historical target candle is a data gap, not a stream member: only
  // targets after the last known outcome may be provisionally eligible.
  let lastResolved = "";
  for (const r of sorted) if (r.actualDirection != null && r.targetTs > lastResolved) lastResolved = r.targetTs;
  return sorted.filter((r) => r.actualDirection != null || r.targetTs > lastResolved);
}

/** Full chronological replay over the canonical feature stream. */
export function replayEs1(input: ReplayInput): ReplayResult {
  const eligible = eligibleFeatureRows(input.featureRows);

  const trainingPool: TrainingRow[] = [];
  const fitsByBoundary = new Map<number, ResolvedEs1Fit | null>();
  const fits: Es1Fit[] = [];
  const resolvedFits: ResolvedEs1Fit[] = [];
  const history: Es1HistoryEntry[] = [];
  const obHistory: Array<{ targetTs: string; absDepth: number }> = [];
  let historyChecksum = HISTORY_CHECKSUM_SEED;
  let historyContiguous = true;
  let lastHistoryTs = "";
  const out: ReplayRow[] = [];

  eligible.forEach((fr, eligibleIndex) => {
    const boundary = fitBoundaryFor(eligibleIndex);
    let resolvedFit: ResolvedEs1Fit | null = null;
    if (boundary != null) {
      if (!fitsByBoundary.has(boundary)) {
        const { start, end } = trainingWindowFor(boundary);
        const trained = resolveEs1FitDetailed(trainingPool.slice(start, end), boundary, {
          mintedArtifacts: input.mintedArtifacts,
        });
        fitsByBoundary.set(boundary, trained);
        if (trained) {
          fits.push(trained.fit);
          resolvedFits.push(trained);
        }
      }
      resolvedFit = fitsByBoundary.get(boundary) ?? null;
    }
    const fit: Es1Fit | null = resolvedFit?.fit ?? null;

    const rowHistoryChecksum = historyChecksum;
    const rowHistoryCount = history.length;

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
        priceFitCertified: resolvedFit?.certified ?? true,
        a2ProbabilityGreen: a2?.probabilityGreen ?? null,
        a2RowId: a2?.rowId ?? null,
        a2PredictionId: a2?.predictionId ?? null,
        sourceIndexAbsolute: fit ? eligibleIndex - ES1_MIN_TRAIN_ROWS : null,
        obSnapshot: input.ob.get(fr.targetTs) ?? null,
        obHistory: obHistory.slice(-OB_HISTORY_WINDOW),
      },
      history,
    );

    const resolved = fr.actualDirection === "GREEN" || fr.actualDirection === "RED";
    if (decision.historyEntry && resolved) {
      decision.historyEntry.actualDirection = fr.actualDirection;
      history.push(decision.historyEntry);
      if (fr.targetTs <= lastHistoryTs) historyContiguous = false;
      lastHistoryTs = fr.targetTs;
      historyChecksum = rollHistoryChecksum(
        historyChecksum,
        `${fr.targetTs}|${fr.actualDirection}|${decision.finalPrediction ?? "NONE"}|${decision.decisionReason};`,
      );
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

    if (resolved) {
      trainingPool.push({
        targetTs: fr.targetTs,
        vector: fr.vector,
        label: fr.actualDirection === "GREEN" ? 1 : 0,
        index: eligibleIndex,
      });
    }

    out.push({
      targetTs: fr.targetTs,
      eligibleIndex,
      featureRow: fr,
      a2,
      fit,
      resolvedFit,
      historyChecksum: rowHistoryChecksum,
      historyCount: rowHistoryCount,
      decisionStateCertified: historyContiguous,
      decision,
    });
  });

  return { rows: out, fits, resolvedFits };
}
