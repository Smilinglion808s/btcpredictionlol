// T30 PriceFlow — prediction-time feature builder (pure).
//
// Thin binding of the shared PriceFlow window formulas to the T30 horizon
// {full:30, short:10, mid:20}. The formulas themselves live in
// src/lib/priceflow/windowFeatures.ts and are proven identical to the frozen
// T45 reference by src/lib/priceflow/__tests__/parity.test.ts.

import {
  PF30_SPEC,
  buildPriceFlowFeatures,
  pfVector,
  type PFFeatureMap,
  type PFSecondBar,
} from "@/lib/priceflow/windowFeatures";
import { T30_FEATURE_ORDER } from "./config";

export type T30SecondBar = PFSecondBar;
export type T30FeatureMap = PFFeatureMap;

export interface T30FeatureResult {
  values: T30FeatureMap;
  secondsPresent: number;
  spotComplete: boolean;
  featureComplete: boolean;
  invalidReason: string | null;
  /** Frozen-order 28-length model vector; null when any component is unusable. */
  vector: number[] | null;
}

export function buildT30Features(bars: readonly T30SecondBar[]): T30FeatureResult {
  const built = buildPriceFlowFeatures(bars, PF30_SPEC);
  const vector = built.spotComplete ? pfVector(built.values, T30_FEATURE_ORDER) : null;
  return {
    values: built.values,
    secondsPresent: built.secondsPresent,
    spotComplete: built.spotComplete,
    featureComplete: vector != null,
    invalidReason: built.invalidReason ?? (vector ? null : "NON_FINITE_FEATURE"),
    vector,
  };
}
