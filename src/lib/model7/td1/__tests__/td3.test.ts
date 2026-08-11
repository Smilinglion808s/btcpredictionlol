import { describe, expect, it } from "vitest";
import {
  TD3_ACTIVATION_TS,
  TD3_POLICY_VERSION,
  TD3_TOXIC_CONFIDENCE_MAX,
  TD3_TOXIC_OPPOSING_DRIFT4_MAX,
  TD3_TOXIC_SAME_DIRECTION_RUN_MAX,
  TD3_VARIANT,
  evaluateTd3,
  scoreTd3Decision,
  td3PredictionColumns,
  td3VetoValue,
  type Td3Decision,
} from "../td3";

const toxic = {
  currentDirectionalConfidence: 0.7,
  opposingDrift4: -0.2,
  sameDirectionRunLength: 3,
};

const base = (over: Partial<Parameters<typeof evaluateTd3>[0]> = {}) =>
  evaluateTd3({
    preVetoDecision: "YES",
    preVetoWouldTrade: true,
    preVetoSkipReason: null,
    ...toxic,
    ...over,
  });

describe("TD3 toxic opposing drift veto", () => {
  it("freezes identity + thresholds", () => {
    expect(TD3_VARIANT).toBe("A2_Combined_TD3_ToxicDrift");
    expect(TD3_POLICY_VERSION).toBe("td3-toxic-opposing-drift-v1");
    expect(TD3_TOXIC_CONFIDENCE_MAX).toBe(0.88);
    expect(TD3_TOXIC_OPPOSING_DRIFT4_MAX).toBe(-0.05);
    expect(TD3_TOXIC_SAME_DIRECTION_RUN_MAX).toBe(6);
    expect(Number.isFinite(Date.parse(TD3_ACTIVATION_TS))).toBe(true);
  });

  it("vetoes an eligible YES when all three conditions hold", () => {
    const r = base();
    expect(r.vetoFired).toBe(true);
    expect(r.finalDecision).toBe("SKIP");
    expect(r.wouldTrade).toBe(false);
    expect(r.skipReason).toBe("TD3_TOXIC_OPPOSING_DRIFT_VETO");
  });

  it("vetoes an eligible NO when all three conditions hold", () => {
    const r = base({ preVetoDecision: "NO" });
    expect(r.finalDecision).toBe("SKIP");
  });

  it("matches TD1 exactly when the veto does not fire", () => {
    const r = base({ opposingDrift4: 0.2 });
    expect(r.vetoFired).toBe(false);
    expect(r.finalDecision).toBe("YES");
    expect(r.wouldTrade).toBe(true);
    expect(r.skipReason).toBe(null);
  });

  it("boundary: confidence exactly 0.88 qualifies, above does not", () => {
    expect(base({ currentDirectionalConfidence: 0.88 }).vetoFired).toBe(true);
    expect(base({ currentDirectionalConfidence: 0.8800001 }).vetoFired).toBe(false);
  });

  it("boundary: drift exactly -0.05 qualifies, above does not", () => {
    expect(base({ opposingDrift4: -0.05 }).vetoFired).toBe(true);
    expect(base({ opposingDrift4: -0.049 }).vetoFired).toBe(false);
  });

  it("boundary: run length exactly 6 qualifies, 7 does not", () => {
    expect(base({ sameDirectionRunLength: 6 }).vetoFired).toBe(true);
    expect(base({ sameDirectionRunLength: 7 }).vetoFired).toBe(false);
  });

  it("requires all three conditions", () => {
    expect(base({ currentDirectionalConfidence: 0.95 }).vetoFired).toBe(false);
    expect(base({ opposingDrift4: 0.01 }).vetoFired).toBe(false);
    expect(base({ sameDirectionRunLength: 9 }).vetoFired).toBe(false);
  });

  it("leaves an existing TD1 SKIP as SKIP and never trades", () => {
    const r = base({ preVetoDecision: "SKIP", preVetoWouldTrade: false, preVetoSkipReason: "NO_CLEAR_EDGE" });
    expect(r.vetoFired).toBe(false);
    expect(r.finalDecision).toBe("SKIP");
    expect(r.wouldTrade).toBe(false);
    expect(r.skipReason).toBe("NO_CLEAR_EDGE");
  });

  it("never reverses direction", () => {
    for (const side of ["YES", "NO"] as Td3Decision[]) {
      for (const drift of [-0.5, -0.05, 0, 0.4]) {
        const r = base({ preVetoDecision: side, opposingDrift4: drift });
        expect(["SKIP", side]).toContain(r.finalDecision);
      }
    }
  });

  it("missing or non-finite features are not evaluable and preserve TD1", () => {
    for (const over of [
      { currentDirectionalConfidence: null },
      { opposingDrift4: undefined },
      { sameDirectionRunLength: Number.NaN },
      { currentDirectionalConfidence: Number.POSITIVE_INFINITY },
    ]) {
      const r = base(over as never);
      expect(r.evaluable).toBe(false);
      expect(r.vetoFired).toBe(false);
      expect(r.reason).toBe("TD3_TOXIC_DRIFT_NOT_EVALUABLE");
      expect(r.finalDecision).toBe("YES");
      expect(r.wouldTrade).toBe(true);
    }
  });

  it("grades against the same canonical truth as TD1", () => {
    expect(scoreTd3Decision("YES", "GREEN")).toEqual({ result: "WIN", score: 1 });
    expect(scoreTd3Decision("YES", "RED")).toEqual({ result: "LOSS", score: -1 });
    expect(scoreTd3Decision("SKIP", "RED")).toEqual({ result: "PUSH", score: 0 });
    expect(scoreTd3Decision("NO", null)).toEqual({ result: "PUSH", score: 0 });
  });

  it("veto value: avoided loss +1, sacrificed win -1, otherwise 0", () => {
    expect(td3VetoValue(true, "LOSS")).toBe(1);
    expect(td3VetoValue(true, "WIN")).toBe(-1);
    expect(td3VetoValue(true, "PUSH")).toBe(0);
    expect(td3VetoValue(false, "LOSS")).toBe(0);
  });

  it("persists the full immutable prediction-time audit payload", () => {
    const cols = td3PredictionColumns({
      evaluation: base(),
      runMode: "LIVE",
      preVetoDecision: "YES",
      preVetoWouldTrade: true,
      preVetoSkipReason: null,
      sourceTd1RowId: "row-1",
      sourceTd1PolicyVersion: "td1-rc-v1",
      sourceTd1FitId: "fit-1",
      sourceTd1ArtifactSha256: "sha",
      featureCutoffTs: "2026-08-10T00:00:00.000Z",
      latestSourceCandleTs: "2026-08-10T00:00:00.000Z",
      timingStatus: "ON_TIME",
      leakageCheckPassed: true,
    });
    for (const k of [
      "td3_policy_version", "td3_activation_ts", "td3_run_mode",
      "td3_source_td1_row_id", "td3_source_td1_policy_version", "td3_source_td1_fit_id",
      "td3_source_td1_artifact_sha256", "td3_pre_veto_decision", "td3_pre_veto_would_trade",
      "td3_pre_veto_skip_reason", "td3_toxic_drift_evaluable",
      "td3_current_directional_confidence", "td3_current_directional_confidence_threshold",
      "td3_confidence_condition", "td3_opposing_drift_4", "td3_opposing_drift_4_threshold",
      "td3_opposing_drift_condition", "td3_same_direction_run_length",
      "td3_same_direction_run_length_threshold", "td3_run_length_condition",
      "td3_toxic_drift_condition", "td3_toxic_drift_veto_fired", "td3_toxic_drift_reason",
      "td3_final_decision", "td3_would_trade", "td3_skip_reason",
      "td3_feature_cutoff_ts", "td3_latest_source_candle_ts", "td3_timing_status",
      "td3_leakage_check_passed",
    ]) {
      expect(Object.prototype.hasOwnProperty.call(cols, k)).toBe(true);
    }
    expect(cols.td3_run_mode).toBe("LIVE");
    expect(cols.td3_pre_veto_decision).toBe("YES");
    // Backfill rows are distinguishable from live rows.
    const backfill = td3PredictionColumns({
      evaluation: base(),
      runMode: "BACKFILL",
      preVetoDecision: "YES",
      preVetoWouldTrade: true,
      preVetoSkipReason: null,
      sourceTd1RowId: null,
      sourceTd1PolicyVersion: null,
      sourceTd1FitId: null,
      sourceTd1ArtifactSha256: null,
      featureCutoffTs: null,
      latestSourceCandleTs: null,
      timingStatus: null,
      leakageCheckPassed: null,
    });
    expect(backfill.td3_run_mode).toBe("BACKFILL");
  });
});
