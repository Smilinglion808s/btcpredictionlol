// C85 decision gateway.
//
// The Python worker (services/c85-worker) owns all C85 model math and posts the
// finished decision here, HMAC-signed. This endpoint does no scoring. It:
//
//   1. verifies the signature and rejects stale/replayed timestamps,
//   2. makes the decision durable FIRST (one row per target, abstains included),
//   3. enqueues an outbox entry only for LIVE directional decisions,
//   4. dispatches only when now < target_open + 5s AND the model is permitted
//      by the project's existing WEBHOOK_ALLOWED_MODELS control.
//
// C85 is deliberately NOT added to that allow-list here. Adding a new model must
// not silently redirect real-money execution away from the currently active
// model, so C85 records SUPPRESSED_BY_ALLOWLIST until the allow-list is changed
// explicitly. Everything else — timing, durability, dedupe — runs for real.

import { createFileRoute } from "@tanstack/react-router";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { verifyC85Signature } from "@/lib/c85/gateway.server";
import { C85_MODEL_VERSION, C85_PUBLICATION_DEADLINE_MS } from "@/lib/c85/config";
import {
  dedupeKey,
  enqueueC85Outbox,
  markC85Dispatch,
  upsertC85Decision,
} from "@/lib/c85/store.server";
import { WEBHOOK_ALLOWED_MODELS, deliverWebhookNow } from "@/lib/webhooks.server";

const nsString = z.union([z.string(), z.number()]).nullable().optional();

const bodySchema = z.object({
  worker_id: z.string().min(1).max(120),
  build_sha: z.string().max(120).nullable().optional(),
  ticker: z.string().min(3).max(64),
  target_open_utc: z.string().min(10),
  run_mode: z.enum(["LIVE", "RESEARCH_BACKFILL", "BRIDGE"]),
  status: z.string().min(1).max(64),
  status_reason: z.string().max(500).nullable().optional(),
  final_side: z.number().int().min(-1).max(1),
  decision: z.record(z.unknown()).default({}),
  timing: z.record(nsString).default({}),
  payload: z.record(z.unknown()).nullable().optional(),
  // Non-executing integration probe: verifies signature, schema, clock and the
  // dispatch decision that WOULD be taken, and writes nothing at all.
  dry_run: z.boolean().default(false),
});


const methodNotAllowed = async () =>
  new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });

export const Route = createFileRoute("/api/public/hooks/c85-decision")({
  server: {
    handlers: {
      GET: methodNotAllowed,
      PUT: methodNotAllowed,
      PATCH: methodNotAllowed,
      DELETE: methodNotAllowed,
      POST: async ({ request }) => {
        const raw = await request.text();
        if (
          !verifyC85Signature(
            raw,
            request.headers.get("x-c85-timestamp"),
            request.headers.get("x-c85-signature"),
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

        const targetOpen = new Date(body.target_open_utc);
        if (Number.isNaN(targetOpen.getTime())) {
          return Response.json({ ok: false, error: "bad_target_open_utc" }, { status: 400 });
        }
        const deadline = new Date(targetOpen.getTime() + C85_PUBLICATION_DEADLINE_MS);
        const targetOpenIso = targetOpen.toISOString();

        const timing = Object.fromEntries(
          Object.entries(body.timing).map(([k, v]) => [k, v == null ? null : String(v)]),
        );

        // 1. Durability before dispatch.
        let stored;
        try {
          stored = await upsertC85Decision(supabase, {
            ticker: body.ticker,
            target_open_utc: targetOpenIso,
            deadline_utc: deadline.toISOString(),
            run_mode: body.run_mode,
            status: body.status,
            status_reason: body.status_reason ?? null,
            final_side: body.final_side,
            ...(body.decision as Record<string, never>),
            ...(timing as Record<string, never>),
            decision_durable_ns: String(
              BigInt(Date.now()) * 1_000_000n,
            ),
          });
        } catch (e) {
          return Response.json({ ok: false, error: String(e) }, { status: 500 });
        }

        if (stored.immutableConflict) {
          return Response.json(
            {
              ok: false,
              error: "c85_published_side_is_immutable",
              target_open_utc: targetOpenIso,
            },
            { status: 409 },
          );
        }

        const targetId = String((stored.row as Record<string, unknown>).id ?? "");
        const result: Record<string, unknown> = {
          ok: true,
          model_version: C85_MODEL_VERSION,
          target_id: targetId,
          created: stored.created,
          dedupe_key: dedupeKey(body.ticker, targetOpenIso),
          run_mode: body.run_mode,
          final_side: body.final_side,
        };

        // 2. Abstains and non-live rows are complete decisions with no dispatch.
        if (body.final_side === 0 || body.run_mode !== "LIVE") {
          result.dispatch = body.final_side === 0 ? "ABSTAIN" : "NOT_LIVE";
          return Response.json(result);
        }

        // 3. Hard T+5s ceiling — checked against the wire clock, never backdated.
        const nowMs = Date.now();
        if (nowMs >= deadline.getTime()) {
          await markC85Dispatch(supabase, {
            targetId,
            ticker: body.ticker,
            targetOpenUtc: targetOpenIso,
            status: "EXPIRED",
            error: `missed_deadline_by_${nowMs - deadline.getTime()}ms`,
            publicationOffsetMs: nowMs - targetOpen.getTime(),
          });
          result.dispatch = "EXPIRED";
          result.late_by_ms = nowMs - deadline.getTime();
          return Response.json(result);
        }

        const payload = {
          ...(body.payload ?? {}),
          model: C85_MODEL_VERSION,
          model_name: C85_MODEL_VERSION,
        };
        await enqueueC85Outbox(supabase, {
          targetId,
          ticker: body.ticker,
          targetOpenUtc: targetOpenIso,
          payload,
          expiresAt: deadline.toISOString(),
        });

        // 4. Respect the project's existing single-sender control.
        if (!WEBHOOK_ALLOWED_MODELS.has(C85_MODEL_VERSION)) {
          await markC85Dispatch(supabase, {
            targetId,
            ticker: body.ticker,
            targetOpenUtc: targetOpenIso,
            status: "SUPPRESSED",
            error: "not_in_WEBHOOK_ALLOWED_MODELS",
          });
          result.dispatch = "SUPPRESSED_BY_ALLOWLIST";
          return Response.json(result);
        }

        const delivery = await deliverWebhookNow(supabase, "prediction.created", payload);
        const dispatchNs = String(BigInt(Date.now()) * 1_000_000n);
        await markC85Dispatch(supabase, {
          targetId,
          ticker: body.ticker,
          targetOpenUtc: targetOpenIso,
          status: delivery.delivered > 0 ? "SENT" : "FAILED",
          dispatchNs,
          publicationOffsetMs: Date.now() - targetOpen.getTime(),
          error: delivery.delivered > 0 ? null : "no_endpoint_accepted",
        });
        void delivery.settle;

        result.dispatch = delivery.delivered > 0 ? "SENT" : "FAILED";
        result.delivered = delivery.delivered;
        result.publication_offset_ms = Date.now() - targetOpen.getTime();
        return Response.json(result);
      },
    },
  },
});
