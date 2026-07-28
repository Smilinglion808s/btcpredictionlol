import { describe, expect, it } from "vitest";
import { a96Decide } from "../engine";
import { authoritativeDirection, scoreDirection } from "../engine";
import type { FitState } from "../types";

const baseFit: FitState = {
  fit_episode_id: "ep1",
  artifact_fit_id: "a1",
  comparable_resolved_count: 0,
  layer_a_wins: 0, layer_a_losses: 0, layer_a_net: 0,
  layer_b_wins: 0, layer_b_losses: 0, layer_b_net: 0,
};

describe("a96 authoritativeDirection uses OHLC only", () => {
  it("returns GREEN when close > open", () => {
    expect(authoritativeDirection(100, 101)).toBe("GREEN");
  });
  it("returns RED when close < open", () => {
    expect(authoritativeDirection(101, 100)).toBe("RED");
  });
  it("returns PUSH when close == open", () => {
    expect(authoritativeDirection(100, 100)).toBe("PUSH");
  });
});

describe("a96 scoreDirection is symmetric per layer", () => {
  it("+1 on match, -1 on mismatch, 0 on PUSH", () => {
    expect(scoreDirection("GREEN", "GREEN")).toBe(1);
    expect(scoreDirection("RED", "GREEN")).toBe(-1);
    expect(scoreDirection("GREEN", "PUSH")).toBe(0);
    expect(scoreDirection("ABSTAIN", "GREEN")).toBe(0);
  });
});

describe("a96Decide always populates snapshot from provided fit state", () => {
  it("carries fit_resolved_count and per-layer nets into the decision", () => {
    const fit: FitState = { ...baseFit, comparable_resolved_count: 8, layer_a_net: 3, layer_b_net: -3 };
    const d = a96Decide({
      layerADirection: "GREEN", layerBDirection: "RED", layerAProbMean: 0.52, baseSelectedLayer: "A",
      fitState: fit,
      targetTimestamp: new Date("2026-07-24T20:45:00Z"),
      targetOpen: 64186.4,
      priorCandles: [],
    });

    expect(d.fit_state_snapshot.comparable_resolved_count).toBe(8);
    expect(d.fit_state_snapshot.layer_a_net).toBe(3);
    expect(d.fit_state_snapshot.layer_b_net).toBe(-3);
    expect(d.fit_state_snapshot.net_gap_a_minus_b).toBe(6);
  });
});
