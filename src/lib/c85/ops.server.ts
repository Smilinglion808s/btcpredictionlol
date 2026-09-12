// C85 signed backend operations.
//
// The Railway worker holds no database credentials. Every persistence operation
// it needs is expressed here as a narrowly scoped, named operation. There is no
// generic SQL and no arbitrary-table access: each op writes a fixed set of C85
// tables through fixed columns or a transactional database function.
//
// Authentication is the existing C85_GATEWAY_SECRET scheme (HMAC-SHA256 over
// "<timestamp>.<exact request bytes>"), plus a single-use nonce so a captured
// request cannot be replayed inside the freshness window.

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import {
  C85_DISPATCH_FORBIDDEN_MODEL_VERSIONS,
  C85_MODEL_VERSION,
  C85_RECONSTRUCTION_VERSION,
  C85_WRITABLE_MODEL_VERSIONS,
  LITE_A_MODEL_VERSION,
  C85_TARGETS_TABLE,
} from "./config";
import {
  dispatchLiteaDecision,
  liteaEffectiveAllowlist,
  liteaServerExecutionEnabled,
  liteaTransportDeadlineMs,
  supabaseLiteaDispatchDeps,
  type LiteADecisionRecord,
} from "@/lib/litea/dispatch.server";
import { deliverWebhookNow, primeWebhookEndpoints } from "@/lib/webhooks.server";
import {
  v11DeliveryArmed,
  v11V1LegClaimRelabel,
  v11V1LegDeliver,
  v11V1LegGateReaders,

} from "@/lib/v11/dispatch.server";

// The identity a signed worker request writes under. Restricted to a closed
// allow-list so a reconstruction worker can never overwrite archived rows and
// an archived replay can never be relabelled as a reconstruction.
export const modelVersionSchema = z
  .enum(C85_WRITABLE_MODEL_VERSIONS)
  .default(C85_MODEL_VERSION);

export type Ops = z.infer<typeof opSchema>;

const nsish = z.union([z.string(), z.number(), z.null()]).optional();

// --- private artifact transfer -------------------------------------------
//
// One bucket, three prefixes, nothing else reachable. The key is validated
// structurally (no traversal, no absolute path, no wildcard, conservative
// character set) rather than by string search, and the signed URL is returned
// to the caller only — it is never logged, echoed into an error, or stored.
export const ARTIFACT_BUCKET = "c85-artifacts";
export const ARTIFACT_PREFIXES = ["releases", "checkpoints", "datasets"] as const;

const KEY_RE = new RegExp(
  `^(?:${ARTIFACT_PREFIXES.join("|")})/(?!.*\\.\\.)[A-Za-z0-9](?:[A-Za-z0-9._/-]{0,198}[A-Za-z0-9._-])?$`,
);

const artifactKey = z
  .string()
  .min(3)
  .max(220)
  .refine((k) => KEY_RE.test(k) && !k.includes("//"), "invalid artifact key");

const artifactPrefix = z
  .string()
  .max(220)
  .default("releases/")
  .refine(
    (p) => ARTIFACT_PREFIXES.some((allowed) => p === `${allowed}/` || p.startsWith(`${allowed}/`)) && !p.includes(".."),
    "invalid artifact prefix",
  );

const artifactTtl = z.number().int().min(30).max(900).default(120);


const checkpointSchema = z.object({
  model_version: modelVersionSchema,
  as_of_utc: z.string().nullable().optional(),
  last_processed_target_utc: z.string().nullable().optional(),
  next_target_utc: z.string().nullable().optional(),
  stage: z.string().max(64).nullable().optional(),
  admission_rank_state: z.unknown().optional(),
  filter_rank_state: z.unknown().optional(),
  deterioration_state: z.unknown().optional(),
  pending_base_calls: z.unknown().optional(),
  consumed_settlements: z.unknown().optional(),
  expert_state: z.unknown().optional(),
  applicable_fits: z.unknown().optional(),
  source_watermarks: z.unknown().optional(),
  state_sha256: z.string().max(128).nullable().optional(),
  expected_parent_seq: z.number().int().nonnegative().nullable().optional(),
});

