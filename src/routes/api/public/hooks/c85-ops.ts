// C85 worker operations endpoint (signed, narrowly scoped).
//
// This is the only way the Railway worker touches the database. It holds no
// Supabase URL and no service-role key; it holds C85_GATEWAY_SECRET and signs
// "<timestamp>.<exact request bytes>". This route:
//
//   1. verifies the HMAC over the exact bytes and enforces timestamp freshness,
//   2. burns a single-use nonce (replay protection inside the window),
//   3. dispatches to one enumerated operation — never generic SQL.
//
// Decision dispatch (webhook emission, T+5s ceiling, allow-list suppression)
// stays in /api/public/hooks/c85-decision, which already owns that transaction.

import { createFileRoute } from "@tanstack/react-router";
import { z } from "zod";
import { verifyC85Signature } from "@/lib/c85/gateway.server";
import { claimNonce, opSchema, runC85Op, serviceClient } from "@/lib/c85/ops.server";

const envelope = z.object({
  worker_id: z.string().min(1).max(120),
  nonce: z.string().min(8).max(120),
});

const methodNotAllowed = async () =>
  new Response("Method Not Allowed", { status: 405, headers: { allow: "POST" } });

export const Route = createFileRoute("/api/public/hooks/c85-ops")({
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

        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return Response.json({ ok: false, error: "bad_json" }, { status: 400 });
        }

        const head = envelope.safeParse(parsed);
        const op = opSchema.safeParse(parsed);
        if (!head.success || !op.success) {
          return Response.json(
            { ok: false, error: (head.success ? op : head).error.message },
            { status: 400 },
          );
        }

        const supabase = serviceClient();
        try {
          const fresh = await claimNonce(supabase, head.data.nonce, op.data.op, head.data.worker_id);
          if (!fresh) {
            return Response.json(
              { ok: false, error: "replayed_nonce", op: op.data.op },
              { status: 409 },
            );
          }
          const { status, result } = await runC85Op(supabase, head.data.worker_id, op.data);
          return Response.json({ op: op.data.op, ...result }, { status });
        } catch (e) {
          return Response.json(
            { ok: false, op: op.data.op, error: e instanceof Error ? e.message : String(e) },
            { status: 500 },
          );
        }
      },
    },
  },
});
