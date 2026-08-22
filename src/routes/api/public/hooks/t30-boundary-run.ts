// T30 PriceFlow Balanced — boundary decision hook.
//
// T30 predicts the candle it is already inside from offsets 0..29, so the
// collector fires this hook the instant the finalized offset-29 bar is stored.
// Cron/apikey calls exist only as a late watchdog.
//
// Shadow-only: this hook never emits a webhook and never touches T45 or any
// other model's tables.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import { resolveT30, runT30Boundary, type T30TriggerKind } from "@/lib/t30/orchestrator.server";
import { T30_CUTOFF_OFFSET_MS, TF_MS, floorTarget } from "@/lib/t30/config";
import { auditT30 } from "@/lib/t30/store.server";

/** Never sit longer than this waiting for the T+30s cutoff. */
const MAX_WAIT_MS = 35_000;
/** How late `mode=recover` may still write the current candle's row. */
const RECOVER_WINDOW_MS = 10 * 60_000;
const MAX_SKEW_MS = 5 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function verifySigned(raw: string, timestamp: string | null, signature: string | null): boolean {
  const secret = process.env['T30_INGEST_SECRET'] ?? process.env['BINANCE_OB_INGEST_SECRET'];
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/hooks/t30-boundary-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const started = Date.now();
        const raw = await request.text();
        const signed = verifySigned(
          raw,
          request.headers.get("x-t30-timestamp"),
          request.headers.get("x-t30-signature"),
        );
        const apikey = request.headers.get("apikey");
        const expectedKey = process.env.SUPABASE_PUBLISHABLE_KEY;
        if (!signed && (!expectedKey || apikey !== expectedKey)) {
          return new Response("Unauthorized", { status: 401 });
        }

        const supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        let payload: Record<string, unknown> = {};
        if (raw) {
          try {
            payload = JSON.parse(raw) as Record<string, unknown>;
          } catch {
            payload = {};
          }
        }

        const url = new URL(request.url);
        const mode = url.searchParams.get("mode") ?? String(payload.mode ?? "auto");
        const explicit =
          url.searchParams.get("target") ?? (payload.target_ts as string | undefined) ?? null;

        const now = Date.now();
        const currentTarget = floorTarget(now);
        const age = now - currentTarget;

        // Choose the boundary this invocation owns.
        let targetMs: number;
        let trigger: T30TriggerKind = "IMMEDIATE_BOUNDARY";
        if (explicit) {
          targetMs = new Date(explicit).getTime();
          trigger = "MANUAL";
        } else if (age < T30_CUTOFF_OFFSET_MS + MAX_WAIT_MS) {
          targetMs = currentTarget;
        } else if (mode === "recover" && age < RECOVER_WINDOW_MS) {
          targetMs = currentTarget;
          trigger = "CATCHUP";
        } else {
          targetMs = currentTarget - TF_MS;
          trigger = "CATCHUP";
        }

        // Wait out the cutoff if we arrived early; the packet must be complete.
        const cutoffAt = targetMs + T30_CUTOFF_OFFSET_MS;
        const wait = Math.min(MAX_WAIT_MS, cutoffAt - Date.now());
        if (wait > 0) await sleep(wait);

        let decision;
        try {
          decision = await runT30Boundary(supabase, {
            targetTs: new Date(targetMs).toISOString(),
            triggerKind: trigger,
          });
        } catch (e) {
          await auditT30(supabase, "boundary-error", { error: String(e) }, false);
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }

        let resolution = { examined: 0, resolved: 0 };
        try {
          resolution = await resolveT30(supabase, { limit: 100 });
        } catch (e) {
          await auditT30(supabase, "resolve-error", { error: String(e) }, false);
        }

        return Response.json({
          ok: true,
          decision,
          resolution,
          elapsed_ms: Date.now() - started,
        });
      },
    },
  },
});
