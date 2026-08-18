// B4x4-ES1 Binance Dual-Venue Adaptive R1 — live wiring (server only).
//
// Runs AFTER the legacy ES1 chain and the Balanced 3-of-4 chain, both of which
// are retained as scored counterfactuals only. Exact-target Binance boundary
// features are loaded and gated BEFORE this decision; a load or persistence
// failure produces an auditable primary abstention and never publishes a
// legacy prediction.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  marketReadinessFrom,
  type ActualDirection,
  type Direction,
  type MarketReadiness,
} from "./balanced";
import {
  ACTIVATION_ID,
  DISPLAY_NAME,
  FEATURE_SCHEMA,
  IMPLEMENTATION_REVISION,
  MODEL_VERSION,
  POLICY_VERSION,
  RESOLVER_VERSION,
  VARIANT,
  decideDualAdaptive,
  dualAdaptiveConfigHash,
  dualAdaptiveInputHash,
  evaluateDualAdaptiveShadows,
  scoreDualAdaptive,
  type DualAdaptiveDecision,
} from "./dualAdaptive";
import { TF_MS } from "./config";
import { getBoundaryFeature } from "./binanceOb/store.server";

type DbRow = Record<string, unknown>;

/** Publication switch. Rows are always recorded either way. */
export const DUAL_ADAPTIVE_PUBLICATION_ENABLED = true;

export const DUAL_ADAPTIVE_APPROVAL_NOTE =
  "Approved frozen policy: Binance Spot + USD-M Perp final-vs-mean60 adaptive orientation, dual-venue agreement." as const;

function nextCleanBoundaryTs(targetTs: string): string {
  return new Date(Math.floor(new Date(targetTs).getTime() / TF_MS) * TF_MS + TF_MS).toISOString();
}

/**
 * `b4x4_es1_activation` holds the single authoritative activation record for
 * the primary model. The boundary is committed exactly once, on the first
 * target where both Binance books pass every readiness gate, and always points
 * at a FUTURE exact 15-minute boundary (never mid-candle, never retroactive).
 */
export async function ensureDualAdaptiveActivation(
  sb: SupabaseClient,
  eligible: boolean,
  snapshot: Record<string, unknown>,
  targetTs: string,
): Promise<string | null> {
  const existing = await readDualAdaptiveActivationTs(sb);
  if (existing) return existing;
  if (!eligible) return null;

  const activationTs = nextCleanBoundaryTs(targetTs);
  const now = new Date().toISOString();
  await sb
    .from("b4x4_es1_activation")
    .update({
      dual_adaptive_mode: "ACTIVE",
      dual_adaptive_model_version: MODEL_VERSION,
      dual_adaptive_policy_version: POLICY_VERSION,
      dual_adaptive_config_hash: dualAdaptiveConfigHash(),
      dual_adaptive_approved_at: now,
      dual_adaptive_approval_note: DUAL_ADAPTIVE_APPROVAL_NOTE,
      dual_adaptive_activation_target_ts: activationTs,
      dual_adaptive_activation_snapshot: snapshot,
      dual_adaptive_created_at: now,
    } as never)
    .eq("id", ACTIVATION_ID)
    .is("dual_adaptive_activation_target_ts", null);

  return readDualAdaptiveActivationTs(sb);
}

export async function readDualAdaptiveActivationTs(
  sb: SupabaseClient,
): Promise<string | null> {
  const { data } = await sb
    .from("b4x4_es1_activation")
    .select("dual_adaptive_activation_target_ts")
    .eq("id", ACTIVATION_ID)
    .maybeSingle();
  const ts = (data as DbRow | null)?.dual_adaptive_activation_target_ts as string | undefined;
  return ts ? new Date(ts).toISOString() : null;
}

export interface DualAdaptiveRunResult {
  decision: DualAdaptiveDecision;
  spot: MarketReadiness | null;
  perp: MarketReadiness | null;
  patch: DbRow;
}

/**
 * Load the exact-target Binance features, decide, and persist the complete
 * primary row plus every counterfactual shadow.
 *
 * Called after `runBalancedForPrediction`, which has already finalized the
 * exact-target boundary features and snapshotted the legacy ES1 chain.
 */
