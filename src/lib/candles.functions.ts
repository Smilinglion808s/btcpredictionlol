import { createServerFn } from "@tanstack/react-start";

export const listCandles = createServerFn({ method: "GET" }).handler(async () => {
  const { supabaseAdmin } = await import("@/integrations/supabase/client.server");
  const { data, error } = await supabaseAdmin
    .from("candles")
    .select("candle_ts, open, high, low, close, volume")
    .eq("symbol", "BTC-USDT")
    .eq("timeframe", "15m")
    .order("candle_ts", { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []).slice().reverse();
});
