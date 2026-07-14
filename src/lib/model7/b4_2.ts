// Model 7 Variant B4.2 — Daily Edge Guard (SHADOW ONLY).
// Inherits Variant B2 completely. Can only convert YES/NO -> SKIP.
// Never reverses direction. State is per America/Denver day.

import type { SupabaseClient } from "@supabase/supabase-js";

export const B4_2_POLICY_VERSION = "b4_2_v1";
export const EXTREME_NO_MAX_PROB = 0.15;

export type B4_2GuardReason =
  | "NONE"
  | "DAILY_EDGE_CIRCUIT"
  | "REPEATED_EXTREME_NO_FAILURE"
  | "BASE_SKIP"
  | "BASE_BLOCKED"
  | "STATE_UNAVAILABLE";

export interface B4_2Decision {
  decision: "YES" | "NO" | "SKIP";
  guard_fired: boolean;
  guard_reason: B4_2GuardReason;
  edge_score_before: number | null;
  cooldown_before: number | null;
  last_two_no_results: Array<"WIN" | "LOSS">;
  date_mt: string | null;
  policy_version: string;
}

/** Derive America/Denver calendar date (YYYY-MM-DD) from an ISO timestamp. */
export function deriveMountainDate(candleTsIso: string): string | null {
  try {
    const d = new Date(candleTsIso);
    if (Number.isNaN(d.getTime())) return null;
    // en-CA yields YYYY-MM-DD
    return new Intl.DateTimeFormat("en-CA", {
      timeZone: "America/Denver",
      year: "numeric", month: "2-digit", day: "2-digit",
    }).format(d);
  } catch { return null; }
}

/**
 * Compute B4.2's decision, layered on top of a resolved B2 base decision.
 * Reads day state; never mutates. State mutation happens at resolution time.
 */
