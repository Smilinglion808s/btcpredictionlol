// V6-r7 — Adaptive Opportunity Selector (SHADOW ONLY).
//
// r7 is layered strictly ABOVE the existing V6 stack. It never reads, changes
// or re-grades the frozen V6 core, r5, r6, the r5.1 brake or the r4 shadow.
// It selects among four independent experts using RAW scoring only.
//
// There is deliberately NO time-of-day logic, NO session filter, NO daily cap,
// NO emergency brake and NO cooldown in this module.

import type { Direction } from "./inference";

export const V6_R7_MODEL_REVISION = "V6-r7-adaptive-opportunity-selector";
export const V6_R7_VERSION = "r7-adaptive-opportunity-selector-v1";
export const V6_R7_ACTIVATED_AT = "2026-08-14T18:00:00.000Z";

/** r7 ships shadow-first. Live publication authority stays with r6. */
export const R7_SHADOW_ENABLED = true;
export const R7_PUBLICATION_ENABLED = false;

/** Frozen r7 constants. Never tuned at runtime, never re-tuned after replay. */
export const R7_HISTORY_WINDOW = 192;
export const R7_MIN_STATE_SAMPLES = 8;
export const R7_MIN_EXPERT_STATE_SAMPLES = 8;
export const R7_MIN_WIN_RATE = 0.6;
export const R7_HISTORY_VERSION = "r7-history-v1";

export const R7_SOURCE = "V6_R7_ADAPTIVE_OPPORTUNITY_SELECTOR";

export type ExpertKey = "E1_R6" | "E2_FROZEN_CORE" | "E3_R4" | "E4_STATE_MAP";

/** Deterministic reporting priority — used ONLY to break an exact tie. */
export const R7_EXPERT_PRIORITY: ExpertKey[] = [
  "E4_STATE_MAP",
  "E2_FROZEN_CORE",
  "E3_R4",
  "E1_R6",
];

export const R7_REASON = {
  E1: "R7_E1_R6_SELECTED",
  E2: "R7_E2_FROZEN_CORE_SELECTED",
  E3: "R7_E3_R4_SELECTED",
  E4: "R7_E4_STATE_MAP_SELECTED",
  NONE: "R7_NO_QUALIFIED_OPPORTUNITY",
  TIE: "R7_EXPERT_EDGE_TIE",
  STATE: "R7_STATE_UNAVAILABLE",
} as const;

export const R7_SELECTED_REASON: Record<ExpertKey, string> = {
  E1_R6: R7_REASON.E1,
  E2_FROZEN_CORE: R7_REASON.E2,
  E3_R4: R7_REASON.E3,
  E4_STATE_MAP: R7_REASON.E4,
};

export type Candidate = "GREEN" | "RED" | "NONE";
export type R7Action = "KEEP_R6" | "REJECT_R6" | "ADD_OPPORTUNITY" | "REROUTE_DIRECTION" | "NONE";

/** Bin a percentile into the fixed 4-wide grid. 1.00 belongs to bin 3. */
export function percentileBin(value: unknown): number | null {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return null;
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n < 0 || n > 1) return null;
  if (n < 0.25) return 0;
  if (n < 0.5) return 1;
  if (n < 0.75) return 2;
  return 3;
}

export function stateIdOf(broadBin: number | null, anchorBin: number | null): string | null {
  if (broadBin === null || anchorBin === null) return null;
  return `B${broadBin}_A${anchorBin}`;
}

export function resolveState(broadPercentile: unknown, anchorPercentile: unknown) {
  const broadBin = percentileBin(broadPercentile);
  const anchorBin = percentileBin(anchorPercentile);
  const stateId = stateIdOf(broadBin, anchorBin);
  return { broadBin, anchorBin, stateId, evaluable: stateId !== null };
}

/** One resolved, valid prior opportunity. PUSH / OP_FAIL rows never appear. */
export interface R7HistoryRow {
  targetTs: string;
  stateId: string;
  actual: "GREEN" | "RED";
  candidates: Record<ExpertKey, Candidate>;
}

export interface StateStats {
  sampleCount: number;
  greenCount: number;
  redCount: number;
  greenWinRate: number | null;
  redWinRate: number | null;
  candidate: Candidate;
}

/** E4 — 4x4 state map candidate built from prior outcomes in the same state. */
export function computeStateCandidate(history: R7HistoryRow[], stateId: string | null): StateStats {
  if (!stateId) {
    return { sampleCount: 0, greenCount: 0, redCount: 0, greenWinRate: null, redWinRate: null, candidate: "NONE" };
  }
  let greenCount = 0;
  let redCount = 0;
  for (const row of history) {
    if (row.stateId !== stateId) continue;
    if (row.actual === "GREEN") greenCount += 1;
    else if (row.actual === "RED") redCount += 1;
  }
  const sampleCount = greenCount + redCount;
  if (sampleCount < R7_MIN_STATE_SAMPLES) {
    return {
      sampleCount,
      greenCount,
      redCount,
      greenWinRate: sampleCount > 0 ? greenCount / sampleCount : null,
      redWinRate: sampleCount > 0 ? redCount / sampleCount : null,
      candidate: "NONE",
    };
  }
  const greenWinRate = greenCount / sampleCount;
  const redWinRate = redCount / sampleCount;
  const candidate: Candidate =
    greenWinRate >= R7_MIN_WIN_RATE ? "GREEN" : redWinRate >= R7_MIN_WIN_RATE ? "RED" : "NONE";
  return { sampleCount, greenCount, redCount, greenWinRate, redWinRate, candidate };
}

