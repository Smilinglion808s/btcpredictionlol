import { describe, expect, it } from "vitest";
import {
  applyBroadConflictVeto,
  applyBroadRedReliabilityVeto,
  appendBroadRedEntry,
  buildBroadRedHistory,
  broadRedShadowScores,
  isEligibleBroadRedSignal,
  selectComponent,
  summarizeBroadRed,
  vetoContribution,
  BROAD_CONFLICT_MAX_DISTANCE,
  BROAD_CONFLICT_MIN_DISTANCE,
  BROAD_CONFLICT_VETO_REASON,
  BROAD_RED_RELIABILITY_REASON,
  BROAD_RED_RELIABILITY_THRESHOLD,
  BROAD_RED_RELIABILITY_WINDOW,
  REGIME_INVERTER_PUBLICATION_ENABLED,
  REGIME_INVERTER_SHADOW_ONLY,
  V6_R3_MODEL_REVISION,
  type BroadRedCandidate,
} from "../r3";
import { V6_MODEL_REVISION } from "../regimeInverter";

const candidate = (over: Partial<BroadRedCandidate> = {}): BroadRedCandidate => ({
  target_candle_ts: "2026-08-06T00:00:00.000Z",
  selected_component: "BROAD",
  base_v6_prediction: "RED",
  base_v6_prediction_source: "V6_BASE",
  operational_status: "OK",
  canonical_ground_truth_valid: true,
  actual_direction: "RED",
  ...over,
});

describe("V6-r3 frozen constants", () => {
  it("uses exactly the frozen band and threshold", () => {
    expect(BROAD_CONFLICT_MIN_DISTANCE).toBe(0.025);
    expect(BROAD_CONFLICT_MAX_DISTANCE).toBe(0.075);
    expect(BROAD_RED_RELIABILITY_WINDOW).toBe(12);
    expect(BROAD_RED_RELIABILITY_THRESHOLD).toBe(-2.0);
    expect(V6_MODEL_REVISION).toBe(V6_R3_MODEL_REVISION);
    expect(REGIME_INVERTER_SHADOW_ONLY).toBe(true);
    expect(REGIME_INVERTER_PUBLICATION_ENABLED).toBe(false);
  });
});

describe("component selection", () => {
  it("gives an exact distance tie to BROAD", () => {
    expect(selectComponent(0.6, 0.4).component).toBe("BROAD");
  });
  it("selects ANCHOR only when it is farther from neutral", () => {
    expect(selectComponent(0.52, 0.9).component).toBe("ANCHOR");
    expect(selectComponent(0.9, 0.52).component).toBe("BROAD");
  });
  it("fails closed to NONE on non-finite inputs", () => {
    expect(selectComponent(Number.NaN, 0.6).component).toBe("NONE");
  });
});

