// B4x4-ES1 Balanced Binance 3-of-4 R1 — live wiring (server only).
//
// Ordering contract: the exact-target Binance boundary features are finalized
// and gated BEFORE the active balanced decision is computed. The legacy ES1
// chain still runs and is persisted unchanged as the counterfactual.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  BALANCED_DECISION_POLICY_VERSION,
  BALANCED_FEATURE_SCHEMA,
  BALANCED_IMPLEMENTATION_REVISION,
  BALANCED_MODEL_VERSION,
  BALANCED_PROSPECTIVE_TEST_ID,
  applyActivationGate,
  balancedConfigHash,
  decideBalanced,
  evaluateBalancedShadowPolicies,
  incrementalValue,
  marketReadinessFrom,
  scoreDirection,
  type ActualDirection,
  type BalancedDecision,
  type Direction,
  type MarketReadiness,
} from "./balanced";
import { TF_MS } from "./config";
import { finalizeBinanceObTarget } from "./binanceOb/orchestrator.server";
import { getBoundaryFeature } from "./binanceOb/store.server";
import { valuesHash } from "./binanceOb/config";

type DbRow = Record<string, unknown>;

const ACTIVATION_ID = "b4x4-es1";

/** Balanced publication switch. Rows are always recorded either way. */
export const BALANCED_PUBLICATION_ENABLED = true;

/**
 * A qualifying boundary ARMS activation for the FOLLOWING boundary (T + 15m).
 * It never activates itself: the arming row stays
 * ABSTAIN_BALANCED_ACTIVATION_NOT_REACHED.
 */
function nextCleanBoundaryTs(targetTs: string): string {
  return new Date(Math.floor(new Date(targetTs).getTime() / TF_MS) * TF_MS + TF_MS).toISOString();
}

/**
 * `b4x4_es1_activation` is the single authoritative activation record. The
 * balanced boundary is committed exactly once, on the first target where both
 * Binance books pass every readiness gate and ES1 is parity certified.
 */
export async function ensureBalancedActivation(
  sb: SupabaseClient,
  eligible: boolean,
  snapshot: Record<string, unknown>,
  targetTs: string,
): Promise<string | null> {
  const { data } = await sb
    .from("b4x4_es1_activation")
    .select("balanced_activation_target_ts")
    .eq("id", ACTIVATION_ID)
    .maybeSingle();
  const existing = (data as DbRow | null)?.balanced_activation_target_ts as string | undefined;
  if (existing) return new Date(existing).toISOString();
  if (!eligible) return null;

  const activationTs = nextCleanBoundaryTs(targetTs);
  await sb
    .from("b4x4_es1_activation")
    .update({
      balanced_policy_version: BALANCED_DECISION_POLICY_VERSION,
      balanced_activation_target_ts: activationTs,
      balanced_activation_set_at: new Date().toISOString(),
      balanced_activation_snapshot: snapshot,
    } as never)
    .eq("id", ACTIVATION_ID)
    .is("balanced_activation_target_ts", null);

  const { data: after } = await sb
    .from("b4x4_es1_activation")
    .select("balanced_activation_target_ts")
    .eq("id", ACTIVATION_ID)
    .maybeSingle();
  const committed = (after as DbRow | null)?.balanced_activation_target_ts as string | undefined;
  return committed ? new Date(committed).toISOString() : null;
}

export async function readBalancedActivationTs(sb: SupabaseClient): Promise<string | null> {
  const { data } = await sb
    .from("b4x4_es1_activation")
    .select("balanced_activation_target_ts")
    .eq("id", ACTIVATION_ID)
    .maybeSingle();
  const ts = (data as DbRow | null)?.balanced_activation_target_ts as string | undefined;
  return ts ? new Date(ts).toISOString() : null;
}

export interface BalancedRunResult {
  decision: BalancedDecision;
  spot: MarketReadiness;
  perp: MarketReadiness;
  patch: DbRow;
}

/**
 * Finalize Binance for the exact target, compute the balanced decision, persist
 * every audit column on the prediction row and write all nine shadow rows.
 */
