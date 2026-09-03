// One-signal-per-candle cascade arbiter (server only).
//
// Priority: T10 (T+10s) → T30 (T+30s) → T45 (T+45s). The first model that
// produces a directional, tradeable LIVE decision for a target candle claims
// the candle; every later model is suppressed for that candle. Claiming is a
// primary-key insert, so it is atomic even under concurrent runs.

import type { SupabaseClient } from "@supabase/supabase-js";

export const CASCADE_PRIORITY = ["t10-bridge", "t30-priceflow", "t45-priceflow"] as const;
export type CascadeModel = (typeof CASCADE_PRIORITY)[number];

/**
 * Try to become the single sender for `targetTs`.
 * Returns true only when this call inserted the claim row.
 */
export async function claimWebhookCascade(
  sb: SupabaseClient,
  targetTs: string,
  model: CascadeModel,
): Promise<boolean> {
  // Models with webhooks disabled must never claim a candle, otherwise they
  // would suppress the model that is actually allowed to send.
  if (!WEBHOOK_ALLOWED_MODELS.has(model)) return false;
  try {
    const ts = new Date(targetTs).toISOString();
    const { data, error } = await sb
      .from("webhook_cascade_claims")
      .insert({ target_ts: ts, model } as never)
      .select("target_ts")
      .maybeSingle();
    if (error) return false;
    return data != null;
  } catch {
    return false;
  }
}
