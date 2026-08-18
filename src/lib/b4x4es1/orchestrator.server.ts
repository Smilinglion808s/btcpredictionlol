// B4x4-ES1 orchestrator — warmup, persistence, live path, webhook, resolution.
//
// Fully isolated: writes only to b4x4_es1_predictions / b4x4_es1_fits and
// never mutates, blocks or delays any other model.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ES1_A2_PRODUCTION_MODEL_VERSION,
  ES1_A2_SOURCE_VARIANT,
  ES1_B4_GUARD_VERSION,
  ES1_CANONICAL_CANDLE_SOURCE,
  ES1_DIRECTIONAL_VERSION,
  ES1_IMPLEMENTATION_REVISION,
  ES1_MODEL_NAME,
  ES1_MODEL_VERSION,
  ES1_ROW_MODEL_VERSIONS,
  ES1_PROSPECTIVE_TEST_ID,
  ES1_PUBLICATION_ENABLED,
  ES1_VARIANT,
  ES1_WEBHOOKS_ENABLED,
  TF_MS,
  es1ConfigHash,
  es1FeatureSchemaHash,
  es1LocalDate,
} from "./config";
import { b4x4BuildIdentity } from "../b4x4/build-identity";
import { buildFeatureRows, type ActualDirection, type Direction } from "./features";
import { guardAttribution, scoreAgainst, type Es1Decision } from "./engine";
import { replayEs1, type ReplayRow } from "./replay";
import { type MintedFitArtifact } from "./fitArtifacts";
import { CERTIFIED_FITTER_CODE_HASH } from "./certifiedFit";
import { loadEs1Inputs } from "./data.server";
import { predictProbabilityGreen, type Es1Fit } from "./priceHead";

type DbRow = Record<string, unknown>;

/**
 * Hard floor for live ES1 webhooks. The effective activation boundary is
 * resolved dynamically from `b4x4_es1_activation` (committed the first time
 * readiness is verified) and can only ever be at or after this floor.
 */
export const ES1_WEBHOOK_ACTIVATION_FLOOR_TS = "2026-08-15T04:15:00.000Z";
/** @deprecated kept as the floor alias for existing callers/tests. */
export const ES1_WEBHOOK_ACTIVATION_TS = ES1_WEBHOOK_ACTIVATION_FLOOR_TS;

/**
 * Hard ceiling for one live ES1 run. The old B4x4 path could hang on a slow
 * dependency and never publish; ES1 fails fast instead of stalling the boundary.
 */
export const ES1_LIVE_RUN_TIMEOUT_MS = 25_000;

export const ES1_RESOLVER_VERSION = "es1-resolver-r1";

const ES1_ACTIVATION_ID = "b4x4-es1";

export interface Es1ActivationRecord {
  activation_target_ts: string;
  activation_set_at: string;
  forward_test_sequence_number: number;
  activation_readiness_snapshot: Record<string, unknown>;
}

/** Next clean 15-minute boundary strictly after `fromMs`. */
export function nextCleanBoundaryTs(fromMs: number): string {
  return new Date(Math.floor(fromMs / TF_MS) * TF_MS + TF_MS).toISOString();
}

/** Read the committed activation record, if any. */
export async function readEs1Activation(
  supabase: SupabaseClient,
): Promise<Es1ActivationRecord | null> {
  const { data } = await supabase
    .from("b4x4_es1_activation")
    .select("*")
    .eq("id", ES1_ACTIVATION_ID)
    .maybeSingle();
  return (data as unknown as Es1ActivationRecord | null) ?? null;
}

/**
 * Commit the activation boundary exactly once, on the first target for which
 * the grid is genuinely ready. Returns the effective activation timestamp.
 */
export async function ensureEs1Activation(
  supabase: SupabaseClient,
  readiness: Record<string, unknown>,
): Promise<string> {
  const existing = await readEs1Activation(supabase);
  if (existing) return new Date(existing.activation_target_ts).toISOString();

  const floorMs = new Date(ES1_WEBHOOK_ACTIVATION_FLOOR_TS).getTime();
  const nextMs = new Date(nextCleanBoundaryTs(Date.now())).getTime();
  const activationTs = new Date(Math.max(floorMs, nextMs)).toISOString();
  await supabase.from("b4x4_es1_activation").upsert(
    {
      id: ES1_ACTIVATION_ID,
      model_version: ES1_MODEL_VERSION,
      activation_target_ts: activationTs,
      activation_set_at: new Date().toISOString(),
      forward_test_sequence_number: 0,
      activation_readiness_snapshot: readiness,
    } as never,
    { onConflict: "id", ignoreDuplicates: true },
  );
  const committed = await readEs1Activation(supabase);
  return committed ? new Date(committed.activation_target_ts).toISOString() : activationTs;
}

