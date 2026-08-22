// T45 PriceFlow — certified fit rollover service (server only).
//
// One place owns the 96-row block rollover: load the certified fit for a block
// boundary, or mint it from the completed past-only training window and persist
// it idempotently. Concurrency is resolved by the database uniqueness
// constraint on (model_version, block_start_index): every writer mints the
// same deterministic artifact, the first insert wins, and every caller
// re-reads the stored row and verifies its hashes before scoring. Anything that
// does not verify fails closed — the caller must abstain.
//
// The frozen model itself is untouched: same feature order, scaler, solver,
// window, weighting and certification rules as `head.ts`.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  FEATURE_SCHEMA,
  MODEL_VERSION,
  T45PF_CONFIG_HASH,
  T45PF_FEATURE_ORDER,
  T45PF_FEATURE_ORDER_HASH,
  T45PF_IMPL_REVISION,
  T45PF_LOGISTIC_C,
  T45PF_SCALER,
  T45PF_SOLVER,
  T45PF_TRAIN_WINDOW,
} from "./config";
import { fitPFHead, pfBlockIndex, pfBlockStart, pfFitCertified, type PFHead } from "./head";
import { pfArtifactHash, pfFitId, pfStableArtifactHash } from "./replay";
import { insertPFFit, loadPFTrainingRows, readPFFit } from "./store.server";

type Row = Record<string, unknown>;

export type PFFitStatus =
  | "LOADED"
  | "MINTED"
  | "UNTRAINABLE"
  | "UNCERTIFIED"
  | "NONDETERMINISTIC"
  | "CONFLICTING_ARTIFACT";

export interface EnsuredPFFit {
  fitId: string;
  blockStart: number;
  status: PFFitStatus;
  head: PFHead | null;
  certified: boolean;
  artifactHash: string | null;
  minted: boolean;
  trainingRowCount: number | null;
  trainingStartTs: string | null;
  trainingEndTs: string | null;
  error: string | null;
}

export function headFromFitRow(row: Row): PFHead {
  return {
    scaler: {
      center: row.scaler_center as number[],
      scale: row.scaler_scale as number[],
    },
    coefficients: row.coefficients as number[],
    intercept: Number(row.intercept),
    trainingRowCount: Number(row.training_row_count),
    trainingStartTs: String(row.training_start_ts ?? ""),
    trainingEndTs: String(row.training_end_ts ?? ""),
    trainingFingerprint: String(row.training_fingerprint ?? ""),
    blockIndex: Number(row.block_index),
    blockStartIndex: Number(row.block_start_index),
    converged: row.converged === true,
    iterations: Number(row.iterations ?? 0),
    gradientNorm: Number(row.gradient_norm ?? 0),
  };
}

function fitRowFor(head: PFHead): Row {
  return {
    fit_id: pfFitId(head.blockStartIndex),
    model_version: MODEL_VERSION,
    config_hash: T45PF_CONFIG_HASH,
    feature_schema: FEATURE_SCHEMA,
    feature_order_hash: T45PF_FEATURE_ORDER_HASH,
    block_index: head.blockIndex,
    block_start_index: head.blockStartIndex,
    training_start_ts: head.trainingStartTs,
    training_end_ts: head.trainingEndTs,
    training_row_count: head.trainingRowCount,
    training_fingerprint: head.trainingFingerprint,
    feature_order: T45PF_FEATURE_ORDER,
    scaler: T45PF_SCALER,
    scaler_center: head.scaler.center,
    scaler_scale: head.scaler.scale,
    coefficients: head.coefficients,
    intercept: head.intercept,
    logistic_c: T45PF_LOGISTIC_C,
    solver: T45PF_SOLVER,
    converged: head.converged,
    certified: pfFitCertified(head),
    iterations: head.iterations,
    gradient_norm: head.gradientNorm,
    artifact_hash: pfArtifactHash(head),
    artifact_stable_hash: pfStableArtifactHash(head),
    impl_revision: T45PF_IMPL_REVISION,
  };
}

/** A stored artifact is usable only when its identity and hash still verify. */
function verifyStored(row: Row, head: PFHead): string | null {
  if (String(row.model_version) !== MODEL_VERSION) return "model_version";
  if (String(row.config_hash) !== T45PF_CONFIG_HASH) return "config_hash";
  if (String(row.feature_order_hash) !== T45PF_FEATURE_ORDER_HASH) return "feature_order_hash";
  if (Number(row.block_start_index) !== head.blockStartIndex) return "block_start_index";
  // Verify against the precision-stable hash: raw float8 values lose digits on
  // the database round-trip, so only the stable hash can be re-derived here.
  const stable = row.artifact_stable_hash == null ? null : String(row.artifact_stable_hash);
  if (stable && stable !== pfStableArtifactHash(head)) return "artifact_stable_hash";
  if (!Array.isArray(head.coefficients) || head.coefficients.length !== T45PF_FEATURE_ORDER.length) {
    return "coefficient_arity";
  }
  if (!head.coefficients.every((c) => Number.isFinite(c)) || !Number.isFinite(head.intercept)) {
    return "non_finite";
  }
  return null;
}

const fail = (
  fitId: string,
  blockStart: number,
  status: PFFitStatus,
  error: string,
): EnsuredPFFit => ({
  fitId,
  blockStart,
  status,
  head: null,
  certified: false,
  artifactHash: null,
  minted: false,
  trainingRowCount: null,
  trainingStartTs: null,
  trainingEndTs: null,
  error,
});

/**
 * Load-or-mint the certified fit for one 96-row block boundary.
 * Never throws for an operational miss: the caller records the exact status
 * and fails closed.
 */
