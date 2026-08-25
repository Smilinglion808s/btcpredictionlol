// Cross89 — live boundary orchestrator (server-only).
//
// Runs at T+30s: reads the finalized 0..29 packet, rebuilds the 89-feature
// vector from strictly past-only inputs, scores it with the certified block
// fit, applies the frozen dual-rank gate and persists the decision.
// Deployed SHADOW_ONLY: no webhook can leave this path until the persisted
// activation row says otherwise.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  T30X_CONFIG_HASH,
  T30X_DIAGNOSTIC_FEATURES,
  T30X_FAST_RANK_MIN,
  T30X_FAST_RANK_WINDOW,
  T30X_FEATURES_TABLE,
  T30X_FEATURE_ORDER,
  T30X_FEATURE_ORDER_HASH,
  T30X_FEATURE_SCHEMA,
  T30X_IMPLEMENTATION_REVISION,
  T30X_LONG_RANK_MIN,
  T30X_LONG_RANK_WINDOW,
  T30X_MODEL_NAME,
  T30X_MODEL_VARIANT,
  T30X_MODEL_VERSION,
  T30X_PREDICTIONS_TABLE,
  T30X_REASONS,
  T30X_SHADOW_POLICIES,
  TF_MS,
} from "./config";
import {
  baseDirectionOf,
  buildCross89Features,
  buildPacketStats,
  type X89SecondBar,
} from "./features";
import { blockStartFor, decideX89, probabilityCorrect, type X89Head } from "./head";
import { ensureX89Fit, preflightX89Fit } from "./fitService.server";
import { loadPriorSeries } from "./marketData.server";
import { techAt } from "./technicals";
import {
  loadX89Activation,
  loadX89Packet,
  upsertX89Features,
  upsertX89Prediction,
  upsertX89Shadows,
} from "./store.server";

type SB = SupabaseClient<never, never, never>;

export type X89TriggerKind = "IMMEDIATE_BOUNDARY" | "CATCHUP" | "MANUAL" | "WATCHDOG";

export interface X89BoundaryResult {
  targetTs: string;
  sourceIndex: number;
  decisionReason: string;
  baseDirection: number;
  modelWouldTrade: boolean;
  probabilityCorrect: number | null;
  longRank: number | null;
  fastRank: number | null;
  fitId: string | null;
  decisionOffsetMs: number;
  activationMode: string;
  webhookEligible: boolean;
}

async function nextSourceIndex(sb: SB, targetTs: string): Promise<number> {
  const { count, error } = await sb
    .from(T30X_FEATURES_TABLE)
    .select("*", { count: "exact", head: true })
    .lt("target_ts", targetTs);
  if (error) throw new Error(`${T30X_FEATURES_TABLE}:${error.message}`);
  return count ?? 0;
}

/** Strictly past-only contiguous probability history for the rank windows. */
async function loadRankHistories(
  sb: SB,
  sourceIndex: number,
): Promise<{ long: number[]; fast: number[] }> {
  const from = sourceIndex - T30X_LONG_RANK_WINDOW;
  if (from < 0) return { long: [], fast: [] };
  const { data, error } = await sb
    .from(T30X_PREDICTIONS_TABLE)
    .select("source_index, probability_correct")
    .gte("source_index", from)
    .lt("source_index", sourceIndex)
    .order("source_index", { ascending: true });
  if (error) throw new Error(`${T30X_PREDICTIONS_TABLE}:${error.message}`);
  const byIndex = new Map<number, number | null>();
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    byIndex.set(Number(r['source_index']), r['probability_correct'] as number | null);
  }
  const collect = (window: number): number[] => {
    const out: number[] = [];
    for (let k = sourceIndex - window; k < sourceIndex; k++) {
      const p = byIndex.get(k);
      if (p == null || !Number.isFinite(p)) return [];
      out.push(p);
    }
    return out;
  };
  return { long: collect(T30X_LONG_RANK_WINDOW), fast: collect(T30X_FAST_RANK_WINDOW) };
}

