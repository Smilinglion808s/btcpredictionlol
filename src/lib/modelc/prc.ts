// Model C — Polarity Rolling Controller (PRC-36/4).
//
// Sits between Model C's raw ensemble decision and the reported controller
// decision. It never modifies training, features, weights, or the 0.52
// threshold. It only maps the raw direction (from ensemble_probability_green)
// through a rolling-edge polarity state to a controller_decision (YES/NO/SKIP).
//
// Stateless by design: the rolling window is derived on demand from
// `model_c_shadow.raw_counterfactual_result` for prior resolved rows of the
// same variant. Idempotency, timing-safety, and independence from
// A2 / TD1 / other models fall out of that: history is filtered by
// `resolved_at < target_boundary_ts`.

import type { SupabaseClient } from "@supabase/supabase-js";

export const PRC_MODEL_VERSION = "MODEL_C_PRC_36_4_ACTIVE_V1";
export const PRC_WINDOW_SIZE = 36;
export const PRC_NORMAL_THRESHOLD = 4;
export const PRC_INVERSE_THRESHOLD = -4;
export const PRC_PROBABILITY_THRESHOLD = 0.52;

export type RawDirection = "YES" | "NO";
export type PolarityState = "NORMAL" | "INVERSE" | "NEUTRAL" | "INSUFFICIENT";
export type ControllerDecision = "YES" | "NO" | "SKIP";

export interface PrcResult {
  raw_direction: RawDirection | null;
  rolling_window_size: number;
  rolling_raw_wins: number;
  rolling_raw_losses: number;
  rolling_raw_edge: number;
  polarity_state: PolarityState;
  controller_decision: ControllerDecision;
  controller_skip_reason: string | null;
  history_cutoff_ts: string;
  latest_resolution_ts_used: string | null;
  timing_guard_passed: boolean;
  controller_error: string | null;
  controller_model_version: string;
}

export function rawDirectionFromProbability(p: number | null | undefined): RawDirection | null {
  if (typeof p !== "number" || !Number.isFinite(p) || p < 0 || p > 1) return null;
  return p >= PRC_PROBABILITY_THRESHOLD ? "YES" : "NO";
}

function skipResult(
  reason: string,
  historyCutoffTs: string,
  rawDirection: RawDirection | null,
  extras?: Partial<PrcResult>,
): PrcResult {
  return {
    raw_direction: rawDirection,
    rolling_window_size: 0,
    rolling_raw_wins: 0,
    rolling_raw_losses: 0,
    rolling_raw_edge: 0,
    polarity_state: "INSUFFICIENT",
    controller_decision: "SKIP",
    controller_skip_reason: reason,
    history_cutoff_ts: historyCutoffTs,
    latest_resolution_ts_used: null,
    timing_guard_passed: true,
    controller_error: null,
    controller_model_version: PRC_MODEL_VERSION,
    ...extras,
  };
}

/**
 * Compute the PRC controller decision for one raw Model C prediction.
 * Fail-closed: any error path returns SKIP and never throws.
 */
export async function computePrcDecision(
  supabase: SupabaseClient,
  args: {
    variant: string; // "dual_horizon" | "global_only"
    ensemble_probability_green: number | null | undefined;
    target_boundary_ts: string;
  },
): Promise<PrcResult> {
  const historyCutoffTs = args.target_boundary_ts;
  const rawDirection = rawDirectionFromProbability(args.ensemble_probability_green);
  if (!rawDirection) {
    return skipResult("PRC_INVALID_RAW_PROBABILITY", historyCutoffTs, null);
  }

  try {
    const { data, error } = await supabase
      .from("model_c_shadow")
      .select("raw_counterfactual_result, resolved_at")
      .eq("variant", args.variant)
      .in("raw_counterfactual_result", ["WIN", "LOSS"])
      .not("resolved_at", "is", null)
      .lt("resolved_at", historyCutoffTs)
      .order("resolved_at", { ascending: false })
      .limit(PRC_WINDOW_SIZE);
    if (error) {
      return skipResult("PRC_TIMING_OR_LEAKAGE_GUARD", historyCutoffTs, rawDirection, {
        controller_error: `history_query_error:${error.message}`,
        timing_guard_passed: false,
      });
    }
    const rows = (data ?? []) as Array<{ raw_counterfactual_result: "WIN" | "LOSS"; resolved_at: string }>;
    const latestResolutionTsUsed = rows[0]?.resolved_at ?? null;

    if (rows.length < PRC_WINDOW_SIZE) {
      return {
        raw_direction: rawDirection,
        rolling_window_size: rows.length,
        rolling_raw_wins: rows.filter((r) => r.raw_counterfactual_result === "WIN").length,
        rolling_raw_losses: rows.filter((r) => r.raw_counterfactual_result === "LOSS").length,
        rolling_raw_edge:
          rows.filter((r) => r.raw_counterfactual_result === "WIN").length -
          rows.filter((r) => r.raw_counterfactual_result === "LOSS").length,
        polarity_state: "INSUFFICIENT",
        controller_decision: "SKIP",
        controller_skip_reason: "PRC_INSUFFICIENT_RESOLVED_HISTORY",
        history_cutoff_ts: historyCutoffTs,
        latest_resolution_ts_used: latestResolutionTsUsed,
        timing_guard_passed: true,
        controller_error: null,
        controller_model_version: PRC_MODEL_VERSION,
      };
    }

    const wins = rows.filter((r) => r.raw_counterfactual_result === "WIN").length;
    const losses = rows.length - wins;
    const edge = wins - losses;

    let polarity: PolarityState;
    let decision: ControllerDecision;
    let skipReason: string | null = null;
    if (edge >= PRC_NORMAL_THRESHOLD) {
      polarity = "NORMAL";
      decision = rawDirection; // preserve
    } else if (edge <= PRC_INVERSE_THRESHOLD) {
      polarity = "INVERSE";
      decision = rawDirection === "YES" ? "NO" : "YES"; // flip
    } else {
      polarity = "NEUTRAL";
      decision = "SKIP";
      skipReason = "PRC_NEUTRAL_EDGE";
    }

    return {
      raw_direction: rawDirection,
      rolling_window_size: rows.length,
      rolling_raw_wins: wins,
      rolling_raw_losses: losses,
      rolling_raw_edge: edge,
      polarity_state: polarity,
      controller_decision: decision,
      controller_skip_reason: skipReason,
      history_cutoff_ts: historyCutoffTs,
      latest_resolution_ts_used: latestResolutionTsUsed,
      timing_guard_passed: true,
      controller_error: null,
      controller_model_version: PRC_MODEL_VERSION,
    };
  } catch (e) {
    return skipResult("PRC_TIMING_OR_LEAKAGE_GUARD", historyCutoffTs, rawDirection, {
      controller_error: e instanceof Error ? e.message : String(e),
      timing_guard_passed: false,
    });
  }
}

/**
 * Compute the counterfactual raw result for a resolved Model C row.
 * WIN if raw_direction matches actual candle direction, LOSS otherwise.
 * Returns null for DOJI or missing inputs (row remains excluded from the
 * rolling window).
 */
export function rawCounterfactualResult(
  rawDirection: RawDirection | null | undefined,
  actualDirection: "GREEN" | "RED" | "DOJI" | null | undefined,
): "WIN" | "LOSS" | null {
  if (!rawDirection) return null;
  if (actualDirection !== "GREEN" && actualDirection !== "RED") return null;
  const matches =
    (rawDirection === "YES" && actualDirection === "GREEN") ||
    (rawDirection === "NO" && actualDirection === "RED");
  return matches ? "WIN" : "LOSS";
}
