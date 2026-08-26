// T10 Bridge R1 — boundary decision orchestrator (server only).
//
// One idempotent row per 15-minute target. The frozen first-match decision
// order is enforced here; the policy decision is always recorded even when
// activation keeps the model in shadow, so a shadow row still shows exactly
// what T10 would have published.
//
// T10 never touches T30/T45 state and every failure path is contained.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  T10_BRIDGE_VARIANT,
  T10_BRIDGE_VERSION,
  T10_CONFIG_HASH,
  T10_FEATURE_ORDER_HASH,
  T10_FEATURE_SCHEMA,
  T10_IMPLEMENTATION_REVISION,
  T10_OUTCOME_SOURCE,
  T10_PACKET_REASONS,
  T10_REASONS,
  TF_MS,
  boiseDate,
  t10SourceIndex,
  utcDate,
} from "./config";
import { buildT10PacketFeatures, t10PacketDiagnostics, type T10FeatureMap } from "./features";
import {
  fitT10Head,
  t10BlockStart,
  t10Decide,
  t10FitCertified,
  t10Probability,
  t10RankChecksum,
  t10Score,
  t10Vector,
  type T10Head,
} from "./head";
import { loadT10PriorCandles } from "./marketData.server";
import { validateT10Packet } from "./packet";
import {
  insertT10Fit,
  loadConfirmedCandles,
  loadT10Bars,
  loadT10PriorProbabilities,
  loadT10TrainingRows,
  readT10Activation,
  readT10Fit,
  resolveT10Row,
  upsertT10Prediction,
} from "./store.server";
import { buildT10Technicals } from "./technicals";
import { buildT10WebhookPayload, t10IdempotencyKey, t10WebhookEligible } from "./webhook.server";
import { deliverWebhookNow, primeWebhookEndpoints } from "@/lib/webhooks.server";


type Row = Record<string, unknown>;

export type T10RunMode = "LIVE" | "BACKFILL" | "CATCHUP";
export type T10TriggerKind = "IMMEDIATE_BOUNDARY" | "WATCHDOG" | "REPLAY";

export interface T10BoundaryResult {
  targetTs: string;
  runMode: T10RunMode;
  packetComplete: boolean;
  packetFailureReason: string | null;
  baseDirection: string | null;
  policyWouldTrade: boolean;
  policyDecisionReason: string;
  finalPrediction: string | null;
  webhookEligible: boolean;
  correctnessProbability: number | null;
  longRank: number | null;
  fastRank: number | null;
  fitId: string | null;
  fitCertified: boolean;
  decisionOffsetMs: number;
}

export function t10FitId(blockStart: number): string {
  return `${T10_BRIDGE_VERSION}:b${blockStart}`;
}

function headFromRow(row: Row): T10Head {
  return {
    scaler: { center: row.center as number[], scale: row.scale as number[] },
    coefficients: row.coefficients as number[],
    intercept: Number(row.intercept),
    trainingRowCount: Number(row.training_row_count),
    trainingStartTs: String(row.training_start_ts ?? ""),
    trainingEndTs: String(row.training_end_ts ?? ""),
    trainingStartIndex: Number(row.training_start_index),
    trainingEndIndex: Number(row.training_end_index),
    trainingFingerprint: String(row.window_fingerprint ?? ""),
    blockIndex: Number(row.block_index),
    blockStartIndex: Number(row.block_start_index),
    converged: row.converged === true,
    iterations: Number(row.iterations ?? 0),
    gradientNorm: Number(row.gradient_norm ?? NaN),
  };
}

/** Load the certified block head, minting and persisting it once per block. */
export async function ensureT10Fit(
  sb: SupabaseClient,
  sourceIndex: number,
): Promise<{ fitId: string | null; head: T10Head | null; certified: boolean }> {
  const blockStart = t10BlockStart(sourceIndex);
  if (blockStart == null) return { fitId: null, head: null, certified: false };
  const fitId = t10FitId(blockStart);

  const existing = await readT10Fit(sb, fitId);
  if (existing) {
    const head = headFromRow(existing);
    return { fitId, head, certified: existing.certified === true && t10FitCertified(head) };
  }

  const history = await loadT10TrainingRows(sb, blockStart);
  const head = fitT10Head(blockStart, history);
  if (!head) return { fitId, head: null, certified: false };
  const certified = t10FitCertified(head);

  await insertT10Fit(sb, {
    fit_id: fitId,
    model_version: T10_BRIDGE_VERSION,
    model_variant: T10_BRIDGE_VARIANT,
    config_hash: T10_CONFIG_HASH,
    feature_order_hash: T10_FEATURE_ORDER_HASH,
    fit_source: "walk-forward",
    block_index: head.blockIndex,
    block_start_index: head.blockStartIndex,
    training_row_count: head.trainingRowCount,
    training_start_index: head.trainingStartIndex,
    training_end_index: head.trainingEndIndex,
    training_start_ts: head.trainingStartTs,
    training_end_ts: head.trainingEndTs,
    window_fingerprint: head.trainingFingerprint,
    center: head.scaler.center,
    scale: head.scaler.scale,
    coefficients: head.coefficients,
    intercept: head.intercept,
    converged: head.converged,
    iterations: head.iterations,
    gradient_norm: head.gradientNorm,
    artifact_hash: head.trainingFingerprint,
    certified,
  });

  return { fitId, head, certified };
}