export async function runBalancedForPrediction(
  sb: SupabaseClient,
  row: DbRow,
  targetTs: string,
): Promise<BalancedRunResult | null> {
  const predictionId = String(row.id);
  const loadStartedAt = new Date().toISOString();

  // 1. exact-target Binance features FIRST (also emits the legacy OB shadows).
  await finalizeBinanceObTarget(sb, targetTs, predictionId).catch(() => null);
  const [spotRow, perpRow] = await Promise.all([
    getBoundaryFeature(sb, targetTs, "SPOT").catch(() => null),
    getBoundaryFeature(sb, targetTs, "USD_M_PERP").catch(() => null),
  ]);
  const spot = marketReadinessFrom(spotRow as DbRow | null, { targetTs });
  const perp = marketReadinessFrom(perpRow as DbRow | null, { targetTs });

  // 2. active balanced decision.
  const es1 = {
    priceDirection: (row.price_direction as Direction | null) ?? null,
    parityCertified: row.parity_certified === true,
    probabilityGreen:
      typeof row.price_probability_green === "number" ? row.price_probability_green : null,
    confidence: typeof row.price_confidence === "number" ? row.price_confidence : null,
    priceFitId: (row.price_fit_id as string | null) ?? null,
    priceFitSource: (row.price_fit_source as string | null) ?? null,
  };
  const raw = decideBalanced({ targetTs, es1, spot, perp });

  const readyForActivation =
    es1.parityCertified && spot.gateReason == null && perp.gateReason == null;
  const activationTs = await ensureBalancedActivation(sb, readyForActivation, {
    target_ts: targetTs,
    spot_feature_id: spot.featureId,
    perp_feature_id: perp.featureId,
    spot_ready: spot.gateReason == null,
    perp_ready: perp.gateReason == null,
    es1_parity_certified: es1.parityCertified,
    checked_at: new Date().toISOString(),
  }, targetTs).catch(() => null);

  const decision = applyActivationGate({ ...raw, activationBoundaryTs: activationTs }, targetTs, activationTs);

  const isLive = row.run_mode === "LIVE";
  const patch: DbRow = {
    balanced_model_version: BALANCED_MODEL_VERSION,
    balanced_policy_version: decision.policyVersion,
    balanced_prospective_test_id: BALANCED_PROSPECTIVE_TEST_ID,
    balanced_feature_schema: BALANCED_FEATURE_SCHEMA,
    balanced_implementation_revision: BALANCED_IMPLEMENTATION_REVISION,
    balanced_config_hash: decision.configHash,
    balanced_activation_target_ts: activationTs,
    balanced_active: activationTs != null && new Date(targetTs).getTime() >= new Date(activationTs).getTime(),

    balanced_es1_price_direction: es1.priceDirection,
    balanced_es1_probability_green: es1.probabilityGreen,
    balanced_es1_confidence: es1.confidence,
    balanced_es1_parity_certified: es1.parityCertified,
    balanced_price_fit_id: es1.priceFitId,
    balanced_price_fit_source: es1.priceFitSource,

    balanced_spot_feature_id: spot.featureId,
    balanced_perp_feature_id: perp.featureId,
    balanced_spot_values_hash: spot.featureValuesHash,
    balanced_perp_values_hash: perp.featureValuesHash,
    balanced_spot_capture_status: spot.captureStatus,
    balanced_perp_capture_status: perp.captureStatus,
    balanced_spot_ready: spot.gateReason == null,
    balanced_perp_ready: perp.gateReason == null,
    balanced_spot_ready_reason: spot.readyReason,
    balanced_perp_ready_reason: perp.readyReason,
    balanced_spot_gate_reason: spot.gateReason,
    balanced_perp_gate_reason: perp.gateReason,
    balanced_spot_resync_continuous: spot.resyncContinuous,
    balanced_perp_resync_continuous: perp.resyncContinuous,
    balanced_spot_final_imbalance_10bps: spot.finalImbalance10bps,
    balanced_spot_normalized_ofi_60s: spot.normalizedOfi60s,
    balanced_perp_final_imbalance_10bps: perp.finalImbalance10bps,

    balanced_es1_vote: decision.es1Vote,
    balanced_spot_depth_vote: decision.spotDepthVote,
    balanced_spot_ofi60_vote: decision.spotOfi60Vote,
    balanced_perp_fade_vote: decision.perpFadeVote,
    balanced_green_vote_count: decision.greenVoteCount,
    balanced_red_vote_count: decision.redVoteCount,
    balanced_vote_sum: decision.voteSum,
    balanced_vote_margin: decision.voteMargin,
    balanced_vote_pattern: decision.votePattern,
    balanced_agreement_tier: decision.agreementTier,

    balanced_final_prediction: decision.finalPrediction,
    balanced_would_trade: decision.wouldTrade,
    balanced_decision_reason: decision.decisionReason,
    balanced_webhook_eligible:
      BALANCED_PUBLICATION_ENABLED && isLive && decision.wouldTrade && decision.finalPrediction != null,
    balanced_binance_loaded_at: loadStartedAt,
    balanced_decision_at: new Date().toISOString(),

    // legacy ES1 chain, kept purely as a counterfactual
    balanced_legacy_would_trade: row.would_trade === true,
    balanced_legacy_direction: (row.final_prediction as string | null) ?? null,
    balanced_legacy_decision_reason: (row.decision_reason as string | null) ?? null,
  };

  await sb.from("b4x4_es1_predictions").update(patch as never).eq("id", predictionId);

  // Keep the existing binance_ob_* audit columns populated (idempotent).
  try {
    const { linkBinanceObToPrediction } = await import("./binanceOb/orchestrator.server");
    await linkBinanceObToPrediction(sb, predictionId, targetTs);
  } catch {
    /* audit only — never blocks the active decision */
  }


  // 3. one shadow row per comparison policy, including abstentions.
  const shadows = evaluateBalancedShadowPolicies(decision, {
    direction: (row.final_prediction as Direction | null) ?? null,
    wouldTrade: row.would_trade === true,
    decisionReason: String(row.decision_reason ?? "ABSTAIN"),
  }).map((s) => ({
    target_ts: targetTs,
    prediction_id: predictionId,
    policy_name: s.policy_name,
    policy_version: BALANCED_DECISION_POLICY_VERSION,
    config_hash: decision.configHash,
    implementation_revision: BALANCED_IMPLEMENTATION_REVISION,
    run_mode: isLive ? "LIVE" : "BACKFILL",
    qualified: s.qualified,
    qualification_reason: s.qualification_reason,
    candidate_direction: s.candidate_direction,
    would_trade: s.would_trade,
    agreement_tier: s.agreement_tier,
    is_active_policy: s.is_active_policy,
    vote_pattern: decision.votePattern,
    es1_vote: decision.es1Vote,
    spot_depth_vote: decision.spotDepthVote,
    spot_ofi60_vote: decision.spotOfi60Vote,
    perp_fade_vote: decision.perpFadeVote,
    spot_feature_id: spot.featureId,
    perp_feature_id: perp.featureId,
    input_values_hash: valuesHash({
      policy: s.policy_name,
      votes: [decision.es1Vote, decision.spotDepthVote, decision.spotOfi60Vote, decision.perpFadeVote],
      spot: spot.featureValuesHash,
      perp: perp.featureValuesHash,
      version: BALANCED_DECISION_POLICY_VERSION,
    }),
  }));
  await sb
    .from("b4x4_es1_balanced_shadows")
    .upsert(shadows as never, { onConflict: "target_ts,policy_name", ignoreDuplicates: true });

  return { decision, spot, perp, patch };
}