function shadowRows(
  targetTs: string,
  direction: number,
  p: number | null,
  longRank: number | null,
  fastRank: number | null,
): Record<string, unknown>[] {
  const passes = (policy: string): boolean => {
    if (direction === 0) return false;
    switch (policy) {
      case "LONG_ONLY_625":
        return longRank != null && longRank >= 0.625;
      case "LONG625_FAST550":
        return longRank != null && fastRank != null && longRank >= 0.625 && fastRank >= 0.55;
      case "LONG625_FAST600":
        return longRank != null && fastRank != null && longRank >= 0.625 && fastRank >= 0.6;
      case "PROBABILITY_0550":
        return p != null && p >= 0.55;
      case "PRECISION_LONG750_FAST625":
        return longRank != null && fastRank != null && longRank >= 0.75 && fastRank >= 0.625;
      default:
        return false;
    }
  };
  return T30X_SHADOW_POLICIES.map((policy) => ({
    target_ts: targetTs,
    policy,
    would_trade: passes(policy),
    direction: passes(policy) ? direction : null,
    probability_correct: p,
    long_rank: longRank,
    fast_rank: fastRank,
  }));
}

export async function runX89Boundary(
  sb: SB,
  opts: { targetTs: string; triggerKind: X89TriggerKind },
): Promise<X89BoundaryResult> {
  const targetTs = new Date(opts.targetTs).toISOString();
  const targetMs = new Date(targetTs).getTime();
  const activation = await loadX89Activation(sb);

  const packetRows = await loadX89Packet(sb, targetTs);
  const bars: X89SecondBar[] = packetRows
    .filter((r) => r['is_final'] !== false)
    .map((r) => ({
      offsetSeconds: Number(r['offset_seconds']),
      open: Number(r['open']),
      high: Number(r['high']),
      low: Number(r['low']),
      close: Number(r['close']),
      volume: Number(r['volume']),
      quoteVolume: Number(r['quote_volume']),
      tradeCount: Number(r['trade_count']),
      takerBuyQuoteVolume: Number(r['taker_buy_quote_volume']),
    }))
    .filter((b) => b.offsetSeconds >= 0 && b.offsetSeconds <= 29);

  const packet = buildPacketStats(bars);
  const direction = packet.complete ? baseDirectionOf(packet) : 0;
  const sourceIndex = await nextSourceIndex(sb, targetTs);

  let spotTech = null;
  let futTech = null;
  let prevBasis = NaN;
  if (packet.complete && direction !== 0) {
    try {
      const series = await loadPriorSeries(targetMs);
      spotTech = series.spotIndex >= 0 ? techAt(series.spot, series.spotIndex) : null;
      futTech = series.futIndex >= 0 ? techAt(series.fut, series.futIndex) : null;
      const ps = series.spot[series.spotIndex - 1];
      const pf = series.fut[series.futIndex - 1];
      prevBasis = ps && pf ? Math.log(pf.close / ps.close) * 10_000 : NaN;
    } catch {
      spotTech = null;
      futTech = null;
    }
  }

  let features: Record<string, number | null> = {};
  let vector: number[] | null = null;
  if (packet.complete && direction !== 0 && spotTech && futTech && Number.isFinite(prevBasis)) {
    const built = buildCross89Features({
      targetTs,
      packet,
      direction,
      spot: spotTech,
      fut: futTech,
      prevBasisBps: prevBasis,
    });
    features = built.values;
    vector = built.vector;
  }

  const blockStart = blockStartFor(sourceIndex);
  let head: X89Head | null = null;
  let fitId: string | null = null;
  let fitCertified = false;
  let fitArtifactHash: string | null = null;
  if (blockStart != null && vector) {
    try {
      const fit = await ensureX89Fit(sb, blockStart);
      if (fit) {
        head = fit.head;
        fitId = fit.fitId;
        fitCertified = fit.certified;
        fitArtifactHash = fit.artifactHash;
      }
    } catch {
      head = null;
    }
  }

  const probability = head && vector ? probabilityCorrect(head, vector) : null;
  const { long, fast } = await loadRankHistories(sb, sourceIndex);

  const decision = decideX89({
    packetReady: packet.complete,
    baseDirection: direction,
    spotTechReady: !!spotTech,
    futTechReady: !!futTech,
    vector,
    head,
    probability,
    longHistory: long,
    fastHistory: fast,
  });

  const decidedAt = new Date();
  const decisionOffsetMs = decidedAt.getTime() - targetMs;

  // Persist the frozen feature row first so ranks and fits stay reproducible.
  const subset: Record<string, unknown> = {};
  for (const k of [...T30X_FEATURE_ORDER, ...T30X_DIAGNOSTIC_FEATURES]) {
    const v = features[k];
    subset[k] = typeof v === "number" && Number.isFinite(v) ? v : null;
  }
  await upsertX89Features(sb, [
    {
      target_ts: targetTs,
      source_index: sourceIndex,
      feature_version: T30X_FEATURE_SCHEMA,
      feature_order_hash: T30X_FEATURE_ORDER_HASH,
      seconds_present: bars.length,
      first_offset_s: bars.length ? Math.min(...bars.map((b) => b.offsetSeconds)) : null,
      last_offset_s: bars.length ? Math.max(...bars.map((b) => b.offsetSeconds)) : null,
      packet_ready: packet.complete,
      packet_reason: packet.complete ? null : (packet.invalidReason ?? "PACKET_INCOMPLETE"),
      base_direction: direction,
      spot_tech_ready: !!spotTech,
      fut_tech_ready: !!futTech,
      feature_complete: vector != null,
      invalid_reason: vector ? null : decision.reason,
      features: subset,
      vector,
      source: opts.triggerKind === "MANUAL" ? "MANUAL" : "LIVE",
    },
  ]);

  const isLive = opts.triggerKind === "IMMEDIATE_BOUNDARY" || opts.triggerKind === "WATCHDOG";
  const activationTs = activation.activation_target_ts
    ? new Date(activation.activation_target_ts).getTime()
    : null;
  const webhookEligible =
    activation.mode === "ACTIVE" &&
    activation.webhooks_enabled &&
    isLive &&
    decision.modelWouldTrade &&
    activationTs != null &&
    targetMs >= activationTs &&
    targetMs % TF_MS === 0;

  await upsertX89Prediction(sb, {
    target_ts: targetTs,
    source_index: sourceIndex,
    model_name: T30X_MODEL_NAME,
    model_version: T30X_MODEL_VERSION,
    model_variant: T30X_MODEL_VARIANT,
    feature_schema: T30X_FEATURE_SCHEMA,
    config_hash: T30X_CONFIG_HASH,
    feature_order_hash: T30X_FEATURE_ORDER_HASH,
    impl_revision: T30X_IMPLEMENTATION_REVISION,
    run_mode: isLive ? "LIVE" : "CATCHUP",
    execution_path: opts.triggerKind,
    trigger_kind: opts.triggerKind,
    seconds_present: bars.length,
    first_offset_s: bars.length ? Math.min(...bars.map((b) => b.offsetSeconds)) : null,
    last_offset_s: bars.length ? Math.max(...bars.map((b) => b.offsetSeconds)) : null,
    packet_ready: packet.complete,
    packet_reason: packet.complete ? null : (packet.invalidReason ?? "PACKET_INCOMPLETE"),
    packet_finalized_at: new Date(targetMs + 30_000).toISOString(),
    features: subset,
    vector,
    base_direction: direction,
    spot_tech_ready: !!spotTech,
    fut_tech_ready: !!futTech,
    feature_complete: vector != null,
    probability_correct: decision.probabilityCorrect,
    long_rank: decision.longRank,
    fast_rank: decision.fastRank,
    long_rank_window: T30X_LONG_RANK_WINDOW,
    fast_rank_window: T30X_FAST_RANK_WINDOW,
    long_rank_count: long.length,
    fast_rank_count: fast.length,
    gate_long_pass: decision.longRank == null ? null : decision.longRank >= T30X_LONG_RANK_MIN,
    gate_fast_pass: decision.fastRank == null ? null : decision.fastRank >= T30X_FAST_RANK_MIN,
    model_would_trade: decision.modelWouldTrade,
    model_direction: decision.modelDirection,
    decision_reason: decision.reason,
    decision_valid: decision.decisionValid,
    fit_id: fitId,
    fit_block_index: blockStart,
    fit_block_start_index: blockStart,
    fit_certified: fitCertified,
    fit_artifact_hash: fitArtifactHash,
    fit_training_row_count: head?.trainingRowCount ?? null,
    activation_mode: activation.mode,
    activation_target_ts: activation.activation_target_ts,
    webhook_eligible: webhookEligible,
    webhook_idempotency_key: `${targetTs}:${T30X_MODEL_VERSION}`,
    decided_at: decidedAt.toISOString(),
    decision_offset_ms: decisionOffsetMs,
  });

  await upsertX89Shadows(
    sb,
    shadowRows(targetTs, direction, decision.probabilityCorrect, decision.longRank, decision.fastRank),
  );

  // One-boundary-ahead rollover audit; never blocks the decision.
  try {
    await preflightX89Fit(sb, sourceIndex + 1);
  } catch {
    /* preflight is advisory only */
  }

  return {
    targetTs,
    sourceIndex,
    decisionReason: decision.reason || T30X_REASONS.PACKET_NOT_READY,
    baseDirection: direction,
    modelWouldTrade: decision.modelWouldTrade,
    probabilityCorrect: decision.probabilityCorrect,
    longRank: decision.longRank,
    fastRank: decision.fastRank,
    fitId,
    decisionOffsetMs,
    activationMode: activation.mode,
    webhookEligible,
  };
}