describe("broad mild-anchor-conflict veto", () => {
  const red = (anchor: number) => applyBroadConflictVeto("RED", "V6_BASE", "BROAD", anchor);
  const green = (anchor: number) => applyBroadConflictVeto("GREEN", "V6_BASE", "BROAD", anchor);

  it("triggers at the inclusive lower bound for RED", () => {
    const d = red(0.525);
    expect(d.triggered).toBe(true);
    expect(d.prediction).toBe("ABSTAIN");
    expect(d.reason).toBe(BROAD_CONFLICT_VETO_REASON);
  });
  it("does not trigger just below the lower bound", () => {
    expect(red(0.5249).triggered).toBe(false);
  });
  it("triggers just below the exclusive upper bound", () => {
    expect(red(0.5749).triggered).toBe(true);
  });
  it("does not trigger at the exclusive upper bound", () => {
    expect(red(0.575).triggered).toBe(false);
  });
  it("mirrors the band for GREEN", () => {
    expect(green(0.475).triggered).toBe(true);
    expect(green(0.4751).triggered).toBe(false);
    expect(green(0.4251).triggered).toBe(true);
    expect(green(0.425).triggered).toBe(false);
  });
  it("never triggers when the anchor agrees", () => {
    expect(red(0.46).triggered).toBe(false);
    expect(green(0.54).triggered).toBe(false);
  });
  it("skips ANCHOR-selected predictions and pickups", () => {
    expect(applyBroadConflictVeto("RED", "V6_BASE", "ANCHOR", 0.525).triggered).toBe(false);
    expect(
      applyBroadConflictVeto("RED", "CONSENSUS_RED_PICKUP", "BROAD", 0.525).triggered,
    ).toBe(false);
  });
  it("fails closed on a non-finite anchor percentile", () => {
    const d = applyBroadConflictVeto("RED", "V6_BASE", "BROAD", Number.NaN);
    expect(d.triggered).toBe(false);
    expect(d.prediction).toBe("RED");
  });
  it("leaves ABSTAIN untouched and never creates a direction", () => {
    const d = applyBroadConflictVeto("ABSTAIN", "ABSTAIN", "BROAD", 0.525);
    expect(d.prediction).toBe("ABSTAIN");
    expect(d.triggered).toBe(false);
  });
});

describe("BROAD_RED shadow history membership", () => {
  it("accepts only original broad-selected base RED signals", () => {
    expect(isEligibleBroadRedSignal(candidate())).toBe(true);
    expect(isEligibleBroadRedSignal(candidate({ selected_component: "ANCHOR" }))).toBe(false);
    expect(isEligibleBroadRedSignal(candidate({ base_v6_prediction: "GREEN" }))).toBe(false);
    expect(isEligibleBroadRedSignal(candidate({ base_v6_prediction: "ABSTAIN" }))).toBe(false);
    expect(
      isEligibleBroadRedSignal(candidate({ base_v6_prediction_source: "CONSENSUS_RED_PICKUP" })),
    ).toBe(false);
    expect(isEligibleBroadRedSignal(candidate({ operational_status: "OP_FAIL" }))).toBe(false);
    expect(isEligibleBroadRedSignal(candidate({ actual_direction: "PUSH" }))).toBe(false);
    expect(isEligibleBroadRedSignal(candidate({ canonical_ground_truth_valid: false }))).toBe(false);
  });

  it("scores +0.8 for a correct RED and -1 for an incorrect one", () => {
    expect(broadRedShadowScores("RED").adjusted).toBe(0.8);
    expect(broadRedShadowScores("GREEN").adjusted).toBe(-1);
  });

  it("retains only the most recent 12 entries", () => {
    const rows = Array.from({ length: 20 }, (_, i) =>
      candidate({ target_candle_ts: `2026-08-06T00:${String(i).padStart(2, "0")}:00.000Z` }),
    );
    const history = buildBroadRedHistory(rows);
    expect(history).toHaveLength(12);
    expect(history[11]?.target_candle_ts).toBe("2026-08-06T00:19:00.000Z");
  });
});

/** Build a 12-entry window with the requested number of losses. */
function windowWith(losses: number) {
  const rows = Array.from({ length: 12 }, (_, i) =>
    candidate({
      target_candle_ts: `2026-08-06T01:${String(i).padStart(2, "0")}:00.000Z`,
      actual_direction: i < losses ? "GREEN" : "RED",
    }),
  );
  return summarizeBroadRed(buildBroadRedHistory(rows));
}

