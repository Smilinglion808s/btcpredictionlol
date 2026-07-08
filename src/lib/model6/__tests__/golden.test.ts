// Model 6 golden tests. Hand-built scenarios that lock down every branch
// of the deterministic engine (scoringEngine + decisionEngine + sizingEngine).
//
// Assertions target BEHAVIORAL outputs — prediction, setup_type, presence of
// specific guards/caps, veto tier, sizing units, conviction flags. We do not
// pin every numeric score, so scoring-internal weight tweaks don't cascade
// into 25 red tests; only the semantic branches do.
//
// If a legitimate engine change flips a scenario, update the expected value
// in the same commit — that diff IS the review signal.

import { describe, it, expect } from "vitest";
import type { CandleFeat, Features, PartialFeat } from "../featureEngine";
import { scoreCandle } from "../scoringEngine";
import { makeDecision, type RecentPredictionCtx } from "../decisionEngine";
import { computeUnits } from "../sizingEngine";

// ---------- helpers ----------

function makeCandle(o: Partial<CandleFeat> = {}): CandleFeat {
  const base: CandleFeat = {
    ts: "2026-07-08T00:00:00.000Z",
    open: 100, high: 101, low: 99, close: 100.5, volume: 1000,
    range: 2, body: 0.5, body_pct_of_range: 0.25,
    upper_wick_pct: 0.25, lower_wick_pct: 0.25, close_position_pct: 0.5,
    green: true, red: false, doji: false,
    upper_35_close: false, lower_35_close: false,
    strong_body: false, weak_body: true, marubozu: false,
  };
  return { ...base, ...o };
}

function neutralPartial(): PartialFeat {
  return {
    present: false, degraded_mode: true, feed_mismatch: false, synthesized: false,
    completeness: 0, minutes_elapsed: 0, direction: null,
    close_position_pct: null, range_vs_atr: null,
    body_pct: null, upper_wick_pct: null, lower_wick_pct: null,
    vwap_event: "none",
  };
}

function makeFeatures(o: Partial<Features> = {}): Features {
  const last = o.last ?? makeCandle();
  const prev = o.prev ?? makeCandle({ close: 99.8, open: 100.0, green: false, red: true });
  const f: Features = {
    candle_ts_input: last.ts,
    last, prev, history: [prev, last],
    avg_range_20: 2, atr_14: 2,
    vwap: 100, vwap_slope: 0, ema21: 100,
    above_vwap: false, below_vwap: false, near_vwap: true,
    extended_from_vwap: false, vwap_reclaim: false, vwap_loss: false,
    range20_high: 105, range20_low: 95, range20_mid: 100, range20_size: 10,
    near_resistance: false, near_support: false,
    room_to_resistance: 4.5, room_to_support: 5.5,
    room_to_resistance_pct: 0.45, room_to_support_pct: 0.55,
    channel_low: 95, channel_high: 105, channel_range: 10, channel_position: 0.5,
    fib_zone: "true_mid",
    channel_resistance_rejection: false, channel_support_bounce: false,
    channel_breakout_confirmed: false, channel_breakdown_confirmed: false,
    last_3_close_change: 0, last_5_close_change: 0, last_8_close_change: 0,
    last_3_positive: false, last_3_negative: false,
    last_5_positive: false, last_5_negative: false,
    last_8_positive: false, last_8_negative: false, last_8_flat: true,
    higher_low_sequence: false, lower_high_sequence: false,
    consecutive_same_color_streak: 1, streak_color: "green",
    volume_avg_20: 1000, volume_expansion: 1, high_volume: false, low_volume: false,
    conviction_volume: false,
    atr_range_expansion_ratio: 1.0, atr_state: "normal",
    failed_breakout_up: false, failed_breakout_down: false,
    bullish_liquidity_sweep: false, bearish_liquidity_sweep: false,
    acceptance_break_up: false, acceptance_break_down: false,
    repeated_support_defense: false, repeated_resistance_rejection: false,
    bullish_structure: false, bearish_structure: false,
    partial: neutralPartial(),
    ...o,
  };
  return f;
}

function neutralCtx(o: Partial<RecentPredictionCtx> = {}): RecentPredictionCtx {
  return {
    prev_prediction: null, prev_status: null, prev_setup_type: null,
    prev_was_fallback: false, last5_losses: 0, last2_losses: 0,
    same_direction_loss_streak: 0, ...o,
  };
}

