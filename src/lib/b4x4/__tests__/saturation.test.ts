import { describe, expect, it } from "vitest";
import {
  computeSaturationFeature,
  saturationAttribution,
  saturationConfidenceCap,
  type HistoryEntry,
} from "../engine";
import {
  SATURATION_CAP_SLOPE,
  SATURATION_MIN_CONFIDENCE_CAP,
  SATURATION_TRIGGER,
  SATURATION_WINDOW,
} from "../config";

function entry(direction: "GREEN" | "RED", confidence: number, i: number): HistoryEntry {
  return {
    candleTs: new Date(Date.UTC(2026, 7, 14, 0, 15 * i)).toISOString(),
    direction,
    confidence,
  } as HistoryEntry;
}

function window(direction: "GREEN" | "RED", confidence: number, n = SATURATION_WINDOW) {
  return Array.from({ length: n }, (_, i) => entry(direction, confidence, i));
}

describe("balanced saturation calibration", () => {
  it("is not ready with fewer than the frozen window of rows", () => {
    const f = computeSaturationFeature(window("GREEN", 0.3, SATURATION_WINDOW - 1), "GREEN", 0.4);
    expect(f.ready).toBe(false);
    expect(f.index).toBeNull();
    expect(f.conditionMet).toBe(false);
  });

  it("computes index as sameSideShare * 2 * meanAlignedConfidence", () => {
    const f = computeSaturationFeature(window("GREEN", 0.4), "GREEN", 0.4);
    expect(f.ready).toBe(true);
    expect(f.sameSideShare).toBe(1);
    expect(f.meanAlignedConfidence).toBeCloseTo(0.4, 12);
    expect(f.index).toBeCloseTo(0.8, 12);
    expect(f.regimeActive).toBe(true);
  });

  it("stays inactive below the frozen trigger", () => {
    const rows = window("GREEN", 0.1);
    const f = computeSaturationFeature(rows, "GREEN", 0.45);
    expect(f.index).toBeCloseTo(0.2, 12);
    expect(f.regimeActive).toBe(false);
    expect(f.dynamicConfidenceCap).toBeNull();
    expect(f.conditionMet).toBe(false);
  });

  it("activates exactly at the trigger boundary (inclusive)", () => {
    // 16 same-side rows, mean confidence 0.32 -> index = 1 * 2 * 0.32 = 0.64
    const f = computeSaturationFeature(window("GREEN", 0.32), "GREEN", 0.5);
    expect(f.index).toBeCloseTo(SATURATION_TRIGGER, 12);
    expect(f.regimeActive).toBe(true);
  });

  it("uses only same-direction rows for the share", () => {
    const rows = [...window("GREEN", 0.4, 12), ...window("RED", 0.4, 4)];
    const f = computeSaturationFeature(rows, "GREEN", 0.4);
    expect(f.sameSideCount).toBe(12);
    expect(f.sameSideShare).toBeCloseTo(0.75, 12);
    expect(f.index).toBeCloseTo(0.75 * 2 * 0.4, 12);
  });

  it("caps the dynamic threshold at the frozen floor", () => {
    expect(saturationConfidenceCap(SATURATION_TRIGGER)).toBeCloseTo(0.5, 12);
    expect(saturationConfidenceCap(0.84)).toBeCloseTo(
      0.5 - SATURATION_CAP_SLOPE * (0.84 - SATURATION_TRIGGER),
      12,
    );
    expect(saturationConfidenceCap(2)).toBe(SATURATION_MIN_CONFIDENCE_CAP);
    expect(saturationConfidenceCap(5)).toBeGreaterThanOrEqual(SATURATION_MIN_CONFIDENCE_CAP);
  });

  it("only blocks when aligned confidence reaches the dynamic cap", () => {
    const rows = window("GREEN", 0.4); // index 0.8, cap = 0.5 - 0.15*0.16 = 0.476
    const cap = saturationConfidenceCap(0.8);
    const below = computeSaturationFeature(rows, "GREEN", cap - 0.001);
    const at = computeSaturationFeature(rows, "GREEN", cap);
    expect(below.conditionMet).toBe(false);
    expect(at.conditionMet).toBe(true);
  });

  it("is side-neutral", () => {
    const green = computeSaturationFeature(window("GREEN", 0.4), "GREEN", 0.49);
    const red = computeSaturationFeature(window("RED", 0.4), "RED", 0.49);
    expect(green.index).toBeCloseTo(red.index!, 12);
    expect(green.conditionMet).toBe(red.conditionMet);
  });
});

describe("saturation attribution", () => {
  it("is not applicable when no veto fired", () => {
    expect(saturationAttribution(false, true, -1)).toEqual({
      klass: "NOT_APPLICABLE",
      value: 0,
      incrementalChange: false,
    });
  });

  it("is neutral when the prior policy would also have abstained", () => {
    expect(saturationAttribution(true, false, null)).toEqual({
      klass: "NO_INCREMENTAL_CHANGE",
      value: 0,
      incrementalChange: false,
    });
  });

  it("credits an avoided loss and debits a sacrificed win", () => {
    expect(saturationAttribution(true, true, -1)).toEqual({
      klass: "AVOIDED_LOSS",
      value: 1,
      incrementalChange: true,
    });
    expect(saturationAttribution(true, true, 1)).toEqual({
      klass: "SACRIFICED_WIN",
      value: -1,
      incrementalChange: true,
    });
    expect(saturationAttribution(true, true, 0)).toEqual({
      klass: "NO_INCREMENTAL_CHANGE",
      value: 0,
      incrementalChange: false,
    });
  });
});