/** Effective activation boundary: committed record, else the frozen floor. */
export async function effectiveEs1ActivationTs(supabase: SupabaseClient): Promise<string> {
  const rec = await readEs1Activation(supabase);
  return rec ? new Date(rec.activation_target_ts).toISOString() : ES1_WEBHOOK_ACTIVATION_FLOOR_TS;
}

export interface Es1Context {
  targetCandleTs: string;
  runMode?: "LIVE" | "BACKFILL";
  schedulerInvocationId?: string | null;
  operationalGapStatus?: string | null;
  operationalGapReason?: string | null;
  catchupTargetTs?: string | null;
  /** Effective activation boundary for this run (defaults to the frozen floor). */
  activationTargetTs?: string | null;
  /** Boundary route owns its bounded source-candle retries. */
  recoverMissingSource?: boolean;
}

export function decisionToRow(ctx: Es1Context, row: ReplayRow): DbRow {
  const d: Es1Decision = row.decision;
  const runMode = ctx.runMode ?? "LIVE";
  const build = b4x4BuildIdentity();
  const fit: Es1Fit | null = row.fit;
  const targetMs = new Date(ctx.targetCandleTs).getTime();
  return {
    target_candle_ts: ctx.targetCandleTs,
    model_name: ES1_MODEL_NAME,
    model_version: ES1_MODEL_VERSION,
    variant: ES1_VARIANT,
    directional_version: ES1_DIRECTIONAL_VERSION,
    b4_guard_version: ES1_B4_GUARD_VERSION,
    prospective_test_id: ES1_PROSPECTIVE_TEST_ID,
    implementation_revision: ES1_IMPLEMENTATION_REVISION,
    config_hash: es1ConfigHash(),
    feature_schema_hash: es1FeatureSchemaHash(),
    run_mode: runMode,
    local_date: es1LocalDate(ctx.targetCandleTs),
    build_identifier: build.build_identifier,
    build_commit_sha: build.build_commit_sha,
    deploy_environment: build.deploy_environment,
    scheduler_invocation_id: ctx.schedulerInvocationId ?? null,
    operational_gap_status: ctx.operationalGapStatus ?? "NONE",
    operational_gap_reason: ctx.operationalGapReason ?? null,
    catchup_target_ts: ctx.catchupTargetTs ?? null,

    canonical_candle_source: ES1_CANONICAL_CANDLE_SOURCE,
    latest_source_candle_ts: row.featureRow.latestSourceTs,
    feature_cutoff_ts: row.featureRow.featureCutoffTs,
    timing_valid: true,
    timing_invalid_reason: null,
    feature_valid: row.featureRow.valid,
    feature_invalid_reason: row.featureRow.invalidReason,
    data_valid: d.dataValid,
    data_invalid_reason: d.dataInvalidReason,
    feature_vector_hash: row.featureRow.vectorHash || null,
    feature_values_json: row.featureRow.values,

    price_fit_id: fit?.fitId ?? null,
    price_fit_artifact_sha256: fit?.artifactSha256 ?? null,
    price_training_start_ts: fit?.trainingStartTs ?? null,
    price_training_end_ts: fit?.trainingEndTs ?? null,
    price_training_row_count: fit?.trainingRowCount ?? null,
    price_fit_source: row.resolvedFit?.source ?? null,
    price_fit_certified: row.resolvedFit?.certified ?? null,
    price_fit_window_fingerprint: row.resolvedFit?.windowFingerprint ?? null,
    certified_fitter_code_hash: row.resolvedFit?.certifiedFitterCodeHash ?? null,
    price_shadow_probability_green:
      row.resolvedFit?.shadow && row.featureRow.valid
        ? predictProbabilityGreen(row.resolvedFit.shadow, row.featureRow.vector)
        : null,
    price_shadow_fit_id: row.resolvedFit?.shadow?.fitId ?? null,
    decision_state_checksum: row.historyChecksum,
    decision_state_certified: row.decisionStateCertified,
    parity_certified: (row.resolvedFit?.certified ?? false) && row.decisionStateCertified,
    price_probability_green: d.priceProbabilityGreen,
    price_direction: d.priceDirection,
    price_confidence: d.priceConfidence,

    ob_snapshot_ts: d.obSnapshotTs,
    ob_capture_status: d.obCaptureStatus,
    ob_book_complete: d.obBookComplete,
    ob_depth_imbalance_10bps: d.obDepthImbalance10bps,
    ob_abs_depth: d.obAbsDepth,
    ob_history_count: d.obHistoryCount,
    ob_history_start_ts: d.obHistoryStartTs,
    ob_history_end_ts: d.obHistoryEndTs,
    ob_history_cap: d.obHistoryCap,
    ob_abs_percentile: d.obAbsPercentile,
    ob_route_qualified: d.obRouteQualified,
    ob_route_reject_reason: d.obRouteRejectReason,

    hybrid_direction: d.hybridDirection,
    hybrid_evidence: d.hybridEvidence,
    hybrid_route: d.hybridRoute,

    a2_source_variant: ES1_A2_SOURCE_VARIANT,
    a2_row_id: row.a2?.rowId ?? null,
    a2_prediction_id: row.a2?.predictionId ?? null,
    a2_model_fit_id: row.a2?.modelFitId ?? null,
    a2_production_model_version: row.a2?.productionModelVersion ?? ES1_A2_PRODUCTION_MODEL_VERSION,
    a2_probability_green: d.a2ProbabilityGreen,
    a2_direction: d.a2Direction,
    a2_confidence: d.a2Confidence,
    a2_agrees: d.a2Agrees,

    price_confidence_rank: d.priceConfidenceRank,
    price_rank_history_count: d.priceRankHistoryCount,
    a2_confidence_rank: d.a2ConfidenceRank,
    a2_rank_history_count: d.a2RankHistoryCount,
    combined_confidence_rank: d.combinedConfidenceRank,
    combined_rank_qualified: d.combinedRankQualified,

    source_index_absolute: d.sourceIndexAbsolute,
    b4_global_rank: d.b4GlobalRank,
    b4_global_history_count: d.b4GlobalHistoryCount,
    b4_same_side_rank: d.b4SameSideRank,
    b4_same_side_input_count: d.b4SameSideInputCount,
    b4_same_side_history_count: d.b4SameSideHistoryCount,
    b4_global_quartile: d.b4GlobalQuartile,
    b4_same_side_quartile: d.b4SameSideQuartile,
    b4_cell: d.b4Cell,
    b4_training_start_index: d.b4TrainingStartIndex,
    b4_training_end_index: d.b4TrainingEndIndex,
    b4_reference_start_index: d.b4ReferenceStartIndex,
    b4_reference_end_index: d.b4ReferenceEndIndex,
    b4_cell_wins: d.b4CellWins,
    b4_cell_losses: d.b4CellLosses,
    b4_cell_resolved_count: d.b4CellResolvedCount,
    b4_p_correct: d.b4PCorrect,
    b4_quality_percentile: d.b4QualityPercentile,
    b4_reference_count: d.b4ReferenceCount,
    b4_ready: d.b4Ready,
    b4_not_ready_reason: d.b4NotReadyReason,
    b4_guard_veto_fired: d.b4GuardVetoFired,

    aligned_candidate_before_b4: d.alignedCandidateBeforeB4,
    aligned_candidate_direction: d.alignedCandidateDirection,
    without_b4_guard_would_trade: d.withoutB4GuardWouldTrade,
    without_b4_guard_direction: d.withoutB4GuardDirection,
    without_b4_guard_decision_reason: d.withoutB4GuardDecisionReason,
    final_prediction: d.finalPrediction,
    would_trade: d.wouldTrade,
    decision_reason: d.decisionReason,
    webhook_eligible:
      ES1_PUBLICATION_ENABLED &&
      runMode === "LIVE" &&
      d.wouldTrade &&
      row.resolvedFit?.certified === true &&
      row.decisionStateCertified &&
      (ctx.operationalGapStatus ?? "NONE") === "NONE" &&
      targetMs >= new Date(ctx.activationTargetTs ?? ES1_WEBHOOK_ACTIVATION_FLOOR_TS).getTime(),

    resolver_version: ES1_RESOLVER_VERSION,
  };
}

