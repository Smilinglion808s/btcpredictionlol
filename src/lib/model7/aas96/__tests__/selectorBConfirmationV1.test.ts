import { describe, it, expect } from "vitest";
import {
  evaluateSelectorBConfirmationV1,
  masterPredictionToDir,
  SELECTOR_B_CONFIRMATION_V1_THRESHOLD,
  SELECTOR_B_CONFIRMATION_V1_REASON,
} from "../selectorBConfirmationV1";

const T = SELECTOR_B_CONFIRMATION_V1_THRESHOLD; // 0.0001
const BTC = 100_000;
// separation that yields ratio exactly at threshold: sep = T * BTC = 10.
const sepAt = T * BTC;
const sepAbove = sepAt * 2;
const sepBelow = sepAt / 2;

describe("selector_b_confirmation_v1", () => {
  it("A and B agree → no override", () => {
    const r = evaluateSelectorBConfirmationV1({
      layerAFinalDirection: "GREEN",
      layerBFinalDirection: "GREEN",
      masterPrediction: "GREEN",
      ema9: 100, ema21: 90, btcPrice: BTC,
    });
    expect(r.evaluable).toBe(true);
    expect(r.triggered).toBe(false);
  });

  it("A and B disagree but master agrees with A → no override", () => {
    const r = evaluateSelectorBConfirmationV1({
      layerAFinalDirection: "GREEN",
      layerBFinalDirection: "RED",
      masterPrediction: "GREEN",
      ema9: 100, ema21: 100 - sepAbove, btcPrice: BTC,
    });
    expect(r.triggered).toBe(false);
  });

  it("master agrees with B but ratio below threshold → no override", () => {
    const r = evaluateSelectorBConfirmationV1({
      layerAFinalDirection: "GREEN",
      layerBFinalDirection: "RED",
      masterPrediction: "RED",
      ema9: 100, ema21: 100 - sepBelow, btcPrice: BTC,
    });
    expect(r.triggered).toBe(false);
  });

  it("ratio exactly at threshold → override to B", () => {
    const r = evaluateSelectorBConfirmationV1({
      layerAFinalDirection: "GREEN",
      layerBFinalDirection: "RED",
      masterPrediction: "RED",
      ema9: 100, ema21: 100 - sepAt, btcPrice: BTC,
    });
    expect(r.triggered).toBe(true);
    expect(r.reason).toBe("master_confirms_b_with_ema_separation");
  });

  it("ratio above threshold → override to B", () => {
    const r = evaluateSelectorBConfirmationV1({
      layerAFinalDirection: "RED",
      layerBFinalDirection: "GREEN",
      masterPrediction: "GREEN",
      ema9: 100, ema21: 100 + sepAbove, btcPrice: BTC,
    });
    expect(r.triggered).toBe(true);
  });

  it("missing master prediction → not evaluable", () => {
    const r = evaluateSelectorBConfirmationV1({
      layerAFinalDirection: "GREEN",
      layerBFinalDirection: "RED",
      masterPrediction: null,
      ema9: 100, ema21: 90, btcPrice: BTC,
    });
    expect(r.evaluable).toBe(false);
    expect(r.triggered).toBe(false);
  });

  it("missing EMA9 or EMA21 → not evaluable", () => {
    const a = evaluateSelectorBConfirmationV1({
      layerAFinalDirection: "GREEN", layerBFinalDirection: "RED",
      masterPrediction: "RED", ema9: null, ema21: 90, btcPrice: BTC,
    });
    const b = evaluateSelectorBConfirmationV1({
      layerAFinalDirection: "GREEN", layerBFinalDirection: "RED",
      masterPrediction: "RED", ema9: 100, ema21: null, btcPrice: BTC,
    });
    expect(a.evaluable).toBe(false);
    expect(b.evaluable).toBe(false);
  });

  it("missing or zero BTC price → not evaluable", () => {
    const a = evaluateSelectorBConfirmationV1({
      layerAFinalDirection: "GREEN", layerBFinalDirection: "RED",
      masterPrediction: "RED", ema9: 100, ema21: 90, btcPrice: null,
    });
    const b = evaluateSelectorBConfirmationV1({
      layerAFinalDirection: "GREEN", layerBFinalDirection: "RED",
      masterPrediction: "RED", ema9: 100, ema21: 90, btcPrice: 0,
    });
    expect(a.evaluable).toBe(false);
    expect(b.evaluable).toBe(false);
  });
});