export interface T10BoundaryOptions {
  runMode?: T10RunMode;
  trigger?: T10TriggerKind;
  /** Preloaded packet (replay); otherwise bars are read from storage. */
  bars?: Parameters<typeof validateT10Packet>[1];
}

/** Run the frozen T10 decision for one target and persist exactly one row. */
export async function runT10Boundary(
  sb: SupabaseClient,
  targetTs: string,
  options: T10BoundaryOptions = {},
): Promise<T10BoundaryResult> {
  const runMode: T10RunMode = options.runMode ?? "LIVE";
  const trigger: T10TriggerKind = options.trigger ?? "IMMEDIATE_BOUNDARY";
  const startedMs = Date.now();
  const targetMs = new Date(targetTs).getTime();
  const sourceIndex = t10SourceIndex(targetTs);

  const activation = await readT10Activation(sb);
  const activationMode = String(activation.mode ?? "SHADOW_ONLY");
  const activationBoundaryTs = activation.activation_boundary_ts
    ? new Date(String(activation.activation_boundary_ts)).toISOString()
    : null;
  if (runMode === "LIVE" && activationMode === "ACTIVE" && activation.webhooks_enabled === true) {
    void primeWebhookEndpoints(sb).catch(() => {});
  }



  const base: Row = {
    target_ts: targetTs,
    model_version: T10_BRIDGE_VERSION,
    model_variant: T10_BRIDGE_VARIANT,
    feature_schema: T10_FEATURE_SCHEMA,
    config_hash: T10_CONFIG_HASH,
    feature_order_hash: T10_FEATURE_ORDER_HASH,
    implementation_revision: T10_IMPLEMENTATION_REVISION,
    run_mode: runMode,
    trigger_kind: trigger,
    source_index: sourceIndex,
    utc_date: utcDate(targetTs),
    boise_date: boiseDate(targetTs),
    activation_mode: activationMode,
    activation_boundary_ts: activationBoundaryTs,
    outcome_source: T10_OUTCOME_SOURCE,
    decision_at: new Date().toISOString(),
    decision_offset_ms: Date.now() - targetMs,
    webhook_eligible: false,
  };

  const finish = async (row: Row, result: Partial<T10BoundaryResult>): Promise<T10BoundaryResult> => {
    await upsertT10Prediction(sb, { ...base, ...row });
    return {
      targetTs,
      runMode,
      packetComplete: false,
      packetFailureReason: null,
      baseDirection: null,
      policyWouldTrade: false,
      policyDecisionReason: String(row.policy_decision_reason ?? ""),
      finalPrediction: null,
      webhookEligible: false,
      correctnessProbability: null,
      longRank: null,
      fastRank: null,
      fitId: null,
      fitCertified: false,
      decisionOffsetMs: Date.now() - targetMs,
      ...result,
    };
  };

  // 1. Packet must be exactly offsets 0..9.
  const bars = options.bars ?? (await loadT10Bars(sb, targetTs));
  const packet = validateT10Packet(targetTs, bars);
  if (!packet.complete) {
    return finish(
      {
        packet_count: packet.count,
        packet_first_offset: packet.firstOffset,
        packet_last_offset: packet.lastOffset,
        packet_complete: false,
        packet_failure_reason: packet.reason ?? T10_PACKET_REASONS.NO_PACKET,
        policy_decision_reason: T10_REASONS.PACKET_NOT_READY,
      },
      { packetFailureReason: packet.reason, policyDecisionReason: T10_REASONS.PACKET_NOT_READY },
    );
  }

  const packetRow: Row = {
    packet_count: packet.count,
    packet_first_offset: packet.firstOffset,
    packet_last_offset: packet.lastOffset,
    packet_complete: true,
    packet_failure_reason: null,
  };

  const packetFeatures = buildT10PacketFeatures(packet.bars);
  const baseDirection =
    packetFeatures.direction === 1 ? "GREEN" : packetFeatures.direction === -1 ? "RED" : null;
  const directionRow: Row = {
    ...packetRow,
    base_direction: baseDirection,
    ret10_bps: packetFeatures.ret10Bps,
    packet_features: {
      ...packetFeatures.values,
      ...t10PacketDiagnostics(packet.bars),
    } as T10FeatureMap,
  };

  // 2. Prior Spot/Futures technical inputs.
  const market = await loadT10PriorCandles(targetTs, 64, sb);
  const technicals = buildT10Technicals(
    targetTs,
    packetFeatures.direction,
    market.spot,
    market.fut,
  );
  if (!technicals.ready) {
    return finish(
      {
        ...directionRow,
        prior_technicals_ready: false,
        prior_technicals_reason: market.error ?? technicals.reason,
        policy_decision_reason: T10_REASONS.PRIOR_TECHNICALS_NOT_READY,
      },
      {
        packetComplete: true,
        baseDirection,
        policyDecisionReason: T10_REASONS.PRIOR_TECHNICALS_NOT_READY,
      },
    );
  }

  // 3. Feature vector.
  const values: T10FeatureMap = { ...packetFeatures.values, ...technicals.values };
  const vector = packetFeatures.valid ? t10Vector(values) : null;
  const featureRow: Row = {
    ...directionRow,
    prior_technicals_ready: true,
    technical_features: technicals.values,
    feature_vector: vector,
    feature_vector_hash: T10_FEATURE_ORDER_HASH,
    features_valid: vector != null,
  };
  if (!vector) {
    return finish(
      { ...featureRow, policy_decision_reason: T10_REASONS.FEATURES_INVALID },
      {
        packetComplete: true,
        baseDirection,
        policyDecisionReason: T10_REASONS.FEATURES_INVALID,
      },
    );
  }

  // 4. Certified fit.
  const { fitId, head, certified } = await ensureT10Fit(sb, sourceIndex);
  const fitRow: Row = {
    ...featureRow,
    fit_id: fitId,
    fit_block_start_index: t10BlockStart(sourceIndex),
    fit_certified: certified,
    fit_source: "walk-forward",
  };
  if (!head || !certified) {
    return finish(
      { ...fitRow, policy_decision_reason: T10_REASONS.FIT_NOT_CERTIFIED },
      {
        packetComplete: true,
        baseDirection,
        fitId,
        policyDecisionReason: T10_REASONS.FIT_NOT_CERTIFIED,
      },
    );
  }

  // 5..9. Probability, strict past-only ranks and the frozen gates.
  const probability = t10Probability(head, vector);
  const prior = await loadT10PriorProbabilities(sb, targetTs);
  const decision = t10Decide(probability, packetFeatures.direction, prior);

  const activationReached =
    activationMode === "ACTIVE" &&
    activationBoundaryTs != null &&
    targetMs >= new Date(activationBoundaryTs).getTime();

  const finalPrediction =
    decision.policyWouldTrade && activationReached
      ? decision.policyDirection === 1
        ? "GREEN"
        : "RED"
      : null;

  const eligible = t10WebhookEligible({
    runMode,
    activationMode,
    webhooksEnabled: activation.webhooks_enabled === true,
    activationBoundaryTs,
    targetTs,
    modelVersion: T10_BRIDGE_VERSION,
    configHash: T10_CONFIG_HASH,
    expectedConfigHash: T10_CONFIG_HASH,
    packetComplete: true,
    fitCertified: certified,
    rankCertified: decision.rankCertified,
    policyWouldTrade: decision.policyWouldTrade,
    alreadyClaimed: false,
  });

  const decisionReason =
    decision.policyWouldTrade && !activationReached
      ? T10_REASONS.ACTIVATION_NOT_REACHED
      : decision.reason;

  const row: Row = {
    ...fitRow,
    correctness_probability: probability,
    long_rank: decision.longRank.rank,
    fast_rank: decision.fastRank.rank,
    long_rank_count: decision.longRank.historyCount,
    fast_rank_count: decision.fastRank.historyCount,
    long_window_start_ts: decision.longRank.windowStartTs,
    long_window_end_ts: decision.longRank.windowEndTs,
    fast_window_start_ts: decision.fastRank.windowStartTs,
    fast_window_end_ts: decision.fastRank.windowEndTs,
    rank_state_checksum: t10RankChecksum(prior),
    rank_certified: decision.rankCertified,
    policy_would_trade: decision.policyWouldTrade,
    policy_direction:
      decision.policyDirection === 1 ? "GREEN" : decision.policyDirection === -1 ? "RED" : null,
    policy_decision_reason: decisionReason,
    final_prediction: finalPrediction,
    webhook_eligible: eligible,
    decision_offset_ms: Date.now() - targetMs,
  };

  // Outbound webhook fires BEFORE persistence so the POST is never delayed by
  // a database round-trip. Only eligible LIVE tradeable rows ever get here.
  let delivery: Awaited<ReturnType<typeof deliverWebhookNow>> | null = null;
  if (eligible) {
    try {
      delivery = await deliverWebhookNow(
        sb,
        "prediction.created",
        buildT10WebhookPayload({
          targetTs,
          direction: decision.policyDirection === 1 ? 1 : -1,
          correctnessProbability: probability,
          longRank: decision.longRank.rank,
          fastRank: decision.fastRank.rank,
          fitId,
          openPrice: packet.bars[0]?.open ?? null,
        }),
      );
    } catch {
      delivery = null;
    }
    row.webhook_idempotency_key = t10IdempotencyKey(`${T10_BRIDGE_VERSION}:${targetTs}`);
    row.webhook_claimed_at = new Date().toISOString();
    row.webhook_sent = (delivery?.delivered ?? 0) > 0;
    row.webhook_sent_at = delivery?.sentAt ?? null;
    row.webhook_latency_ms = delivery?.latencyMs ?? null;
    row.webhook_offset_ms = delivery?.sentAt
      ? new Date(delivery.sentAt).getTime() - targetMs
      : null;
    row.webhook_status = delivery ? ((delivery.delivered ?? 0) > 0 ? "SENT" : "FAILED") : "ERROR";
  }

  await upsertT10Prediction(sb, { ...base, ...row });
  if (delivery) await delivery.settle.catch(() => {});


  return {
    targetTs,
    runMode,
    packetComplete: true,
    packetFailureReason: null,
    baseDirection,
    policyWouldTrade: decision.policyWouldTrade,
    policyDecisionReason: decisionReason,
    finalPrediction,
    webhookEligible: eligible,
    correctnessProbability: probability,
    longRank: decision.longRank.rank,
    fastRank: decision.fastRank.rank,
    fitId,
    fitCertified: certified,
    decisionOffsetMs: Date.now() - targetMs,
  };
}