function fitToRow(fit: Es1Fit): DbRow {
  return {
    fit_id: fit.fitId,
    artifact_sha256: fit.artifactSha256,
    feature_schema_hash: fit.featureSchemaHash,
    config_hash: es1ConfigHash(),
    specification: fit.specification,
    scaler_name: fit.scalerName,
    scaler_center: fit.scaler.center,
    scaler_scale: fit.scaler.scale,
    coefficients: fit.coefficients,
    intercept: fit.intercept,
    logistic_c: fit.C,
    solver: fit.solver,
    converged: fit.converged,
    iterations: fit.iterations,
    gradient_norm: fit.gradientNorm,
    training_row_count: fit.trainingRowCount,
    training_start_ts: fit.trainingStartTs,
    training_end_ts: fit.trainingEndTs,
    training_start_index: fit.trainingStartIndex,
    training_end_index: fit.trainingEndIndex,
    block_index: fit.blockIndex,
    model_version: ES1_MODEL_VERSION,
    fit_source: fit.fitSource ?? null,
    window_fingerprint: fit.windowFingerprint ?? null,
    price_fit_certified: fit.priceFitCertified ?? false,
    certified_fitter_code_hash: CERTIFIED_FITTER_CODE_HASH,
  };
}

/**
 * Load previously minted certified artifacts so a replay reuses the exact
 * artifact that was live, instead of re-minting it. Frozen JSON artifacts
 * always win over these.
 */
