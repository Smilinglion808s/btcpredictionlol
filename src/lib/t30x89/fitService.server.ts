// Cross89 — certified fit minting, verification and rollover preflight.
//
// Every block boundary is fitted twice from the identical past-only window and
// certified only when both artifacts hash identically. A missing fit is never
// substituted with the previous block's artifact.

import { createHash } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  T30X_CONFIG_HASH,
  T30X_FEATURES_TABLE,
  T30X_FEATURE_ORDER,
  T30X_FEATURE_ORDER_HASH,
  T30X_FIRST_FIT_INDEX,
  T30X_FIT_BLOCK_SIZE,
  T30X_MODEL_VERSION,
  T30X_SOLVER,
} from "./config";
import { blockStartFor, fitX89Head, trainingRangeFor, type X89Head, type X89TrainingRow } from "./head";
import { loadX89Fit, upsertX89Fit } from "./store.server";

type SB = SupabaseClient<never, never, never>;

export function sha256Hex(s: string): string {
  return createHash("sha256").update(s).digest("hex");
}

/** Precision-stable serialization that survives float8 round-trips. */
function num(v: number): string {
  return Number(v).toPrecision(17);
}

export function artifactHashOf(head: X89Head): string {
  return sha256Hex(
    [
      head.blockStartIndex,
      head.trainingRowCount,
      head.trainingStartIndex,
      head.trainingEndIndex,
      head.trainingStartTs,
      head.trainingEndTs,
      head.scaler.center.map(num).join(","),
      head.scaler.scale.map(num).join(","),
      head.coefficients.map(num).join(","),
      num(head.intercept),
    ].join("|"),
  );
}

export function windowFingerprintOf(rows: readonly X89TrainingRow[]): string {
  return sha256Hex(rows.map((r) => `${r.index}:${r.targetTs}:${r.label}`).join("\n"));
}

/** Paged read of the training window; PostgREST caps a page at 1,000 rows. */
export async function loadTrainingRows(sb: SB, from: number, to: number): Promise<X89TrainingRow[]> {
  const out: X89TrainingRow[] = [];
  const PAGE = 1000;
  for (let start = from; start < to; start += PAGE) {
    const end = Math.min(start + PAGE, to) - 1;
    const { data, error } = await sb
      .from(T30X_FEATURES_TABLE)
      .select("source_index, target_ts, vector, label, feature_complete")
      .gte("source_index", start)
      .lte("source_index", end)
      .order("source_index", { ascending: true });
    if (error) throw new Error(`${T30X_FEATURES_TABLE}:${error.message}`);
    for (const r of (data ?? []) as Record<string, unknown>[]) {
      const vector = r['vector'] as number[] | null;
      const label = r['label'] as number | null;
      if (!r['feature_complete'] || !vector || vector.length !== T30X_FEATURE_ORDER.length) continue;
      if (label !== 0 && label !== 1) continue;
      out.push({
        index: Number(r['source_index']),
        targetTs: new Date(String(r['target_ts'])).toISOString(),
        vector,
        label,
      });
    }
  }
  return out;
}

export function headFromRow(row: Record<string, unknown>): X89Head {
  return {
    scaler: { center: row['center'] as number[], scale: row['scale'] as number[] },
    coefficients: row['coefficients'] as number[],
    intercept: Number(row['intercept']),
    trainingRowCount: Number(row['training_row_count']),
    trainingStartIndex: Number(row['training_start_index']),
    trainingEndIndex: Number(row['training_end_index']),
    trainingStartTs: new Date(String(row['training_start_ts'])).toISOString(),
    trainingEndTs: new Date(String(row['training_end_ts'])).toISOString(),
    blockStartIndex: Number(row['block_start_index']),
    converged: Boolean(row['converged']),
    iterations: Number(row['iterations']),
    gradientNorm: Number(row['gradient_norm']),
  };
}

