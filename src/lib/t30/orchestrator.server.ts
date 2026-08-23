// T30 PriceFlow Balanced R1 — boundary orchestration and resolution.
//
// Fully isolated: it reads t30_samples / t30_features / t30_pf_fits and the
// confirmed OKX candle table, and writes only t30_* rows. It emits no webhook
// and never mutates a T45 (or any other model's) row, decision or statistic.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  T30_ACTIVATION_KEY,
  T30_CONFIG_HASH,
  T30_CUTOFF_OFFSET_MS,
  T30_DIAGNOSTIC_FEATURES,
  T30_EXPECTED_OBSERVATIONS,
  T30_FEATURE_ORDER,
  T30_FEATURE_ORDER_HASH,
  T30_FEATURE_SCHEMA,
  T30_IMPLEMENTATION_REVISION,
  T30_MAX_OFFSET,
  T30_MODEL_NAME,
  T30_MODEL_VARIANT,
  T30_MODEL_VERSION,
  T30_OUTCOME_SOURCE,
  T30_PACKET_REASONS,
  T30_PREDICTIONS_TABLE,
  T30_PUBLISH_DEADLINE_MS,
  T30_REASONS,
  TF_MS,
  floorTarget,
  isExactBoundary,
} from "./config";
import { buildT30Features, type T30FeatureResult } from "./features";
import { t30Decide, t30OddsUnits, t30Probability, t30Score, type T30Decision } from "./head";
import { evaluateT30Shadows } from "./shadows";
import { ensureT30Fit } from "./fitService.server";
import {
  auditT30,
  loadConfirmedCandles,
  loadT30Bars,
  loadT30PriorConfidences,
  readT30Activation,
  t30RowIndex,
  upsertT30Features,
  upsertT30Prediction,
  upsertT30Shadows,
} from "./store.server";

type Row = Record<string, unknown>;

export type T30TriggerKind = "IMMEDIATE_BOUNDARY" | "CATCHUP" | "REPLAY" | "MANUAL";

export interface T30RunResult {
  targetTs: string;
  ran: boolean;
  reason: string;
  packetReady: boolean;
  modelWouldTrade: boolean | null;
  direction: number | null;
  probabilityGreen: number | null;
  longRank: number | null;
  fastRank: number | null;
  fitId: string | null;
  latencyMs: number;
  withinDeadline: boolean;
}

