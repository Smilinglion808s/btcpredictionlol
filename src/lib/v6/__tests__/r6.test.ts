import { describe, expect, it } from "vitest";
import {
  applyPromotionRouter,
  evaluatePromotionRules,
  promotionContribution,
  R5_ROUTE_BRAKE_PUBLICATION_ENABLED,
  R5_ROUTE_BRAKE_SHADOW_ONLY,
  R6_P1_MOMENTUM8_ATR_MAX,
  R6_P1_PATH_EFFICIENCY_MIN,
  R6_P2_ROC8_MIN,
  R6_P2_VOLUME_EXPANSION_MAX,
  R6_P3_CHANGE_PCT_MIN,
  R6_P3_CHANNEL_POSITION_MAX,
  R6_P4_MACD_HIST_ATR_MIN,
  R6_P4_MEAN_BODY_RANGE_MAX,
  R6_P5_CHANGE_PCT_MIN,
  R6_P5_DIST_LOW20_MAX,
  R6_P6_MEAN_BODY_RANGE_MAX,
  R6_P6_PATH_EFFICIENCY_MIN,
  V6_R6_MODEL_REVISION,
  V6_R6_ROUTER_VERSION,
} from "../r6";
import { V6_ARTIFACT_SHA256, V6_FEATURE_SCHEMA_VERSION } from "../config";
import {
  R5_GREEN_STOCH_SPREAD_MAX,
  R5_GREEN_D1_MEAN_BODY_RANGE_MAX,
  R5_RED_ANCHOR_D1_CLOSE_POSITION_MAX,
  R5_RED_BROAD_BB_WIDTH_MAX,
  R5_RED_BROAD_CLOSE_SLOPE_MIN,
  evaluateR5Router,
} from "../r5";
import { V6_CSV_COLUMNS } from "../csv";
import { R5_ROUTE_BRAKE_PAUSE_LOSSES, R5_ROUTE_BRAKE_RESUME_WINS, applyRouteBrake } from "../routeBrake";

// Inputs that trigger no promotion rule at all.
const NEUTRAL = {
  path_efficiency_4: 0.5,
  momentum_8_over_atr: 2,
  roc_8: 0,
  volume_expansion: 1,
  channel_position_0_1: 0.5,
  change_pct: 0.05,
  mean_body_to_range_2: 0.9,
  macd_hist_over_atr14: 0,
  dist_to_low20_pct: 2,
};

const GREEN_ONLY = { ...NEUTRAL, path_efficiency_4: 0.9, momentum_8_over_atr: 0.5 }; // P1
const RED_ONLY = { ...NEUTRAL, roc_8: 0.2, volume_expansion: 0.2 }; // P2
const CONFLICT = { ...GREEN_ONLY, roc_8: 0.2, volume_expansion: 0.2 };

const abstain = (i: Record<string, unknown>) =>
  applyPromotionRouter("ABSTAIN", "ABSTAIN", "R5_NO_QUALIFIED_ROUTE", i);

describe("V6-r6 core / r5 preservation", () => {
  it("keeps the frozen artifact hash and feature schema", () => {
    expect(V6_ARTIFACT_SHA256).toBe(
      "b30889bfc1117f67bb81606bea664184330648e550dac402e43a42e592244146",
    );
    expect(V6_FEATURE_SCHEMA_VERSION).toBe("v6-72r-123gb-4a");
  });

  it("keeps every r5 threshold unchanged", () => {
    expect(R5_GREEN_STOCH_SPREAD_MAX).toBe(-0.08);
    expect(R5_GREEN_D1_MEAN_BODY_RANGE_MAX).toBe(0.23);
    expect(R5_RED_ANCHOR_D1_CLOSE_POSITION_MAX).toBe(0.3);
    expect(R5_RED_BROAD_CLOSE_SLOPE_MIN).toBe(-0.08);
    expect(R5_RED_BROAD_BB_WIDTH_MAX).toBe(0.9);
  });

  it("keeps the r5 GREEN, Anchor RED, Broad RED and conflict routes intact", () => {
    const green = {
      stoch_spread: -0.2, d1_mean_body_to_range_2: 0.1, d1_close_position_in_range: 0.9,
      close_slope_8: 1, bb_width_pct: 5, aligned_wick_pressure_4: 0.05,
    };
    expect(evaluateR5Router("ABSTAIN", "V6_BASE", "BROAD", green).decision).toBe("GREEN");
    expect(evaluateR5Router("RED", "V6_BASE", "ANCHOR", {
      ...green, stoch_spread: 0.5, d1_close_position_in_range: 0.1,
    }).decision).toBe("RED");
    expect(evaluateR5Router("RED", "V6_BASE", "BROAD", {
      ...green, stoch_spread: 0.5, close_slope_8: 0, bb_width_pct: 0.5,
    }).decision).toBe("RED");
    expect(evaluateR5Router("RED", "V6_BASE", "ANCHOR", {
      ...green, d1_close_position_in_range: 0.1,
    }).decision).toBe("ABSTAIN");
  });

  it("identifies the revision and router version", () => {
    expect(V6_R6_MODEL_REVISION).toBe("V6-r6-promotion-router");
    expect(abstain(NEUTRAL).routerVersion).toBe(V6_R6_ROUTER_VERSION);
  });
});

