import { describe, expect, it } from "vitest";
import {
  fitRobustScaler,
  applyScaler,
  trainEs1Fit,
  type TrainingRow,
} from "../priceHead";
import { fitCertifiedLogistic } from "../certifiedFit";
import { decideEs1 } from "../engine";
import fixture from "./oracle-parity-fixture.json";

// ---- CI parity certification: TS L-BFGS vs the sklearn oracle -------------
// The fixture is produced offline by scikit-learn on a deterministic dataset
// that this test regenerates bit-identically.
function lcg(n: number): number[] {
  let s = 123456789;
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    s = (1103515245 * s + 12345) % 2 ** 31;
    out.push(s / 2 ** 31);
  }
  return out;
}

function syntheticDataset() {
  const N = fixture.n;
  const D = fixture.d;
  const vals = lcg(N * D);
  const X: number[][] = [];
  for (let i = 0; i < N; i++) {
    const row: number[] = [];
    for (let j = 0; j < D; j++) {
      let v = vals[i * D + j] * 2 - 1;
      if (j === 3) v *= 0.001;
      row.push(v);
    }
    X.push(row);
  }
  const y = X.map((r) => (r[0] * 1.5 - r[2] * 0.8 + r[5] * 0.3 > 0 ? 1 : 0));
  const raw = X.map((_, i) => 1 + (i % 7) * 0.1);
  const mean = raw.reduce((a, b) => a + b, 0) / raw.length;
  const w = raw.map((v) => v / mean);
  return { X, y, w };
}

describe("ES1 certified fitter parity with the sklearn oracle", () => {
  const { X, y, w } = syntheticDataset();

  it("reproduces the RobustScaler(10,90) exactly", () => {
    const sc = fitRobustScaler(X);
    sc.center.forEach((v, j) => expect(Math.abs(v - fixture.center[j])).toBeLessThan(1e-12));
    sc.scale.forEach((v, j) => expect(Math.abs(v - fixture.scale[j])).toBeLessThan(1e-12));
  });

  it("reproduces the sklearn lbfgs solution to tight tolerance", () => {
    const sc = fitRobustScaler(X);
    const Z = X.map((x) => applyScaler(sc, x));
    const fit = fitCertifiedLogistic(Z, y, w);
    expect(fit.converged).toBe(true);
    fit.coefficients.forEach((c, j) =>
      expect(Math.abs(c - fixture.coefficients[j])).toBeLessThan(1e-9),
    );
    expect(Math.abs(fit.intercept - fixture.intercept)).toBeLessThan(1e-9);

    const sig = (z: number) => 1 / (1 + Math.exp(-z));
    let maxP = 0;
    for (const z of Z) {
      const a = sig(z.reduce((acc, v, j) => acc + v * fit.coefficients[j], fit.intercept));
      const b = sig(z.reduce((acc, v, j) => acc + v * fixture.coefficients[j], fixture.intercept));
      maxP = Math.max(maxP, Math.abs(a - b));
    }
    expect(maxP).toBeLessThan(1e-9);
  });

  it("is deterministic: identical inputs produce an identical artifact hash", () => {
    const rows: TrainingRow[] = X.map((vector, i) => ({
      targetTs: new Date(Date.UTC(2026, 0, 1, 0, 15 * i)).toISOString(),
      vector,
      label: (y[i] as 1 | 0),
      index: i,
    }));
    const a = trainEs1Fit(rows, 768, "lbfgs");
    const b = trainEs1Fit(rows, 768, "lbfgs");
    expect(a).not.toBeNull();
    expect(a?.artifactSha256).toBe(b?.artifactSha256);
    expect(a?.solver).toBe("ts-lbfgs");
  });
});

describe("ES1 fail-closed certification gate", () => {
  it("abstains when the price fit is not certified", () => {
    const d = decideEs1(
      {
        targetTs: "2026-08-15T12:00:00.000Z",
        featureCutoffTs: "2026-08-15T11:45:00.000Z",
        latestSourceTs: "2026-08-15T11:45:00.000Z",
        featureVector: new Array(8).fill(0.1),
        featureValues: {},
        featureVectorHash: "hash",
        featureValid: true,
        featureInvalidReason: null,
        timingValid: true,
        timingInvalidReason: null,
        priceProbabilityGreen: 0.72,
        priceFitId: "es1-fit-shadow",
        priceFitCertified: false,
        a2ProbabilityGreen: 0.7,
        a2RowId: null,
        a2PredictionId: null,
        sourceIndexAbsolute: 10,
        obSnapshot: null,
        obHistory: [],
      },
      [],
    );
    expect(d.decisionReason).toBe("ABSTAIN_ES1_CERTIFIED_ARTIFACT_NOT_READY");
    expect(d.wouldTrade).toBe(false);
    expect(d.finalPrediction).toBeNull();
  });
});
