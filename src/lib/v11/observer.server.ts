// Version 1.1 — T+45 observer.
//
// For EVERY official opportunity this scores the CONTEXT69_NORM_38 candidate and
// commits the score (valid or not) so the rank/availability history stays
// complete, independent of whether V1 called. Only the final admission is
// conditional. Nothing here can send a bet: no dispatch path exists in this
// module set and every decision row is written with dispatch_enabled = false.
//
// Score + decision + checkpoint are committed by ONE database transaction
// (`v11_commit_observation`), so a crash can never leave a hole.

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  V11_CANDIDATE_VERSION,
  V11_CONFIG_FINGERPRINT,
  V11_EVENT_CUTOFF_OFFSET_MS,
  V11_FEATURE_ORDER_HASH,
  V11_MODEL_VERSION,
  V11_POLICY_VERSION,
  V11_PUBLICATION_CEILING_MS,
  V11_PUBLICATION_MODE,
  V11_REASONS,
  V11_RUN_MODES,
  V11_STAKE_FRACTION_OF_BOISE_OPEN,
  V11_VOL_SOURCE,
  utcDate,
  v11EventKey,
  type V11RunMode,
} from "./config";
import { buildV11Vector, computeV11Vol } from "./features";
import {
  v11Availability,
  v11ConfidenceRank,
  v11HeadCertified,
  v11HeadFresh,
  v11Probability,
} from "./head";
import { decideV11, type V11CandidateScore, type V1LegSnapshot } from "./decision";
import {
  commitObservation,
  readState,
  decisionExists,
  readContextRow,
  readHeadForDate,
  readLiveContext,
  readMissingPredecessors,
  readPriorConfidences,
  readPriorOpportunities,
  readT45InputsTimed,
  readV1Snapshot,
  readVolHistory,
  upsertContextRow,
  upsertVector,
  type V11CommitOutcome,
} from "./store.server";

/**
 * Evidence that a live T+45 receipt actually happened. Supplied ONLY by the
 * signed collector hook; replay and recovery paths leave it undefined and can
 * therefore never produce a LIVE_SHADOW row.
 */
export interface V11LiveEvidence {
  /** True only when the caller verified the collector HMAC signature. */
  signed: boolean;
  /** Trigger identity, e.g. "t45-boundary-run". */
  source: string;
  /** Wall-clock instant the hook received the finalized offset-44 bar. */
  receivedAtMs: number;
}

export interface V11ObserveOptions {
  requestedRunMode?: V11RunMode;
  live?: V11LiveEvidence;
  now?: Date;
  /**
   * Historical bootstrap only: allows a commit at or before the checkpoint.
   * Live and recovery paths leave this off so the chain stays forward-only.
   */
  allowBackfill?: boolean;
}

export interface V11ObservationResult {
  targetTs: string;
  processed: boolean;
  duplicate: boolean;
  scoreValid: boolean;
  runMode: V11RunMode;
  decisionLeg: string | null;
  side: number;
  reason: string;
  rank: number | null;
  gate: number | null;
  probability: number | null;
  missingPredecessors: string[];
  /** Raw outcome of the ordered transaction; null when nothing was attempted. */
  commit?: V11CommitOutcome | null;
}

/**
 * Process exactly one target. Safe to call repeatedly and safe to resume after
 * a crash: the atomic commit is keyed by target, so a second call is a no-op
 * and a partially finished call has written nothing at all.
 */
export async function observeV11Target(
  sb: SupabaseClient,
  targetTsInput: string,
  opts: V11ObserveOptions = {},
): Promise<V11ObservationResult> {
  // A commit is rejected as STALE when the checkpoint moved underneath this
  // computation: the rank/availability windows it used no longer describe the
  // committed history. The only correct response is to recompute against the
  // new state, so the whole observation is retried, bounded.
  let last: V11ObservationResult | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    last = await observeV11TargetOnce(sb, targetTsInput, opts);
    if (last.commit?.stale !== true) return last;
  }
  return last as V11ObservationResult;
}

