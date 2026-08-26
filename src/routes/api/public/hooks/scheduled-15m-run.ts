import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { setB4x4RequestHost } from "@/lib/b4x4/build-identity";
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
        setB4x4RequestHost(request.headers.get("host"));
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
        // Boundary target locked before the pre-close wait, so a slow run can
        // never silently retarget the following candle.
        let lockedTiming: Awaited<ReturnType<typeof waitForBtc15mPredictionWindow>> | null = null;
        const timings: Record<string, number> = {};

        if (align && (phase === "predict" || phase === "both")) {
          const t0 = Date.now();
          try {
            const timing = await waitForBtc15mPredictionWindow();
            lockedTiming = timing;
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

          // Refresh the shadow-only B4x4 order-book snapshot inside the actual
          // prediction window. The earlier pre-warm capture remains a fallback,
          // while this pass normally supplies a much fresher pre-boundary book.
          const obStart = Date.now();
          try {
            const { captureB4x4PreBoundarySnapshot, nextTargetBoundaryMs } = await import(
              "@/lib/b4x4/shadow/collector.server"
            );
            results.b4x4_ob_shadow = await captureB4x4PreBoundarySnapshot(
              supabase,
              nextTargetBoundaryMs(Date.now()),
            );
          } catch (e) {
            results.b4x4_ob_shadow_error = e instanceof Error ? e.message : String(e);
          }
          timings.b4x4_ob_shadow_ms = Date.now() - obStart;
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

          // B4x4 watchdog: fill any target that never produced a row.
          const cuStart = Date.now();
          try {
            const { catchUpMissingB4x4Rows } = await import("@/lib/b4x4/orchestrator");
            results.b4x4_catchup = await catchUpMissingB4x4Rows(supabase, {
              schedulerInvocationId: `cron-${overallStart}`,
            });
          } catch (e) {
            results.b4x4_catchup_error = e instanceof Error ? e.message : String(e);
          }
          timings.b4x4_catchup_ms = Date.now() - cuStart;

          // B4x4-ES1 retired: no warm, no catch-up, no resolution passes.


          // Straggler sweep: close out downstream rows (V6 / B4x4 / TD*) whose
          // base prediction never resolved or resolved as a PUSH.
          const swStart = Date.now();
          try {
            const { sweepUnresolvedRows } = await import("@/lib/resolutionSweeper.server");
            results.resolution_sweep = await sweepUnresolvedRows(supabase);
          } catch (e) {
            results.resolution_sweep_error = e instanceof Error ? e.message : String(e);
          }
          timings.resolution_sweep_ms = Date.now() - swStart;
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
              const prediction = await runAiPredictionServer(supabase, {
                timing: lockedTiming ?? undefined,
              });
              results.prediction_id = prediction.id;
            } else {
              results.auto_run_skipped = true;
            }
          } catch (e) {
            results.predict_error = e instanceof Error ? e.message : String(e);
          }
          timings.predict_ms = Date.now() - t0;
        }

        // Model 3 FWD (model8_v3) — no longer invoked from the cron. It now
        // runs inline in shadow.ts alongside a96/aas96 off the shared
        // prediction row, so target-candle derivation and logging match the
        // other shadow models exactly.

        timings.total_ms = Date.now() - overallStart;
        results.timings = timings;

        return new Response(JSON.stringify(results), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});

