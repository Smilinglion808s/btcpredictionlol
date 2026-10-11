// Service-role adapter for the V3 Kalshi settlement cache (server only).
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchV3KalshiOutcome, type GradeDeps } from "./kalshi-grade";

export function supabaseGradeDeps(sb: SupabaseClient): GradeDeps {
  return {
    async readCache(opens) {
      const rows: any[] = [];
      for (let k = 0; k < opens.length; k += 200) {
        const { data, error } = await sb.from("v3_kalshi_settlements")
          .select("candle_open,ticker,final,result,close_time,attempts,next_retry_at,last_attempt_at")
          .in("candle_open", opens.slice(k, k + 200).map((t) => new Date(t).toISOString()));
        if (error) return { rows: [], error: true };
        rows.push(...(data ?? []));
      }
      return { rows, error: false };
    },
    async record(row) {
      const { error } = await sb.rpc("v3_kalshi_record" as any, { p: row } as any);
      return { error: !!error };
    },
    fetchOutcome: (t) => fetchV3KalshiOutcome(t),
  };
}