describe("V6-r5.1 brake demotion", () => {
  const paused = { pauseActive: true, consecutiveShadowLosses: 2 };
  const open = { pauseActive: false, consecutiveShadowLosses: 0 };

  it("is flagged shadow-only with publication disabled", () => {
    expect(R5_ROUTE_BRAKE_SHADOW_ONLY).toBe(true);
    expect(R5_ROUTE_BRAKE_PUBLICATION_ENABLED).toBe(false);
  });

  it("still computes its own veto decision and thresholds", () => {
    const brake = applyRouteBrake(
      "GREEN", "V6_R5_GREEN_STOCH_PULLBACK", "R5_GREEN_ROUTE", paused, open,
    );
    expect(brake.triggered).toBe(true);
    expect(brake.prediction).toBe("ABSTAIN");
    expect(R5_ROUTE_BRAKE_PAUSE_LOSSES).toBe(2);
    expect(R5_ROUTE_BRAKE_RESUME_WINS).toBe(1);
  });

  it("cannot change the r6 publication: the base is the UNBRAKED r5 result", () => {
    const brake = applyRouteBrake(
      "GREEN", "V6_R5_GREEN_STOCH_PULLBACK", "R5_GREEN_ROUTE", paused, open,
    );
    const r6 = applyPromotionRouter("GREEN", "V6_R5_GREEN_STOCH_PULLBACK", "R5_GREEN_ROUTE", NEUTRAL);
    expect(brake.prediction).toBe("ABSTAIN");
    expect(r6.prediction).toBe("GREEN");
    expect(r6.reason).toBe("R6_KEEP_R5_DIRECTION");
  });
});