/** Diagnostic + model features actually persisted on the feature row. */
function featureSubset(result: T30FeatureResult): Row {
  const out: Row = {};
  for (const k of [...T30_FEATURE_ORDER, ...T30_DIAGNOSTIC_FEATURES]) {
    const v = result.values[k];
    out[k] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  return out;
}

function packetReason(result: T30FeatureResult, barCount: number): string | null {
  if (barCount === 0) return T30_PACKET_REASONS.NO_PACKET;
  if (barCount < T30_EXPECTED_OBSERVATIONS)
    return T30_PACKET_REASONS.INSUFFICIENT_OBSERVATIONS;
  if (barCount > T30_EXPECTED_OBSERVATIONS) return T30_PACKET_REASONS.DUPLICATE_OFFSETS;
  if (!result.spotComplete) return T30_PACKET_REASONS.MISSING_OFFSETS;
  if (!result.featureComplete) return T30_PACKET_REASONS.FEATURE_INVALID;
  return null;
}

/**
 * Decide the T30 packet for `targetTs`. Idempotent: re-running the same
 * boundary recomputes and upserts the same row.
 */
export async function runT30Boundary(
  sb: SupabaseClient,
  opts: { targetTs?: string; triggerKind?: T30TriggerKind; runMode?: string } = {},
): Promise<T30RunResult> {
  const startedAt = Date.now();
  const targetMs = opts.targetTs
    ? new Date(opts.targetTs).getTime()
    : floorTarget(Date.now());
  const targetTs = new Date(targetMs).toISOString();
  const runMode = opts.runMode ?? "LIVE";
  const triggerKind = opts.triggerKind ?? "IMMEDIATE_BOUNDARY";
  const cutoffTs = new Date(targetMs + T30_CUTOFF_OFFSET_MS).toISOString();
  const deadlineTs = new Date(targetMs + T30_PUBLISH_DEADLINE_MS).toISOString();

  const fail = (reason: string, extra: Row = {}): Row => ({
    target_ts: targetTs,
    model_version: T30_MODEL_VERSION,
    run_mode: runMode,
    model_name: T30_MODEL_NAME,
    model_variant: T30_MODEL_VARIANT,
    feature_schema: T30_FEATURE_SCHEMA,
    config_hash: T30_CONFIG_HASH,
    feature_order_hash: T30_FEATURE_ORDER_HASH,
    implementation_revision: T30_IMPLEMENTATION_REVISION,
    publication_mode: "SHADOW_ONLY",
    trigger_kind: triggerKind,
    decided_at: new Date().toISOString(),
    cutoff_ts: cutoffTs,
    publish_deadline_ts: deadlineTs,
    decision_reason: reason,
    decision_valid: false,
    model_would_trade: false,
    model_direction: 0,
    outcome_source: T30_OUTCOME_SOURCE,
    ...extra,
  });

  const finish = async (row: Row, result: Partial<T30RunResult>): Promise<T30RunResult> => {
    const latency = Date.now() - startedAt;
    const withinDeadline = Date.now() - targetMs <= T30_PUBLISH_DEADLINE_MS;
    await upsertT30Prediction(sb, {
      ...row,
      decision_latency_ms: latency,
      within_publish_deadline: withinDeadline,
    });
    return {
      targetTs,
      ran: true,
      reason: String(row.decision_reason ?? ""),
      packetReady: row.packet_ready === true,
      modelWouldTrade: (row.model_would_trade as boolean | null) ?? null,
      direction: (row.model_direction as number | null) ?? null,
      probabilityGreen: (row.probability_green as number | null) ?? null,
      longRank: (row.long_rank as number | null) ?? null,
      fastRank: (row.fast_rank as number | null) ?? null,
      fitId: (row.fit_id as string | null) ?? null,
      latencyMs: latency,
      withinDeadline,
      ...result,
    };
  };

  if (!isExactBoundary(targetTs)) {
    return {
      targetTs,
      ran: false,
      reason: T30_PACKET_REASONS.TIMING_INVALID,
      packetReady: false,
      modelWouldTrade: null,
      direction: null,
      probabilityGreen: null,
      longRank: null,
      fastRank: null,
      fitId: null,
      latencyMs: Date.now() - startedAt,
      withinDeadline: false,
    };
  }

  const activation = await readT30Activation(sb);
  const inactive = String(activation.mode ?? "SHADOW_ONLY") === "DISABLED";

  // T30 owns the wire: warm the endpoint cache now so the send at decision
  // time performs zero database reads.
  const webhookArmed =
    runMode === "LIVE" &&
    String(activation.mode ?? "SHADOW_ONLY") === "ACTIVE" &&
    activation.webhooks_enabled === true;
  if (webhookArmed) void primeWebhookEndpoints(sb).catch(() => {});

  // 1. Packet + features.
  const bars = await loadT30Bars(sb, targetTs);
  const inWindow = bars.filter(
    (b) => b.offsetSeconds >= 0 && b.offsetSeconds <= T30_MAX_OFFSET,
  );
  const features = buildT30Features(inWindow);
  const pkReason = packetReason(features, inWindow.length);
  const subset = featureSubset(features);

  const rowIndex = await t30RowIndex(sb, targetTs);
  // Feature persistence runs concurrently with fit + decision + send: it is a
  // logging write and must never sit in front of the wire.
  const featureWrite = upsertT30Features(sb, {
    target_ts: targetTs,
    feature_version: T30_FEATURE_SCHEMA,
    feature_order_hash: T30_FEATURE_ORDER_HASH,
    row_index: rowIndex,
    seconds_present: features.secondsPresent,
    first_offset_s: features.values.t30_first_offset_s ?? null,
    last_offset_s: features.values.t30_last_offset_s ?? null,
    spot_complete: features.spotComplete,
    feature_complete: features.featureComplete,
    invalid_reason: features.invalidReason,
    features: subset,
    vector: features.vector,
    source: runMode === "LIVE" ? "LIVE" : "REPLAY",
  });

  if (inactive) {
    await featureWrite;
    return finish(
      fail(T30_REASONS.INACTIVE, { packet_ready: false, packet_reason: pkReason }),
      {},
    );
  }
  if (pkReason || !features.vector) {
    await featureWrite;
    return finish(
      fail(T30_REASONS.PACKET_NOT_READY, {
        packet_ready: false,
        packet_reason: pkReason ?? T30_PACKET_REASONS.FEATURE_INVALID,
        seconds_present: features.secondsPresent,
        first_offset_s: features.values.t30_first_offset_s ?? null,
        last_offset_s: features.values.t30_last_offset_s ?? null,
        spot_complete: features.spotComplete,
        feature_complete: features.featureComplete,
        features: subset,
      }),
      {},
    );
  }

  const packetCommon: Row = {
    packet_ready: true,
    packet_reason: null,
    seconds_present: features.secondsPresent,
    first_offset_s: features.values.t30_first_offset_s ?? null,
    last_offset_s: features.values.t30_last_offset_s ?? null,
    spot_complete: true,
    feature_complete: true,
    features: subset,
    spot_open: features.values.t30_spot_open ?? null,
  };

  // 2. Fit governing this row.
  const fit = await ensureT30Fit(sb, rowIndex, runMode === "LIVE" ? "LIVE" : "REPLAY");
  if (!fit || !fit.certified) {
    await featureWrite;
    return finish(
      fail(T30_REASONS.FIT_NOT_READY, {
        ...packetCommon,
        fit_id: fit?.fitId ?? null,
        fit_block_index: fit?.blockIndex ?? null,
        fit_certified: fit?.certified ?? false,
      }),
      {},
    );
  }

  // 3. Probability, dual rank, frozen decision order.
  const probability = t30Probability(fit.head, features.vector);
  const prior = await loadT30PriorConfidences(sb, targetTs, runMode);
  const decision: T30Decision = t30Decide(probability, prior);

  const row: Row = {
    ...fail(decision.reason, packetCommon),
    fit_id: fit.fitId,
    fit_block_index: fit.blockIndex,
    fit_certified: true,
    probability_green: decision.probabilityGreen,
    confidence: decision.confidence,
    base_direction: decision.baseDirection,
    long_rank: decision.longRank.rank,
    long_rank_history: decision.longRank.historyCount,
    fast_rank: decision.fastRank.rank,
    fast_rank_history: decision.fastRank.historyCount,
    gate_long_ready: decision.gateLongReady,
    gate_fast_ready: decision.gateFastReady,
    gate_long_passed: decision.gateLongPassed,
    gate_fast_passed: decision.gateFastPassed,
    model_direction: decision.modelDirection,
    model_would_trade: decision.modelWouldTrade,
    decision_valid: decision.decisionValid,
    decision_reason: decision.reason,
  };

  // 4. Outbound webhook — fires BEFORE any remaining database write so the POST
  // leaves the moment the decision exists. LIVE tradeable decisions only;
  // failures never affect the decision or the persisted row.
  const tradeable =
    decision.decisionValid &&
    decision.modelWouldTrade === true &&
    (decision.modelDirection === 1 || decision.modelDirection === -1);

  const sendPromise: Promise<{ delivered: number; latencyMs: number } | null> =
    webhookArmed && tradeable
      ? deliverWebhookNow(
          sb,
          "prediction.created",
          buildT30WebhookPayload({
            targetTs,
            direction: decision.modelDirection as 1 | -1,
            probabilityGreen: decision.probabilityGreen,
            longRank: decision.longRank.rank,
            fastRank: decision.fastRank.rank,
            fitId: fit.fitId,
            openPrice: (features.values.t30_spot_open as number | undefined) ?? null,
          }),
        ).catch(() => ({ delivered: 0, latencyMs: 0 }))
      : Promise.resolve(null);

  const finishPromise = finish(row, {});
  const [send, finished] = await Promise.all([sendPromise, finishPromise, featureWrite]);
  if (send) {
    await auditT30(
      sb,
      "webhook",
      { targetTs, delivered: send.delivered, latency_ms: send.latencyMs },
      send.delivered > 0,
    ).catch(() => {});
  }

  // 5. Reporting-only shadows — cannot influence anything above.
  try {
    await upsertT30Shadows(
      sb,
      evaluateT30Shadows(decision, features.values).map((s) => ({
        target_ts: targetTs,
        policy: s.policy,
        run_mode: runMode,
        would_trade: s.wouldTrade,
        direction: s.direction,
        reason: s.reason,
      })),
    );
  } catch (e) {
    await auditT30(sb, "shadow-error", { targetTs, error: String(e) }, false);
  }

  return finished;
}

/**
 * Resolve decided T30 rows against confirmed OKX candles.
 * ABSTAIN is a first-class outcome and is never collapsed into PUSH.
 */
export async function resolveT30(
  sb: SupabaseClient,
  opts: { limit?: number; runMode?: string } = {},
): Promise<{ examined: number; resolved: number }> {
  const runMode = opts.runMode ?? "LIVE";
  const limit = opts.limit ?? 200;
  const cutoff = new Date(floorTarget(Date.now()) - TF_MS).toISOString();

  const { data, error } = await sb
    .from(T30_PREDICTIONS_TABLE)
    .select("target_ts, model_would_trade, model_direction, decimal_odds")
    .eq("model_version", T30_MODEL_VERSION)
    .eq("run_mode", runMode)
    .is("resolved_at", null)
    .lte("target_ts", cutoff)
    .order("target_ts", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`t30_resolve_scan:${error.message}`);
  const rows = (data ?? []) as Row[];
  if (!rows.length) return { examined: 0, resolved: 0 };

  const candles = await loadConfirmedCandles(
    sb,
    String(rows[0].target_ts),
    String(rows[rows.length - 1].target_ts),
  );

  let resolved = 0;
  for (const r of rows) {
    const ts = new Date(String(r.target_ts)).toISOString();
    const candle = candles.get(ts);
    if (!candle) continue;
    const actual = candle.close > candle.open ? 1 : candle.close < candle.open ? -1 : 0;
    const wouldTrade = (r.model_would_trade as boolean | null) ?? false;
    const dir = (r.model_direction as number | null) ?? 0;
    const { result, score } = t30Score(
      wouldTrade,
      (dir === 1 || dir === -1 ? dir : 0) as 1 | -1 | 0,
      actual,
    );
    const odds = r.decimal_odds == null ? null : Number(r.decimal_odds);

    await sb
      .from(T30_PREDICTIONS_TABLE)
      .update({
        actual_open: candle.open,
        actual_high: candle.high,
        actual_low: candle.low,
        actual_close: candle.close,
        actual_direction: actual,
        outcome_source: T30_OUTCOME_SOURCE,
        result,
        score,
        odds_units: t30OddsUnits(result, odds),
        resolved_at: new Date().toISOString(),
      } as never)
      .eq("target_ts", ts)
      .eq("model_version", T30_MODEL_VERSION)
      .eq("run_mode", runMode);

    // Label the feature row so future fits can train on it.
    await sb
      .from("t30_features")
      .update({
        label: actual,
        label_source: T30_OUTCOME_SOURCE,
        actual_open: candle.open,
        actual_close: candle.close,
      } as never)
      .eq("target_ts", ts)
      .eq("feature_version", T30_FEATURE_SCHEMA);

    // Reporting-only shadow scoring.
    const { data: shadows } = await sb
      .from("t30_pf_policy_shadows")
      .select("policy, would_trade, direction")
      .eq("target_ts", ts)
      .eq("run_mode", runMode)
      .is("resolved_at", null);
    for (const s of (shadows ?? []) as Row[]) {
      const sd = Number(s.direction);
      const sc = t30Score(
        s.would_trade === true,
        (sd === 1 || sd === -1 ? sd : 0) as 1 | -1 | 0,
        actual,
      );
      await sb
        .from("t30_pf_policy_shadows")
        .update({
          result: sc.result,
          score: sc.score,
          actual_direction: actual,
          resolved_at: new Date().toISOString(),
        } as never)
        .eq("target_ts", ts)
        .eq("policy", String(s.policy))
        .eq("run_mode", runMode);
    }

    resolved++;
  }

  return { examined: rows.length, resolved };
}

export { T30_ACTIVATION_KEY };
