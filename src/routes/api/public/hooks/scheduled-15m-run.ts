import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { fetchAndUpsertOkxCandles } from "@/lib/okx.server";
import { resolvePredictionsServer, runAiPredictionServer } from "@/lib/prediction.server";

// Public cron endpoint hit by pg_cron every 15 minutes.
// Auth: requires the project's anon key in the `apikey` header (pg_cron convention).
export const Route = createFileRoute("/api/public/hooks/scheduled-15m-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const supabase = createClient(
          process.env.SUPABASE_URL!,
          // service-role key bypasses RLS for the unattended job
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        // Phase controls what runs. "predict" = pre-close (fetch + predict).
        // "resolve" = post-close (fetch + resolve only). Defaults to running both.
        let phase: "predict" | "resolve" | "both" = "both";
        try {
          const body = (await request.json()) as { phase?: string } | null;
          if (body?.phase === "predict" || body?.phase === "resolve") phase = body.phase;
        } catch {
          // empty body is fine
        }

        const results: Record<string, unknown> = { phase };
        if (phase === "predict" || phase === "both") {
          try {
            const candles = await fetchAndUpsertOkxCandles(supabase);
            results.candles_count = candles.length;
          } catch (e) {
            results.fetch_error = e instanceof Error ? e.message : String(e);
          }
        }

        if (phase === "resolve" || phase === "both") {
          try {
            const resolved = await resolvePredictionsServer(supabase);
            results.resolved = resolved;
          } catch (e) {
            results.resolve_error = e instanceof Error ? e.message : String(e);
          }
        }

        if (phase === "predict" || phase === "both") {
          try {
            const { data: settings } = await supabase
              .from("model_settings")
              .select("auto_run_enabled")
              .eq("is_active", true)
              .maybeSingle();
            if (settings?.auto_run_enabled) {
              const prediction = await runAiPredictionServer(supabase);
              results.prediction_id = prediction.id;
            } else {
              results.auto_run_skipped = true;
            }
          } catch (e) {
            results.predict_error = e instanceof Error ? e.message : String(e);
          }
        }


        return new Response(JSON.stringify(results), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
