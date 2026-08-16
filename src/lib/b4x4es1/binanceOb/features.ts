// B4x4-ES1 Binance Order-Book R1 — pure feature mathematics.
//
// No rounding is applied before persistence. Every rolling history is strictly
// past-only: the current target is never part of its own percentile window.

import {
  DEPTH_BANDS_BPS,
  EXPECTED_OBSERVATIONS,
  HISTORY_WINDOW,
  MAX_TARGET_AGE_MS,
  MIN_READY_OBSERVATIONS,
  MIN_TARGET_AGE_MS,
  OBS_END_OFFSET_S,
  type CaptureStatus,
} from "./config";
import { evaluateObservationTiming, featureCutoffMs } from "./timing";
import type { BandMetrics, BookMetrics, ObservationRow, PriceLevel } from "./types";

const EMPTY_BAND: BandMetrics = {
  bidDepthBtc: 0,
  askDepthBtc: 0,
  totalDepthBtc: 0,
  bidDepthUsd: 0,
  askDepthUsd: 0,
  totalDepthUsd: 0,
  imbalance: null,
};

/**
 * Depth/imbalance/microprice metrics for one book snapshot.
 *
 * Band edges are inclusive: a bid at exactly `mid * (1 - d/10000)` counts.
 */
export function computeBookMetrics(
  bidLevels: readonly PriceLevel[],
  askLevels: readonly PriceLevel[],
  bands: readonly number[] = DEPTH_BANDS_BPS,
): BookMetrics {
  const bestBidLevel = bidLevels[0];
  const bestAskLevel = askLevels[0];
  const out: BookMetrics = {
    bestBid: bestBidLevel?.[0] ?? null,
    bestBidQtyBtc: bestBidLevel?.[1] ?? null,
    bestAsk: bestAskLevel?.[0] ?? null,
    bestAskQtyBtc: bestAskLevel?.[1] ?? null,
    midPrice: null,
    spreadBps: null,
    microprice: null,
    micropriceDisplacementBps: null,
    crossed: false,
    bands: {},
  };
  for (const b of bands) out.bands[b] = { ...EMPTY_BAND };

  if (out.bestBid == null || out.bestAsk == null) return out;
  if (out.bestBid >= out.bestAsk) {
    out.crossed = true;
    return out;
  }

  const mid = (out.bestBid + out.bestAsk) / 2;
  out.midPrice = mid;
  out.spreadBps = ((out.bestAsk - out.bestBid) / mid) * 10_000;

  const bidQty = out.bestBidQtyBtc ?? 0;
  const askQty = out.bestAskQtyBtc ?? 0;
  if (bidQty + askQty > 0) {
    out.microprice = (out.bestAsk * bidQty + out.bestBid * askQty) / (bidQty + askQty);
    out.micropriceDisplacementBps = ((out.microprice - mid) / mid) * 10_000;
  }

  for (const d of bands) {
    const bidFloor = mid * (1 - d / 10_000);
    const askCeiling = mid * (1 + d / 10_000);
    let bidBtc = 0;
    let bidUsd = 0;
    for (const [price, qty] of bidLevels) {
      if (price < bidFloor) break;
      bidBtc += qty;
      bidUsd += price * qty;
    }
    let askBtc = 0;
    let askUsd = 0;
    for (const [price, qty] of askLevels) {
      if (price > askCeiling) break;
      askBtc += qty;
      askUsd += price * qty;
    }
    const total = bidBtc + askBtc;
    out.bands[d] = {
      bidDepthBtc: bidBtc,
      askDepthBtc: askBtc,
      totalDepthBtc: total,
      bidDepthUsd: bidUsd,
      askDepthUsd: askUsd,
      totalDepthUsd: bidUsd + askUsd,
      imbalance: total > 0 ? (bidBtc - askBtc) / total : null,
    };
  }
  return out;
}

/** True when both sides have displayed liquidity through the 10-bps band. */
export function bookCompleteThrough10Bps(metrics: BookMetrics): boolean {
  const band = metrics.bands[10];
  if (!band) return false;
  return band.bidDepthBtc > 0 && band.askDepthBtc > 0;
}