async function observeV11TargetOnce(
  sb: SupabaseClient,
  targetTsInput: string,
  opts: V11ObserveOptions = {},
): Promise<V11ObservationResult> {
  const targetTs = new Date(targetTsInput).toISOString();
  const now = opts.now ?? new Date();
  const openMs = Date.parse(targetTs);

  // Duplicate protection keys on the DECISION, not the score: a crash between
  // the two used to make the missing decision permanently unreachable. With the
  // atomic commit both exist or neither does.
  if (await decisionExists(sb, targetTs)) {
    return {
      targetTs,
      processed: false,
      duplicate: true,
      scoreValid: false,
      runMode: V11_RUN_MODES.RESEARCH,
      decisionLeg: null,
      side: 0,
      reason: "V11_ALREADY_OBSERVED",
      rank: null,
      gate: null,
      probability: null,
      missingPredecessors: [],
      commit: null,
    };
  }

  // The exact prior state this observation is computed against. The commit
  // refuses to apply if it changed in the meantime.
  const expectedState = await readState(sb);
  const missingPredecessors = await readMissingPredecessors(sb, targetTs);

  // Context: the live committed V1 row is preferred; a DB failure raises rather
  // than being mistaken for "no model row".
  const live = await readLiveContext(sb, targetTs);
  let ctx = live as Awaited<ReturnType<typeof readContextRow>>;
  if (live) {
    await upsertContextRow(sb, live, "c85_targets");
  } else {
    ctx = await readContextRow(sb, targetTs);
  }

  const t45Timed = await readT45InputsTimed(sb, targetTs);
  const t45 = t45Timed?.feats ?? null;
  const inputsPersistedOffsetMs = t45Timed?.persistedAt
    ? Math.round(Date.parse(t45Timed.persistedAt) - openMs)
    : null;
  const ticker = ctx?.ticker ?? "";

  let v1: V1LegSnapshot;
  let v1ReadFailed = false;
  try {
    v1 = await readV1Snapshot(sb, targetTs);
  } catch {
    v1ReadFailed = true;
    v1 = {
      committed: false,
      status: null,
      runMode: null,
      inputValid: false,
      finalSide: null,
      reason: null,
      ordinaryFloorOpen: null,
      // A failed read is ambiguous, and ambiguity is never fallback-eligible.
      sendClaim: "unknown",
    };
  }

  const decisionOffsetMs = Math.round(now.getTime() - openMs);
  const withinCeiling = decisionOffsetMs <= V11_PUBLICATION_CEILING_MS;

  /**
   * LIVE_SHADOW is earned, not requested. It needs a signed live trigger, a
   * receipt that actually arrived, a genuine LIVE V1 row for the same interval,
   * and a decision produced before the 60s publication ceiling. Anything else
   * is RESEARCH or RECOVERY and is scored separately.
   */
  const liveEligible =
    opts.requestedRunMode === V11_RUN_MODES.LIVE &&
    opts.live?.signed === true &&
    Number.isFinite(opts.live?.receivedAtMs) &&
    inputsPersistedOffsetMs !== null &&
    v1.runMode === "LIVE" &&
    !v1ReadFailed &&
    withinCeiling &&
    missingPredecessors.length === 0;
  const runMode: V11RunMode = liveEligible
    ? V11_RUN_MODES.LIVE
    : opts.requestedRunMode === V11_RUN_MODES.RECOVERY
      ? V11_RUN_MODES.RECOVERY
      : opts.requestedRunMode === V11_RUN_MODES.LIVE
        ? V11_RUN_MODES.RECOVERY
        : V11_RUN_MODES.RESEARCH;

  const timing = {
    // Event-time cutoff. NOT a claim that inputs were in hand at 45000ms.
    event_cutoff_offset_ms: V11_EVENT_CUTOFF_OFFSET_MS,
    inputs_persisted_offset_ms: inputsPersistedOffsetMs,
    decision_offset_ms: decisionOffsetMs,
    publication_ceiling_ms: V11_PUBLICATION_CEILING_MS,
    within_publication_ceiling: withinCeiling,
  };

  const evidence = {
    run_mode: runMode,
    requested_run_mode: opts.requestedRunMode ?? V11_RUN_MODES.RESEARCH,
    trigger: opts.live?.source ?? "maintenance",
    trigger_signed: opts.live?.signed === true,
    trigger_received_at_ms: opts.live?.receivedAtMs ?? null,
    v1_run_mode: v1.runMode ?? null,
    v1_read_failed: v1ReadFailed,
    v1_publication_offset_ms: v1.publicationOffsetMs ?? null,
    t45_persisted_offset_ms: inputsPersistedOffsetMs,
    event_cutoff_offset_ms: V11_EVENT_CUTOFF_OFFSET_MS,
    decision_offset_ms: decisionOffsetMs,
    within_publication_ceiling: withinCeiling,
    missing_predecessors: missingPredecessors.length,
    feature_order_hash: V11_FEATURE_ORDER_HASH,
    config_fingerprint: V11_CONFIG_FINGERPRINT,
    dispatch_enabled: false,
  };

  let commitOutcome: V11CommitOutcome | null = null;

  const commit = async (
    score: Record<string, unknown>,
    decision: ReturnType<typeof decideV11>,
    headDate: string | null,
  ): Promise<void> => {
    commitOutcome = await commitObservation(
      sb,
      targetTs,
      { ticker, head_date: headDate, run_mode: runMode, ...timing, ...score },
      {
        ticker,
        event_key: v11EventKey(ticker, targetTs),
        leg: decision.leg,
        side: decision.side,
        reason: decision.reason,
        probability: decision.probability,
        rank: decision.rank,
        admission_gate: decision.gate,
        head_date: headDate,
        v1_status: v1.status,
        v1_reason: v1.reason,
        v1_final_side: v1.finalSide,
        v1_floor_open: v1.ordinaryFloorOpen,
        v1_send_claim: v1.sendClaim,
        run_mode: runMode,
        evidence,
        ...timing,
        strategy: {
          model_version: V11_MODEL_VERSION,
          candidate_version: V11_CANDIDATE_VERSION,
          policy_version: V11_POLICY_VERSION,
          publication_mode: V11_PUBLICATION_MODE,
          stake_fraction_of_boise_day_opening_principal:
            V11_STAKE_FRACTION_OF_BOISE_OPEN,
          sizing_owner: "external-betting-bot",
        },
      },
      {
        prevTs: expectedState.lastProcessedTs,
        stateVersion: expectedState.stateVersion ?? null,
        allowBackfill: opts.allowBackfill === true,
      },
    );

    // The transaction re-checked the frozen V1 leg and found it NOT exclusive
    // (a V1 send landed, or the abstention is no longer the recorded one).
    // The score is still history, so the pair is re-committed as a no-call
    // instead of being dropped: the chain must not develop a hole.
    if (commitOutcome.excluded) {
      commitOutcome = await commitObservation(
        sb,
        targetTs,
        { ticker, head_date: headDate, run_mode: runMode, ...timing, ...score },
        {
          ticker,
          event_key: v11EventKey(ticker, targetTs),
          leg: null,
          side: 0,
          reason: V11_REASONS.V1_LEG_NOT_EXCLUSIVE,
          probability: decision.probability,
          rank: decision.rank,
          admission_gate: decision.gate,
          head_date: headDate,
          v1_status: v1.status,
          v1_reason: v1.reason,
          v1_final_side: v1.finalSide,
          v1_floor_open: v1.ordinaryFloorOpen,
          v1_send_claim: v1.sendClaim,
          run_mode: runMode,
          evidence: { ...evidence, downgraded_by: "V1_LEG_NOT_EXCLUSIVE" },
          ...timing,
          strategy: {
            model_version: V11_MODEL_VERSION,
            candidate_version: V11_CANDIDATE_VERSION,
            policy_version: V11_POLICY_VERSION,
            publication_mode: V11_PUBLICATION_MODE,
            stake_fraction_of_boise_day_opening_principal:
              V11_STAKE_FRACTION_OF_BOISE_OPEN,
            sizing_owner: "external-betting-bot",
          },
        },
        {
          prevTs: expectedState.lastProcessedTs,
          stateVersion: expectedState.stateVersion ?? null,
          allowBackfill: opts.allowBackfill === true,
        },
      );
      decision.side = 0;
      decision.leg = null;
      decision.reason = V11_REASONS.V1_LEG_NOT_EXCLUSIVE;
    }
  };

  const fail = async (reason: string): Promise<V11ObservationResult> => {
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
    await commit(
      {
        probability: null,
        confidence: null,
        rank: null,
        rank_history: 0,
        availability: null,
        admission_gate: null,
        valid: false,
        reason,
      },
      decision,
      null,
    );
    return {
      targetTs,
      processed: true,
      duplicate: false,
      scoreValid: false,
      runMode,
      decisionLeg: decision.leg,
      side: decision.side,
      // The blocking cause is reported as itself: a failed V1 read must not be
      // presented as the ordinary "V1 not resolved" outcome.
      reason: reason === V11_REASONS.V1_READ_FAILED ? reason : decision.reason,
      rank: null,
      gate: decision.gate,
      probability: null,
      missingPredecessors,
      commit: commitOutcome,
    } as V11ObservationResult;
  };

  if (v1ReadFailed) return fail(V11_REASONS.V1_READ_FAILED);
  if (!ctx) return fail(V11_REASONS.MISSING_CONTEXT);
  if (!t45) return fail(V11_REASONS.MISSING_T45);

  const volHistory = await readVolHistory(sb, targetTs);
  const volRes = computeV11Vol(volHistory, ctx.feats?.[V11_VOL_SOURCE]);
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
  if (head.quarantined === true) return fail(V11_REASONS.HEAD_QUARANTINED);
  if (
    (head.featureOrderHash && head.featureOrderHash !== V11_FEATURE_ORDER_HASH) ||
    (head.configFingerprint && head.configFingerprint !== V11_CONFIG_FINGERPRINT)
  ) {
    return fail(V11_REASONS.HEAD_CONFIG_MISMATCH);
  }
  if (!v11HeadCertified(head, now)) return fail(V11_REASONS.HEAD_UNCERTIFIED);

  const probability = v11Probability(head, built.vector);
  if (!Number.isFinite(probability)) return fail(V11_REASONS.NON_FINITE_INPUT);
  const confidence = Math.abs(probability - 0.5);

  // Two DIFFERENT clocks, computed BEFORE this score is appended:
  //  - rank        → last 768 FINITE confidences
  //  - availability→ last 768 OFFICIAL OPPORTUNITIES, invalid ones included
  const priorConfidences = await readPriorConfidences(sb, targetTs);
  const priorOpportunities = await readPriorOpportunities(sb, targetTs);
  const { rank, historyCount } = v11ConfidenceRank(confidence, priorConfidences);
  const { availability } = v11Availability(priorOpportunities);
  const gate =
    availability === null || !(availability > 0)
      ? null
      : Math.min(1, Math.max(0, 1 - 0.38 / availability));

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

  const decision = decideV11(v1, candidate);
  await commit(
    {
      probability,
      confidence,
      rank,
      rank_history: historyCount,
      availability,
      admission_gate: gate,
      valid: true,
      reason: rank === null ? V11_REASONS.RANK_NOT_READY : "V11_SCORED",
    },
    decision,
    headDate,
  );

  return {
    targetTs,
    processed: true,
    duplicate: false,
    scoreValid: true,
    runMode,
    decisionLeg: decision.leg,
    side: decision.side,
    reason: decision.reason,
    rank,
    gate: decision.gate,
    probability,
    missingPredecessors,
    commit: commitOutcome,
  };
}

/**
 * Chronological recovery: process every official opportunity with no committed
 * decision, oldest first, bounded. Recovered rows are RECOVERY, never live.
 */
export async function recoverV11Chronologically(
  sb: SupabaseClient,
  targets: readonly string[],
  limit = 64,
): Promise<V11ObservationResult[]> {
  const out: V11ObservationResult[] = [];
  const ordered = [...targets].sort((a, b) => Date.parse(a) - Date.parse(b));
  for (const ts of ordered.slice(0, limit)) {
    out.push(
      await observeV11Target(sb, ts, { requestedRunMode: V11_RUN_MODES.RECOVERY }),
    );
  }
  return out;
}
