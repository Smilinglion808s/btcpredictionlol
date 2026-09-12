// Version 1.1 — CONTEXT69_NORM_38 feature construction (pure, no I/O).
//
// 80 inputs: 28 `feature_` T45 PriceFlow inputs, 41 `ctx_` inputs taken from the
// ORIGINAL un-imputed V1 60-field direction schema, and 11 `norm_` inputs.
// No median imputation ever happens here: a single non-finite input invalidates
// the row, exactly as the specification requires.

import {
  V11_CTX_BASE_ORDER,
  V11_FEATURE_ORDER,
  V11_NORM_BASE_FIELDS,
  V11_NORM_CLIP,
  V11_NORM_DISPLACEMENT,
  V11_T45_BASE_ORDER,
  V11_VOL_CLIP,
  V11_VOL_FLOOR_BPS,
  V11_VOL_MIN_FINITE,
  V11_VOL_WINDOW,
} from "./config";

export interface V11RawInputs {
  /** Raw c85 direction60 map, unprefixed original names. */
  direction60: Record<string, unknown> | null;
  /** Raw t45 PriceFlow feature map, unprefixed t45_* names. */
  t45: Record<string, unknown> | null;
}

export interface V11VolResult {
  vol: number | null;
  finiteCount: number;
  ready: boolean;
}

export interface V11VectorResult {
  vector: number[] | null;
  named: Record<string, number> | null;
  valid: boolean;
  missing: string[];
  vol: number | null;
}

function num(v: unknown): number {
  if (typeof v === "number") return v;
  if (typeof v === "string" && v.trim() !== "") return Number(v);
  return NaN;
}

function clip(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * Volatility scaler: RMS of `ctx_binance_spot_t0_w900_return_bps` clipped to
 * ±200, over the last 96 official opportunity rows INCLUDING the current row's
 * pre-open return. `history` must be the chronological official-opportunity
 * clock ending with the PREVIOUS row; `current` is this row's value.
 * Needs >= 24 finite samples; floored at 5 bps.
 */
export function computeV11Vol(
  history: readonly (number | null | undefined)[],
  current: number | null | undefined,
): V11VolResult {
  const window = [...history.slice(-(V11_VOL_WINDOW - 1)), current ?? NaN].slice(
    -V11_VOL_WINDOW,
  );
  const finite = window
    .map((v) => (v === null || v === undefined ? NaN : Number(v)))
    .filter((v) => Number.isFinite(v))
    .map((v) => clip(v, -V11_VOL_CLIP, V11_VOL_CLIP));
  if (finite.length < V11_VOL_MIN_FINITE) {
    return { vol: null, finiteCount: finite.length, ready: false };
  }
  const rms = Math.sqrt(finite.reduce((a, v) => a + v * v, 0) / finite.length);
  const vol = Math.max(rms, V11_VOL_FLOOR_BPS);
  if (!Number.isFinite(vol)) return { vol: null, finiteCount: finite.length, ready: false };
  return { vol, finiteCount: finite.length, ready: true };
}

/** Build the prefixed 69 base fields from the two raw sources. */
export function buildV11Base(raw: V11RawInputs): {
  named: Record<string, number>;
  missing: string[];
} {
  const named: Record<string, number> = {};
  const missing: string[] = [];
  for (const n of V11_T45_BASE_ORDER) {
    const key = `feature_${n}`;
    const v = num(raw.t45?.[n]);
    named[key] = v;
    if (!Number.isFinite(v)) missing.push(key);
  }
  for (const n of V11_CTX_BASE_ORDER) {
    const key = `ctx_${n}`;
    const v = num(raw.direction60?.[n]);
    named[key] = v;
    if (!Number.isFinite(v)) missing.push(key);
  }
  return { named, missing };
}

/**
 * Full 80-input vector. `vol` comes from `computeV11Vol`; a null vol makes the
 * row invalid (never imputed, never defaulted).
 */
export function buildV11Vector(raw: V11RawInputs, vol: number | null): V11VectorResult {
  const { named, missing } = buildV11Base(raw);
  if (missing.length > 0 || vol === null || !Number.isFinite(vol) || vol <= 0) {
    return {
      vector: null,
      named: null,
      valid: false,
      missing: vol === null || !Number.isFinite(vol) || vol <= 0 ? [...missing, "vol"] : missing,
      vol,
    };
  }
  for (const base of V11_NORM_BASE_FIELDS) {
    named[`norm_${base}`] = clip(named[base] / vol, -V11_NORM_CLIP, V11_NORM_CLIP);
  }
  named[V11_NORM_DISPLACEMENT] = clip(
    (named["ctx_index_anchor_t0_basis_bps"] + named["feature_t45_ret_45s_bps"]) / vol,
    -V11_NORM_CLIP,
    V11_NORM_CLIP,
  );
  const vector = V11_FEATURE_ORDER.map((k) => named[k]);
  const bad = V11_FEATURE_ORDER.filter((k) => !Number.isFinite(named[k]));
  if (bad.length > 0) {
    return { vector: null, named: null, valid: false, missing: bad, vol };
  }
  return { vector, named, valid: true, missing: [], vol };
}
