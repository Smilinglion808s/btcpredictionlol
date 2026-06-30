import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";
import { fetchAndUpsertOkxCandles } from "./okx.server";

/** Fetch latest OKX candles, upsert into the candles table, return latest 200. */
export const fetchOkxCandles = createServerFn({ method: "POST" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    return fetchAndUpsertOkxCandles(context.supabase);
  });