async function loadMintedArtifacts(
  supabase: SupabaseClient,
): Promise<Map<number, MintedFitArtifact>> {
  const out = new Map<number, MintedFitArtifact>();
  const { data, error } = await supabase
    .from("b4x4_es1_fits")
    .select(
      "block_index, model_version, feature_schema_hash, fit_source, window_fingerprint, price_fit_certified, artifact_sha256, scaler_center, scaler_scale, coefficients, intercept, training_row_count, training_start_ts, training_end_ts, training_start_index, training_end_index",
    )
    .eq("model_version", ES1_MODEL_VERSION)
    .eq("feature_schema_hash", es1FeatureSchemaHash())
    .eq("fit_source", "ts-lbfgs-certified")
    .eq("price_fit_certified", true);
  if (error || !data) return out;
  for (const r of data as unknown as Array<Record<string, never>>) {
    const row = r as Record<string, unknown>;
    if (typeof row["block_index"] !== "number" || typeof row["window_fingerprint"] !== "string") continue;
    out.set(row["block_index"] as number, {
      boundary: row["block_index"] as number,
      modelVersion: String(row["model_version"]),
      featureSchemaHash: String(row["feature_schema_hash"]),
      fitSource: "ts-lbfgs-certified",
      artifactSha256: String(row["artifact_sha256"]),
      windowFingerprint: row["window_fingerprint"] as string,
      center: row["scaler_center"] as number[],
      scale: row["scaler_scale"] as number[],
      coefficients: row["coefficients"] as number[],
      intercept: Number(row["intercept"]),
      trainingRowCount: Number(row["training_row_count"]),
      trainingStartTs: String(row["training_start_ts"]),
      trainingEndTs: String(row["training_end_ts"]),
      trainingStartIndex: Number(row["training_start_index"]),
      trainingEndIndex: Number(row["training_end_index"]),
    });
  }
  return out;
}

// ---- replay cache -----------------------------------------------------
// A full replay is deterministic and expensive; cache it briefly so the live
// path never pays for it twice inside one boundary.
let cache: { key: string; at: number; rows: ReplayRow[]; fits: Es1Fit[] } | null = null;
const CACHE_TTL_MS = 60_000;

export async function buildEs1Replay(
  supabase: SupabaseClient,
  opts: { upTo?: string; force?: boolean } = {},
): Promise<{ rows: ReplayRow[]; fits: Es1Fit[] }> {
  const key = opts.upTo ?? "latest";
  if (!opts.force && cache && cache.key === key && Date.now() - cache.at < CACHE_TTL_MS) {
    return { rows: cache.rows, fits: cache.fits };
  }
  const inputs = await loadEs1Inputs(supabase, { upTo: opts.upTo });
  const featureRows = buildFeatureRows(inputs.candles);
  const mintedArtifacts = await loadMintedArtifacts(supabase);
  const result = replayEs1({ featureRows, a2: inputs.a2, ob: inputs.ob, mintedArtifacts });
  cache = { key, at: Date.now(), rows: result.rows, fits: result.fits };
  return result;
}

