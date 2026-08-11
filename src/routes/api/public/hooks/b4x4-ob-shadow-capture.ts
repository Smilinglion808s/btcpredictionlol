// Pre-boundary OKX order-book shadow capture for B4x4 (shadow only).
// Called by pg_cron a few seconds before each 15-minute boundary.
// Never influences B4x4 predictions, coverage or webhooks.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import {
  captureB4x4PreBoundarySnapshot,
  nextTargetBoundaryMs,
} from "@/lib/b4x4/shadow/collector.server";

/** Replay window for signed cron calls. */
const SIGNATURE_MAX_AGE_MS = 120_000;

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return timingSafeEqual(ab, bb);
}

/**
 * Verify the HMAC produced by public.b4x4_ob_capture_call():
 *   signature = hex(hmac_sha256(`${timestampMs}.${targetIso}`, secret))
 * The target boundary is derived independently here; the caller's boundary may
 * differ by one interval if the call straddles a boundary, so both are tried.
 */
function verifySignedCron(request: Request, secret: string, nowMs: number): boolean {
  const ts = request.headers.get("x-b4x4-timestamp");
  const sig = request.headers.get("x-b4x4-signature");
  if (!ts || !sig) return false;
  const tsMs = Number(ts);
  if (!Number.isFinite(tsMs)) return false;
  if (Math.abs(nowMs - tsMs) > SIGNATURE_MAX_AGE_MS) return false;
  const boundary = nextTargetBoundaryMs(tsMs);
  for (const candidate of [boundary, boundary - 900_000, boundary + 900_000]) {
    const iso = new Date(candidate).toISOString();
    const expected = createHmac("sha256", secret).update(`${ts}.${iso}`).digest("hex");
    if (safeEqual(sig, expected)) return true;
  }
  return false;
}

export const Route = createFileRoute("/api/public/hooks/b4x4-ob-shadow-capture")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const now = Date.now();
        const secret = process.env["B4X4_OB_CAPTURE_SECRET"];
        const apikey = request.headers.get("apikey");
        const expectedKey = process.env["SUPABASE_PUBLISHABLE_KEY"];
        const authorized =
          (!!secret && verifySignedCron(request, secret, now)) ||
          (!!expectedKey && !!apikey && safeEqual(apikey, expectedKey));
        if (!authorized) {
          return new Response("Unauthorized", { status: 401 });
        }
        try {
          const supabase = createClient(
            process.env["SUPABASE_URL"]!,
            process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
            { auth: { persistSession: false, autoRefreshToken: false } },
          );
          const targetMs = nextTargetBoundaryMs(now);
          const res = await captureB4x4PreBoundarySnapshot(supabase, targetMs);
          return Response.json({ ok: true, ms_before_boundary: targetMs - now, ...res });
        } catch (e) {
          return Response.json(
            { ok: false, error: e instanceof Error ? e.message : String(e) },
            { status: 200 },
          );
        }
      },
    },
  },
});
