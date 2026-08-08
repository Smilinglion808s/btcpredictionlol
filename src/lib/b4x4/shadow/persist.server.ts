// B4x4 order-book shadow persistence, resolution and historical placeholders.
//
// SHADOW ONLY (shadow_only=true, used_in_decision=false). Every entry point
// here is exception-safe: it can never throw into the B4x4 prediction or
// webhook path.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  B4X4_OB_INSTRUMENT,
  B4X4_OB_PROVIDER,
  B4X4_OB_SHADOW_VERSION,
  classifyCapture,
  computeDepth,
  computeFlowLabels,
  computeTopOfBook,
  computeTradeFlow,
  flowRelationship,
  type Book,
  type CaptureStatus,
  type Trade,
} from "./orderbook";

export interface ShadowPredictionRef {
  id: string;
  target_candle_ts: string;
  run_mode?: string | null;
  raw_direction?: string | null;
  final_prediction?: string | null;
  would_trade?: boolean | null;
}

export interface SnapshotInput {
  event_ts?: string | null;
  local_receipt_ts?: string | null;
  cutoff_ts?: string | null;
  book_json?: Book | null;
  trades_json?: Trade[] | null;
  seq_id?: string | null;
  prev_seq_id?: string | null;
  book_complete?: boolean | null;
  sequence_gap?: boolean | null;
  sequence_gap_count?: number | null;
  trade_window_start_ts?: string | null;
  trade_window_complete?: boolean | null;
  captured_at?: string | null;
  capture_attempt_count?: number | null;
  capture_attempts_json?: unknown;
  chosen_attempt_id?: string | null;
  capture_error_list?: unknown;
  error_code?: string | null;
  error_message?: string | null;
}

type Row = Record<string, unknown>;