async function persistFits(supabase: SupabaseClient, fits: readonly Es1Fit[]): Promise<number> {
  if (!fits.length) return 0;
  const { error } = await supabase.from("b4x4_es1_fits").upsert(fits.map(fitToRow) as never, {
    onConflict: "block_index,feature_schema_hash",
    ignoreDuplicates: true,
  });
  if (error) throw new Error(`es1_fits_upsert:${error.message}`);
  return fits.length;
}

/**
 * Warm + backfill: trains every fit block and writes an audit row for every
 * historical target that has none. Backfill rows are never webhook-eligible.
 */
export async function ensureEs1Warm(
  supabase: SupabaseClient,
  opts: { schedulerInvocationId?: string | null; limit?: number } = {},
): Promise<{ fits: number; targets: number; created: number; ready: boolean }> {
  const { rows, fits } = await buildEs1Replay(supabase, { force: true });
  await persistFits(supabase, fits);
  if (!rows.length) return { fits: fits.length, targets: 0, created: 0, ready: false };

  const { data: existing, error } = await supabase
    .from("b4x4_es1_predictions")
    .select("target_candle_ts")
    .in("model_version", ES1_ROW_MODEL_VERSIONS);
  if (error) throw new Error(`es1_warm_existing:${error.message}`);
  const have = new Set(
    ((existing ?? []) as DbRow[]).map((r) => new Date(String(r.target_candle_ts)).toISOString()),
  );

  const nowMs = Date.now();
  const missing = rows.filter(
    (r) => !have.has(r.targetTs) && new Date(r.targetTs).getTime() + TF_MS <= nowMs,
  );
  const slice = opts.limit ? missing.slice(-opts.limit) : missing;

  let created = 0;
  const batch = 200;
  for (let i = 0; i < slice.length; i += batch) {
    const payload = slice.slice(i, i + batch).map((r) => ({
      ...decisionToRow(
        {
          targetCandleTs: r.targetTs,
          runMode: "BACKFILL",
          schedulerInvocationId: opts.schedulerInvocationId ?? null,
          operationalGapStatus: "WARMUP",
          operationalGapReason: "HISTORICAL_BACKFILL",
        },
        r,
      ),
      webhook_eligible: false,
      run_started_at: new Date().toISOString(),
      run_finished_at: new Date().toISOString(),
    }));
    const { error: upsertError } = await supabase
      .from("b4x4_es1_predictions")
      .upsert(payload as never, {
        onConflict: "target_candle_ts,model_version",
        ignoreDuplicates: true,
      });
    if (upsertError) throw new Error(`es1_warm_upsert:${upsertError.message}`);
    created += payload.length;
  }

  // Resolve every backfilled target whose outcome is already canonical.
  await resolveEs1Backlog(supabase);

  const last = rows[rows.length - 1];
  return {
    fits: fits.length,
    targets: rows.length,
    created,
    ready: last?.fit != null,
  };
}

/**
 * Live ES1 run for one target boundary. Never throws; a failure is logged and
 * returns null so no other model is affected.
 */
