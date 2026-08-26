// T10 Bridge — strict packet validation (pure).
//
// A T10 packet is EXACTLY the finalized Binance Global Spot one-second bars at
// offsets 0..9 of one 15-minute UTC target. Offset 10 and later are rejected
// here, before any feature is computed, so a T10 packet can never contain a
// T30/T45-only bar. Nothing is approximated, carried forward or waited for.

import {
  T10_EXPECTED_OBSERVATIONS,
  T10_MAX_OFFSET,
  T10_MIN_OFFSET,
  T10_PACKET_REASONS,
  isExactBoundary,
} from "./config";

export interface T10SecondBar {
  offset_seconds: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quote_volume: number;
  taker_buy_quote_volume: number;
  trade_count: number;
  is_final?: boolean;
}

export interface T10PacketResult {
  complete: boolean;
  reason: string | null;
  bars: T10SecondBar[];
  count: number;
  firstOffset: number | null;
  lastOffset: number | null;
  offsetTenIncluded: boolean;
}

const FINITE_FIELDS: (keyof T10SecondBar)[] = [
  "open",
  "high",
  "low",
  "close",
  "volume",
  "quote_volume",
  "taker_buy_quote_volume",
  "trade_count",
];

export function validateT10Packet(
  targetTs: string,
  input: readonly T10SecondBar[],
): T10PacketResult {
  const bars = [...input].sort((a, b) => a.offset_seconds - b.offset_seconds);
  const offsets = bars.map((b) => b.offset_seconds);
  const offsetTenIncluded = offsets.some((o) => o > T10_MAX_OFFSET);
  const base: T10PacketResult = {
    complete: false,
    reason: null,
    bars,
    count: bars.length,
    firstOffset: offsets.length ? offsets[0] : null,
    lastOffset: offsets.length ? offsets[offsets.length - 1] : null,
    offsetTenIncluded,
  };

  if (!isExactBoundary(targetTs)) {
    return { ...base, reason: T10_PACKET_REASONS.TIMING_INVALID };
  }
  if (bars.length === 0) return { ...base, reason: T10_PACKET_REASONS.NO_PACKET };
  if (offsetTenIncluded || offsets.some((o) => o < T10_MIN_OFFSET)) {
    return { ...base, reason: T10_PACKET_REASONS.OFFSET_OUT_OF_RANGE };
  }
  if (new Set(offsets).size !== offsets.length) {
    return { ...base, reason: T10_PACKET_REASONS.DUPLICATE_OFFSETS };
  }
  if (bars.length !== T10_EXPECTED_OBSERVATIONS) {
    return {
      ...base,
      reason:
        bars.length < T10_EXPECTED_OBSERVATIONS
          ? T10_PACKET_REASONS.INSUFFICIENT_OBSERVATIONS
          : T10_PACKET_REASONS.MISSING_OFFSETS,
    };
  }
  for (let i = 0; i < T10_EXPECTED_OBSERVATIONS; i++) {
    if (offsets[i] !== i) return { ...base, reason: T10_PACKET_REASONS.MISSING_OFFSETS };
  }
  if (bars.some((b) => b.is_final === false)) {
    return { ...base, reason: T10_PACKET_REASONS.NONFINAL_BAR };
  }
  for (const b of bars) {
    for (const f of FINITE_FIELDS) {
      const v = b[f] as number;
      if (!Number.isFinite(v)) return { ...base, reason: T10_PACKET_REASONS.NON_FINITE_VALUE };
    }
    if (b.open <= 0 || b.close <= 0 || b.high <= 0 || b.low <= 0) {
      return { ...base, reason: T10_PACKET_REASONS.NON_FINITE_VALUE };
    }
  }
  return { ...base, complete: true, reason: null };
}
