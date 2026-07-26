// One-shot bootstrap for Model 3 FWD: trains an initial ACTIVE fit from
// existing OKX BTC-USDT 15m history so the model can begin predicting on the
// next cron tick without waiting for a candidate to be manually approved.
//
// GET or POST /api/public/hooks/model8-v3-bootstrap
// Idempotent: if an active fit already exists it returns it unchanged.

import { createFileRoute } from "@tanstack/react-router";

async function handler() {
  try {
    const { createClient } = await import("@supabase/supabase-js");
    const sb = createClient(
      process.env.SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );

    const { data: active } = await sb
      .from("model8_v3_fits")
      .select("fit_id, status, activated_at")
      .eq("status", "active")
      .order("activated_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (active) {
      return new Response(JSON.stringify({ ok: true, already_active: active }, null, 2), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { bootstrapModel8V3ActiveFit } = await import("@/lib/model8_v3/orchestrator");
    const result = await bootstrapModel8V3ActiveFit(sb);
    return new Response(JSON.stringify(result, null, 2), {
      status: result.ok ? 200 : 400,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(
      JSON.stringify({ ok: false, error: e instanceof Error ? e.message : String(e) }, null, 2),
      { status: 500, headers: { "Content-Type": "application/json" } },
    );
  }
}

export const Route = createFileRoute("/api/public/hooks/model8-v3-bootstrap")({
  server: { handlers: { GET: handler, POST: handler } },
});
