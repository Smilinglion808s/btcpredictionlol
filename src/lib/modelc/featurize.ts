// Model C — feature builders for global_core and recent_full components.
//
// Design principle: DictVectorizer only pulls keys that appear in
// `feature_order`. Producing a superset of features is safe; unknown keys are
// discarded at score time. Missing keys become 0.
//
// Two builders share the annotated candle history so we only walk the candle
// series once per prediction. `recent_full` embeds every global_core feature
// under the `core_` prefix per spec.

import type { FeatureMap } from "./score";

// ---------- Types ----------

export interface CandleRow {
  candle_ts: string; // ISO
  open: number | string;
  high: number | string;
  low: number | string;
  close: number | string;
  volume?: number | string | null;
}

export interface PredictionRowForFeatures {
  id: string;
  candle_ts: string;
  created_at?: string | null;
  prediction?: string | null;
  confidence?: number | string | null;
  btc_price_at_prediction?: number | string | null;
  setup_type?: string | null;
  market_condition?: string | null;
  units?: number | string | null;
  input_candle_ts?: string | null;
  input_candle_age_seconds?: number | string | null;
  input_features_fresh?: boolean | null;
  freshness_action?: string | null;
  fetch_source?: string | null;
  advance_check_passed?: boolean | null;
  current_partial_minutes_elapsed?: number | string | null;
  current_partial_snapshot?: Record<string, unknown> | null;
  partial_snapshot_present?: boolean | null;
  partial_completeness?: number | string | null;
  partial_direction?: string | null;
  partial_close_position_pct?: number | string | null;
  partial_range_vs_atr?: number | string | null;
  partial_agreement?: string | null;
  partial_module_bull_pts?: number | string | null;
  partial_module_bear_pts?: number | string | null;
  partial_veto_active?: boolean | null;
  partial_veto_tier?: string | null;
  partial_hard_override_fired?: boolean | null;
  conflict_downgrade_applied?: boolean | null;
  degraded_mode?: boolean | null;
  feed_mismatch?: boolean | null;
  agreement_gate_applied?: boolean | null;
  agreement_gate_reason?: string | null;
  final_trade_status?: string | null;
  base_bullish_score?: number | string | null;
  base_bearish_score?: number | string | null;
  bullish_score?: number | string | null;
  bearish_score?: number | string | null;
  score_margin?: number | string | null;
  original_prediction_before_partial?: string | null;
  changed_by_partial?: boolean | null;
  conviction_active?: boolean | null;
  conviction_direction?: string | null;
  conviction_aligned?: boolean | null;
  conviction_reasons?: string[] | null;
  indicators?: Record<string, unknown> | null;
  module_points?: Record<string, unknown> | null;
}

// ---------- Fixed vocab ----------

const MODULE_NAMES = [
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
] as const;

const CORE_ROLLING_WINDOWS = [2, 3, 4, 6, 8, 12, 16];
const RECENT_EXTRA_WINDOWS = [3, 5, 8, 12, 20, 32];
const DIR_PATTERN_WINDOWS = [2, 3, 4, 5, 6];

// ---------- Small utils ----------