export interface ExpertStateStats {
  candidate: Candidate;
  samples: number;
  wins: number;
  losses: number;
  rawNet: number;
  winRate: number | null;
  rawEdgeRate: number | null;
  qualified: boolean;
}

/** Historical performance of one expert inside the current 4x4 state. */
export function expertStateStats(
  expert: ExpertKey,
  candidate: Candidate,
  history: R7HistoryRow[],
  stateId: string | null,
): ExpertStateStats {
  let wins = 0;
  let losses = 0;
  if (stateId) {
    for (const row of history) {
      if (row.stateId !== stateId) continue;
      const c = row.candidates[expert];
      if (c !== "GREEN" && c !== "RED") continue;
      if (c === row.actual) wins += 1;
      else losses += 1;
    }
  }
  const samples = wins + losses;
  const rawNet = wins - losses;
  const winRate = samples > 0 ? wins / samples : null;
  const rawEdgeRate = samples > 0 ? rawNet / samples : null;
  const directional = candidate === "GREEN" || candidate === "RED";
  const qualified =
    directional &&
    samples >= R7_MIN_EXPERT_STATE_SAMPLES &&
    winRate !== null &&
    winRate >= R7_MIN_WIN_RATE &&
    rawNet > 0;
  return { candidate, samples, wins, losses, rawNet, winRate, rawEdgeRate, qualified };
}

export interface R7Selection {
  prediction: Direction;
  selectedExpert: ExpertKey | null;
  reason: string;
  bestGreenExpert: ExpertKey | null;
  bestGreenEdgeRate: number | null;
  bestGreenSamples: number | null;
  bestRedExpert: ExpertKey | null;
  bestRedEdgeRate: number | null;
  bestRedSamples: number | null;
}

function bestOf(
  entries: Array<[ExpertKey, ExpertStateStats]>,
): [ExpertKey, ExpertStateStats] | null {
  let best: [ExpertKey, ExpertStateStats] | null = null;
  for (const entry of entries) {
    if (!best) { best = entry; continue; }
    const a = entry[1];
    const b = best[1];
    const ae = a.rawEdgeRate ?? -Infinity;
    const be = b.rawEdgeRate ?? -Infinity;
    if (ae > be) { best = entry; continue; }
    if (ae < be) continue;
    if (a.samples > b.samples) { best = entry; continue; }
    if (a.samples < b.samples) continue;
    // Exact tie only: deterministic reporting priority.
    if (R7_EXPERT_PRIORITY.indexOf(entry[0]) < R7_EXPERT_PRIORITY.indexOf(best[0])) best = entry;
  }
  return best;
}

/** Select the publishing expert from the qualified pool (raw edge only). */
export function selectR7(
  stats: Record<ExpertKey, ExpertStateStats>,
  stateEvaluable: boolean,
): R7Selection {
  const empty: R7Selection = {
    prediction: "ABSTAIN",
    selectedExpert: null,
    reason: stateEvaluable ? R7_REASON.NONE : R7_REASON.STATE,
    bestGreenExpert: null,
    bestGreenEdgeRate: null,
    bestGreenSamples: null,
    bestRedExpert: null,
    bestRedEdgeRate: null,
    bestRedSamples: null,
  };
  if (!stateEvaluable) return empty;

  const entries = Object.entries(stats) as Array<[ExpertKey, ExpertStateStats]>;
  const green = entries.filter(([, s]) => s.qualified && s.candidate === "GREEN");
  const red = entries.filter(([, s]) => s.qualified && s.candidate === "RED");

  const bestGreen = bestOf(green);
  const bestRed = bestOf(red);

  const partial: R7Selection = {
    ...empty,
    bestGreenExpert: bestGreen?.[0] ?? null,
    bestGreenEdgeRate: bestGreen?.[1].rawEdgeRate ?? null,
    bestGreenSamples: bestGreen?.[1].samples ?? null,
    bestRedExpert: bestRed?.[0] ?? null,
    bestRedEdgeRate: bestRed?.[1].rawEdgeRate ?? null,
    bestRedSamples: bestRed?.[1].samples ?? null,
  };

  if (!bestGreen && !bestRed) return partial;
  if (bestGreen && !bestRed) {
    return { ...partial, prediction: "GREEN", selectedExpert: bestGreen[0], reason: R7_SELECTED_REASON[bestGreen[0]] };
  }
  if (bestRed && !bestGreen) {
    return { ...partial, prediction: "RED", selectedExpert: bestRed[0], reason: R7_SELECTED_REASON[bestRed[0]] };
  }
  const ge = bestGreen![1].rawEdgeRate ?? -Infinity;
  const re = bestRed![1].rawEdgeRate ?? -Infinity;
  if (ge === re) return { ...partial, reason: R7_REASON.TIE };
  const winner = ge > re ? bestGreen! : bestRed!;
  return {
    ...partial,
    prediction: ge > re ? "GREEN" : "RED",
    selectedExpert: winner[0],
    reason: R7_SELECTED_REASON[winner[0]],
  };
}