export async function runEs1ForTarget(
  supabase: SupabaseClient,
  ctx: Es1Context,
): Promise<DbRow | null> {
  const runStartedAt = new Date().toISOString();
  const targetTs = new Date(ctx.targetCandleTs).toISOString();
  try {
    const { data: prior } = await supabase
      .from("b4x4_es1_predictions")
      .select("*")
      .in("model_version", ES1_ROW_MODEL_VERSIONS)
      .eq("target_candle_ts", targetTs)
      .maybeSingle();
    if (prior) return prior as unknown as DbRow;

    // Use the short-lived cache first; only pay for a full replay when the
    // cache does not already cover this target boundary.
    let { rows, fits } = await buildEs1Replay(supabase, {});
    let match = rows.find((r) => r.targetTs === targetTs);
    if (!match && ctx.recoverMissingSource !== false) {
      ({ rows, fits } = await buildEs1Replay(supabase, { force: true }));
      match = rows.find((r) => r.targetTs === targetTs);
    }
    if (!match) {
      // The source candle (target - 15m) is not in the canonical stream yet —
      // almost always a rate-limited candle fetch. Re-ingest and replay once
      // more so a transient exchange 429 can never drop an ES1 boundary.
      try {
        const { fetchAndUpsertCandles } = await import("@/lib/okx.server");
        await fetchAndUpsertCandles(supabase);
        ({ rows, fits } = await buildEs1Replay(supabase, { force: true }));
        match = rows.find((r) => r.targetTs === targetTs);
      } catch {
        /* fall through */
      }
    }
    if (!match) return null;

    await persistFits(supabase, fits).catch(() => 0);

    // Commit (or read) the activation boundary from the persisted record. The
    // boundary is committed the first time the grid is genuinely ready, so a
    // late deployment activates on the next clean boundary, never mid-candle.
    let activationTargetTs = ctx.activationTargetTs ?? null;
    if (!activationTargetTs) {
      const d = match.decision;
      activationTargetTs = d.b4Ready
        ? await ensureEs1Activation(supabase, {
            source_index_absolute: d.sourceIndexAbsolute ?? null,
            b4_ready: d.b4Ready,
            b4_cell: d.b4Cell ?? null,
            b4_p_correct: d.b4PCorrect ?? null,
            price_fit_id: d.priceFitId ?? null,
            readiness_checked_at: new Date().toISOString(),
          }).catch(() => null)
        : await effectiveEs1ActivationTs(supabase).catch(() => null);
    }

    const row = {
      ...decisionToRow(
        {
          ...ctx,
          targetCandleTs: targetTs,
          runMode: ctx.runMode ?? "LIVE",
          activationTargetTs: activationTargetTs ?? ES1_WEBHOOK_ACTIVATION_FLOOR_TS,
        },
        match,
      ),
      run_started_at: runStartedAt,
      run_finished_at: new Date().toISOString(),
    };

    const { data, error } = await supabase
      .from("b4x4_es1_predictions")
      .upsert(row as never, {
        onConflict: "target_candle_ts,model_version",
        ignoreDuplicates: true,
      })
      .select("*")
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (data) return data as unknown as DbRow;
    const { data: existing } = await supabase
      .from("b4x4_es1_predictions")
      .select("*")
      .in("model_version", ES1_ROW_MODEL_VERSIONS)
      .eq("target_candle_ts", targetTs)
      .maybeSingle();
    return (existing as unknown as DbRow | null) ?? null;
  } catch (e) {
    try {
      await supabase.from("api_runs").insert({
        run_type: "b4x4-es1-error",
        response_payload: {
          error: e instanceof Error ? e.message : String(e),
          target_candle_ts: targetTs,
        },
        success: false,
        error_message: e instanceof Error ? e.message : String(e),
      });
    } catch {
      /* never block */
    }
    return null;
  }
}

/**
 * Emit the active B4x4-ES1 directional webhook exactly once for a live row.
 *
 * The active model is B4x4-ES1 Binance Dual-Venue Adaptive R1: the published
 * direction always comes from the dual-venue adaptive decision. The legacy ES1
 * chain and the Balanced 3-of-4 chain are retained as scored counterfactuals
 * only and can never publish.
 */
