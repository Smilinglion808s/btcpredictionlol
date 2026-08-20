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
import { createHmac, timingSafeEqual } from "crypto";
import { runT45Boundary, resolveT45Backlog, t45TargetFor } from "@/lib/t45/orchestrator.server";
import {
  runPriceFlowBoundary,
  resolvePriceFlowBacklog,
} from "@/lib/t45pf/orchestrator.server";
import { T45_CUTOFF_OFFSET_MS, T45_PUBLISH_DEADLINE_MS, TF_MS } from "@/lib/t45/config";

/** Never sit longer than this waiting for the T+45s cutoff. */
const MAX_WAIT_MS = 50_000;
/** How late `mode=recover` may still write the current candle's row. */
const RECOVER_WINDOW_MS = 10 * 60_000;
const MAX_SKEW_MS = 5 * 60 * 1000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * The always-on collector is the primary trigger: it fires this hook the moment
 * the finalized offset-44 one-second bar is persisted. Cloudflare cron timing is
 * not precise enough to be relied on for a T+45s cutoff, so cron/manual calls
 * (apikey auth) exist only as a late watchdog.
 */
function verifySigned(raw: string, timestamp: string | null, signature: string | null): boolean {
  const secret = process.env['T45_INGEST_SECRET'] ?? process.env['BINANCE_OB_INGEST_SECRET'];
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/hooks/t45-boundary-run")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const started = Date.now();
        const raw = await request.text();
        const signed = verifySigned(
          raw,
          request.headers.get("x-t45-timestamp"),
          request.headers.get("x-t45-signature"),
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
          url.searchParams.get("target") ??
          (typeof payload.target_ts === "string" ? payload.target_ts : null);

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