function directional(v: unknown): v is "GREEN" | "RED" {
  return v === "GREEN" || v === "RED";
}

/** What r7 did to the live r6 decision. */
export function classifyAction(r6: unknown, r7: unknown): R7Action {
  const a = directional(r6);
  const b = directional(r7);
  if (a && b) return r6 === r7 ? "KEEP_R6" : "REROUTE_DIRECTION";
  if (a && !b) return "REJECT_R6";
  if (!a && b) return "ADD_OPPORTUNITY";
  return "NONE";
}

function raw(prediction: unknown, actual: "GREEN" | "RED" | "PUSH" | null): number {
  if (!actual || actual === "PUSH" || !directional(prediction)) return 0;
  return prediction === actual ? 1 : -1;
}

/** RAW contribution of r7 versus r6 for this target. */
export function rawContributionVsR6(
  action: R7Action,
  r6Prediction: unknown,
  r7Prediction: unknown,
  actual: "GREEN" | "RED" | "PUSH" | null,
): number {
  if (!actual || actual === "PUSH") return 0;
  switch (action) {
    case "KEEP_R6":
      return 0;
    case "REJECT_R6":
      return -raw(r6Prediction, actual);
    case "ADD_OPPORTUNITY":
      return raw(r7Prediction, actual);
    case "REROUTE_DIRECTION":
      return raw(r7Prediction, actual) - raw(r6Prediction, actual);
    default:
      return 0;
  }
}

/** WIN / LOSS / PUSH / ABSTAIN grading for any r7 candidate or output. */
export function gradeR7(
  prediction: unknown,
  actual: "GREEN" | "RED" | "PUSH" | null,
): { result: string | null; raw: number } {
  if (!actual) return { result: null, raw: 0 };
  if (!directional(prediction)) return { result: "ABSTAIN", raw: 0 };
  if (actual === "PUSH") return { result: "PUSH", raw: 0 };
  return prediction === actual ? { result: "WIN", raw: 1 } : { result: "LOSS", raw: -1 };
}

export interface R7Evaluation {
  version: string;
  shadowEnabled: boolean;
  publicationEnabled: boolean;
  stateEvaluable: boolean;
  broadBin: number | null;
  anchorBin: number | null;
  stateId: string | null;
  historyWindowSize: number;
  priorValidOpportunityCount: number;
  state: StateStats;
  candidates: Record<ExpertKey, Candidate>;
  stats: Record<ExpertKey, ExpertStateStats>;
  selection: R7Selection;
  action: R7Action;
}

/**
 * Full prediction-time r7 evaluation. `history` MUST contain only resolved,
 * valid opportunities strictly before the current target.
 */
export function evaluateR7(args: {
  broadPercentile: unknown;
  anchorPercentile: unknown;
  r6Prediction: unknown;
  frozenCorePrediction: unknown;
  r4ShadowPrediction: unknown;
  history: R7HistoryRow[];
}): R7Evaluation {
  const { broadBin, anchorBin, stateId, evaluable } = resolveState(
    args.broadPercentile,
    args.anchorPercentile,
  );
  const history = args.history.slice(-R7_HISTORY_WINDOW);

  const asCandidate = (v: unknown): Candidate => (directional(v) ? v : "NONE");
  const state = computeStateCandidate(history, evaluable ? stateId : null);

  const candidates: Record<ExpertKey, Candidate> = {
    E1_R6: evaluable ? asCandidate(args.r6Prediction) : "NONE",
    E2_FROZEN_CORE: evaluable ? asCandidate(args.frozenCorePrediction) : "NONE",
    E3_R4: evaluable ? asCandidate(args.r4ShadowPrediction) : "NONE",
    E4_STATE_MAP: evaluable ? state.candidate : "NONE",
  };

  const stats = {
    E1_R6: expertStateStats("E1_R6", candidates.E1_R6, history, stateId),
    E2_FROZEN_CORE: expertStateStats("E2_FROZEN_CORE", candidates.E2_FROZEN_CORE, history, stateId),
    E3_R4: expertStateStats("E3_R4", candidates.E3_R4, history, stateId),
    E4_STATE_MAP: expertStateStats("E4_STATE_MAP", candidates.E4_STATE_MAP, history, stateId),
  } as Record<ExpertKey, ExpertStateStats>;

  const selection = selectR7(stats, evaluable);
  const action = classifyAction(args.r6Prediction, selection.prediction);

  return {
    version: V6_R7_VERSION,
    shadowEnabled: R7_SHADOW_ENABLED,
    publicationEnabled: R7_PUBLICATION_ENABLED,
    stateEvaluable: evaluable,
    broadBin,
    anchorBin,
    stateId,
    historyWindowSize: R7_HISTORY_WINDOW,
    priorValidOpportunityCount: history.length,
    state,
    candidates,
    stats,
    selection,
    action,
  };
}
