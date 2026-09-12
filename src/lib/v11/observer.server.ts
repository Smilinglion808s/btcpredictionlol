// Version 1.1 — T+45 observer.
//
// For EVERY official opportunity this scores the CONTEXT69_NORM_38 candidate and
// appends the score (valid or not) so the rank/availability history stays
// complete, independent of whether V1 called. Only the final admission is
// conditional. Nothing here can send a bet: dispatch does not exist in this
// path and every decision row is written with dispatch_enabled = false.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  V11_CANDIDATE_VERSION,
  V11_MODEL_VERSION,
  V11_POLICY_VERSION,
  V11_PUBLICATION_MODE,
  V11_REASONS,
  V11_STAKE_FRACTION_OF_BOISE_OPEN,
  V11_VOL_SOURCE,
  utcDate,
} from "./config";
import { buildV11Vector, computeV11Vol } from "./features";
import {
  v11Availability,
  v11ConfidenceRank,
  v11HeadCertified,
  v11HeadFresh,
  v11Probability,
} from "./head";
import { decideV11, type V11CandidateScore } from "./decision";
import {
  advanceState,
  appendScore,
  insertDecision,
  readContextRow,
  readHeadForDate,
  readLiveContext,
  readPriorScores,
  readT45Inputs,
  readV1Snapshot,
  readVolHistory,
  scoreExists,
  upsertContextRow,
  upsertVector,
} from "./store.server";

export interface V11ObservationResult {
  targetTs: string;
  processed: boolean;
  duplicate: boolean;
  scoreValid: boolean;
  decisionLeg: string | null;
  side: number;
  reason: string;
  rank: number | null;
  gate: number | null;
  probability: number | null;
}

/**
 * Process exactly one target. Safe to call repeatedly: the score and decision
 * rows are keyed by target and a second call is a no-op.
 */
