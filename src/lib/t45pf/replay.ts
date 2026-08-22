// T45 PriceFlow — deterministic walk-forward replay engine (pure).
//
// The same code path drives the historical oracle replay, the production
// fitter certification and the regression tests. It has no I/O, so a given
// input list always yields byte-identical output and hash.

import {
  T45PF_REASONS,
  type T45PFDirection,
} from "./config";
import {
  fitPFHead,
  pfBlockIndex,
  pfBlockStart,
  pfDecide,
  pfFitCertified,
  pfProbability,
  pfScore,
  type PFHead,
  type PFTrainingRow,
} from "./head";

export interface PFReplayInput {
  targetTs: string;
  /** Frozen-order feature vector, or null when the packet is unusable. */
  vector: number[] | null;
  /** Canonical confirmed direction: 1 GREEN, -1 RED, 0 PUSH, null unknown. */
  actualDirection: number | null;
  /** Reason the packet is unusable, when vector is null. */
  invalidReason?: string | null;
}

export interface PFReplayRow {
  index: number;
  targetTs: string;
  decisionValid: boolean;
  reason: string;
  probabilityGreen: number | null;
  confidence: number | null;
  confidenceRank: number | null;
  rankHistoryCount: number;
  baseDirection: T45PFDirection | null;
  activePrediction: T45PFDirection | null;
  activeWouldTrade: boolean;
  activeSleeve: string;
  fitId: string | null;
  fitBlockIndex: number | null;
  fitTrainingRowCount: number | null;
  fitTrainingFingerprint: string | null;
  fitArtifactHash: string | null;
  actualDirection: number | null;
  result: string | null;
  score: number | null;
}

export interface PFReplayResult {
  rows: PFReplayRow[];
  fits: PFHead[];
  predictionHash: string;
}

export function pfFitId(blockStart: number): string {
  return `t45-price-flow-q375-r1::block=${blockStart}`;
}

/** Stable artifact hash of a fitted head (order-sensitive, FNV-1a 64-ish). */
export function pfArtifactHash(head: PFHead): string {
  return fnv([
    head.blockStartIndex,
    head.trainingRowCount,
    head.trainingFingerprint,
    head.intercept,
    ...head.coefficients,
    ...head.scaler.center,
    ...head.scaler.scale,
  ].join("|"));
}

/**
 * Precision-stable artifact hash. PostgREST returns float8 with 15 significant
 * digits, so a hash over raw doubles can never survive a database round-trip.
 * Formatting every number to 15 significant digits makes the hash identical
 * before persistence and after re-reading the stored row, which is what makes
 * conflicting-artifact detection meaningful. Model outputs are unaffected —
 * this is a verification hash only.
 */
export function pfStableArtifactHash(head: PFHead): string {
  const n = (v: number) => (Number.isFinite(v) ? Number(v).toPrecision(15) : String(v));
  return fnv(
    [
      head.blockStartIndex,
      head.trainingRowCount,
      head.trainingFingerprint,
      n(head.intercept),
      ...head.coefficients.map(n),
      ...head.scaler.center.map(n),
      ...head.scaler.scale.map(n),
    ].join("|"),
  );
}

