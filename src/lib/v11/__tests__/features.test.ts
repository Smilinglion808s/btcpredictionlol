import { describe, expect, it } from "vitest";
import {
  V11_CTX_BASE_ORDER,
  V11_FEATURE_ORDER,
  V11_T45_BASE_ORDER,
  V1_DIRECTION60_ORDER,
} from "../config";
import { buildV11Vector, computeV11Vol } from "../features";

function fullCtx(v = 1): Record<string, number> {
  const o: Record<string, number> = {};
  for (const n of V1_DIRECTION60_ORDER) o[n] = v;
  return o;
}
function fullT45(v = 1): Record<string, number> {
  const o: Record<string, number> = {};
  for (const n of V11_T45_BASE_ORDER) o[n] = v;
  return o;
}

describe("CONTEXT69_NORM_38 shape", () => {
  it("has exactly 28 + 41 + 11 = 80 inputs in frozen order", () => {
    expect(V11_T45_BASE_ORDER.length).toBe(28);
    expect(V11_CTX_BASE_ORDER.length).toBe(41);
    expect(V11_FEATURE_ORDER.length).toBe(80);
    expect(new Set(V11_FEATURE_ORDER).size).toBe(80);
  });

  it("excludes w001/w002/w003 windows and cm_flow1 but keeps cm_flow15", () => {
    expect(V11_CTX_BASE_ORDER.some((n) => n.includes("_w001_"))).toBe(false);
    expect(V11_CTX_BASE_ORDER.some((n) => n.includes("_w002_"))).toBe(false);
    expect(V11_CTX_BASE_ORDER.some((n) => n.includes("_w003_"))).toBe(false);
    expect(V11_CTX_BASE_ORDER).not.toContain("cm_flow1");
    expect(V11_CTX_BASE_ORDER).toContain("cm_flow15");
  });
});

describe("volatility scaler", () => {
  it("needs 24 finite samples", () => {
    const short = new Array(20).fill(10);
    expect(computeV11Vol(short, 10).ready).toBe(false);
    const ok = new Array(30).fill(10);
    expect(computeV11Vol(ok, 10).ready).toBe(true);
  });

  it("includes the current row and clips to +-200, floors at 5bps", () => {
    const hist = new Array(30).fill(0);
    expect(computeV11Vol(hist, 0).vol).toBe(5); // floor
    const big = new Array(95).fill(1000);
    // clipped to 200 -> rms 200
    expect(computeV11Vol(big, 1000).vol).toBeCloseTo(200, 9);
  });

  it("uses at most the last 96 rows including the current one", () => {
    const hist = [...new Array(200).fill(0), ...new Array(95).fill(100)];
    const r = computeV11Vol(hist, 100);
    expect(r.vol).toBeCloseTo(100, 9);
  });
});

describe("vector construction", () => {
  it("builds a finite 80-vector and normalises by vol", () => {
    const ctx = fullCtx(4);
    const t45 = fullT45(2);
    const built = buildV11Vector({ direction60: ctx, t45 }, 2);
    expect(built.valid).toBe(true);
    expect(built.vector).toHaveLength(80);
    expect(built.named!["norm_feature_t45_ret_45s_bps"]).toBeCloseTo(1, 12);
    expect(built.named!["norm_ctx_index_anchor_t0_basis_bps"]).toBeCloseTo(2, 12);
    // displacement = (ctx_index_anchor_t0 + feature_t45_ret_45s)/vol = (4+2)/2
    expect(built.named!["norm_approx_index_displacement45"]).toBeCloseTo(3, 12);
  });

  it("clips normalised inputs to +-10", () => {
    const built = buildV11Vector({ direction60: fullCtx(1000), t45: fullT45(1000) }, 5);
    expect(built.named!["norm_ctx_cm_ret15"]).toBe(10);
    expect(built.named!["norm_approx_index_displacement45"]).toBe(10);
  });

  it("fails closed on any non-finite input, never imputes", () => {
    const ctx = fullCtx(1);
    delete ctx["cm_basis"];
    const built = buildV11Vector({ direction60: ctx, t45: fullT45(1) }, 10);
    expect(built.valid).toBe(false);
    expect(built.vector).toBeNull();
    expect(built.missing).toContain("ctx_cm_basis");
  });

  it("fails closed when vol is unavailable", () => {
    const built = buildV11Vector({ direction60: fullCtx(1), t45: fullT45(1) }, null);
    expect(built.valid).toBe(false);
    expect(built.missing).toContain("vol");
  });

  it("fails closed when the T45 leg is missing entirely", () => {
    const built = buildV11Vector({ direction60: fullCtx(1), t45: null }, 10);
    expect(built.valid).toBe(false);
    expect(built.missing.length).toBe(28);
  });
});
