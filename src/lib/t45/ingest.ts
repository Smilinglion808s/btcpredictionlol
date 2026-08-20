// T45 Balanced — pure validation of one-second bar batches from the collector.
//
// The collector may only submit final (closed) one-second bars whose open time
// falls in offsets 0..44 of a 15-minute UTC boundary. Anything else is rejected
// here, before persistence.

import {
  T45_FIRST_OFFSET_S,
  T45_LAST_OFFSET_S,
  T45_COLLECTOR_VERSION,
  T45_STREAM_KEY,
  T45_VENUE,
  T45_SYMBOL,
  floorTarget,
} from "./config";

export interface T45IngestSample {
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
  received_at_ms?: number | null;
}

export interface T45SampleRow {
  target_ts: string;
  offset_seconds: number;
  venue: string;
  symbol: string;
  bar_open_ts: string;
  bar_close_ts: string;
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

export interface T45IngestResult {
  rows: T45SampleRow[];
  rejected: { bar_open_ms: number; reason: string }[];
}

const positive = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v) && v > 0;
const nonNegative = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v) && v >= 0;

export function validateT45Samples(
  samples: readonly T45IngestSample[],
  opts: { collectorVersion?: string; buildIdentifier?: string | null } = {},
): T45IngestResult {
  const rows: T45SampleRow[] = [];
  const rejected: { bar_open_ms: number; reason: string }[] = [];
  const seen = new Set<string>();

  for (const s of samples) {
    const ms = s.bar_open_ms;
    if (!Number.isFinite(ms) || ms % 1000 !== 0) {
      rejected.push({ bar_open_ms: ms, reason: "NOT_SECOND_ALIGNED" });
      continue;
    }
    if (!s.is_final) {
      rejected.push({ bar_open_ms: ms, reason: "BAR_NOT_FINAL" });
      continue;
    }
    const target = floorTarget(ms);
    const offset = Math.round((ms - target) / 1000);
    if (offset < T45_FIRST_OFFSET_S || offset > T45_LAST_OFFSET_S) {
      rejected.push({ bar_open_ms: ms, reason: "OUTSIDE_T45_WINDOW" });
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
      rejected.push({ bar_open_ms: ms, reason: "DUPLICATE_IN_BATCH" });
      continue;
    }
    seen.add(key);

    rows.push({
      target_ts: new Date(target).toISOString(),
      offset_seconds: offset,
      venue: T45_VENUE,
      symbol: T45_SYMBOL,
      bar_open_ts: new Date(ms).toISOString(),
      bar_close_ts: new Date(ms + 999).toISOString(),
      received_at:
        s.received_at_ms != null && Number.isFinite(s.received_at_ms)
          ? new Date(s.received_at_ms).toISOString()
          : null,
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
      source_stream_id: T45_STREAM_KEY,
      collector_version: opts.collectorVersion ?? T45_COLLECTOR_VERSION,
      build_identifier: opts.buildIdentifier ?? null,
    });
  }

  return { rows, rejected };
}
