// T10 Bridge — current-packet feature builder (pure).
//
// Every formula here is frozen by the T10 Bridge R1 specification and uses
// ONLY offsets 0..9 of the target candle. All values are persisted unrounded.

import { T10_PACKET_FEATURE_ORDER, type T10Direction } from "./config";
import type { T10SecondBar } from "./packet";

export type T10FeatureMap = Record<string, number>;

const BPS = 10_000;

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);
const sign = (x: number) => (x > 0 ? 1 : x < 0 ? -1 : 0);

function quoteFlow(bars: readonly T10SecondBar[]): number {
  const total = sum(bars.map((b) => b.quote_volume));
  const taker = sum(bars.map((b) => b.taker_buy_quote_volume));
  return total > 0 ? (2 * taker) / total - 1 : 0;
}

/** Base direction of the first ten seconds. Flat always abstains upstream. */
export function t10BaseDirection(bars: readonly T10SecondBar[]): {
  ret10Bps: number;
  direction: T10Direction;
} {
  const open0 = bars[0].open;
  const close9 = bars[bars.length - 1].close;
  const ret10Bps = Math.log(close9 / open0) * BPS;
  return { ret10Bps, direction: ret10Bps > 0 ? 1 : ret10Bps < 0 ? -1 : 0 };
}

export interface T10PacketFeatureResult {
  values: T10FeatureMap;
  direction: T10Direction;
  ret10Bps: number;
  valid: boolean;
}