const num = (v: unknown): number | null => {
  if (v == null || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

function putNumeric(map: FeatureMap, key: string, v: number | null): void {
  if (v == null) {
    map[`${key}__missing`] = 1;
  } else {
    map[key] = v;
  }
}

function putCategorical(map: FeatureMap, col: string, raw: unknown): void {
  let s: string;
  if (raw == null || raw === "") s = "missing";
  else if (typeof raw === "boolean") s = raw ? "true" : "false";
  else s = String(raw).trim().toLowerCase();
  map[`${col}=${s}`] = 1;
}

function candleDir(c: CandleRow): "green" | "red" | "doji" {
  const o = num(c.open) ?? 0;
  const cl = num(c.close) ?? 0;
  if (cl > o) return "green";
  if (cl < o) return "red";
  return "doji";
}

function candleRetPct(c: CandleRow): number {
  const o = num(c.open);
  const cl = num(c.close);
  if (o == null || cl == null || o === 0) return 0;
  return ((cl - o) / o) * 100;
}

function candleRangePct(c: CandleRow): number {
  const o = num(c.open);
  const h = num(c.high);
  const l = num(c.low);
  if (o == null || h == null || l == null || o === 0) return 0;
  return ((h - l) / o) * 100;
}

function candleBodyFrac(c: CandleRow): number {
  const o = num(c.open) ?? 0;
  const cl = num(c.close) ?? 0;
  const h = num(c.high) ?? 0;
  const l = num(c.low) ?? 0;
  const range = h - l;
  return range <= 0 ? 0 : Math.abs(cl - o) / range;
}

function candleClosePos(c: CandleRow): number {
  const cl = num(c.close) ?? 0;
  const h = num(c.high) ?? 0;
  const l = num(c.low) ?? 0;
  const range = h - l;
  return range <= 0 ? 0 : (cl - l) / range;
}

function candleUpperFrac(c: CandleRow): number {
  const o = num(c.open) ?? 0;
  const cl = num(c.close) ?? 0;
  const h = num(c.high) ?? 0;
  const l = num(c.low) ?? 0;
  const range = h - l;
  return range <= 0 ? 0 : (h - Math.max(o, cl)) / range;
}

function candleLowerFrac(c: CandleRow): number {
  const o = num(c.open) ?? 0;
  const cl = num(c.close) ?? 0;
  const h = num(c.high) ?? 0;
  const l = num(c.low) ?? 0;
  const range = h - l;
  return range <= 0 ? 0 : (Math.min(o, cl) - l) / range;
}

function mean(xs: number[]): number {
  if (xs.length === 0) return 0;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

function stdPop(xs: number[]): number {
  if (xs.length === 0) return 0;
  const m = mean(xs);
  let ss = 0;
  for (const x of xs) ss += (x - m) ** 2;
  return Math.sqrt(ss / xs.length);
}

function linSlope(ys: number[]): number {
  // slope for y_oldest_to_newest with x = 0..n-1
  const n = ys.length;
  if (n < 2) return 0;
  const xm = (n - 1) / 2;
  const ym = mean(ys);
  let num_ = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num_ += (i - xm) * (ys[i] - ym);
    den += (i - xm) ** 2;
  }
  return den === 0 ? 0 : num_ / den;
}

function pearson(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 2) return 0;
  const ma = mean(a.slice(0, n));
  const mb = mean(b.slice(0, n));
  let num_ = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const av = a[i] - ma;
    const bv = b[i] - mb;
    num_ += av * bv;
    da += av * av;
    db += bv * bv;
  }
  if (da < 1e-12 || db < 1e-12) return 0;
  return num_ / Math.sqrt(da * db);
}

// ---------- History-derived features ----------

/**
 * `history` is most-recent-completed-candle first (per spec `past_order`).
 * Fills `_lag_*`, streak, close-pos-8, all rolling _lag features, _x_ recent
 * features, direction patterns.
 */
