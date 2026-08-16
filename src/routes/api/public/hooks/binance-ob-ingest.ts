// B4x4-ES1 Binance Order-Book R1 — signed ingest endpoint.
//
// The collector runs on an always-on external host (Cloudflare Workers cannot
// hold a persistent WebSocket), and pushes derived one-second observations plus
// heartbeats here. Shadow only: nothing written here can influence an ES1
// decision or emit a webhook.

import { createFileRoute } from "@tanstack/react-router";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";

const MAX_SKEW_MS = 5 * 60 * 1000;
const MAX_OBSERVATIONS = 400;

const observationSchema = z
  .object({
    target_ts: z.string().min(20),
    market_kind: z.enum(["SPOT", "USD_M_PERP"]),
    sample_offset_seconds: z.number().int().min(0).max(900),
  })
  .passthrough();

const bodySchema = z.object({
  collector_version: z.string().min(1).max(120),
  build_identifier: z.string().max(200).nullable().optional(),
  observations: z.array(observationSchema).max(MAX_OBSERVATIONS).default([]),
  health: z.record(z.unknown()).nullable().optional(),
});

function verify(rawBody: string, timestamp: string | null, signature: string | null): boolean {
  const secret = process.env['BINANCE_OB_INGEST_SECRET'];
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export const Route = createFileRoute("/api/public/hooks/binance-ob-ingest")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (
          !verify(
            raw,
            request.headers.get("x-binance-ob-timestamp"),
            request.headers.get("x-binance-ob-signature"),
          )
        ) {
          return new Response("Invalid signature", { status: 401 });
        }

        let parsed: z.infer<typeof bodySchema>;
        try {
          parsed = bodySchema.parse(JSON.parse(raw));
        } catch (e) {
          return new Response(
            JSON.stringify({ error: "invalid_body", detail: String(e) }),
            { status: 400, headers: { "content-type": "application/json" } },
          );
        }

        const { createClient } = await import("@supabase/supabase-js");
        const sb = createClient(
          process.env['SUPABASE_URL']!,
          process.env['SUPABASE_SERVICE_ROLE_KEY']!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        const { upsertObservations, upsertCollectorHealth } = await import(
          "@/lib/b4x4es1/binanceOb/store.server"
        );

        const out: Record<string, unknown> = { received: parsed.observations.length };
        try {
          if (parsed.observations.length > 0) {
            out.stored = await upsertObservations(sb, parsed.observations as never);
          }
          if (parsed.health) {
            await upsertCollectorHealth(sb, parsed.health as Record<string, unknown>);
            out.health = true;
          }
        } catch (e) {
          return new Response(
            JSON.stringify({ error: "persist_failed", detail: String(e) }),
            { status: 500, headers: { "content-type": "application/json" } },
          );
        }

        return new Response(JSON.stringify({ ok: true, ...out }), {
          headers: { "content-type": "application/json" },
        });
      },
    },
  },
});
