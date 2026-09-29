// V2 Final R1 signed recording route. Records only; it makes NO outbound calls
// and never reaches any V1.2 receiver, executor or betting endpoint.
import { createFileRoute } from "@tanstack/react-router";
import { verifyC85Signature } from "@/lib/c85/gateway.server";
import { claimNonce, serviceClient } from "@/lib/c85/ops.server";
import {
  V2_EXECUTION, V2_INPUT_SOURCE, V2_LABEL_SOURCE, V2_MODEL_VERSION, V2_PRIORITY, V2_STAKE_POLICY,
  validateCheckpoint, type V2Sleeve,
} from "@/lib/v2/contract";

const MAX_BODY = 32_768;
const bad = (error: string, status = 400) => Response.json({ ok: false, error }, { status });

export const Route = createFileRoute("/api/public/hooks/v2-record")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await request.text();
        if (raw.length > MAX_BODY) return bad("TOO_LARGE", 413);
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
        const sb = serviceClient();
        try {
          if (!(await claimNonce(sb, p.nonce, `v2.${p.op}`, p.worker_id))) return bad("REPLAYED", 409);

          if (p.op === "heartbeat") {
            const status = p.status && typeof p.status === "object" && !Array.isArray(p.status) ? p.status : {};
            const { error } = await sb.from("v2_worker_runtime").upsert({
              worker_id: p.worker_id,
              model_version: V2_MODEL_VERSION,
              status: { ...status, execution: V2_EXECUTION, received_at: new Date(now).toISOString() },
              updated_at: new Date(now).toISOString(),
            });
            if (error) throw new Error(error.message);
            return Response.json({ ok: true, execution: V2_EXECUTION, server_now_ms: now });
          }

          const v = validateCheckpoint(p.checkpoint, now);
          if (!v.ok) return bad(v.error);
          const c = v.value;
          const latency = now - Date.parse(c.decision_at);
          const { data: inserted, error } = await sb
            .from("v2_checkpoints")
            .upsert(
              {
                model_version: V2_MODEL_VERSION, candle_open: c.candle_open, checkpoint: c.checkpoint, sleeve: c.sleeve,
                side: c.side, probability: c.probability, eligible: c.eligible, features_ready: c.features_ready,
                reason: c.reason, input_source: V2_INPUT_SOURCE, label_source: V2_LABEL_SOURCE,
                decision_at: c.decision_at, receipt_latency_ms: latency, worker_id: p.worker_id, payload: c.payload,
              },
              { onConflict: "candle_open,checkpoint,sleeve", ignoreDuplicates: true },
            )
            .select("id");
          if (error) throw new Error(error.message);
          const id = inserted?.[0]?.id as string | undefined;
          if (!id) return Response.json({ ok: true, duplicate: true, execution: V2_EXECUTION });

          let intent: string | null = null;
          if (c.eligible) {
            // One intent per candle; a higher-priority eligible sleeve blocks lower ones.
            const higher = V2_PRIORITY.slice(0, V2_PRIORITY.indexOf(c.sleeve as V2Sleeve));
            const { data: blockers } = higher.length
              ? await sb.from("v2_checkpoints").select("id").eq("candle_open", c.candle_open).eq("eligible", true).in("sleeve", higher).limit(1)
              : { data: [] as any[] };
            if (!blockers?.length) {
              const { error: ie } = await sb.from("v2_candle_intents").upsert(
                {
                  candle_open: c.candle_open, model_version: V2_MODEL_VERSION, sleeve: c.sleeve,
                  checkpoint_id: id, side: c.side, execution: V2_EXECUTION, stake_policy: V2_STAKE_POLICY,
                },
                { onConflict: "candle_open", ignoreDuplicates: true },
              );
              if (ie) throw new Error(ie.message);
              intent = c.sleeve;
            }
          }
          return Response.json({ ok: true, id, intent_sleeve: intent, receipt_latency_ms: latency, execution: V2_EXECUTION });
        } catch (e) {
          console.error("v2-record", e instanceof Error ? e.message : e);
          return bad("RECORD_FAILED", 500);
        }
      },
    },
  },
});