function addHistoryFeatures(
  map: FeatureMap,
  history: CandleRow[],
  namespace: "lag" | "core-and-x",
): void {
  const H = history;
  // ---- previous candle features (_lag_prev_*) ----
  if (H.length >= 1) {
    const p = H[0];
    putCategorical(map, "_lag_prev_dir", candleDir(p));
    putNumeric(map, "_lag_prev_ret", candleRetPct(p));
    putNumeric(map, "_lag_prev_body_pct", candleBodyFrac(p));
    putNumeric(map, "_lag_prev_close_pos", candleClosePos(p));
    putNumeric(map, "_lag_prev_upper", candleUpperFrac(p));
    putNumeric(map, "_lag_prev_lower", candleLowerFrac(p));
    putNumeric(map, "_lag_prev_range_pct", candleRangePct(p));
  } else {
    putCategorical(map, "_lag_prev_dir", null);
    for (const k of [
      "_lag_prev_ret",
      "_lag_prev_body_pct",
      "_lag_prev_close_pos",
      "_lag_prev_upper",
      "_lag_prev_lower",
      "_lag_prev_range_pct",
    ]) putNumeric(map, k, null);
  }

  // ---- streak ----
  if (H.length >= 1) {
    const d0 = candleDir(H[0]);
    if (d0 === "doji") {
      putNumeric(map, "_lag_streak_len", 0);
      putCategorical(map, "_lag_streak_dir", null);
    } else {
      let len = 1;
      for (let i = 1; i < H.length; i++) {
        if (candleDir(H[i]) === d0) len++;
        else break;
      }
      putNumeric(map, "_lag_streak_len", len);
      putCategorical(map, "_lag_streak_dir", d0);
    }
  } else {
    putNumeric(map, "_lag_streak_len", null);
    putCategorical(map, "_lag_streak_dir", null);
  }

  // ---- close_pos_8 ----
  if (H.length >= 1) {
    const win = H.slice(0, Math.min(8, H.length));
    let minL = Infinity;
    let maxH = -Infinity;
    for (const c of win) {
      const l = num(c.low);
      const h = num(c.high);
      if (l != null) minL = Math.min(minL, l);
      if (h != null) maxH = Math.max(maxH, h);
    }
    const latestClose = num(H[0].close);
    if (latestClose != null && Number.isFinite(minL) && Number.isFinite(maxH) && maxH > minL) {
      putNumeric(map, "_lag_close_pos_8", (latestClose - minL) / (maxH - minL));
    } else {
      putNumeric(map, "_lag_close_pos_8", null);
    }
  } else {
    putNumeric(map, "_lag_close_pos_8", null);
  }

  // ---- rolling _lag features ----
  for (const N of CORE_ROLLING_WINDOWS) {
    if (H.length >= N) {
      const win = H.slice(0, N);
      const greens = win.filter((c) => candleDir(c) === "green").length;
      putNumeric(map, `_lag_green_count_${N}`, greens);
      const rets = win.map(candleRetPct);
      putNumeric(map, `_lag_return_sum_${N}`, rets.reduce((a, b) => a + b, 0));
      const ranges = win.map(candleRangePct);
      putNumeric(map, `_lag_range_mean_${N}`, mean(ranges));
      if (N >= 2) {
        const latestRange = ranges[0];
        const rest = ranges.slice(1);
        const restMean = mean(rest);
        putNumeric(
          map,
          `_lag_range_ratio_${N}`,
          restMean === 0 ? 0 : latestRange / restMean,
        );
      }
    } else {
      for (const k of [
        `_lag_green_count_${N}`,
        `_lag_return_sum_${N}`,
        `_lag_range_mean_${N}`,
        `_lag_range_ratio_${N}`,
      ]) putNumeric(map, k, null);
    }
  }

  if (namespace !== "core-and-x") return;

  // ---- _x_ recent-extra rolling features ----
  for (const N of RECENT_EXTRA_WINDOWS) {
    if (H.length >= N) {
      const win = H.slice(0, N);
      const rets = win.map(candleRetPct);
      const absrets = rets.map(Math.abs);
      const ranges = win.map(candleRangePct);
      const bodies = win.map(candleBodyFrac);
      const closepos = win.map(candleClosePos);
      const wickImb = win.map((c) => candleLowerFrac(c) - candleUpperFrac(c));
      const greenRate =
        win.filter((c) => candleDir(c) === "green").length / N;
      // sign_changes: fraction of adjacent direction changes
      let sc = 0;
      for (let i = 1; i < win.length; i++) {
        if (candleDir(win[i]) !== candleDir(win[i - 1])) sc++;
      }
      const sign_changes = win.length > 1 ? sc / (win.length - 1) : 0;
      // close slope over closes oldest->newest
      const closesOld = win.slice().reverse().map((c) => num(c.close) ?? 0);
      const meanClose = mean(closesOld);
      const slope = linSlope(closesOld);
      const slopePct = meanClose === 0 ? 0 : (slope / meanClose) * 100;
      // lag-1 autocorr of returns (oldest->newest ordering)
      const retsOld = rets.slice().reverse();
      const a = retsOld.slice(0, -1);
      const b = retsOld.slice(1);
      const autocorr = pearson(a, b);

      putNumeric(map, `_x_ret_mean_${N}`, mean(rets));
      putNumeric(map, `_x_ret_std_${N}`, stdPop(rets));
      putNumeric(map, `_x_absret_mean_${N}`, mean(absrets));
      putNumeric(map, `_x_range_std_${N}`, stdPop(ranges));
      putNumeric(map, `_x_body_mean_${N}`, mean(bodies));
      putNumeric(map, `_x_closepos_mean_${N}`, mean(closepos));
      putNumeric(map, `_x_wick_imbalance_mean_${N}`, mean(wickImb));
      putNumeric(map, `_x_green_rate_${N}`, greenRate);
      putNumeric(map, `_x_sign_changes_${N}`, sign_changes);
      putNumeric(map, `_x_close_slope_pct_${N}`, slopePct);
      putNumeric(map, `_x_ret_autocorr_${N}`, autocorr);
    } else {
      for (const key of [
        `_x_ret_mean_${N}`,
        `_x_ret_std_${N}`,
        `_x_absret_mean_${N}`,
        `_x_range_std_${N}`,
        `_x_body_mean_${N}`,
        `_x_closepos_mean_${N}`,
        `_x_wick_imbalance_mean_${N}`,
        `_x_green_rate_${N}`,
        `_x_sign_changes_${N}`,
        `_x_close_slope_pct_${N}`,
        `_x_ret_autocorr_${N}`,
      ]) putNumeric(map, key, null);
    }
  }

  // ---- direction patterns ----
  for (const N of DIR_PATTERN_WINDOWS) {
    if (H.length >= N) {
      const pat = H.slice(0, N)
        .map((c) => (candleDir(c) === "green" ? "G" : candleDir(c) === "red" ? "R" : "D"))
        .join("");
      putCategorical(map, `_x_dir_pattern_${N}`, pat);
    } else {
      putCategorical(map, `_x_dir_pattern_${N}`, null);
    }
  }

  // ---- recent_20 & two-candle features ----
  if (H.length >= 20) {
    const w20 = H.slice(0, 20);
    const r20 = w20.map(candleRangePct);
    const ret20 = w20.map(candleRetPct);
    const meanR = mean(r20);
    const stdR = stdPop(r20);
    const meanRet = mean(ret20);
    const stdRet = stdPop(ret20);
    putNumeric(map, "_x_last_range_z20", (r20[0] - meanR) / (stdR + 1e-9));
    putNumeric(map, "_x_last_ret_z20", (ret20[0] - meanRet) / (stdRet + 1e-9));
    let minL = Infinity;
    let maxH = -Infinity;
    for (const c of w20) {
      const l = num(c.low);
      const h = num(c.high);
      if (l != null) minL = Math.min(minL, l);
      if (h != null) maxH = Math.max(maxH, h);
    }
    const latestClose = num(H[0].close) ?? 0;
    putNumeric(
      map,
      "_x_close_pos20",
      (latestClose - minL) / (maxH - minL + 1e-9),
    );
    // compression: mean range5 / mean range20
    if (H.length >= 5) {
      const r5 = H.slice(0, 5).map(candleRangePct);
      putNumeric(map, "_x_range_compression_5v20", mean(r5) / (meanR + 1e-9));
      const ret5 = H.slice(0, 5).map(candleRetPct);
      putNumeric(
        map,
        "_x_vol_slope_5v20",
        stdPop(ret5) / (stdPop(ret20) + 1e-9),
      );
    } else {
      putNumeric(map, "_x_range_compression_5v20", null);
      putNumeric(map, "_x_vol_slope_5v20", null);
    }
  } else {
    for (const k of [
      "_x_last_range_z20",
      "_x_last_ret_z20",
      "_x_close_pos20",
      "_x_range_compression_5v20",
      "_x_vol_slope_5v20",
    ]) putNumeric(map, k, null);
  }

  if (H.length >= 2) {
    const a = H[0];
    const b = H[1];
    putNumeric(
      map,
      "_x_prev_reversal",
      candleDir(a) !== candleDir(b) ? 1 : 0,
    );
    putNumeric(map, "_x_prev2_return_sum", candleRetPct(a) + candleRetPct(b));
    const ra = candleRangePct(a);
    const rb = candleRangePct(b);
    putNumeric(map, "_x_range_change", ra / (rb + 1e-9));
    putNumeric(map, "_x_body_change", candleBodyFrac(a) - candleBodyFrac(b));
    putNumeric(map, "_x_closepos_change", candleClosePos(a) - candleClosePos(b));
  } else {
    for (const k of [
      "_x_prev_reversal",
      "_x_prev2_return_sum",
      "_x_range_change",
      "_x_body_change",
      "_x_closepos_change",
    ]) putNumeric(map, k, null);
  }
}

