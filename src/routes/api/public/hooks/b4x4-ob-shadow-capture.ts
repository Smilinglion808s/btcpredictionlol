// Pre-boundary OKX order-book shadow capture for B4x4 (shadow only).
// Called by pg_cron shortly before each 15-minute boundary.
// Never influences B4x4 predictions, coverage or webhooks.
//
// Auth: HMAC-SHA256 over "<timestamp>.<target_iso>" using the shared capture
// secret, plus a replay guard. The 15-minute target is derived server-side —
// callers may never supply an arbitrary historical or future target.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import {
  captureB4x4PreBoundarySnapshot,
  nextTargetBoundaryMs,
} from "@/lib/b4x4/shadow/collector.server";

const MAX_SKEW_MS = 120_000;
/** In-process replay guard: a signature may be presented at most once. */
const seen = new Map<string, number>();

function replayed(sig: string, nowMs: number): boolean {
  for (const [k, t] of seen) if (nowMs - t > MAX_SKEW_MS * 2) seen.delete(k);
  if (seen.has(sig)) return true;
  seen.set(sig, nowMs);
  return false;
}

async function loadSecret(supabase: { from: (t: string) => any }): Promise<string | null> {
  const env = process.env["B4X4_OB_CAPTURE_SECRET"];
  const { data } = await supabase
    .from("b4x4_ob_capture_auth")
    .select("secret")
    .eq("name", "cron")
    .maybeSingle();
  const dbSecret = (data as { secret?: string } | null)?.secret ?? null;
  return dbSecret || env || null;
}

function validSignature(secret: string, payload: string, provided: string): boolean {
  const expected = createHmac("sha256", secret).update(payload).digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(provided.trim().toLowerCase(), "utf8");
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/hooks/b4x4-ob-shadow-capture")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        try {
          const supabase = createClient(
            process.env["SUPABASE_URL"]!,
            process.env["SUPABASE_SERVICE_ROLE_KEY"]!,
            { auth: { persistSession: false, autoRefreshToken: false } },
          );

          const now = Date.now();
          // Server-derived canonical target. Caller input is ignored.
          const targetMs = nextTargetBoundaryMs(now);
          const targetIso = new Date(targetMs).toISOString();

          const tsHeader = request.headers.get("x-b4x4-timestamp");
          const sig = request.headers.get("x-b4x4-signature");
          const tsMs = tsHeader ? Number(tsHeader) : NaN;
          if (!sig || !Number.isFinite(tsMs) || Math.abs(now - tsMs) > MAX_SKEW_MS) {
            return new Response("Unauthorized", { status: 401 });
          }
          const secret = await loadSecret(supabase);
          if (!secret || !validSignature(secret, `${tsHeader}.${targetIso}`, sig)) {
            return new Response("Unauthorized", { status: 401 });
          }
          if (replayed(sig, now)) {
            return new Response("Replay rejected", { status: 401 });
          }
          // Never accept a request whose boundary has already passed.
          if (now >= targetMs) {
            return new Response("Post-boundary request rejected", { status: 400 });
          }

          // Full near-boundary attempt ladder; the handler waits for its slots.
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
