// V6-r7 rolling opportunity history.
//
// The r7 selector needs the last R7_HISTORY_WINDOW resolved, VALID opportunities
// strictly before the current target. History is rebuilt deterministically from
// persisted v6_predictions rows, so a cold start reproduces the same window.
//
// Excluded from history forever: OP_FAIL rows, unresolved rows, PUSH rows and
// rows whose 4x4 state is not evaluable.

import type { SupabaseClient } from "@supabase/supabase-js";
import { V6_MODEL_VERSION } from "./config";
import {
  computeStateCandidate,
  resolveState,
  R7_HISTORY_WINDOW,
  type Candidate,
  type ExpertKey,
  type R7HistoryRow,
} from "./r7";

/** Extra rows loaded so the oldest in-window E4 candidates are warm. */
const R7_WARM_MULTIPLIER = 2;

function asCandidate(v: unknown): Candidate {
  return v === "GREEN" || v === "RED" ? v : "NONE";
}

export interface R7HistoryState {
  history: R7HistoryRow[];
  /** Rows scanned (including the warm prefix) while rebuilding. */
  scanned: number;
  ready: boolean;
  error: string | null;
}

/**
 * Rebuild the r7 window for `targetTs`. E4 candidates are replayed walk-forward
 * so every historical row carries the candidate it would have had live.
 */
export async function loadR7History(
  sb: SupabaseClient,
  targetTs: Date,
): Promise<R7HistoryState> {
  const limit = R7_HISTORY_WINDOW * R7_WARM_MULTIPLIER;
  const { data, error } = await sb
    .from("v6_predictions")
    .select(
      "target_candle_ts, operational_status, canonical_actual_direction, broad_percentile, anchor_percentile, r6_final_prediction, final_prediction, base_v6_prediction, legacy_r4_shadow_prediction",
    )
    .eq("model_version", V6_MODEL_VERSION)
    .lt("target_candle_ts", targetTs.toISOString())
    .not("resolution_timestamp", "is", null)
    .order("target_candle_ts", { ascending: false })
    .limit(limit);

  if (error) {
    return { history: [], scanned: 0, ready: false, error: `r7_history_query_failed:${error.message}` };
  }

  const rows = ((data ?? []) as Array<Record<string, unknown>>)
    .slice()
    .reverse()
    .filter((r) => String(r.operational_status) === "OK")
    .filter((r) => r.canonical_actual_direction === "GREEN" || r.canonical_actual_direction === "RED");

  const history: R7HistoryRow[] = [];
  for (const r of rows) {
    const { stateId } = resolveState(r.broad_percentile, r.anchor_percentile);
    if (!stateId) continue;

    // Walk-forward: E4 for this row is derived only from rows before it.
    const window = history.slice(-R7_HISTORY_WINDOW);
    const e4 = computeStateCandidate(window, stateId).candidate;

    const candidates: Record<ExpertKey, Candidate> = {
      E1_R6: asCandidate(r.r6_final_prediction ?? r.final_prediction),
      E2_FROZEN_CORE: asCandidate(r.base_v6_prediction),
      E3_R4: asCandidate(r.legacy_r4_shadow_prediction),
      E4_STATE_MAP: e4,
    };

    history.push({
      targetTs: new Date(String(r.target_candle_ts)).toISOString(),
      stateId,
      actual: r.canonical_actual_direction as "GREEN" | "RED",
      candidates,
    });
  }

  return {
    history: history.slice(-R7_HISTORY_WINDOW),
    scanned: rows.length,
    ready: true,
    error: null,
  };
}