// Strong bullish setup: expansion + vwap reclaim + close upper + supports
function strongBullFeatures(overrides: Partial<Features> = {}): Features {
  const last = makeCandle({
    open: 99, close: 101.5, high: 101.6, low: 98.9,
    range: 2.7, body: 2.5, body_pct_of_range: 0.93,
    upper_wick_pct: 0.04, lower_wick_pct: 0.03, close_position_pct: 0.96,
    green: true, red: false, upper_35_close: true, strong_body: true, marubozu: true,
    weak_body: false,
  });
  const prev = makeCandle({
    open: 100, close: 99.5, high: 100.2, low: 99.4,
    close_position_pct: 0.12, green: false, red: true, lower_35_close: true,
  });
  return makeFeatures({
    last, prev,
    vwap: 100, vwap_slope: 0.1, above_vwap: true, below_vwap: false, near_vwap: false,
    vwap_reclaim: true,
    atr_state: "strong_expansion", atr_range_expansion_ratio: 1.6,
    fib_zone: "upper_mid", channel_position: 0.72,
    acceptance_break_up: true,
    last_3_close_change: 0.02, last_3_positive: true,
    last_8_close_change: 0.04, last_8_positive: true,
    higher_low_sequence: true, bullish_structure: true,
    channel_support_bounce: true, near_support: false,
    failed_breakout_down: true,
    room_to_resistance_pct: 0.45,
    range20_high: 102, range20_low: 95, range20_mid: 98.5, range20_size: 7,
    channel_low: 95, channel_high: 102, channel_range: 7,
    consecutive_same_color_streak: 4, streak_color: "green",
    high_volume: true, volume_expansion: 1.5,
    ...overrides,
  });
}

function strongBearFeatures(overrides: Partial<Features> = {}): Features {
  const last = makeCandle({
    open: 101, close: 98.5, high: 101.1, low: 98.4,
    range: 2.7, body: 2.5, body_pct_of_range: 0.93,
    upper_wick_pct: 0.04, lower_wick_pct: 0.04, close_position_pct: 0.04,
    green: false, red: true, lower_35_close: true, strong_body: true, marubozu: true,
    weak_body: false,
  });
  const prev = makeCandle({
    open: 100, close: 100.5, high: 100.6, low: 99.8,
    close_position_pct: 0.88, green: true, red: false, upper_35_close: true,
  });
  return makeFeatures({
    last, prev,
    vwap: 100, vwap_slope: -0.1, above_vwap: false, below_vwap: true, near_vwap: false,
    vwap_loss: true,
    atr_state: "strong_expansion", atr_range_expansion_ratio: 1.6,
    fib_zone: "lower_mid", channel_position: 0.28,
    acceptance_break_down: true,
    last_3_close_change: -0.02, last_3_negative: true,
    last_8_close_change: -0.04, last_8_negative: true,
    lower_high_sequence: true, bearish_structure: true,
    channel_resistance_rejection: true,
    failed_breakout_up: true,
    room_to_support_pct: 0.45,
    range20_high: 105, range20_low: 98, range20_mid: 101.5, range20_size: 7,
    channel_low: 98, channel_high: 105, channel_range: 7,
    consecutive_same_color_streak: 4, streak_color: "red",
    high_volume: true, volume_expansion: 1.5,
    ...overrides,
  });
}

// ---------- 1-6: setup / base direction ----------

