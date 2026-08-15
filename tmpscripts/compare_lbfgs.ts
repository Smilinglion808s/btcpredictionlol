import { readFileSync } from "fs";
import { fitRobustScaler, applyScaler, dayBalancedWeights } from "../src/lib/b4x4es1/priceHead";
import { fitCertifiedLogistic } from "../src/lib/b4x4es1/certifiedFit";
import frozen from "../src/lib/b4x4es1/frozen-fits.json";
const win = JSON.parse(readFileSync("/tmp/es1/window.json", "utf8"));
const arts = new Map<number, any>((frozen as any).fits.map((f: any) => [f.boundary, f]));
const sig = (z: number) => (z >= 0 ? 1 / (1 + Math.exp(-z)) : Math.exp(z) / (1 + Math.exp(z)));
let worstP = 0, worstC = 0;
for (const blk of win.boundaries) {
  const a = arts.get(blk.boundary);
  const rows = blk.rows as Array<{ targetTs: string; vector: number[]; label: number }>;
  const X = rows.map((r) => r.vector);
  const sc = fitRobustScaler(X);
  const Z = X.map((x) => applyScaler(sc, x));
  const w = dayBalancedWeights(rows.map((r) => r.targetTs));
  const s = fitCertifiedLogistic(Z, rows.map((r) => r.label), w);
  let maxP = 0, maxC = Math.abs(s.intercept - a.intercept);
  for (let j = 0; j < s.coefficients.length; j++) maxC = Math.max(maxC, Math.abs(s.coefficients[j] - a.coefficients[j]));
  for (const z of Z) {
    const p1 = sig(z.reduce((acc, v, j) => acc + v * s.coefficients[j], s.intercept));
    const p2 = sig(z.reduce((acc, v, j) => acc + v * a.coefficients[j], a.intercept));
    maxP = Math.max(maxP, Math.abs(p1 - p2));
  }
  worstP = Math.max(worstP, maxP); worstC = Math.max(worstC, maxC);
  console.log(blk.boundary, "coef", maxC.toExponential(2), "prob", maxP.toExponential(2), s.stopReason, "it", s.iterations, "|g|", s.gradientNorm.toExponential(2));
}
console.log("WORST coef", worstC.toExponential(3), "prob", worstP.toExponential(3));
