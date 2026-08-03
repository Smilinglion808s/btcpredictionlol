// V6 technical-row builder.
//
// Reproduces, in TypeScript, the exact canonical BTC-USDT 15m technical row
// schema used to train the frozen V6 artifact (see
// V6_complete_model.json.training.input_part{1,2}_sha256).  Values are rounded
// to 6 decimals exactly as the canonical technical dataset was, so live rows
// are byte-identical in convention to the training rows.
//
// Pure functions; no IO.

export interface RawCandle {
  candle_ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type TechnicalRow = Record<string, number | string | boolean | null>;

const R = 1e6;
function r6(v: number): number {
  if (!Number.isFinite(v)) return NaN;
  return Math.round(v * R) / R;
}

function emaSeries(values: number[], period: number): number[] {
  const k = 2 / (period + 1);
  const out: number[] = [];
  let prev = values[0];
  out.push(prev);
  for (let i = 1; i < values.length; i++) {
    prev = values[i] * k + prev * (1 - k);
    out.push(prev);
  }
  return out;
}

function rollingMean(values: number[], period: number): number[] {
  const out: number[] = new Array(values.length).fill(NaN);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= period) sum -= values[i - period];
    if (i >= period - 1) out[i] = sum / period;
  }
  return out;
}

function linregSlope(w: number[]): number {
  const n = w.length;
  const mx = (n - 1) / 2;
  const my = w.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let k = 0; k < n; k++) {
    num += (k - mx) * (w[k] - my);
    den += (k - mx) * (k - mx);
  }
  return num / den;
}

function mean(a: number[]): number {
  return a.reduce((s, v) => s + v, 0) / a.length;
}

function stdevPop(a: number[]): number {
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / a.length);
}

function zoneOf(pos: number): string {
  if (!Number.isFinite(pos)) return "true_mid";
  if (pos < 0.2) return "support_edge";
  if (pos < 0.4) return "lower_mid";
  if (pos < 0.6) return "true_mid";
  if (pos < 0.8) return "upper_mid";
  return "resistance_edge";
}

function alignmentOf(e9: number, e21: number, e50: number): string {
  if (e9 > e21 && e21 > e50) return "UP";
  if (e9 < e21 && e21 < e50) return "DOWN";
  return "MIXED";
}

function safeDiv(n: number, d: number): number {
  return Number.isFinite(n) && Number.isFinite(d) && d !== 0 ? n / d : NaN;
}

/**
 * Build the canonical technical rows for a contiguous, oldest→newest list of
 * confirmed candles.  Returns one row per input candle; early rows lack full
 * warmup and must not be used for inference.
 */