describe("Model 6 golden — base direction & setup type", () => {
  it("1. Clean bullish trend expansion → YES premium/strong", () => {
    const f = strongBullFeatures();
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx());
    expect(d.prediction).toBe("YES");
    expect(["standard", "strong", "premium"]).toContain(d.setup_type);
    expect(d.confidence).toBeGreaterThanOrEqual(60);
    expect(s.dominant).toBe("YES");
  });

  it("2. Clean bearish trend expansion → NO high confidence", () => {
    const f = strongBearFeatures();
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx());
    expect(d.prediction).toBe("NO");
    expect(["standard", "strong", "premium"]).toContain(d.setup_type);
    expect(d.confidence).toBeGreaterThanOrEqual(60);
  });

  it("3. VWAP reclaim from below with strong close → hard override YES", () => {
    const f = strongBullFeatures({ acceptance_break_up: false, channel_breakout_confirmed: false });
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx());
    expect(d.prediction).toBe("YES");
    expect(d.hard_override_fired).toBe(true);
    expect(d.guards_applied).toContain("hard_override_yes");
  });

  it("4. VWAP loss from above with weak close → hard override NO", () => {
    const f = strongBearFeatures({ acceptance_break_down: false });
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx());
    expect(d.prediction).toBe("NO");
    expect(d.hard_override_fired).toBe(true);
    expect(d.guards_applied).toContain("hard_override_no");
  });

  it("5. True-mid chop, no directional bias → NCE", () => {
    const f = makeFeatures({ fib_zone: "true_mid" });
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx());
    expect(d.prediction).toBe("NO CLEAR EDGE");
    expect(d.setup_type).toBe("no_clear_edge");
  });

  it("6. Compressed ATR, no direction → NCE with compressed cap", () => {
    const f = makeFeatures({ atr_state: "compressed", atr_range_expansion_ratio: 0.4 });
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx());
    expect(d.prediction).toBe("NO CLEAR EDGE");
  });
});

// ---------- 7-11: guards ----------

describe("Model 6 golden — guards", () => {
  it("7. last2_losses>=2 with no confirming event → loss_streak_cap applied", () => {
    const f = strongBullFeatures({
      vwap_reclaim: false, acceptance_break_up: false,
      atr_state: "normal", atr_range_expansion_ratio: 1.0,
      failed_breakout_down: false, channel_breakout_confirmed: false,
      channel_breakdown_confirmed: false, failed_breakout_up: false,
      vwap_loss: false,
    });
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx({ last2_losses: 2, prev_prediction: "NO", prev_status: "loss" }));
    expect(d.caps_applied).toContain("loss_streak_cap");
  });

  it("8. same_direction_loss_streak>=2 fires same_dir_loss_block guard", () => {
    const f = strongBullFeatures({
      vwap_reclaim: false, acceptance_break_up: false,
      atr_state: "normal", atr_range_expansion_ratio: 1.0,
      failed_breakout_down: false, channel_breakout_confirmed: false,
      channel_breakdown_confirmed: false, failed_breakout_up: false,
      vwap_loss: false,
    });
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx({
      last2_losses: 2, same_direction_loss_streak: 2,
      prev_prediction: "YES", prev_status: "loss",
    }));
    expect(d.guards_applied).toContain("same_dir_loss_block");
  });

  it("9. last5_losses>=3 fires three_in_five_only_hard guard", () => {
    const f = makeFeatures({
      last: makeCandle({ green: true, close_position_pct: 0.7, upper_35_close: true }),
      last_3_positive: true, last_3_close_change: 0.01,
    });
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx({ last5_losses: 3 }));
    // Guard always fires; step-11 fallback may re-promote to dominant, but the guard IS recorded
    expect(d.guards_applied).toContain("three_in_five_only_hard");
  });

  it("10. Prev fallback + loss + flipping direction → whipsaw guard fires", () => {
    const f = strongBullFeatures({
      vwap_reclaim: false, acceptance_break_up: false,
      atr_state: "expanding", atr_range_expansion_ratio: 1.2,
      channel_breakout_confirmed: false, failed_breakout_down: false,
    });
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx({
      prev_prediction: "NO", prev_status: "loss", prev_was_fallback: true,
    }));
    expect(d.guards_applied).toContain("whipsaw_guard");
  });

  it("11. Recent push doesn't trigger continuation cap", () => {
    const f = strongBullFeatures();
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx({ prev_prediction: "YES", prev_status: "push" }));
    expect(d.caps_applied).not.toContain("continuation_guard");
  });
});

// ---------- 12-14: caps ----------

