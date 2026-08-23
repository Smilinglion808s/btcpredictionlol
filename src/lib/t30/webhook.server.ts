// T30 PriceFlow Balanced R1 — outbound webhook payload (server only).
//
// Only tradeable LIVE decisions emit. Abstains, invalid rows, backfill rows
// and resolutions never emit.

import { T30_MODEL_NAME, T30_MODEL_VARIANT, T30_MODEL_VERSION, TF_MS } from "./config";
import { formatMountainTime } from "@/lib/webhooks.server";

export const T30_WEBHOOK_MODEL_ID = "t30-priceflow";
export const T30_DECISION_POLICY_VERSION = "t30-priceflow-balanced-r1";

export interface T30WebhookInputs {
  targetTs: string;
  direction: 1 | -1;
  probabilityGreen: number | null;
  longRank: number | null;
  fastRank: number | null;
  fitId: string | null;
  openPrice: number | null;
}

export function buildT30WebhookPayload({
  targetTs,
  direction,
  probabilityGreen,
  longRank,
  fastRank,
  fitId,
  openPrice,
}: T30WebhookInputs) {
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
    model: T30_WEBHOOK_MODEL_ID,
    model_name: T30_MODEL_NAME,
    model_version: T30_MODEL_VERSION,
    model_variant: T30_MODEL_VARIANT,
    decision_policy_version: T30_DECISION_POLICY_VERSION,
    model_fit_id: fitId,

    prediction: predictionLabel,
    confidence,
    trade: true,
    direction: direction === 1 ? "GREEN" : "RED",

    probability_green: pGreen,
    long_rank: longRank,
    fast_rank: fastRank,

    candle_starts_at: startsAt,
    candle_starts_at_mt: formatMountainTime(startsAt),
    candle_ends_at: endsAt,
    candle_ends_at_mt: formatMountainTime(endsAt),
    target_candle_close_at: endsAt,

    dedupe_key: `t30-priceflow-BTC-USDT-15m-${startsAt}`,
    btc_price_at_prediction: openPrice,

    sent_at: nowIso,
    sent_at_mt: formatMountainTime(nowIso),
    timezone: "America/Denver",
  };
}
