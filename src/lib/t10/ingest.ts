// T10 Bridge — collector sample validation (pure).
//
// Only finalized Binance Spot one-second bars at offsets 0..9 of a 15-minute
// UTC boundary are storable. Anything else is rejected with a reason and never
// reaches storage, so the packet can never be silently widened or back-filled
// from partial bars.

import {
  T10_COLLECTOR_VERSION,
  T10_MAX_OFFSET,
  T10_MIN_OFFSET,
  T10_SYMBOL,
  T10_VENUE,
  floorTarget,
} from "./config";

export interface T10RawSample {
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

export interface T10ValidationResult {
  rows: Record<string, unknown>[];
  rejected: { bar_open_ms: number; reason: string }[];
}

const NUMERIC: (keyof T10RawSample)[] = [
  "open",
  "high",
  "low",
  "close",
  "volume",
  "quote_volume",
  "taker_buy_volume",
  "taker_buy_quote_volume",
  "trade_count",
];

export function validateT10Samples(
  samples: readonly T10RawSample[],
  meta: { collectorVersion: string; buildIdentifier: string | null },
): T10ValidationResult {
  const rows: Record<string, unknown>[] = [];
  const rejected: { bar_open_ms: number; reason: string }[] = [];
  const seen = new Set<string>();

  for (const s of samples) {
    const barOpenMs = Number(s.bar_open_ms);
    if (!Number.isFinite(barOpenMs) || barOpenMs % 1000 !== 0) {
      rejected.push({ bar_open_ms: barOpenMs, reason: "BAR_NOT_SECOND_ALIGNED" });
      continue;
    }
    if (s.is_final !== true) {
      rejected.push({ bar_open_ms: barOpenMs, reason: "BAR_NOT_FINAL" });
      continue;
    }
    const targetMs = floorTarget(barOpenMs);
    const offset = Math.round((barOpenMs - targetMs) / 1000);
    if (offset < T10_MIN_OFFSET || offset > T10_MAX_OFFSET) {
      rejected.push({ bar_open_ms: barOpenMs, reason: "OFFSET_OUT_OF_RANGE" });
      continue;
    }
    if (NUMERIC.some((k) => !Number.isFinite(Number(s[k])))) {
      rejected.push({ bar_open_ms: barOpenMs, reason: "NON_FINITE_FIELD" });
      continue;
    }
    const key = `${targetMs}:${offset}`;
    if (seen.has(key)) {
      rejected.push({ bar_open_ms: barOpenMs, reason: "DUPLICATE_OFFSET" });
      continue;
    }
    seen.add(key);

    rows.push({
      target_ts: new Date(targetMs).toISOString(),
      offset_seconds: offset,
      bar_open_ts: new Date(barOpenMs).toISOString(),
      bar_close_ts: new Date(barOpenMs + 999).toISOString(),
      venue: T10_VENUE,
      symbol: T10_SYMBOL,
      open: Number(s.open),
      high: Number(s.high),
      low: Number(s.low),
      close: Number(s.close),
      volume: Number(s.volume),
      quote_volume: Number(s.quote_volume),
      taker_buy_volume: Number(s.taker_buy_volume),
      taker_buy_quote_volume: Number(s.taker_buy_quote_volume),
      trade_count: Number(s.trade_count),
      is_final: true,
      event_time: s.event_time_ms == null ? null : new Date(Number(s.event_time_ms)).toISOString(),
      final_event_at:
        s.final_event_ms == null ? null : new Date(Number(s.final_event_ms)).toISOString(),
      received_at: new Date(Number(s.received_at_ms ?? Date.now())).toISOString(),
      collector_version: meta.collectorVersion || T10_COLLECTOR_VERSION,
      build_identifier: meta.buildIdentifier,
    });
  }

  return { rows, rejected };
}