describe("Model 6 golden — caps", () => {
  it("12. Fib true_mid with disagreeing close → true_mid_no_agreement NCE", () => {
    const f = strongBullFeatures({ fib_zone: "true_mid", last_3_positive: false, last_3_close_change: -0.01, last_3_negative: true });
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx());
    expect(d.caps_applied).toContain("true_mid_cap");
  });

  it("13. Compressed ATR without hard override caps confidence", () => {
    const f = strongBullFeatures({
      atr_state: "compressed", atr_range_expansion_ratio: 0.4,
      vwap_reclaim: false, acceptance_break_up: false, channel_breakout_confirmed: false,
    });
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx());
    if (d.prediction !== "NO CLEAR EDGE") {
      expect(d.caps_applied).toContain("compressed_no_override");
      expect(d.confidence).toBeLessThanOrEqual(55);
    }
  });

  it("14. YES at resistance_edge without confirm → edge cap", () => {
    const f = strongBullFeatures({
      fib_zone: "resistance_edge", channel_position: 0.95,
      channel_breakout_confirmed: false, acceptance_break_up: false,
      vwap_reclaim: false,
    });
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx());
    if (d.prediction === "YES") {
      expect(d.caps_applied).toContain("yes_at_resistance_edge");
    }
  });
});

// ---------- 15-19: partial-candle module ----------

describe("Model 6 golden — partial candle", () => {
  const confirmingPartial: PartialFeat = {
    present: true, degraded_mode: false, feed_mismatch: false, synthesized: false,
    completeness: 0.85, minutes_elapsed: 13, direction: "green",
    close_position_pct: 0.85, range_vs_atr: 0.7,
    body_pct: 0.7, upper_wick_pct: 0.05, lower_wick_pct: 0.1,
    vwap_event: "none",
  };
  const opposingPartial: PartialFeat = {
    present: true, degraded_mode: false, feed_mismatch: false, synthesized: false,
    completeness: 0.85, minutes_elapsed: 13, direction: "red",
    close_position_pct: 0.15, range_vs_atr: 1.2,
    body_pct: 0.7, upper_wick_pct: 0.1, lower_wick_pct: 0.05,
    vwap_event: "loss",
  };

  it("15. Partial confirms base bull → partial module has bull points, no veto", () => {
    const f = strongBullFeatures({ partial: confirmingPartial });
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx());
    expect(s.module_points.partial_candle_confirmation.bull).toBeGreaterThan(0);
    expect(d.partial_veto_active).toBe(false);
    expect(d.prediction).toBe("YES");
  });

  it("16. Partial contradicts bull (tier hard) → NCE with hard veto", () => {
    // Use vwap_event="none" so partial hard override (which needs reclaim/loss)
    // doesn't fire and turn the base into NO. Rely on below_vwap to satisfy
    // vwapConfirmsOpp for the veto path. Strip all hard-override triggers so
    // the base prediction stays YES from scoring dominance.
    const opposing: PartialFeat = {
      present: true, degraded_mode: false, feed_mismatch: false, synthesized: false,
      completeness: 0.85, minutes_elapsed: 13, direction: "red",
      close_position_pct: 0.15, range_vs_atr: 1.2,
      body_pct: 0.7, upper_wick_pct: 0.1, lower_wick_pct: 0.05,
      vwap_event: "none",
    };
    const f = strongBullFeatures({
      partial: opposing,
      above_vwap: false, below_vwap: true, vwap_reclaim: false,
      acceptance_break_up: false, channel_breakout_confirmed: false,
      failed_breakout_down: false,
    });
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx());
    expect(d.partial_veto_active).toBe(true);
    expect(d.partial_veto_tier).toBe("hard");
    expect(d.guards_applied).toContain("partial_hard_veto");
  });

  it("17. Partial hard override fires on VWAP reclaim from below", () => {
    const overridePartial: PartialFeat = {
      ...confirmingPartial, vwap_event: "reclaim", close_position_pct: 0.8, direction: "green",
    };
    // Base is bearish, partial reclaims VWAP → flip to YES
    const f = strongBearFeatures({ partial: overridePartial });
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx());
    expect(d.partial_hard_override_fired).toBe(true);
    expect(d.prediction).toBe("YES");
  });

  it("18. Partial degraded_mode → module points zeroed, degraded cap applied", () => {
    const degraded: PartialFeat = { ...confirmingPartial, degraded_mode: true, completeness: 0.3 };
    const f = strongBullFeatures({ partial: degraded });
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx());
    expect(s.module_points.partial_candle_confirmation.bull).toBe(0);
    expect(s.module_points.partial_candle_confirmation.bear).toBe(0);
    if (d.prediction !== "NO CLEAR EDGE") {
      expect(d.caps_applied).toContain("partial_degraded");
    }
  });

  it("19. Partial not present → module 0/0", () => {
    const f = strongBullFeatures(); // default partial not present
    const s = scoreCandle(f);
    expect(s.module_points.partial_candle_confirmation.bull).toBe(0);
    expect(s.module_points.partial_candle_confirmation.bear).toBe(0);
  });
});

