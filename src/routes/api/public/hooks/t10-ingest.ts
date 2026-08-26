// T10 Bridge — signed one-second bar ingest endpoint.
//
// The always-on external collector consumes Binance `btcusdt@kline_1s` and
// pushes finalized offsets 0..9 of each 15-minute UTC candle here. Everything
// else is rejected by validateT10Samples. Writes t10_* tables only, so T30,
// T45 and every other model are untouched by this path.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { validateT10Samples } from "@/lib/t10/ingest";
import { T10_STREAM_KEY } from "@/lib/t10/config";
import { upsertT10Health, upsertT10Samples } from "@/lib/t10/store.server";
import { verifyT10Signature } from "@/lib/t10/signingSecret.server";

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

/** Completed 15m candle pushed by the collector (Binance REST is edge-blocked). */
const klineSchema = z.object({
  venue: z.enum(["SPOT", "FUT"]),
  open_ms: z.number(),
  open: z.number(),
  high: z.number(),
  low: z.number(),
  close: z.number(),
  volume: z.number(),
  quote_volume: z.number(),
  taker_buy_quote_volume: z.number(),
  trade_count: z.number(),
});

const bodySchema = z.object({
  collector_version: z.string().min(1).max(120),
  build_identifier: z.string().max(200).nullable().optional(),
  samples: z.array(sampleSchema).max(MAX_SAMPLES).default([]),
  prior_klines: z.array(klineSchema).max(400).default([]),
  health: z.record(z.unknown()).nullable().optional(),
});

function verify(rawBody: string, timestamp: string | null, signature: string | null): boolean {
  return verifyT10Signature(rawBody, timestamp, signature, MAX_SKEW_MS);
}

const methodNotAllowed = async () =>
  new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });

export const Route = createFileRoute("/api/public/hooks/t10-ingest")({
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
            request.headers.get("x-t10-timestamp"),
            request.headers.get("x-t10-signature"),
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

        const { rows, rejected } = validateT10Samples(body.samples, {
          collectorVersion: body.collector_version,
          buildIdentifier: body.build_identifier ?? null,
        });

        let stored = 0;
        try {
          stored = await upsertT10Samples(supabase, rows);
        } catch (e) {
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }

        let klines = 0;
        if (body.prior_klines.length) {
          const { error } = await supabase.from("t10_prior_klines").upsert(
            body.prior_klines.map((k) => ({
              venue: k.venue,
              candle_ts: new Date(k.open_ms).toISOString(),
              open: k.open,
              high: k.high,
              low: k.low,
              close: k.close,
              volume: k.volume,
              quote_volume: k.quote_volume,
              taker_buy_quote_volume: k.taker_buy_quote_volume,
              trade_count: k.trade_count,
              updated_at: new Date().toISOString(),
            })) as never,
            { onConflict: "venue,candle_ts" },
          );
          if (!error) klines = body.prior_klines.length;
        }


        const h = (body.health ?? {}) as Record<string, unknown>;
        const last = rows[rows.length - 1];
        await upsertT10Health(supabase, {
          stream_key: T10_STREAM_KEY,
          status: String(h.status ?? "LIVE"),
          last_heartbeat_at: new Date().toISOString(),
          last_bar_close_ts: last?.bar_close_ts ?? null,
          last_received_at: last?.received_at ?? new Date().toISOString(),
          last_target_ts: last?.target_ts ?? (h.last_target_ts as string | null) ?? null,
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