/** Deterministic mapping from a captured snapshot to a shadow audit row. */
export function buildShadowRow(pred: ShadowPredictionRef, snap: SnapshotInput | null): Row {
  const targetMs = new Date(pred.target_candle_ts).getTime();
  const cutoffMs = targetMs - 1;
  const eventMs = snap?.event_ts ? new Date(snap.event_ts).getTime() : null;
  const receiptMs = snap?.local_receipt_ts ? new Date(snap.local_receipt_ts).getTime() : null;
  const { status, ageMs } = classifyCapture({
    hasSnapshot: !!snap && !!snap.book_json,
    errorCode: snap?.error_code ?? null,
    eventTsMs: eventMs,
    cutoffMs,
    sequenceGap: snap?.sequence_gap ?? null,
    bookComplete: snap?.book_complete ?? null,
    localReceiptMs: receiptMs,
  });


  const base: Row = {
    b4x4_prediction_id: pred.id,
    target_candle_ts: pred.target_candle_ts,
    feature_cutoff_ts: new Date(cutoffMs).toISOString(),
    run_mode: pred.run_mode ?? null,
    shadow_version: B4X4_OB_SHADOW_VERSION,
    provider: B4X4_OB_PROVIDER,
    instrument: B4X4_OB_INSTRUMENT,
    shadow_only: true,
    used_in_decision: false,
    capture_status: status,
    coverage_status: status,
    snapshot_event_ts: snap?.event_ts ?? null,
    snapshot_received_at: snap?.captured_at ?? null,
    snapshot_local_receipt_ts: snap?.local_receipt_ts ?? null,
    snapshot_cutoff_ts: snap?.cutoff_ts ?? new Date(cutoffMs).toISOString(),
    snapshot_persisted_at: new Date().toISOString(),
    snapshot_age_ms: ageMs,
    capture_attempt_count: snap?.capture_attempt_count ?? null,
    capture_attempts_json: snap?.capture_attempts_json ?? null,
    chosen_attempt_id: snap?.chosen_attempt_id ?? null,
    capture_error_list: snap?.capture_error_list ?? null,
    trade_window_complete: snap?.trade_window_complete ?? null,

    source_seq_id: snap?.seq_id ?? null,
    prev_seq_id: snap?.prev_seq_id ?? null,
    sequence_gap: snap?.sequence_gap ?? null,
    sequence_gap_count: snap?.sequence_gap_count ?? null,
    book_complete: snap?.book_complete ?? null,
    collector_error_code: snap?.error_code ?? null,
    collector_error_message: snap?.error_message ?? null,
    error_reason: snap?.error_message ?? null,
    add_cancel_add_total: null,
    add_cancel_cancel_total: null,
    add_cancel_imbalance: null,
    add_cancel_source_available: false,
    missing_source_capabilities: "book_event_stream:add_cancel",
    b4x4_raw_direction: pred.raw_direction ?? null,
    b4x4_final_prediction: pred.final_prediction ?? null,
    b4x4_published: pred.would_trade === true,
  };

  const usable =
    status === "CAPTURED_VALID" ||
    status === "CAPTURED_STALE" ||
    status === "CAPTURED_INCOMPLETE" ||
    status === "CAPTURED_SEQUENCE_GAP";
  const book = snap?.book_json;
  if (!usable || !book?.bids?.length || !book?.asks?.length) return base;

  const top = computeTopOfBook(book);
  const depth = computeDepth(book, top.mid_price);
  const bufferStart = snap?.trade_window_start_ts
    ? new Date(snap.trade_window_start_ts).getTime()
    : null;
  // Trade-window completeness is independent from book validity: never
  // fabricate trade-derived fields when no trade buffer was captured.
  const tradesAvailable = Array.isArray(snap?.trades_json);
  const flow = tradesAvailable
    ? computeTradeFlow(snap?.trades_json ?? [], cutoffMs, bufferStart)
    : null;
  const labels = computeFlowLabels({
    micropriceOffsetBps: top.microprice_offset_bps,
    spreadBps: top.spread_bps,
    queueImbalanceTop5: depth.queue_imbalance_top5,
    takerDelta3m: flow?.taker_delta_3m ?? null,
  });
  const relationship = flowRelationship(labels.flow_direction, pred.raw_direction);

  return {
    ...base,
    ...top,
    orderbook_json: { top, depth: depth.buckets },
    depth_json: depth.buckets,
    queue_imbalance_top1: depth.queue_imbalance_top1,
    queue_imbalance_top5: depth.queue_imbalance_top5,
    queue_imbalance_top20: depth.queue_imbalance_top20,
    depth_imbalance_1bps: depth.depth_imbalance_1bps,
    depth_imbalance_5bps: depth.depth_imbalance_5bps,
    depth_imbalance_10bps: depth.depth_imbalance_10bps,
    depth_imbalance_25bps: depth.depth_imbalance_25bps,
    flow_json: flow?.windows ?? null,
    trade_flow_json: flow?.windows ?? null,
    taker_delta_30s: flow?.taker_delta_30s ?? null,
    taker_delta_2m: flow?.taker_delta_2m ?? null,
    taker_delta_3m: flow?.taker_delta_3m ?? null,
    taker_delta_5m: flow?.taker_delta_5m ?? null,
    taker_delta_15m: flow?.taker_delta_15m ?? null,
    cvd_3m: flow?.cvd_3m ?? null,
    trade_event_count: flow?.trade_event_count ?? null,
    trade_windows_complete: flow?.all_windows_complete ?? false,
    trade_window_complete: snap?.trade_window_complete ?? (flow?.all_windows_complete ?? false),
    flow_component_count: labels.flow_component_count,
    flow_composite_score: labels.flow_composite_score,
    flow_direction: labels.flow_direction,
    flow_strength: labels.flow_strength,
    flow_coherent: labels.flow_coherent,
    flow_strong_coherent: labels.flow_strong_coherent,
    flow_direction_3m: flow?.taker_delta_3m == null ? null : flow.taker_delta_3m > 0 ? "GREEN" : flow.taker_delta_3m < 0 ? "RED" : "NEUTRAL",
    flow_direction_15m: flow?.taker_delta_15m == null ? null : flow.taker_delta_15m > 0 ? "GREEN" : flow.taker_delta_15m < 0 ? "RED" : "NEUTRAL",
    raw_direction_relationship: relationship,
    flow_agrees_a2: relationship === "AGREE",
    flow_conflicts_a2: relationship === "CONFLICT",
  };

}

/**
 * Idempotently persist exactly one shadow row for a LIVE B4x4 prediction.
 * Never throws — the caller is the B4x4 critical path.
 */
export async function persistB4x4Shadow(
  supabase: SupabaseClient,
  pred: ShadowPredictionRef,
): Promise<CaptureStatus | null> {
  try {
    const { data } = await supabase
      .from("b4x4_ob_snapshots")
      .select("*")
      .eq("target_candle_ts", pred.target_candle_ts)
      .maybeSingle();
    const snap = (data as unknown as SnapshotInput | null) ?? null;
    const row = buildShadowRow(pred, snap);

    // Immutability: once a valid capture is recorded, never overwrite it.
    const { data: prior } = await supabase
      .from("b4x4_shadow_market_data")
      .select("id, capture_status")
      .eq("b4x4_prediction_id", pred.id)
      .maybeSingle();
    const priorStatus = (prior as { capture_status?: string } | null)?.capture_status ?? null;
    if (priorStatus && priorStatus.startsWith("CAPTURED_")) {
      return priorStatus as CaptureStatus;
    }

    await supabase
      .from("b4x4_shadow_market_data")
      .upsert(row as never, { onConflict: "b4x4_prediction_id" });
    return row.capture_status as CaptureStatus;
  } catch (e) {
    try {
      await supabase.from("b4x4_shadow_market_data").upsert(
        {
          b4x4_prediction_id: pred.id,
          target_candle_ts: pred.target_candle_ts,
          shadow_version: B4X4_OB_SHADOW_VERSION,
          provider: B4X4_OB_PROVIDER,
          instrument: B4X4_OB_INSTRUMENT,
          shadow_only: true,
          used_in_decision: false,
          capture_status: "COLLECTOR_ERROR",
          coverage_status: "COLLECTOR_ERROR",
          collector_error_code: "COLLECTOR_ERROR",
          collector_error_message: e instanceof Error ? e.message : String(e),
        } as never,
        { onConflict: "b4x4_prediction_id" },
      );
    } catch { /* ignore */ }
    return "COLLECTOR_ERROR";
  }
}

