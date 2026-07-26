import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { fetchAndUpsertCandles } from "@/lib/okx.server";
import { resolvePredictionsServer, runAiPredictionServer } from "@/lib/prediction.server";
import { waitForBtc15mPredictionWindow } from "@/lib/timing.server";

// Public cron endpoint hit by pg_cron every 15 minutes.
// Auth: requires the project's anon key in the `apikey` header (pg_cron convention).
export const Route = createFileRoute("/api/public/hooks/scheduled-15m-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const overallStart = Date.now();
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
        let watch = false;
        let align = false;
        try {
          const body = (await request.json()) as { phase?: string; watch?: boolean; align?: boolean } | null;
          if (body?.phase === "predict" || body?.phase === "resolve") phase = body.phase;
          watch = body?.watch === true;
          align = body?.align === true;
        } catch {
          // empty body is fine
        }

        const results: Record<string, unknown> = { phase };
        const timings: Record<string, number> = {};

        if (align && (phase === "predict" || phase === "both")) {
          const t0 = Date.now();
          try {
            const timing = await waitForBtc15mPredictionWindow();
            results.exchange_timing = {
              server_now_ms: timing.serverNowMs,
              next_close_ms: timing.nextCloseMs,
              next_prediction_ms: timing.nextPredictionMs,
              time_source: timing.timeSource,
              close_source: timing.closeSource,
              kalshi_ticker: timing.kalshiTicker,
            };
          } catch (e) {
            results.exchange_timing_error = e instanceof Error ? e.message : String(e);
          }
          timings.align_ms = Date.now() - t0;
        }

        if (phase === "predict" || phase === "both" || phase === "resolve") {
          const t0 = Date.now();
          try {
            const fetched = await fetchAndUpsertCandles(supabase);
            results.candles_count = fetched.candles.length;
            results.fetch_primary_source = fetched.primary_source;
            results.fetch_attempts = fetched.attempts;
          } catch (e) {
            results.fetch_error = e instanceof Error ? e.message : String(e);
          }
          timings.fetch_ms = Date.now() - t0;
        }

        if (phase === "resolve" || phase === "both") {
          const t0 = Date.now();
          try {
            const resolved = await resolvePredictionsServer(supabase, {
              watchMs: watch ? 55_000 : 0,
              pollMs: 3_000,
            });
            results.resolved = resolved;
          } catch (e) {
            results.resolve_error = e instanceof Error ? e.message : String(e);
          }
          timings.resolve_ms = Date.now() - t0;
        }

        if (phase === "predict" || phase === "both") {
          const t0 = Date.now();
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
          timings.predict_ms = Date.now() - t0;
        }

        // Model 3 FWD (model8_v3) — invoked directly by the scheduler in its
        // own try/catch so it cannot be gated by (or take down) any peer model.
        // Runs AFTER the resolve phase so the just-closed prior candle is
        // finalized in the local candle store.
        if (phase === "predict" || phase === "both" || phase === "resolve") {
          const t0 = Date.now();
          try {
            const { runModel8V3 } = await import("@/lib/model8_v3/orchestrator");
            const m8 = await runModel8V3(supabase);
            results.model8_v3 = m8;
          } catch (e) {
            results.model8_v3_error = e instanceof Error ? e.message : String(e);
          }
          timings.model8_v3_ms = Date.now() - t0;

        }

        timings.total_ms = Date.now() - overallStart;
        results.timings = timings;

        return new Response(JSON.stringify(results), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});

