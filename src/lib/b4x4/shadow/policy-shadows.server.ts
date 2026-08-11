// B4x4 prospective policy shadows — persistence (server-only).
//
// Reporting only. Shadow rows are written after the active B4x4 row is
// persisted, can never emit a webhook, and never feed back into the active
// model's history, grid, brake or coverage.

import type { SupabaseClient } from "@supabase/supabase-js";
import { B4X4_IMPLEMENTATION_REVISION, b4x4LocalDate } from "../config";
import { scoreAgainst, type ActualDirection, type B4x4Decision, type Direction, type HistoryEntry } from "../engine";
import {
  SHADOW_A_VARIANT,
  SHADOW_B_VARIANT,
  evaluateShadowA,
  evaluateShadowB,
  type ShadowDecision,
} from "../shadows";

type DbRow = Record<string, unknown>;

/** Counterfactual Boise daily net for one shadow variant, before this target. */
async function shadowDailyNet(
  supabase: SupabaseClient,
  variant: string,
  localDate: string,
  candleTs: string,
): Promise<number> {
  const { data } = await supabase
    .from("b4x4_policy_shadows")
    .select("result_score")
    .eq("shadow_variant", variant)
    .eq("local_date", localDate)
    .eq("would_trade", true)
    .not("resolved_at", "is", null)
    .lt("target_candle_ts", candleTs);
  let net = 0;
  for (const r of (data ?? []) as unknown as DbRow[]) net += Number(r.result_score ?? 0);
  return net;
}

function shadowRow(
  predictionId: string,
  targetCandleTs: string,
  runMode: string,
  rawDirection: Direction | null,
  localDate: string,
  s: ShadowDecision,
): DbRow {
  return {
    b4x4_prediction_id: predictionId,
    target_candle_ts: targetCandleTs,
    shadow_variant: s.shadowVariant,
    prospective_test_id: s.prospectiveTestId,
    config_hash: s.configHash,
    run_mode: runMode,
    implementation_revision: B4X4_IMPLEMENTATION_REVISION,
    raw_direction: rawDirection,
    base_route: s.baseRoute,
    gate_inputs_json: s.gateInputs,
    gate_fired: s.gateFired,
    local_date: localDate,
    daily_net_before: s.dailyNetBefore,
    brake_active: s.brakeActive,
    brake_veto_fired: s.brakeVetoFired,
    final_prediction: s.finalPrediction,
    would_trade: s.wouldTrade,
    decision_reason: s.decisionReason,
    webhook_eligible: false,
  };
}

/** Persist both reporting-only shadows for one B4x4 row. Never throws upward. */
export async function persistB4x4PolicyShadows(
  supabase: SupabaseClient,
  saved: DbRow,
  decision: B4x4Decision,
  history: HistoryEntry[],
): Promise<void> {
  const predictionId = String(saved.id);
  const targetCandleTs = new Date(String(saved.target_candle_ts)).toISOString();
  const runMode = String(saved.run_mode ?? "LIVE");
  const rawDirection = (saved.raw_direction as Direction | null) ?? null;
  const localDate = String(saved.local_date ?? b4x4LocalDate(targetCandleTs));

  const [netA, netB] = await Promise.all([
    shadowDailyNet(supabase, SHADOW_A_VARIANT, localDate, targetCandleTs),
    shadowDailyNet(supabase, SHADOW_B_VARIANT, localDate, targetCandleTs),
  ]);

  const rows = [
    shadowRow(predictionId, targetCandleTs, runMode, rawDirection, localDate,
      evaluateShadowA(decision, history, netA)),
    shadowRow(predictionId, targetCandleTs, runMode, rawDirection, localDate,
      evaluateShadowB(decision, netB)),
  ];

  await supabase
    .from("b4x4_policy_shadows")
    .upsert(rows as never, {
      onConflict: "b4x4_prediction_id,shadow_variant",
      ignoreDuplicates: true,
    });
}

/** Idempotent resolution of both shadow rows for a target candle. */
export async function resolveB4x4PolicyShadows(
  supabase: SupabaseClient,
  targetCandleTs: string,
  actualDirection: ActualDirection,
): Promise<void> {
  const { data } = await supabase
    .from("b4x4_policy_shadows")
    .select("id, final_prediction, would_trade, resolution_attempt_count, resolved_at")
    .eq("target_candle_ts", targetCandleTs);
  const nowIso = new Date().toISOString();
  for (const r of (data ?? []) as unknown as DbRow[]) {
    if (r.resolved_at) continue;
    const scored = scoreAgainst((r.final_prediction as Direction | null) ?? null, actualDirection);
    await supabase
      .from("b4x4_policy_shadows")
      .update({
        actual_direction: actualDirection,
        result: r.would_trade === true ? (scored.result ?? "PUSH") : "PUSH",
        result_score: r.would_trade === true ? scored.score : 0,
        resolved_at: nowIso,
        last_resolution_attempt_at: nowIso,
        resolution_attempt_count: Number(r.resolution_attempt_count ?? 0) + 1,
        last_resolution_error: null,
      } as never)
      .eq("id", r.id as string)
      .is("resolved_at", null);
  }
}