const settlementSchema = z.object({
  ticker: z.string().min(3).max(64),
  target_open_utc: z.string().min(10),
  settlement_source: z.string().min(1).max(64),
  official_result: z.string().max(64).nullable().optional(),
  label: z.number().int().nullable().optional(),
  settlement_ts: z.string().nullable().optional(),
  settlement_ns: z.union([z.string(), z.number()]).nullable().optional(),
  settlement_value: z.number().nullable().optional(),
  outcome: z.string().max(64).nullable().optional(),
  raw_net: z.number().int().nullable().optional(),
  raw_payload: z.record(z.unknown()).nullable().optional(),
});

export const opSchema = z.discriminatedUnion("op", [
  z.object({ op: z.literal("state.bootstrap") }),
  z.object({ op: z.literal("checkpoint.latest") }),
  z.object({ op: z.literal("checkpoint.append"), checkpoint: checkpointSchema }),
  z.object({
    op: z.literal("lease.acquire"),
    lease_key: z.string().min(1).max(120).default("c85:boundary"),
    ttl_seconds: z.number().int().min(5).max(900).default(60),
  }),
  z.object({
    op: z.literal("decision.commit"),
    target: z.record(z.unknown()),
    checkpoint: checkpointSchema.nullable().optional(),
    outbox: z
      .object({
        dedupe_key: z.string().min(1).max(200),
        payload: z.record(z.unknown()).default({}),
        expires_at: z.string().nullable().optional(),
      })
      .nullable()
      .optional(),
  }),
  z.object({
    op: z.literal("target.missed"),
    ticker: z.string().min(3).max(64),
    target_open_utc: z.string().min(10),
    reason: z.string().max(500),
  }),
  // Read back the rows this identity already recorded, for one bounded target
  // range. The startup bridge uses it so a frame that lags a newer checkpoint
  // is repaired from the inputs that were ACTUALLY frozen at each target,
  // instead of being rebuilt from a later public read that may differ.
  // Version-scoped, range-bounded, no generic SQL, no other model's rows.
  z.object({
    op: z.literal("targets.recorded"),
    from_utc: z.string().min(10),
    to_utc: z.string().min(10),
    limit: z.number().int().min(1).max(1000).default(700),
  }),
  z.object({ op: z.literal("settlements.record"), settlements: z.array(settlementSchema).max(500) }),
  z.object({
    op: z.literal("settlements.pending"),
    since: z.string().nullable().optional(),
    limit: z.number().int().min(1).max(2000).default(500),
  }),
  z.object({
    op: z.literal("settlements.consume"),
    settlement_ids: z.array(z.string().uuid()).min(1).max(1000),
    checkpoint: checkpointSchema.nullable().optional(),
  }),
  z.object({
    op: z.literal("fits.save"),
    kind: z.string().min(1).max(64),
    as_of_utc: z.string(),
    applies_from_utc: z.string(),
    applies_to_utc: z.string().nullable().optional(),
    training_cutoff_utc: z.string(),
    training_rows: z.number().int().nullable().optional(),
    eligible_rows: z.number().int().nullable().optional(),
    positive_rows: z.number().int().nullable().optional(),
    feature_order_sha256: z.string().min(8).max(128),
    training_data_sha256: z.string().max(128).nullable().optional(),
    artifact_sha256: z.string().min(8).max(128),
    artifact_storage: z.string().max(500).nullable().optional(),
    artifact_json: z.record(z.unknown()).nullable().optional(),
    recipe: z.record(z.unknown()).default({}),
    source: z.string().max(120).default("worker"),
  }),
  z.object({
    op: z.literal("fits.applicable"),
    as_of_utc: z.string().nullable().optional(),
  }),
  // Private artifact transfer. The worker never holds storage credentials: it
  // asks for a short-lived signed URL for one validated key inside one bucket.
  z.object({ op: z.literal("artifact.download_url"), key: artifactKey, ttl_seconds: artifactTtl }),
  z.object({ op: z.literal("artifact.upload_url"), key: artifactKey }),
  z.object({ op: z.literal("artifact.list"), prefix: artifactPrefix, limit: z.number().int().min(1).max(200).default(100) }),

  z.object({
    op: z.literal("health.heartbeat"),
    readiness: z.string().max(32),
    stage: z.string().max(32).nullable().optional(),
    blocking_reason: z.string().max(500).nullable().optional(),
    progress: z.record(z.unknown()).nullable().optional(),
    feed_freshness: z.record(z.unknown()).nullable().optional(),
    next_target_utc: z.string().nullable().optional(),
    last_checkpoint_seq: z.number().int().nullable().optional(),
    build_sha: z.string().max(120).nullable().optional(),
    timing: z.record(nsish).nullable().optional(),
  }),
]);

