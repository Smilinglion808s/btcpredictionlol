// T45 Balanced — prediction-time feature builder (pure).
//
// This is a line-for-line port of the frozen research reference
// `build_t45_features_reference.py :: group_spot_target`, plus the derived
// log-volume and R2 interaction terms applied by the frozen replay. Any change
// here breaks parity with the certified oracle and must not be made.

import {
  T45_EXPECTED_SECONDS,
  T45_FEATURE_ORDER,
  T45_FIRST_OFFSET_S,
  T45_LAST_OFFSET_S,
} from "./config";

export interface T45SecondBar {
  offsetSeconds: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  quoteVolume: number;
  tradeCount: number;
  takerBuyQuoteVolume: number;
}

export type T45FeatureMap = Record<string, number | null>;

export interface T45FeatureResult {
  values: T45FeatureMap;
  secondsPresent: number;
  spotComplete: boolean;
  featureComplete: boolean;
  invalidReason: string | null;
  /** Frozen-order model vector; null when any component is non-finite. */
  vector: number[] | null;
}

const WINDOWS = [5, 15, 30, 45] as const;

function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function finite(v: number): number | null {
  return Number.isFinite(v) ? v : null;
}

/**
 * Build the T45 feature map from the 45 one-second bars of the target candle
 * and the frozen R2 prior for that candle.
 *
 * `r2Prior` must be the certified prior in {-1, 0, 1}. Pass `null` when no
 * certified prior exists — the row is then explicitly incomplete and can never
 * produce a decision (fail closed).
 */
