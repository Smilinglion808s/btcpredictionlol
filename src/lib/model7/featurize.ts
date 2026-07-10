// Model 7 — feature engineering
// Faithful port of btc15_boundary_hybrid_backend_v1_1.json feature_engineering section.
// Produces a raw feature_map: Record<featureName, numeric>. Categorical values
// contribute encoded "<col>=<lower_value>" keys with 1.0.
// The scorer/trainer aligns this map to a fixed feature_order and standardizes.

import { LAG_WINDOWS } from "./config";

export interface Candle {
  candle_ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume?: number | null;
}

// Prediction row shape (subset of predictions/predictions_archive).
export interface PredictionRow {
  candle_ts: string;
  prediction?: string | null;
  confidence?: number | null;
  input_candle_age_seconds?: number | null;
  current_partial_minutes_elapsed?: number | null;
  btc_price_at_prediction?: number | null;
  indicators?: Record<string, unknown> | null;
  current_partial_snapshot?: Record<string, unknown> | null;
  module_points?: Record<string, { bull?: number; bear?: number }> | null;
  setup_type?: string | null;
  market_condition?: string | null;
  partial_completeness?: number | null;
  partial_close_position_pct?: number | null;
  partial_range_vs_atr?: number | null;
  partial_module_bull_pts?: number | null;
  partial_module_bear_pts?: number | null;
  partial_direction?: string | null;
  partial_agreement?: string | null;
  partial_veto_active?: boolean | string | null;
  partial_veto_tier?: string | null;
  partial_hard_override_fired?: boolean | string | null;
  conflict_downgrade_applied?: boolean | string | null;
  degraded_mode?: boolean | string | null;
  feed_mismatch?: boolean | string | null;
  agreement_gate_applied?: boolean | string | null;
  final_trade_status?: string | null;
  conviction_active?: boolean | string | null;
  conviction_direction?: string | null;
  conviction_aligned?: boolean | string | null;
  changed_by_partial?: boolean | string | null;
  original_prediction_before_partial?: string | null;
  base_bullish_score?: number | null;
  base_bearish_score?: number | null;
  bullish_score?: number | null;
  bearish_score?: number | null;
  score_margin?: number | null;
  // These four are surfaced from the indicators bundle for the JSON's schema.
  // We fall back to indicators.* when absent.
  volume_expansion?: number | boolean | string | null;
  trend?: string | null;
  choppy?: boolean | string | null;
  failed_breakout_up?: boolean | string | null;
  failed_breakout_down?: boolean | string | null;
  // Model 6 optional fallback flags for categorical features. Missing → "missing".
  directional_fallback_used?: boolean | string | null;
  bullish_fallback_lockout_active?: boolean | string | null;
  bearish_fallback_lockout_active?: boolean | string | null;
}

const RAW_NUMERIC: string[] = [
  "confidence",
  "input_candle_age_seconds",
  "current_partial_minutes_elapsed",
  "btc_price_at_prediction",
  "ema9",
  "ema21",
  "ema50",
  "volume_expansion",
  "range20_high",
  "range20_low",
  "prev_body_pct",
  "prev_upper_wick_pct",
  "prev_lower_wick_pct",
  "partial_completeness",
  "partial_close_position_pct",
  "partial_range_vs_atr",
  "partial_module_bull_pts",
  "partial_module_bear_pts",
  "base_bullish_score",
  "base_bearish_score",
  "m6_bullish_score",
  "m6_bearish_score",
  "m6_score_margin",
];

const RAW_CATEGORICAL: string[] = [
  "prediction",
  "confidence_bucket",
  "setup_type",
  "market_condition",
  "trend",
  "failed_breakout_up",
  "failed_breakout_down",
  "choppy",
  "partial_direction",
  "partial_agreement",
  "partial_veto_active",
  "partial_veto_tier",
  "partial_hard_override_fired",
  "conflict_downgrade_applied",
  "degraded_mode",
  "feed_mismatch",
  "agreement_gate_applied",
  "final_trade_status",
  "conviction_active",
  "conviction_direction",
  "conviction_aligned",
  "changed_by_partial",
  "original_prediction_before_partial",
  "directional_fallback_used",
  "bullish_fallback_lockout_active",
  "bearish_fallback_lockout_active",
];

const FIXED_MODULES: string[] = [
  "atr_range_expansion",
  "bearish_exhaustion_downside_failure",
  "candle_close_location",
  "completed_candle_structure",
  "failed_breakout_rejection_zones",
  "fib_channel_position",
  "last_8_candle_momentum",
  "liquidity_sweep_reclaim",
  "market_structure_regime_filter",
  "partial_candle_confirmation",
  "reclaim_breakdown_behavior",
  "support_resistance_proximity",
  "volume",
  "vwap_state",
  "wick_rejection_defense",
];

