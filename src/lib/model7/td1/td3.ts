// TD3 — Toxic Opposing Drift Veto (policy td3-toxic-opposing-drift-v1).
//
// TD3 is an exact clone of the currently active TD1-RC decision path plus one
// final veto layer. It never runs inside TD1 and never mutates TD1 rows. The
// only behavioral delta is TD3_TOXIC_OPPOSING_DRIFT_VETO, which can only turn a
// directional TD1 trade into SKIP. It can never flip direction and never turns
// a TD1 SKIP into a trade.

export const TD3_VARIANT = "A2_Combined_TD3_ToxicDrift";
export const TD3_POLICY_VERSION = "td3-toxic-opposing-drift-v1";
/** Actual deployment timestamp — live TD3 forward statistics begin here. */
export const TD3_ACTIVATION_TS = "2026-08-11T00:20:00.000Z";

export const TD3_TOXIC_CONFIDENCE_MAX = 0.88;
export const TD3_TOXIC_OPPOSING_DRIFT4_MAX = -0.05;
export const TD3_TOXIC_SAME_DIRECTION_RUN_MAX = 6;

export const TD3_VETO_REASON = "TD3_TOXIC_OPPOSING_DRIFT_VETO";
export const TD3_NOT_EVALUABLE_REASON = "TD3_TOXIC_DRIFT_NOT_EVALUABLE";

export type Td3Decision = "YES" | "NO" | "SKIP";
export type Td3RunMode = "LIVE" | "BACKFILL";

export interface Td3Input {
  preVetoDecision: Td3Decision | null;
  preVetoWouldTrade: boolean;
  preVetoSkipReason: string | null;
  currentDirectionalConfidence: number | null | undefined;
  opposingDrift4: number | null | undefined;
  sameDirectionRunLength: number | null | undefined;
}

export interface Td3Evaluation {
  evaluable: boolean;
  confidence: number | null;
  opposingDrift4: number | null;
  sameDirectionRunLength: number | null;
  confidenceCondition: boolean;
  opposingDriftCondition: boolean;
  runLengthCondition: boolean;
  toxicDriftCondition: boolean;
  vetoFired: boolean;
  reason: string | null;
  finalDecision: Td3Decision | null;
  wouldTrade: boolean;
  skipReason: string | null;
}

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : null;
};

export function evaluateTd3(input: Td3Input): Td3Evaluation {
  const directional = input.preVetoWouldTrade === true &&
    (input.preVetoDecision === "YES" || input.preVetoDecision === "NO");

  const conf = num(input.currentDirectionalConfidence);
  const drift = num(input.opposingDrift4);
  const run = num(input.sameDirectionRunLength);

  const passthrough = {
    confidence: conf,
    opposingDrift4: drift,
    sameDirectionRunLength: run,
    finalDecision: input.preVetoDecision,
    wouldTrade: input.preVetoWouldTrade,
    skipReason: input.preVetoSkipReason,
  };

  if (!directional) {
    return {
      ...passthrough,
      evaluable: false,
      confidenceCondition: false,
      opposingDriftCondition: false,
      runLengthCondition: false,
      toxicDriftCondition: false,
      vetoFired: false,
      reason: "TD3_NOT_DIRECTIONAL",
    };
  }

  if (conf === null || drift === null || run === null) {
    return {
      ...passthrough,
      evaluable: false,
      confidenceCondition: false,
      opposingDriftCondition: false,
      runLengthCondition: false,
      toxicDriftCondition: false,
      vetoFired: false,
      reason: TD3_NOT_EVALUABLE_REASON,
    };
  }

  const confidenceCondition = conf <= TD3_TOXIC_CONFIDENCE_MAX;
  const opposingDriftCondition = drift <= TD3_TOXIC_OPPOSING_DRIFT4_MAX;
  const runLengthCondition = run <= TD3_TOXIC_SAME_DIRECTION_RUN_MAX;
  const toxic = confidenceCondition && opposingDriftCondition && runLengthCondition;

  return {
    ...passthrough,
    evaluable: true,
    confidenceCondition,
    opposingDriftCondition,
    runLengthCondition,
    toxicDriftCondition: toxic,
    vetoFired: toxic,
    reason: toxic ? TD3_VETO_REASON : "TD3_NO_VETO",
    finalDecision: toxic ? "SKIP" : input.preVetoDecision,
    wouldTrade: toxic ? false : input.preVetoWouldTrade,
    skipReason: toxic ? TD3_VETO_REASON : input.preVetoSkipReason,
  };
}