// ---------- Snapshot / indicator features ----------

function addModuleFeatures(
  map: FeatureMap,
  row: PredictionRowForFeatures,
  withNetAndTotals: boolean,
): void {
  const mp = (row.module_points ?? {}) as Record<string, { bull?: number; bear?: number } | undefined>;
  let totalBull = 0;
  let totalBear = 0;
  for (const name of MODULE_NAMES) {
    const entry = mp[name] ?? {};
    const bull = num(entry.bull) ?? 0;
    const bear = num(entry.bear) ?? 0;
    map[`mod_${name}_bull`] = bull;
    map[`mod_${name}_bear`] = bear;
    if (withNetAndTotals) map[`mod_${name}_net`] = bull - bear;
    totalBull += bull;
    totalBear += bear;
  }
  if (withNetAndTotals) {
    map["module_total_bull"] = totalBull;
    map["module_total_bear"] = totalBear;
    map["module_total_net"] = totalBull - totalBear;
  }
}

function addPartialSnapshotFeatures(
  map: FeatureMap,
  row: PredictionRowForFeatures,
  variant: "global" | "recent",
): void {
  const snap = row.current_partial_snapshot ?? {};
  const o = num((snap as Record<string, unknown>).open);
  const h = num((snap as Record<string, unknown>).high);
  const l = num((snap as Record<string, unknown>).low);
  const c = num((snap as Record<string, unknown>).close);
  const vol = num((snap as Record<string, unknown>).volume);
  const range = h != null && l != null ? h - l : null;

  const retPct = o && c != null ? ((c - o) / o) * 100 : null;
  const rangePct = o && h != null && l != null ? ((h - l) / o) * 100 : null;
  const bodyFrac = range && range > 0 && o != null && c != null ? Math.abs(c - o) / range : null;
  const closePos = range && range > 0 && c != null && l != null ? (c - l) / range : null;
  const upper = range && range > 0 && h != null && o != null && c != null ? (h - Math.max(o, c)) / range : null;
  const lower = range && range > 0 && o != null && c != null && l != null ? (Math.min(o, c) - l) / range : null;

  if (variant === "global") {
    putNumeric(map, "partial_ret_pct", retPct);
    putNumeric(map, "partial_body_pct", bodyFrac);
    putNumeric(map, "partial_close_pos_raw", closePos);
    putNumeric(map, "partial_upper_raw", upper);
    putNumeric(map, "partial_lower_raw", lower);
    putNumeric(map, "partial_range_pct_raw", rangePct);
    putNumeric(map, "partial_volume_raw", vol);
  } else {
    putNumeric(map, "p_ret_pct", retPct);
    putNumeric(map, "p_range_pct", rangePct);
    putNumeric(map, "p_body_frac", bodyFrac);
    putNumeric(map, "p_close_pos", closePos);
    putNumeric(map, "p_upper_frac", upper);
    putNumeric(map, "p_lower_frac", lower);
    putNumeric(map, "p_wick_imbalance", lower != null && upper != null ? lower - upper : null);
    putNumeric(map, "p_volume", vol);
  }
}

