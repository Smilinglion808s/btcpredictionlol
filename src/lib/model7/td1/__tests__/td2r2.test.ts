import { describe, expect, it } from "vitest";
import {
  TD2_RECOVERY_THRESHOLD,
  TD2_RECOVERY_REASON,
  attributeTd2R2,
  evaluateTd2R2,
} from "../td2r2";
import fixture from "./td2_r2_fixture_175.json";

type Row = {
  candle_ts: string;
  a2_original_decision: "YES" | "NO" | null;
  actual_direction: "GREEN" | "RED" | "PUSH" | null;
  external_final_decision: "YES" | "NO" | "SKIP" | null;
  would_trade: boolean;
  result: "WIN" | "LOSS" | "PUSH" | null;
  compressed_risk_veto_fired: boolean;
  prev_policy_decision: "YES" | "NO" | "SKIP" | null;
  prev_policy_would_trade: boolean | null;
  opposing_drift_4: number | null;
};

const base = (over: Partial<Parameters<typeof evaluateTd2R2>[0]> = {}) =>
  evaluateTd2R2({
    r1Decision: "SKIP",
    r1WouldTrade: false,
    r1SkipReason: "ABSTAIN_TD1_COMPRESSED_RISK",
    compressedRiskVetoFired: true,
    previousPolicy: { decision: "YES", wouldTrade: true },
    opposingDrift4: 0.5,
    timingValid: true,
    ...over,
  });

describe("TD2-r2 opposing drift recovery — frozen rule", () => {
  it("recovers at exactly 0.50 (inclusive, unrounded)", () => {
    const r = base({ opposingDrift4: 0.5 });
    expect(TD2_RECOVERY_THRESHOLD).toBe(0.5);
    expect(r.fired).toBe(true);
    expect(r.decision).toBe("YES");
    expect(r.wouldTrade).toBe(true);
    expect(r.reason).toBe(TD2_RECOVERY_REASON);
    expect(r.featureValue).toBe(0.5);
  });

  it("does not recover at 0.499999", () => {
    const r = base({ opposingDrift4: 0.499999 });
    expect(r.fired).toBe(false);
    expect(r.evaluable).toBe(true);
    expect(r.reason).toBe("FEATURE_BELOW_THRESHOLD");
    expect(r.decision).toBe("SKIP");
  });

  it("leaves a non-compressed row unchanged", () => {
    const r = base({ compressedRiskVetoFired: false, r1Decision: "NO", r1WouldTrade: true, r1SkipReason: null });
    expect(r.fired).toBe(false);
    expect(r.reason).toBe("COMPRESSED_RISK_NOT_FIRED");
    expect(r.decision).toBe("NO");
    expect(r.wouldTrade).toBe(true);
  });

  it("leaves a compressed row below the 0.45 gate unchanged (gate never fired)", () => {
    const r = base({ compressedRiskVetoFired: false, r1Decision: "YES", r1WouldTrade: true, r1SkipReason: null });
    expect(r.decision).toBe("YES");
    expect(r.fired).toBe(false);
  });

  it("cannot recover a previous-policy containment abstention", () => {
    const r = base({ previousPolicy: { decision: "SKIP", wouldTrade: false } });
    expect(r.fired).toBe(false);
    expect(r.reason).toBe("PREVIOUS_POLICY_ABSTAINS");
  });

  it("cannot recover a previous-policy global-threshold abstention", () => {
    const r = base({ previousPolicy: { decision: "SKIP", wouldTrade: false }, opposingDrift4: 0.9 });
    expect(r.fired).toBe(false);
    expect(r.reason).toBe("PREVIOUS_POLICY_ABSTAINS");
  });

  it.each([null, undefined, NaN, Infinity, -Infinity])("cannot recover on invalid feature %s", (v) => {
    const r = base({ opposingDrift4: v as number | null });
    expect(r.fired).toBe(false);
    expect(r.reason).toBe("FEATURE_MISSING_OR_INVALID");
  });

  it("cannot recover when prediction-time timing validation failed", () => {
    const r = base({ timingValid: false });
    expect(r.fired).toBe(false);
    expect(r.reason).toBe("FEATURE_MISSING_OR_INVALID");
  });

  it("restores a qualifying YES exactly and a qualifying NO exactly", () => {
    expect(base({ previousPolicy: { decision: "YES", wouldTrade: true } }).decision).toBe("YES");
    expect(base({ previousPolicy: { decision: "NO", wouldTrade: true } }).decision).toBe("NO");
  });

  it("never reverses direction", () => {
    for (const dir of ["YES", "NO"] as const) {
      const r = base({ previousPolicy: { decision: dir, wouldTrade: true }, opposingDrift4: 0.99 });
      expect(r.decision).toBe(dir);
      expect(r.direction).toBe(dir);
    }
  });

  it("preserves the frozen r1 counterfactual on every path", () => {
    const r = base();
    expect(r.r1Decision).toBe("SKIP");
    expect(r.r1WouldTrade).toBe(false);
    expect(r.r1SkipReason).toBe("ABSTAIN_TD1_COMPRESSED_RISK");
  });
});

