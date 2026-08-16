// B4x4-ES1 Binance Order-Book R1 — boundary finalization + shadow resolution.
//
// Called by pg_cron a couple of minutes after each 15m boundary. Idempotent.

import { createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/api/public/hooks/binance-ob-finalize")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const started = Date.now();
        const apikey = request.headers.get("apikey");
        const expected = process.env['SUPABASE_PUBLISHABLE_KEY'];
        if (!expected || apikey !== expected) {
          return new Response("Unauthorized", { status: 401 });
        }

        const { createClient } = await import("@supabase/supabase-js");
        const sb = createClient(
          process.env['SUPABASE_URL']!,
          process.env['SUPABASE_SERVICE_ROLE_KEY']!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        const out: Record<string, unknown> = {};
        try {
          const { floorTarget } = await import("@/lib/b4x4es1/binanceOb/config");
          const { finalizeBinanceObTarget, backfillBinanceObTargets, binanceObHealth } =
            await import("@/lib/b4x4es1/binanceOb/orchestrator.server");
          const { resolveBinanceObShadows } = await import(
            "@/lib/b4x4es1/binanceOb/resolver.server"
          );

          const { runBinanceObWatchdog } = await import(
            "@/lib/b4x4es1/binanceOb/watchdog.server"
          );

          const current = new Date(floorTarget(Date.now())).toISOString();
          out.finalized = await finalizeBinanceObTarget(sb, current);
          out.backfilled = await backfillBinanceObTargets(sb, 32);
          // Watchdog runs after finalization so a genuinely missing boundary —
          // and only a missing one — is recorded as an explicit failure row.
          out.watchdog = await runBinanceObWatchdog(sb, 8);
          out.resolved = await resolveBinanceObShadows(sb);
          out.health = await binanceObHealth(sb);
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
