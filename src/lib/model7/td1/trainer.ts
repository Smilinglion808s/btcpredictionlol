// Deterministic CART binary trainer for TD1-RC.
// Faithful to td1_rc_trainer_contract.md. No randomness.

import { TD1_FEATURE_ORDER, type Td1Features, type Td1Artifact, type TreeNode } from "./decision";

const TRAINER_VERSION = "td1-cart-v1";
const MAX_DEPTH = 3;
const MIN_SAMPLES_LEAF = 20;
const MIN_SAMPLES_SPLIT = 40;

export interface TrainingRow {
  features: Td1Features;
  label: 0 | 1; // 1 = A2 LOSS, 0 = A2 WIN
}

function gini(labels: number[]): number {
  if (labels.length === 0) return 0;
  const p = labels.reduce((a, b) => a + b, 0) / labels.length;
  return 2 * p * (1 - p);
}

interface BestSplit {
  featureIndex: number;
  threshold: number;
  gain: number;
  leftIdx: number[];
  rightIdx: number[];
}

function findBestSplit(rows: TrainingRow[], idx: number[]): BestSplit | null {
  if (idx.length < MIN_SAMPLES_SPLIT) return null;
  const parentLabels = idx.map((i) => rows[i].label);
  const parentImpurity = gini(parentLabels);
  const n = idx.length;

  let best: BestSplit | null = null;

  for (let f = 0; f < TD1_FEATURE_ORDER.length; f += 1) {
    const name = TD1_FEATURE_ORDER[f];
    // gather (value, label) pairs, sort by value
    const pairs = idx
      .map((i) => ({ v: rows[i].features[name], l: rows[i].label, i }))
      .filter((p) => Number.isFinite(p.v))
      .sort((a, b) => (a.v - b.v) || (a.i - b.i));
    if (pairs.length < 2 * MIN_SAMPLES_LEAF) continue;

    // candidate thresholds = midpoints between adjacent distinct values
    const distinct: number[] = [];
    for (let k = 0; k < pairs.length; k += 1) {
      if (k === 0 || pairs[k].v !== pairs[k - 1].v) distinct.push(pairs[k].v);
    }
    if (distinct.length < 2) continue;

    for (let k = 0; k < distinct.length - 1; k += 1) {
      const thr = (distinct[k] + distinct[k + 1]) / 2;
      const leftIdx: number[] = [];
      const rightIdx: number[] = [];
      const leftLabels: number[] = [];
      const rightLabels: number[] = [];
      for (const p of pairs) {
        if (p.v <= thr) { leftIdx.push(p.i); leftLabels.push(p.l); }
        else { rightIdx.push(p.i); rightLabels.push(p.l); }
      }
      if (leftIdx.length < MIN_SAMPLES_LEAF || rightIdx.length < MIN_SAMPLES_LEAF) continue;
      const childImpurity = (leftLabels.length / n) * gini(leftLabels)
        + (rightLabels.length / n) * gini(rightLabels);
      const gain = parentImpurity - childImpurity;
      if (gain <= 0) continue;

      // tie-break: largest gain > lowest featureIndex > lowest threshold
      if (
        !best ||
        gain > best.gain + 1e-15 ||
        (Math.abs(gain - best.gain) <= 1e-15 && f < best.featureIndex) ||
        (Math.abs(gain - best.gain) <= 1e-15 && f === best.featureIndex && thr < best.threshold)
      ) {
        best = { featureIndex: f, threshold: thr, gain, leftIdx, rightIdx };
      }
    }
  }
  return best;
}

function makeLeaf(rows: TrainingRow[], idx: number[]): TreeNode {
  const losses = idx.reduce((a, i) => a + rows[i].label, 0);
  const count = idx.length;
  const p = (losses + 1) / (count + 2); // Laplace
  return { leaf: { lossProbability: p, sampleCount: count, lossCount: losses } };
}

function grow(rows: TrainingRow[], idx: number[], depth: number): TreeNode {
  if (depth >= MAX_DEPTH || idx.length < MIN_SAMPLES_SPLIT) return makeLeaf(rows, idx);
  const split = findBestSplit(rows, idx);
  if (!split) return makeLeaf(rows, idx);
  return {
    featureIndex: split.featureIndex,
    threshold: split.threshold,
    left: grow(rows, split.leftIdx, depth + 1),
    right: grow(rows, split.rightIdx, depth + 1),
  };
}

/** Canonical JSON: sorted keys, no whitespace. Numbers as-is via JSON.stringify. */
function canonicalize(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonicalize).join(",")}]`;
  const keys = Object.keys(v as Record<string, unknown>).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize((v as Record<string, unknown>)[k])}`).join(",")}}`;
}

async function sha256Hex(s: string): Promise<string> {
  const buf = new TextEncoder().encode(s);
  const d = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function validateTree(node: TreeNode, depth: number): void {
  if (node.leaf) {
    if (node.leaf.sampleCount < MIN_SAMPLES_LEAF) throw new Error("TD1_LEAF_TOO_SMALL");
    const p = node.leaf.lossProbability;
    if (!Number.isFinite(p) || p < 0 || p > 1) throw new Error("TD1_LEAF_PROB_INVALID");
    return;
  }
  if (depth >= MAX_DEPTH) throw new Error("TD1_DEPTH_EXCEEDED");
  validateTree(node.left!, depth + 1);
  validateTree(node.right!, depth + 1);
}

export interface TrainResult {
  artifact: Td1Artifact;
  canonicalJson: string;
  trainerVersion: string;
}

export async function trainTd1(rows: TrainingRow[], trainedThroughCandleTs: string): Promise<TrainResult> {
  if (rows.length < 100) throw new Error("TD1_MINIMUM_TRAINING_ROWS_UNMET");
  const idx = rows.map((_, i) => i);
  const tree = grow(rows, idx, 0);
  validateTree(tree, 0);

  const stub: Td1Artifact = {
    schemaVersion: "1.0.0",
    fitId: "PENDING",
    baseVariant: "A2_Combined",
    trainedThroughCandleTs,
    featureOrder: TD1_FEATURE_ORDER,
    tree,
    artifactSha256: "PENDING",
  };
  // Hash only the fields that define the model: tree + featureOrder + trainedThrough + schemaVersion.
  const canonicalCore = canonicalize({
    schemaVersion: stub.schemaVersion,
    baseVariant: stub.baseVariant,
    trainedThroughCandleTs: stub.trainedThroughCandleTs,
    featureOrder: [...stub.featureOrder],
    tree: stub.tree,
  });
  const sha = await sha256Hex(canonicalCore);
  const fitId = `td1_v1_${trainedThroughCandleTs.replace(/[^0-9]/g, "").slice(0, 14)}_${sha.slice(0, 12)}`;
  const artifact: Td1Artifact = { ...stub, fitId, artifactSha256: sha };
  return { artifact, canonicalJson: canonicalCore, trainerVersion: TRAINER_VERSION };
}