export function buildTechnicalRows(candles: readonly RawCandle[]): TechnicalRow[] {
  const n = candles.length;
  const closes = candles.map((c) => c.close);
  const highs = candles.map((c) => c.high);
  const lows = candles.map((c) => c.low);
  const opens = candles.map((c) => c.open);
  const vols = candles.map((c) => c.volume);

  const ema9 = emaSeries(closes, 9);
  const ema21 = emaSeries(closes, 21);
  const ema50 = emaSeries(closes, 50);
  const ema200 = emaSeries(closes, 200);
  const ema12 = emaSeries(closes, 12);
  const ema26 = emaSeries(closes, 26);
  const macdLine = closes.map((_, i) => ema12[i] - ema26[i]);
  const macdSignal = emaSeries(macdLine, 9);

  // True range + Wilder ATR14
  const tr: number[] = [];
  for (let i = 0; i < n; i++) {
    const hl = highs[i] - lows[i];
    if (i === 0) tr.push(hl);
    else {
      const pc = closes[i - 1];
      tr.push(Math.max(hl, Math.abs(highs[i] - pc), Math.abs(lows[i] - pc)));
    }
  }
  const atr14 = rollingMean(tr, 14);

  // Wilder RSI14
  const gains: number[] = [0];
  const losses: number[] = [0];
  for (let i = 1; i < n; i++) {
    const ch = closes[i] - closes[i - 1];
    gains.push(Math.max(ch, 0));
    losses.push(Math.max(-ch, 0));
  }
  const rsi: number[] = new Array(n).fill(NaN);
  if (n > 14) {
    let ag = mean(gains.slice(1, 15));
    let al = mean(losses.slice(1, 15));
    rsi[14] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    for (let i = 15; i < n; i++) {
      ag = (ag * 13 + gains[i]) / 14;
      al = (al * 13 + losses[i]) / 14;
      rsi[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
    }
  }

  // Alignment + trend age
  const alignments: string[] = [];
  for (let i = 0; i < n; i++) alignments.push(alignmentOf(ema9[i], ema21[i], ema50[i]));
  const trendAge: number[] = [];
  for (let i = 0; i < n; i++) {
    let age = 1;
    while (i - age >= 0 && alignments[i - age] === alignments[i]) age++;
    trendAge.push(age);
  }

  // Per-candle primitives
  const dirs: string[] = [];
  const bodies: number[] = [];
  const ranges: number[] = [];
  const bodyPct: number[] = [];
  const upperPct: number[] = [];
  const lowerPct: number[] = [];
  for (let i = 0; i < n; i++) {
    const o = opens[i];
    const c = closes[i];
    dirs.push(c > o ? "GREEN" : c < o ? "RED" : "DOJI");
    const body = Math.abs(c - o);
    const range = highs[i] - lows[i];
    bodies.push(body);
    ranges.push(range);
    bodyPct.push(safeDiv(body, range));
    upperPct.push(safeDiv(highs[i] - Math.max(o, c), range));
    lowerPct.push(safeDiv(Math.min(o, c) - lows[i], range));
  }

  const stochK: number[] = new Array(n).fill(NaN);
  for (let i = 13; i < n; i++) {
    const hh = Math.max(...highs.slice(i - 13, i + 1));
    const ll = Math.min(...lows.slice(i - 13, i + 1));
    stochK[i] = hh === ll ? 50 : ((closes[i] - ll) / (hh - ll)) * 100;
  }
  const stochD: number[] = new Array(n).fill(NaN);
  for (let i = 2; i < n; i++) {
    const w = stochK.slice(i - 2, i + 1);
    if (w.every((v) => Number.isFinite(v))) stochD[i] = mean(w);
  }

  const signedVol: number[] = [];
  for (let i = 0; i < n; i++) {
    const s = dirs[i] === "GREEN" ? 1 : dirs[i] === "RED" ? -1 : 0;
    signedVol.push(vols[i] * s);
  }

  const rows: TechnicalRow[] = [];
  for (let i = 0; i < n; i++) {
    const c = candles[i];
    const close = closes[i];
    const prevClose = i > 0 ? closes[i - 1] : NaN;
    const dir = dirs[i];
    const dirNum = dir === "GREEN" ? 1 : dir === "RED" ? -1 : 0;

    const win20 = i >= 19 ? { lo: i - 19, hi: i } : null;
    const ranges20 = win20 ? ranges.slice(win20.lo, i + 1) : [];
    const closes20 = win20 ? closes.slice(win20.lo, i + 1) : [];
    const vols20 = win20 ? vols.slice(win20.lo, i + 1) : [];
    const avgRange20 = win20 ? mean(ranges20) : NaN;
    const sma20 = win20 ? mean(closes20) : NaN;
    const sd20 = win20 ? stdevPop(closes20) : NaN;
    const bbU = sma20 + 2 * sd20;
    const bbL = sma20 - 2 * sd20;
    const high20 = win20 ? Math.max(...highs.slice(win20.lo, i + 1)) : NaN;
    const low20 = win20 ? Math.min(...lows.slice(win20.lo, i + 1)) : NaN;
    const volAvg20 = win20 ? mean(vols20) : NaN;
    const volSd20 = win20 ? stdevPop(vols20) : NaN;
    const cumVolDelta20 = win20
      ? signedVol.slice(win20.lo, i + 1).reduce((s, v) => s + v, 0)
      : NaN;
    let vwapNum = 0;
    let vwapDen = 0;
    if (win20) {
      for (let j = win20.lo; j <= i; j++) {
        const tp = (highs[j] + lows[j] + closes[j]) / 3;
        vwapNum += tp * vols[j];
        vwapDen += vols[j];
      }
    }
    const vwap20 = win20 ? safeDiv(vwapNum, vwapDen) : NaN;

    const channelWidth = high20 - low20;
    const channelPos = safeDiv(close - low20, channelWidth);

    // 4-candle path window (current + prior 3)
    const has4 = i >= 3;
    const netDisplacement4 = i >= 4 ? close - closes[i - 4] : NaN;
    const totalBodyPath4 = has4
      ? bodies.slice(i - 3, i + 1).reduce((s, v) => s + v, 0)
      : NaN;
    const pathEff4 = has4 ? safeDiv(Math.abs(netDisplacement4), totalBodyPath4) : NaN;
    const alignedWick4 = has4
      ? mean(
          [0, 1, 2, 3].map((k) => {
            const j = i - 3 + k;
            return upperPct[j] - lowerPct[j];
          }),
        )
      : NaN;
    const low4 = has4 ? Math.min(...lows.slice(i - 3, i + 1)) : NaN;
    const high4 = has4 ? Math.max(...highs.slice(i - 3, i + 1)) : NaN;

    // Streaks / structure
    let streak = dir === "DOJI" ? 0 : 1;
    if (dir !== "DOJI") {
      while (i - streak >= 0 && dirs[i - streak] === dir) streak++;
    }

    const higherLow4 =
      i >= 3 &&
      lows[i] > lows[i - 1] &&
      lows[i - 1] > lows[i - 2] &&
      lows[i - 2] > lows[i - 3];
    const lowerHigh4 =
      i >= 3 &&
      highs[i] < highs[i - 1] &&
      highs[i - 1] < highs[i - 2] &&
      highs[i - 2] < highs[i - 3];

    const priorHigh20 = i >= 20 ? Math.max(...highs.slice(i - 20, i)) : NaN;
    const priorLow20 = i >= 20 ? Math.min(...lows.slice(i - 20, i)) : NaN;
    const failedBreakUp =
      Number.isFinite(priorHigh20) && highs[i] > priorHigh20 && close < priorHigh20;
    const failedBreakDown =
      Number.isFinite(priorLow20) && lows[i] < priorLow20 && close > priorLow20;

    const bullSweep = i >= 1 && lows[i] < lows[i - 1] && close > closes[i - 1];
    const bearSweep = i >= 1 && highs[i] > highs[i - 1] && close < closes[i - 1];

    const insideBar = i >= 1 && highs[i] <= highs[i - 1] && lows[i] >= lows[i - 1];
    const outsideBar = i >= 1 && highs[i] > highs[i - 1] && lows[i] < lows[i - 1];

    const meanBody2 = i >= 1 ? mean([bodyPct[i - 1], bodyPct[i]]) : NaN;

    const closeSlope8 =
      i >= 7 ? safeDiv(linregSlope(closes.slice(i - 7, i + 1)), avgRange20) : NaN;

    const row: TechnicalRow = {
      candle_ts: c.candle_ts,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      confirm: true,
      fetch_source: "okx",
      direction: dir,
      body: r6(bodies[i]),
      range: r6(ranges[i]),
      body_pct_of_range: r6(bodyPct[i]),
      upper_wick: r6(highs[i] - Math.max(opens[i], close)),
      lower_wick: r6(Math.min(opens[i], close) - lows[i]),
      upper_wick_pct: r6(upperPct[i]),
      lower_wick_pct: r6(lowerPct[i]),
      close_position_in_range: r6(safeDiv(close - lows[i], ranges[i])),
      change_abs: r6(close - opens[i]),
      change_pct: r6(safeDiv(close - opens[i], opens[i]) * 100),
      gap_from_prev_close: r6(opens[i] - prevClose),
      true_range: r6(tr[i]),
      ema9: r6(ema9[i]),
      ema21: r6(ema21[i]),
      ema50: r6(ema50[i]),
      ema200: r6(ema200[i]),
      sma20: r6(sma20),
      ema9_minus_ema21: r6(ema9[i] - ema21[i]),
      ema21_minus_ema50: r6(ema21[i] - ema50[i]),
      dist_from_ema9_pct: r6(safeDiv(close - ema9[i], close) * 100),
      dist_from_ema21_pct: r6(safeDiv(close - ema21[i], close) * 100),
      dist_from_ema50_pct: r6(safeDiv(close - ema50[i], close) * 100),
      ema_alignment: alignments[i],
      trend_age_candles: trendAge[i],
      close_slope_8: r6(closeSlope8),
      atr14: r6(atr14[i]),
      atr14_pct: r6(safeDiv(atr14[i], close) * 100),
      avg_range_20: r6(avgRange20),
      range_expansion_vs_avg20: r6(safeDiv(ranges[i], avgRange20)),
      stdev_close_20: r6(sd20),
      bb_upper_20_2: r6(bbU),
      bb_lower_20_2: r6(bbL),
      bb_width_pct: r6(safeDiv(bbU - bbL, close) * 100),
      bb_position: r6(safeDiv(close - bbL, bbU - bbL)),
      rsi14: r6(rsi[i]),
      macd_line: r6(macdLine[i]),
      macd_signal: r6(macdSignal[i]),
      macd_hist: r6(macdLine[i] - macdSignal[i]),
      macd_hist_over_atr14: r6(safeDiv(macdLine[i] - macdSignal[i], atr14[i])),
      roc_4: i >= 4 ? r6((close / closes[i - 4] - 1) * 100) : NaN,
      roc_8: i >= 8 ? r6((close / closes[i - 8] - 1) * 100) : NaN,
      momentum_8_over_atr: i >= 8 ? r6(safeDiv(close - closes[i - 8], atr14[i])) : NaN,
      stoch_k14: r6(stochK[i]),
      stoch_d3: r6(stochD[i]),
      high_20: r6(high20),
      low_20: r6(low20),
      channel_width_pct: r6(safeDiv(channelWidth, close) * 100),
      channel_position_0_1: r6(channelPos),
      channel_zone: zoneOf(channelPos),
      dist_to_high20_pct: r6(safeDiv(high20 - close, close) * 100),
      dist_to_low20_pct: r6(safeDiv(close - low20, close) * 100),
      same_color_streak: streak,
      higher_low_sequence_4: higherLow4,
      lower_high_sequence_4: lowerHigh4,
      failed_breakout_up: failedBreakUp,
      failed_breakout_down: failedBreakDown,
      bullish_liquidity_sweep: bullSweep,
      bearish_liquidity_sweep: bearSweep,
      inside_bar: insideBar,
      outside_bar: outsideBar,
      vol_avg_20: r6(volAvg20),
      volume_expansion: r6(safeDiv(vols[i], volAvg20)),
      vol_zscore_20: r6(safeDiv(vols[i] - volAvg20, volSd20)),
      signed_volume: r6(signedVol[i]),
      cum_volume_delta_20: r6(cumVolDelta20),
      vwap_20: r6(vwap20),
      dist_from_vwap20_pct: r6(safeDiv(close - vwap20, close) * 100),
      net_displacement_4: r6(netDisplacement4),
      total_body_path_4: r6(totalBodyPath4),
      path_efficiency_4: r6(pathEff4),
      aligned_wick_pressure_4: r6(alignedWick4),
      dist_from_4_candle_low_bps: r6(safeDiv(close - low4, close) * 10000),
      dist_from_4_candle_high_bps: r6(safeDiv(high4 - close, close) * 10000),
      mean_body_to_range_2: r6(meanBody2),
    };
    void dirNum;
    rows.push(row);
  }
  return rows;
}
