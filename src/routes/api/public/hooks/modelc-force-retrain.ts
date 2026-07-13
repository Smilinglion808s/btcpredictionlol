// Manual Model C retrain trigger. Auth = anon key in `apikey` header.
// Derives the training model version from the most-recent clean-labeled
// prediction (NOT from `model_settings`, which stores unrelated labels).

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";

export const Route = createFileRoute("/api/public/hooks/modelc-force-retrain")({
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
        const body = (await request.json().catch(() => ({}))) as {
          model_version?: string;
        };
        let modelVersion = body.model_version ?? null;
        if (!modelVersion) {
          const { data } = await supabase
            .from("predictions")
            .select("model_version")
            .in("actual_direction", ["GREEN", "RED"])
            .order("candle_ts", { ascending: false })
            .limit(1)
            .maybeSingle();
          modelVersion = (data as { model_version?: string } | null)?.model_version ?? null;
        }
        if (!modelVersion) {
          return Response.json({ ok: false, reason: "no_model_version_found" }, { status: 400 });
        }
        const { trainModelC } = await import("@/lib/modelc/trainer");
        const result = await trainModelC(supabase, modelVersion);
        return Response.json({ ok: true, model_version: modelVersion, result });
      },
    },
  },
});
