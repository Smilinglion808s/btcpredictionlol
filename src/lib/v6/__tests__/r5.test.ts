import { describe, expect, it } from "vitest";
import { evaluateR5Router, gradeBranch } from "../r5";

const green = {
  stoch_spread: -0.2,
  d1_mean_body_to_range_2: 0.1,
  d1_close_position_in_range: 0.9,
  close_slope_8: 1,
  bb_width_pct: 5,
  aligned_wick_pressure_4: 0.05,
};

describe("V6-r5 Selective Core Router", () => {
  it("publishes GREEN when both stochastic-pullback conditions hold", () => {
    const r = evaluateR5Router("ABSTAIN", "V6_BASE", "BROAD", green);
    expect(r.greenCandidate).toBe(true);
    expect(r.decision).toBe("GREEN");
  });

  it("abstains when a GREEN condition fails", () => {
    const r = evaluateR5Router("ABSTAIN", "V6_BASE", "BROAD", { ...green, stoch_spread: 0.5 });
    expect(r.greenCandidate).toBe(false);
    expect(r.decision).toBe("ABSTAIN");
  });

  it("fails closed on a missing input rather than op-failing", () => {
    const r = evaluateR5Router("ABSTAIN", "V6_BASE", "BROAD", { ...green, stoch_spread: null });
    expect(r.greenEvaluable).toBe(false);
    expect(r.decision).toBe("ABSTAIN");
  });

  it("only accepts a V6_BASE RED feeder", () => {
    const inputs = { ...green, stoch_spread: 0.5, d1_close_position_in_range: 0.1 };
    expect(evaluateR5Router("RED", "CONSENSUS_RED_PICKUP", "ANCHOR", inputs).redFeederPass).toBe(false);
    expect(evaluateR5Router("RED", "V6_BASE", "ANCHOR", inputs).redFeederPass).toBe(true);
  });

  it("routes anchor RED on close-position control", () => {
    const r = evaluateR5Router("RED", "V6_BASE", "ANCHOR", {
      ...green,
      stoch_spread: 0.5,
      d1_close_position_in_range: 0.1,
    });
    expect(r.decision).toBe("RED");
    expect(r.redAnchorCandidate).toBe(true);
  });

  it("routes broad RED only on a controlled slope and band width", () => {
    const base = { ...green, stoch_spread: 0.5, close_slope_8: 0, bb_width_pct: 0.5 };
    expect(evaluateR5Router("RED", "V6_BASE", "BROAD", base).decision).toBe("RED");
    expect(evaluateR5Router("RED", "V6_BASE", "BROAD", { ...base, bb_width_pct: 2 }).decision).toBe("ABSTAIN");
    expect(evaluateR5Router("RED", "V6_BASE", "BROAD", { ...base, close_slope_8: -1 }).decision).toBe("ABSTAIN");
  });

  it("abstains on a GREEN/RED route conflict", () => {
    const r = evaluateR5Router("RED", "V6_BASE", "ANCHOR", { ...green, d1_close_position_in_range: 0.1 });
    expect(r.conflict).toBe(true);
    expect(r.decision).toBe("ABSTAIN");
  });

  it("grades shadow branches independently of publication", () => {
    expect(gradeBranch(true, "RED", "RED").result).toBe("WIN");
    expect(gradeBranch(true, "RED", "GREEN").raw).toBe(-1);
    expect(gradeBranch(false, "RED", "RED").result).toBeNull();
    expect(gradeBranch(true, "RED", "PUSH").result).toBe("PUSH");
  });
});