function fnv(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0xcbf29ce4;
  for (let i = 0; i < s.length; i++) {
    h1 = Math.imul(h1 ^ s.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + s.charCodeAt(i) + 7, 2246822519) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

/**
 * Walk the ordered targets once. Fits are produced only at 96-row block
 * boundaries from the trailing 8,640-row window, always strictly before the
 * block start, and the current target is never in its own training window.
 */
export function replayPriceFlow(inputs: readonly PFReplayInput[]): PFReplayResult {
  const rows: PFReplayRow[] = [];
  const fits: PFHead[] = [];
  const heads = new Map<number, PFHead | null>();
  const history: PFTrainingRow[] = [];
  const confidences: number[] = [];

  inputs.forEach((input, index) => {
    const base = {
      index,
      targetTs: input.targetTs,
      probabilityGreen: null as number | null,
      confidence: null as number | null,
      confidenceRank: null as number | null,
      rankHistoryCount: 0,
      baseDirection: null as T45PFDirection | null,
      activePrediction: null as T45PFDirection | null,
      activeWouldTrade: false,
      activeSleeve: "NONE",
      fitId: null as string | null,
      fitBlockIndex: null as number | null,
      fitTrainingRowCount: null as number | null,
      fitTrainingFingerprint: null as string | null,
      fitArtifactHash: null as string | null,
      actualDirection: input.actualDirection,
    };

    const finish = (r: PFReplayRow) => {
      rows.push(r);
      // Feedback for the NEXT block only — appended after this row is decided.
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
        reason: input.invalidReason ?? T45PF_REASONS.FEATURE_INVALID,
        result: null,
        score: null,
      });
      return;
    }

    const blockStart = pfBlockStart(index);
    if (blockStart == null) {
      finish({
        ...base,
        decisionValid: false,
        reason: T45PF_REASONS.FIT_NOT_READY,
        result: null,
        score: null,
      });
      return;
    }

    if (!heads.has(blockStart)) {
      const head = fitPFHead(blockStart, history);
      heads.set(blockStart, head);
      if (head) fits.push(head);
    }
    const head = heads.get(blockStart) ?? null;
    if (!head) {
      finish({
        ...base,
        decisionValid: false,
        reason: T45PF_REASONS.FIT_NOT_READY,
        fitBlockIndex: pfBlockIndex(blockStart),
        result: null,
        score: null,
      });
      return;
    }
    if (!pfFitCertified(head)) {
      finish({
        ...base,
        decisionValid: false,
        reason: T45PF_REASONS.FIT_UNCERTIFIED,
        fitId: pfFitId(blockStart),
        fitBlockIndex: head.blockIndex,
        result: null,
        score: null,
      });
      return;
    }

    const probability = pfProbability(head, input.vector);
    const decision = pfDecide(probability, confidences, T45PF_REASONS);
    confidences.push(decision.confidence);

    const { result, score } = pfScore(
      decision.confidenceRank == null ? null : decision.activeWouldTrade,
      decision.confidenceRank == null ? null : decision.activePrediction,
      input.actualDirection,
    );

    finish({
      ...base,
      decisionValid: decision.confidenceRank != null,
      reason: decision.reason,
      probabilityGreen: decision.probabilityGreen,
      confidence: decision.confidence,
      confidenceRank: decision.confidenceRank,
      rankHistoryCount: decision.rankHistoryCount,
      baseDirection: decision.baseDirection,
      activePrediction: decision.confidenceRank == null ? null : decision.activePrediction,
      activeWouldTrade: decision.confidenceRank == null ? false : decision.activeWouldTrade,
      activeSleeve: decision.confidenceRank == null ? "NONE" : decision.activeSleeve,
      fitId: pfFitId(blockStart),
      fitBlockIndex: head.blockIndex,
      fitTrainingRowCount: head.trainingRowCount,
      fitTrainingFingerprint: head.trainingFingerprint,
      fitArtifactHash: pfArtifactHash(head),
      result,
      score,
    });
  });

  const canonical = rows
    .map(
      (r) =>
        `${r.targetTs}|${r.probabilityGreen == null ? "" : r.probabilityGreen.toExponential(17)}|${
          r.confidenceRank == null ? "" : r.confidenceRank.toExponential(17)
        }|${r.activePrediction ?? ""}|${r.activeWouldTrade ? 1 : 0}|${r.reason}`,
    )
    .join("\n");

  return { rows, fits, predictionHash: sha256Hex(canonical) };
}

/** Pure JS sha256 so the replay hash is identical in every runtime. */
export function sha256Hex(message: string): string {
  const K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4,
    0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe,
    0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f,
    0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7,
    0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc,
    0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b,
    0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070, 0x19a4c116,
    0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7,
    0xc67178f2,
  ];
  const H = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
    0x5be0cd19,
  ];
  const bytes = new TextEncoder().encode(message);
  const bitLen = bytes.length * 8;
  const padded = new Uint8Array((((bytes.length + 9) >> 6) + 1) << 6);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const dv = new DataView(padded.buffer);
  dv.setUint32(padded.length - 4, bitLen >>> 0);
  dv.setUint32(padded.length - 8, Math.floor(bitLen / 4294967296));

  const w = new Uint32Array(64);
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const t1 = (h + S1 + ch + K[i] + w[i]) >>> 0;
      const S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const t2 = (S0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + t1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (t1 + t2) >>> 0;
    }
    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }
  return H.map((x) => x.toString(16).padStart(8, "0")).join("");
}

function rotr(x: number, n: number): number {
  return ((x >>> n) | (x << (32 - n))) >>> 0;
}
