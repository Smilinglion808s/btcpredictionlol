// Cross89 — signed one-second bar ingest (offsets 0..29 only).
//
// Shares the collector's HMAC secret with T30 PriceFlow but writes exclusively
// to t30_cross89_samples; no other model's tables are touched.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { T30X_COLLECTOR_VERSION, T30X_MAX_OFFSET, T30X_MIN_OFFSET, TF_MS } from "@/lib/t30x89/config";
import { upsertX89Samples } from "@/lib/t30x89/store.server";

const MAX_SKEW_MS = 5 * 60 * 1000;

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
  received_at_ms: z.number().nullable().optional(),
});

const bodySchema = z.object({
  collector_version: z.string().min(1).max(120).default(T30X_COLLECTOR_VERSION),
  build_identifier: z.string().max(200).nullable().optional(),
  samples: z.array(sampleSchema).max(200).default([]),
});

function verify(raw: string, timestamp: string | null, signature: string | null): boolean {
  const secret = process.env['T30_INGEST_SECRET'] ?? process.env['BINANCE_OB_INGEST_SECRET'];
  if (!secret || !timestamp || !signature) return false;
  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() - ts) > MAX_SKEW_MS) return false;
  const expected = createHmac("sha256", secret).update(`${timestamp}.${raw}`).digest("hex");
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

const methodNotAllowed = async () =>
  new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });

export const Route = createFileRoute("/api/public/hooks/t30-cross89-ingest")({
  server: {
    handlers: {
      GET: methodNotAllowed,
      PUT: methodNotAllowed,
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

        const rows: Record<string, unknown>[] = [];
        const rejected: string[] = [];
        for (const s of body.samples) {
          const target = Math.floor(s.bar_open_ms / TF_MS) * TF_MS;
          const offset = Math.round((s.bar_open_ms - target) / 1000);
          if (!s.is_final) {
            rejected.push("NONFINAL_BAR");
            continue;
          }
          if (offset < T30X_MIN_OFFSET || offset > T30X_MAX_OFFSET) {
            rejected.push("OUT_OF_PACKET");
            continue;
          }
          const finite = [s.open, s.high, s.low, s.close, s.volume, s.quote_volume, s.trade_count];
          if (!finite.every((v) => Number.isFinite(v)) || s.open <= 0 || s.close <= 0) {
            rejected.push("FIELD_INVALID");
            continue;
          }
          rows.push({
            target_ts: new Date(target).toISOString(),
            offset_seconds: offset,
            bar_open_ts: new Date(s.bar_open_ms).toISOString(),
            bar_close_ts: new Date(s.bar_open_ms + 999).toISOString(),
            open: s.open,
            high: s.high,
            low: s.low,
            close: s.close,
            volume: s.volume,
            quote_volume: s.quote_volume,
            taker_buy_volume: s.taker_buy_volume,
            taker_buy_quote_volume: s.taker_buy_quote_volume,
            trade_count: s.trade_count,
            is_final: true,
            event_time_ms: s.event_time_ms ?? null,
            received_at: new Date(s.received_at_ms ?? Date.now()).toISOString(),
            collector_version: body.collector_version,
            build_identifier: body.build_identifier ?? null,
          });
        }

        const supabase = createClient(
          process.env['SUPABASE_URL']!,
          process.env['SUPABASE_SERVICE_ROLE_KEY']!,
          { auth: { persistSession: false, autoRefreshToken: false } },
        );

        let stored = 0;
        try {
          stored = await upsertX89Samples(supabase as never, rows);
        } catch (e) {
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }

        return Response.json({
          ok: true,
          received: body.samples.length,
          stored,
          rejected: rejected.length,
        });
      },
    },
  },
});
