import { describe, expect, it } from "vitest";
import {
  applyRouteBrake,
  applyShadowOutcome,
  emptyRouteBrakeState,
  R5_GREEN_SOURCE_KEY,
  R5_RED_ANCHOR_SOURCE_KEY,
  R5_RED_BROAD_SOURCE_KEY,
  R5_ROUTE_ANCHOR_RED,
  R5_ROUTE_GREEN,
  routeBrakeContribution,
} from "../routeBrake";

const green = () => emptyRouteBrakeState(R5_ROUTE_GREEN);
const anchor = () => emptyRouteBrakeState(R5_ROUTE_ANCHOR_RED);

describe("V6-r5.1 route drawdown brake", () => {
  it("pauses a route only after two consecutive shadow losses", () => {
    let s = applyShadowOutcome(green(), "LOSS", "t1", "GREEN");
    expect(s.pauseActive).toBe(false);
    s = applyShadowOutcome(s, "LOSS", "t2", "GREEN");
    expect(s.pauseActive).toBe(true);
    expect(s.consecutiveShadowLosses).toBe(2);
  });

  it("resumes on a single win and resets the streak", () => {
    let s = applyShadowOutcome(applyShadowOutcome(green(), "LOSS"), "LOSS");
    s = applyShadowOutcome(s, "WIN", "t3", "GREEN");
    expect(s.pauseActive).toBe(false);
    expect(s.consecutiveShadowLosses).toBe(0);
  });

  it("ignores pushes and unresolved outcomes", () => {
    const s = applyShadowOutcome(applyShadowOutcome(green(), "LOSS"), "PUSH");
    expect(s.consecutiveShadowLosses).toBe(1);
    expect(applyShadowOutcome(s, null).consecutiveShadowLosses).toBe(1);
  });

  it("vetoes a GREEN publication while the GREEN route is paused", () => {
    const paused = applyShadowOutcome(applyShadowOutcome(green(), "LOSS"), "LOSS");
    const d = applyRouteBrake("GREEN", R5_GREEN_SOURCE_KEY, "R5_GREEN_ROUTE", paused, anchor());
    expect(d.prediction).toBe("ABSTAIN");
    expect(d.triggered).toBe(true);
    expect(d.routeKey).toBe(R5_ROUTE_GREEN);
    expect(d.underlyingPrediction).toBe("GREEN");
  });

  it("keeps the routes independent", () => {
    const pausedGreen = applyShadowOutcome(applyShadowOutcome(green(), "LOSS"), "LOSS");
    const d = applyRouteBrake("RED", R5_RED_ANCHOR_SOURCE_KEY, "R5_RED_ANCHOR_ROUTE", pausedGreen, anchor());
    expect(d.triggered).toBe(false);
    expect(d.prediction).toBe("RED");
  });

  it("never restricts the Broad RED route", () => {
    const pausedAnchor = applyShadowOutcome(applyShadowOutcome(anchor(), "LOSS"), "LOSS");
    const d = applyRouteBrake("RED", R5_RED_BROAD_SOURCE_KEY, "R5_RED_BROAD_ROUTE", green(), pausedAnchor);
    expect(d.triggered).toBe(false);
    expect(d.prediction).toBe("RED");
  });

  it("is veto-only: it never creates or flips a trade", () => {
    const pausedBoth = applyShadowOutcome(applyShadowOutcome(green(), "LOSS"), "LOSS");
    const d = applyRouteBrake("ABSTAIN", "ABSTAIN", "R5_NO_QUALIFIED_ROUTE", pausedBoth, pausedBoth);
    expect(d.prediction).toBe("ABSTAIN");
    expect(d.triggered).toBe(false);
  });

  it("attributes avoided losses and sacrificed wins", () => {
    expect(routeBrakeContribution(true, "GREEN", "RED")).toMatchObject({ raw: 1, adjusted: 1, result: "LOSS" });
    expect(routeBrakeContribution(true, "GREEN", "GREEN")).toMatchObject({ raw: -1, adjusted: -0.8, result: "WIN" });
    expect(routeBrakeContribution(true, "GREEN", "PUSH")).toMatchObject({ raw: 0, adjusted: 0, result: "PUSH" });
    expect(routeBrakeContribution(false, "GREEN", "RED").raw).toBe(0);
  });
});
