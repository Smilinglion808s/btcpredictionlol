// V2 Final R1 signed recording route. Records checkpoints; when an intent exists it
// flushes the V2 forward outbox to the betting app's V2 receiver (only when the
// v2_forward_settings switch is on). Never reaches any V1.2 receiver or executor.
import { createFileRoute } from "@tanstack/react-router";
import { verifyC85Signature } from "@/lib/c85/gateway.server";
import { claimNonce, serviceClient } from "@/lib/c85/ops.server";
import { flushV2Forward } from "@/lib/v2/forward.server";
import {
  V2_EXECUTION, V2_INPUT_SOURCE, V2_LABEL_SOURCE, V2_MODEL_VERSION, V2_STAKE_POLICY,
  readBounded, sanitizeStatus, validateCheckpoint,
} from "@/lib/v2/contract";

const MAX_BODY = 32_768;
const bad = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

export const Route = createFileRoute("/api/public/hooks/v2-record")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await readBounded(request, MAX_BODY);
        if (raw === null) return bad("TOO_LARGE", 413);
        if (!verifyC85Signature(raw, request.headers.get("x-c85-timestamp"), request.headers.get("x-c85-signature"), 10_000))
          return bad("UNAUTHORIZED", 401);
        let p: any;
        try { p = JSON.parse(raw); } catch { return bad("INVALID_JSON"); }
        if (!p || typeof p !== "object" || Array.isArray(p)) return bad("INVALID_ENVELOPE");
        if (p.model_version !== V2_MODEL_VERSION) return bad("MODEL_VERSION_MISMATCH");
        if (typeof p.worker_id !== "string" || !/^[\w.-]{1,64}$/.test(p.worker_id)) return bad("INVALID_WORKER");
        if (typeof p.nonce !== "string" || p.nonce.length < 16 || p.nonce.length > 120) return bad("INVALID_NONCE");
        if (p.op !== "heartbeat" && p.op !== "record") return bad("UNKNOWN_OP");
        const now = Date.now();
        let stage = "nonce";
        try {
          const sb = serviceClient();
          if (!(await claimNonce(sb, p.nonce, `v2.${p.op}`, p.worker_id))) return bad("REPLAYED", 409);

          if (p.op === "heartbeat") {
            stage = "heartbeat";
            const { error } = await sb.from("v2_worker_runtime").upsert({
              worker_id: p.worker_id,
              model_version: V2_MODEL_VERSION,
              status: { ...sanitizeStatus(p.status), received_at: new Date(now).toISOString() },
              updated_at: new Date(now).toISOString(),
            });
            if (error) throw new Error("heartbeat_upsert");
            await flushV2Forward(sb).catch(() => console.error("v2-forward retry failed"));
            return Response.json({ ok: true, execution: V2_EXECUTION, server_now_ms: now });
          }

          stage = "record";
          const v = validateCheckpoint(p.checkpoint, now);
          if (!v.ok) return bad(v.error);
          const c = v.value;
          // Checkpoint + single candle intent are one transaction. Duplicates re-verify the
          // stored immutable row and idempotently finish a missing intent.
          const { data, error } = await (sb.rpc as any)("v2_record_checkpoint", {
            p: {
              ...c, worker_id: p.worker_id, input_source: V2_INPUT_SOURCE, label_source: V2_LABEL_SOURCE,
              receipt_latency_ms: now - Date.parse(c.decision_at), stake_policy: V2_STAKE_POLICY,
            },
          });
          if (error) throw new Error("record_rpc");
          const r = data as any;
          if (!r?.ok) return bad(r?.error ?? "RECORD_REJECTED", 409);
          if (r.intent) await flushV2Forward(sb, c.candle_open).catch(() => console.error("v2-forward failed"));
          return Response.json({
            ok: true, id: r.id, duplicate: !!r.duplicate, intent: r.intent ?? null, intent_note: r.intent_note ?? null,
            receipt_latency_ms: r.receipt_latency_ms, execution: V2_EXECUTION,
          });
        } catch (e) {
          console.error("v2-record failed", stage, e instanceof Error ? e.name : "unknown");
          return bad("RECORD_FAILED", 500);
        }
      },
    },
  },
});