function addTimeFeatures(
  map: FeatureMap,
  row: PredictionRowForFeatures,
  variant: "global" | "recent",
): void {
  const t = new Date(row.candle_ts).getTime();
  const d = new Date(t);
  const minute = d.getUTCHours() * 60 + d.getUTCMinutes();
  const theta = (2 * Math.PI * minute) / 1440;
  if (variant === "global") {
    map["tod_sin"] = Math.sin(theta);
    map["tod_cos"] = Math.cos(theta);
  } else {
    map["tod_sin2"] = Math.sin(theta);
    map["tod_cos2"] = Math.cos(theta);
    map["tod_sin4"] = Math.sin(2 * theta);
    map["tod_cos4"] = Math.cos(2 * theta);
  }
}

function addDerivedPriceFeatures(
  map: FeatureMap,
  row: PredictionRowForFeatures,
  variant: "global" | "recent",
): void {
  const ind = (row.indicators ?? {}) as Record<string, unknown>;
  const price = num(row.btc_price_at_prediction) ?? num(ind.price);
  const ema9 = num(ind.ema9);
  const ema21 = num(ind.ema21);
  const ema50 = num(ind.ema50);
  const rangeHigh = num(ind.range20_high) ?? num(ind.rangeHigh);
  const rangeLow = num(ind.range20_low) ?? num(ind.rangeLow);

  if (variant === "global") {
    if (price && ema9 != null) putNumeric(map, "dist_ema9", ((price - ema9) / price) * 100);
    if (price && ema21 != null) putNumeric(map, "dist_ema21", ((price - ema21) / price) * 100);
    if (price && ema50 != null) putNumeric(map, "dist_ema50", ((price - ema50) / price) * 100);
    if (price && rangeHigh != null) putNumeric(map, "dist_range_high", ((price - rangeHigh) / price) * 100);
    if (price && rangeLow != null) putNumeric(map, "dist_range_low", ((price - rangeLow) / price) * 100);
    if (rangeHigh != null && rangeLow != null && price)
      putNumeric(map, "position_range20", (price - rangeLow) / (rangeHigh - rangeLow + 1e-9));
    if (price && ema9 != null && ema21 != null)
      putNumeric(map, "ema9_21_spread", ((ema9 - ema21) / price) * 100);
    if (price && ema21 != null && ema50 != null)
      putNumeric(map, "ema21_50_spread", ((ema21 - ema50) / price) * 100);
  } else {
    if (price && ema9 != null) putNumeric(map, "norm_dist_e9", ((price - ema9) / price) * 100);
    if (price && ema21 != null) putNumeric(map, "norm_dist_e21", ((price - ema21) / price) * 100);
    if (price && ema50 != null) putNumeric(map, "norm_dist_e50", ((price - ema50) / price) * 100);
    if (price && rangeHigh != null) putNumeric(map, "norm_dist_range_high", ((price - rangeHigh) / price) * 100);
    if (price && rangeLow != null) putNumeric(map, "norm_dist_range_low", ((price - rangeLow) / price) * 100);
    if (price && rangeHigh != null && rangeLow != null)
      putNumeric(map, "range20_width_pct", ((rangeHigh - rangeLow) / price) * 100);
    if (price && rangeHigh != null && rangeLow != null)
      putNumeric(map, "position_range20_full", (price - rangeLow) / (rangeHigh - rangeLow));
    map["ema_stack_bull"] = ema9 != null && ema21 != null && ema50 != null && ema9 > ema21 && ema21 > ema50 ? 1 : 0;
    map["ema_stack_bear"] = ema9 != null && ema21 != null && ema50 != null && ema9 < ema21 && ema21 < ema50 ? 1 : 0;
    if (price && ema9 != null && ema21 != null)
      putNumeric(map, "ema9_21_pct", ((ema9 - ema21) / price) * 100);
    if (price && ema21 != null && ema50 != null)
      putNumeric(map, "ema21_50_pct", ((ema21 - ema50) / price) * 100);
    if (price && ema9 != null && ema50 != null)
      putNumeric(map, "ema9_50_pct", ((ema9 - ema50) / price) * 100);
  }
}