// ---------------------------------------------------------------- statistics

export function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((a, b) => a + b, 0) / values.length;
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 === 1 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export function stddev(values: readonly number[]): number | null {
  if (values.length < 2) return null;
  const m = mean(values)!;
  const v = values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1);
  return Math.sqrt(v);
}

export function range(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  return Math.max(...values) - Math.min(...values);
}

/** OLS slope of `values` against their integer index (per one-second step). */
export function olsSlope(values: readonly number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const xm = (n - 1) / 2;
  const ym = mean(values)!;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - xm) * (values[i]! - ym);
    den += (i - xm) ** 2;
  }
  if (den === 0) return null;
  return num / den;
}

/**
 * Fraction of non-zero observations whose sign matches the final non-zero sign.
 * Null when the final value is zero/non-finite or there are no non-zero values.
 */
export function signPersistence(values: readonly number[]): number | null {
  const finite = values.filter((v) => Number.isFinite(v));
  if (finite.length === 0) return null;
  const last = finite[finite.length - 1]!;
  if (last === 0) return null;
  const nonZero = finite.filter((v) => v !== 0);
  if (nonZero.length === 0) return null;
  const finalSign = Math.sign(last);
  const matching = nonZero.filter((v) => Math.sign(v) === finalSign).length;
  return matching / nonZero.length;
}

export function signChangeCount(values: readonly number[]): number {
  const nonZero = values.filter((v) => Number.isFinite(v) && v !== 0);
  let count = 0;
  for (let i = 1; i < nonZero.length; i++) {
    if (Math.sign(nonZero[i]!) !== Math.sign(nonZero[i - 1]!)) count++;
  }
  return count;
}

/** Empirical rank of `current` inside `previous` (count <= current / n). */
export function empiricalRank(previous: readonly number[], current: number): number | null {
  if (previous.length === 0) return null;
  let below = 0;
  for (const v of previous) if (v <= current) below++;
  return below / previous.length;
}

export function percentileOf(values: readonly number[], q: number): number | null {
  const s = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (s.length === 0) return null;
  const idx = (s.length - 1) * q;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return s[lo]!;
  return s[lo]! + (s[hi]! - s[lo]!) * (idx - lo);
}

// -------------------------------------------------------- boundary assembly

export interface BoundaryHistory {
  /** Previous valid same-market absolute 10-bps imbalances, oldest first. */
  absImbalance: number[];
  totalDepth: number[];
  spread: number[];
}

export interface BoundaryComputation {
  fields: Record<string, unknown>;
  ready: boolean;
  readyReason: string;
  historyReady: boolean;
  historyReasonn: string;
}

function windowValues(
  obs: readonly ObservationRow[],
  seconds: number,
  pick: (o: ObservationRow) => number | null,
): number[] {
  // Offsets count down to OBS_END_OFFSET_S at the cutoff, so a `seconds`-long
  // window ending at the cutoff is offset <= OBS_END_OFFSET_S + seconds - 1.
  const maxOffset = OBS_END_OFFSET_S + seconds - 1;
  return obs
    .filter((o) => o.sample_offset_seconds <= maxOffset)
    .sort((a, b) => b.sample_offset_seconds - a.sample_offset_seconds)
    .map(pick)
    .filter((v): v is number => v != null && Number.isFinite(v));
}

/**
 * Build the immutable boundary feature values from the one-second observation
 * sequence ending at T-2s plus the strictly prior 96-row history.
 */