export async function runDualAdaptiveForPrediction(
  sb: SupabaseClient,
  row: DbRow,
  targetTs: string,
): Promise<DualAdaptiveRunResult | null> {
  const predictionId = String(row.id);
  const isLive = row.run_mode === "LIVE";

  let spot: MarketReadiness | null = null;
  let perp: MarketReadiness | null = null;
  let loadError: string | null = null;
  try {
    const [spotRow, perpRow] = await Promise.all([
      getBoundaryFeature(sb, targetTs, "SPOT"),
      getBoundaryFeature(sb, targetTs, "USD_M_PERP"),
    ]);
    spot = marketReadinessFrom(spotRow as DbRow | null, { targetTs });
    perp = marketReadinessFrom(perpRow as DbRow | null, { targetTs });
  } catch (e) {
    // Fail closed: a Binance load failure is an auditable primary abstention.
    loadError = e instanceof Error ? e.message : String(e);
    spot = null;
    perp = null;
  }

  const bothGatesPass =
    spot != null && perp != null && spot.gateReason == null && perp.gateReason == null;

  const activationTargetTs = await ensureDualAdaptiveActivation(
    sb,
    bothGatesPass,
    {
      target_ts: targetTs,
      spot_feature_id: spot?.featureId ?? null,
      perp_feature_id: perp?.featureId ?? null,
      spot_ready: spot?.gateReason == null,
      perp_ready: perp?.gateReason == null,
      checked_at: new Date().toISOString(),
    },
    targetTs,
  ).catch(() => null);

  const decision = decideDualAdaptive({ targetTs, spot, perp, activationTargetTs });
  const inputHash = dualAdaptiveInputHash(decision, targetTs);

  const webhookEligible =
    DUAL_ADAPTIVE_PUBLICATION_ENABLED &&
    isLive &&
    decision.activated &&
    decision.wouldTrade &&
    decision.finalPrediction != null;

  const patch: DbRow = {
    // frozen identity
    dual_adaptive_model_version: MODEL_VERSION,
    dual_adaptive_policy_version: POLICY_VERSION,
    dual_adaptive_implementation_revision: IMPLEMENTATION_REVISION,
    dual_adaptive_feature_schema: FEATURE_SCHEMA,
    dual_adaptive_config_hash: decision.configHash,
    dual_adaptive_activation_id: ACTIVATION_ID,
    dual_adaptive_activation_target_ts: activationTargetTs,
    dual_adaptive_input_hash: inputHash,

    dual_adaptive_ready: decision.ready,
    dual_adaptive_ready_reason: decision.readyReason,
    dual_adaptive_detailed_reason: loadError
      ? `BINANCE_LOAD_FAILED:${loadError}`
      : decision.detailedReason,

    // spot prediction-time snapshot
    dual_adaptive_spot_feature_id: decision.spot.featureId,
    dual_adaptive_spot_capture_status: decision.spot.captureStatus,
    dual_adaptive_spot_ready: decision.spot.gateReason == null,
    dual_adaptive_spot_ready_reason: decision.spot.gateReason ?? decision.spot.readyReason,
    dual_adaptive_spot_history_ready: decision.spot.historyReady,
    dual_adaptive_spot_final_imbalance_10bps: decision.spot.finalImbalance10bps,
    dual_adaptive_spot_mean_imbalance_10bps_60s: decision.spot.meanImbalance10bps60s,
    dual_adaptive_spot_final_sign: decision.spot.finalSign,
    dual_adaptive_spot_mean60_sign: decision.spot.mean60Sign,
    dual_adaptive_spot_mode: decision.spot.mode,
    dual_adaptive_spot_mode_reason: decision.spot.modeReason,
    dual_adaptive_spot_direction: decision.spot.direction,

    // perp prediction-time snapshot
    dual_adaptive_perp_feature_id: decision.perp.featureId,
    dual_adaptive_perp_capture_status: decision.perp.captureStatus,
    dual_adaptive_perp_ready: decision.perp.gateReason == null,
    dual_adaptive_perp_ready_reason: decision.perp.gateReason ?? decision.perp.readyReason,
    dual_adaptive_perp_history_ready: decision.perp.historyReady,
    dual_adaptive_perp_final_imbalance_10bps: decision.perp.finalImbalance10bps,
    dual_adaptive_perp_mean_imbalance_10bps_60s: decision.perp.meanImbalance10bps60s,
    dual_adaptive_perp_final_sign: decision.perp.finalSign,
    dual_adaptive_perp_mean60_sign: decision.perp.mean60Sign,
    dual_adaptive_perp_mode: decision.perp.mode,
    dual_adaptive_perp_mode_reason: decision.perp.modeReason,
    dual_adaptive_perp_direction: decision.perp.direction,

    dual_adaptive_venue_agreement: decision.venueAgreement,
    dual_adaptive_candidate_direction: decision.candidateDirection,
    dual_adaptive_would_trade: decision.wouldTrade,
    dual_adaptive_decision_reason: decision.decisionReason,
    dual_adaptive_influenced_decision: decision.activated,
    dual_adaptive_webhook_eligible: webhookEligible,
    dual_adaptive_resolver_version: RESOLVER_VERSION,
  };

  // At/after activation the primary fields describe the primary model. The
  // legacy ES1 chain has already been snapshotted into balanced_legacy_* by
  // runBalancedForPrediction, so nothing is lost.
  if (decision.activated) {
    patch.legacy_es1_model_version = row.model_version ?? null;
    patch.model_version = MODEL_VERSION;
    patch.variant = VARIANT;
    patch.final_prediction = decision.finalPrediction;
    patch.would_trade = decision.wouldTrade;
    patch.decision_reason = decision.decisionReason;
    patch.webhook_eligible = webhookEligible;
    patch.balanced_webhook_eligible = false;
  }

  await sb.from("b4x4_es1_predictions").update(patch as never).eq("id", predictionId);

  // Reporting-only counterfactuals. Failures here can never affect the
  // primary decision or the webhook.
  try {
    const shadows = evaluateDualAdaptiveShadows(decision).map((s) => ({
      target_ts: targetTs,
      prediction_id: predictionId,
      policy_name: s.policy_name,
      policy_version: POLICY_VERSION,
      config_hash: decision.configHash,
      implementation_revision: IMPLEMENTATION_REVISION,
      run_mode: isLive ? "LIVE" : "BACKFILL",
      qualified: s.qualified,
      qualification_reason: s.qualification_reason,
      candidate_direction: s.candidate_direction,
      would_trade: s.would_trade,
      is_active_policy: false,
      webhook_eligible: false,
      webhook_sent: false,
      spot_feature_id: decision.spot.featureId,
      perp_feature_id: decision.perp.featureId,
      spot_final_imbalance_10bps: decision.spot.finalImbalance10bps,
      spot_mean_imbalance_10bps_60s: decision.spot.meanImbalance10bps60s,
      perp_final_imbalance_10bps: decision.perp.finalImbalance10bps,
      perp_mean_imbalance_10bps_60s: decision.perp.meanImbalance10bps60s,
      input_values_hash: inputHash,
    }));
    await sb
      .from("b4x4_es1_balanced_shadows")
      .upsert(shadows as never, { onConflict: "target_ts,policy_name", ignoreDuplicates: true });
  } catch {
    /* reporting only */
  }

  return { decision, spot, perp, patch };
}

