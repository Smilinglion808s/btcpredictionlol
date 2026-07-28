// Model 3 — Selective Edge R1 feature builder.
// 21 direction features per row, using only candles[0..i] (no leakage).

export interface Candle {
  ts: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export const M3SE_FEATURE_NAMES = [
  "ret_log_1",
  "ret_log_2",
  "ret_log_4",
  "ret_log_8",
  "ret_log_16",
  "body_to_atr",
  "range_to_atr",
  "wick_imbalance",
  "close_location_in_range",
  "ema9_minus_ema21_to_atr",
  "ema21_minus_ema50_to_atr",
  "price_minus_ema21_to_atr",
  "rolling_position_16",
  "rolling_position_32",
  "rsi14_centered",
  "realized_volatility_8_to_32",
  "atr_percentile_256",
  "range_percentile_256",
  "trend_efficiency_8",
  "trend_efficiency_32",
  "volume_zscore_32",
] as const;
export type M3SEFeatureName = (typeof M3SE_FEATURE_NAMES)[number];
export const M3SE_FEATURE_COUNT = M3SE_FEATURE_NAMES.length;

// R1 aligned features (kept for backwards compatibility with R1 rows).
export const M3SE_ALIGNED_FEATURE_NAMES = [
  "aligned_ret_log_1",
  "aligned_ret_log_2",
  "aligned_ret_log_4",
  "aligned_ret_log_8",
  "aligned_body_to_atr",
  "aligned_ema9_minus_ema21_to_atr",
  "aligned_ema21_minus_ema50_to_atr",
  "aligned_rsi14_centered",
  "aligned_trend_efficiency_32",
  "aligned_realized_volatility_8_to_32",
] as const;
export const M3SE_ALIGNED_FEATURE_COUNT = M3SE_ALIGNED_FEATURE_NAMES.length;

// R2 selector inputs (§5 of the R2 spec). 5 expert-consensus + 6 aligned/magnitude fields.
export const M3SE_SELECTOR_V2_FEATURE_NAMES = [
  "signed_consensus",
  "consensus_strength",
  "expert_agreement",
  "expert_disagreement",
  "stacker_logit_margin",
  "aligned_trend_strength",
  "aligned_return_8",
  "aligned_stretch",
  "wick_dominance",
  "volatility_ratio",
  "volume_zscore",
] as const;
export const M3SE_SELECTOR_V2_FEATURE_COUNT = M3SE_SELECTOR_V2_FEATURE_NAMES.length;

const ALIGNED_SIGN_MAP: Array<{ idx: number; signed: boolean }> = [
  { idx: 0, signed: true },
  { idx: 1, signed: true },
  { idx: 2, signed: true },
  { idx: 3, signed: true },
  { idx: 5, signed: false },
  { idx: 9, signed: true },
  { idx: 10, signed: true },
  { idx: 14, signed: true },
  { idx: 19, signed: true },
  { idx: 15, signed: false },
];

export function buildAlignedFromDirection(
  featureRow: number[],
  direction: "GREEN" | "RED",
): number[] {
  const sign = direction === "GREEN" ? 1 : -1;
  const out = new Array<number>(M3SE_ALIGNED_FEATURE_COUNT);
  for (let k = 0; k < ALIGNED_SIGN_MAP.length; k++) {
    const { idx, signed } = ALIGNED_SIGN_MAP[k];
    const raw = featureRow[idx] ?? 0;
    out[k] = signed ? raw * sign : Math.abs(raw);
  }
  return out;
}

// R2 consensus features derived from expert logits.
export interface M3SEConsensus {
  signedConsensus: number;
  consensusStrength: number;
  expertAgreement: 0 | 1;
  expertDisagreement: number;
  minimumExpertStrength: number;
  stackerLogitMargin: number;
}

export function computeM3SEConsensus(
  rawDir: "GREEN" | "RED",
  zSlow: number,
  zFast: number,
  zStack: number,
): M3SEConsensus {
  const dirSign = rawDir === "GREEN" ? 1 : -1;
  const agreement: 0 | 1 = Math.sign(zSlow) === Math.sign(zFast) ? 1 : 0;
  const minAbs = Math.min(Math.abs(zSlow), Math.abs(zFast));
  return {
    signedConsensus: dirSign * (zSlow + zFast) / 2,
    consensusStrength: agreement === 1 ? minAbs : -minAbs,
    expertAgreement: agreement,
    expertDisagreement: Math.abs(zSlow - zFast),
    minimumExpertStrength: minAbs,
    stackerLogitMargin: Math.abs(zStack),
  };
}

// R2 selector row builder (§5).
export function buildSelectorRowV2(
  rawFeatures: number[],
  rawDir: "GREEN" | "RED",
  consensus: M3SEConsensus,
): number[] {
  const dirSign = rawDir === "GREEN" ? 1 : -1;
  return [
    consensus.signedConsensus,
    consensus.consensusStrength,
    consensus.expertAgreement,
    consensus.expertDisagreement,
    consensus.stackerLogitMargin,
    (rawFeatures[19] ?? 0) * dirSign,   // aligned_trend_strength (trend_efficiency_32)
    (rawFeatures[3] ?? 0) * dirSign,    // aligned_return_8 (ret_log_8)
    (rawFeatures[11] ?? 0) * dirSign,   // aligned_stretch  (price - ema21) / atr
    Math.abs(rawFeatures[7] ?? 0),      // wick_dominance
    rawFeatures[15] ?? 0,               // volatility_ratio (realized_vol_8_to_32)
    rawFeatures[20] ?? 0,               // volume_zscore
  ];
}


// ------------ Indicators ------------
function ema(values: number[], span: number): number[] {
  const out = new Array<number>(values.length).fill(0);
  if (values.length === 0) return out;
  const k = 2 / (span + 1);
  out[0] = values[0];
  for (let i = 1; i < values.length; i++) out[i] = values[i] * k + out[i - 1] * (1 - k);
  return out;
}

function rsi(closes: number[], period = 14): number[] {
  const out = new Array<number>(closes.length).fill(50);
  if (closes.length < period + 1) return out;
  let g = 0, l = 0;
  for (let i = 1; i <= period; i++) {
    const d = closes[i] - closes[i - 1];
    if (d >= 0) g += d; else l -= d;
  }
  let ag = g / period, al = l / period;
  out[period] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  for (let i = period + 1; i < closes.length; i++) {
    const d = closes[i] - closes[i - 1];
    const gg = d > 0 ? d : 0;
    const ll = d < 0 ? -d : 0;
    ag = (ag * (period - 1) + gg) / period;
    al = (al * (period - 1) + ll) / period;
    out[i] = al === 0 ? 100 : 100 - 100 / (1 + ag / al);
  }
  return out;
}

function trueRange(c: Candle, prev: Candle | null): number {
  const hl = c.high - c.low;
  if (!prev) return hl;
  return Math.max(hl, Math.abs(c.high - prev.close), Math.abs(c.low - prev.close));
}

function atr(candles: Candle[], period = 14): number[] {
  const trs: number[] = new Array(candles.length).fill(0);
  for (let i = 0; i < candles.length; i++) trs[i] = trueRange(candles[i], i > 0 ? candles[i - 1] : null);
  const out: number[] = new Array(candles.length).fill(0);
  if (candles.length === 0) return out;
  let sum = 0;
  for (let i = 0; i < Math.min(period, candles.length); i++) sum += trs[i];
  out[Math.min(period, candles.length) - 1] = sum / Math.min(period, candles.length);
  for (let i = period; i < candles.length; i++) {
    out[i] = (out[i - 1] * (period - 1) + trs[i]) / period;
  }
  // Backfill: at least trs[i] for early rows to avoid divide-by-zero.
  for (let i = 0; i < candles.length; i++) if (out[i] <= 0) out[i] = Math.max(trs[i], 1e-9);
  return out;
}

function safeLog(a: number, b: number): number {
  if (a <= 0 || b <= 0) return 0;
  return Math.log(a / b);
}

function percentileRank(window: number[], value: number): number {
  if (window.length === 0) return 0.5;
  let below = 0;
  for (const v of window) if (v <= value) below++;
  return below / window.length;
}

// ------------ Feature row for index i (uses only candles[0..i]) ------------
function featRow(
  candles: Candle[],
  i: number,
  closes: number[],
  ema9: number[],
  ema21: number[],
  ema50: number[],
  rsi14: number[],
  atr14: number[],
): number[] {
  const c = candles[i];
  const a = atr14[i] || 1e-9;
  const range = c.high - c.low;
  const body = c.close - c.open;
  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  const wickImb = range > 0 ? (upperWick - lowerWick) / range : 0;
  const clr = range > 0 ? (c.close - c.low) / range : 0.5;

  // Rolling position over lookback L: (close - min(low)) / (max(high)-min(low))
  const rp = (L: number) => {
    const s = Math.max(0, i - L + 1);
    let hi = -Infinity, lo = Infinity;
    for (let k = s; k <= i; k++) { if (candles[k].high > hi) hi = candles[k].high; if (candles[k].low < lo) lo = candles[k].low; }
    return hi > lo ? (c.close - lo) / (hi - lo) : 0.5;
  };

  // Realized vol ratio: std(ret_1) over 8 / over 32.
  const rets: number[] = [];
  const start32 = Math.max(1, i - 31);
  for (let k = start32; k <= i; k++) rets.push(safeLog(closes[k], closes[k - 1]));
  const std = (arr: number[]) => {
    if (arr.length === 0) return 0;
    const m = arr.reduce((a2, b2) => a2 + b2, 0) / arr.length;
    let s = 0; for (const v of arr) s += (v - m) * (v - m);
    return Math.sqrt(s / arr.length);
  };
  const last8 = rets.slice(-8);
  const rv8 = std(last8);
  const rv32 = std(rets);
  const rvRatio = rv32 > 1e-12 ? rv8 / rv32 : 1;

  // ATR / range percentile in 256 window (magnitude / close).
  const wSz = Math.min(256, i + 1);
  const atrNorm: number[] = new Array(wSz);
  const rngNorm: number[] = new Array(wSz);
  for (let k = 0; k < wSz; k++) {
    const j = i - (wSz - 1 - k);
    atrNorm[k] = closes[j] > 0 ? atr14[j] / closes[j] : 0;
    rngNorm[k] = closes[j] > 0 ? (candles[j].high - candles[j].low) / closes[j] : 0;
  }
  const atrCurNorm = c.close > 0 ? a / c.close : 0;
  const rngCurNorm = c.close > 0 ? range / c.close : 0;
  const atrPct = percentileRank(atrNorm, atrCurNorm);
  const rngPct = percentileRank(rngNorm, rngCurNorm);

  // Trend efficiency over horizon h: (close_t - close_{t-h}) / sum(|Δ|).
  const trendEff = (h: number) => {
    if (i - h < 0) return 0;
    let denom = 0;
    for (let k = i - h + 1; k <= i; k++) denom += Math.abs(closes[k] - closes[k - 1]);
    return denom > 1e-12 ? (closes[i] - closes[i - h]) / denom : 0;
  };

  // Volume z-score over 32 (drop current from stats to avoid self-normalization? spec is silent; use full window).
  let volMean = 0, volVar = 0;
  const vStart = Math.max(0, i - 31);
  const vN = i - vStart + 1;
  for (let k = vStart; k <= i; k++) volMean += candles[k].volume;
  volMean /= Math.max(1, vN);
  for (let k = vStart; k <= i; k++) volVar += (candles[k].volume - volMean) ** 2;
  const volSd = Math.sqrt(volVar / Math.max(1, vN));
  const volZ = volSd > 1e-9 ? (c.volume - volMean) / volSd : 0;

  return [
    i >= 1  ? safeLog(closes[i], closes[i - 1])  : 0,
    i >= 2  ? safeLog(closes[i], closes[i - 2])  : 0,
    i >= 4  ? safeLog(closes[i], closes[i - 4])  : 0,
    i >= 8  ? safeLog(closes[i], closes[i - 8])  : 0,
    i >= 16 ? safeLog(closes[i], closes[i - 16]) : 0,
    body / a,
    range / a,
    wickImb,
    clr,
    (ema9[i] - ema21[i]) / a,
    (ema21[i] - ema50[i]) / a,
    (c.close - ema21[i]) / a,
    rp(16),
    rp(32),
    (rsi14[i] - 50) / 50,
    rvRatio,
    atrPct,
    rngPct,
    trendEff(8),
    trendEff(32),
    volZ,
  ];
}

/** Build labeled matrix + target feature row for the newest index. */
export function buildTrainingMatrix(candles: Candle[]): {
  X: number[][];
  y: number[];              // 1 for GREEN, 0 for RED (PUSH dropped)
  rowTimestamps: string[];  // ts of the CURRENT candle (i.e. features).
                            // Label refers to candles[i+1].
  targetFeatureRow: number[];
} {
  const n = candles.length;
  const closes = candles.map((c) => c.close);
  const ema9  = ema(closes, 9);
  const ema21 = ema(closes, 21);
  const ema50 = ema(closes, 50);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(candles, 14);

  const X: number[][] = [];
  const y: number[] = [];
  const rowTimestamps: string[] = [];

  const MIN_I = 50; // ema50 needs a warmup
  for (let i = MIN_I; i < n - 1; i++) {
    const nxt = candles[i + 1];
    if (nxt.close === nxt.open) continue;
    X.push(featRow(candles, i, closes, ema9, ema21, ema50, rsi14, atr14));
    y.push(nxt.close > nxt.open ? 1 : 0);
    rowTimestamps.push(candles[i].ts);
  }
  const targetFeatureRow = n > 0
    ? featRow(candles, n - 1, closes, ema9, ema21, ema50, rsi14, atr14)
    : new Array(M3SE_FEATURE_COUNT).fill(0);

  return { X, y, rowTimestamps, targetFeatureRow };
}
