// Cross89 — prediction-time 89-feature builder (pure).

import {
  T30X_EXPECTED_OBSERVATIONS,
  T30X_FEATURE_ORDER,
  type T30XDirection,
} from "./config";
import type { TechValues } from "./technicals";

export interface X89SecondBar {
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

export type X89FeatureMap = Record<string, number | null>;

export interface PacketWindow {
  ret: number;
  range: number;
  quoteVolume: number;
  tradeCount: number;
  flow: number | null;
}

export interface X89PacketStats {
  complete: boolean;
  invalidReason: string | null;
  open: number;
  close30: number;
  windows: Record<number, PacketWindow>;
}

const sign = (v: number): number => (v > 0 ? 1 : v < 0 ? -1 : 0);
const fin = (v: number | null | undefined): number | null =>
  typeof v === "number" && Number.isFinite(v) ? v : null;
/** Ratio helper: a zero denominator yields null, never zero. */
const ratio = (num: number, den: number): number | null =>
  den === 0 || !Number.isFinite(den) ? null : fin(num / den);

const WINDOWS = [5, 15, 30] as const;

export function buildPacketStats(bars: readonly X89SecondBar[]): X89PacketStats {
  const sorted = [...bars].sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  const empty: X89PacketStats = {
    complete: false,
    invalidReason: "INCOMPLETE_SECOND_BARS",
    open: NaN,
    close30: NaN,
    windows: {},
  };
  if (
    sorted.length !== T30X_EXPECTED_OBSERVATIONS ||
    sorted.some((b, i) => b.offsetSeconds !== i)
  ) {
    return empty;
  }
  const open = sorted[0].open;
  if (!Number.isFinite(open) || open <= 0) return { ...empty, invalidReason: "INVALID_BASE_OPEN" };

  const windows: Record<number, PacketWindow> = {};
  for (const w of WINDOWS) {
    const slice = sorted.slice(0, w);
    const q = slice.reduce((a, b) => a + b.quoteVolume, 0);
    const bq = slice.reduce((a, b) => a + b.takerBuyQuoteVolume, 0);
    const hi = Math.max(...slice.map((b) => b.high));
    const lo = Math.min(...slice.map((b) => b.low));
    windows[w] = {
      ret: Math.log(slice[slice.length - 1].close / open) * 10_000,
      range: ((hi - lo) / open) * 10_000,
      quoteVolume: q,
      tradeCount: slice.reduce((a, b) => a + b.tradeCount, 0),
      flow: q > 0 ? (2 * bq) / q - 1 : null,
    };
  }
  return {
    complete: true,
    invalidReason: null,
    open,
    close30: sorted[T30X_EXPECTED_OBSERVATIONS - 1].close,
    windows,
  };
}

/** Sign of the first-30-second Binance Spot move. 0 means abstain. */
export function baseDirectionOf(stats: X89PacketStats): T30XDirection {
  const r = stats.windows[30]?.ret;
  if (typeof r !== "number" || !Number.isFinite(r)) return 0;
  return r > 0 ? 1 : r < 0 ? -1 : 0;
}

export interface X89Inputs {
  targetTs: string;
  packet: X89PacketStats;
  direction: T30XDirection;
  spot: TechValues;
  fut: TechValues;
  /** basisBps of the previous completed candle pair. */
  prevBasisBps: number;
}

export interface X89Result {
  values: X89FeatureMap;
  vector: number[] | null;
  invalidFeature: string | null;
}

function techBlock(
  t: TechValues,
  d: number,
  prefixAligned: string,
  plain: (k: string) => string,
): X89FeatureMap {
  const v: X89FeatureMap = {};
  const a = (k: string, val: number | null) => {
    v[`${prefixAligned}${k}`] = val;
  };
  a("ret1", fin(d * t.ret1));
  a("ret4", fin(d * t.ret4));
  a("ret8", fin(d * t.ret8));
  a("ret16", fin(d * t.ret16));
  a("body_atr", fin(d * t.bodyAtr));
  a("wick_balance", fin(d * t.wickBalance));
  a("ema9_21_atr", fin(d * t.ema9_21_atr));
  a("macd_hist_atr", fin(d * t.macdHistAtr));
  a("rsi_centered", fin(d * t.rsiCentered));
  a("stoch_centered", fin(d * t.stochCentered));
  a("di_spread", fin(d * t.diSpread));
  a("bb_position", fin(d * t.bbPosition));
  a("taker_flow1", fin(d * t.takerFlow1));
  a("taker_flow4", fin(d * t.takerFlow4));
  a("taker_flow8", fin(d * t.takerFlow8));
  a("taker_flow_delta", fin(d * t.takerFlowDelta));
  a("trend_signed_age", fin(d * t.trendSignedAge));
  a("failed_breakout", fin(d * t.failedBreakout));
  v[plain("directional_wick_threat")] = fin(d > 0 ? t.upperWickFrac : t.lowerWickFrac);
  v[plain("directional_wick_support")] = fin(d > 0 ? t.lowerWickFrac : t.upperWickFrac);
  v[plain("efficiency8")] = fin(t.efficiency8);
  v[plain("adx14")] = fin(t.adx14);
  v[plain("range_atr")] = fin(t.rangeAtr);
  v[plain("atr_ratio4_14")] = fin(t.atrRatio4_14);
  v[plain("vol_ratio4_16")] = fin(t.volRatio4_16);
  v[plain("bb_width")] = fin(t.bbWidth);
  v[plain("volume_z20")] = fin(t.volumeZ20);
  v[plain("trade_count_z20")] = fin(t.tradeCountZ20);
  v[plain("sign_persistence8")] = fin(t.signPersistence8);
  v[plain("sign_changes8")] = fin(t.signChanges8);
  return v;
}

export function buildCross89Features(input: X89Inputs): X89Result {
  const { packet, spot, fut } = input;
  const d = input.direction;
  const w5 = packet.windows[5];
  const w15 = packet.windows[15];
  const w30 = packet.windows[30];
  const values: X89FeatureMap = {};

  // A. current-candle price flow (24)
  values["aligned_ret5"] = fin(d * w5.ret);
  values["aligned_ret15"] = fin(d * w15.ret);
  values["aligned_ret30"] = fin(d * w30.ret);
  values["aligned_last15"] = fin(d * (w30.ret - w15.ret));
  values["aligned_acceleration"] = fin(d * (w30.ret - 2 * w15.ret));
  values["aligned_flow5"] = w5.flow == null ? null : fin(d * w5.flow);
  values["aligned_flow15"] = w15.flow == null ? null : fin(d * w15.flow);
  values["aligned_flow30"] = w30.flow == null ? null : fin(d * w30.flow);
  values["flow_delta15_30"] =
    w15.flow == null || w30.flow == null ? null : fin(d * (w30.flow - w15.flow));
  values["range_5s_bps"] = fin(w5.range);
  values["range_15s_bps"] = fin(w15.range);
  values["range_30s_bps"] = fin(w30.range);
  values["log_qvol5"] = fin(Math.log1p(Math.max(w5.quoteVolume, 0)));
  values["log_qvol15"] = fin(Math.log1p(Math.max(w15.quoteVolume, 0)));
  values["log_qvol30"] = fin(Math.log1p(Math.max(w30.quoteVolume, 0)));
  values["log_trades5"] = fin(Math.log1p(Math.max(w5.tradeCount, 0)));
  values["log_trades15"] = fin(Math.log1p(Math.max(w15.tradeCount, 0)));
  values["log_trades30"] = fin(Math.log1p(Math.max(w30.tradeCount, 0)));
  values["qvol_last15_share"] = ratio(w30.quoteVolume - w15.quoteVolume, w30.quoteVolume);
  values["trades_last15_share"] = ratio(w30.tradeCount - w15.tradeCount, w30.tradeCount);
  values["range_growth15_30"] = ratio(w30.range, w15.range);
  values["early_direction_agreement"] = sign(w15.ret) === d ? 1 : 0;
  values["five_direction_agreement"] = sign(w5.ret) === d ? 1 : 0;
  values["price_flow_alignment30"] = w30.flow == null ? null : d * sign(w30.flow);

  // B. prior completed Binance Spot technicals (30)
  Object.assign(values, techBlock(spot, d, "aligned_", (k) => k));

  // C. prior completed Binance USD-M perpetual technicals (35)
  Object.assign(
    values,
    techBlock(fut, d, "aligned_fut_", (k) =>
      k === "directional_wick_threat" || k === "directional_wick_support"
        ? `fut_${k}`
        : `fut_${k}`,
    ),
  );

  const basisBps = Math.log(fut.close / spot.close) * 10_000;
  values["aligned_basis_bps"] = fin(d * basisBps);
  values["aligned_basis_delta1"] = fin(d * (basisBps - input.prevBasisBps));
  values["spot_fut_flow_agreement"] =
    sign(spot.quoteFlow) === 0 || sign(fut.quoteFlow) === 0
      ? 0
      : sign(spot.quoteFlow) === sign(fut.quoteFlow)
        ? 1
        : -1;

  const dt = new Date(input.targetTs);
  const hour = dt.getUTCHours() + dt.getUTCMinutes() / 60;
  values["session_sin"] = Math.sin((2 * Math.PI * hour) / 24);
  values["session_cos"] = Math.cos((2 * Math.PI * hour) / 24);

  // Diagnostics (never model inputs).
  values["raw_ret5_bps"] = fin(w5.ret);
  values["raw_ret15_bps"] = fin(w15.ret);
  values["raw_ret30_bps"] = fin(w30.ret);
  values["spot_open"] = fin(packet.open);
  values["spot_close30"] = fin(packet.close30);
  values["quote_volume30"] = fin(w30.quoteVolume);
  values["trade_count30"] = fin(w30.tradeCount);
  values["base_direction_num"] = d;
  values["seconds_count"] = T30X_EXPECTED_OBSERVATIONS;

  const vector: number[] = [];
  let invalidFeature: string | null = null;
  for (const name of T30X_FEATURE_ORDER) {
    const v = values[name];
    if (typeof v !== "number" || !Number.isFinite(v)) {
      invalidFeature = invalidFeature ?? name;
      break;
    }
    vector.push(v);
  }

  return { values, vector: invalidFeature ? null : vector, invalidFeature };
}