function addRawSnapshotColumns(
  map: FeatureMap,
  row: PredictionRowForFeatures,
): void {
  const ind = (row.indicators ?? {}) as Record<string, unknown>;
  putNumeric(map, "confidence", num(row.confidence));
  putNumeric(map, "input_candle_age_seconds", num(row.input_candle_age_seconds));
  putNumeric(map, "current_partial_minutes_elapsed", num(row.current_partial_minutes_elapsed));
  putNumeric(map, "btc_price_at_prediction", num(row.btc_price_at_prediction));
  putNumeric(map, "ema9", num(ind.ema9));
  putNumeric(map, "ema21", num(ind.ema21));
  putNumeric(map, "ema50", num(ind.ema50));
  putNumeric(map, "volume_expansion", num(ind.volume_expansion) ?? num(ind.volumeExpansion));
  putNumeric(map, "range20_high", num(ind.range20_high) ?? num(ind.rangeHigh));
  putNumeric(map, "range20_low", num(ind.range20_low) ?? num(ind.rangeLow));
  putNumeric(map, "prev_body_pct", num(ind.prev_body_pct) ?? num(ind.bodyPct));
  putNumeric(map, "prev_upper_wick_pct", num(ind.prev_upper_wick_pct) ?? num(ind.upperWickPct));
  putNumeric(map, "prev_lower_wick_pct", num(ind.prev_lower_wick_pct) ?? num(ind.lowerWickPct));
  putNumeric(map, "partial_completeness", num(row.partial_completeness));
  putNumeric(map, "partial_close_position_pct", num(row.partial_close_position_pct));
  putNumeric(map, "partial_range_vs_atr", num(row.partial_range_vs_atr));
  putNumeric(map, "partial_module_bull_pts", num(row.partial_module_bull_pts));
  putNumeric(map, "partial_module_bear_pts", num(row.partial_module_bear_pts));
  putNumeric(map, "base_bullish_score", num(row.base_bullish_score) ?? num(row.bullish_score));
  putNumeric(map, "base_bearish_score", num(row.base_bearish_score) ?? num(row.bearish_score));
  putNumeric(map, "m6_bullish_score", num(row.bullish_score));
  putNumeric(map, "m6_bearish_score", num(row.bearish_score));
  putNumeric(map, "m6_score_margin", num(row.score_margin));
  putNumeric(map, "units", num(row.units));
}

