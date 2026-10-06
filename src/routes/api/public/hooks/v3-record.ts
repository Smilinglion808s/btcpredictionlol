// V3 PF-E008 signed recording route (dashboard only). Stores worker heartbeats and
// per-candle decisions for the V3 tile. Never forwards, never reaches any bettor,
// V1.2 or V2 receiver. Signed with the existing C85 gateway HMAC + single-use nonce.
import { createFileRoute } from "@tanstack/react-router";
import { verifyC85Signature } from "@/lib/c85/gateway.server";
import { claimNonce, serviceClient } from "@/lib/c85/ops.server";
import { readBounded } from "@/lib/v2/contract";
import { allowV3RecordTransition } from "@/lib/v3/reversal-record";

const MODEL = "v3-pf-e008-r1";
const MAX_BODY = 32_768;
const STATUSES = new Set(["SELECTED", "AWAIT_T30", "NO_CALL", "FAIL_CLOSED", "EXPIRED_UNSENT"]);
const bad = (error: string, status = 400) => Response.json({ ok: false, error }, { status });
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, n = 160) => (typeof v === "string" ? v.slice(0, n) : null);
const iso = (v: unknown) => (typeof v === "string" && !Number.isNaN(Date.parse(v)) ? new Date(v).toISOString() : null);

function cleanStatus(s: any) {
  if (!s || typeof s !== "object") return {};
  const out: Record<string, unknown> = {};
  for (const k of ["prediction_ready", "caught_up", "delivery_enabled"]) if (typeof s[k] === "boolean") out[k] = s[k];
  for (const k of ["feed_age_ms", "clock_skew_ms", "uptime_s"]) out[k] = num(s[k]);
  out.mode = str(s.mode, 16);
  out.reversal_mode = str(s.reversal_mode, 16);
  out.reversal_head_sha256 = str(s.reversal_head_sha256, 64);
  out.reversal_valid_until_s = num(s.reversal_valid_until_s);
  out.latest_fit_day = str(s.latest_fit_day, 40);
  if (s.fit_today && typeof s.fit_today === "object")
    out.fit_today = { 15: s.fit_today["15"] === true, 30: s.fit_today["30"] === true };
  if (Array.isArray(s.not_ready_reasons)) out.not_ready_reasons = s.not_ready_reasons.slice(0, 12).map((r: unknown) => str(r, 40));
  if (s.history_watermark && typeof s.history_watermark === "object")
    out.history_watermark = { 15: str(s.history_watermark["15"], 40), 30: str(s.history_watermark["30"], 40) };
  if (s.faults && typeof s.faults === "object") out.fault_keys = Object.keys(s.faults).slice(0, 12).map((k) => str(k, 40));
  return out;
}

export const Route = createFileRoute("/api/public/hooks/v3-record")({
  server: {
    handlers: {
      POST: async ({ request }) => {
        const raw = await readBounded(request, MAX_BODY);
        if (raw === null) return bad("TOO_LARGE", 413);
        if (!verifyC85Signature(raw, request.headers.get("x-c85-timestamp"), request.headers.get("x-c85-signature"), 10_000))
          return bad("UNAUTHORIZED", 401);
        let p: any;
        try { p = JSON.parse(raw); } catch { return bad("INVALID_JSON"); }
        if (!p || typeof p !== "object" || p.model_version !== MODEL) return bad("MODEL_VERSION_MISMATCH");
        if (typeof p.worker_id !== "string" || !/^[\w.-]{1,64}$/.test(p.worker_id)) return bad("INVALID_WORKER");
        if (typeof p.nonce !== "string" || p.nonce.length < 16 || p.nonce.length > 120) return bad("INVALID_NONCE");
        try {
          const sb = serviceClient();
          if (!(await claimNonce(sb, p.nonce, "v3.record", p.worker_id))) return bad("REPLAYED", 409);
          const now = new Date().toISOString();
          await sb.from("v3_worker_runtime").upsert({ worker_id: p.worker_id, status: cleanStatus(p.status), updated_at: now });
          const decisions: any[] = Array.isArray(p.decisions) ? p.decisions.slice(0, 32) : [];
          let stored = 0;
          for (const d of decisions) {
            const open = iso(d?.candle_open);
            if (!open || Date.parse(open) % 900_000 || !STATUSES.has(d.status)) continue;
            const direction = d.direction === 1 || d.direction === -1 ? d.direction : null;
            const { data: prev } = await sb.from("v3_decisions").select("status,reason,direction,checkpoint").eq("candle_open", open).maybeSingle();
            // A T45 risk veto may end a frozen selection, but cannot change its side/checkpoint.
            if (!allowV3RecordTransition(prev, { ...d, direction }, Date.parse(open))) continue;
            const { error } = await sb.from("v3_decisions").upsert({
              candle_open: open, status: d.status, reason: str(d.reason), checkpoint: num(d.checkpoint),
              direction: direction ?? prev?.direction ?? null, rank: num(d.rank), t15_rank: num(d.t15_rank),
              t30_rank: num(d.t30_rank), decision_at: iso(d.decision_at), fit_version: str(d.fit_version),
              delivery: str(d.delivery, 24), worker_id: p.worker_id, updated_at: now,
            });
            if (!error) stored++;
          }
          return Response.json({ ok: true, stored });
        } catch (e) {
          console.error("v3-record failed", e instanceof Error ? e.name : "unknown");
          return bad("RECORD_FAILED", 500);
        }
      },
    },
  },
});
