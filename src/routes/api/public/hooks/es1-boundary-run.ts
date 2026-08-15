import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const TF_MS = 15 * 60 * 1000;
/** How far into a candle we still consider ourselves "at" its boundary. */
const FRESH_WINDOW_MS = 60_000;
/** Longest we are willing to sit and wait for a future boundary to arrive. */
const MAX_WAIT_FOR_BOUNDARY_MS = 120_000;


/**
 * B4x4-ES1 live boundary run.
 *
 * ES1 is a source-candle model: its feature row for target candle T is built
 * from the fully closed candle T-15m. Running it in the pre-boundary pass
 * (boundary - 40s) therefore could never see the candle it needs, so ES1 was
 * always one candle behind — it published for the candle that had already
 * started 15 minutes earlier.
 *
 * This endpoint is invoked one minute before the boundary so its server worker
 * is already warm. It waits for the boundary and the just-closed source candle,
 * then predicts the candle that is opening right now.
 *
 * Auth: requires the project's publishable key in the `apikey` header.
 */
export const Route = createFileRoute("/api/public/hooks/es1-boundary-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const started = Date.now();
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        const supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        const now = Date.now();
        // Target must always be an UPCOMING candle — the one that is opening
        // right now (cron fires on the boundary) or, if we fired early/late,
        // the next boundary. We never publish for a candle that is already
        // meaningfully underway.
        const floor = Math.floor(now / TF_MS) * TF_MS;
        const intoCandle = now - floor; // ms elapsed since the current candle opened
        const targetMs =
          intoCandle <= FRESH_WINDOW_MS
            ? floor // fired on the boundary: predict the candle just opening
            : floor + TF_MS; // fired early or late: predict the next boundary
        const targetTs = new Date(targetMs).toISOString();
        const sourceTs = new Date(targetMs - TF_MS).toISOString();

        const out: Record<string, unknown> = {
          target_candle_ts: targetTs,
          source_candle_ts: sourceTs,
          ms_into_target_candle: Math.max(0, now - targetMs),
        };


        if (targetMs - now > MAX_WAIT_FOR_BOUNDARY_MS) {
          out.skipped = "no boundary due — next scheduled run owns this candle";
          out.elapsed_ms = Date.now() - started;
          return new Response(JSON.stringify(out), {
            headers: { "content-type": "application/json" },
          });
        }

        try {
          const { fetchAndUpsertCandles } = await import("@/lib/okx.server");
          const { runEs1ForTarget, maybeSendEs1Webhook } = await import(
            "@/lib/b4x4es1/orchestrator.server"
          );



          // Wait for the source candle to be closed and ingested. Bounded so
          // this endpoint can never outlive its own 15-minute slot.
          //
          // Fetch once just after the boundary before replaying. Scoring first
          // used to trigger an internal fetch/replay and then repeat the same
          // work here, adding several seconds under exchange rate limiting.
          let row = null as Awaited<ReturnType<typeof runEs1ForTarget>>;
          for (let attempt = 0; attempt < 4 && !row; attempt++) {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 1_500));
            // OKX can take about two seconds to mark the source candle final.
            // Waiting here preserves the exact closed-candle input while
            // avoiding a guaranteed unconfirmed response at +800ms.
            if (Date.now() < targetMs + 2_100) {
              await new Promise((r) => setTimeout(r, targetMs + 2_100 - Date.now()));
            }
            try {
              await fetchAndUpsertCandles(supabase);
            } catch {
              /* retryable */
            }
            row = await runEs1ForTarget(supabase, {
              targetCandleTs: targetTs,
              runMode: "LIVE",
              recoverMissingSource: false,
            });
            out.attempts = attempt + 1;
          }

          if (row) {
            out.row_id = row.id;
            out.final_prediction = row.final_prediction;
            out.would_trade = row.would_trade;
            out.webhook_sent = await maybeSendEs1Webhook(supabase, row);
          } else {
            out.error = "source candle unavailable";
          }
        } catch (e) {
          out.error = e instanceof Error ? e.message : String(e);
        }

        out.elapsed_ms = Date.now() - started;
        return new Response(JSON.stringify(out), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