const EPS = 1e-9;

function normCat(v: unknown): string {
  if (v === null || v === undefined) return "missing";
  const s = String(v).trim().toLowerCase();
  return s === "" ? "missing" : s;
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return null;
  return n;
}

function toBoolLike(v: unknown): number | null {
  // For raw numeric "volume_expansion" the JSON treats it as numeric; if the
  // indicators emit boolean, coerce true→1, false→0.
  if (typeof v === "boolean") return v ? 1 : 0;
  return toNum(v);
}

function get(obj: Record<string, unknown> | null | undefined, key: string): unknown {
  if (!obj) return undefined;
  return obj[key];
}

function confidenceBucket(conf: number | null | undefined): string {
  if (conf === null || conf === undefined || !Number.isFinite(conf)) return "missing";
  if (conf < 60) return "50-59";
  if (conf < 70) return "60-69";
  if (conf < 80) return "70-79";
  return "80+";
}

/**
 * Build the raw feature_map from a live/labeled prediction row plus the
 * strictly-earlier realized candles (newest first). All keys/values follow
 * the v1.1 JSON spec exactly.
 */
export function buildFeatureMap(
  row: PredictionRow,
  historicalCandlesNewestFirst: Candle[],
): { feature_map: Record<string, number>; categoricals: Record<string, string> } {
  const f: Record<string, number> = {};
  const missingIndicator = (name: string) => { f[`${name}__missing`] = 1.0; };
  const setNum = (name: string, val: number | null | undefined) => {
    if (val === null || val === undefined || !Number.isFinite(val)) {
      missingIndicator(name);
      return;
    }
    f[name] = val;
  };

  const ind = row.indicators ?? {};

  // -----------------------------------------------------------------------
  // Raw numeric columns (with __missing indicators).
  // -----------------------------------------------------------------------
  setNum("confidence", toNum(row.confidence));
  setNum("input_candle_age_seconds", toNum(row.input_candle_age_seconds));
  setNum("current_partial_minutes_elapsed", toNum(row.current_partial_minutes_elapsed));
  setNum("btc_price_at_prediction", toNum(row.btc_price_at_prediction));
  setNum("ema9", toNum(get(ind, "ema9") ?? get(ind, "ema9Value")));
  setNum("ema21", toNum(get(ind, "ema21")));
  setNum("ema50", toNum(get(ind, "ema50")));
  const ve = row.volume_expansion !== undefined && row.volume_expansion !== null
    ? toBoolLike(row.volume_expansion)
    : toBoolLike(get(ind, "volumeExpansion"));
  setNum("volume_expansion", ve);
  setNum("range20_high", toNum(get(ind, "range20High") ?? get(ind, "range20_high")));
  setNum("range20_low", toNum(get(ind, "range20Low") ?? get(ind, "range20_low")));
  setNum("prev_body_pct", toNum(get(ind, "bodyPct") ?? get(ind, "prev_body_pct")));
  setNum("prev_upper_wick_pct", toNum(get(ind, "upperWickPct") ?? get(ind, "prev_upper_wick_pct")));
  setNum("prev_lower_wick_pct", toNum(get(ind, "lowerWickPct") ?? get(ind, "prev_lower_wick_pct")));
  setNum("partial_completeness", toNum(row.partial_completeness));
  setNum("partial_close_position_pct", toNum(row.partial_close_position_pct));
  setNum("partial_range_vs_atr", toNum(row.partial_range_vs_atr));
  setNum("partial_module_bull_pts", toNum(row.partial_module_bull_pts));
  setNum("partial_module_bear_pts", toNum(row.partial_module_bear_pts));
  setNum("base_bullish_score", toNum(row.base_bullish_score));
  setNum("base_bearish_score", toNum(row.base_bearish_score));
  setNum("m6_bullish_score", toNum(row.bullish_score));
  setNum("m6_bearish_score", toNum(row.bearish_score));
  setNum("m6_score_margin", toNum(row.score_margin));

  // -----------------------------------------------------------------------
  // Categoricals — encoded "<col>=<value>" = 1.0. Track normalized values so
  // trainer can build a vocab and scorer can flag unknowns.
  // -----------------------------------------------------------------------
  const catVals: Record<string, string> = {};
  const catSource = (col: string): unknown => {
    switch (col) {
      case "confidence_bucket": return confidenceBucket(toNum(row.confidence) ?? null);
      case "trend": return row.trend ?? get(ind, "trend");
      case "choppy": return row.choppy ?? get(ind, "choppy");
      case "failed_breakout_up": return row.failed_breakout_up ?? get(ind, "failedBreakoutUp");
      case "failed_breakout_down": return row.failed_breakout_down ?? get(ind, "failedBreakoutDown");
      default: return (row as unknown as Record<string, unknown>)[col];
    }
  };
  for (const col of RAW_CATEGORICAL) {
    const v = normCat(catSource(col));
    catVals[col] = v;
    f[`${col}=${v}`] = 1.0;
  }

  // -----------------------------------------------------------------------
  // Lag / prior-completed / rolling features from historical candles.
  // history_order: newest completed first. gap_policy: stop at first invalid.
  // -----------------------------------------------------------------------
  const hist: Candle[] = [];
  for (const c of historicalCandlesNewestFirst) {
    const o = toNum(c.open), h = toNum(c.high), l = toNum(c.low), cl = toNum(c.close);
    if (o === null || h === null || l === null || cl === null || o <= 0) break;
    hist.push({ ...c, open: o, high: h, low: l, close: cl });
  }

  if (hist.length >= 1) {
    const p = hist[0];
    const range = Math.max(p.high - p.low, EPS);
    const dir = p.close > p.open ? "green" : "red";
    setNum("_lag_prev_ret", ((p.close - p.open) / p.open) * 100);
    setNum("_lag_prev_body_pct", Math.abs(p.close - p.open) / range);
    setNum("_lag_prev_close_pos", (p.close - p.low) / range);
    setNum("_lag_prev_upper", (p.high - Math.max(p.open, p.close)) / range);
    setNum("_lag_prev_lower", (Math.min(p.open, p.close) - p.low) / range);
    setNum("_lag_prev_range_pct", ((p.high - p.low) / p.open) * 100);
    catVals["_lag_prev_dir"] = dir;
    f[`_lag_prev_dir=${dir}`] = 1.0;
  } else {
    for (const n of ["_lag_prev_ret","_lag_prev_body_pct","_lag_prev_close_pos","_lag_prev_upper","_lag_prev_lower","_lag_prev_range_pct"]) missingIndicator(n);
    catVals["_lag_prev_dir"] = "missing";
    f["_lag_prev_dir=missing"] = 1.0;
  }

  // Rolling windows.
  for (const N of LAG_WINDOWS) {
    if (hist.length >= 1) {
      const window = hist.slice(0, Math.min(N, hist.length));
      const enough = window.length === N;
      if (enough) {
        const greenCount = window.filter((c) => c.close > c.open).length;
        const retSum = window.reduce((a, c) => a + ((c.close - c.open) / c.open) * 100, 0);
        const rangeMean = window.reduce((a, c) => a + ((c.high - c.low) / c.open) * 100, 0) / window.length;
        f[`_lag_green_count_${N}`] = greenCount;
        f[`_lag_return_sum_${N}`] = retSum;
        f[`_lag_range_mean_${N}`] = rangeMean;
        if (window.length >= 2) {
          const newest = window[0];
          const rest = window.slice(1);
          const newestRangePct = ((newest.high - newest.low) / newest.open) * 100;
          const restMean = rest.reduce((a, c) => a + ((c.high - c.low) / c.open) * 100, 0) / rest.length;
          f[`_lag_range_ratio_${N}`] = newestRangePct / (restMean + EPS);
        } else {
          missingIndicator(`_lag_range_ratio_${N}`);
        }
      } else {
        for (const n of [`_lag_green_count_${N}`,`_lag_return_sum_${N}`,`_lag_range_mean_${N}`,`_lag_range_ratio_${N}`]) missingIndicator(n);
      }
    } else {
      for (const n of [`_lag_green_count_${N}`,`_lag_return_sum_${N}`,`_lag_range_mean_${N}`,`_lag_range_ratio_${N}`]) missingIndicator(n);
    }
  }

  // Streak (length + direction).
  if (hist.length >= 1) {
    const first = hist[0];
    const dir = first.close > first.open ? "green" : first.close < first.open ? "red" : "doji";
    let len = 1;
    for (let i = 1; i < hist.length; i++) {
      const d = hist[i].close > hist[i].open ? "green" : hist[i].close < hist[i].open ? "red" : "doji";
      if (d === dir) len++; else break;
    }
    f["_lag_streak_len"] = len;
    catVals["_lag_streak_dir"] = dir;
    f[`_lag_streak_dir=${dir}`] = 1.0;
  } else {
    missingIndicator("_lag_streak_len");
    catVals["_lag_streak_dir"] = "missing";
    f["_lag_streak_dir=missing"] = 1.0;
  }

  // _lag_close_pos_8 (window of 8, newest close normalized).
  if (hist.length >= 8) {
    const w = hist.slice(0, 8);
    const hi = Math.max(...w.map((c) => c.high));
    const lo = Math.min(...w.map((c) => c.low));
    const newestClose = w[0].close;
    f["_lag_close_pos_8"] = (newestClose - lo) / (hi - lo + EPS);
  } else {
    missingIndicator("_lag_close_pos_8");
  }

  // -----------------------------------------------------------------------
  // Derived price/EMA features (only if btc_price_at_prediction present).
  // -----------------------------------------------------------------------
  const price = toNum(row.btc_price_at_prediction);
  const ema9 = toNum(get(ind, "ema9"));
  const ema21 = toNum(get(ind, "ema21"));
  const ema50 = toNum(get(ind, "ema50"));
  const r20h = toNum(get(ind, "range20High") ?? get(ind, "range20_high"));
  const r20l = toNum(get(ind, "range20Low") ?? get(ind, "range20_low"));
  if (price !== null && price !== 0) {
    if (ema9 !== null) f["dist_ema9"] = ((price - ema9) / price) * 100;
    if (ema21 !== null) f["dist_ema21"] = ((price - ema21) / price) * 100;
    if (ema50 !== null) f["dist_ema50"] = ((price - ema50) / price) * 100;
    if (r20h !== null) f["dist_range_high"] = ((price - r20h) / price) * 100;
    if (r20l !== null) f["dist_range_low"] = ((price - r20l) / price) * 100;
    if (r20h !== null && r20l !== null) f["position_range20"] = (price - r20l) / (r20h - r20l + EPS);
    if (ema9 !== null && ema21 !== null) f["ema9_21_spread"] = ((ema9 - ema21) / price) * 100;
    if (ema21 !== null && ema50 !== null) f["ema21_50_spread"] = ((ema21 - ema50) / price) * 100;
  }

  // -----------------------------------------------------------------------
  // Partial-snapshot derived features (parse_failure ⇒ omit → 0).
  // -----------------------------------------------------------------------
  const ps = row.current_partial_snapshot ?? null;
  if (ps) {
    const po = toNum(get(ps, "open"));
    const ph = toNum(get(ps, "high"));
    const pl = toNum(get(ps, "low"));
    const pc = toNum(get(ps, "close"));
    if (po !== null && ph !== null && pl !== null && pc !== null && po > 0) {
      const rng = Math.max(ph - pl, EPS);
      f["partial_ret_pct"] = ((pc - po) / po) * 100;
      f["partial_body_pct"] = Math.abs(pc - po) / rng;
      f["partial_close_pos_raw"] = (pc - pl) / rng;
      f["partial_upper_raw"] = (ph - Math.max(po, pc)) / rng;
      f["partial_lower_raw"] = (Math.min(po, pc) - pl) / rng;
      f["partial_range_pct_raw"] = ((ph - pl) / po) * 100;
      const pv = toNum(get(ps, "volume"));
      if (pv !== null) f["partial_volume_raw"] = pv;
    }
  }

  // -----------------------------------------------------------------------
  // Module features (mod_<module>_bull / _bear).
  // -----------------------------------------------------------------------
  const mp = row.module_points ?? null;
  for (const m of FIXED_MODULES) {
    const entry = mp ? (mp as Record<string, { bull?: number; bear?: number }>)[m] : undefined;
    f[`mod_${m}_bull`] = toNum(entry?.bull) ?? 0;
    f[`mod_${m}_bear`] = toNum(entry?.bear) ?? 0;
  }

  // -----------------------------------------------------------------------
  // Time features (from candle_ts UTC).
  // -----------------------------------------------------------------------
  const d = new Date(row.candle_ts);
  if (!isNaN(d.getTime())) {
    const minOfDay = d.getUTCHours() * 60 + d.getUTCMinutes();
    f["minute_of_day"] = minOfDay;
    f["tod_sin"] = Math.sin((2 * Math.PI * minOfDay) / 1440);
    f["tod_cos"] = Math.cos((2 * Math.PI * minOfDay) / 1440);
  }

  return { feature_map: f, categoricals: catVals };
}

export const MODEL7_RAW_NUMERIC = RAW_NUMERIC;
export const MODEL7_RAW_CATEGORICAL = RAW_CATEGORICAL;
export const MODEL7_FIXED_MODULES = FIXED_MODULES;