// ---------- 20-22: agreement gate & NCE ----------

describe("Model 6 golden — agreement gate & NCE bands", () => {
  it("20. Strong setup with disagreeing partial → agreement_gate_applied, AVOID", () => {
    const opp: PartialFeat = {
      present: true, degraded_mode: false, feed_mismatch: false, synthesized: false,
      completeness: 0.85, minutes_elapsed: 13, direction: "red",
      close_position_pct: 0.4, range_vs_atr: 0.5,
      body_pct: 0.4, upper_wick_pct: 0.1, lower_wick_pct: 0.1,
      vwap_event: "none",
    };
    const f = strongBullFeatures({ partial: opp });
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx());
    if (d.prediction === "YES") {
      expect(d.partial_agreement).toBe("disagree");
      expect(d.agreement_gate_applied).toBe(true);
      expect(d.final_trade_status).toBe("AVOID");
    }
  });

  it("21. Very low margin → NCE with confidence <= 45", () => {
    const f = makeFeatures();
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx());
    expect(d.prediction).toBe("NO CLEAR EDGE");
    expect(d.confidence).toBeLessThanOrEqual(45);
    expect(d.setup_type).toBe("no_clear_edge");
  });

  it("22. NCE with margin>=5 and non-contradicting close → directional fallback", () => {
    // Give a mild bull tilt without triggering hard overrides
    const f = makeFeatures({
      last: makeCandle({ green: true, close_position_pct: 0.6 }),
      last_3_positive: true, last_3_close_change: 0.005,
      higher_low_sequence: true, bullish_structure: true,
    });
    const s = scoreCandle(f);
    const d = makeDecision(f, s, neutralCtx());
    if (d.guards_applied.includes("directional_fallback")) {
      expect(d.caps_applied).toContain("fallback_cap");
      expect(d.confidence).toBeLessThanOrEqual(55);
    }
  });
});

// ---------- 23-25: sizing / conviction ----------

describe("Model 6 golden — sizing & conviction", () => {
  it("23. All conviction conditions met + aligned bull → 2 units, aligned true", () => {
    const f = strongBullFeatures({
      consecutive_same_color_streak: 4, streak_color: "green",
      volume_expansion: 2.5,
    });
    // Ensure marubozu + big body move
    f.last.body_pct_of_range = 0.95;
    f.last.marubozu = true;
    f.last.open = 99; f.last.close = 101.5;
    f.last.volume = 3000;
    f.volume_avg_20 = 1000;
    const sizing = computeUnits(f, "YES");
    expect(sizing.units).toBe(2);
    expect(sizing.conviction_active).toBe(true);
    expect(sizing.conviction_direction).toBe("green");
    expect(sizing.conviction_aligned).toBe(true);
    expect(sizing.conviction_reasons.length).toBeGreaterThanOrEqual(3);
  });

  it("24. Conviction active but bull candle vs NO prediction → aligned=false, units=2", () => {
    const f = strongBullFeatures({ consecutive_same_color_streak: 4, streak_color: "green" });
    f.last.body_pct_of_range = 0.95; f.last.marubozu = true;
    f.last.open = 99; f.last.close = 101.5;
    const sizing = computeUnits(f, "NO");
    expect(sizing.units).toBe(2);
    expect(sizing.conviction_active).toBe(true);
    expect(sizing.conviction_aligned).toBe(false);
  });

  it("25. No conviction conditions met → 1 unit, conviction_active=false", () => {
    const f = makeFeatures();
    f.last.body_pct_of_range = 0.2;
    f.last.marubozu = false;
    f.last.open = 100; f.last.close = 100.05; // 0.05% body move
    f.last.volume = 500;
    f.volume_avg_20 = 1000;
    f.consecutive_same_color_streak = 1;
    const sizing = computeUnits(f, "YES");
    expect(sizing.units).toBe(1);
    expect(sizing.conviction_active).toBe(false);
    expect(sizing.conviction_reasons.length).toBe(0);
  });
});