/** Build the 29 frozen current-packet features from an exact 0..9 packet. */
export function buildT10PacketFeatures(
  bars: readonly T10SecondBar[],
): T10PacketFeatureResult {
  const first5 = bars.slice(0, 5);
  const last5 = bars.slice(5, 10);
  const open0 = bars[0].open;
  const close4 = bars[4].close;
  const close6 = bars[6].close;
  const close9 = bars[9].close;

  const { ret10Bps, direction: d } = t10BaseDirection(bars);
  const ret5Bps = Math.log(close4 / open0) * BPS;
  const last5RetBps = Math.log(close9 / close4) * BPS;
  const last3RetBps = Math.log(close9 / close6) * BPS;

  const high5 = Math.max(...first5.map((b) => b.high));
  const low5 = Math.min(...first5.map((b) => b.low));
  const high10 = Math.max(...bars.map((b) => b.high));
  const low10 = Math.min(...bars.map((b) => b.low));
  const range5Bps = ((high5 - low5) / open0) * BPS;
  const range10Bps = ((high10 - low10) / open0) * BPS;
  const tenSecondRange = high10 - low10;

  const flow5 = quoteFlow(first5);
  const flow10 = quoteFlow(bars);
  const flowLast5 = quoteFlow(last5);

  const qvol5 = sum(first5.map((b) => b.quote_volume));
  const qvol10 = sum(bars.map((b) => b.quote_volume));
  const qvolLast5 = sum(last5.map((b) => b.quote_volume));
  const trades5 = sum(first5.map((b) => b.trade_count));
  const trades10 = sum(bars.map((b) => b.trade_count));
  const tradesLast5 = sum(last5.map((b) => b.trade_count));

  // One-second log returns across the packet (close-to-close, seeded at open0).
  const closes = bars.map((b) => b.close);
  const logRets: number[] = [];
  let prev = open0;
  for (const c of closes) {
    logRets.push(Math.log(c / prev));
    prev = c;
  }
  const absPath = sum(logRets.map((r) => Math.abs(r)));
  const pathEfficiency = absPath > 0 ? Math.abs(Math.log(close9 / open0)) / absPath : 0;
  const realizedVol = Math.sqrt(sum(logRets.map((r) => r * r))) * BPS;

  // OLS slope of log closes over offsets 0..9 (x = 0..9).
  const logCloses = closes.map((c) => Math.log(c));
  const n = logCloses.length;
  const meanX = (n - 1) / 2;
  const meanY = sum(logCloses) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (i - meanX) * (logCloses[i] - meanY);
    den += (i - meanX) * (i - meanX);
  }
  const slope = den > 0 ? num / den : 0;

  const nonzeroSigns = logRets.map(sign).filter((s) => s !== 0);
  const signPersistence =
    nonzeroSigns.length > 0 ? Math.abs(sum(nonzeroSigns) / nonzeroSigns.length) : 0;
  let signChanges = 0;
  for (let i = 1; i < nonzeroSigns.length; i++) {
    if (nonzeroSigns[i] !== nonzeroSigns[i - 1]) signChanges += 1;
  }

  const typical = bars.map((b) => (b.high + b.low + b.close) / 3);
  const volSum = sum(bars.map((b) => b.volume));
  const vwap =
    volSum > 0 ? sum(bars.map((b, i) => typical[i] * b.volume)) / volSum : sum(typical) / n;
  const vwapGapBps = vwap > 0 ? Math.log(close9 / vwap) * BPS : 0;

  const closeLocation =
    tenSecondRange > 0 ? (close9 - low10) / tenSecondRange : 0.5;
  const directionalCloseLocation = d >= 0 ? closeLocation : 1 - closeLocation;

  const displacementShare =
    closes.filter((c) => sign(c - open0) === d).length / n;

  const values: T10FeatureMap = {
    aligned_ret5: d * ret5Bps,
    aligned_ret10: d * ret10Bps,
    aligned_last5: d * last5RetBps,
    aligned_last3: d * last3RetBps,
    aligned_acceleration5_10: d * (ret10Bps - 2 * ret5Bps),
    aligned_flow5: d * flow5,
    aligned_flow10: d * flow10,
    aligned_flow_last5: d * flowLast5,
    aligned_flow_delta5_10: d * (flowLast5 - flow5),
    t10_range_5s_bps: range5Bps,
    t10_range_10s_bps: range10Bps,
    log_qvol5: Math.log1p(Math.max(qvol5, 0)),
    log_qvol10: Math.log1p(Math.max(qvol10, 0)),
    log_trades5: Math.log1p(Math.max(trades5, 0)),
    log_trades10: Math.log1p(Math.max(trades10, 0)),
    t10_quote_volume_last5_share: qvol10 > 0 ? qvolLast5 / qvol10 : 0,
    t10_trade_count_last5_share: trades10 > 0 ? tradesLast5 / trades10 : 0,
    range_growth5_10: Math.log1p(Math.max(range10Bps, 0)) - Math.log1p(Math.max(range5Bps, 0)),
    five_direction_agreement: sign(ret5Bps) === d ? 1 : 0,
    price_flow_alignment10: d * sign(flow10),
    body_range10: tenSecondRange > 0 ? d * ((close9 - open0) / tenSecondRange) : 0,
    directional_close_location10: directionalCloseLocation,
    t10_path_efficiency_10s: pathEfficiency,
    t10_realized_vol_10s_bps: realizedVol,
    aligned_price_slope10: d * slope * BPS,
    t10_return_sign_persistence: signPersistence,
    t10_return_sign_changes: signChanges,
    aligned_vwap_gap10: d * vwapGapBps,
    t10_path_direction_consistency: displacementShare,
  };

  const valid = T10_PACKET_FEATURE_ORDER.every((k) => Number.isFinite(values[k]));
  return { values, direction: d, ret10Bps, valid };
}

/** Extra diagnostics persisted alongside the model vector. */
export function t10PacketDiagnostics(bars: readonly T10SecondBar[]): T10FeatureMap {
  return {
    t10_open_0: bars[0].open,
    t10_close_9: bars[9].close,
    t10_quote_volume_10s: sum(bars.map((b) => b.quote_volume)),
    t10_trade_count_10s: sum(bars.map((b) => b.trade_count)),
    t10_seconds_count: bars.length,
  };
}
