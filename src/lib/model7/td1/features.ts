// TD1-RC feature builder. Deterministic, no randomness. All inputs must be
// strictly before target_boundary_ts. Caller enforces cutoff via `candles` and
// `priorA2Signals` filtered upstream.

import type { Candle } from "../featurize";
import { TD1_FEATURE_ORDER, type Td1Features } from "./decision";

export type Side = "YES" | "NO";

export interface PriorA2Signal {
  candle_ts: string;
  final_decision: Side; // A2_Combined resolved eligible signals only
  counterfactual_result: "WIN" | "LOSS"; // needed for warmup accounting, not features
}

const EPS = 1e-12;
const VOL_FLOOR = 1e-8;

function toRet(prevClose: number, curClose: number): number {
  return Math.log(curClose / prevClose);
}

/** returns array of log-returns newest-first from candles newest-first (need n+1 candles) */
function returns(candlesNewestFirst: Candle[]): number[] {
  const out: number[] = [];
  for (let i = 0; i < candlesNewestFirst.length - 1; i += 1) {
    const cur = candlesNewestFirst[i];
    const prev = candlesNewestFirst[i + 1];
    if (!(cur.close > 0) || !(prev.close > 0)) return [];
    out.push(toRet(prev.close, cur.close));
  }
  return out;
}

function sampleStd(xs: number[]): number {
  if (xs.length < 2) return VOL_FLOOR;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const v = xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1);
  return Math.max(Math.sqrt(v), VOL_FLOOR);
}

function atr20(candlesNewestFirst: Candle[]): number {
  const n = Math.min(20, candlesNewestFirst.length - 1);
  if (n < 1) return VOL_FLOOR;
  let sum = 0;
  for (let i = 0; i < n; i += 1) {
    const cur = candlesNewestFirst[i];
    const prev = candlesNewestFirst[i + 1];
    const tr = Math.max(
      cur.high - cur.low,
      Math.abs(cur.high - prev.close),
      Math.abs(cur.low - prev.close),
    );
    sum += tr;
  }
  return Math.max(sum / n, VOL_FLOOR);
}

export interface BuildFeaturesArgs {
  currentSide: Side;
  probabilityGreen: number;
  /** Canonical 15m OHLC newest-first, all candle_ts strictly before target_boundary_ts.
   *  Must contain >=21 candles so 20 returns are computable. */
  candlesNewestFirst: Candle[];
  /** Prior resolved eligible A2_Combined signals newest-first, all candle_ts strictly
   *  before target_boundary_ts. Need >= 8 for 8-window features. */
  priorA2SignalsNewestFirst: PriorA2Signal[];
}

export interface BuildFeaturesResult {
  features: Td1Features;
  latestSourceCandleTs: string;
  featureCutoffTs: string;
}