export async function maybeSendEs1Webhook(
  supabase: SupabaseClient,
  row: DbRow | null,
): Promise<boolean> {
  try {
    if (!ES1_WEBHOOKS_ENABLED || !ES1_PUBLICATION_ENABLED) return false;
    if (!row) return false;
    if (row.run_mode !== "LIVE") return false;
    if (row.dual_adaptive_would_trade !== true) return false;
    if (row.dual_adaptive_webhook_eligible !== true) return false;
    if (row.webhook_sent_at) return false;
    const direction = row.dual_adaptive_candidate_direction;
    if (direction !== "GREEN" && direction !== "RED") return false;
    const targetMs = new Date(String(row.target_candle_ts)).getTime();
    if (!Number.isFinite(targetMs)) return false;
    // Never publish for a candle that is already meaningfully underway or
    // closed — the webhook must always describe the upcoming candle.
    if (Date.now() - targetMs > 90_000) return false;
    const activationTs = row.dual_adaptive_activation_target_ts
      ? new Date(String(row.dual_adaptive_activation_target_ts)).toISOString()
      : null;
    if (!activationTs || targetMs < new Date(activationTs).getTime()) return false;

    const { data: claimed } = await supabase
      .from("b4x4_es1_predictions")
      .update({
        webhook_sent_at: new Date().toISOString(),
        dual_adaptive_webhook_sent_at: new Date().toISOString(),
      } as never)
      .eq("id", row.id as string)
      .is("webhook_sent_at", null)
      .select("id")
      .maybeSingle();
    if (!claimed) return false;

    const {
      MODEL_VERSION: DUAL_MODEL_VERSION,
      POLICY_VERSION: DUAL_POLICY_VERSION,
      VARIANT: DUAL_VARIANT,
    } = await import("./dualAdaptive");
    const { deliverWebhook, formatMountainTime } = await import("../webhooks.server");
    const startsAt = new Date(targetMs).toISOString();
    const endsAt = new Date(targetMs + 15 * 60 * 1000).toISOString();
    const nowIso = new Date().toISOString();
    const predictionLabel = direction === "GREEN" ? "YES" : "NO";
    const conf = row.hybrid_evidence != null ? Number(row.hybrid_evidence) : null;
    await deliverWebhook(supabase, "prediction.created", {
      model: ES1_MODEL_NAME,
      model_name: ES1_MODEL_NAME,
      model_version: DUAL_MODEL_VERSION,
      decision_policy_version: DUAL_POLICY_VERSION,
      variant: DUAL_VARIANT,
      legacy_model_version: ES1_MODEL_VERSION,

      // TD1-RC compatible core contract
      prediction: predictionLabel,
      decision: predictionLabel,
      direction_label: predictionLabel,
      direction,
      trade: true,
      confidence: conf == null ? 0 : Math.round(conf * 100),
      probability_green: null,
      base_decision: predictionLabel,
      override_reasons: [],

      // Candle timing (required by the bot)
      candle_starts_at: startsAt,
      candle_starts_at_mt: formatMountainTime(startsAt),
      candle_ends_at: endsAt,
      candle_ends_at_mt: formatMountainTime(endsAt),
      target_candle_ts: startsAt,
      target_candle_close_at: endsAt,
      target_candle_close_ts: endsAt,
      target_is_upcoming: true,

      dedupe_key: `BTC-USDT-15m-${startsAt}-es1`,
      idempotency_key: `${row.id}:${DUAL_MODEL_VERSION}`,
      prediction_id: row.id ?? null,
      es1_row_id: row.id ?? null,

      // Dual-venue adaptive decision audit
      spot_mode: row.dual_adaptive_spot_mode ?? null,
      spot_direction: row.dual_adaptive_spot_direction ?? null,
      perp_mode: row.dual_adaptive_perp_mode ?? null,
      perp_direction: row.dual_adaptive_perp_direction ?? null,
      venue_agreement: row.dual_adaptive_venue_agreement ?? null,
      decision_reason: row.dual_adaptive_decision_reason ?? null,
      legacy_decision_reason: row.decision_reason ?? null,

      route: row.hybrid_route,
      selected_route: row.hybrid_route ?? null,
      hybrid_evidence: conf,
      combined_confidence_rank: row.combined_confidence_rank,
      p_correct: row.b4_p_correct,

      timing_status: "ON_TIME",
      sent_at: nowIso,
      sent_at_mt: formatMountainTime(nowIso),
      timezone: "America/Denver",
    } as never);
    return true;

  } catch {
    return false;
  }
}

