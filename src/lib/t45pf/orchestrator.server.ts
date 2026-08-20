// T45 PriceFlow Q37.5 — boundary orchestration, decisioning and resolution.
//
// Shadow-only: `webhook_eligible` and `webhook_sent` are forced false on every
// row and no outbound call exists in this module. Writes only to t45_pf_*.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  MODEL_NAME,
  MODEL_VARIANT,
  MODEL_VERSION,
  FEATURE_SCHEMA,
  PUBLICATION_MODE,
  T45PF_ACTIVATION_KEY,
  T45PF_BASE_HEAD,
  T45PF_CONFIG_HASH,
  T45PF_CUTOFF_OFFSET_MS,
  T45PF_EXPECTED_SECONDS,
  T45PF_FEATURE_ORDER,
  T45PF_FEATURE_ORDER_HASH,
  T45PF_FIRST_OFFSET_S,
  T45PF_IMPL_REVISION,
  T45PF_LAST_OFFSET_S,
  T45PF_LOGISTIC_C,
  T45PF_OUTCOME_SOURCE,
  T45PF_PREDICTIONS_TABLE,
  T45PF_PUBLISH_DEADLINE_MS,
  T45PF_REASONS,
  T45PF_SCALER,
  T45PF_SOLVER,
  TF_MS,
  boiseDate,
  floorTarget,
  isExactBoundary,
  utcDate,
} from "./config";
import { buildT45Features, type T45SecondBar } from "@/lib/t45/features";
import {
  fitPFHead,
  pfBlockIndex,
  pfBlockStart,
  pfDecide,
  pfFitCertified,
  pfProbability,
  pfScore,
  type PFHead,
} from "./head";
import { pfArtifactHash, pfFitId } from "./replay";
import {
  auditPF,
  insertPFFit,
  loadPFBars,
  loadPFPriorConfidences,
  loadPFTrainingRows,
  pfRowIndex,
  readPFActivation,
  readPFFit,
  upsertPFPrediction,
} from "./store.server";

type Row = Record<string, unknown>;

export interface PFRunResult {
  targetTs: string;
  decided: boolean;
  reason: string;
  probabilityGreen: number | null;
  confidenceRank: number | null;
  activePrediction: number | null;
  wouldTrade: boolean;
  observations: number;
  fitId: string | null;
  webhookEligible: false;
  elapsedMs: number;
}

export function pfTargetFor(nowMs: number): { targetTs: string; intoCandleMs: number } {
  const floor = floorTarget(nowMs);
  return { targetTs: new Date(floor).toISOString(), intoCandleMs: nowMs - floor };
}

export interface PacketIntegrity {
  expected: number;
  actual: number;
  unique: number;
  minOffset: number | null;
  maxOffset: number | null;
  missing: number[];
  duplicates: number[];
  forbiddenOffset: boolean;
  ready: boolean;
}

/** Offsets must be exactly 0..44, each once. Offset 45 is forbidden. */
export function inspectPacket(bars: readonly T45SecondBar[]): PacketIntegrity {
  const seen = new Map<number, number>();
  for (const b of bars) seen.set(b.offsetSeconds, (seen.get(b.offsetSeconds) ?? 0) + 1);
  const offsets = [...seen.keys()].sort((a, b) => a - b);
  const missing: number[] = [];
  for (let o = T45PF_FIRST_OFFSET_S; o <= T45PF_LAST_OFFSET_S; o++) {
    if (!seen.has(o)) missing.push(o);
  }
  const duplicates = offsets.filter((o) => (seen.get(o) ?? 0) > 1);
  const forbiddenOffset = offsets.some(
    (o) => o > T45PF_LAST_OFFSET_S || o < T45PF_FIRST_OFFSET_S,
  );
  return {
    expected: T45PF_EXPECTED_SECONDS,
    actual: bars.length,
    unique: offsets.length,
    minOffset: offsets.length ? offsets[0] : null,
    maxOffset: offsets.length ? offsets[offsets.length - 1] : null,
    missing,
    duplicates,
    forbiddenOffset,
    ready: missing.length === 0 && !forbiddenOffset,
  };
}