export function computeBoundaryFeatures(params: {
  targetTs: string;
  observations: readonly ObservationRow[];
  history: BoundaryHistory;
  captureStatus: CaptureStatus;
  captureReason?: string | null;
}): BoundaryComputation {
  const { targetTs, observations, history } = params;
  const targetMs = new Date(targetTs).getTime();
  const cutoffMs = featureCutoffMs(targetMs);
  // Defence in depth: any row that fails the T-2s contract is dropped here too,
  // even though ingest and the database both reject it first.
  const eligible = observations.filter((o) => evaluateObservationTiming(o).eligible);
  const obs = [...eligible].sort((a, b) => b.sample_offset_seconds - a.sample_offset_seconds);
  const final = obs.find((o) => o.sample_offset_seconds === OBS_END_OFFSET_S) ?? null;

  const imb60 = windowValues(obs, 60, (o) => o.imbalance_10bps);
  const imb15 = windowValues(obs, 15, (o) => o.imbalance_10bps);
  const imb5 = windowValues(obs, 5, (o) => o.imbalance_10bps);
  const latencies = obs
    .map((o) => o.exchange_to_receive_ms)
    .filter((v): v is number => v != null && Number.isFinite(v));

  const ofi = (seconds: number) => {
    const vals = windowValues(obs, seconds, (o) => o.normalized_ofi_1s);
    return mean(vals);
  };
  const repl = (seconds: number, key: "bid_added_btc_1s" | "ask_added_btc_1s") => {
    const vals = windowValues(obs, seconds, (o) => o[key]);
    return vals.length ? vals.reduce((a, b) => a + b, 0) : null;
  };

  const finalImb10 = final?.imbalance_10bps ?? null;
  const finalAbs = finalImb10 == null ? null : Math.abs(finalImb10);

  const historyReady =
    history.absImbalance.length >= HISTORY_WINDOW &&
    history.totalDepth.length >= HISTORY_WINDOW &&
    history.spread.length >= HISTORY_WINDOW;
  const priorAbs = history.absImbalance.slice(-HISTORY_WINDOW);
  const priorDepth = history.totalDepth.slice(-HISTORY_WINDOW);
  const priorSpread = history.spread.slice(-HISTORY_WINDOW);

  const fields: Record<string, unknown> = {
    observation_count_60s: Math.min(obs.length, EXPECTED_OBSERVATIONS),
    expected_observation_count_60s: EXPECTED_OBSERVATIONS,
    // Canonical (and only) history counter for this subsystem.
    history_valid_count: priorAbs.length,

    final_exchange_event_ts: final?.exchange_event_ts ?? null,
    final_received_at: final?.received_at ?? null,
    final_target_age_ms: final?.target_age_ms ?? null,
    final_update_id: final?.last_update_id ?? null,
    sequence_ok: final?.sequence_ok ?? false,
    book_complete_10bps: final?.book_complete_10bps ?? false,
    resync_generation: final?.resync_generation ?? 0,
    // NOT NULL in the features table; carry the collector's stream identity
    // from the final (or any available) observation for this boundary.
    source_ws_url_id: final?.source_ws_url_id ?? obs[0]?.source_ws_url_id ?? "unknown",

    final_best_bid: final?.best_bid ?? null,
    final_best_ask: final?.best_ask ?? null,
    final_mid_price: final?.mid_price ?? null,
    final_spread_bps: final?.spread_bps ?? null,
    final_microprice_displacement_bps: final?.microprice_displacement_bps ?? null,
    final_bid_depth_btc_10bps: final?.bid_depth_btc_10bps ?? null,
    final_ask_depth_btc_10bps: final?.ask_depth_btc_10bps ?? null,
    final_total_depth_btc_10bps: final?.total_depth_btc_10bps ?? null,
    final_total_depth_usd_10bps: final?.total_depth_usd_10bps ?? null,
    final_imbalance_1bps: final?.imbalance_1bps ?? null,
    final_imbalance_2bps: final?.imbalance_2bps ?? null,
    final_imbalance_5bps: final?.imbalance_5bps ?? null,
    final_imbalance_10bps: finalImb10,
    final_abs_imbalance_10bps: finalAbs,

    mean_imbalance_10bps_5s: mean(imb5),
    mean_imbalance_10bps_15s: mean(imb15),
    mean_imbalance_10bps_60s: mean(imb60),
    median_imbalance_10bps_5s: median(imb5),
    median_imbalance_10bps_15s: median(imb15),
    median_imbalance_10bps_60s: median(imb60),
    slope_imbalance_10bps_5s: olsSlope(imb5),
    slope_imbalance_10bps_15s: olsSlope(imb15),
    slope_imbalance_10bps_60s: olsSlope(imb60),
    stddev_imbalance_10bps_5s: stddev(imb5),
    stddev_imbalance_10bps_15s: stddev(imb15),
    stddev_imbalance_10bps_60s: stddev(imb60),
    range_imbalance_10bps_5s: range(imb5),
    range_imbalance_10bps_15s: range(imb15),
    range_imbalance_10bps_60s: range(imb60),
    sign_persistence_5s: signPersistence(imb5),
    sign_persistence_15s: signPersistence(imb15),
    sign_persistence_60s: signPersistence(imb60),
    sign_change_count_60s: signChangeCount(imb60),

    normalized_ofi_5s: ofi(5),
    normalized_ofi_15s: ofi(15),
    normalized_ofi_60s: ofi(60),
    bid_replenishment_btc_5s: repl(5, "bid_added_btc_1s"),
    bid_replenishment_btc_15s: repl(15, "bid_added_btc_1s"),
    bid_replenishment_btc_60s: repl(60, "bid_added_btc_1s"),
    ask_replenishment_btc_5s: repl(5, "ask_added_btc_1s"),
    ask_replenishment_btc_15s: repl(15, "ask_added_btc_1s"),
    ask_replenishment_btc_60s: repl(60, "ask_added_btc_1s"),

    abs_imbalance_percentile_96:
      historyReady && finalAbs != null ? empiricalRank(priorAbs, finalAbs) : null,
    total_depth_percentile_96:
      historyReady && final?.total_depth_btc_10bps != null
        ? empiricalRank(priorDepth, final.total_depth_btc_10bps)
        : null,
    spread_percentile_96:
      historyReady && final?.spread_bps != null ? empiricalRank(priorSpread, final.spread_bps) : null,
    receive_latency_p50_ms: percentileOf(latencies, 0.5),
    receive_latency_p95_ms: percentileOf(latencies, 0.95),
  };

  // ---- readiness (kept strictly separate from history readiness) ----
  let readyReason = "READY";
  const finalEventMs = final?.exchange_event_ts ? new Date(final.exchange_event_ts).getTime() : null;
  const finalRecvMs = final?.received_at ? new Date(final.received_at).getTime() : null;

  if (params.captureStatus !== "FRESH") readyReason = `CAPTURE_${params.captureStatus}`;
  else if (!final) readyReason = "NO_FINAL_OBSERVATION";
  else if (!final.sequence_ok) readyReason = "SEQUENCE_NOT_OK";
  else if (!final.local_book_initialized) readyReason = "BOOK_NOT_INITIALIZED";
  else if (!final.book_complete_10bps) readyReason = "BOOK_INCOMPLETE_10BPS";
  else if (final.best_bid == null || final.best_ask == null || final.best_bid >= final.best_ask)
    readyReason = "CROSSED_OR_MISSING_TOP";
  else if (finalEventMs == null || finalEventMs >= targetMs) readyReason = "EVENT_TS_NOT_PRE_TARGET";
  else if (finalRecvMs == null || finalRecvMs > cutoffMs) readyReason = "RECEIVE_TS_AFTER_CUTOFF";
  else if (
    final.target_age_ms == null ||
    final.target_age_ms < MIN_TARGET_AGE_MS ||
    final.target_age_ms > MAX_TARGET_AGE_MS
  )
    readyReason = "TARGET_AGE_OUT_OF_RANGE";
  else if (obs.length < MIN_READY_OBSERVATIONS) readyReason = "INSUFFICIENT_OBSERVATIONS";
  else if (finalImb10 == null || !Number.isFinite(finalImb10)) readyReason = "IMBALANCE_NOT_FINITE";

  const ready = readyReason === "READY";
  const historyReasonn = historyReady
    ? "HISTORY_READY"
    : `HISTORY_NOT_READY_${priorAbs.length}_OF_${HISTORY_WINDOW}`;

  fields.ready = ready;
  fields.ready_reason = readyReason;
  fields.history_ready = historyReady;
  fields.history_ready_reason = historyReasonn;

  return { fields, ready, readyReason, historyReady, historyReasonn };
}