export async function observeV11Target(
  sb: SupabaseClient,
  targetTsInput: string,
): Promise<V11ObservationResult> {
  const targetTs = new Date(targetTsInput).toISOString();

  if (await scoreExists(sb, targetTs)) {
    return {
      targetTs,
      processed: false,
      duplicate: true,
      scoreValid: false,
      decisionLeg: null,
      side: 0,
      reason: "V11_ALREADY_OBSERVED",
      rank: null,
      gate: null,
      probability: null,
    };
  }

  // Context (60 original direction fields) — live row preferred, else seeded.
  let ctx = await readLiveContext(sb, targetTs);
  if (ctx) {
    await upsertContextRow(sb, ctx, "c85_targets");
  } else {
    ctx = await readContextRow(sb, targetTs);
  }
  const t45 = await readT45Inputs(sb, targetTs);
  const ticker = ctx?.ticker ?? "";

  const fail = async (reason: string): Promise<V11ObservationResult> => {
    await appendScore(sb, {
      targetTs,
      ticker,
      headDate: null,
      probability: null,
      confidence: null,
      rank: null,
      rankHistory: 0,
      availability: null,
      admissionGate: null,
      valid: false,
      reason,
    });
    const v1 = await readV1Snapshot(sb, targetTs);
    const decision = decideV11(v1, {
      valid: false,
      probability: null,
      confidence: null,
      rank: null,
      availability: null,
      headReady: false,
      headFresh: false,
      headCertified: false,
      invalidReason: reason,
    });
    await writeDecision(sb, targetTs, ticker, v1, decision, null);
    await advanceState(sb, { lastProcessedTs: targetTs });
    return {
      targetTs,
      processed: true,
      duplicate: false,
      scoreValid: false,
      decisionLeg: decision.leg,
      side: decision.side,
      reason: decision.reason,
      rank: null,
      gate: decision.gate,
      probability: null,
    };
  };

  if (!ctx) return fail(V11_REASONS.MISSING_CONTEXT);
  if (!t45) return fail(V11_REASONS.MISSING_T45);

  const volHistory = await readVolHistory(sb, targetTs);
  const volRes = computeV11Vol(volHistory, Number(ctx.feats?.[V11_VOL_SOURCE]));
  if (!volRes.ready) return fail(V11_REASONS.VOL_NOT_READY);

  const built = buildV11Vector({ direction60: ctx.feats, t45 }, volRes.vol);
  await upsertVector(sb, {
    targetTs,
    vector: built.vector,
    vol: built.vol,
    valid: built.valid,
    missing: built.missing,
    label: ctx.label,
    settlementTs: ctx.settlementTs,
  });
  if (!built.valid || !built.vector) return fail(V11_REASONS.NON_FINITE_INPUT);

  const headDate = utcDate(targetTs);
  const head = await readHeadForDate(sb, headDate);
  if (!head) return fail(V11_REASONS.HEAD_NOT_READY);
  if (!v11HeadFresh(head, targetTs)) return fail(V11_REASONS.HEAD_EXPIRED);
  if (!v11HeadCertified(head)) return fail(V11_REASONS.HEAD_UNCERTIFIED);

  const probability = v11Probability(head, built.vector);
  const confidence = Math.abs(probability - 0.5);

  // Rank and availability are computed BEFORE this score is appended.
  const prior = await readPriorScores(sb, targetTs);
  const priorConfidences = prior.map((p) => p.confidence);
  const { rank, historyCount } = v11ConfidenceRank(confidence, priorConfidences);
  const { availability } = v11Availability(priorConfidences);
  const gate =
    availability === null ? null : Math.min(1, Math.max(0, 1 - 0.38 / availability));

  await appendScore(sb, {
    targetTs,
    ticker,
    headDate,
    probability,
    confidence,
    rank,
    rankHistory: historyCount,
    availability,
    admissionGate: gate,
    valid: true,
    reason: rank === null ? V11_REASONS.RANK_NOT_READY : "V11_SCORED",
  });

  const candidate: V11CandidateScore = {
    valid: true,
    probability,
    confidence,
    rank,
    availability,
    headReady: true,
    headFresh: true,
    headCertified: true,
    invalidReason: rank === null ? V11_REASONS.RANK_NOT_READY : null,
  };

  const v1 = await readV1Snapshot(sb, targetTs);
  const decision = decideV11(v1, candidate);
  await writeDecision(sb, targetTs, ticker, v1, decision, headDate);
  await advanceState(sb, { lastProcessedTs: targetTs });

  return {
    targetTs,
    processed: true,
    duplicate: false,
    scoreValid: true,
    decisionLeg: decision.leg,
    side: decision.side,
    reason: decision.reason,
    rank,
    gate: decision.gate,
    probability,
  };
}

async function writeDecision(
  sb: SupabaseClient,
  targetTs: string,
  ticker: string,
  v1: Awaited<ReturnType<typeof readV1Snapshot>>,
  decision: ReturnType<typeof decideV11>,
  headDate: string | null,
): Promise<void> {
  await insertDecision(sb, {
    targetTs,
    ticker,
    leg: decision.leg,
    side: decision.side,
    reason: decision.reason,
    probability: decision.probability,
    rank: decision.rank,
    admissionGate: decision.gate,
    headDate,
    v1Status: v1.status,
    v1Reason: v1.reason,
    v1FinalSide: v1.finalSide,
    v1FloorOpen: v1.ordinaryFloorOpen,
    v1SendClaim: v1.sendClaim,
    strategy: {
      model_version: V11_MODEL_VERSION,
      candidate_version: V11_CANDIDATE_VERSION,
      policy_version: V11_POLICY_VERSION,
      publication_mode: V11_PUBLICATION_MODE,
      stake_fraction_of_boise_day_opening_principal: V11_STAKE_FRACTION_OF_BOISE_OPEN,
      sizing_owner: "external-betting-bot",
    },
  });
}
