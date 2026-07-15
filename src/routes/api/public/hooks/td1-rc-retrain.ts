// Manual/scheduled TD1-RC retrain trigger. Auth = anon key in `apikey` header.
// Body: { force?: boolean } — force runs training even if cadence unmet.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/public/hooks/td1-rc-retrain")({
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
        const body = (await request.json().catch(() => ({}))) as { force?: boolean };
        const { maybeRetrainTd1, trainAndPromoteTd1 } = await import("@/lib/model7/td1/retrain");
        const result = body.force
          ? await trainAndPromoteTd1(supabase)
          : await maybeRetrainTd1(supabase);
        return Response.json({ ok: true, result });
      },
    },
  },
});
