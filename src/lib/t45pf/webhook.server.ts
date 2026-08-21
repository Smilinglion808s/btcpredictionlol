// T45 PriceFlow Q37.5 — outbound webhook payload (server only).
//
// Only tradeable LIVE decisions emit. Abstains, invalid rows, backfill rows
// and resolutions never emit.

import { MODEL_NAME, MODEL_VARIANT, MODEL_VERSION, TF_MS } from "./config";
import { formatMountainTime } from "@/lib/webhooks.server";

export const T45PF_WEBHOOK_MODEL_ID = "t45-priceflow";
export const T45PF_DECISION_POLICY_VERSION = "t45-priceflow-q375-r1";

export interface PFWebhookInputs {
  targetTs: string;
  direction: 1 | -1;
  probabilityGreen: number | null;
  confidenceRank: number | null;
  fitId: string | null;
  openPrice: number | null;
}

export function buildPriceFlowWebhookPayload({
  targetTs,
  direction,
  probabilityGreen,
  confidenceRank,
  fitId,
  openPrice,
}: PFWebhookInputs) {
  const startMs = new Date(targetTs).getTime();
  const startsAt = new Date(startMs).toISOString();
  const endsAt = new Date(startMs + TF_MS).toISOString();
  const nowIso = new Date().toISOString();
  const predictionLabel: "YES" | "NO" = direction === 1 ? "YES" : "NO";
  const pGreen =
    probabilityGreen != null && Number.isFinite(probabilityGreen) ? probabilityGreen : null;
  const confidence =
    pGreen == null ? 0 : Math.round((predictionLabel === "YES" ? pGreen : 1 - pGreen) * 100);

  return {
    model: T45PF_WEBHOOK_MODEL_ID,
    model_name: MODEL_NAME,
    model_version: MODEL_VERSION,
    model_variant: MODEL_VARIANT,
    decision_policy_version: T45PF_DECISION_POLICY_VERSION,
    model_fit_id: fitId,

    prediction: predictionLabel,
    confidence,
    trade: true,
    direction: direction === 1 ? "GREEN" : "RED",

    probability_green: pGreen,
    confidence_rank: confidenceRank,

    candle_starts_at: startsAt,
    candle_starts_at_mt: formatMountainTime(startsAt),
    candle_ends_at: endsAt,
    candle_ends_at_mt: formatMountainTime(endsAt),
    target_candle_close_at: endsAt,

    dedupe_key: `t45-priceflow-BTC-USDT-15m-${startsAt}`,
    btc_price_at_prediction: openPrice,

    sent_at: nowIso,
    sent_at_mt: formatMountainTime(nowIso),
    timezone: "America/Denver",
  };
}
