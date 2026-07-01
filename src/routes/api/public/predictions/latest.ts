import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { buildPredictionPayload } from "@/lib/webhooks.server";

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, OPTIONS",
  "access-control-allow-headers": "content-type",
  "cache-control": "no-store",
} as const;

export const Route = createFileRoute("/api/public/predictions/latest")({
  server: {
    handlers: {
      OPTIONS: async () => new Response(null, { status: 204, headers: CORS }),
      GET: async () => {
        const sb = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_PUBLISHABLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        const { data, error } = await sb
          .from("predictions")
          .select(
            "model_version, api_model_id, candle_ts, prediction, confidence, btc_price_at_prediction, setup_type, market_condition, reasoning_summary, status, actual_next_candle_close, created_at, resolved_at",
          )
          .order("candle_ts", { ascending: false })
          .limit(1)
          .maybeSingle();
        if (error) {
          return new Response(JSON.stringify({ error: error.message }), {
            status: 500,
            headers: { "content-type": "application/json", ...CORS },
          });
        }
        return new Response(
          JSON.stringify(data ? buildPredictionPayload(data) : { prediction: null }),
          { headers: { "content-type": "application/json", ...CORS } },
        );
      },
    },
  },
});
