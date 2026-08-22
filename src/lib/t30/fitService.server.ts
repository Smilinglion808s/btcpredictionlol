// T30 PriceFlow — deterministic fit rollover (server only).
//
// One fit per 96-row block. A block's fit is minted from the 8,640 labelled
// rows strictly BEFORE the block start, so no fit can ever see a row it will
// later score. Minting is idempotent: the same block re-mints to the same
// fit_id and the insert is a no-op.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  T30_CONFIG_HASH,
  T30_FEATURE_ORDER_HASH,
  T30_MIN_TRAINING_ROWS,
  T30_MODEL_VERSION,
  T30_SOLVER,
} from "./config";
import {
  fitT30Head,
  t30BlockIndex,
  t30BlockStart,
  t30FitCertified,
  type T30Head,
} from "./head";
import { insertT30Fit, loadT30TrainingRows, readT30Fit } from "./store.server";

export interface T30FitArtifact {
  fitId: string;
  blockIndex: number;
  blockStartIndex: number;
  certified: boolean;
  head: T30Head;
}

/** Stable 128-bit hash of the artifact's numeric payload. */
export function t30ArtifactHash(head: T30Head): string {
  const canonical = JSON.stringify({
    v: T30_MODEL_VERSION,
    f: T30_FEATURE_ORDER_HASH,
    c: head.coefficients.map((x) => x.toPrecision(17)),
    b: head.intercept.toPrecision(17),
    sc: head.scaler.center.map((x) => x.toPrecision(17)),
    ss: head.scaler.scale.map((x) => x.toPrecision(17)),
    n: head.trainingRowCount,
    fp: head.trainingFingerprint,
  });
  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  for (let i = 0; i < canonical.length; i++) {
    h1 = Math.imul(h1 ^ canonical.charCodeAt(i), 16777619) >>> 0;
    h2 = Math.imul(h2 + canonical.charCodeAt(i) + 1, 2246822519) >>> 0;
  }
  return `${h1.toString(16).padStart(8, "0")}${h2.toString(16).padStart(8, "0")}`;
}

export function t30FitId(blockStart: number, source: string): string {
  return `${T30_MODEL_VERSION}:${source.toLowerCase()}:b${blockStart}`;
}

function rowToHead(row: Record<string, unknown>): T30Head {
  return {
    scaler: {
      center: (row.scaler_center as number[]).map(Number),
      scale: (row.scaler_scale as number[]).map(Number),
    },
    coefficients: (row.coefficients as number[]).map(Number),
    intercept: Number(row.intercept),
    trainingRowCount: Number(row.training_row_count),
    trainingStartTs: String(row.training_start_ts ?? ""),
    trainingEndTs: String(row.training_end_ts ?? ""),
    trainingStartIndex: Number(row.training_start_index ?? 0),
    trainingEndIndex: Number(row.training_end_index ?? 0),
    trainingFingerprint: String(row.training_fingerprint ?? ""),
    blockIndex: Number(row.block_index),
    blockStartIndex: Number(row.block_start_index),
    converged: row.converged === true,
    iterations: Number(row.iterations ?? 0),
    gradientNorm: Number(row.gradient_norm ?? 0),
  };
}

/**
 * Return the certified fit governing absolute row index `rowIndex`, minting it
 * from history when it does not exist yet. Returns null before warm-up or when
 * the training window is too small — the caller then abstains FIT_NOT_READY.
 */
export async function ensureT30Fit(
  sb: SupabaseClient,
  rowIndex: number,
  source: "LIVE" | "REPLAY" = "LIVE",
): Promise<T30FitArtifact | null> {
  const blockStart = t30BlockStart(rowIndex);
  if (blockStart == null) return null;
  const fitId = t30FitId(blockStart, source);

  const existing = await readT30Fit(sb, fitId);
  if (existing) {
    const head = rowToHead(existing);
    return {
      fitId,
      blockIndex: head.blockIndex,
      blockStartIndex: head.blockStartIndex,
      certified: existing.certified === true,
      head,
    };
  }

  const history = await loadT30TrainingRows(sb, blockStart);
  if (history.length < T30_MIN_TRAINING_ROWS) return null;
  const head = fitT30Head(blockStart, history);
  if (!head) return null;
  const certified = t30FitCertified(head);

  await insertT30Fit(sb, {
    fit_id: fitId,
    model_version: T30_MODEL_VERSION,
    block_index: head.blockIndex,
    block_start_index: blockStart,
    coefficients: head.coefficients,
    intercept: head.intercept,
    scaler_center: head.scaler.center,
    scaler_scale: head.scaler.scale,
    feature_order_hash: T30_FEATURE_ORDER_HASH,
    config_hash: T30_CONFIG_HASH,
    training_row_count: head.trainingRowCount,
    training_start_ts: head.trainingStartTs || null,
    training_end_ts: head.trainingEndTs || null,
    training_start_index: head.trainingStartIndex,
    training_end_index: head.trainingEndIndex,
    training_fingerprint: head.trainingFingerprint,
    certified,
    converged: head.converged,
    iterations: head.iterations,
    gradient_norm: head.gradientNorm,
    artifact_hash: t30ArtifactHash(head),
    solver: T30_SOLVER,
    source,
  });

  return {
    fitId,
    blockIndex: head.blockIndex,
    blockStartIndex: blockStart,
    certified,
    head,
  };
}

/** Pre-boundary audit: is the fit governing the next row already minted? */
export async function t30RolloverAudit(
  sb: SupabaseClient,
  nextRowIndex: number,
): Promise<{ blockStart: number | null; fitId: string | null; present: boolean }> {
  const blockStart = t30BlockStart(nextRowIndex);
  if (blockStart == null) return { blockStart: null, fitId: null, present: false };
  const fitId = t30FitId(blockStart, "LIVE");
  const row = await readT30Fit(sb, fitId);
  return { blockStart, fitId, present: row != null };
}

export { t30BlockIndex };