export async function ensurePFFit(
  sb: SupabaseClient,
  blockStart: number,
  opts: { allowMint?: boolean } = {},
): Promise<EnsuredPFFit> {
  const allowMint = opts.allowMint !== false;
  const fitId = pfFitId(blockStart);

  const stored = await readPFFit(sb, fitId);
  if (stored) {
    const head = headFromFitRow(stored);
    const bad = verifyStored(stored, head);
    if (bad) return fail(fitId, blockStart, "CONFLICTING_ARTIFACT", `stored_mismatch:${bad}`);
    const certified = pfFitCertified(head);
    return {
      fitId,
      blockStart,
      status: certified ? "LOADED" : "UNCERTIFIED",
      head: certified ? head : null,
      certified,
      artifactHash: pfArtifactHash(head),
      minted: false,
      trainingRowCount: head.trainingRowCount,
      trainingStartTs: head.trainingStartTs,
      trainingEndTs: head.trainingEndTs,
      error: certified ? null : "stored_fit_uncertified",
    };
  }

  if (!allowMint) return fail(fitId, blockStart, "UNTRAINABLE", "fit_absent_mint_disabled");

  const history = await loadPFTrainingRows(sb, blockStart);
  const head = fitPFHead(blockStart, history);
  if (!head) {
    return fail(
      fitId,
      blockStart,
      "UNTRAINABLE",
      `insufficient_training_rows:${history.length}:window=${Math.max(
        0,
        blockStart - T45PF_TRAIN_WINDOW,
      )}-${blockStart - 1}`,
    );
  }
  // Determinism gate: an identical re-solve must produce an identical artifact.
  const repeat = fitPFHead(blockStart, history);
  if (!repeat || pfArtifactHash(repeat) !== pfArtifactHash(head)) {
    return fail(fitId, blockStart, "NONDETERMINISTIC", "repeat_fit_hash_mismatch");
  }
  if (!pfFitCertified(head)) {
    return {
      ...fail(fitId, blockStart, "UNCERTIFIED", "minted_fit_uncertified"),
      trainingRowCount: head.trainingRowCount,
      trainingStartTs: head.trainingStartTs,
      trainingEndTs: head.trainingEndTs,
    };
  }

  await insertPFFit(sb, fitRowFor(head));

  // Read back: the uniqueness constraint means the row we now read is the one
  // the whole fleet will use. Verify it before anybody scores against it.
  const persisted = await readPFFit(sb, fitId);
  if (!persisted) return fail(fitId, blockStart, "UNTRAINABLE", "fit_not_persisted");
  const persistedHead = headFromFitRow(persisted);
  if (pfStableArtifactHash(persistedHead) !== pfStableArtifactHash(head)) {
    return fail(fitId, blockStart, "CONFLICTING_ARTIFACT", "persisted_artifact_divergence");
  }
  const bad = verifyStored(persisted, persistedHead);
  if (bad) return fail(fitId, blockStart, "CONFLICTING_ARTIFACT", `persisted_mismatch:${bad}`);

  return {
    fitId,
    blockStart,
    status: "MINTED",
    head: persistedHead,
    certified: true,
    artifactHash: pfArtifactHash(persistedHead),
    minted: true,
    trainingRowCount: persistedHead.trainingRowCount,
    trainingStartTs: persistedHead.trainingStartTs,
    trainingEndTs: persistedHead.trainingEndTs,
    error: null,
  };
}

export interface PFRolloverAudit {
  sourceIndex: number;
  currentBlockStart: number | null;
  currentBlockIndex: number | null;
  currentFitPresent: boolean;
  currentFitCertified: boolean;
  nextBlockStart: number;
  rowsUntilNextBlock: number;
  nextTrainingWindowComplete: boolean;
  nextFitPresent: boolean;
  status: PFFitStatus | "PENDING";
  error: string | null;
}

/**
 * Preflight audit for the upcoming rollover. When `prepare` is set and the next
 * training window is already complete, the next fit is minted ahead of time so
 * the boundary run never pays for it on the hot path.
 */
export async function pfRolloverAudit(
  sb: SupabaseClient,
  sourceIndex: number,
  opts: { prepare?: boolean } = {},
): Promise<PFRolloverAudit> {
  const currentBlockStart = pfBlockStart(sourceIndex);
  const nextBlockStart =
    currentBlockStart == null
      ? Math.ceil(sourceIndex / 96) * 96
      : currentBlockStart + 96;
  const rowsUntilNextBlock = Math.max(0, nextBlockStart - sourceIndex);

  const currentRow =
    currentBlockStart == null ? null : await readPFFit(sb, pfFitId(currentBlockStart));
  const nextRow = await readPFFit(sb, pfFitId(nextBlockStart));

  let status: PFFitStatus | "PENDING" = nextRow ? "LOADED" : "PENDING";
  let error: string | null = null;
  let windowComplete = rowsUntilNextBlock === 0;

  if (!nextRow && opts.prepare && rowsUntilNextBlock === 0) {
    const ensured = await ensurePFFit(sb, nextBlockStart);
    status = ensured.status;
    error = ensured.error;
    windowComplete = ensured.status === "MINTED" || ensured.status === "LOADED";
  }

  return {
    sourceIndex,
    currentBlockStart,
    currentBlockIndex: currentBlockStart == null ? null : pfBlockIndex(currentBlockStart),
    currentFitPresent: currentRow != null,
    currentFitCertified: currentRow?.certified === true,
    nextBlockStart,
    rowsUntilNextBlock,
    nextTrainingWindowComplete: windowComplete,
    nextFitPresent: nextRow != null || status === "MINTED",
    status,
    error,
  };
}
