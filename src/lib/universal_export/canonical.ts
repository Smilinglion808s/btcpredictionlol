// Canonical ground truth lookup. Never nearest, never substitute.
// The lookup only succeeds for an exact BTC-USDT / 15m / OKX / confirm=true
// candle whose candle_ts equals the target boundary.

import { directionFromOhlc, type CanonicalDirection } from "./normalize";

export interface CanonicalCandle {
  id: string;
  symbol: string;
  timeframe: string;
  fetch_source: string;
  confirm: boolean;
  candle_ts: string;
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume: number | string;
}

export interface CanonicalResult {
  canonical_candle_row_id: string | null;
  canonical_symbol: string | null;
  canonical_timeframe: string | null;
  canonical_provider: string | null;
  canonical_confirmed: boolean | null;
  canonical_candle_ts: string | null;
  canonical_actual_open: number | null;
  canonical_actual_high: number | null;
  canonical_actual_low: number | null;
  canonical_actual_close: number | null;
  canonical_actual_volume: number | null;
  canonical_actual_direction: CanonicalDirection;
  canonical_ground_truth_valid: boolean;
  canonical_ground_truth_invalid_reason: string | null;
}

const EMPTY: CanonicalResult = {
  canonical_candle_row_id: null,
  canonical_symbol: null,
  canonical_timeframe: null,
  canonical_provider: null,
  canonical_confirmed: null,
  canonical_candle_ts: null,
  canonical_actual_open: null,
  canonical_actual_high: null,
  canonical_actual_low: null,
  canonical_actual_close: null,
  canonical_actual_volume: null,
  canonical_actual_direction: null,
  canonical_ground_truth_valid: false,
  canonical_ground_truth_invalid_reason: null,
};

/**
 * Index the canonical candle set by ISO timestamp. Duplicate detection is
 * intentional: a canonical row may exist only once per (symbol, timeframe,
 * candle_ts, fetch_source). If we see more than one OKX-confirmed row at the
 * same target timestamp, we mark that boundary duplicate so the caller
 * cannot silently pick one.
 */
export interface CanonicalIndex {
  byTs: Map<string, CanonicalCandle>;
  duplicates: Set<string>;
}

export function indexCanonicalCandles(rows: readonly CanonicalCandle[]): CanonicalIndex {
  const byTs = new Map<string, CanonicalCandle>();
  const duplicates = new Set<string>();
  for (const r of rows) {
    if (r.symbol !== "BTC-USDT") continue;
    if (r.timeframe !== "15m") continue;
    if (r.fetch_source !== "okx") continue;
    if (r.confirm !== true) continue;
    const ts = new Date(r.candle_ts).toISOString();
    if (byTs.has(ts)) duplicates.add(ts);
    else byTs.set(ts, r);
  }
  return { byTs, duplicates };
}

/**
 * Look up the canonical candle for `targetTsIso`. Enforces:
 *   - the returned row's candle_ts exactly equals the target timestamp
 *   - only one row exists at that timestamp
 *   - provider = okx, symbol = BTC-USDT, timeframe = 15m, confirm = true
 *   - OHLC finite and positive
 */
export function lookupCanonical(
  index: CanonicalIndex,
  targetTsIso: string,
): CanonicalResult {
  if (index.duplicates.has(targetTsIso)) {
    return { ...EMPTY, canonical_ground_truth_invalid_reason: "duplicate_canonical_rows" };
  }
  const row = index.byTs.get(targetTsIso);
  if (!row) {
    return { ...EMPTY, canonical_ground_truth_invalid_reason: "missing_exact_candle" };
  }
  if (row.symbol !== "BTC-USDT") return { ...EMPTY, canonical_ground_truth_invalid_reason: "wrong_symbol" };
  if (row.timeframe !== "15m") return { ...EMPTY, canonical_ground_truth_invalid_reason: "wrong_timeframe" };
  if (row.fetch_source !== "okx") return { ...EMPTY, canonical_ground_truth_invalid_reason: "wrong_provider" };
  if (row.confirm !== true) return { ...EMPTY, canonical_ground_truth_invalid_reason: "unconfirmed_candle" };
  const rowTs = new Date(row.candle_ts).toISOString();
  if (rowTs !== targetTsIso) {
    return { ...EMPTY, canonical_ground_truth_invalid_reason: "timestamp_mismatch" };
  }

  const o = Number(row.open);
  const h = Number(row.high);
  const l = Number(row.low);
  const c = Number(row.close);
  const v = Number(row.volume);
  const ohlc = [o, h, l, c];
  if (!ohlc.every((n) => Number.isFinite(n) && n > 0)) {
    return { ...EMPTY, canonical_ground_truth_invalid_reason: "nonfinite_or_nonpositive_ohlc" };
  }

  return {
    canonical_candle_row_id: row.id,
    canonical_symbol: "BTC-USDT",
    canonical_timeframe: "15m",
    canonical_provider: "okx",
    canonical_confirmed: true,
    canonical_candle_ts: rowTs,
    canonical_actual_open: o,
    canonical_actual_high: h,
    canonical_actual_low: l,
    canonical_actual_close: c,
    canonical_actual_volume: Number.isFinite(v) ? v : null,
    canonical_actual_direction: directionFromOhlc(o, c),
    canonical_ground_truth_valid: true,
    canonical_ground_truth_invalid_reason: null,
  };
}
