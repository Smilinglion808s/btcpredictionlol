import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

const TF_MS = 15 * 60 * 1000;

/**
 * B4x4-ES1 live boundary run.
 *
 * ES1 is a source-candle model: its feature row for target candle T is built
 * from the fully closed candle T-15m. Running it in the pre-boundary pass
 * (boundary - 40s) therefore could never see the candle it needs, so ES1 was
 * always one candle behind — it published for the candle that had already
 * started 15 minutes earlier.
 *
 * This endpoint fires ON the boundary (pg_cron at :00,:15,:30,:45). It waits
 * for the just-closed source candle to land, then predicts the candle that is
 * opening right now.
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
        // Target = the candle currently opening. If the cron fires a hair
        // early, snap forward to the boundary that is at most 20s away.
        const floor = Math.floor(now / TF_MS) * TF_MS;
        const targetMs = floor + TF_MS - now <= 20_000 ? floor + TF_MS : floor;
        const targetTs = new Date(targetMs).toISOString();
        const sourceTs = new Date(targetMs - TF_MS).toISOString();

        const out: Record<string, unknown> = { target_candle_ts: targetTs, source_candle_ts: sourceTs };

        try {
          const { fetchAndUpsertCandles } = await import("@/lib/okx.server");
          const { runEs1ForTarget, maybeSendEs1Webhook } = await import(
            "@/lib/b4x4es1/orchestrator.server"
          );

          // Wait for the source candle to be closed and ingested. Bounded so
          // this endpoint can never outlive its own 15-minute slot.
          let row = null as Awaited<ReturnType<typeof runEs1ForTarget>>;
          for (let attempt = 0; attempt < 6 && !row; attempt++) {
            if (attempt > 0) await new Promise((r) => setTimeout(r, 4_000));
            if (Date.now() < targetMs + 1_500) {
              await new Promise((r) => setTimeout(r, targetMs + 1_500 - Date.now()));
            }
            try {
              await fetchAndUpsertCandles(supabase);
            } catch {
              /* retryable */
            }
            row = await runEs1ForTarget(supabase, { targetCandleTs: targetTs, runMode: "LIVE" });
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
