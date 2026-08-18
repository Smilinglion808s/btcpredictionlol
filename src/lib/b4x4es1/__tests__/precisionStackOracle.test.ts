import { describe, expect, it } from "vitest";
import oracle from "./precision-oracle-224.json";
import {
  decidePrecisionStack,
  scoreLeg,
  upperWickPercentile,
  type Direction,
  type Outcome,
  type PrecisionStackInputs,
} from "../precisionStack";

interface OracleRow {
  source_index: number;
  target_ts: string;
  actual_direction: string;
  spot_adaptive_direction: string | null;
  perp_adaptive_direction: string | null;
  perp_sign_change_count_60s: number | null;
  spot_normalized_ofi_5s: number | null;
  technical_direction: string | null;
  technical_confidence: number | null;
  activity_guard_passed: boolean;
  balanced_core: boolean;
  balanced_fill: boolean;
  balanced_would_trade: boolean;
  balanced_direction: string | null;
  balanced_score: number;
  prior_trend_age_candles: number | null;
  prior_upper_wick_share: number;
  upper_wick_percentile_96: number | null;
  primary_would_trade: boolean;
  primary_direction: string | null;
  primary_score: number;
  rescue_would_trade: boolean;
  rescue_direction: string | null;
  rescue_score: number;
  combined_would_trade: boolean;
  combined_direction: string | null;
  combined_score: number;
}

const rows = (oracle as { rows: OracleRow[] }).rows;
const expected = (oracle as {
  expected: Record<string, { trades: number; wins: number; losses: number; pushes: number; net: number }>;
}).expected;

function toInputs(r: OracleRow): PrecisionStackInputs {
  return {
    spotAdaptiveDirection: (r.spot_adaptive_direction as Direction | null) ?? null,
    perpAdaptiveDirection: (r.perp_adaptive_direction as Direction | null) ?? null,
    perpSignChangeCount60s: r.perp_sign_change_count_60s,
    spotNormalizedOfi5s: r.spot_normalized_ofi_5s,
    technicalDirection: (r.technical_direction as Direction | null) ?? null,
    technicalConfidence: r.technical_confidence,
    priorTrendAgeCandles: r.prior_trend_age_candles,
    upperWickPercentile96: r.upper_wick_percentile_96,
  };
}

function tally(legs: { wouldTrade: boolean; direction: Direction | null }[], actuals: (Outcome | null)[]) {
  let trades = 0, wins = 0, losses = 0, pushes = 0, net = 0;
  legs.forEach((leg, i) => {
    if (!leg.wouldTrade) return;
    trades++;
    const a = actuals[i];
    if (a === "PUSH" || !a) pushes++;
    else if (a === leg.direction) wins++;
    else losses++;
    net += scoreLeg(leg, a);
  });
  return { trades, wins, losses, pushes, net };
}

describe("B4x4-ES1 Balanced Precision Stack R1 — oracle parity (224 rows)", () => {
  const decisions = rows.map((r) => decidePrecisionStack(toInputs(r)));
  const actuals = rows.map((r) => r.actual_direction as Outcome);

  it("has the full 224-row cohort", () => {
    expect(rows.length).toBe(224);
  });

  it("reproduces every per-row leg exactly", () => {
    const mismatches: string[] = [];
    rows.forEach((r, i) => {
      const d = decisions[i];
      const checks: [string, unknown, unknown][] = [
        ["activity_guard", d.balanced.dualAgree && d.balanced.activityGuardPassed, r.activity_guard_passed],
        ["balanced_core", d.balanced.core, r.balanced_core],
        ["balanced_fill", d.balanced.fill, r.balanced_fill],
        ["balanced_would_trade", d.balanced.wouldTrade, r.balanced_would_trade],
        ["balanced_direction", d.balanced.direction, r.balanced_direction],
        ["balanced_score", scoreLeg(d.balanced, actuals[i]), r.balanced_score],
        ["primary_would_trade", d.primary.wouldTrade, r.primary_would_trade],
        ["primary_direction", d.primary.direction, r.primary_direction],
        ["primary_score", scoreLeg(d.primary, actuals[i]), r.primary_score],
        ["rescue_would_trade", d.rescue.wouldTrade, r.rescue_would_trade],
        ["rescue_direction", d.rescue.direction, r.rescue_direction],
        ["rescue_score", scoreLeg(d.rescue, actuals[i]), r.rescue_score],
        ["combined_would_trade", d.combined.wouldTrade, r.combined_would_trade],
        ["combined_direction", d.combined.direction, r.combined_direction],
        ["combined_score", scoreLeg(d.combined, actuals[i]), r.combined_score],
      ];
      for (const [name, got, exp] of checks) {
        if (got !== exp) mismatches.push(`${r.target_ts} ${name}: got ${String(got)} expected ${String(exp)}`);
      }
    });
    expect(mismatches.slice(0, 20)).toEqual([]);
  });

  it("reproduces the frozen aggregate expectations", () => {
    expect(tally(decisions.map((d) => d.balanced), actuals)).toEqual(expected.balanced);
    expect(tally(decisions.map((d) => d.primary), actuals)).toEqual(expected.primary);
    expect(tally(decisions.map((d) => d.rescue), actuals)).toEqual(expected.rescue_incremental);
    const combined = tally(decisions.map((d) => d.combined), actuals);
    expect(combined).toEqual({
      trades: expected.combined.trades,
      wins: expected.combined.wins,
      losses: expected.combined.losses,
      pushes: expected.combined.pushes,
      net: expected.combined.net,
    });
  });

  it("reproduces combined drawdown and loss-streak limits", () => {
    let equity = 0, peak = 0, maxDd = 0, streak = 0, maxStreak = 0;
    decisions.forEach((d, i) => {
      if (!d.combined.wouldTrade) return;
      const s = scoreLeg(d.combined, actuals[i]);
      equity += s;
      peak = Math.max(peak, equity);
      maxDd = Math.max(maxDd, peak - equity);
      if (s < 0) { streak++; maxStreak = Math.max(maxStreak, streak); } else if (s > 0) streak = 0;
    });
    expect(maxDd).toBe((oracle as { expected: { combined: { max_drawdown: number } } }).expected.combined.max_drawdown);
    expect(maxStreak).toBe((oracle as { expected: { combined: { max_loss_streak: number } } }).expected.combined.max_loss_streak);
  });

  it("upper-wick percentile helper matches the oracle definition", () => {
    expect(upperWickPercentile(new Array(95).fill(0), 0.5)).toBeNull();
    const hist = Array.from({ length: 96 }, (_, i) => i / 96);
    expect(upperWickPercentile(hist, 0.5)).toBeCloseTo(49 / 96, 12);
  });
});
