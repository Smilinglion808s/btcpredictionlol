// AAS96 orchestrator: called after each prediction insert. Reads the
// prediction row, produces GREEN/RED/SKIP, writes to model7_aas96_shadow.
// Fail-closed: any error → SKIP row with skip_reason set.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  extractFeatures, extractExpertInputs, featureSchemaHash,
} from "./featurize";
import { applyScaler } from "./preprocess";
import { predictProb } from "./logistic";
import { computeLayerB, type Dir } from "./layerB";
import { loadActiveAas96Fit } from "./fitStore";
import { AAS96_MIN_TRAINING_ROWS, AAS96_SELECTOR_LOOKBACK } from "./config";
import { inferActualDir } from "./train";

interface Context {
  prediction: Record<string, unknown>;
}

function armorOverride(
  layerADir: Dir,
  legacy: "YES" | "NO" | "NO CLEAR EDGE" | null,
  trend: string | null | undefined,
): { fired: boolean; reason: string; final: Dir } {
  const legacyDir: Dir | null = legacy === "YES" ? "GREEN" : legacy === "NO" ? "RED" : null;
  const t = trend ? String(trend).toLowerCase() : null;
  const trendDir: Dir | null = t === "up" ? "GREEN" : t === "down" ? "RED" : null;
  if (legacyDir != null && trendDir != null && legacyDir !== trendDir) {
    return { fired: true, reason: "legacy_engine_opposes_ema_trend", final: trendDir };
  }
  return { fired: false, reason: "", final: layerADir };
}

async function writeRow(
  sb: SupabaseClient,
  row: Record<string, unknown>,
): Promise<void> {
  try {
    await sb.from("model7_aas96_shadow").upsert(row as never, { onConflict: "prediction_id" });
  } catch { /* never block */ }
}