/** Idempotent resolution of matured rows against confirmed OKX candles. */
export async function resolveX89(sb: SB, opts: { limit?: number } = {}) {
  const limit = opts.limit ?? 100;
  const cutoff = new Date(Date.now() - TF_MS).toISOString();
  const { data, error } = await sb
    .from(T30X_PREDICTIONS_TABLE)
    .select("id, target_ts, base_direction, model_would_trade, selected_decimal_odds")
    .is("resolved_at", null)
    .lte("target_ts", cutoff)
    .order("target_ts", { ascending: true })
    .limit(limit);
  if (error) throw new Error(`${T30X_PREDICTIONS_TABLE}:${error.message}`);
  const rows = (data ?? []) as Record<string, unknown>[];
  let resolved = 0;

  for (const row of rows) {
    const targetTs = new Date(String(row['target_ts'])).toISOString();
    const { data: candle } = await sb
      .from("candles")
      .select("open, high, low, close")
      .eq("symbol", "BTC-USDT")
      .eq("timeframe", "15m")
      .eq("confirm", true)
      .eq("candle_ts", targetTs)
      .maybeSingle();
    if (!candle) continue;
    const o = Number((candle as Record<string, unknown>)['open']);
    const c = Number((candle as Record<string, unknown>)['close']);
    const dir = c > o ? 1 : c < o ? -1 : 0;
    const base = Number(row['base_direction'] ?? 0);
    const label = base === 0 || dir === 0 ? null : base === dir ? 1 : 0;
    const traded = Boolean(row['model_would_trade']);
    const outcome = !traded ? "ABSTAIN" : dir === 0 ? "PUSH" : label === 1 ? "WIN" : "LOSS";
    const raw = outcome === "WIN" ? 1 : outcome === "LOSS" ? -1 : 0;
    const odds = row['selected_decimal_odds'] as number | null;
    const units =
      outcome === "WIN" && odds != null ? odds - 1 : outcome === "LOSS" ? -1 : 0;

    const { error: upErr } = await sb
      .from(T30X_PREDICTIONS_TABLE)
      .update({
        okx_open: o,
        okx_high: Number((candle as Record<string, unknown>)['high']),
        okx_low: Number((candle as Record<string, unknown>)['low']),
        okx_close: c,
        okx_direction: dir,
        correctness_label: label,
        outcome,
        raw_score: raw,
        betting_units: units,
        resolved_at: new Date().toISOString(),
        resolution_error: null,
      })
      .eq("id", row['id'] as string)
      .is("resolved_at", null);
    if (upErr) continue;

    await sb
      .from(T30X_FEATURES_TABLE)
      .update({ okx_open: o, okx_close: c, okx_direction: dir, label })
      .eq("target_ts", targetTs);
    resolved++;
  }
  return { examined: rows.length, resolved };
}
