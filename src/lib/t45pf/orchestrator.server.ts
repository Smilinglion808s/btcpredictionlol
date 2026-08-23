// T45 PriceFlow Q37.5 — boundary orchestration, decisioning and resolution.
//
// Sole active webhook source: only LIVE, rank-passing, would-trade rows emit,
// and only when activation is ACTIVE with webhooks enabled. Writes only to t45_pf_*.

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
  pfBlockIndex,
  pfBlockStart,
  pfDecide,
  pfProbability,
  pfScore,
} from "./head";
import { ensurePFFit, pfRolloverAudit } from "./fitService.server";
import { pfArtifactHash } from "./replay";
import {
  auditPF,
  loadPFBars,
  loadPFPriorConfidences,
  loadPFTrainingRows,
  markPFWebhook,
  pfRowIndex,
  readPFActivation,
  upsertPFPrediction,
} from "./store.server";
import { deliverWebhookNow, primeWebhookEndpoints } from "@/lib/webhooks.server";
import { buildPriceFlowWebhookPayload } from "./webhook.server";

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
  webhookEligible: boolean;
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
  opts: {
    allowLate?: boolean;
    runMode?: "LIVE" | "BACKFILL";
    executionPath?: "IMMEDIATE_BOUNDARY" | "WATCHDOG" | "CATCHUP" | "BACKFILL";
  } = {},
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
    execution_path: opts.executionPath ?? (runMode === "LIVE" ? "IMMEDIATE_BOUNDARY" : "BACKFILL"),
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

  // Warm the webhook endpoint cache while we still have time budget, so the
  // send at decision time performs zero database reads.
  const webhookArmed =
    runMode === "LIVE" && mode === "ACTIVE" && activation.webhooks_enabled === true;
  if (webhookArmed) {
    void primeWebhookEndpoints(sb).catch(() => {});
  }

  const write = async (extra: Row) => {
    const decidedAt = Date.now();
    await upsertPFPrediction(sb, {
      ...identity,
      decided_at: new Date(decidedAt).toISOString(),
      // Seconds-resolution timing: how far past the candle open the decision landed.
      decision_offset_ms: decidedAt - targetMs,
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

  // Load-or-mint the certified fit for this 96-row block. Fit failures never
  // abort the request: the fail-closed row is written immediately with the
  // exact operational error.
  let ensured;
  try {
    ensured = await ensurePFFit(sb, blockStart);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await write({
      ...packetRow,
      fit_block_index: pfBlockIndex(blockStart),
      fit_block_start_index: blockStart,
      decision_valid: false,
      decision_reason: T45PF_REASONS.FIT_NOT_READY,
      last_resolution_error: `fit_exception:${message}`.slice(0, 400),
    });
    await auditPF(
      sb,
      "fit-exception",
      { target_ts: targetTs, block_start: blockStart, error: message },
      false,
    );
    return done({ reason: T45PF_REASONS.FIT_NOT_READY, observations: packet.unique });
  }

  const fitId = ensured.fitId;
  const head = ensured.head;
  if (!head || !ensured.certified) {
    const uncertified =
      ensured.status === "UNCERTIFIED" || ensured.status === "CONFLICTING_ARTIFACT";
    const reason = uncertified
      ? T45PF_REASONS.FIT_UNCERTIFIED
      : T45PF_REASONS.FIT_NOT_READY;
    await write({
      ...packetRow,
      fit_id: uncertified ? fitId : null,
      fit_block_index: pfBlockIndex(blockStart),
      fit_block_start_index: blockStart,
      fit_certified: false,
      decision_valid: false,
      decision_reason: reason,
      last_resolution_error: ensured.error?.slice(0, 400) ?? null,
    });
    await auditPF(
      sb,
      "fit-not-ready",
      {
        target_ts: targetTs,
        block_start: blockStart,
        status: ensured.status,
        error: ensured.error,
      },
      false,
    );
    return done({ reason, fitId: uncertified ? fitId : null, observations: packet.unique });
  }

  const fitRow: Row = {
    fit_id: fitId,
    fit_block_index: head.blockIndex,
    fit_block_start_index: head.blockStartIndex,
    fit_training_row_count: head.trainingRowCount,
    fit_training_fingerprint: head.trainingFingerprint,
    fit_artifact_hash: pfArtifactHash(head),
    fit_certified: true,
  };


  const probability = pfProbability(head, vector);
  const priorConfidences = await loadPFPriorConfidences(sb, targetTs);
  const decision = pfDecide(probability, priorConfidences, T45PF_REASONS);
  const rankReady = decision.confidenceRank != null;

  // Outbound webhook — LIVE tradeable decisions only, and only while the
  // activation row says ACTIVE with webhooks enabled. Never for BACKFILL,
  // abstains, invalid rows or resolutions. Failures never affect the decision.
  const tradeable =
    rankReady &&
    decision.activeWouldTrade === true &&
    (decision.activePrediction === 1 || decision.activePrediction === -1);

  // Send FIRST: the POST leaves before the prediction row is persisted, and the
  // database write runs concurrently with it. Nothing may sit in front of the
  // wire on the hot path.
  const sendStartedAt = Date.now();
  const sendPromise: Promise<
    { delivered: number; latencyMs: number; settle: Promise<void>; error?: string } | null
  > = webhookArmed && tradeable
    ? deliverWebhookNow(
        sb,
        "prediction.created",
        buildPriceFlowWebhookPayload({
          targetTs,
          direction: decision.activePrediction as 1 | -1,
          probabilityGreen: decision.probabilityGreen,
          confidenceRank: decision.confidenceRank,
          fitId,
          openPrice: bars.length ? bars[0].open : null,
        }),
      ).catch((e) => ({
        delivered: 0,
        latencyMs: 0,
        settle: Promise.resolve(),
        error: e instanceof Error ? e.message : String(e),
      }))
    : Promise.resolve(null);

  const writePromise = write({
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

  const [send] = await Promise.all([sendPromise, writePromise]);

  let webhookSent = false;
  let webhookLatencyMs: number | null = null;
  if (send) {
    webhookSent = send.delivered > 0;
    webhookLatencyMs = send.latencyMs;
    const sentAtMs = sendStartedAt + send.latencyMs;
    await markPFWebhook(sb, targetTs, runMode, webhookSent, {
      sentAtMs,
      latencyMs: send.latencyMs,
      offsetMs: sentAtMs - targetMs,
    });
    if (send.error) {
      await auditPF(sb, "webhook-error", { target_ts: targetTs, error: send.error }, false);
    }
    // Delivery logging and retries for failed endpoints, off the hot path.
    await send.settle.catch(() => {});
  }

  // Preflight the next rollover so the following boundary never mints on the
  // hot path. Never allowed to affect this decision.
  void pfRolloverAudit(sb, index + 1, { prepare: true })
    .then((a) => auditPF(sb, "rollover-preflight", a as unknown as Row, a.error == null))
    .catch(() => {});

  await auditPF(sb, "boundary", {
    target_ts: targetTs,
    probability: decision.probabilityGreen,
    rank: decision.confidenceRank,
    reason: decision.reason,
    fit_id: fitId,
    webhook_sent: webhookSent,
    webhook_latency_ms: webhookLatencyMs,
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
