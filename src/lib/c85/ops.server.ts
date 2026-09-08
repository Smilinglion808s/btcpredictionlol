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
import { C85_MODEL_VERSION } from "./config";

export type Ops = z.infer<typeof opSchema>;

const nsish = z.union([z.string(), z.number(), z.null()]).optional();

const checkpointSchema = z.object({
  model_version: z.string().default(C85_MODEL_VERSION),
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

  // -- deployment bundles ----------------------------------------------------
  // The offline bootstrap/refit job builds a versioned serving bundle, uploads
  // it to private storage and registers it here. The Railway worker only ever
  // reads the ACTIVE bundle; it never rebuilds historical ledgers at startup.
  z.object({
    op: z.literal("bundle.upload_url"),
    bundle_version: z.string().min(3).max(120),
    filename: z.string().min(3).max(200).default("bundle.tar.gz"),
  }),
  z.object({
    op: z.literal("bundle.register"),
    bundle_version: z.string().min(3).max(120),
    storage_path: z.string().min(3).max(500),
    bundle_sha256: z.string().min(32).max(128),
    manifest: z.record(z.unknown()).default({}),
    file_count: z.number().int().nonnegative().nullable().optional(),
    byte_size: z.number().int().nonnegative().nullable().optional(),
    checkpoint_utc: z.string().nullable().optional(),
    last_processed_target_utc: z.string().nullable().optional(),
    direction_fit_cutoff_utc: z.string().nullable().optional(),
    meta_fit_cutoff_utc: z.string().nullable().optional(),
    aux_fit_month: z.string().max(16).nullable().optional(),
    source_watermarks: z.record(z.unknown()).default({}),
    parity_report: z.record(z.unknown()).default({}),
    build_sha: z.string().max(120).nullable().optional(),
    status: z.enum(["PENDING", "VERIFIED", "REJECTED"]).default("VERIFIED"),
    notes: z.string().max(2000).nullable().optional(),
  }),
  z.object({ op: z.literal("bundle.activate"), bundle_version: z.string().min(3).max(120) }),
  z.object({
    op: z.literal("bundle.active"),
    // The worker asks for a short-lived signed download URL only when it needs
    // to fetch; a plain metadata read leaves the URL out.
    with_download_url: z.boolean().default(false),
    ttl_seconds: z.number().int().min(60).max(3600).default(900),
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
): Promise<{ status: number; result: Record<string, unknown> }> {
  const mv = C85_MODEL_VERSION;
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
      return { status: lease.granted ? 200 : 409, result: { ok: Boolean(lease.granted), lease } };
    }

    case "decision.commit": {
      const target = { ...body.target, model_version: mv };
      const { data, error } = await supabase.rpc("c85_commit_decision", {
        p_target: target,
        p_checkpoint: body.checkpoint ? { ...body.checkpoint, model_version: mv } : null,
        p_outbox: body.outbox ?? null,
      });
      if (error) {
        // 409 only for genuine conflicts (stale parent, serialization, unique);
        // anything else is a bad payload and must not look like a retryable race.
        const conflict = /conflict|stale|serialize|duplicate|already/i.test(error.message);
        return { status: conflict ? 409 : 400, result: { ok: false, error: error.message } };
      }
      const res = (data ?? {}) as Record<string, unknown>;
      return { status: res.ok === false ? 409 : 200, result: res };
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