export function serviceClient(): SupabaseClient {
  return createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Single-use nonce. Returns false when this exact request was already accepted. */
export async function claimNonce(
  supabase: SupabaseClient,
  nonce: string,
  op: string,
  workerId: string,
): Promise<boolean> {
  const { error } = await supabase
    .from("c85_request_nonces")
    .insert({ nonce, op, worker_id: workerId });
  if (!error) return true;
  if (String(error.code) === "23505") return false;
  throw new Error(error.message);
}

export async function runC85Op(
  supabase: SupabaseClient,
  workerId: string,
  body: Ops,
  modelVersion: (typeof C85_WRITABLE_MODEL_VERSIONS)[number] = C85_MODEL_VERSION,
): Promise<{ status: number; result: Record<string, unknown> }> {
  const mv = modelVersion;
  const ok = (result: Record<string, unknown>) => ({ status: 200, result: { ok: true, ...result } });

  switch (body.op) {
    case "state.bootstrap":
    case "checkpoint.latest": {
      const { data: cp, error } = await supabase
        .from("c85_state_checkpoints")
        .select("*")
        .eq("model_version", mv)
        .order("checkpoint_seq", { ascending: false })
        .limit(1);
      if (error) throw new Error(error.message);
      const checkpoint = cp?.[0] ?? null;
      if (body.op === "checkpoint.latest") return ok({ checkpoint });

      const [fits, settlements, version] = await Promise.all([
        supabase
          .from("c85_model_versions")
          .select("*")
          .eq("model_version", mv)
          .order("applies_from_utc", { ascending: false })
          .limit(50),
        supabase
          .from("c85_settlements")
          .select("*")
          .eq("model_version", mv)
          .is("consumed_by_deterioration_at", null)
          .order("settlement_ts", { ascending: true })
          .limit(1000),
        supabase
          .from("c85_targets")
          .select("ticker,target_open_utc,base_side,final_side,status,run_mode")
          .eq("model_version", mv)
          .neq("base_side", 0)
          .order("target_open_utc", { ascending: false })
          .limit(768),
      ]);
      return ok({
        checkpoint,
        fits: fits.data ?? [],
        pending_settlements: settlements.data ?? [],
        recent_base_calls: version.data ?? [],
      });
    }

    case "checkpoint.append": {
      const { data, error } = await supabase.rpc("c85_append_checkpoint", {
        p_checkpoint: { ...body.checkpoint, model_version: mv },
      });
      if (error) {
        // 409 only for genuine conflicts (stale parent, serialization, unique);
        // anything else is a bad payload and must not look like a retryable race.
        const conflict = /conflict|stale|serialize|duplicate|already/i.test(error.message);
        return { status: conflict ? 409 : 400, result: { ok: false, error: error.message } };
      }
      return ok({ checkpoint: data });
    }

    case "lease.acquire": {
      const { data, error } = await supabase.rpc("c85_acquire_lease", {
        p_lease_key: body.lease_key,
        p_owner_id: workerId,
        p_ttl_seconds: body.ttl_seconds,
      });
      if (error) throw new Error(error.message);
      const lease = (data ?? {}) as Record<string, unknown>;
      // The Version 1 worker takes this lease BEFORE the boundary, so it is the
      // natural place to warm the endpoint list on whichever instance handles
      // the commit. Fire-and-forget: it never delays the lease response, and a
      // commit landing on a different instance still falls back to the normal
      // (unchanged, 120 s TTL, revocation-respecting) read at send time.
      if (lease.granted && mv === LITE_A_MODEL_VERSION) {
        void primeWebhookEndpoints(supabase, true).catch(() => {});
      }
      return { status: lease.granted ? 200 : 409, result: { ok: Boolean(lease.granted), lease } };
    }

    case "decision.commit": {
      // A shadow-only identity may never enqueue a dispatch, whatever the
      // worker sends. Enforced here, at the trust boundary, instead of relying
      // on the worker to omit the field.
      //
      // Version 1 delivery now has TWO mutually exclusive routes, both of which
      // are absent by default:
      //   * its own control  LITEA_SERVER_EXECUTION_ENABLED=true  → sends as V1
      //   * Version 1.1      V11_SERVER_EXECUTION_ENABLED=true    → the SAME
      //     admitted call, same gates/guard/deadline/claim/accounting, sent as
      //     the combined stream's "V1" leg.
      // With both absent nothing is sent — but the decision MUST still be
      // committed. A worker outbox request for Version 1 therefore never fails
      // the commit: the transactional outbox field is simply dropped, because
      // Version 1 dispatch happens after durability on its own path.
      const liteaExecution = mv === LITE_A_MODEL_VERSION && liteaServerExecutionEnabled();
      const v11Combined = mv === LITE_A_MODEL_VERSION && v11DeliveryArmed();
      const forbidden = (C85_DISPATCH_FORBIDDEN_MODEL_VERSIONS as readonly string[]).filter(
        (v) => !(v === LITE_A_MODEL_VERSION),
      );
      if (body.outbox && forbidden.includes(mv)) {
        return {
          status: 400,
          result: {
            ok: false,
            error: `c85_ops:${mv} is shadow-only and cannot enqueue an outbox entry`,
          },
        };
      }
      const target = { ...body.target, model_version: mv };
      // Version 1 dispatch is handled after the decision is durable, by the
      // Version-1-only path with its own transport ceiling. The transactional
      // C85 outbox row is not written for it.
      const { data, error } = await supabase.rpc("c85_commit_decision", {
        p_target: target,
        p_checkpoint: body.checkpoint ? { ...body.checkpoint, model_version: mv } : null,
        p_outbox: mv === LITE_A_MODEL_VERSION ? null : (body.outbox ?? null),
      });
      if (error) {
        // 409 only for genuine conflicts (stale parent, serialization, unique);
        // anything else is a bad payload and must not look like a retryable race.
        const conflict = /conflict|stale|serialize|duplicate|already/i.test(error.message);
        return { status: conflict ? 409 : 400, result: { ok: false, error: error.message } };
      }
      const res = (data ?? {}) as Record<string, unknown>;
      if (res.ok === false) return { status: 409, result: res };

      // Durable first, then — and only then — the prepared Version 1 dispatch.
      // With both controls off this returns EXECUTION_DISABLED and sends nothing.
      if (mv === LITE_A_MODEL_VERSION && body.outbox) {

        const targetId =
          (res.target_id as string | undefined) ?? (res.id as string | undefined) ?? null;
        // The delivered signal is built ONLY from the committed immutable
        // record under this exact model identity. The commit transaction now
        // returns those minimal persisted fields itself (read back from the
        // table inside the same transaction), so the hot path no longer pays
        // for a second round trip. A replayed request whose body was altered
        // after the original commit still cannot change what would be sent.
        // Older deployments of the RPC omit `decision`; that path falls back
        // to the explicit scoped read.
        const returned = (res.decision ?? null) as Record<string, unknown> | null;
        const persisted =
          returned && String(returned.model_version) === LITE_A_MODEL_VERSION
            ? returned
            : targetId
              ? (
                  await supabase
                    .from(C85_TARGETS_TABLE)
                    .select("*")
                    .eq("id", targetId)
                    .eq("model_version", LITE_A_MODEL_VERSION)
                    .maybeSingle()
                ).data
              : null;
        if (!persisted) {
          return { status: 200, result: { ...res, dispatch: "NO_PERSISTED_RECORD" } };
        }
        const targetOpenMs = new Date(String((persisted as any).target_open_utc)).getTime();
        if (!liteaExecution && !v11Combined) {
          return { status: 200, result: { ...res, dispatch: "EXECUTION_DISABLED" } };
        }
        // Exactly ONE automatic attempt per configured endpoint. `settle` in the
        // transport is logging and endpoint bookkeeping only: with maxAttempts 1
        // it cannot schedule a retransmission.
        //
        // Combined route: identical Version 1 evaluation, claim, guard, single
        // attempt, transport ceiling and target/guard accounting — only the
        // outbound identity on the wire is the Version 1.1 "V1" leg.
        const deliver = v11Combined
          ? v11V1LegDeliver(supabase, targetOpenMs)
          : async (payload: Record<string, unknown>, guard: () => Promise<boolean>) => {
              const delivery = await deliverWebhookNow(supabase, "prediction.created", payload, {
                guard,
                maxAttempts: 1,
                targetOpenMs: Number.isFinite(targetOpenMs) ? targetOpenMs : undefined,
              });
              void delivery.settle;
              return {
                delivered: delivery.delivered,
                sendStartedAtMs: delivery.sendStartedAtMs,
              };
            };
        const liveReaders = v11Combined ? v11V1LegGateReaders() : {};
        const baseDeps = supabaseLiteaDispatchDeps(supabase, deliver);
        // On the combined route the DURABLE outbox payload must match the wire:
        // same combined identity, leg and stake metadata. Key, target id,
        // expiry, ownership and V1 guard accounting are unchanged, and the
        // original dispatcher itself is untouched.
        const claimDeps = v11Combined ? v11V1LegClaimRelabel(baseDeps) : {};
        const dispatch = await dispatchLiteaDecision(
          { ...baseDeps, ...claimDeps, ...liveReaders },

          persisted as LiteADecisionRecord,
          {
            targetId,
            executionEnabled: liteaExecution || v11Combined,
            allowedModels: v11Combined
              ? v11V1LegGateReaders().allowedNow()
              : liteaEffectiveAllowlist(),
            transportDeadlineMs: liteaTransportDeadlineMs(),
            hardCapMs: liteaSendHardCapMs(),
          },
        );
        return {
          status: 200,
          result: {
            ...res,
            dispatch: dispatch.verdict,
            dispatch_route: v11Combined ? "V11_COMBINED_V1_LEG" : "V1",
            dispatch_send_start_offset_ms: dispatch.sendStartOffsetMs ?? null,
          },
        };

      }

      return { status: 200, result: res };
    }



    case "target.missed": {
      const open = new Date(body.target_open_utc);
      const { error } = await supabase.from("c85_targets").upsert(
        {
          model_version: mv,
          ticker: body.ticker,
          target_open_utc: open.toISOString(),
          deadline_utc: new Date(open.getTime() + 5000).toISOString(),
          run_mode: "LIVE",
          status: "MISSED",
          status_reason: body.reason,
          final_side: 0,
          deadline_met: false,
        },
        { onConflict: "model_version,ticker,target_open_utc" },
      );
      if (error) throw new Error(error.message);
      return ok({ recorded: true });
    }

    case "targets.recorded": {
      const { data, error } = await supabase
        .from("c85_targets")
        .select(
          "ticker,target_open_utc,status,status_reason,run_mode,base_side,final_side," +
            "binance_complete,anchor_valid,probability_yes,admission_rank,features",
        )
        .eq("model_version", mv)
        .gte("target_open_utc", new Date(body.from_utc).toISOString())
        .lte("target_open_utc", new Date(body.to_utc).toISOString())
        .order("target_open_utc", { ascending: true })
        .limit(body.limit);
      if (error) throw new Error(error.message);
      return ok({ targets: data ?? [] });
    }

    case "settlements.record": {
      const rows = body.settlements.map((s) => ({
        model_version: mv,
        ...s,
        settlement_ns: s.settlement_ns == null ? null : String(s.settlement_ns),
      }));
      const { error } = await supabase
        .from("c85_settlements")
        .upsert(rows, {
          onConflict: "model_version,ticker,target_open_utc,settlement_source",
          ignoreDuplicates: false,
        });
      if (error) throw new Error(error.message);
      return ok({ recorded: rows.length });
    }

    case "settlements.pending": {
      let q = supabase
        .from("c85_settlements")
        .select("*")
        .eq("model_version", mv)
        .is("consumed_by_deterioration_at", null)
        .order("settlement_ts", { ascending: true })
        .limit(body.limit);
      if (body.since) q = q.gte("settlement_ts", body.since);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return ok({ settlements: data ?? [] });
    }

    case "settlements.consume": {
      const { data, error } = await supabase.rpc("c85_consume_settlements", {
        p_model_version: mv,
        p_settlement_ids: body.settlement_ids,
        p_checkpoint: body.checkpoint ? { ...body.checkpoint, model_version: mv } : null,
      });
      if (error) {
        // 409 only for genuine conflicts (stale parent, serialization, unique);
        // anything else is a bad payload and must not look like a retryable race.
        const conflict = /conflict|stale|serialize|duplicate|already/i.test(error.message);
        return { status: conflict ? 409 : 400, result: { ok: false, error: error.message } };
      }
      return ok({ ...((data ?? {}) as Record<string, unknown>) });
    }

    case "fits.save": {
      const { op: _op, ...row } = body;
      const { error } = await supabase
        .from("c85_model_versions")
        .upsert({ model_version: mv, ...row }, {
          onConflict: "model_version,kind,training_cutoff_utc",
        });
      if (error) throw new Error(error.message);
      return ok({ saved: true, kind: body.kind, training_cutoff_utc: body.training_cutoff_utc });
    }

    case "fits.applicable": {
      const asOf = body.as_of_utc ?? new Date().toISOString();
      const { data, error } = await supabase
        .from("c85_model_versions")
        .select("*")
        .eq("model_version", mv)
        .lte("applies_from_utc", asOf)
        .order("applies_from_utc", { ascending: false })
        .limit(50);
      if (error) throw new Error(error.message);
      return ok({ fits: data ?? [] });
    }

    case "artifact.download_url": {
      const { data, error } = await supabase.storage
        .from(ARTIFACT_BUCKET)
        .createSignedUrl(body.key, body.ttl_seconds);
      if (error || !data?.signedUrl) {
        // Never echo storage internals; a missing object and a disallowed one
        // look identical to the caller.
        return { status: 404, result: { ok: false, error: "artifact_unavailable" } };
      }
      return ok({
        bucket: ARTIFACT_BUCKET,
        key: body.key,
        expires_in: body.ttl_seconds,
        url: data.signedUrl,
      });
    }

    case "artifact.upload_url": {
      const { data, error } = await supabase.storage
        .from(ARTIFACT_BUCKET)
        .createSignedUploadUrl(body.key, { upsert: true });
      if (error || !data?.signedUrl) {
        return { status: 400, result: { ok: false, error: "artifact_upload_unavailable" } };
      }
      return ok({ bucket: ARTIFACT_BUCKET, key: body.key, url: data.signedUrl, token: data.token });
    }

    case "artifact.list": {
      const slash = body.prefix.lastIndexOf("/");
      const folder = body.prefix.slice(0, slash);
      const search = body.prefix.slice(slash + 1);
      const { data, error } = await supabase.storage
        .from(ARTIFACT_BUCKET)
        .list(folder, { limit: body.limit, search: search || undefined });
      if (error) throw new Error(error.message);
      return ok({
        bucket: ARTIFACT_BUCKET,
        objects: (data ?? []).map((o) => ({
          key: `${folder}/${o.name}`,
          size: (o.metadata as Record<string, unknown> | null)?.size ?? null,
          updated_at: o.updated_at ?? null,
        })),
      });
    }



    case "health.heartbeat": {
      const { op: _op, timing, ...fields } = body;
      const { error } = await supabase.from("c85_worker_health").upsert(
        {
          model_version: mv,
          worker_id: workerId,
          last_heartbeat_at: new Date().toISOString(),
          ...fields,
        },
        { onConflict: "model_version,worker_id" },
      );
      if (error) throw new Error(error.message);
      void timing;
      return ok({ beat: true });
    }
  }
}
