// Pure scoring engine. Given Features -> {bull, bear, margin, module_points}.
import type { Features } from "./featureEngine";
import { MODULE_WEIGHTS, PARTIAL_COMPLETENESS_FULL, PARTIAL_COMPLETENESS_MID,
  EXPANSION_EXPANDING, EXPANSION_STRONG, EXPANSION_EXHAUSTION,
  EXTENDED_ATR_MULT, STRONG_BODY, WICK_35, WICK_50, CLOSE_UPPER_35, CLOSE_LOWER_35 } from "./config";

export interface ModulePoints { bull: number; bear: number }
export type ModuleName = keyof typeof MODULE_WEIGHTS;

export interface Scores {
  bull: number; bear: number; margin: number;
  dominant: "YES" | "NO" | "NONE";
  module_points: Record<ModuleName, ModulePoints>;
}

type RuleList = Array<[boolean, number]>;

function tallyCapped(rules: RuleList, weight: number, takeHighest = false): number {
  if (takeHighest) {
    let best = 0;
    for (const [cond, pts] of rules) if (cond && pts > best) best = pts;
    return Math.min(best, weight);
  }
  let s = 0;
  for (const [cond, pts] of rules) if (cond) s += pts;
  return Math.min(s, weight);
}

export function scoreCandle(f: Features): Scores {
  const l = f.last, p = f.prev;
  const prevMid = p ? (p.open + p.close) / 2 : l.close;

  const mp: Record<ModuleName, ModulePoints> = {
    failed_breakout_rejection_zones: { bull: 0, bear: 0 },
    last_8_candle_momentum: { bull: 0, bear: 0 },
    completed_candle_structure: { bull: 0, bear: 0 },
    partial_candle_confirmation: { bull: 0, bear: 0 },
    vwap_state: { bull: 0, bear: 0 },
    fib_channel_position: { bull: 0, bear: 0 },
    atr_range_expansion: { bull: 0, bear: 0 },
    support_resistance_proximity: { bull: 0, bear: 0 },
    liquidity_sweep_reclaim: { bull: 0, bear: 0 },
    reclaim_breakdown_behavior: { bull: 0, bear: 0 },
    wick_rejection_defense: { bull: 0, bear: 0 },
    candle_close_location: { bull: 0, bear: 0 },
    market_structure_regime_filter: { bull: 0, bear: 0 },
    bearish_exhaustion_downside_failure: { bull: 0, bear: 0 },
    volume: { bull: 0, bear: 0 },
  };

  // 1. failed_breakout_rejection_zones (13)
  mp.failed_breakout_rejection_zones.bull = tallyCapped([
    [f.failed_breakout_down, 5],
    [f.channel_support_bounce, 3.5],
    [f.bullish_liquidity_sweep, 2.5],
    [l.lower_wick_pct >= WICK_35 && l.close_position_pct >= 0.5, 1.5],
    [f.near_support && l.close > f.range20_low, 0.5],
  ], MODULE_WEIGHTS.failed_breakout_rejection_zones);
  mp.failed_breakout_rejection_zones.bear = tallyCapped([
    [f.failed_breakout_up, 5],
    [f.channel_resistance_rejection, 3.5],
    [f.bearish_liquidity_sweep, 2.5],
    [l.upper_wick_pct >= WICK_35 && l.close_position_pct <= 0.5, 1.5],
    [f.near_resistance && l.close < f.range20_high, 0.5],
  ], MODULE_WEIGHTS.failed_breakout_rejection_zones);

  // 2. last_8_candle_momentum (11)
  const streakGreen = f.streak_color === "green" && f.consecutive_same_color_streak >= 3;
  const streakRed = f.streak_color === "red" && f.consecutive_same_color_streak >= 3;
  mp.last_8_candle_momentum.bull = tallyCapped([
    [f.last_8_positive, 4],
    [f.last_3_positive, 2.5],
    [f.higher_low_sequence, 2.5],
    [streakGreen && l.close_position_pct >= 0.5, 2],
  ], MODULE_WEIGHTS.last_8_candle_momentum);
  mp.last_8_candle_momentum.bear = tallyCapped([
    [f.last_8_negative, 4],
    [f.last_3_negative, 2.5],
    [f.lower_high_sequence, 2.5],
    [streakRed && l.close_position_pct <= 0.5, 2],
  ], MODULE_WEIGHTS.last_8_candle_momentum);

  // 3. completed_candle_structure (10)
  mp.completed_candle_structure.bull = tallyCapped([
    [l.green, 1.5],
    [l.strong_body && l.green, 2],
    [l.close_position_pct >= CLOSE_UPPER_35, 2.5],
    [l.lower_wick_pct >= WICK_35, 2],
    [l.close > prevMid, 2],
  ], MODULE_WEIGHTS.completed_candle_structure);
  mp.completed_candle_structure.bear = tallyCapped([
    [l.red, 1.5],
    [l.strong_body && l.red, 2],
    [l.close_position_pct <= CLOSE_LOWER_35, 2.5],
    [l.upper_wick_pct >= WICK_35, 2],
    [l.close < prevMid, 2],
  ], MODULE_WEIGHTS.completed_candle_structure);

  // 4. partial_candle_confirmation (10) — take_highest + completeness multiplier + exhaustion halving
  const pc = f.partial;
  const mult =
    !pc.present || pc.degraded_mode ? 0
    : pc.completeness >= PARTIAL_COMPLETENESS_FULL ? 1.0
    : pc.completeness >= PARTIAL_COMPLETENESS_MID ? 0.6
    : 0.3;
  const partialExhaust =
    pc.present && pc.range_vs_atr != null && pc.range_vs_atr >= 1.5
    && f.vwap != null && Math.abs(l.close - f.vwap) >= EXTENDED_ATR_MULT * f.atr_14;
  const cp = pc.close_position_pct ?? 0.5;
  const rva = pc.range_vs_atr ?? 0;
  const pbull: RuleList = pc.present ? [
    [pc.direction === "green" && cp >= CLOSE_UPPER_35 && rva >= 0.5, 10],
    [pc.vwap_event === "reclaim" && cp >= 0.55, 7.5],
    [pc.direction === "green" && cp >= 0.5, 5.5],
    [pc.direction === "red" && (pc.lower_wick_pct ?? 0) >= WICK_50 && cp >= 0.5, 4],
  ] : [];
  const pbear: RuleList = pc.present ? [
    [pc.direction === "red" && cp <= CLOSE_LOWER_35 && rva >= 0.5, 10],
    [pc.vwap_event === "loss" && cp <= 0.45, 7.5],
    [pc.direction === "red" && cp <= 0.5, 5.5],
    [pc.direction === "green" && (pc.upper_wick_pct ?? 0) >= WICK_50 && cp <= 0.5, 4],
  ] : [];
  let pBullPts = tallyCapped(pbull, MODULE_WEIGHTS.partial_candle_confirmation, true) * mult;
  let pBearPts = tallyCapped(pbear, MODULE_WEIGHTS.partial_candle_confirmation, true) * mult;
  if (partialExhaust) {
    // Halve extension-direction points
    if (pc.direction === "green") pBullPts *= 0.5;
    if (pc.direction === "red") pBearPts *= 0.5;
  }
  mp.partial_candle_confirmation.bull = pBullPts;
  mp.partial_candle_confirmation.bear = pBearPts;

  // 5. vwap_state (9) take_highest
  mp.vwap_state.bull = tallyCapped([
    [f.vwap_reclaim && l.close_position_pct >= CLOSE_UPPER_35, 9],
    [f.above_vwap && (f.vwap_slope ?? 0) > 0, 5.5],
    [f.above_vwap, 3],
  ], MODULE_WEIGHTS.vwap_state, true);
  mp.vwap_state.bear = tallyCapped([
    [f.vwap_loss && l.close_position_pct <= CLOSE_LOWER_35, 9],
    [f.below_vwap && (f.vwap_slope ?? 0) < 0, 5.5],
    [f.below_vwap, 3],
  ], MODULE_WEIGHTS.vwap_state, true);

  // 6. fib_channel_position (8)
  mp.fib_channel_position.bull = tallyCapped([
    [f.fib_zone === "support_edge" && f.channel_support_bounce, 5],
    [f.fib_zone === "breakout" && l.close > f.channel_high, 4],
    [(f.fib_zone === "upper_mid" || f.fib_zone === "resistance_edge") && f.acceptance_break_up, 3],
    [f.fib_zone === "lower_mid" && l.green && l.close_position_pct >= 0.5, 2],
  ], MODULE_WEIGHTS.fib_channel_position);
  mp.fib_channel_position.bear = tallyCapped([
    [f.fib_zone === "resistance_edge" && f.channel_resistance_rejection, 5],
    [f.fib_zone === "breakdown" && l.close < f.channel_low, 4],
    [(f.fib_zone === "lower_mid" || f.fib_zone === "support_edge") && f.acceptance_break_down, 3],
    [f.fib_zone === "upper_mid" && l.red && l.close_position_pct <= 0.5, 2],
  ], MODULE_WEIGHTS.fib_channel_position);

  // 7. atr_range_expansion (7) — exhaustion contributes 0 to extension direction
  const isExpanding = f.atr_state === "expanding" || f.atr_state === "strong_expansion";
  const isExhaustion = f.atr_state === "exhaustion";
  mp.atr_range_expansion.bull = tallyCapped([
    [!isExhaustion && isExpanding && l.green && l.close_position_pct >= CLOSE_UPPER_35, 7],
    [!isExhaustion && f.atr_state === "expanding" && l.green, 3.5],
  ], MODULE_WEIGHTS.atr_range_expansion, true);
  mp.atr_range_expansion.bear = tallyCapped([
    [!isExhaustion && isExpanding && l.red && l.close_position_pct <= CLOSE_LOWER_35, 7],
    [!isExhaustion && f.atr_state === "expanding" && l.red, 3.5],
  ], MODULE_WEIGHTS.atr_range_expansion, true);

  // 8. support_resistance_proximity (6)
  mp.support_resistance_proximity.bull = tallyCapped([
    [f.near_support, 2.5],
    [f.room_to_resistance_pct > 0.35, 2],
    [f.repeated_support_defense, 1.5],
  ], MODULE_WEIGHTS.support_resistance_proximity);
  mp.support_resistance_proximity.bear = tallyCapped([
    [f.near_resistance, 2.5],
    [f.room_to_support_pct > 0.35, 2],
    [f.repeated_resistance_rejection, 1.5],
  ], MODULE_WEIGHTS.support_resistance_proximity);

  // 9. liquidity_sweep_reclaim (6)
  mp.liquidity_sweep_reclaim.bull = tallyCapped([
    [f.bullish_liquidity_sweep, 3.5],
    [!!p && l.low < p.low && l.close > p.close, 1.5],
    [f.bullish_liquidity_sweep && l.close_position_pct >= CLOSE_UPPER_35, 1],
  ], MODULE_WEIGHTS.liquidity_sweep_reclaim);
  mp.liquidity_sweep_reclaim.bear = tallyCapped([
    [f.bearish_liquidity_sweep, 3.5],
    [!!p && l.high > p.high && l.close < p.close, 1.5],
    [f.bearish_liquidity_sweep && l.close_position_pct <= CLOSE_LOWER_35, 1],
  ], MODULE_WEIGHTS.liquidity_sweep_reclaim);

  // 10. reclaim_breakdown_behavior (5)
  const lostSupportReclaimed = l.low < f.range20_low && l.close > f.range20_low;
  const brokeSupportFailedReclaim = l.close < f.range20_low && l.body_pct_of_range >= STRONG_BODY;
  const rejectAtResistance = f.channel_resistance_rejection;
  mp.reclaim_breakdown_behavior.bull = tallyCapped([
    [lostSupportReclaimed, 2.5],
    [f.channel_support_bounce, 1.5],
    [!!p && l.close > p.close && f.near_support, 1],
  ], MODULE_WEIGHTS.reclaim_breakdown_behavior);
  mp.reclaim_breakdown_behavior.bear = tallyCapped([
    [brokeSupportFailedReclaim, 2.5],
    [rejectAtResistance, 1.5],
    [!!p && l.close < p.close && f.near_resistance, 1],
  ], MODULE_WEIGHTS.reclaim_breakdown_behavior);

  // 11. wick_rejection_defense (5)
  mp.wick_rejection_defense.bull = tallyCapped([
    [l.lower_wick_pct >= WICK_35, 2],
    [l.lower_wick_pct >= WICK_50, 1.5],
    [l.lower_wick_pct >= WICK_35 && (f.near_support || f.channel_support_bounce), 1],
    [l.close_position_pct >= 0.5, 0.5],
  ], MODULE_WEIGHTS.wick_rejection_defense);
  mp.wick_rejection_defense.bear = tallyCapped([
    [l.upper_wick_pct >= WICK_35, 2],
    [l.upper_wick_pct >= WICK_50, 1.5],
    [l.upper_wick_pct >= WICK_35 && (f.near_resistance || f.channel_resistance_rejection), 1],
    [l.close_position_pct <= 0.5, 0.5],
  ], MODULE_WEIGHTS.wick_rejection_defense);

  // 12. candle_close_location (3) take_highest
  mp.candle_close_location.bull = tallyCapped([
    [l.close_position_pct >= CLOSE_UPPER_35, 3],
    [l.close_position_pct >= 0.5, 1.5],
  ], MODULE_WEIGHTS.candle_close_location, true);
  mp.candle_close_location.bear = tallyCapped([
    [l.close_position_pct <= CLOSE_LOWER_35, 3],
    [l.close_position_pct <= 0.5, 1.5],
  ], MODULE_WEIGHTS.candle_close_location, true);

  // 13. market_structure_regime_filter (3) — cannot flip by itself (encoded in decision engine)
  mp.market_structure_regime_filter.bull = tallyCapped([
    [f.bullish_structure, 2],
    [f.higher_low_sequence, 1],
  ], MODULE_WEIGHTS.market_structure_regime_filter);
  mp.market_structure_regime_filter.bear = tallyCapped([
    [f.bearish_structure, 2],
    [f.lower_high_sequence, 1],
  ], MODULE_WEIGHTS.market_structure_regime_filter);

  // 14. bearish_exhaustion_downside_failure (2) — bull_only
  mp.bearish_exhaustion_downside_failure.bull = tallyCapped([
    [f.last_8_negative && l.lower_wick_pct >= WICK_35, 1],
    [f.failed_breakout_down, 0.5],
    [f.last_8_negative && p != null && p.body < l.body === false && l.body < f.avg_range_20 * 0.5, 0.5],
  ], MODULE_WEIGHTS.bearish_exhaustion_downside_failure);
  mp.bearish_exhaustion_downside_failure.bear = 0;

  // 15. volume (2)
  mp.volume.bull = tallyCapped([
    [f.high_volume && l.green, 1.5],
    [f.low_volume && f.failed_breakout_down, 0.5],
  ], MODULE_WEIGHTS.volume);
  mp.volume.bear = tallyCapped([
    [f.high_volume && l.red, 1.5],
    [f.low_volume && f.failed_breakout_up, 0.5],
  ], MODULE_WEIGHTS.volume);

  const bull = Object.values(mp).reduce((s, x) => s + x.bull, 0);
  const bear = Object.values(mp).reduce((s, x) => s + x.bear, 0);
  const margin = Math.abs(bull - bear);
  const dominant: "YES" | "NO" | "NONE" = bull > bear ? "YES" : bear > bull ? "NO" : "NONE";

  return {
    bull: Number(bull.toFixed(3)),
    bear: Number(bear.toFixed(3)),
    margin: Number(margin.toFixed(3)),
    dominant,
    module_points: mp,
  };
}

// Regime filter can't be the ONLY module supporting a side. Zero-out if it is.
// (Applied in decision engine, kept alongside for tests.)
export function neutralizeStandaloneRegime(mp: Record<ModuleName, ModulePoints>): void {
  const modules = Object.keys(mp) as ModuleName[];
  const bullNonRegime = modules
    .filter((k) => k !== "market_structure_regime_filter")
    .some((k) => mp[k].bull > 0);
  const bearNonRegime = modules
    .filter((k) => k !== "market_structure_regime_filter")
    .some((k) => mp[k].bear > 0);
  if (!bullNonRegime) mp.market_structure_regime_filter.bull = 0;
  if (!bearNonRegime) mp.market_structure_regime_filter.bear = 0;
}