describe("V6-r6 P1-P6 boundary behaviour", () => {
  const cand = (i: Record<string, unknown>, key: "p1" | "p2" | "p3" | "p4" | "p5" | "p6") =>
    evaluatePromotionRules(i)[key].candidate;

  it("P1 boundaries", () => {
    const base = { path_efficiency_4: R6_P1_PATH_EFFICIENCY_MIN, momentum_8_over_atr: R6_P1_MOMENTUM8_ATR_MAX };
    expect(cand(base, "p1")).toBe(true);
    expect(cand({ ...base, path_efficiency_4: 0.8149 }, "p1")).toBe(false);
    expect(cand({ ...base, momentum_8_over_atr: 0.8671 }, "p1")).toBe(false);
    expect(cand({ path_efficiency_4: 0.9 }, "p1")).toBe(false);
  });

  it("P2 boundaries", () => {
    const base = { roc_8: R6_P2_ROC8_MIN, volume_expansion: R6_P2_VOLUME_EXPANSION_MAX };
    expect(cand(base, "p2")).toBe(true);
    expect(cand({ ...base, roc_8: 0.1309 }, "p2")).toBe(false);
    expect(cand({ ...base, volume_expansion: 0.3591 }, "p2")).toBe(false);
    expect(cand({ roc_8: 0.5 }, "p2")).toBe(false);
  });

  it("P3 boundaries", () => {
    const base = { channel_position_0_1: R6_P3_CHANNEL_POSITION_MAX, change_pct: R6_P3_CHANGE_PCT_MIN };
    expect(cand(base, "p3")).toBe(true);
    expect(cand({ ...base, channel_position_0_1: 0.1091 }, "p3")).toBe(false);
    expect(cand({ ...base, change_pct: -0.0381 }, "p3")).toBe(false);
    expect(cand({ channel_position_0_1: 0.01 }, "p3")).toBe(false);
  });

  it("P4 boundaries", () => {
    const base = { mean_body_to_range_2: R6_P4_MEAN_BODY_RANGE_MAX, macd_hist_over_atr14: R6_P4_MACD_HIST_ATR_MIN };
    expect(cand(base, "p4")).toBe(true);
    expect(cand({ ...base, mean_body_to_range_2: 0.3831 }, "p4")).toBe(false);
    expect(cand({ ...base, macd_hist_over_atr14: 0.1969 }, "p4")).toBe(false);
    expect(cand({ macd_hist_over_atr14: 1 }, "p4")).toBe(false);
  });

  it("P5 boundaries", () => {
    const base = { dist_to_low20_pct: R6_P5_DIST_LOW20_MAX, change_pct: R6_P5_CHANGE_PCT_MIN };
    expect(cand(base, "p5")).toBe(true);
    expect(cand({ ...base, dist_to_low20_pct: 0.6051 }, "p5")).toBe(false);
    expect(cand({ ...base, change_pct: 0.1519 }, "p5")).toBe(false);
    expect(cand({ dist_to_low20_pct: 0.1 }, "p5")).toBe(false);
  });

  it("P6 boundaries", () => {
    const base = { path_efficiency_4: R6_P6_PATH_EFFICIENCY_MIN, mean_body_to_range_2: R6_P6_MEAN_BODY_RANGE_MAX };
    expect(cand(base, "p6")).toBe(true);
    expect(cand({ ...base, path_efficiency_4: 0.8149 }, "p6")).toBe(false);
    expect(cand({ ...base, mean_body_to_range_2: 0.3191 }, "p6")).toBe(false);
    expect(cand({ mean_body_to_range_2: 0.1 }, "p6")).toBe(false);
  });

  it("fails each rule closed on missing / non-finite inputs without disabling the others", () => {
    const rules = evaluatePromotionRules({
      ...GREEN_ONLY,
      roc_8: Number.NaN,
      volume_expansion: null,
      channel_position_0_1: undefined,
      mean_body_to_range_2: "abc",
      macd_hist_over_atr14: Number.POSITIVE_INFINITY,
      dist_to_low20_pct: Number.NaN,
    });
    for (const k of ["p2", "p3", "p4", "p5", "p6"] as const) {
      expect(rules[k].evaluable).toBe(false);
      expect(rules[k].candidate).toBe(false);
    }
    expect(rules.p1.evaluable).toBe(true);
    expect(rules.p1.candidate).toBe(true);
  });
});

describe("V6-r6 aggregation and publication", () => {
  it("keeps an existing r5 GREEN even when RED promotion rules trigger", () => {
    const r = applyPromotionRouter("GREEN", "V6_R5_GREEN_STOCH_PULLBACK", "R5_GREEN_ROUTE", RED_ONLY);
    expect(r.prediction).toBe("GREEN");
    expect(r.source).toBe("V6_R5_GREEN_STOCH_PULLBACK");
    expect(r.reason).toBe("R6_KEEP_R5_DIRECTION");
    expect(r.promoted).toBe(false);
  });

  it("keeps an existing r5 RED even when GREEN promotion rules trigger", () => {
    const r = applyPromotionRouter("RED", "V6_R5_RED_ANCHOR_CLOSE_CONTROL", "R5_RED_ANCHOR_ROUTE", GREEN_ONLY);
    expect(r.prediction).toBe("RED");
    expect(r.reason).toBe("R6_KEEP_R5_DIRECTION");
  });

  it("publishes GREEN on a GREEN-only promotion", () => {
    const r = abstain(GREEN_ONLY);
    expect(r.prediction).toBe("GREEN");
    expect(r.source).toBe("V6_R6_PROMOTION_ROUTER");
    expect(r.reason).toBe("R6_GREEN_PROMOTION");
  });

  it("publishes RED on a RED-only promotion", () => {
    const r = abstain(RED_ONLY);
    expect(r.prediction).toBe("RED");
    expect(r.reason).toBe("R6_RED_PROMOTION");
  });

  it("abstains on a GREEN/RED promotion conflict", () => {
    const r = abstain(CONFLICT);
    expect(r.prediction).toBe("ABSTAIN");
    expect(r.reason).toBe("R6_PROMOTION_CONFLICT");
    expect(r.conflict).toBe(true);
    expect(r.greenCandidate && r.redCandidate).toBe(true);
  });

  it("abstains when no promotion rule triggers", () => {
    const r = abstain(NEUTRAL);
    expect(r.prediction).toBe("ABSTAIN");
    expect(r.reason).toBe("R6_NO_PROMOTION");
  });

  it("counts multiple same-direction triggers as exactly one trade", () => {
    // P1 and P6 both fire; still a single GREEN publication.
    const r = abstain({ ...NEUTRAL, path_efficiency_4: 0.9, momentum_8_over_atr: 0.5, mean_body_to_range_2: 0.1 });
    expect(r.greenRuleCount).toBe(2);
    expect(r.greenRulesTriggered).toEqual(["P1_GREEN_EFFICIENCY_MOMENTUM", "P6_GREEN_EFFICIENCY_BODY"]);
    expect(r.prediction).toBe("GREEN");
    expect(r.promoted).toBe(true);
  });

  it("uses attribution priority for reporting only", () => {
    const r = abstain({ ...NEUTRAL, path_efficiency_4: 0.9, momentum_8_over_atr: 0.5, mean_body_to_range_2: 0.1 });
    expect(r.primaryRule).toBe("P1_GREEN_EFFICIENCY_MOMENTUM");
    expect(r.prediction).toBe("GREEN");
  });

  it("never flips or vetoes an r5 direction under any promotion combination", () => {
    for (const inputs of [NEUTRAL, GREEN_ONLY, RED_ONLY, CONFLICT]) {
      expect(applyPromotionRouter("GREEN", "S", "R", inputs).prediction).toBe("GREEN");
      expect(applyPromotionRouter("RED", "S", "R", inputs).prediction).toBe("RED");
    }
  });

  it("contains no time-of-day, session, cap or cooldown logic", () => {
    const src = String(applyPromotionRouter) + String(evaluatePromotionRules);
    for (const banned of ["getHours", "Boise", "session", "cooldown", "Date("]) {
      expect(src.includes(banned)).toBe(false);
    }
  });
});

