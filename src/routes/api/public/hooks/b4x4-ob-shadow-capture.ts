// Pre-boundary OKX order-book shadow capture for B4x4 (shadow only).
// Called by pg_cron a few seconds before each 15-minute boundary.
// Never influences B4x4 predictions, coverage or webhooks.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import {
  captureB4x4PreBoundarySnapshot,
  nextTargetBoundaryMs,
} from "@/lib/b4x4/shadow/collector.server";

export const Route = createFileRoute("/api/public/hooks/b4x4-ob-shadow-capture")({
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
          const targetMs = nextTargetBoundaryMs(now);
          const res = await captureB4x4PreBoundarySnapshot(supabase, targetMs);
          return Response.json({ ok: true, ms_before_boundary: targetMs - now, ...res });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
    },
  },
});
