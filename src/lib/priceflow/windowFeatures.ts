// PriceFlow window features — the single source of truth for the T45 and T30
// prediction-time formulas.
//
// This is the frozen T45 research reference (`build_t45_features_reference.py
// :: group_spot_target`) generalized over the observation horizon. T45 uses
// {full:45, short:15, mid:20?} — see PF45_SPEC below — and T30 uses the
// proportionally scaled {full:30, short:10, mid:20} horizons.
//
// `src/lib/t45/features.ts` keeps its own byte-identical copy so the certified
// T45 artifact can never be perturbed by a T30 change; the parity test in
// `src/lib/priceflow/__tests__/parity.test.ts` proves the two agree exactly on
// random packets, so the formulas cannot silently drift.

export interface PFSecondBar {
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

export interface PFWindowSpec {
  /** Column-name prefix, e.g. "t45" or "t30". */
  prefix: string;
  /** Number of one-second bars in the packet (offsets 0..full-1). */
  full: number;
  /** Short window, e.g. 15 for T45, 10 for T30. Also the "last N" horizon. */
  short: number;
  /** Middle window, e.g. 30 for T45, 20 for T30. */
  mid: number;
  /** Cumulative windows, ascending, last entry === full. */
  windows: readonly number[];
}

export const PF45_SPEC: PFWindowSpec = {
  prefix: "t45",
  full: 45,
  short: 15,
  mid: 30,
  windows: [5, 15, 30, 45],
};

export const PF30_SPEC: PFWindowSpec = {
  prefix: "t30",
  full: 30,
  short: 10,
  mid: 20,
  windows: [5, 10, 20, 30],
};

export type PFFeatureMap = Record<string, number | null>;

export interface PFFeatureResult {
  values: PFFeatureMap;
  secondsPresent: number;
  spotComplete: boolean;
  invalidReason: string | null;
}

function sign(v: number): number {
  return v > 0 ? 1 : v < 0 ? -1 : 0;
}

function finite(v: number): number | null {
  return Number.isFinite(v) ? v : null;
}

/**
 * Build the prediction-time feature map from the packet's one-second bars.
 * No rounding is applied anywhere: callers persist the raw doubles.
 */
export function buildPriceFlowFeatures(
  bars: readonly PFSecondBar[],
  spec: PFWindowSpec,
): PFFeatureResult {
  const p = spec.prefix;
  const sorted = [...bars].sort((a, b) => a.offsetSeconds - b.offsetSeconds);
  const offsets = sorted.map((b) => b.offsetSeconds);
  const values: PFFeatureMap = {
    [`${p}_seconds_count`]: sorted.length,
    [`${p}_first_offset_s`]: offsets.length ? offsets[0] : -1,
    [`${p}_last_offset_s`]: offsets.length ? offsets[offsets.length - 1] : -1,
    [`${p}_spot_open`]: sorted.length ? sorted[0].open : null,
  };

  const complete =
    sorted.length === spec.full &&
    offsets.every((o, i) => o === i) &&
    offsets[offsets.length - 1] === spec.full - 1;
  values[`${p}_spot_complete`] = complete ? 1 : 0;

  const baseOpen = sorted.length ? sorted[0].open : NaN;
  if (!complete || !Number.isFinite(baseOpen) || baseOpen <= 0) {
    return {
      values,
      secondsPresent: sorted.length,
      spotComplete: false,
      invalidReason: complete ? "INVALID_BASE_OPEN" : "INCOMPLETE_SECOND_BARS",
    };
  }

  const closes = sorted.map((b) => b.close);
  const highs = sorted.map((b) => b.high);
  const lows = sorted.map((b) => b.low);
  const qvol = sorted.map((b) => b.quoteVolume);
  const vol = sorted.map((b) => b.volume);
  const counts = sorted.map((b) => b.tradeCount);
  const buyQvol = sorted.map((b) => b.takerBuyQuoteVolume);

  const logClose = closes.map((c) => Math.log(c));
  const rets: number[] = [];
  let prev = Math.log(baseOpen);
  for (const lc of logClose) {
    rets.push(lc - prev);
    prev = lc;
  }

  for (const w of spec.windows) {
    const idx = offsets.map((o, i) => (o < w ? i : -1)).filter((i) => i >= 0);
    const last = idx[idx.length - 1];
    const finalClose = closes[last];
    const hi = Math.max(...idx.map((i) => highs[i]));
    const lo = Math.min(...idx.map((i) => lows[i]));
    const q = idx.reduce((a, i) => a + qvol[i], 0);
    const bq = idx.reduce((a, i) => a + buyQvol[i], 0);
    const c = idx.reduce((a, i) => a + counts[i], 0);
    values[`${p}_close_${w}s`] = finalClose;
    values[`${p}_ret_${w}s_bps`] = Math.log(finalClose / baseOpen) * 10_000;
    values[`${p}_range_${w}s_bps`] = ((hi - lo) / baseOpen) * 10_000;
    values[`${p}_quote_volume_${w}s`] = q;
    values[`${p}_trade_count_${w}s`] = c;
    values[`${p}_quote_flow_${w}s`] = q > 0 ? (2 * bq) / q - 1 : null;
  }

  const F = spec.full;
  const totalRange = Math.max(...highs) - Math.min(...lows);
  const closeF = closes[closes.length - 1];
  const path = rets.reduce((a, r) => a + Math.abs(r), 0);
  values[`${p}_body_range_${F}s`] = totalRange > 0 ? (closeF - baseOpen) / totalRange : null;
  values[`${p}_close_location_${F}s`] =
    totalRange > 0 ? (closeF - Math.min(...lows)) / totalRange : null;
  values[`${p}_path_efficiency_${F}s`] =
    path > 0 ? Math.abs(Math.log(closeF / baseOpen)) / path : 0;
  values[`${p}_realized_vol_${F}s_bps`] =
    Math.sqrt(rets.reduce((a, r) => a + r * r, 0)) * 10_000;

  const meanX = (F - 1) / 2;
  const meanLog = logClose.reduce((a, b) => a + b, 0) / logClose.length;
  let num = 0;
  let den = 0;
  for (let i = 0; i < logClose.length; i++) {
    const x = i - meanX;
    num += x * (logClose[i] - meanLog);
    den += x * x;
  }
  values[`${p}_log_price_slope_bps_per_s`] = (num / den) * 10_000;

  const nonzero = rets.map(sign).filter((s) => s !== 0);
  let changes = 0;
  for (let i = 1; i < nonzero.length; i++) if (nonzero[i] !== nonzero[i - 1]) changes++;
  values[`${p}_return_sign_persistence`] = nonzero.length
    ? Math.abs(nonzero.reduce((a, b) => a + b, 0)) / nonzero.length
    : 0;
  values[`${p}_return_sign_changes`] = nonzero.length > 1 ? changes : 0;

  values[`${p}_last${spec.short}_ret_bps`] =
    Math.log(closes[F - 1] / closes[F - 1 - spec.short]) * 10_000;
  values[`${p}_last${spec.mid}_ret_bps`] =
    Math.log(closes[F - 1] / closes[F - 1 - spec.mid]) * 10_000;
  values[`${p}_return_accel_${spec.short}_${F}_bps`] =
    (values[`${p}_ret_${F}s_bps`] as number) - (values[`${p}_ret_${spec.short}s_bps`] as number);

  const qTotal = qvol.reduce((a, b) => a + b, 0);
  const cTotal = counts.reduce((a, b) => a + b, 0);
  const qLast = qvol.slice(-spec.short).reduce((a, b) => a + b, 0);
  const cLast = counts.slice(-spec.short).reduce((a, b) => a + b, 0);
  values[`${p}_quote_volume_last${spec.short}_share`] = qTotal > 0 ? qLast / qTotal : null;
  values[`${p}_trade_count_last${spec.short}_share`] = cTotal > 0 ? cLast / cTotal : null;

  const volTotal = vol.reduce((a, b) => a + b, 0);
  const vwap = volTotal > 0 ? qTotal / volTotal : NaN;
  values[`${p}_close_vwap_gap_bps`] =
    Number.isFinite(vwap) && vwap > 0 ? Math.log(closeF / vwap) * 10_000 : null;

  const partial = sign(closeF - baseOpen);
  values[`${p}_partial_direction`] = partial;
  const flowF = values[`${p}_quote_flow_${F}s`];
  values[`${p}_price_flow_alignment`] = flowF == null ? null : partial * sign(flowF);
  values[`${p}_path_direction_consistency`] =
    partial !== 0
      ? closes.filter((c) => sign(c - baseOpen) === partial).length / closes.length
      : 0;

  values[`${p}_log_quote_volume_${F}s`] = Math.log1p(Math.max(0, qTotal));
  values[`${p}_log_trade_count_${F}s`] = Math.log1p(Math.max(0, cTotal));

  for (const k of Object.keys(values)) {
    const v = values[k];
    if (typeof v === "number") values[k] = finite(v);
  }

  return { values, secondsPresent: sorted.length, spotComplete: true, invalidReason: null };
}

/** Assemble the frozen-order model vector; null when any component is unusable. */
export function pfVector(
  values: PFFeatureMap,
  order: readonly string[],
): number[] | null {
  const out: number[] = [];
  for (const name of order) {
    const v = values[name];
    if (typeof v !== "number" || !Number.isFinite(v)) return null;
    out.push(v);
  }
  return out;
}