/**
 * Idempotent resolution against the canonical confirmed OKX candle. Updates
 * only resolution/audit fields; prediction-time features, direction, reason
 * and webhook state are never recomputed or changed here.
 */
export async function resolveDualAdaptiveRow(
  sb: SupabaseClient,
  row: DbRow,
  actual: ActualDirection,
): Promise<void> {
  const direction = (row.dual_adaptive_candidate_direction as Direction | null) ?? null;
  const traded = row.dual_adaptive_would_trade === true;
  const scored = scoreDualAdaptive(traded ? direction : null, actual);

  await sb
    .from("b4x4_es1_predictions")
    .update({
      dual_adaptive_result: scored.result,
      dual_adaptive_result_score: scored.score,
      dual_adaptive_resolved_at: new Date().toISOString(),
      dual_adaptive_resolver_version: RESOLVER_VERSION,
      dual_adaptive_resolution_attempt_count:
        Number(row.dual_adaptive_resolution_attempt_count ?? 0) + 1,
    } as never)
    .eq("id", String(row.id))
    .is("dual_adaptive_resolved_at", null);

  // Score every counterfactual for this target and record its incremental
  // value versus the primary policy.
  try {
    const targetTs = new Date(String(row.target_candle_ts)).toISOString();
    const { data } = await sb
      .from("b4x4_es1_balanced_shadows")
      .select("id, candidate_direction, would_trade, resolved_at")
      .eq("target_ts", targetTs)
      .eq("policy_version", POLICY_VERSION);
    for (const s of (data ?? []) as DbRow[]) {
      if (s.resolved_at) continue;
      const sc = scoreDualAdaptive(
        s.would_trade === true ? ((s.candidate_direction as Direction | null) ?? null) : null,
        actual,
      );
      await sb
        .from("b4x4_es1_balanced_shadows")
        .update({
          actual_direction: actual,
          result: sc.result,
          result_score: sc.score,
          primary_result_score: scored.score,
          incremental_value: scored.score - sc.score,
          resolved_at: new Date().toISOString(),
        } as never)
        .eq("id", String(s.id))
        .is("resolved_at", null);
    }
  } catch {
    /* reporting only — never blocks primary resolution */
  }
}

export { DISPLAY_NAME, MODEL_VERSION, POLICY_VERSION, VARIANT };
