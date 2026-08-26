// T10 Bridge R1 — outbound webhook payload (server only).
//
// Only tradeable LIVE decisions taken at or after the persisted activation
// boundary may emit. Abstains, shadow rows, BACKFILL/CATCHUP rows and
// resolutions never emit. T10 is installed with webhooks DISABLED.

import { T10_BRIDGE_VARIANT, T10_BRIDGE_VERSION, T10_MODEL_NAME, TF_MS } from "./config";
import { formatMountainTime } from "@/lib/webhooks.server";

export const T10_WEBHOOK_MODEL_ID = "t10-bridge";
export const T10_DECISION_POLICY_VERSION = "t10-bridge-r1";

export interface T10WebhookInputs {
  targetTs: string;
  direction: 1 | -1;
  correctnessProbability: number | null;
  longRank: number | null;
  fastRank: number | null;
  fitId: string | null;
  openPrice: number | null;
}

export function buildT10WebhookPayload({
  targetTs,
  direction,
  correctnessProbability,
  longRank,
  fastRank,
  fitId,
  openPrice,
}: T10WebhookInputs) {
  const startMs = new Date(targetTs).getTime();
  const startsAt = new Date(startMs).toISOString();
  const endsAt = new Date(startMs + TF_MS).toISOString();
  const predictionLabel: "YES" | "NO" = direction === 1 ? "YES" : "NO";
  const p =
    correctnessProbability != null && Number.isFinite(correctnessProbability)
      ? correctnessProbability
      : null;

  return {
    model: T10_WEBHOOK_MODEL_ID,
    model_name: T10_MODEL_NAME,
    model_version: T10_BRIDGE_VERSION,
    model_variant: T10_BRIDGE_VARIANT,
    decision_policy_version: T10_DECISION_POLICY_VERSION,
    model_fit_id: fitId,

    prediction: predictionLabel,
    confidence: p == null ? 0 : Math.round(p * 100),
    trade: true,
    direction: direction === 1 ? "GREEN" : "RED",

    correctness_probability: p,
    long_rank: longRank,
    fast_rank: fastRank,

    candle_starts_at: startsAt,
    candle_starts_at_mt: formatMountainTime(startsAt),
    candle_ends_at: endsAt,
    open_price: openPrice,
    sent_at: new Date().toISOString(),
  };
}

/** Idempotency key for the atomic claim/send pattern. */
export function t10IdempotencyKey(predictionId: string): string {
  return `${predictionId}:${T10_BRIDGE_VERSION}`;
}

export interface T10EligibilityInputs {
  runMode: string;
  activationMode: string;
  webhooksEnabled: boolean;
  activationBoundaryTs: string | null;
  targetTs: string;
  modelVersion: string;
  configHash: string;
  expectedConfigHash: string;
  packetComplete: boolean;
  fitCertified: boolean;
  rankCertified: boolean;
  policyWouldTrade: boolean;
  alreadyClaimed: boolean;
}

/** Every condition must hold. BACKFILL and CATCHUP can never be eligible. */
export function t10WebhookEligible(i: T10EligibilityInputs): boolean {
  return (
    i.runMode === "LIVE" &&
    i.activationMode === "ACTIVE" &&
    i.webhooksEnabled &&
    i.activationBoundaryTs != null &&
    new Date(i.targetTs).getTime() >= new Date(i.activationBoundaryTs).getTime() &&
    i.modelVersion === T10_BRIDGE_VERSION &&
    i.configHash === i.expectedConfigHash &&
    i.packetComplete &&
    i.fitCertified &&
    i.rankCertified &&
    i.policyWouldTrade &&
    !i.alreadyClaimed
  );
}