export async function runAas96Shadow(sb: SupabaseClient, ctx: Context): Promise<void> {
  const p = ctx.prediction;

  // ---------- Temporal-safety audit (always compute, always persist) ----------
  const targetTs = p.candle_ts ? new Date(String(p.candle_ts)) : null;
  const inputTs = p.input_candle_ts ? new Date(String(p.input_candle_ts)) : null;
  const targetOk = targetTs != null && !isNaN(targetTs.getTime());
  const inputOk = inputTs != null && !isNaN(inputTs.getTime());
  const deltaSec = targetOk && inputOk
    ? (targetTs.getTime() - inputTs.getTime()) / 1000
    : null;
  // 15-minute continuity gate: input must be exactly one interval before target (±5s).
  const continuityGatePassed = deltaSec != null && Math.abs(deltaSec - 900) <= 5;
  const partialMinutesElapsed = p.current_partial_minutes_elapsed == null
    ? null : Number(p.current_partial_minutes_elapsed);
  // Snapshot belongs to prior candle when: input candle started, snapshot was
  // taken within the input candle's 15-min window, and that window ends at or
  // before the target candle start.
  let snapshotBelongsToPrior: boolean | null = null;
  if (targetOk && inputOk && partialMinutesElapsed != null) {
    const snapshotCapturedMs = inputTs.getTime() + partialMinutesElapsed * 60_000;
    snapshotBelongsToPrior =
      snapshotCapturedMs <= targetTs.getTime() &&
      inputTs.getTime() + 15 * 60_000 <= targetTs.getTime() + 5_000; // ≤5s slack
  }

  const base: Record<string, unknown> = {
    prediction_id: p.id,
    candle_ts: p.candle_ts,
    variant: "AAS96",
    status: "pending",
    input_feature_timestamp: p.input_candle_ts ?? p.created_at ?? null,
    input_candle_age_seconds: p.input_candle_age_seconds ?? null,
    target_candle_ts: p.candle_ts ?? null,
    input_candle_ts: p.input_candle_ts ?? null,
    continuity_delta_seconds: deltaSec,
    continuity_gate_passed: continuityGatePassed,
    snapshot_minutes_elapsed: partialMinutesElapsed,
    snapshot_belongs_to_prior_candle: snapshotBelongsToPrior,
  };
  try {
    // Fetch state + fit in parallel.
    const [{ data: state }, artifact] = await Promise.all([
      sb.from("model7_aas96_state").select("usable_training_rows, resolved_directional_count").eq("id", 1).maybeSingle(),
      loadActiveAas96Fit(sb),
    ]);
    const stateRow = state as { usable_training_rows?: number; resolved_directional_count?: number } | null;
    // Prefer the new usable-rows counter; fall back to the legacy counter
    // during transition so warmup progress does not visually regress.
    const count = Number(stateRow?.usable_training_rows ?? stateRow?.resolved_directional_count ?? 0);
    base.training_row_count = count;

    // Warmup — no artifact yet.
    if (!artifact) {
      await writeRow(sb, {
        ...base,
        eligibility_passed: false,
        final_prediction: "SKIP",
        skip_reason: count < AAS96_MIN_TRAINING_ROWS ? "WARMUP_INSUFFICIENT_ROWS" : "NO_ACTIVE_FIT",
      });
      return;
    }
    base.fit_id = artifact.fitId;
    base.feature_schema_hash = artifact.featureSchemaHash;

    // Eligibility gate (mirrors spec conditions we can enforce today).
    const eligibilityFailures: string[] = [];
    if (!continuityGatePassed) eligibilityFailures.push("timestamp_discontinuity");
    if (snapshotBelongsToPrior === false) eligibilityFailures.push("snapshot_from_target_candle");
    if (p.input_features_fresh === false) eligibilityFailures.push("input_features_stale");
    if (p.advance_check_passed === false) eligibilityFailures.push("advance_check_failed");
    if (p.partial_snapshot_present === false) eligibilityFailures.push("no_partial_snapshot");
    const partialMin = Number(p.current_partial_minutes_elapsed ?? 0);
    if (partialMin < 14) eligibilityFailures.push("partial_minutes_lt_14");
    const age = Number(p.input_candle_age_seconds ?? 0);
    if (age > 930) eligibilityFailures.push("input_candle_age_gt_930");
    if (eligibilityFailures.length) {
      await writeRow(sb, {
        ...base,
        eligibility_passed: false,
        final_prediction: "SKIP",
        skip_reason: eligibilityFailures.join(","),
      });
      return;
    }
    base.eligibility_passed = true;

    // Layer A.
    const features = extractFeatures(p);
    const { values } = applyScaler(artifact.scaler, features);
    if (values.length !== artifact.fitL003.coef.length) {
      // Feature schema drift → SKIP; a retrain will realign.
      await writeRow(sb, {
        ...base,
        final_prediction: "SKIP",
        skip_reason: `feature_dim_mismatch:${values.length}vs${artifact.fitL003.coef.length}`,
      });
      return;
    }
    const pL003 = predictProb(artifact.fitL003, values);
    const pL010 = predictProb(artifact.fitL010, values);
    const pMean = 0.5 * (pL003 + pL010);
    const layerABase: Dir = pMean >= 0.5 ? "GREEN" : "RED";
    const armor = armorOverride(
      layerABase,
      p.prediction as "YES" | "NO" | "NO CLEAR EDGE" | null,
      p.trend as string | null | undefined,
    );

    // Layer B.
    const inputs = extractExpertInputs(p);
    const fallback: Dir = (Number(p.bullish_score ?? 0) >= Number(p.bearish_score ?? 0)) ? "GREEN" : "RED";
    const layerB = computeLayerB(artifact.expertHistory, inputs, fallback);

    // Layer C selector: last 96 counterfactual net.
    const { data: lastRows } = await sb
      .from("model7_aas96_shadow")
      .select("layer_a_final_direction, layer_b_final_direction, actual_direction, result")
      .in("result", ["win", "loss"])
      .order("candle_ts", { ascending: false })
      .limit(AAS96_SELECTOR_LOOKBACK);
    let netA = 0, netB = 0;
    for (const r of lastRows ?? []) {
      const actual = r.actual_direction as string | null;
      if (actual !== "GREEN" && actual !== "RED") continue;
      const aDir = r.layer_a_final_direction as string | null;
      const bDir = r.layer_b_final_direction as string | null;
      if (aDir === actual) netA += 1; else if (aDir === "GREEN" || aDir === "RED") netA -= 1;
      if (bDir === actual) netB += 1; else if (bDir === "GREEN" || bDir === "RED") netB -= 1;
    }
    const selected: "A" | "B" = netA >= netB ? "A" : "B";
    const finalDir: Dir = selected === "A" ? armor.final : layerB.final;

    await writeRow(sb, {
      ...base,
      layer_a_prob_l003: pL003,
      layer_a_prob_l010: pL010,
      layer_a_prob_mean: pMean,
      layer_a_base_direction: layerABase,
      armor_override_fired: armor.fired,
      armor_override_reason: armor.reason || null,
      layer_a_final_direction: armor.final,
      layer_b_h32_direction: layerB.horizons[32],
      layer_b_h64_direction: layerB.horizons[64],
      layer_b_h96_direction: layerB.horizons[96],
      layer_b_h192_direction: layerB.horizons[192],
      layer_b_final_direction: layerB.final,
      layer_a_last96_net: netA,
      layer_b_last96_net: netB,
      selected_layer: selected,
      final_prediction: finalDir,
    });
  } catch (e) {
    await writeRow(sb, {
      ...base,
      final_prediction: "SKIP",
      skip_reason: "AAS96_ERROR",
      shadow_error: e instanceof Error ? e.message : String(e),
    });
    try {
      await sb.from("api_runs").insert({
        run_type: "aas96-error",
        response_payload: { error: e instanceof Error ? e.message : String(e), prediction_id: p.id },
        success: false,
        error_message: e instanceof Error ? e.message : String(e),
      });
    } catch { /* ignore */ }
  }
}