/** Score the balanced decision and its shadow policies for a resolved candle. */
export async function resolveBalancedRow(
  sb: SupabaseClient,
  row: DbRow,
  actual: ActualDirection,
): Promise<void> {
  const active = scoreDirection((row.balanced_final_prediction as Direction | null) ?? null, actual);
  const legacy = scoreDirection(
    row.balanced_legacy_would_trade === true
      ? ((row.balanced_legacy_direction as Direction | null) ?? null)
      : null,
    actual,
  );
  await sb
    .from("b4x4_es1_predictions")
    .update({
      balanced_result: row.balanced_would_trade === true ? (active.result ?? "PUSH") : null,
      balanced_result_score: row.balanced_would_trade === true ? active.score : 0,
      balanced_legacy_result: legacy.result,
      balanced_legacy_score: legacy.score,
      balanced_incremental_value: incrementalValue(
        row.balanced_would_trade === true ? active.score : 0,
        legacy.score,
      ),
      balanced_resolved_at: new Date().toISOString(),
    } as never)
    .eq("id", String(row.id))
    .is("balanced_resolved_at", null);

  const { data } = await sb
    .from("b4x4_es1_balanced_shadows")
    .select("id, candidate_direction, would_trade")
    .eq("target_ts", new Date(String(row.target_candle_ts)).toISOString());
  for (const s of (data ?? []) as DbRow[]) {
    const sc = scoreDirection((s.candidate_direction as Direction | null) ?? null, actual);
    await sb
      .from("b4x4_es1_balanced_shadows")
      .update({
        actual_direction: actual,
        result: s.would_trade === true ? (sc.result ?? "PUSH") : null,
        result_score: s.would_trade === true ? sc.score : 0,
        resolved_at: new Date().toISOString(),
      } as never)
      .eq("id", String(s.id))
      .is("resolved_at", null);
  }
}
