// Pure Model 6 routing telemetry (v1). No side effects, no randomness.
// Enriches the persisted `indicators` blob so downstream CSV exports carry
// the routing context A3.2 / A3.3 need without a schema migration.
import type { Candle } from "../indicators";
import { ema } from "../indicators";

export interface TelemetryV1 {
  version: "1.0.0";
  // Channel
  channel_low: number;
  channel_high: number;
  channel_width_pct: number;
  channel_position_numeric: number; // 0..1
  channel_position: "lower" | "lower_mid" | "middle" | "upper_mid" | "upper";
  channel_fib_zone:
    | "breakdown" | "support_edge" | "lower_mid" | "true_mid"
    | "upper_mid" | "resistance_edge" | "breakout";
  distance_to_upper_channel_pct: number;
  distance_to_lower_channel_pct: number;
  // Trend
  trend_direction: "UP" | "DOWN" | "MIXED";
  trend_strength: number; // 0..100
  trend_slope: number;    // slope of last 8 closes, normalized by avg_range_20
  trend_age_candles: number;
  distance_from_fast_ema: number; // pct
  distance_from_slow_ema: number; // pct
  // Sub-scores (0..100)
  trend_score: number;
  ema_score: number;
  momentum_score: number;
  volatility_score: number;
  structure_score: number;
  // Regime
  market_regime_score: number; // 0..100
  // Snapshot inputs (for auditability)
  ema9: number;
  ema21: number;
  ema50: number;
  atr_14: number;
  avg_range_20: number;
  close: number;
  volume_expansion: number;
  same_color_streak: number;
  higher_low_sequence: boolean;
  lower_high_sequence: boolean;
  failed_breakout_up: boolean;
  failed_breakout_down: boolean;
  bullish_liquidity_sweep: boolean;
  bearish_liquidity_sweep: boolean;
}

const clamp = (v: number, lo = 0, hi = 100) => Math.max(lo, Math.min(hi, v));
const round = (v: number, d = 4) => {
  const f = Math.pow(10, d);
  return Number.isFinite(v) ? Math.round(v * f) / f : 0;
};