export interface CertifiedFit {
  head: X89Head;
  fitId: string;
  artifactHash: string;
  certified: boolean;
  note: string | null;
  minted: boolean;
}

/** Load the certified artifact for a block, minting it when absent. */
export async function ensureX89Fit(sb: SB, blockStart: number): Promise<CertifiedFit | null> {
  const existing = await loadX89Fit(sb, blockStart);
  if (existing && existing['certified']) {
    return {
      head: headFromRow(existing),
      fitId: String(existing['fit_id']),
      artifactHash: String(existing['artifact_hash']),
      certified: true,
      note: (existing['certification_note'] as string | null) ?? null,
      minted: false,
    };
  }

  const { from, to } = trainingRangeFor(blockStart);
  const rows = await loadTrainingRows(sb, from, to);
  if (rows.length === 0) return null;

  const a = fitX89Head(blockStart, rows);
  const b = fitX89Head(blockStart, rows);
  const hashA = artifactHashOf(a);
  const hashB = artifactHashOf(b);
  const certified = hashA === hashB && a.converged;
  const blockIndex = (blockStart - T30X_FIRST_FIT_INDEX) / T30X_FIT_BLOCK_SIZE;
  const fitId = `t30x89-${blockStart}-${hashA.slice(0, 16)}`;

  await upsertX89Fit(sb, {
    fit_id: fitId,
    block_index: blockIndex,
    block_start_index: blockStart,
    training_start_index: a.trainingStartIndex,
    training_end_index: a.trainingEndIndex,
    training_start_ts: a.trainingStartTs,
    training_end_ts: a.trainingEndTs,
    training_row_count: a.trainingRowCount,
    center: a.scaler.center,
    scale: a.scaler.scale,
    coefficients: a.coefficients,
    intercept: a.intercept,
    converged: a.converged,
    iterations: a.iterations,
    gradient_norm: a.gradientNorm,
    feature_order_hash: T30X_FEATURE_ORDER_HASH,
    window_fingerprint: windowFingerprintOf(rows),
    artifact_hash: hashA,
    solver: T30X_SOLVER,
    model_version: T30X_MODEL_VERSION,
    config_hash: T30X_CONFIG_HASH,
    certified,
    certification_note: certified ? "double-fit hash match" : `hash mismatch ${hashA}/${hashB}`,
  });

  // Re-read so the artifact actually used is the persisted one.
  const persisted = await loadX89Fit(sb, blockStart);
  if (!persisted || !persisted['certified']) return null;
  const head = headFromRow(persisted);
  if (artifactHashOf(head) !== hashA) return null;
  return { head, fitId, artifactHash: hashA, certified: true, note: "minted", minted: true };
}

export interface FitPreflight {
  currentBlockStart: number | null;
  nextBlockStart: number | null;
  rowsRemaining: number | null;
  nextWindowComplete: boolean;
  nextCertified: boolean;
}

/** One-boundary-ahead audit so a rollover can never stall a live decision. */
export async function preflightX89Fit(sb: SB, nextIndex: number): Promise<FitPreflight> {
  const current = blockStartFor(nextIndex);
  const next = current == null ? T30X_FIRST_FIT_INDEX : current + T30X_FIT_BLOCK_SIZE;
  const rowsRemaining = next - nextIndex;
  const { from, to } = trainingRangeFor(next);
  const nextFit = await loadX89Fit(sb, next);
  const { count, error } = await sb
    .from(T30X_FEATURES_TABLE)
    .select("*", { count: "exact", head: true })
    .gte("source_index", from)
    .lt("source_index", to)
    .eq("feature_complete", true);
  if (error) throw new Error(`${T30X_FEATURES_TABLE}:${error.message}`);
  return {
    currentBlockStart: current,
    nextBlockStart: next,
    rowsRemaining,
    nextWindowComplete: (count ?? 0) > 0 && nextIndex >= to - T30X_FIT_BLOCK_SIZE,
    nextCertified: Boolean(nextFit?.['certified']),
  };
}