export function buildTd1Features(args: BuildFeaturesArgs): BuildFeaturesResult {
  const { currentSide, probabilityGreen, candlesNewestFirst: c, priorA2SignalsNewestFirst: pa } = args;
  if (c.length < 21) throw new Error("TD1_HISTORY_INSUFFICIENT_CANDLES");
  if (pa.length < 8) throw new Error("TD1_HISTORY_INSUFFICIENT_A2_SIGNALS");

  const sideEnc = currentSide === "YES" ? 1 : -1;

  // returns newest-first, length = c.length - 1
  const rets = returns(c);
  if (rets.length < 20) throw new Error("TD1_RETURNS_INSUFFICIENT");
  const r20 = rets.slice(0, 20);
  const r12 = rets.slice(0, 12);
  const r8 = rets.slice(0, 8);
  const r4 = rets.slice(0, 4);

  const sigma20 = sampleStd(r20);

  const sum = (xs: number[]) => xs.reduce((a, b) => a + b, 0);
  const opp4 = -sideEnc * sum(r4) / (sigma20 * Math.sqrt(4));
  const opp8 = -sideEnc * sum(r8) / (sigma20 * Math.sqrt(8));
  const opp12 = -sideEnc * sum(r12) / (sigma20 * Math.sqrt(12));

  const absSum8 = sum(r8.map(Math.abs));
  const eff8 = Math.abs(sum(r8)) / Math.max(absSum8, EPS);

  // reversal rate: opposite-sign adjacent pairs among latest 8 non-zero returns
  const nz = r8.filter((x) => x !== 0);
  let pairs = 0, opp = 0;
  for (let i = 0; i < nz.length - 1; i += 1) {
    pairs += 1;
    if ((nz[i] > 0 && nz[i + 1] < 0) || (nz[i] < 0 && nz[i + 1] > 0)) opp += 1;
  }
  const reversal8 = opp / Math.max(pairs, 1);

  // oriented close position over latest 8 completed candles (newest 8 of c)
  const c8 = c.slice(0, 8);
  const closes8 = c8.map((k) => k.close);
  const latestClose = closes8[0];
  const minC = Math.min(...closes8);
  const maxC = Math.max(...closes8);
  const p = (latestClose - minC) / Math.max(maxC - minC, EPS);
  const orientedClose = currentSide === "YES" ? 1 - p : p;

  // oriented structure shift 4
  const latest4 = c.slice(0, 4);
  const prior4 = c.slice(4, 8);
  const atr = atr20(c);
  let structShift: number;
  if (currentSide === "NO") {
    structShift = (Math.min(...latest4.map((k) => k.low)) - Math.min(...prior4.map((k) => k.low))) / atr;
  } else {
    structShift = (Math.max(...prior4.map((k) => k.high)) - Math.max(...latest4.map((k) => k.high))) / atr;
  }

  // short-long drift shift
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const prior12 = rets.slice(4, 16); // 12 returns immediately before latest 4
  const sldShift = -sideEnc * (mean(r4) - mean(prior12)) / sigma20;

  // A2 signal windows (newest-first, 8)
  const pa8 = pa.slice(0, 8);
  const sameSideShare8 = pa8.filter((s) => (s.final_decision === "YES" ? 1 : -1) === sideEnc).length / 8;
  const signedSum8 = pa8.reduce((a, s) => a + (s.final_decision === "YES" ? 1 : -1), 0);
  const signedLean8 = sideEnc * signedSum8 / 8;

  // consecutive same-side run in immediately previous signals, cap 12
  let run = 0;
  for (const s of pa) {
    if ((s.final_decision === "YES" ? 1 : -1) === sideEnc) run += 1;
    else break;
    if (run >= 12) break;
  }
  const runLen = Math.min(run, 12);

  // bias origin: start of the current same-side run. origin_close is the
  // canonical close immediately before that run's first target candle.
  let biasDisp = 0;
  let biasHold = 0;
  if (run > 0) {
    // pa[run-1] is the oldest signal in the current same-side run.
    const originSignal = pa[run - 1];
    const originTs = originSignal.candle_ts;
    // origin_close: latest completed candle with candle_ts < originTs (strictly earlier).
    const originCandle = c.find((k) => k.candle_ts < originTs);
    if (originCandle && originCandle.close > 0 && latestClose > 0) {
      biasDisp = -sideEnc * Math.log(latestClose / originCandle.close) / sigma20;
      // hold count: consecutive completed candles ending at latest, remaining
      // beyond origin_close against current side; cap 12
      const originClose = originCandle.close;
      let hold = 0;
      for (let i = 0; i < c.length && i < 12; i += 1) {
        const cl = c[i].close;
        const beyond = currentSide === "NO" ? cl > originClose : cl < originClose;
        if (beyond) hold += 1;
        else break;
      }
      biasHold = hold;
    }
  }

  const currentConf = currentSide === "YES" ? probabilityGreen : 1 - probabilityGreen;

  const features: Td1Features = {
    current_side: sideEnc,
    current_directional_confidence: currentConf,
    same_side_share_8: sameSideShare8,
    signed_lean_8: signedLean8,
    same_direction_run_length: runLen,
    sigma_20: sigma20,
    opposing_drift_4: opp4,
    opposing_drift_8: opp8,
    opposing_drift_12: opp12,
    efficiency_ratio_8: eff8,
    reversal_rate_8: reversal8,
    oriented_close_position_8: orientedClose,
    oriented_structure_shift_4: structShift,
    short_long_drift_shift: sldShift,
    bias_origin_displacement: biasDisp,
    bias_origin_hold_count: biasHold,
  };

  // validate finite
  for (const k of TD1_FEATURE_ORDER) {
    if (!Number.isFinite(features[k])) throw new Error(`TD1_FEATURE_NONFINITE:${k}`);
  }

  return {
    features,
    latestSourceCandleTs: c[0].candle_ts,
    featureCutoffTs: c[0].candle_ts,
  };
}

/** Canonical hex sha256 of feature vector in frozen order. */
export async function hashFeatureVector(f: Td1Features): Promise<string> {
  const canonical = TD1_FEATURE_ORDER.map((k) => `${k}=${f[k]}`).join("|");
  const buf = new TextEncoder().encode(canonical);
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, "0")).join("");
}