/** Idempotent resolution for one target candle. */
export async function resolveEs1Row(
  supabase: SupabaseClient,
  targetCandleTs: string,
  actualDirection: ActualDirection,
  ohlc?: {
    open?: number | null;
    high?: number | null;
    low?: number | null;
    close?: number | null;
    volume?: number | null;
  },
): Promise<void> {
  const targetTs = new Date(targetCandleTs).toISOString();
  let rowId: string | null = null;
  try {
    const { data } = await supabase
      .from("b4x4_es1_predictions")
      .select(
        "id, target_candle_ts, hybrid_direction, final_prediction, would_trade, resolved_at, resolution_attempt_count, " +
          "b4_guard_veto_fired, without_b4_guard_would_trade, without_b4_guard_direction, " +
          "balanced_final_prediction, balanced_would_trade, balanced_legacy_direction, " +
          "balanced_legacy_would_trade, balanced_resolved_at",
      )
      .in("model_version", ES1_ROW_MODEL_VERSIONS)
      .eq("target_candle_ts", targetTs)
      .maybeSingle();
    const row = data as unknown as DbRow | null;
    if (!row) return;
    rowId = String(row.id);

    // Score the retained balanced counterfactual and every comparison policy
    // first; this is idempotent and independent of the resolutions below.
    if (!row.balanced_resolved_at) {
      try {
        const { resolveBalancedRow } = await import("./balanced.server");
        await resolveBalancedRow(supabase, row, actualDirection);
      } catch {
        /* never block legacy resolution */
      }
    }
    // ACTIVE MODEL resolution: Binance Dual-Venue Adaptive R1.
    if (!row.dual_adaptive_resolved_at) {
      try {
        const { resolveDualAdaptiveRow } = await import("./dualAdaptive.server");
        await resolveDualAdaptiveRow(supabase, row, actualDirection);
      } catch {
        /* never block legacy resolution */
      }
    }
    if (row.resolved_at) return;


    const final = scoreAgainst((row.final_prediction as Direction | null) ?? null, actualDirection);
    const raw = scoreAgainst((row.hybrid_direction as Direction | null) ?? null, actualDirection);
    const withoutGuardTrade = row.without_b4_guard_would_trade === true;
    const withoutGuardScore = withoutGuardTrade
      ? scoreAgainst((row.without_b4_guard_direction as Direction | null) ?? null, actualDirection)
          .score
      : null;
    const attribution = guardAttribution(
      row.b4_guard_veto_fired === true,
      withoutGuardTrade,
      withoutGuardScore,
      actualDirection,
    );

    await supabase
      .from("b4x4_es1_predictions")
      .update({
        actual_open: ohlc?.open ?? null,
        actual_high: ohlc?.high ?? null,
        actual_low: ohlc?.low ?? null,
        actual_close: ohlc?.close ?? null,
        actual_volume: ohlc?.volume ?? null,
        actual_direction: actualDirection,
        result: row.would_trade === true ? (final.result ?? "PUSH") : "PUSH",
        result_score: row.would_trade === true ? final.score : 0,
        raw_counterfactual_result: raw.result,
        raw_counterfactual_score: raw.score,
        without_b4_guard_score: withoutGuardScore,
        b4_guard_attribution_class: attribution.klass,
        b4_guard_incremental_value: attribution.value,
        resolved_at: new Date().toISOString(),
        resolution_attempt_count: Number(row.resolution_attempt_count ?? 0) + 1,
        last_resolution_attempt_at: new Date().toISOString(),
        last_resolution_error: null,
        resolver_version: ES1_RESOLVER_VERSION,
      } as never)
      .eq("id", rowId)
      .is("resolved_at", null);
  } catch (e) {
    try {
      if (rowId) {
        await supabase
          .from("b4x4_es1_predictions")
          .update({
            last_resolution_attempt_at: new Date().toISOString(),
            last_resolution_error: e instanceof Error ? e.message : String(e),
            resolver_version: ES1_RESOLVER_VERSION,
          } as never)
          .eq("id", rowId)
          .is("resolved_at", null);
      }
    } catch {
      /* never block */
    }
  }
}

/** Resolve every unresolved ES1 row whose canonical target candle exists. */
export async function resolveEs1Backlog(
  supabase: SupabaseClient,
  opts: { limit?: number } = {},
): Promise<{ resolved: number }> {
  const { data } = await supabase
    .from("b4x4_es1_predictions")
    .select("target_candle_ts")
    .in("model_version", ES1_ROW_MODEL_VERSIONS)
    .is("resolved_at", null)
    .order("target_candle_ts", { ascending: true })
    .limit(opts.limit ?? 500);
  const targets = ((data ?? []) as DbRow[]).map((r) =>
    new Date(String(r.target_candle_ts)).toISOString(),
  );
  if (!targets.length) return { resolved: 0 };

  const { loadCanonicalCandles } = await import("./data.server");
  const candles = await loadCanonicalCandles(supabase);
  const byTs = new Map(candles.map((c) => [c.candleTs, c]));
  let resolved = 0;
  for (const ts of targets) {
    const c = byTs.get(ts);
    if (!c) continue;
    const dir: ActualDirection = c.close > c.open ? "GREEN" : c.close < c.open ? "RED" : "PUSH";
    await resolveEs1Row(supabase, ts, dir, {
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
    });
    resolved++;
  }
  return { resolved };
}