export async function computeB4_2Decision(
  supabase: SupabaseClient,
  input: {
    b2_decision: "YES" | "NO" | "SKIP" | null;
    b2_base_decision?: "YES" | "NO" | "SKIP" | null;
    probability_green: number | null;
    candle_ts: string;
  },
): Promise<B4_2Decision> {
  const dateMt = deriveMountainDate(input.candle_ts);
  if (!dateMt) {
    return {
      decision: "SKIP", guard_fired: true, guard_reason: "STATE_UNAVAILABLE",
      edge_score_before: null, cooldown_before: null,
      last_two_no_results: [], date_mt: null,
      policy_version: B4_2_POLICY_VERSION,
    };
  }

  // Base passthrough: B2 SKIP / blocked -> B4.2 SKIP, do not mutate state.
  if (input.b2_decision === "SKIP" || input.b2_decision == null) {
    // Distinguish blocked (base_decision differed) vs pure skip.
    const reason: B4_2GuardReason =
      input.b2_base_decision && input.b2_base_decision !== "SKIP" ? "BASE_BLOCKED" : "BASE_SKIP";
    return {
      decision: "SKIP", guard_fired: true, guard_reason: reason,
      edge_score_before: null, cooldown_before: null,
      last_two_no_results: [], date_mt: dateMt,
      policy_version: B4_2_POLICY_VERSION,
    };
  }

  let edgeBefore = 0;
  let cooldownBefore = 0;
  let circuitActive = false;
  let awaitingProbe = false;
  try {
    const { data } = await supabase
      .from("model7_b4_2_state")
      .select("edge_score, cooldown_remaining, date_mt, circuit_active, awaiting_probe_resolution")
      .eq("symbol", "BTC-USDT").eq("timeframe", "15m")
      .eq("policy_version", B4_2_POLICY_VERSION).eq("date_mt", dateMt)
      .maybeSingle();
    if (data) {
      edgeBefore = Number(data.edge_score ?? 0);
      cooldownBefore = Number(data.cooldown_remaining ?? 0);
      circuitActive = Boolean((data as { circuit_active?: boolean }).circuit_active);
      awaitingProbe = Boolean((data as { awaiting_probe_resolution?: boolean }).awaiting_probe_resolution);
    }
  } catch {
    return {
      decision: "SKIP", guard_fired: true, guard_reason: "STATE_UNAVAILABLE",
      edge_score_before: null, cooldown_before: null,
      last_two_no_results: [], date_mt: dateMt,
      policy_version: B4_2_POLICY_VERSION,
    };
  }

  // Circuit active: SKIP unless cooldown drained AND no probe outstanding
  // AND B2 wants to trade — then let exactly one probe through.
  if (circuitActive) {
    if (cooldownBefore > 0 || awaitingProbe) {
      return {
        decision: "SKIP", guard_fired: true, guard_reason: "DAILY_EDGE_CIRCUIT",
        edge_score_before: edgeBefore, cooldown_before: cooldownBefore,
        last_two_no_results: [], date_mt: dateMt,
        policy_version: B4_2_POLICY_VERSION,
      };
    }
    // Cooldown drained: attempt to atomically arm the probe. If another
    // caller armed it first, the RPC returns armed=false and we SKIP.
    try {
      const { data: armed } = await supabase.rpc("arm_b4_2_probe", {
        p_date_mt: dateMt,
        p_prediction_id: "",
      } as never);
      const ok = Boolean((armed as { armed?: boolean } | null)?.armed);
      if (!ok) {
        return {
          decision: "SKIP", guard_fired: true, guard_reason: "DAILY_EDGE_CIRCUIT",
          edge_score_before: edgeBefore, cooldown_before: cooldownBefore,
          last_two_no_results: [], date_mt: dateMt,
          policy_version: B4_2_POLICY_VERSION,
        };
      }
    } catch {
      return {
        decision: "SKIP", guard_fired: true, guard_reason: "STATE_UNAVAILABLE",
        edge_score_before: edgeBefore, cooldown_before: cooldownBefore,
        last_two_no_results: [], date_mt: dateMt,
        policy_version: B4_2_POLICY_VERSION,
      };
    }
    // Probe armed — fall through and passthrough B2's YES/NO as the probe.
  }

  // Extreme-NO guard: B2=NO with p<=0.15 AND last two same-day NO both LOSS.
  let lastTwo: Array<"WIN" | "LOSS"> = [];
  if (input.b2_decision === "NO" && typeof input.probability_green === "number"
      && input.probability_green <= EXTREME_NO_MAX_PROB) {
    try {
      const { data } = await supabase
        .from("model7_b4_2_no_history")
        .select("result")
        .eq("symbol", "BTC-USDT").eq("timeframe", "15m")
        .eq("policy_version", B4_2_POLICY_VERSION).eq("date_mt", dateMt)
        .eq("b2_final_decision", "NO")
        .order("resolved_at", { ascending: false })
        .limit(2);
      lastTwo = (data ?? []).map((r: any) => r.result as "WIN" | "LOSS");
      if (lastTwo.length === 2 && lastTwo[0] === "LOSS" && lastTwo[1] === "LOSS") {
        return {
          decision: "SKIP", guard_fired: true, guard_reason: "REPEATED_EXTREME_NO_FAILURE",
          edge_score_before: edgeBefore, cooldown_before: cooldownBefore,
          last_two_no_results: lastTwo, date_mt: dateMt,
          policy_version: B4_2_POLICY_VERSION,
        };
      }
    } catch { /* fall through to passthrough */ }
  }

  return {
    decision: input.b2_decision,
    guard_fired: false, guard_reason: "NONE",
    edge_score_before: edgeBefore, cooldown_before: cooldownBefore,
    last_two_no_results: lastTwo, date_mt: dateMt,
    policy_version: B4_2_POLICY_VERSION,
  };
}

/**
 * Apply a resolved B2 counterfactual outcome to B4.2 daily state.
 * Idempotent by resolution_id. Executes the whole state mutation atomically
 * inside a Postgres function (advisory lock, cooldown decrement, edge_score
 * update with min(0) cap, circuit arm/re-arm at <= -15, NO-history append).
 */
export async function applyB4_2Resolution(
  supabase: SupabaseClient,
  args: {
    resolution_id: string;
    candle_ts: string;
    b2_final_decision: "YES" | "NO";
    b2_result: "WIN" | "LOSS";
    resolved_at?: string;
  },
): Promise<void> {
  const dateMt = deriveMountainDate(args.candle_ts);
  if (!dateMt) return;
  try {
    await supabase.rpc("apply_b4_2_resolution", {
      p_resolution_id: args.resolution_id,
      p_candle_ts: args.candle_ts,
      p_date_mt: dateMt,
      p_b2_final_decision: args.b2_final_decision,
      p_b2_result: args.b2_result,
      p_resolved_at: args.resolved_at ?? new Date().toISOString(),
    } as never);
  } catch { /* never block resolver */ }
}