export function buildT45Features(
  bars: readonly T45SecondBar[],
  r2Prior: number | null,
): T45FeatureResult {
  const sorted = [...bars].sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  const offsets = sorted.map((b) => b.offsetSeconds);
  const values: T45FeatureMap = {
    t45_seconds_count: sorted.length,
    t45_first_offset_s: offsets.length ? offsets[0] : -1,
    t45_last_offset_s: offsets.length ? offsets[offsets.length - 1] : -1,
    t45_spot_open: sorted.length ? sorted[0].open : null,
  };

  const complete =
    sorted.length === T45_EXPECTED_SECONDS &&
    offsets.every((o, i) => o === T45_FIRST_OFFSET_S + i) &&
    offsets[offsets.length - 1] === T45_LAST_OFFSET_S;
  values.t45_spot_complete = complete ? 1 : 0;

  const baseOpen = sorted.length ? sorted[0].open : NaN;
  if (!complete || !Number.isFinite(baseOpen) || baseOpen <= 0) {
    return {
      values,
      secondsPresent: sorted.length,
      spotComplete: false,
      featureComplete: false,
      invalidReason: complete ? "INVALID_BASE_OPEN" : "INCOMPLETE_SECOND_BARS",
      vector: null,
    };
  }

  const closes = sorted.map((b) => b.close);
  const highs = sorted.map((b) => b.high);
  const lows = sorted.map((b) => b.low);
  const qvol = sorted.map((b) => b.quoteVolume);
  const vol = sorted.map((b) => b.volume);
  const counts = sorted.map((b) => b.tradeCount);
  const buyQvol = sorted.map((b) => b.takerBuyQuoteVolume);

  const logClose = closes.map((c) => Math.log(c));
  // diff of [log(base_open), ...log_close] — 45 one-second log returns.
  const rets: number[] = [];
  let prev = Math.log(baseOpen);
  for (const lc of logClose) {
    rets.push(lc - prev);
    prev = lc;
  }

  for (const w of WINDOWS) {
    const idx = offsets.map((o, i) => (o < w ? i : -1)).filter((i) => i >= 0);
    const last = idx[idx.length - 1];
    const finalClose = closes[last];
    const hi = Math.max(...idx.map((i) => highs[i]));
    const lo = Math.min(...idx.map((i) => lows[i]));
    const q = idx.reduce((a, i) => a + qvol[i], 0);
    const bq = idx.reduce((a, i) => a + buyQvol[i], 0);
    const c = idx.reduce((a, i) => a + counts[i], 0);
    values[`t45_close_${w}s`] = finalClose;
    values[`t45_ret_${w}s_bps`] = Math.log(finalClose / baseOpen) * 10_000;
    values[`t45_range_${w}s_bps`] = ((hi - lo) / baseOpen) * 10_000;
    values[`t45_quote_volume_${w}s`] = q;
    values[`t45_trade_count_${w}s`] = c;
    values[`t45_quote_flow_${w}s`] = q > 0 ? (2 * bq) / q - 1 : null;
  }

  const totalRange = Math.max(...highs) - Math.min(...lows);
  const close45 = closes[closes.length - 1];
  const path = rets.reduce((a, r) => a + Math.abs(r), 0);
  values.t45_body_range_45s = totalRange > 0 ? (close45 - baseOpen) / totalRange : null;
  values.t45_close_location_45s =
    totalRange > 0 ? (close45 - Math.min(...lows)) / totalRange : null;
  values.t45_path_efficiency_45s =
    path > 0 ? Math.abs(Math.log(close45 / baseOpen)) / path : 0;
  values.t45_realized_vol_45s_bps =
    Math.sqrt(rets.reduce((a, r) => a + r * r, 0)) * 10_000;

  const meanX = (T45_EXPECTED_SECONDS - 1) / 2;
  const meanLog = logClose.reduce((a, b) => a + b, 0) / logClose.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < logClose.length; i++) {
    const x = i - meanX;
    num += x * (logClose[i] - meanLog);
    den += x * x;
  }
  values.t45_log_price_slope_bps_per_s = (num / den) * 10_000;

  const nonzero = rets.map(sign).filter((s) => s !== 0);
  values.t45_return_sign_persistence = nonzero.length
    ? Math.abs(nonzero.reduce((a, b) => a + b, 0) / nonzero.length)
    : 0;
  let changes = 0;
  for (let i = 1; i < nonzero.length; i++) if (nonzero[i] !== nonzero[i - 1]) changes++;
  values.t45_return_sign_changes = nonzero.length > 1 ? changes : 0;

  values.t45_last15_ret_bps = Math.log(closes[44] / closes[29]) * 10_000;
  values.t45_last30_ret_bps = Math.log(closes[44] / closes[14]) * 10_000;
  values.t45_return_accel_15_45_bps =
    (values.t45_ret_45s_bps as number) - (values.t45_ret_15s_bps as number);

  const qTotal = qvol.reduce((a, b) => a + b, 0);
  const cTotal = counts.reduce((a, b) => a + b, 0);
  const qLast15 = qvol.slice(-15).reduce((a, b) => a + b, 0);
  const cLast15 = counts.slice(-15).reduce((a, b) => a + b, 0);
  values.t45_quote_volume_last15_share = qTotal > 0 ? qLast15 / qTotal : null;
  values.t45_trade_count_last15_share = cTotal > 0 ? cLast15 / cTotal : null;

  const volTotal = vol.reduce((a, b) => a + b, 0);
  const vwap = volTotal > 0 ? qTotal / volTotal : NaN;
  values.t45_close_vwap_gap_bps =
    Number.isFinite(vwap) && vwap > 0 ? Math.log(close45 / vwap) * 10_000 : null;

  const partial = sign(close45 - baseOpen);
  values.t45_partial_direction = partial;
  const flow45 = values.t45_quote_flow_45s;
  values.t45_price_flow_alignment = flow45 == null ? null : partial * sign(flow45);
  values.t45_path_direction_consistency =
    partial !== 0
      ? closes.filter((c) => sign(c - baseOpen) === partial).length / closes.length
      : 0;

  values.t45_log_quote_volume_45s = Math.log1p(Math.max(0, qTotal));
  values.t45_log_trade_count_45s = Math.log1p(Math.max(0, cTotal));

  if (r2Prior == null || !Number.isFinite(r2Prior)) {
    values.t45_r2_prediction = null;
    values.t45_r2_would_trade = null;
    values.t45_r2_partial_agreement = null;
    values.t45_r2_ret45_interaction = null;
  } else {
    const p = Math.trunc(r2Prior);
    const ret45 = values.t45_ret_45s_bps as number;
    values.t45_r2_prediction = p;
    values.t45_r2_would_trade = p !== 0 ? 1 : 0;
    values.t45_r2_partial_agreement = p * sign(Number.isFinite(ret45) ? ret45 : 0);
    values.t45_r2_ret45_interaction = p * ret45;
  }

  const vector: number[] = [];
  let ok = true;
  for (const name of T45_FEATURE_ORDER) {
    const v = values[name];
    if (v == null || !Number.isFinite(v)) {
      ok = false;
      break;
    }
    vector.push(v);
  }

  // Normalise NaN leakage before persistence.
  for (const k of Object.keys(values)) {
    const v = values[k];
    if (typeof v === "number") values[k] = finite(v);
  }

  return {
    values,
    secondsPresent: sorted.length,
    spotComplete: true,
    featureComplete: ok,
    invalidReason: ok ? null : r2Prior == null ? "R2_PRIOR_MISSING" : "NON_FINITE_FEATURE",
    vector: ok ? vector : null,
  };
}
