// ES1 minimal-8 feature construction from the canonical OKX 15m candle stream.
//
// Every feature for target T is computed from candles ending no later than
// T-15m. A gap in the canonical stream starts a new feature segment: no
// return, efficiency or rolling value is ever computed across a gap.

import {
  ES1_FEATURES,
  ES1_MIN_SEGMENT_LENGTH,
  ES1_SEGMENT_WARMUP,
  TF_MS,
  sha256,
  type Es1FeatureName,
} from "./config";

export interface CanonicalCandle {
  candleTs: string; // ISO, boundary of the candle
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
}

export type Direction = "GREEN" | "RED";
export type ActualDirection = "GREEN" | "RED" | "PUSH";

export function canonicalDirection(open: number, close: number): ActualDirection {
  if (close > open) return "GREEN";
  if (close < open) return "RED";
  return "PUSH";
}

export interface FeatureRow {
  /** Target candle (the candle being predicted). */
  targetTs: string;
  /** Latest completed source candle used for features (= target - 15m). */
  latestSourceTs: string;
  /** Feature cutoff (target - 1ms). */
  featureCutoffTs: string;
  segmentId: number;
  values: Record<Es1FeatureName, number>;
  vector: number[];
  vectorHash: string;
  valid: boolean;
  invalidReason: string | null;
  /** Canonical outcome of the target candle, when the target candle exists. */
  actualDirection: ActualDirection | null;
  actualOpen: number | null;
  actualHigh: number | null;
  actualLow: number | null;
  actualClose: number | null;
  actualVolume: number | null;
}

function finite(n: number): boolean {
  return Number.isFinite(n);
}

/** Split the canonical stream into gap-free segments of exact 15m spacing. */
export function segmentCandles(candles: readonly CanonicalCandle[]): CanonicalCandle[][] {
  const segments: CanonicalCandle[][] = [];
  let current: CanonicalCandle[] = [];
  let prevMs: number | null = null;
  for (const c of candles) {
    const ms = new Date(c.candleTs).getTime();
    if (prevMs != null && ms - prevMs !== TF_MS) {
      if (current.length) segments.push(current);
      current = [];
    }
    current.push(c);
    prevMs = ms;
  }
  if (current.length) segments.push(current);
  return segments;
}

/** Compute the eight ES1 features on candle index `t` inside one segment. */
export function computeFeatures(
  seg: readonly CanonicalCandle[],
  t: number,
): { values: Record<Es1FeatureName, number>; valid: boolean; reason: string | null } {
  const empty = Object.fromEntries(ES1_FEATURES.map((f) => [f, NaN])) as Record<
    Es1FeatureName,
    number
  >;
  if (t < ES1_SEGMENT_WARMUP)
    return { values: empty, valid: false, reason: "insufficient_segment_history" };
  const c = seg[t];
  const closeAt = (k: number) => seg[t - k].close;

  const values = { ...empty };
  for (const n of [1, 2, 4, 8, 16] as const) {
    const a = closeAt(0);
    const b = closeAt(n);
    if (!(a > 0) || !(b > 0)) return { values: empty, valid: false, reason: "nonpositive_close" };
    values[`return_${n}` as Es1FeatureName] = Math.log(a) - Math.log(b);
  }

  let path = 0;
  for (let k = 0; k < 8; k++) path += Math.abs(seg[t - k].close - seg[t - k - 1].close);
  if (!(path > 0)) return { values: empty, valid: false, reason: "zero_path" };
  values.signed_efficiency_8 = (closeAt(0) - closeAt(8)) / path;

  const range = c.high - c.low;
  if (!(range > 0)) return { values: empty, valid: false, reason: "zero_range" };
  values.close_location = (2 * (c.close - c.low)) / range - 1;

  const upperWick = c.high - Math.max(c.open, c.close);
  const lowerWick = Math.min(c.open, c.close) - c.low;
  values.wick_balance = (lowerWick - upperWick) / range;

  for (const f of ES1_FEATURES) {
    if (!finite(values[f])) return { values: empty, valid: false, reason: `nonfinite_${f}` };
  }
  return { values, valid: true, reason: null };
}

/**
 * Build one feature row per target boundary. The feature vector is shifted a
 * single target forward: candles through T-15m predict target T.
 */
export function buildFeatureRows(candles: readonly CanonicalCandle[]): FeatureRow[] {
  const byTs = new Map(candles.map((c) => [new Date(c.candleTs).getTime(), c]));
  const segments = segmentCandles(candles);
  const out: FeatureRow[] = [];
  segments.forEach((seg, segmentId) => {
    const shortSegment = seg.length < ES1_MIN_SEGMENT_LENGTH;
    for (let t = 0; t < seg.length; t++) {
      const sourceMs = new Date(seg[t].candleTs).getTime();
      const targetMs = sourceMs + TF_MS;
      const computed = computeFeatures(seg, t);
      const valid = computed.valid && !shortSegment;
      const reason = computed.valid && shortSegment ? "short_segment" : computed.reason;
      const values = computed.values;
      const vector = ES1_FEATURES.map((f) => values[f]);

      const target = byTs.get(targetMs) ?? null;
      out.push({
        targetTs: new Date(targetMs).toISOString(),
        latestSourceTs: seg[t].candleTs,
        featureCutoffTs: new Date(targetMs - 1).toISOString(),
        segmentId,
        values,
        vector,
        vectorHash: valid ? sha256(vector.map((v) => v.toFixed(12))) : "",
        valid,
        invalidReason: reason,
        actualDirection: target ? canonicalDirection(target.open, target.close) : null,
        actualOpen: target?.open ?? null,
        actualHigh: target?.high ?? null,
        actualLow: target?.low ?? null,
        actualClose: target?.close ?? null,
        actualVolume: target?.volume ?? null,
      });
    }
  });
  out.sort((a, b) => a.targetTs.localeCompare(b.targetTs));
  return out;
}
