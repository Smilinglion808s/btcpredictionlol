// T10 Bridge R1 — boundary decision hook.
//
// The collector fires this the instant the finalized offset-9 bar is stored;
// cron/apikey calls exist only as a late watchdog. T10 is shadow-only until
// its activation row is switched, so this endpoint never emits a webhook and
// never touches T30, T45, ES1 or any other model's tables.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import {
  resolveT10,
  runT10Boundary,
  type T10RunMode,
  type T10TriggerKind,
} from "@/lib/t10/orchestrator.server";
import { T10_CUTOFF_OFFSET_MS, TF_MS, floorTarget } from "@/lib/t10/config";
import { verifyT10Signature } from "@/lib/t10/signingSecret.server";

/** Never sit longer than this waiting for the T+10s cutoff. */
const MAX_WAIT_MS = 15_000;
/** How late `mode=recover` may still write the current candle's row. */
const RECOVER_WINDOW_MS = 10 * 60_000;
const MAX_SKEW_MS = 5 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function verifySigned(raw: string, timestamp: string | null, signature: string | null): boolean {
  return verifyT10Signature(raw, timestamp, signature, MAX_SKEW_MS);
}

export const Route = createFileRoute("/api/public/hooks/t10-boundary-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const started = Date.now();
        const raw = await request.text();
        const signed = verifySigned(
          raw,
          request.headers.get("x-t10-timestamp"),
          request.headers.get("x-t10-signature"),
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

        let targetMs: number;
        let trigger: T10TriggerKind = "IMMEDIATE_BOUNDARY";
        let runMode: T10RunMode = "LIVE";
        if (explicit) {
          targetMs = new Date(explicit).getTime();
          // The collector names the candle it just sealed. When that is the
          // candle currently in flight and we are still inside the cutoff
          // window, this IS the live boundary run, not a watchdog catch-up.
          const liveNow =
            targetMs === currentTarget && now - targetMs < T10_CUTOFF_OFFSET_MS + MAX_WAIT_MS;
          if (!liveNow) {
            trigger = "WATCHDOG";
            runMode = "CATCHUP";
          }
        } else if (age < T10_CUTOFF_OFFSET_MS + MAX_WAIT_MS) {

          targetMs = currentTarget;
        } else if (mode === "recover" && age < RECOVER_WINDOW_MS) {
          targetMs = currentTarget;
          trigger = "WATCHDOG";
          runMode = "CATCHUP";
        } else {
          targetMs = currentTarget - TF_MS;
          trigger = "WATCHDOG";
          runMode = "CATCHUP";
        }

        // Wait out the T+10s cutoff if we arrived early; the packet must be
        // complete before the head may score anything.
        const wait = Math.min(MAX_WAIT_MS, targetMs + T10_CUTOFF_OFFSET_MS - Date.now());
        if (wait > 0) await sleep(wait);

        let decision;
        try {
          decision = await runT10Boundary(supabase, new Date(targetMs).toISOString(), {
            runMode,
            trigger,
          });
        } catch (e) {
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }

        let resolved = 0;
        try {
          resolved = await resolveT10(supabase);
        } catch {
          /* resolution is best-effort and never blocks the decision */
        }

        return Response.json({
          ok: true,
          decision,
          resolved,
          elapsed_ms: Date.now() - started,
        });
      },
    },
  },
});