/** Build the PF vector from the shared feature map (R2 fields excluded). */
export function pfVectorFrom(values: Record<string, number | null>): number[] | null {
  const out: number[] = [];
  for (const name of T45PF_FEATURE_ORDER) {
    const v = values[name];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}

export async function runPriceFlowBoundary(
  sb: SupabaseClient,
  targetTsInput: string,
  opts: { allowLate?: boolean; runMode?: "LIVE" | "BACKFILL" } = {},
): Promise<PFRunResult> {
  const started = Date.now();
  const targetTs = new Date(targetTsInput).toISOString();
  const runMode = opts.runMode ?? "LIVE";
  const done = (r: Partial<PFRunResult> & { reason: string }): PFRunResult => ({
    targetTs,
    decided: false,
    probabilityGreen: null,
    confidenceRank: null,
    activePrediction: null,
    wouldTrade: false,
    observations: 0,
    fitId: null,
    webhookEligible: false,
    elapsedMs: Date.now() - started,
    ...r,
  });

  const identity: Row = {
    target_ts: targetTs,
    model_name: MODEL_NAME,
    model_version: MODEL_VERSION,
    model_variant: MODEL_VARIANT,
    base_head: T45PF_BASE_HEAD,
    config_hash: T45PF_CONFIG_HASH,
    feature_schema: FEATURE_SCHEMA,
    feature_order_hash: T45PF_FEATURE_ORDER_HASH,
    impl_revision: T45PF_IMPL_REVISION,
    run_mode: runMode,
    utc_date: utcDate(targetTs),
    local_date: boiseDate(targetTs),
    scaler: T45PF_SCALER,
    solver: T45PF_SOLVER,
    outcome_source: T45PF_OUTCOME_SOURCE,
  };

  if (!isExactBoundary(targetTs)) {
    return done({ reason: T45PF_REASONS.TIMING_INVALID });
  }
  const targetMs = new Date(targetTs).getTime();
  identity.decision_cutoff_ts = new Date(targetMs + T45PF_CUTOFF_OFFSET_MS).toISOString();

  // Exactly one decision per target.
  const { data: existingRow } = await sb
    .from(T45PF_PREDICTIONS_TABLE)
    .select("decision_valid, probability_green, confidence_rank, active_prediction, fit_id")
    .eq("target_ts", targetTs)
    .eq("model_version", MODEL_VERSION)
    .eq("run_mode", runMode)
    .maybeSingle();
  const existing = (existingRow ?? null) as Row | null;
  if (existing && existing.decision_valid === true) {
    return done({
      decided: true,
      reason: "ALREADY_DECIDED",
      probabilityGreen: (existing.probability_green as number | null) ?? null,
      confidenceRank: (existing.confidence_rank as number | null) ?? null,
      activePrediction: (existing.active_prediction as number | null) ?? null,
      fitId: (existing.fit_id as string | null) ?? null,
    });
  }

  const activation = await readPFActivation(sb);
  const mode = String(activation.mode ?? PUBLICATION_MODE);
  identity.activation_mode = mode;
  const write = async (extra: Row) => {
    await upsertPFPrediction(sb, {
      ...identity,
      decided_at: new Date().toISOString(),
      ...extra,
    });
  };

  if (mode !== "SHADOW_ONLY" && mode !== "ACTIVE") {
    await write({ decision_valid: false, decision_reason: T45PF_REASONS.INACTIVE });
    return done({ reason: T45PF_REASONS.INACTIVE });
  }

  const intoCandle = Date.now() - targetMs;
  if (runMode === "LIVE" && intoCandle < T45PF_CUTOFF_OFFSET_MS) {
    return done({ reason: "BEFORE_CUTOFF" });
  }
  if (
    runMode === "LIVE" &&
    intoCandle >= T45PF_PUBLISH_DEADLINE_MS &&
    !opts.allowLate
  ) {
    await write({ decision_valid: false, decision_reason: T45PF_REASONS.TIMING_INVALID });
    return done({ reason: T45PF_REASONS.TIMING_INVALID });
  }

  const bars = await loadPFBars(sb, targetTs);
  const packet = inspectPacket(bars);
  const lastBar = bars.length
    ? new Date(targetMs + (packet.maxOffset ?? 0) * 1000 + 1000).toISOString()
    : null;
  const packetRow: Row = {
    expected_observations: packet.expected,
    actual_observations: packet.actual,
    unique_observations: packet.unique,
    min_offset_seconds: packet.minOffset,
    max_offset_seconds: packet.maxOffset,
    missing_offsets: packet.missing,
    duplicate_offsets: packet.duplicates,
    source_last_bar_ts: lastBar,
    packet_ready: packet.ready,
    timing_valid: !packet.forbiddenOffset,
  };

  if (packet.forbiddenOffset) {
    await write({
      ...packetRow,
      decision_valid: false,
      decision_reason: T45PF_REASONS.TIMING_INVALID,
    });
    return done({ reason: T45PF_REASONS.TIMING_INVALID, observations: packet.unique });
  }
  if (!packet.ready) {
    await write({
      ...packetRow,
      decision_valid: false,
      decision_reason: T45PF_REASONS.PACKET_NOT_READY,
    });
    return done({ reason: T45PF_REASONS.PACKET_NOT_READY, observations: packet.unique });
  }

  // R2 is not an input: the shared builder is called with a null prior and the
  // PF vector is assembled from price/flow keys only.
  const built = buildT45Features(bars, null);
  const vector = built.spotComplete ? pfVectorFrom(built.values) : null;
  const featureValues: Record<string, number | null> = {};
  for (const name of T45PF_FEATURE_ORDER) featureValues[name] = built.values[name] ?? null;
  packetRow.feature_values_json = featureValues;
  packetRow.feature_complete = vector != null;

  if (!vector) {
    await write({
      ...packetRow,
      decision_valid: false,
      decision_reason: T45PF_REASONS.FEATURE_INVALID,
    });
    return done({ reason: T45PF_REASONS.FEATURE_INVALID, observations: packet.unique });
  }

  const index = await pfRowIndex(sb, targetTs);
  const blockStart = pfBlockStart(index);
  if (blockStart == null) {
    await write({
      ...packetRow,
      decision_valid: false,
      decision_reason: T45PF_REASONS.FIT_NOT_READY,
    });
    return done({ reason: T45PF_REASONS.FIT_NOT_READY, observations: packet.unique });
  }

  const fitId = pfFitId(blockStart);
  const stored = await readPFFit(sb, fitId);
  let head: PFHead | null = stored
    ? {
        scaler: {
          center: stored.scaler_center as number[],
          scale: stored.scaler_scale as number[],
        },
        coefficients: stored.coefficients as number[],
        intercept: Number(stored.intercept),
        trainingRowCount: Number(stored.training_row_count),
        trainingStartTs: String(stored.training_start_ts ?? ""),
        trainingEndTs: String(stored.training_end_ts ?? ""),
        trainingFingerprint: String(stored.training_fingerprint ?? ""),
        blockIndex: Number(stored.block_index),
        blockStartIndex: Number(stored.block_start_index),
        converged: stored.converged === true,
        iterations: Number(stored.iterations ?? 0),
        gradientNorm: Number(stored.gradient_norm ?? 0),
      }
    : null;

  if (!head) {
    const history = await loadPFTrainingRows(sb, blockStart);
    head = fitPFHead(blockStart, history);
    if (!head) {
      await write({
        ...packetRow,
        fit_block_index: pfBlockIndex(blockStart),
        fit_block_start_index: blockStart,
        decision_valid: false,
        decision_reason: T45PF_REASONS.FIT_NOT_READY,
      });
      return done({ reason: T45PF_REASONS.FIT_NOT_READY, observations: packet.unique });
    }
    await insertPFFit(sb, {
      fit_id: fitId,
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
      impl_revision: T45PF_IMPL_REVISION,
    });
  }

  const fitRow: Row = {
    fit_id: fitId,
    fit_block_index: head.blockIndex,
    fit_block_start_index: head.blockStartIndex,
    fit_training_row_count: head.trainingRowCount,
    fit_training_fingerprint: head.trainingFingerprint,
    fit_artifact_hash: pfArtifactHash(head),
    fit_certified: pfFitCertified(head),
  };

  if (!pfFitCertified(head)) {
    await write({
      ...packetRow,
      ...fitRow,
      decision_valid: false,
      decision_reason: T45PF_REASONS.FIT_UNCERTIFIED,
    });
    return done({ reason: T45PF_REASONS.FIT_UNCERTIFIED, fitId, observations: packet.unique });
  }

  const probability = pfProbability(head, vector);
  const priorConfidences = await loadPFPriorConfidences(sb, targetTs);
  const decision = pfDecide(probability, priorConfidences, T45PF_REASONS);
  const rankReady = decision.confidenceRank != null;

  await write({
    ...packetRow,
    ...fitRow,
    probability_green: decision.probabilityGreen,
    confidence: decision.confidence,
    confidence_rank: decision.confidenceRank,
    rank_history_count: decision.rankHistoryCount,
    base_direction: decision.baseDirection,
    active_prediction: rankReady ? decision.activePrediction : null,
    active_sleeve: rankReady ? decision.activeSleeve : "NONE",
    active_would_trade: rankReady ? decision.activeWouldTrade : false,
    decision_valid: rankReady,
    decision_reason: decision.reason,
  });

  await auditPF(sb, "boundary", {
    target_ts: targetTs,
    probability: decision.probabilityGreen,
    rank: decision.confidenceRank,
    reason: decision.reason,
    fit_id: fitId,
    elapsed_ms: Date.now() - started,
  });

  return done({
    decided: rankReady,
    reason: decision.reason,
    probabilityGreen: decision.probabilityGreen,
    confidenceRank: decision.confidenceRank,
    activePrediction: rankReady ? decision.activePrediction : null,
    wouldTrade: rankReady ? decision.activeWouldTrade : false,
    observations: packet.unique,
    fitId,
  });
}

/**
 * Idempotent resolution against the canonical confirmed OKX 15m candle.
 * Only resolution/audit fields are ever written here.
 */
export async function resolvePriceFlowBacklog(
  sb: SupabaseClient,
  opts: { limit?: number } = {},
): Promise<{ resolved: number }> {
  const { data } = await sb
    .from(T45PF_PREDICTIONS_TABLE)
    .select("target_ts, run_mode, active_prediction, active_would_trade, decision_valid")
    .eq("model_version", MODEL_VERSION)
    .is("resolved_at", null)
    .order("target_ts", { ascending: true })
    .limit(opts.limit ?? 500);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return { resolved: 0 };

  const oldest = new Date(String(rows[0].target_ts)).toISOString();
  const { data: candleData } = await sb
    .from("candles")
    .select("candle_ts, open, high, low, close")
    .gte("candle_ts", oldest)
    .lte("candle_ts", new Date(Date.now() - TF_MS).toISOString())
    .order("candle_ts", { ascending: true });
  const byTs = new Map(
    ((candleData ?? []) as Row[]).map((c) => [new Date(String(c.candle_ts)).toISOString(), c]),
  );

  let resolved = 0;
  for (const r of rows) {
    const ts = new Date(String(r.target_ts)).toISOString();
    const c = byTs.get(ts);
    if (!c) continue;
    const open = Number(c.open);
    const close = Number(c.close);
    if (!Number.isFinite(open) || !Number.isFinite(close)) continue;
    const actual = close > open ? 1 : close < open ? -1 : 0;
    const valid = r.decision_valid === true;
    const { result, score } = pfScore(
      valid ? (r.active_would_trade as boolean) : null,
      valid ? ((r.active_prediction ?? 0) as 1 | -1 | 0) : null,
      actual,
    );
    await sb
      .from(T45PF_PREDICTIONS_TABLE)
      .update({
        actual_open: open,
        actual_high: c.high == null ? null : Number(c.high),
        actual_low: c.low == null ? null : Number(c.low),
        actual_close: close,
        actual_direction: actual,
        outcome_source: T45PF_OUTCOME_SOURCE,
        resolved_at: new Date().toISOString(),
        active_result: result,
        active_score: score,
      } as never)
      .eq("target_ts", ts)
      .eq("model_version", MODEL_VERSION)
      .eq("run_mode", String(r.run_mode));
    resolved++;
  }
  return { resolved };
}

export const PF_ACTIVATION_KEY = T45PF_ACTIVATION_KEY;
