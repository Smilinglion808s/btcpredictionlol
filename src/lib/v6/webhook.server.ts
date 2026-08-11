// V6 outbound directional webhook.
//
// V6 is a secondary sender alongside B4x4. Conflict rule (product decision):
// when B4x4 has published a directional trade for the same target candle and
// it disagrees with V6, only B4x4 ships — the V6 webhook is suppressed and the
// suppression is recorded on the V6 row. When B4x4 agrees, or B4x4 published
// nothing (abstain / no row), V6 ships normally.
import type { SupabaseClient } from "@supabase/supabase-js";

/** Master kill switch for V6 outbound directional webhooks. */
export const V6_WEBHOOKS_ENABLED = true;

/** First target boundary eligible for a live V6 webhook. */
export const V6_WEBHOOK_ACTIVATION_TS = "2026-08-11T02:00:00.000Z";

type Row = Record<string, unknown> | null;

async function b4x4DirectionFor(
  supabase: SupabaseClient,
  targetCandleTs: string,
): Promise<"GREEN" | "RED" | null> {
  try {
    const { data } = await supabase
      .from("b4x4_predictions")
      .select("final_prediction, would_trade, run_mode, operational_gap_status")
      .eq("target_candle_ts", targetCandleTs)
      .maybeSingle();
    const row = data as
      | { final_prediction?: string | null; would_trade?: boolean | null; run_mode?: string | null; operational_gap_status?: string | null }
      | null;
    if (!row) return null;
    if (row.run_mode !== "LIVE") return null;
    if (row.operational_gap_status === "CATCHUP") return null;
    if (row.would_trade !== true) return null;
    if (row.final_prediction === "GREEN" || row.final_prediction === "RED") {
      return row.final_prediction;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Emit the V6 directional webhook at most once for a published V6 row.
 * Never throws; failures are swallowed so the prediction path is unaffected.
 */
export async function maybeSendV6Webhook(
  supabase: SupabaseClient,
  saved: Row,
): Promise<boolean> {
  try {
    if (!V6_WEBHOOKS_ENABLED) return false;
    if (!saved) return false;
    const predictionId = saved["prediction_id"] as string | undefined;
    if (!predictionId) return false;
    if (saved["operational_status"] !== "OK") return false;
    const direction = saved["final_prediction"];
    if (direction !== "GREEN" && direction !== "RED") return false;
    if (saved["webhook_sent_at"]) return false;

    const targetCandleTs = String(saved["target_candle_ts"]);
    const candleMs = new Date(targetCandleTs).getTime();
    if (!Number.isFinite(candleMs)) return false;
    if (candleMs < new Date(V6_WEBHOOK_ACTIVATION_TS).getTime()) return false;

    const b4x4Direction = await b4x4DirectionFor(supabase, targetCandleTs);
    const conflict = b4x4Direction != null && b4x4Direction !== direction;

    if (conflict) {
      await supabase
        .from("v6_predictions")
        .update({
          webhook_eligible: false,
          webhook_conflict_with_b4x4: true,
          b4x4_direction_at_send: b4x4Direction,
          webhook_suppressed_reason: `B4X4_CONFLICT:${b4x4Direction}_vs_${direction}`,
        } as never)
        .eq("prediction_id", predictionId);
      return false;
    }

    // Claim the send atomically: only the first writer flips webhook_sent_at.
    const { data: claimed } = await supabase
      .from("v6_predictions")
      .update({
        webhook_eligible: true,
        webhook_conflict_with_b4x4: false,
        b4x4_direction_at_send: b4x4Direction,
        webhook_sent_at: new Date().toISOString(),
      } as never)
      .eq("prediction_id", predictionId)
      .is("webhook_sent_at", null)
      .select("prediction_id")
      .maybeSingle();
    if (!claimed) return false;

    const { deliverWebhook, buildV6WebhookPayload } = await import("../webhooks.server");
    await deliverWebhook(
      supabase,
      "prediction.created",
      buildV6WebhookPayload({ row: { ...saved, b4x4_direction_at_send: b4x4Direction } }),
    );
    return true;
  } catch {
    return false;
  }
}
