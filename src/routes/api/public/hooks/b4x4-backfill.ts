import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { runB4x4Backfill } from "@/lib/b4x4/backfill";

// Admin/ops endpoint: chronological B4x4 historical backfill.
// Auth: requires the project's publishable key in the `apikey` header.
// Backfilled rows are written with run_mode=BACKFILL and can never webhook.
export const Route = createFileRoute("/api/public/hooks/b4x4-backfill")({
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
        let upTo: string | undefined;
        let persist = true;
        try {
          const body = (await request.json()) as { up_to?: string; persist?: boolean } | null;
          if (body?.up_to) upTo = body.up_to;
          if (body?.persist === false) persist = false;
        } catch { /* empty body is fine */ }

        try {
          const out = await runB4x4Backfill(supabase, { upTo, persist });
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