/** Idempotent resolution of matured T10 rows against confirmed OKX candles. */
export async function resolveT10(sb: SupabaseClient, lookbackMs = 6 * 60 * 60 * 1000): Promise<number> {
  const now = Date.now();
  const fromTs = new Date(now - lookbackMs).toISOString();
  const toTs = new Date(now).toISOString();

  const { data } = await sb
    .from("t10_bridge_predictions")
    .select("target_ts, policy_would_trade, policy_direction, final_prediction")
    .eq("model_version", T10_BRIDGE_VERSION)
    .is("resolved_at", null)
    .gte("target_ts", fromTs)
    .lte("target_ts", new Date(now - TF_MS).toISOString())
    .order("target_ts", { ascending: true });

  const pending = (data ?? []) as Row[];
  if (!pending.length) return 0;
  const candles = await loadConfirmedCandles(sb, fromTs, toTs);

  let resolved = 0;
  for (const p of pending) {
    const ts = new Date(String(p.target_ts)).toISOString();
    const candle = candles.get(ts);
    if (!candle) continue;
    const actual =
      candle.close > candle.open ? "GREEN" : candle.close < candle.open ? "RED" : "PUSH";
    const dir =
      p.policy_direction === "GREEN" ? 1 : p.policy_direction === "RED" ? -1 : 0;
    const { result, raw } = t10Score(p.policy_would_trade === true, dir as 1 | -1 | 0, actual);
    await resolveT10Row(sb, ts, {
      actual_open: candle.open,
      actual_high: candle.high,
      actual_low: candle.low,
      actual_close: candle.close,
      actual_direction: actual,
      result,
      raw_score: raw,
      resolved_at: new Date().toISOString(),
      resolution_attempt_count: 1,
      last_resolution_error: null,
    });
    resolved += 1;
  }
  return resolved;
}