/** Grade a directional decision against the canonical actual direction. */
export function scoreTd3Decision(
  decision: Td3Decision | null,
  actualDirection: "GREEN" | "RED" | null,
): { result: "WIN" | "LOSS" | "PUSH"; score: number } {
  if (!actualDirection || decision !== "YES" && decision !== "NO") {
    return { result: "PUSH", score: 0 };
  }
  const win = (decision === "YES" && actualDirection === "GREEN") ||
    (decision === "NO" && actualDirection === "RED");
  return win ? { result: "WIN", score: 1 } : { result: "LOSS", score: -1 };
}

/**
 * Veto value: +1 when TD3 avoided an underlying TD1 loss, -1 when it sacrificed
 * an underlying TD1 win, 0 otherwise (no veto / push / unresolved).
 */
export function td3VetoValue(
  vetoFired: boolean,
  underlyingResult: "WIN" | "LOSS" | "PUSH" | null,
): number {
  if (!vetoFired) return 0;
  if (underlyingResult === "LOSS") return 1;
  if (underlyingResult === "WIN") return -1;
  return 0;
}

/** Build the immutable prediction-time td3_* column payload. */
export function td3PredictionColumns(args: {
  evaluation: Td3Evaluation;
  runMode: Td3RunMode;
  preVetoDecision: Td3Decision | null;
  preVetoWouldTrade: boolean;
  preVetoSkipReason: string | null;
  sourceTd1RowId: string | null;
  sourceTd1PolicyVersion: string | null;
  sourceTd1FitId: string | null;
  sourceTd1ArtifactSha256: string | null;
  featureCutoffTs: string | null;
  latestSourceCandleTs: string | null;
  timingStatus: string | null;
  leakageCheckPassed: boolean | null;
}): Record<string, unknown> {
  const e = args.evaluation;
  return {
    td3_policy_version: TD3_POLICY_VERSION,
    td3_activation_ts: TD3_ACTIVATION_TS,
    td3_run_mode: args.runMode,
    td3_source_td1_row_id: args.sourceTd1RowId,
    td3_source_td1_policy_version: args.sourceTd1PolicyVersion,
    td3_source_td1_fit_id: args.sourceTd1FitId,
    td3_source_td1_artifact_sha256: args.sourceTd1ArtifactSha256,
    td3_pre_veto_decision: args.preVetoDecision,
    td3_pre_veto_would_trade: args.preVetoWouldTrade,
    td3_pre_veto_skip_reason: args.preVetoSkipReason,
    td3_toxic_drift_evaluable: e.evaluable,
    td3_current_directional_confidence: e.confidence,
    td3_current_directional_confidence_threshold: TD3_TOXIC_CONFIDENCE_MAX,
    td3_confidence_condition: e.confidenceCondition,
    td3_opposing_drift_4: e.opposingDrift4,
    td3_opposing_drift_4_threshold: TD3_TOXIC_OPPOSING_DRIFT4_MAX,
    td3_opposing_drift_condition: e.opposingDriftCondition,
    td3_same_direction_run_length: e.sameDirectionRunLength,
    td3_same_direction_run_length_threshold: TD3_TOXIC_SAME_DIRECTION_RUN_MAX,
    td3_run_length_condition: e.runLengthCondition,
    td3_toxic_drift_condition: e.toxicDriftCondition,
    td3_toxic_drift_veto_fired: e.vetoFired,
    td3_toxic_drift_reason: e.reason,
    td3_final_decision: e.finalDecision,
    td3_would_trade: e.wouldTrade,
    td3_skip_reason: e.skipReason,
    td3_feature_cutoff_ts: args.featureCutoffTs,
    td3_latest_source_candle_ts: args.latestSourceCandleTs,
    td3_timing_status: args.timingStatus,
    td3_leakage_check_passed: args.leakageCheckPassed,
  };
}
