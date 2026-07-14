// Pre-warm Model 7 B2/B4.2 inputs shortly before the next 15m boundary.
// Called by pg_cron near the top of each 15m minute (~2-5s before boundary).
// Never scores. Only caches inputs that are already knowable pre-boundary.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { nextBoundaryMs, warmForBoundary, warmCacheSize } from "@/lib/model7/warmCache";

export const Route = createFileRoute("/api/public/hooks/prewarm-b4_2")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const apikey = request.headers.get("apikey");
        const expected = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const supabase = createClient(
            process.env.SUPABASE_URL!,
            process.env.SUPABASE_SERVICE_ROLE_KEY!,
            { auth: { persistSession: false, autoRefreshToken: false } },
          );
          const now = Date.now();
          const targetMs = nextBoundaryMs(now);
          const msBefore = targetMs - now;
          const entry = await warmForBoundary(supabase, targetMs);
          return Response.json({
            ok: true,
            target: new Date(targetMs).toISOString(),
            ms_before_boundary: msBefore,
            history_rows: entry.history.length,
            variant_b_fit: entry.variantBFitReason,
            cache_size: warmCacheSize(),
          });
        } catch (e) {
          // Fail-open: never break the schedule if pre-warm fails.
          return Response.json({
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          }, { status: 200 });
        }
      },
    },
  },
});
