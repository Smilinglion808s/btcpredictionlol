// Version 1.1 — pure combined-decision logic. No I/O, fully testable.
//
// Priority: the V1 leg owns the interval at T+5. The T45 R2 candidate can only
// take the interval at T+45 when the V1 leg *committed* a valid
// CONFIDENCE_ABSTAIN with the ORIGINAL recorded ordinary floor open, original
// final side 0, and no V1 send claim exists or could exist for that interval.

import {
  V11_FALLBACK_MIN_RANK,
  V11_REASONS,
  V1_LOW_CONFIDENCE_REASON,
  type V11Direction,
  type V11Leg,
} from "./config";
import { v11AdmissionGate } from "./head";

/** Immutable snapshot of the ORIGINAL V1 decision for this interval. */
export interface V1LegSnapshot {
  /** Present only when the V1 worker committed a row for this target. */
  committed: boolean;
  /** V1 status, e.g. "DECIDED" / "INPUT_UNAVAILABLE". */
  status: string | null;
  inputValid: boolean;
  /** Original recorded side: +1 / -1 / 0. */
  finalSide: number | null;
  /** Original recorded low-confidence reason. */
  reason: string | null;
  /** Original recorded features.daily_floor.ordinary_floor_allows. */
  ordinaryFloorOpen: boolean | null;
  /**
   * Canonical shared claim state for the V1 event key.
   * "none" — no claim row at all (safe).
   * "claimed" | "sent" | "failed" | "unknown" — never fallback-eligible.
   */
  sendClaim: "none" | "claimed" | "sent" | "failed" | "unknown";
}

export interface V11CandidateScore {
  valid: boolean;
  probability: number | null;
  confidence: number | null;
  rank: number | null;
  availability: number | null;
  headReady: boolean;
  headFresh: boolean;
  headCertified: boolean;
  /** First blocking reason produced while scoring, when not valid. */
  invalidReason: string | null;
}

export interface V11Decision {
  leg: V11Leg | null;
  side: V11Direction;
  reason: string;
  rank: number | null;
  gate: number | null;
  probability: number | null;
}

export function v11SideFromProbability(p: number): V11Direction {
  if (!Number.isFinite(p)) return 0;
  if (p > 0.5) return 1;
  if (p < 0.5) return -1;
  return 0;
}

/**
 * Is the ORIGINAL V1 decision a genuine low-confidence abstention that leaves
 * the interval free for the fallback leg?
 */
export function v1FallbackEligible(v1: V1LegSnapshot): {
  eligible: boolean;
  reason: string | null;
} {
  if (!v1.committed || v1.status === null) {
    return { eligible: false, reason: V11_REASONS.V1_NOT_RESOLVED };
  }
  if (!v1.inputValid || v1.reason !== V1_LOW_CONFIDENCE_REASON) {
    return { eligible: false, reason: V11_REASONS.V1_NOT_ELIGIBLE };
  }
  if (v1.finalSide !== 0) {
    return { eligible: false, reason: V11_REASONS.V1_LEG_OCCUPIES_INTERVAL };
  }
  if (v1.ordinaryFloorOpen !== true) {
    return { eligible: false, reason: V11_REASONS.V1_FLOOR_CLOSED };
  }
  if (v1.sendClaim !== "none") {
    return { eligible: false, reason: V11_REASONS.V1_DELIVERY_AMBIGUOUS };
  }
  return { eligible: true, reason: null };
}

/**
 * The combined Version 1.1 decision for one interval.
 *
 * `v1` is read-only; nothing in this function can change V1 behaviour. The
 * candidate score is computed and recorded for EVERY valid opportunity — only
 * this final admission is conditional.
 */
export function decideV11(
  v1: V1LegSnapshot,
  candidate: V11CandidateScore,
): V11Decision {
  // Leg 1 — V1 keeps the interval whenever it made a directional call.
  if (v1.committed && v1.inputValid && (v1.finalSide === 1 || v1.finalSide === -1)) {
    return {
      leg: "V1",
      side: v1.finalSide as V11Direction,
      reason: V11_REASONS.V1_CALL,
      rank: null,
      gate: null,
      probability: null,
    };
  }

  const elig = v1FallbackEligible(v1);
  if (!elig.eligible) {
    return {
      leg: null,
      side: 0,
      reason: elig.reason as string,
      rank: candidate.rank,
      gate:
        candidate.availability !== null ? v11AdmissionGate(candidate.availability) : null,
      probability: candidate.probability,
    };
  }

  if (!candidate.valid || candidate.probability === null || candidate.rank === null) {
    return {
      leg: null,
      side: 0,
      reason: candidate.invalidReason ?? V11_REASONS.RANK_NOT_READY,
      rank: candidate.rank,
      gate:
        candidate.availability !== null ? v11AdmissionGate(candidate.availability) : null,
      probability: candidate.probability,
    };
  }
  if (candidate.availability === null) {
    return {
      leg: null,
      side: 0,
      reason: V11_REASONS.AVAILABILITY_NOT_READY,
      rank: candidate.rank,
      gate: null,
      probability: candidate.probability,
    };
  }

  const gate = v11AdmissionGate(candidate.availability);
  if (candidate.rank < gate) {
    return {
      leg: null,
      side: 0,
      reason: V11_REASONS.BELOW_ADMISSION_GATE,
      rank: candidate.rank,
      gate,
      probability: candidate.probability,
    };
  }
  if (candidate.rank < V11_FALLBACK_MIN_RANK) {
    return {
      leg: null,
      side: 0,
      reason: V11_REASONS.BELOW_FALLBACK_RANK,
      rank: candidate.rank,
      gate,
      probability: candidate.probability,
    };
  }

  const side = v11SideFromProbability(candidate.probability);
  if (side === 0) {
    return {
      leg: null,
      side: 0,
      reason: V11_REASONS.BELOW_FALLBACK_RANK,
      rank: candidate.rank,
      gate,
      probability: candidate.probability,
    };
  }

  return {
    leg: "T45R2",
    side,
    reason: V11_REASONS.FALLBACK_CALL,
    rank: candidate.rank,
    gate,
    probability: candidate.probability,
  };
}
