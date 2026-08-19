import { describe, expect, it } from "vitest";
import { scorePrecisionLeg } from "../precisionScoring";

describe("scorePrecisionLeg", () => {
  it("scores a matching trade as WIN/+1", () => {
    expect(scorePrecisionLeg(true, "GREEN", "GREEN")).toEqual({ result: "WIN", score: 1 });
    expect(scorePrecisionLeg(true, "RED", "RED")).toEqual({ result: "WIN", score: 1 });
  });

  it("scores an opposing trade as LOSS/-1", () => {
    expect(scorePrecisionLeg(true, "GREEN", "RED")).toEqual({ result: "LOSS", score: -1 });
    expect(scorePrecisionLeg(true, "RED", "GREEN")).toEqual({ result: "LOSS", score: -1 });
  });

  it("scores a traded flat candle as PUSH/0", () => {
    expect(scorePrecisionLeg(true, "GREEN", "PUSH")).toEqual({ result: "PUSH", score: 0 });
  });

  it("scores a no-trade row as ABSTAIN/0, never PUSH", () => {
    expect(scorePrecisionLeg(false, null, "GREEN")).toEqual({ result: "ABSTAIN", score: 0 });
    expect(scorePrecisionLeg(false, "GREEN", "PUSH")).toEqual({ result: "ABSTAIN", score: 0 });
    expect(scorePrecisionLeg(true, null, "RED")).toEqual({ result: "ABSTAIN", score: 0 });
  });

  it("leaves pre-policy rows null/null", () => {
    expect(scorePrecisionLeg(null, null, "GREEN")).toEqual({ result: null, score: null });
    expect(scorePrecisionLeg(undefined, "GREEN", "RED")).toEqual({ result: null, score: null });
  });

  it("leaves rows without a canonical outcome unscored", () => {
    expect(scorePrecisionLeg(true, "GREEN", null)).toEqual({ result: null, score: null });
  });
});
