// T30 PriceFlow — pure validation of one-second bar batches from the collector.
//
// Only FINAL one-second bars whose open time falls in offsets 0..29 of an exact
// 15-minute UTC boundary are accepted. Offset 30 and later are rejected here,
// before persistence, so a T30 packet can never contain a T45-only bar.

import {
  T30_COLLECTOR_VERSION,
  T30_MAX_OFFSET,
  T30_MIN_OFFSET,
  T30_STREAM_KEY,
  T30_SYMBOL,
  T30_VENUE,
  floorTarget,
} from "./config";

export interface T30IngestSample {
  bar_open_ms: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quote_volume: number;
  taker_buy_volume: number;
  taker_buy_quote_volume: number;
  trade_count: number;
  is_final: boolean;
  event_time_ms?: number | null;
  final_event_ms?: number | null;
  received_at_ms?: number | null;
}

export interface T30SampleRow {
  target_ts: string;
  offset_seconds: number;
  venue: string;
  symbol: string;
  bar_open_ts: string;
  bar_close_ts: string;
  exchange_event_ts: string | null;
  final_event_ts: string | null;
  received_at: string | null;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quote_volume: number;
  taker_buy_volume: number;
  taker_buy_quote_volume: number;
  trade_count: number;
  is_final: boolean;
  capture_status: string;
  capture_reason: string | null;
  source_stream_id: string;
  collector_version: string;
  build_identifier: string | null;
}

export interface T30IngestResult {
  rows: T30SampleRow[];
  rejected: { bar_open_ms: number; reason: string }[];
}

const positive = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v > 0;
const nonNegative = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

const iso = (ms: unknown): string | null =>
  typeof ms === "number" && Number.isFinite(ms) ? new Date(ms).toISOString() : null;

export function validateT30Samples(
  samples: readonly T30IngestSample[],
  opts: { collectorVersion?: string; buildIdentifier?: string | null } = {},
): T30IngestResult {
  const rows: T30SampleRow[] = [];
  const rejected: { bar_open_ms: number; reason: string }[] = [];
  const seen = new Set<string>();

  for (const s of samples) {
    const ms = s.bar_open_ms;
    if (!Number.isFinite(ms) || ms % 1000 !== 0) {
      rejected.push({ bar_open_ms: ms, reason: "NOT_SECOND_ALIGNED" });
      continue;
    }
    if (!s.is_final) {
      rejected.push({ bar_open_ms: ms, reason: "T30_NONFINAL_BAR" });
      continue;
    }
    const target = floorTarget(ms);
    const offset = Math.round((ms - target) / 1000);
    if (offset < T30_MIN_OFFSET || offset > T30_MAX_OFFSET) {
      rejected.push({ bar_open_ms: ms, reason: "OUTSIDE_T30_WINDOW" });
      continue;
    }
    if (!positive(s.open) || !positive(s.high) || !positive(s.low) || !positive(s.close)) {
      rejected.push({ bar_open_ms: ms, reason: "INVALID_PRICE" });
      continue;
    }
    if (s.high < s.low) {
      rejected.push({ bar_open_ms: ms, reason: "CROSSED_BAR" });
      continue;
    }
    if (
      !nonNegative(s.volume) ||
      !nonNegative(s.quote_volume) ||
      !nonNegative(s.taker_buy_volume) ||
      !nonNegative(s.taker_buy_quote_volume) ||
      !nonNegative(s.trade_count)
    ) {
      rejected.push({ bar_open_ms: ms, reason: "INVALID_VOLUME" });
      continue;
    }
    if (s.taker_buy_quote_volume > s.quote_volume * 1.000001) {
      rejected.push({ bar_open_ms: ms, reason: "TAKER_EXCEEDS_TOTAL" });
      continue;
    }
    const key = `${target}:${offset}`;
    if (seen.has(key)) {
      rejected.push({ bar_open_ms: ms, reason: "T30_DUPLICATE_OFFSETS" });
      continue;
    }
    seen.add(key);

    rows.push({
      target_ts: new Date(target).toISOString(),
      offset_seconds: offset,
      venue: T30_VENUE,
      symbol: T30_SYMBOL,
      bar_open_ts: new Date(ms).toISOString(),
      bar_close_ts: new Date(ms + 999).toISOString(),
      exchange_event_ts: iso(s.event_time_ms),
      final_event_ts: iso(s.final_event_ms),
      received_at: iso(s.received_at_ms),
      open: s.open,
      high: s.high,
      low: s.low,
      close: s.close,
      volume: s.volume,
      quote_volume: s.quote_volume,
      taker_buy_volume: s.taker_buy_volume,
      taker_buy_quote_volume: s.taker_buy_quote_volume,
      trade_count: Math.round(s.trade_count),
      is_final: true,
      capture_status: "FRESH",
      capture_reason: null,
      source_stream_id: T30_STREAM_KEY,
      collector_version: opts.collectorVersion ?? T30_COLLECTOR_VERSION,
      build_identifier: opts.buildIdentifier ?? null,
    });
  }

  return { rows, rejected };
}