describe("TD2-r2 attribution", () => {
  const att = (active: "YES" | "NO" | "SKIP", actual: "GREEN" | "RED" | "PUSH" | null) =>
    attributeTd2R2({ activeDecision: active, r1Decision: "SKIP", recoveryFired: true, actualDirection: actual });

  it("recovered win = +1 incremental", () => {
    const a = att("YES", "GREEN");
    expect(a.incrementalValue).toBe(1);
    expect(a.valueClass).toBe("RECOVERED_WIN");
    expect(a.r1Score).toBe(0);
  });
  it("recovered loss = -1 incremental", () => {
    const a = att("YES", "RED");
    expect(a.incrementalValue).toBe(-1);
    expect(a.valueClass).toBe("RECOVERED_LOSS");
  });
  it("recovered push = 0", () => {
    const a = att("YES", "PUSH");
    expect(a.incrementalValue).toBe(0);
    expect(a.valueClass).toBe("PUSH");
  });
  it("unresolved stays unscored", () => {
    const a = att("YES", null);
    expect(a.activeScore).toBeNull();
    expect(a.incrementalValue).toBeNull();
    expect(a.valueClass).toBe("UNRESOLVED");
  });
  it("no recovery = NO_CHANGE with zero incremental value", () => {
    const a = attributeTd2R2({ activeDecision: "SKIP", r1Decision: "SKIP", recoveryFired: false, actualDirection: "GREEN" });
    expect(a.valueClass).toBe("NO_CHANGE");
    expect(a.incrementalValue).toBe(0);
  });
  it("is idempotent (pure function of the same inputs)", () => {
    const a = att("NO", "RED");
    const b = att("NO", "RED");
    expect(a).toEqual(b);
  });
});

describe("frozen 175-row TD2 checkpoint fixture", () => {
  const rows = fixture as unknown as Row[];
  const dayKey = (iso: string) =>
    new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Boise", year: "numeric", month: "2-digit", day: "2-digit",
    }).format(new Date(iso));

  const replay = rows.map((row) => {
    const r2 = evaluateTd2R2({
      r1Decision: row.external_final_decision ?? "SKIP",
      r1WouldTrade: row.would_trade === true,
      r1SkipReason: row.would_trade ? null : "ABSTAIN_TD1_COMPRESSED_RISK",
      compressedRiskVetoFired: row.compressed_risk_veto_fired === true,
      previousPolicy: {
        decision: row.prev_policy_decision ?? "SKIP",
        wouldTrade: row.prev_policy_would_trade === true,
      },
      opposingDrift4: row.opposing_drift_4,
    });
    const a = attributeTd2R2({
      activeDecision: r2.decision,
      r1Decision: r2.r1Decision,
      recoveryFired: r2.fired,
      actualDirection: row.actual_direction,
    });
    return { row, r2, a };
  });

  const count = (fn: (x: typeof replay[number]) => boolean) => replay.filter(fn).length;

  it("reconciles TD2-r1", () => {
    const trades = replay.filter((x) => x.r2.r1WouldTrade);
    const w = trades.filter((x) => x.a.r1Result === "WIN").length;
    const l = trades.filter((x) => x.a.r1Result === "LOSS").length;
    expect(trades.length).toBe(48);
    expect(w).toBe(23);
    expect(l).toBe(25);
    expect(w - l).toBe(-2);
    expect(Math.round((trades.length / rows.length) * 10000) / 100).toBe(27.43);
  });

  it("reconciles TD2-r2", () => {
    const trades = replay.filter((x) => x.r2.wouldTrade);
    const w = trades.filter((x) => x.a.activeResult === "WIN").length;
    const l = trades.filter((x) => x.a.activeResult === "LOSS").length;
    expect(trades.length).toBe(60);
    expect(w).toBe(32);
    expect(l).toBe(28);
    expect(w - l).toBe(4);
    expect(Math.round((trades.length / rows.length) * 10000) / 100).toBe(34.29);

    // Maximum drawdown of the r2 equity curve (chronological).
    let equity = 0, peak = 0, maxDd = 0;
    for (const x of [...trades].sort((a, b) => (a.row.candle_ts < b.row.candle_ts ? -1 : 1))) {
      equity += x.a.activeScore ?? 0;
      peak = Math.max(peak, equity);
      maxDd = Math.max(maxDd, peak - equity);
    }
    expect(maxDd).toBe(7);

    // Worst Boise-calendar-day net result.
    const byDay = new Map<string, number>();
    for (const x of trades) {
      const k = dayKey(x.row.candle_ts);
      byDay.set(k, (byDay.get(k) ?? 0) + (x.a.activeScore ?? 0));
    }
    expect(Math.min(...byDay.values())).toBe(-5);
  });

  it("reconciles recovery", () => {
    const rec = replay.filter((x) => x.r2.fired);
    expect(rec.length).toBe(12);
    expect(rec.filter((x) => x.a.recoveryResult === "WIN").length).toBe(9);
    expect(rec.filter((x) => x.a.recoveryResult === "LOSS").length).toBe(3);
    expect(rec.reduce((s, x) => s + (x.a.incrementalValue ?? 0), 0)).toBe(6);
  });

  it("historical r1 decisions are never altered outside recovery", () => {
    expect(count((x) => x.r2.decision !== (x.row.external_final_decision ?? "SKIP"))).toBe(12);
  });
});
