// T45 Balanced — boundary decision hook.
//
// T45 predicts the candle it is already inside: it observes offsets 0..44 of
// the target candle and must publish before T+60s. The scheduler therefore
// fires shortly after each 15-minute boundary; the handler waits for T+45s if
// it arrived early, then decides.
//
// Shadow-only: this hook can never emit a webhook and never touches any other
// model's tables.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { runT45Boundary, resolveT45Backlog, t45TargetFor } from "@/lib/t45/orchestrator.server";
import { T45_CUTOFF_OFFSET_MS, T45_PUBLISH_DEADLINE_MS, TF_MS } from "@/lib/t45/config";

/** Never sit longer than this waiting for the T+45s cutoff. */
const MAX_WAIT_MS = 50_000;
/** How late `mode=recover` may still write the current candle's row. */
const RECOVER_WINDOW_MS = 10 * 60_000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export const Route = createFileRoute("/api/public/hooks/t45-boundary-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const started = Date.now();
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

        const url = new URL(request.url);
        const mode = url.searchParams.get("mode") ?? "auto";
        const explicit = url.searchParams.get("target");

        if (mode === "resolve") {
          const res = await resolveT45Backlog(supabase, { limit: 500 });
          return Response.json({ ok: true, mode, ...res, elapsed_ms: Date.now() - started });
        }

        const now = Date.now();
        const { targetTs, intoCandleMs } = t45TargetFor(now);
        const target = explicit ? new Date(explicit).toISOString() : targetTs;
        const targetMs = new Date(target).getTime();
        if (!Number.isFinite(targetMs) || targetMs % TF_MS !== 0) {
          return Response.json({ ok: false, error: "TARGET_NOT_BOUNDARY" }, { status: 400 });
        }

        // Arrived before the cutoff: wait for T+45s, but never past the deadline.
        if (!explicit && intoCandleMs < T45_CUTOFF_OFFSET_MS) {
          const wait = T45_CUTOFF_OFFSET_MS - intoCandleMs;
          if (wait > MAX_WAIT_MS) {
            return Response.json({
              ok: true,
              mode,
              skipped: "TOO_EARLY",
              target_ts: target,
              into_candle_ms: intoCandleMs,
            });
          }
          await sleep(wait + 250);
        }

        const late = Date.now() - targetMs;
        const allowLate = mode === "recover" && late < RECOVER_WINDOW_MS;
        if (!allowLate && late >= T45_PUBLISH_DEADLINE_MS) {
          return Response.json({
            ok: false,
            mode,
            target_ts: target,
            error: "PUBLISH_DEADLINE_MISSED",
            into_candle_ms: late,
          });
        }

        const result = await runT45Boundary(supabase, target, { allowLate });
        const resolved = await resolveT45Backlog(supabase, { limit: 200 });

        return Response.json({
          ok: true,
          mode,
          ...result,
          resolved: resolved.resolved,
          elapsed_ms: Date.now() - started,
        });
      },
    },
  },
});