describe("V6-r6 contribution accounting", () => {
  it("scores a promotion WIN as +1 raw / +0.8 adjusted", () => {
    expect(promotionContribution(true, "GREEN", "GREEN")).toEqual({ result: "WIN", raw: 1, adjusted: 0.8 });
  });

  it("scores a promotion LOSS as -1 raw / -1 adjusted", () => {
    expect(promotionContribution(true, "RED", "GREEN")).toEqual({ result: "LOSS", raw: -1, adjusted: -1 });
  });

  it("contributes zero when nothing was promoted (conflict or abstain)", () => {
    expect(promotionContribution(false, "ABSTAIN", "GREEN")).toEqual({ result: null, raw: 0, adjusted: 0 });
  });

  it("treats PUSH as zero contribution", () => {
    expect(promotionContribution(true, "GREEN", "PUSH")).toEqual({ result: "PUSH", raw: 0, adjusted: 0 });
  });

  it("is deterministic: the same inputs reproduce the same decision", () => {
    const a = abstain(GREEN_ONLY);
    const b = abstain(GREEN_ONLY);
    expect(a.prediction).toBe(b.prediction);
    expect(a.allRules).toEqual(b.allRules);
  });
});

describe("V6-r6 CSV surface", () => {
  it("exports every required r6 field", () => {
    const required = [
      "r6_router_version", "r6_base_prediction", "r6_base_source", "r6_base_reason",
      "r5_route_brake_shadow_only", "r5_route_brake_publication_enabled",
      "r5_route_brake_shadow_prediction", "r5_route_brake_shadow_reason",
      "r6_p1_evaluable", "r6_p1_green_candidate", "r6_p1_path_efficiency_4",
      "r6_p2_red_candidate", "r6_p3_green_candidate", "r6_p4_red_candidate",
      "r6_p5_green_candidate", "r6_p6_green_candidate",
      "r6_green_promotion_candidate", "r6_red_promotion_candidate",
      "r6_green_promotion_rules_triggered", "r6_red_promotion_rules_triggered",
      "r6_promotion_conflict", "r6_promotion_primary_rule", "r6_promotion_all_rules",
      "r6_final_prediction", "r6_final_source", "r6_final_reason",
      "r6_final_result", "r6_final_raw_score", "r6_final_adjusted_score",
      "r6_promotion_raw_contribution", "r6_promotion_adjusted_contribution",
      "r6_valid_opportunities", "r6_coverage", "r6_rolling96_valid_opportunities",
      "r6_rolling96_coverage", "r6_p1_count", "r6_p6_adjusted_net",
    ];
    for (const c of required) expect(V6_CSV_COLUMNS).toContain(c);
  });

  it("keeps every legacy V6 column", () => {
    for (const c of ["final_prediction", "r5_router_decision", "r5_route_brake_triggered", "cumulative_raw_net"]) {
      expect(V6_CSV_COLUMNS).toContain(c);
    }
  });
});