function confidenceBucket(v: number | null): string {
  if (v == null) return "missing";
  if (v < 40) return "0-39";
  if (v < 60) return "40-59";
  if (v < 70) return "60-69";
  if (v < 80) return "70-79";
  return "80+";
}

function addRawCategoricals(
  map: FeatureMap,
  row: PredictionRowForFeatures,
  variant: "global" | "recent",
): void {
  const ind = (row.indicators ?? {}) as Record<string, unknown>;
  putCategorical(map, "prediction", row.prediction);
  putCategorical(map, "confidence_bucket", confidenceBucket(num(row.confidence)));
  putCategorical(map, "setup_type", row.setup_type);
  putCategorical(map, "market_condition", row.market_condition);
  putCategorical(map, "trend", ind.trend ?? null);
  putCategorical(map, "failed_breakout_up", ind.failed_breakout_up ?? ind.failedBreakoutUp ?? null);
  putCategorical(map, "failed_breakout_down", ind.failed_breakout_down ?? ind.failedBreakoutDown ?? null);
  putCategorical(map, "choppy", ind.choppy ?? null);
  putCategorical(map, "partial_direction", row.partial_direction);
  putCategorical(map, "partial_agreement", row.partial_agreement);
  putCategorical(map, "degraded_mode", row.degraded_mode);
  putCategorical(map, "feed_mismatch", row.feed_mismatch);
  putCategorical(map, "agreement_gate_applied", row.agreement_gate_applied);
  putCategorical(map, "final_trade_status", row.final_trade_status);
  putCategorical(map, "conviction_active", row.conviction_active);
  putCategorical(map, "conviction_direction", row.conviction_direction);
  putCategorical(map, "conviction_aligned", row.conviction_aligned);
  putCategorical(map, "original_prediction_before_partial", row.original_prediction_before_partial);

  if (variant === "global") {
    putCategorical(map, "partial_veto_active", row.partial_veto_active);
    putCategorical(map, "partial_veto_tier", row.partial_veto_tier);
    putCategorical(map, "partial_hard_override_fired", row.partial_hard_override_fired);
    putCategorical(map, "conflict_downgrade_applied", row.conflict_downgrade_applied);
    putCategorical(map, "changed_by_partial", row.changed_by_partial);
    putCategorical(map, "directional_fallback_used", null);
    putCategorical(map, "bullish_fallback_lockout_active", null);
    putCategorical(map, "bearish_fallback_lockout_active", null);
  } else {
    putCategorical(map, "input_features_fresh", row.input_features_fresh);
    putCategorical(map, "freshness_action", row.freshness_action);
    putCategorical(map, "fetch_source", row.fetch_source);
    putCategorical(map, "advance_check_passed", row.advance_check_passed);
    putCategorical(map, "agreement_gate_reason", row.agreement_gate_reason);
  }
}