describe("BROAD_RED reliability governor", () => {
  it("never vetoes while warming", () => {
    const partial = summarizeBroadRed(buildBroadRedHistory([candidate()]));
    expect(partial.ready).toBe(false);
    expect(partial.active).toBe(false);
    expect(applyBroadRedReliabilityVeto("RED", "V6_BASE", "BROAD", partial).triggered).toBe(false);
  });

  it("activates at exactly -2.0 adjusted net", () => {
    // 7 wins / 5 losses -> 0.8*7 - 5 = 0.6 ; 6/6 -> -1.2 ; 5/7 -> -3.0
    const s = windowWith(6);
    expect(s.adjustedNet).toBeCloseTo(-1.2, 10);
    expect(s.active).toBe(false);

    const exact = summarizeBroadRed([
      ...buildBroadRedHistory(
        Array.from({ length: 12 }, (_, i) =>
          candidate({
            target_candle_ts: `2026-08-06T02:${String(i).padStart(2, "0")}:00.000Z`,
            actual_direction: i < 5 ? "RED" : "GREEN",
          }),
        ),
      ),
    ]);
    // 5 wins / 7 losses -> 0.8*5 - 7 = -3.0 <= -2.0
    expect(exact.adjustedNet).toBeCloseTo(-3, 10);
    expect(exact.ready).toBe(true);
    expect(exact.active).toBe(true);
  });

  it("vetoes eligible BROAD_RED only", () => {
    const s = windowWith(7);
    expect(s.active).toBe(true);
    const vetoed = applyBroadRedReliabilityVeto("RED", "V6_BASE", "BROAD", s);
    expect(vetoed.triggered).toBe(true);
    expect(vetoed.prediction).toBe("ABSTAIN");
    expect(vetoed.reason).toBe(BROAD_RED_RELIABILITY_REASON);

    expect(applyBroadRedReliabilityVeto("GREEN", "V6_BASE", "BROAD", s).triggered).toBe(false);
    expect(applyBroadRedReliabilityVeto("RED", "V6_BASE", "ANCHOR", s).triggered).toBe(false);
    expect(
      applyBroadRedReliabilityVeto("RED", "CONSENSUS_RED_PICKUP", "BROAD", s).triggered,
    ).toBe(false);
    expect(applyBroadRedReliabilityVeto("ABSTAIN", "ABSTAIN", "BROAD", s).prediction).toBe(
      "ABSTAIN",
    );
  });

  it("automatically reactivates the branch when the shadow net recovers", () => {
    let summary = windowWith(7);
    expect(summary.active).toBe(true);
    // Shadow grading continues while vetoed; wins push the net back above -2.0.
    let history = buildBroadRedHistory(
      Array.from({ length: 12 }, (_, i) =>
        candidate({
          target_candle_ts: `2026-08-06T03:${String(i).padStart(2, "0")}:00.000Z`,
          actual_direction: i < 7 ? "GREEN" : "RED",
        }),
      ),
    );
    for (let i = 0; i < 6; i += 1) {
      history = appendBroadRedEntry(history, {
        target_candle_ts: `2026-08-06T04:${String(i).padStart(2, "0")}:00.000Z`,
        broad_red_shadow_prediction: "RED",
        actual_direction: "RED",
        broad_red_shadow_raw_score: 1,
        broad_red_shadow_adjusted_score: 0.8,
      });
    }
    summary = summarizeBroadRed(history);
    expect(summary.count).toBe(12);
    expect(summary.adjustedNet).toBeGreaterThan(-2);
    expect(summary.active).toBe(false);
    expect(applyBroadRedReliabilityVeto("RED", "V6_BASE", "BROAD", summary).triggered).toBe(false);
  });
});

describe("veto counterfactual contribution", () => {
  it("credits +1 for an avoided loss and -0.8 adjusted for a sacrificed win", () => {
    expect(vetoContribution(true, "RED", "GREEN")).toMatchObject({ raw: 1, adjusted: 1 });
    expect(vetoContribution(true, "RED", "RED")).toMatchObject({ raw: -1, adjusted: -0.8 });
  });
  it("is zero when not triggered or on PUSH", () => {
    expect(vetoContribution(false, "RED", "GREEN").raw).toBe(0);
    expect(vetoContribution(true, "RED", "PUSH").raw).toBe(0);
    expect(vetoContribution(true, null, "GREEN").raw).toBe(0);
  });
});
