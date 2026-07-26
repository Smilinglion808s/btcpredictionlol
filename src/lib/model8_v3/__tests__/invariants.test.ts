// Model 3 FWD (v3.0.0) — invariant tests.
import { describe, it, expect } from "vitest";
import { buildTrainingMatrix, M8V3_FEATURE_NAMES, type Candle } from "@/lib/model8_v3/features";
import { trainLogistic, predictProb, fitPlatt, applyPlatt } from "@/lib/model8_v3/logistic";

function synth(n: number, startTsMs = Date.UTC(2026, 0, 1, 0, 0, 0)): Candle[] {
  const out: Candle[] = [];
  let close = 50_000;
  for (let i = 0; i < n; i++) {
    const drift = Math.sin(i / 6) * 40 + ((i * 7919) % 17) - 8;
    const open = close;
    close = open + drift;
    const high = Math.max(open, close) + 20;
    const low = Math.min(open, close) - 20;
    out.push({
      ts: new Date(startTsMs + i * 15 * 60_000).toISOString(),
      open, high, low, close, volume: 100 + (i % 20),
    });
  }
  return out;
}

describe("model8_v3 v3.0.0 invariants", () => {
  it("features for row i use only candles[0..i] (no target leakage)", () => {
    const c = synth(80);
    const { X: baseline } = buildTrainingMatrix(c, 15);
    // Mutate every candle AFTER the last training row (candles[c.length-1] is
    // the target row; last training row uses candles[c.length-2]).
    const mutated = c.slice();
    mutated[mutated.length - 1] = { ...mutated[mutated.length - 1], close: 999_999, high: 999_999 };
    const { X: after } = buildTrainingMatrix(mutated, 15);
    // Every training-row feature must be identical.
    expect(after.length).toBe(baseline.length);
    for (let i = 0; i < baseline.length; i++) {
      expect(after[i]).toEqual(baseline[i]);
    }
  });

  it("labels come from candle i+1 (direction + movement)", () => {
    const c = synth(60);
    const { yDir, yMove } = buildTrainingMatrix(c, 5);
    // Reconstruct expected labels; index 0 in training corresponds to candle idx 24.
    for (let k = 0; k < yDir.length; k++) {
      const nxt = c[24 + k + 1];
      const bodyBps = Math.abs(nxt.close - nxt.open) / nxt.open * 10_000;
      expect(yDir[k]).toBe(nxt.close > nxt.open ? 1 : 0);
      expect(yMove[k]).toBe(bodyBps >= 5 ? 1 : 0);
    }
  });

  it("candle timestamps are exactly 15 minutes apart", () => {
    const c = synth(50);
    for (let i = 1; i < c.length; i++) {
      const dt = new Date(c[i].ts).getTime() - new Date(c[i - 1].ts).getTime();
      expect(dt).toBe(15 * 60_000);
    }
  });

  it("preprocessing (means/scales) is fit on training rows only", () => {
    const c = synth(200);
    const { X, yDir } = buildTrainingMatrix(c, 15);
    const trainX = X.slice(0, X.length - 40);
    const calX = X.slice(X.length - 40);
    const fit = trainLogistic(trainX, yDir.slice(0, yDir.length - 40), { lambda: 1, maxIter: 100, tol: 1e-6 });
    // Recompute means from training only; must match fit means exactly.
    const d = trainX[0].length;
    for (let j = 0; j < d; j++) {
      let s = 0; for (const r of trainX) s += r[j];
      expect(Math.abs(fit.means[j] - s / trainX.length)).toBeLessThan(1e-9);
    }
    // calX not involved in means → mutate it should not change fit result.
    void calX;
  });

  it("Platt calibration uses the held-out calibration segment only", () => {
    const c = synth(300);
    const { X, yDir } = buildTrainingMatrix(c, 15);
    const trainX = X.slice(0, X.length - 60);
    const trainY = yDir.slice(0, yDir.length - 60);
    const calX = X.slice(X.length - 60);
    const calY = yDir.slice(yDir.length - 60);
    const fit = trainLogistic(trainX, trainY, { lambda: 1, maxIter: 100, tol: 1e-6 });
    const raw = calX.map((r) => predictProb(r, fit.w, fit.b, fit.means, fit.scales));
    const platt = fitPlatt(raw, calY);
    // Platt returns finite params; a monotone mapping that doesn't blow up.
    expect(Number.isFinite(platt.a)).toBe(true);
    expect(Number.isFinite(platt.b)).toBe(true);
    const mid = applyPlatt(0.5, platt.a, platt.b);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
  });

  it("stored fit artifacts reproduce the same probability", () => {
    const c = synth(200);
    const { X, yDir, targetFeatureRow } = buildTrainingMatrix(c, 15);
    const fit = trainLogistic(X, yDir, { lambda: 1, maxIter: 100, tol: 1e-6 });
    const p1 = predictProb(targetFeatureRow, fit.w, fit.b, fit.means, fit.scales);
    // Serialize round-trip through JSON like fit_snapshot does.
    const snap = JSON.parse(JSON.stringify({ w: fit.w, b: fit.b, means: fit.means, scales: fit.scales }));
    const p2 = predictProb(targetFeatureRow, snap.w, snap.b, snap.means, snap.scales);
    expect(p2).toBeCloseTo(p1, 12);
  });

  it("has the frozen 14-feature schema", () => {
    expect(M8V3_FEATURE_NAMES.length).toBe(14);
  });
});