/** Resolve an AAS96 row once actual_direction is known. Also updates expert
 *  history + counterfactual counters + triggers retrain when due. */
export async function resolveAas96Row(
  sb: SupabaseClient,
  predictionId: string,
  actualDirection: "GREEN" | "RED" | "DOJI" | null,
): Promise<void> {
  try {
    const { data: row } = await sb
      .from("model7_aas96_shadow")
      .select("id, final_prediction, layer_a_final_direction, layer_b_final_direction, status")
      .eq("prediction_id", predictionId)
      .maybeSingle();
    if (!row) return;

    // DOJI/unknown → mark push, don't touch state/history.
    if (actualDirection !== "GREEN" && actualDirection !== "RED") {
      await sb.from("model7_aas96_shadow").update({
        actual_direction: actualDirection ?? null,
        result: "push",
        status: "resolved",
        resolved_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      } as never).eq("id", row.id as string);
      return;
    }

    const final = row.final_prediction as string | null;
    let result: "win" | "loss" | "skip" = "skip";
    if (final === "GREEN" || final === "RED") {
      result = final === actualDirection ? "win" : "loss";
    }
    await sb.from("model7_aas96_shadow").update({
      actual_direction: actualDirection,
      result,
      status: "resolved",
      resolved_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    } as never).eq("id", row.id as string);

    // Update Layer B expert history (needs the original inputs — fetch prediction).
    try {
      const { data: p } = await sb.from("predictions").select("*").eq("id", predictionId).maybeSingle();
      if (p) {
        const { loadActiveAas96Fit, updateActiveExpertHistory } = await import("./fitStore");
        const { extractExpertInputs } = await import("./featurize");
        const { updateExpertHistory } = await import("./layerB");
        const artifact = await loadActiveAas96Fit(sb);
        if (artifact) {
          const inputs = extractExpertInputs(p as Record<string, unknown>);
          const fallback: Dir = (Number((p as Record<string, unknown>).bullish_score ?? 0)
            >= Number((p as Record<string, unknown>).bearish_score ?? 0)) ? "GREEN" : "RED";
          updateExpertHistory(artifact.expertHistory, inputs, actualDirection, fallback);
          await updateActiveExpertHistory(sb, artifact.expertHistory);
        }
      }
    } catch { /* never block */ }

    // Increment resolved directional counter.
    try {
      const { data: state } = await sb.from("model7_aas96_state").select("resolved_directional_count").eq("id", 1).maybeSingle();
      const newCount = Number((state as { resolved_directional_count?: number } | null)?.resolved_directional_count ?? 0) + 1;
      await sb.from("model7_aas96_state").update({
        resolved_directional_count: newCount,
        updated_at: new Date().toISOString(),
      } as never).eq("id", 1);
    } catch { /* ignore */ }

    // Opportunistic retrain (cadence-gated inside).
    try {
      const { maybeTrainAas96 } = await import("./train");
      await maybeTrainAas96(sb);
    } catch { /* never block */ }
  } catch (e) {
    try {
      await sb.from("api_runs").insert({
        run_type: "aas96-resolve-error",
        response_payload: { error: e instanceof Error ? e.message : String(e), prediction_id: predictionId },
        success: false,
        error_message: e instanceof Error ? e.message : String(e),
      });
    } catch { /* ignore */ }
  }
}
