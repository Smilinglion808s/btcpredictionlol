// T30 PriceFlow — signed one-second bar ingest endpoint.
//
// Cloudflare Workers cannot hold a persistent WebSocket, so the Binance
// `btcusdt@kline_1s` stream is consumed by the always-on external collector and
// pushed here. Offsets 0..29 of each 15-minute UTC candle only; everything else
// is rejected by validateT30Samples before persistence. Writes t30_* only.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { validateT30Samples } from "@/lib/t30/ingest";
import { T30_STREAM_KEY } from "@/lib/t30/config";
import { auditT30, upsertT30Health, upsertT30Samples } from "@/lib/t30/store.server";

const MAX_SKEW_MS = 5 * 60 * 1000;
const MAX_SAMPLES = 200;

const sampleSchema = z.object({
  bar_open_ms: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  quote_volume: z.number(),
  taker_buy_volume: z.number(),
  taker_buy_quote_volume: z.number(),
  trade_count: z.number(),
  is_final: z.boolean(),
  event_time_ms: z.number().nullable().optional(),
  final_event_ms: z.number().nullable().optional(),
  received_at_ms: z.number().nullable().optional(),
});

const bodySchema = z.object({
  collector_version: z.string().min(1).max(120),
  build_identifier: z.string().max(200).nullable().optional(),
  samples: z.array(sampleSchema).max(MAX_SAMPLES).default([]),
  health: z.record(z.unknown()).nullable().optional(),
});

function verify(rawBody: string, timestamp: string | null, signature: string | null): boolean {
  const secret = process.env['T30_INGEST_SECRET'] ?? process.env['BINANCE_OB_INGEST_SECRET'];
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const methodNotAllowed = async () =>
  new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });

export const Route = createFileRoute("/api/public/hooks/t30-ingest")({
  server: {
    handlers: {
      GET: methodNotAllowed,
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
      POST: async ({ request }) => {
        const raw = await request.text();
        if (
          !verify(
            raw,
            request.headers.get("x-t30-timestamp"),
            request.headers.get("x-t30-signature"),
          )
        ) {
          return new Response("Unauthorized", { status: 401 });
        }

        let body: z.infer<typeof bodySchema>;
        try {
          body = bodySchema.parse(JSON.parse(raw));
        } catch (e) {
          return Response.json({ ok: false, error: String(e) }, { status: 400 });
        }

        const supabase = createClient(
          process.env.SUPABASE_URL!,
          process.env.SUPABASE_SERVICE_ROLE_KEY!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        const { rows, rejected } = validateT30Samples(body.samples, {
          collectorVersion: body.collector_version,
          buildIdentifier: body.build_identifier ?? null,
        });

        let stored = 0;
        try {
          stored = await upsertT30Samples(supabase, rows);
        } catch (e) {
          await auditT30(supabase, "ingest-error", { error: String(e) }, false);
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }

        const h = (body.health ?? {}) as Record<string, unknown>;
        const last = rows[rows.length - 1];
        await upsertT30Health(supabase, {
          stream_key: T30_STREAM_KEY,
          status: String(h.status ?? "LIVE"),
          last_heartbeat_at: new Date().toISOString(),
          last_bar_close_ts: last?.bar_close_ts ?? null,
          last_received_at: last?.received_at ?? new Date().toISOString(),
          last_target_ts: last?.target_ts ?? (h.last_target_ts as string | null) ?? null,
          last_target_seconds:
            h.last_target_seconds == null ? null : Number(h.last_target_seconds),
          reconnect_count: Number(h.reconnect_count ?? 0),
          consecutive_errors: Number(h.consecutive_errors ?? 0),
          last_error_code: (h.last_error_code as string | null) ?? null,
          last_error_message: (h.last_error_message as string | null) ?? null,
          deployment_id: (h.deployment_id as string | null) ?? null,
          collector_version: body.collector_version,
          build_identifier: body.build_identifier ?? null,
        });

        return Response.json({
          ok: true,
          received: body.samples.length,
          stored,
          rejected: rejected.length,
          rejected_reasons: rejected.slice(0, 10),
        });
      },
    },
  },
});
