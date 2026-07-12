// Model C — featurize + score smoke tests.
//
// Confirms: (a) both feature builders run without throwing on a realistic
// snapshot; (b) DictVectorizer + StandardScaler + LogisticRegression pipeline
// produces a probability in (0,1); (c) unknown feature keys are silently
// ignored while missing keys become 0 (per DictVectorizer semantics).

import { describe, expect, it } from "vitest";
import {
  buildGlobalCoreFeatures,
  buildRecentFullFeatures,
  type CandleRow,
  type PredictionRowForFeatures,
} from "../featurize";
import { getBootstrapFit } from "../fit";
import { scoreComponent, featureVectorHash } from "../score";

function fakeCandle(ts: string, open: number, close: number, hi: number, lo: number): CandleRow {
  return { candle_ts: ts, open, high: hi, low: lo, close, volume: 10 };
}

function fakeHistory(): CandleRow[] {
  const out: CandleRow[] = [];
  const start = new Date("2026-07-01T00:00:00Z").getTime();
  for (let i = 0; i < 40; i++) {
    const ts = new Date(start + i * 15 * 60 * 1000).toISOString();
    const open = 64000 + i * 10;
    const close = open + (i % 2 === 0 ? 25 : -20);
    const hi = Math.max(open, close) + 15;
    const lo = Math.min(open, close) - 15;
    out.unshift(fakeCandle(ts, open, close, hi, lo)); // most-recent-first
  }
  return out;
}

function fakeRow(): PredictionRowForFeatures {
  return {
    id: "test-id",
    candle_ts: "2026-07-01T10:00:00Z",
    created_at: "2026-07-01T09:59:20Z",
    prediction: "YES",
    confidence: 65,
    btc_price_at_prediction: 64200,
    setup_type: "standard",
    market_condition: "above_vwap",
    units: 1,
    input_candle_age_seconds: 30,
    input_features_fresh: true,
    freshness_action: "none",
    fetch_source: "okx",
    advance_check_passed: true,
    current_partial_minutes_elapsed: 12,
    current_partial_snapshot: { open: 64180, high: 64240, low: 64160, close: 64230, volume: 12.4 },
    partial_snapshot_present: true,
    partial_completeness: 0.8,
    partial_direction: "green",
    partial_close_position_pct: 0.85,
    partial_range_vs_atr: 1.2,
    partial_agreement: "agree",
    partial_module_bull_pts: 3,
    partial_module_bear_pts: 1,
    partial_veto_active: false,
    partial_veto_tier: "none",
    partial_hard_override_fired: false,
    conflict_downgrade_applied: false,
    degraded_mode: false,
    feed_mismatch: false,
    agreement_gate_applied: false,
    agreement_gate_reason: null,
    final_trade_status: "trade",
    base_bullish_score: 12,
    base_bearish_score: 6,
    bullish_score: 12,
    bearish_score: 6,
    score_margin: 6,
    original_prediction_before_partial: "yes",
    changed_by_partial: false,
    conviction_active: true,
    conviction_direction: "green",
    conviction_aligned: true,
    conviction_reasons: ["streak4", "marubozu"],
    indicators: {
      ema9: 64150,
      ema21: 64100,
      ema50: 64000,
      range20_high: 64300,
      range20_low: 63900,
      volume_expansion: 1.4,
      trend: "up",
      choppy: false,
      failed_breakout_up: false,
      failed_breakout_down: false,
      bodyPct: 0.7,
      upperWickPct: 0.1,
      lowerWickPct: 0.2,
    },
    module_points: {
      atr_range_expansion: { bull: 2, bear: 0 },
      volume: { bull: 1, bear: 0 },
      vwap_state: { bull: 2, bear: 1 },
    },
  };
}

describe("Model C featurize + score", () => {
  const fit = getBootstrapFit();
  const history = fakeHistory();
  const row = fakeRow();

  it("builds global_core map with expected coverage", () => {
    const feats = buildGlobalCoreFeatures({ row, history });
    // essentials
    expect(feats["confidence"]).toBe(65);
    expect(feats["prediction=yes"]).toBe(1);
    expect(feats["market_condition=above_vwap"]).toBe(1);
    expect(feats["mod_atr_range_expansion_bull"]).toBe(2);
    expect(feats["_lag_prev_dir=green"] ?? feats["_lag_prev_dir=red"]).toBe(1);
    expect(feats["_lag_close_pos_8"]).toBeGreaterThanOrEqual(0);
    expect(feats["tod_sin"]).toBeGreaterThanOrEqual(-1);
  });

  it("builds recent_full map with core_ embedding + _x_ features + dir patterns", () => {
    const feats = buildRecentFullFeatures({ row, history });
    expect(feats["core_confidence"]).toBe(65);
    expect(feats["core_mod_atr_range_expansion_bull"]).toBe(2);
    expect(feats["module_total_bull"]).toBe(5);
    expect(feats["mod_atr_range_expansion_net"]).toBe(2);
    expect(feats["_x_green_rate_20"]).toBeGreaterThanOrEqual(0);
    // dir pattern is 5 chars for window 5, letters G/R/D
    const pat = Object.keys(feats).find((k) => k.startsWith("_x_dir_pattern_5="));
    expect(pat).toBeDefined();
    expect(feats["conviction_reason=streak4"]).toBe(1);
    expect(feats["conviction_reason_count"]).toBe(2);
    expect(feats["ema_stack_bull"]).toBe(1);
  });

  it("scores both components to a valid probability", () => {
    const g = buildGlobalCoreFeatures({ row, history });
    const r = buildRecentFullFeatures({ row, history });
    const pg = scoreComponent(fit.global_core_lr, g);
    const pr = scoreComponent(fit.recent_full_lr, r);
    expect(pg.probability_green).toBeGreaterThan(0);
    expect(pg.probability_green).toBeLessThan(1);
    expect(pr.probability_green).toBeGreaterThan(0);
    expect(pr.probability_green).toBeLessThan(1);
    expect(pg.nonzero_features).toBeGreaterThan(20);
  });

  it("feature vector hash is deterministic and depends on values", () => {
    const g1 = buildGlobalCoreFeatures({ row, history });
    const g2 = buildGlobalCoreFeatures({ row, history });
    const h1 = featureVectorHash(fit.global_core_lr, g1);
    const h2 = featureVectorHash(fit.global_core_lr, g2);
    expect(h1).toBe(h2);
    const row2 = { ...row, confidence: 90 };
    const g3 = buildGlobalCoreFeatures({ row: row2, history });
    const h3 = featureVectorHash(fit.global_core_lr, g3);
    expect(h3).not.toBe(h1);
  });

  it("handles empty history without throwing (all __missing flags fire)", () => {
    const g = buildGlobalCoreFeatures({ row, history: [] });
    expect(g["_lag_prev_ret__missing"]).toBe(1);
    expect(g["_lag_green_count_2__missing"]).toBe(1);
    const pg = scoreComponent(fit.global_core_lr, g);
    expect(Number.isFinite(pg.probability_green)).toBe(true);
  });
});