export function buildTelemetryV1(candles: Candle[]): TelemetryV1 | null {
  if (!candles || candles.length < 30) return null;
  const n = candles.length;
  const last = candles[n - 1];
  const prev = candles[n - 2];
  const closes = candles.map((c) => c.close);
  const e9s = ema(closes, 9);
  const e21s = ema(closes, 21);
  const e50s = ema(closes, 50);
  const e9 = e9s[e9s.length - 1];
  const e21 = e21s[e21s.length - 1];
  const e50 = e50s[e50s.length - 1];

  const win20 = candles.slice(-20);
  const win14 = candles.slice(-14);
  const avg_range_20 = win20.reduce((s, c) => s + (c.high - c.low), 0) / win20.length;
  const atr_14 = win14.reduce((s, c) => s + (c.high - c.low), 0) / win14.length;

  // Channel = 20-bar high/low
  const channel_high = Math.max(...win20.map((c) => c.high));
  const channel_low = Math.min(...win20.map((c) => c.low));
  const width = Math.max(channel_high - channel_low, 1e-9);
  const pos = clamp((last.close - channel_low) / width, 0, 1);
  const channel_position =
    pos < 0.2 ? "lower"
    : pos < 0.4 ? "lower_mid"
    : pos < 0.6 ? "middle"
    : pos < 0.8 ? "upper_mid"
    : "upper";
  const channel_fib_zone: TelemetryV1["channel_fib_zone"] =
    pos < 0 ? "breakdown"
    : pos <= 0.236 ? "support_edge"
    : pos <= 0.382 ? "lower_mid"
    : pos <= 0.618 ? "true_mid"
    : pos <= 0.786 ? "upper_mid"
    : pos <= 1.0 ? "resistance_edge"
    : "breakout";
  const channel_width_pct = (width / Math.max(last.close, 1e-9)) * 100;
  const distance_to_upper_channel_pct = ((channel_high - last.close) / Math.max(last.close, 1e-9)) * 100;
  const distance_to_lower_channel_pct = ((last.close - channel_low) / Math.max(last.close, 1e-9)) * 100;

  // Trend
  const trend_direction: TelemetryV1["trend_direction"] =
    e9 > e21 && e21 > e50 ? "UP"
    : e9 < e21 && e21 < e50 ? "DOWN"
    : "MIXED";

  // EMA separation normalized by ATR → 0..100
  const emaSpread = (Math.abs(e9 - e21) + Math.abs(e21 - e50)) / Math.max(atr_14, 1e-9);
  const ema_score = clamp(emaSpread * 25); // ~4 ATR spread = 100

  // Same-color streak (ending at last)
  let same_color_streak = 0;
  const lastGreen = last.close > last.open;
  const lastRed = last.close < last.open;
  if (lastGreen || lastRed) {
    for (let i = n - 1; i >= 0; i--) {
      const g = candles[i].close > candles[i].open;
      const r = candles[i].close < candles[i].open;
      if ((lastGreen && g) || (lastRed && r)) same_color_streak++;
      else break;
    }
  }

  // Slope of last 8 closes (simple linear regression), normalized by avg_range_20
  const N = Math.min(8, n);
  const tail = closes.slice(-N);
  const xMean = (N - 1) / 2;
  const yMean = tail.reduce((s, y) => s + y, 0) / N;
  let num = 0, den = 0;
  for (let i = 0; i < N; i++) {
    num += (i - xMean) * (tail[i] - yMean);
    den += (i - xMean) ** 2;
  }
  const slopeRaw = den > 0 ? num / den : 0;
  const trend_slope = slopeRaw / Math.max(avg_range_20, 1e-9);

  // Momentum score: |last_8_close_change| relative to ATR
  const last8Change = n >= 9 ? (last.close - candles[n - 9].close) : 0;
  const momentum_score = clamp((Math.abs(last8Change) / Math.max(atr_14, 1e-9)) * 25);

  // Structure sequences (last 4)
  const t4 = candles.slice(-4);
  let higher_low_sequence = t4.length === 4, lower_high_sequence = t4.length === 4;
  for (let i = 1; i < t4.length; i++) {
    if (!(t4[i].low > t4[i - 1].low)) higher_low_sequence = false;
    if (!(t4[i].high < t4[i - 1].high)) lower_high_sequence = false;
  }

  // Trend age: walk back while sign(ema9-ema21) matches
  const sign = Math.sign(e9 - e21);
  let trend_age_candles = 0;
  for (let i = e9s.length - 1; i >= 0; i--) {
    if (Math.sign(e9s[i] - e21s[i]) === sign && sign !== 0) trend_age_candles++;
    else break;
  }

  // Trend score: composite EMA + momentum + streak, only if aligned
  const streakScore = clamp(same_color_streak * 15);
  const aligned = trend_direction !== "MIXED";
  const trend_score = aligned
    ? clamp(0.5 * ema_score + 0.3 * momentum_score + 0.2 * streakScore)
    : clamp(0.3 * ema_score + 0.3 * momentum_score); // still register some strength if EMAs slightly aligned
  const trend_strength = trend_score;

  // Volatility score: ATR expansion vs avg_range_20 (compressed→low, healthy→high, extreme→drop)
  const lastRange = Math.max(last.high - last.low, 1e-9);
  const expansion = lastRange / Math.max(avg_range_20, 1e-9);
  const volatility_score = clamp(
    expansion < 0.5 ? 20
    : expansion < 1.0 ? 40 + (expansion - 0.5) * 80   // 40..80
    : expansion < 1.5 ? 80 + (1.5 - expansion) * 20   // 80..70
    : expansion < 2.0 ? 60 - (expansion - 1.5) * 40   // 60..40
    : 30
  );

  // Structure score: HL/LH + wick discipline of last candle
  const body = Math.abs(last.close - last.open);
  const bodyPct = body / lastRange;
  const upperWickPct = (last.high - Math.max(last.open, last.close)) / lastRange;
  const lowerWickPct = (Math.min(last.open, last.close) - last.low) / lastRange;
  const wickDiscipline =
    trend_direction === "UP" ? (1 - upperWickPct) * 100
    : trend_direction === "DOWN" ? (1 - lowerWickPct) * 100
    : (1 - Math.max(upperWickPct, lowerWickPct)) * 100;
  const seqBonus = (higher_low_sequence && trend_direction === "UP") ? 100
    : (lower_high_sequence && trend_direction === "DOWN") ? 100
    : 50;
  const structure_score = clamp(0.5 * seqBonus + 0.3 * wickDiscipline + 0.2 * (bodyPct * 100));

  // Regime score: trend clarity × persistence × wick discipline × non-extreme ATR
  const persistence = clamp(trend_age_candles * 10);
  const regimeParts =
    0.35 * (aligned ? trend_score : trend_score * 0.5)
    + 0.20 * persistence
    + 0.20 * wickDiscipline
    + 0.15 * volatility_score
    + 0.10 * structure_score;
  const market_regime_score = clamp(regimeParts);

  // Countertrend evidence (0..100)
  const prevHigh = prev?.high ?? last.high;
  const prevLow = prev?.low ?? last.low;
  const priorHigh = Math.max(...candles.slice(-21, -1).map((c) => c.high));
  const priorLow = Math.min(...candles.slice(-21, -1).map((c) => c.low));
  const failed_breakout_up = last.high > priorHigh && last.close < priorHigh;
  const failed_breakout_down = last.low < priorLow && last.close > priorLow;
  const bullish_liquidity_sweep = last.low < prevLow && last.close > prevLow && last.close > (prev?.close ?? last.close);
  const bearish_liquidity_sweep = last.high > prevHigh && last.close < prevHigh && last.close < (prev?.close ?? last.close);

  // Volume expansion
  const volAvg = win20.reduce((s, c) => s + c.volume, 0) / win20.length;
  const volume_expansion = volAvg > 0 ? last.volume / volAvg : 0;

  // EMA distances (%)
  const distance_from_fast_ema = ((last.close - e9) / Math.max(last.close, 1e-9)) * 100;
  const distance_from_slow_ema = ((last.close - e50) / Math.max(last.close, 1e-9)) * 100;

  return {
    version: "1.0.0",
    channel_low: round(channel_low, 4),
    channel_high: round(channel_high, 4),
    channel_width_pct: round(channel_width_pct, 4),
    channel_position_numeric: round(pos, 4),
    channel_position,
    channel_fib_zone,
    distance_to_upper_channel_pct: round(distance_to_upper_channel_pct, 4),
    distance_to_lower_channel_pct: round(distance_to_lower_channel_pct, 4),
    trend_direction,
    trend_strength: round(trend_strength, 2),
    trend_slope: round(trend_slope, 6),
    trend_age_candles,
    distance_from_fast_ema: round(distance_from_fast_ema, 4),
    distance_from_slow_ema: round(distance_from_slow_ema, 4),
    trend_score: round(trend_score, 2),
    ema_score: round(ema_score, 2),
    momentum_score: round(momentum_score, 2),
    volatility_score: round(volatility_score, 2),
    structure_score: round(structure_score, 2),
    market_regime_score: round(market_regime_score, 2),
    ema9: round(e9, 4),
    ema21: round(e21, 4),
    ema50: round(e50, 4),
    atr_14: round(atr_14, 4),
    avg_range_20: round(avg_range_20, 4),
    close: round(last.close, 4),
    volume_expansion: round(volume_expansion, 3),
    same_color_streak,
    higher_low_sequence,
    lower_high_sequence,
    failed_breakout_up,
    failed_breakout_down,
    bullish_liquidity_sweep,
    bearish_liquidity_sweep,
  };
}
