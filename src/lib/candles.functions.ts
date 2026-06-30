import { createServerFn } from "@tanstack/react-start";
import { requireSupabaseAuth } from "@/integrations/supabase/auth-middleware";

export const listCandles = createServerFn({ method: "GET" })
  .middleware([requireSupabaseAuth])
  .handler(async ({ context }) => {
    const { data, error } = await context.supabase
      .from("candles")
      .select("candle_ts, open, high, low, close, volume")
      .eq("symbol", "BTC-USDT")
      .eq("timeframe", "15m")
      .order("candle_ts", { ascending: false })
      .limit(200);
    if (error) throw error;
    return (data ?? []).slice().reverse();
  });