/** Fire-and-forget wrapper: guarantees no rejection escapes into B4x4. */
export function persistB4x4ShadowSafe(supabase: SupabaseClient, pred: ShadowPredictionRef): void {
  void persistB4x4Shadow(supabase, pred).catch(() => undefined);
}

/** Idempotent shadow resolution attribution. */
export async function resolveB4x4ShadowRow(
  supabase: SupabaseClient,
  targetCandleTs: string,
  actualDirection: string,
  b4x4: { result?: string | null; result_score?: number | null; raw_direction?: string | null; would_trade?: boolean | null },
): Promise<void> {
  try {
    const rawDir = b4x4.raw_direction ?? null;
    const correct =
      actualDirection === "GREEN" || actualDirection === "RED"
        ? rawDir === "GREEN" || rawDir === "RED"
          ? rawDir === actualDirection
          : null
        : null;
    await supabase
      .from("b4x4_shadow_market_data")
      .update({
        actual_direction: actualDirection,
        raw_direction_correct: correct,
        b4x4_result: b4x4.result ?? null,
        b4x4_result_score: b4x4.result_score ?? null,
        b4x4_published: b4x4.would_trade === true,
        shadow_resolved_at: new Date().toISOString(),
      } as never)
      .eq("target_candle_ts", targetCandleTs)
      .is("shadow_resolved_at", null);
  } catch { /* shadow never blocks resolution */ }
}

/**
 * One placeholder shadow row per prior LIVE B4x4 prediction that has no
 * capture. No metrics are reconstructed — those periods are simply documented.
 */
export async function backfillHistoricalPlaceholders(
  supabase: SupabaseClient,
): Promise<{ scanned: number; inserted: number }> {
  const { data: preds } = await supabase
    .from("b4x4_predictions")
    .select("id, target_candle_ts, run_mode, raw_direction, final_prediction, would_trade")
    .eq("run_mode", "LIVE")
    .order("target_candle_ts", { ascending: true })
    .limit(5000);
  const rows = (preds ?? []) as unknown as ShadowPredictionRef[];
  const { data: existing } = await supabase
    .from("b4x4_shadow_market_data")
    .select("b4x4_prediction_id")
    .limit(10000);
  const have = new Set(
    ((existing ?? []) as Array<{ b4x4_prediction_id: string | null }>)
      .map((r) => r.b4x4_prediction_id)
      .filter(Boolean) as string[],
  );
  const missing = rows.filter((r) => !have.has(r.id));
  if (missing.length === 0) return { scanned: rows.length, inserted: 0 };

  const payload = missing.map((p) => ({
    b4x4_prediction_id: p.id,
    target_candle_ts: p.target_candle_ts,
    feature_cutoff_ts: new Date(new Date(p.target_candle_ts).getTime() - 1).toISOString(),
    run_mode: "LIVE",
    shadow_version: B4X4_OB_SHADOW_VERSION,
    provider: B4X4_OB_PROVIDER,
    instrument: B4X4_OB_INSTRUMENT,
    shadow_only: true,
    used_in_decision: false,
    capture_status: "HISTORICAL_NOT_CAPTURED",
    coverage_status: "HISTORICAL_NOT_CAPTURED",
    b4x4_raw_direction: p.raw_direction ?? null,
    b4x4_final_prediction: p.final_prediction ?? null,
    b4x4_published: p.would_trade === true,
    missing_source_capabilities: "no_raw_preboundary_events_retained",
  }));
  for (let i = 0; i < payload.length; i += 500) {
    await supabase
      .from("b4x4_shadow_market_data")
      .upsert(payload.slice(i, i + 500) as never, { onConflict: "b4x4_prediction_id" });
  }
  return { scanned: rows.length, inserted: payload.length };
}
