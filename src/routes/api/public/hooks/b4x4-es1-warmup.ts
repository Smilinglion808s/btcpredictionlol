import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

// Ops endpoint: train every B4x4-ES1 fit block, backfill missing historical
// rows and resolve outstanding outcomes. Warmup rows are never webhook-eligible.
// Auth: requires the project's publishable key in the `apikey` header.
export const Route = createFileRoute("/api/public/hooks/b4x4-es1-warmup")({
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
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );
        try {
          const { ensureEs1Warm } = await import("@/lib/b4x4es1/orchestrator.server");
          const out = await ensureEs1Warm(supabase, { schedulerInvocationId: "manual-warmup" });
          return new Response(JSON.stringify(out), {
            headers: { "content-type": "application/json" },
          });
        } catch (e) {
          return new Response(
            JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }
      },
    },
  },
});