function addConvictionFeatures(map: FeatureMap, row: PredictionRowForFeatures): void {
  const reasons = row.conviction_reasons ?? [];
  let count = 0;
  if (Array.isArray(reasons)) {
    for (const r of reasons) {
      if (r == null) continue;
      const s = String(r).trim().toLowerCase();
      if (!s) continue;
      map[`conviction_reason=${s}`] = 1;
      count++;
    }
  }
  putNumeric(map, "conviction_reason_count", count);
}

function addScoreInteractions(map: FeatureMap, row: PredictionRowForFeatures): void {
  const bull = num(row.bullish_score);
  const bear = num(row.bearish_score);
  const conf = num(row.confidence);
  if (bull != null && bear != null) {
    putNumeric(map, "m6_score_sum", bull + bear);
    putNumeric(map, "m6_score_abs_margin", Math.abs(bull - bear));
    putNumeric(map, "m6_score_balance", (bull - bear) / (bull + bear + 1e-9));
  }
  const pb = num(row.partial_module_bull_pts);
  const pbear = num(row.partial_module_bear_pts);
  if (pb != null && pbear != null) {
    putNumeric(map, "partial_pts_net", pb - pbear);
    putNumeric(map, "partial_pts_sum", pb + pbear);
  }
  if (conf != null) {
    putNumeric(map, "confidence_centered", conf - 50);
    putNumeric(map, "confidence_extreme", Math.abs(conf - 50));
  }
  if (row.created_at) {
    const lead = (new Date(row.candle_ts).getTime() - new Date(row.created_at).getTime()) / 1000;
    putNumeric(map, "prediction_lead_seconds", lead);
  }
}

// ---------- Public builders ----------

export interface BuildInputs {
  row: PredictionRowForFeatures;
  history: CandleRow[]; // most-recent-first, strictly before target
}

export function buildGlobalCoreFeatures(inp: BuildInputs): FeatureMap {
  const map: FeatureMap = {};
  addRawSnapshotColumns(map, inp.row);
  addRawCategoricals(map, inp.row, "global");
  addDerivedPriceFeatures(map, inp.row, "global");
  addPartialSnapshotFeatures(map, inp.row, "global");
  addModuleFeatures(map, inp.row, false);
  addTimeFeatures(map, inp.row, "global");
  addHistoryFeatures(map, inp.history, "lag");
  return map;
}

export function buildRecentFullFeatures(inp: BuildInputs): FeatureMap {
  const map: FeatureMap = {};
  addRawSnapshotColumns(map, inp.row);
  addRawCategoricals(map, inp.row, "recent");
  addPartialSnapshotFeatures(map, inp.row, "recent");
  addModuleFeatures(map, inp.row, true);
  addTimeFeatures(map, inp.row, "recent");
  addDerivedPriceFeatures(map, inp.row, "recent");
  addScoreInteractions(map, inp.row);
  addConvictionFeatures(map, inp.row);
  addHistoryFeatures(map, inp.history, "core-and-x");

  // Embed global_core features under `core_` prefix per spec.
  const coreMap = buildGlobalCoreFeatures(inp);
  for (const [k, v] of Object.entries(coreMap)) {
    map[`core_${k}`] = v;
  }
  return map;
}
